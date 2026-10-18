import { listen } from "@tauri-apps/api/event";
import { ChevronDown, Plus, Puzzle, SearchX, Sprout, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddRecipeDialog, looksLikeUrl } from "./components/AddRecipeDialog";
import { ManageTagsDialog } from "./components/ManageTagsDialog";
import { RecipeEditor } from "./components/RecipeEditor";
import { RecipeGrid } from "./components/RecipeGrid";
import { RecipeView } from "./components/RecipeView";
import { SettingsDialog, type SettingsTab } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { Button, isMac, TagChip, useToast } from "./components/ui";
import { api, type Settings } from "./lib/api";
import { importHtml, importUrl, tagRecipe, type ImportResult } from "./lib/importer";
import { llmConfigured } from "./lib/llm";
import type { RecipeSummary } from "./lib/types";
import { allTagCounts, hasFilters, NO_FILTERS, useFilteredRecipes, useLibrary, type Filters, type Sort } from "./state";

type View = { name: "list" } | { name: "recipe"; id: string } | { name: "edit"; id: string | null; from: View };

const RETAG_INTERVAL_MS = 15 * 60 * 1000;

function listTitle(filters: Filters): string {
  if (filters.query.trim()) return `Results for “${filters.query.trim()}”`;
  if (filters.favorites) return "Favorites";
  if (filters.tags.length) return filters.tags.join(" + ");
  return "All recipes";
}

function EmptyLibrary({ onAdd, onExtension }: { onAdd: () => void; onExtension: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 pt-20 text-center">
      <span className="flex size-20 items-center justify-center rounded-3xl bg-leaf-100 text-leaf-700 shadow-card dark:bg-leaf-900/50 dark:text-leaf-300">
        <Sprout className="size-10" strokeWidth={1.75} />
      </span>
      <h2 className="mt-6 font-serif text-3xl font-semibold tracking-tight">Welcome to your Recipe Box</h2>
      <p className="mt-3 text-[17px] leading-relaxed text-stone-600 dark:text-stone-400">
        Save recipes from your favorite cooking websites and find them again in a snap, even without an internet
        connection.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={onAdd}>
          Add your first recipe
        </Button>
        <Button variant="ghost" icon={<Puzzle className="size-4" />} onClick={onExtension}>
          Set up the Chrome button
        </Button>
      </div>
    </div>
  );
}

export default function App() {
  const toast = useToast();
  const { recipes, reload } = useLibrary();
  const [view, setView] = useState<View>({ name: "list" });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [settings, setSettings] = useState<Settings>({});
  const [addOpen, setAddOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tagging, setTagging] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const listScrollTop = useRef(0);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const library = recipes ?? [];
  const { results, tagCounts, searching } = useFilteredRecipes(library, filters);
  const tagList = useMemo(() => allTagCounts(library), [library]);
  const allTags = useMemo(() => tagList.map(([name]) => name), [tagList]);

  const refresh = useCallback(async () => {
    await reload();
    setRefreshKey((k) => k + 1);
  }, [reload]);

  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, []);

  // ---- Automatic tagging ---------------------------------------------------
  // Recipes are saved untagged and tagged afterwards, so imports never wait on the
  // AI service. Anything left untagged (offline, no service yet) is retried later.
  const taggingRun = useRef(false);
  const tagPending = useCallback(
    async (opts: { reportErrors?: boolean } = {}) => {
      const llm = settingsRef.current.llm;
      if (taggingRun.current || !llmConfigured(llm)) return;
      taggingRun.current = true;
      try {
        const pending = (await api.listRecipes()).filter((r) => r.needsTags);
        for (const r of pending) {
          setTagging((s) => new Set(s).add(r.id));
          try {
            await tagRecipe(r.id, llm);
          } catch (e) {
            if (opts.reportErrors) toast({ message: `Couldn't choose tags: ${e instanceof Error ? e.message : e}`, tone: "error" });
            break;
          } finally {
            setTagging((s) => {
              const next = new Set(s);
              next.delete(r.id);
              return next;
            });
          }
          await refresh();
        }
      } finally {
        taggingRun.current = false;
      }
    },
    [refresh, toast],
  );

  useEffect(() => {
    if (llmConfigured(settings.llm)) void tagPending();
    const timer = window.setInterval(() => void tagPending(), RETAG_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [settings, tagPending]);

  // ---- Importing -----------------------------------------------------------
  const finishImport = useCallback(
    async (result: ImportResult) => {
      if (result.status === "error") return;
      await refresh();
      setView({ name: "recipe", id: result.id });
      if (result.status === "duplicate") {
        toast({ message: `“${result.title}” is already in your recipe box.`, tone: "info" });
      } else {
        toast({ message: `Saved “${result.title}”`, tone: "success" });
        void tagPending({ reportErrors: true });
      }
    },
    [refresh, tagPending, toast],
  );

  const importFromUrl = useCallback(
    async (url: string): Promise<string | null> => {
      const result = await importUrl(url, settingsRef.current.llm);
      if (result.status === "error") return result.message;
      await finishImport(result);
      return null;
    },
    [finishImport],
  );

  // Pages sent from the browser extension.
  useEffect(() => {
    let running = false;
    const drain = async () => {
      if (running) return;
      running = true;
      try {
        for (let batch = await api.takePendingImports(); batch.length; batch = await api.takePendingImports()) {
          for (const request of batch) {
            const progress = toast({ message: "Saving recipe…", tone: "info", busy: true }, 0);
            let result: ImportResult;
            try {
              result = await importHtml(request.html, request.url, settingsRef.current.llm);
            } catch (e) {
              result = { status: "error", message: String(e) };
            }
            await api.resolveImport(request.id, result);
            progress.dismiss();
            if (result.status === "error") toast({ message: result.message, tone: "error" }, 8000);
            else await finishImport(result);
          }
        }
      } finally {
        running = false;
      }
    };
    void drain();
    const unlisten = listen("import-requested", () => void drain());
    return () => void unlisten.then((fn) => fn());
  }, [finishImport, toast]);

  // Pasting or dropping a link anywhere (outside a text field) imports it.
  useEffect(() => {
    const isField = (el: EventTarget | null) => el instanceof HTMLElement && el.closest("input, textarea, [contenteditable]");
    const tryImport = async (text: string) => {
      if (!looksLikeUrl(text)) return false;
      const progress = toast({ message: "Saving recipe…", tone: "info", busy: true }, 0);
      const error = await importFromUrl(text.trim());
      progress.dismiss();
      if (error) toast({ message: error, tone: "error" }, 8000);
      return true;
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!isField(e.target) && looksLikeUrl(text)) {
        e.preventDefault();
        void tryImport(text);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("text/uri-list")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const url = e.dataTransfer?.getData("text/uri-list")?.split("\n")[0];
      if (url && !isField(e.target)) {
        e.preventDefault();
        void tryImport(url);
      }
    };
    document.addEventListener("paste", onPaste);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [importFromUrl, toast]);

  // ---- Navigation ----------------------------------------------------------
  const openRecipe = (id: string) => {
    listScrollTop.current = listScroll.current?.scrollTop ?? 0;
    setView({ name: "recipe", id });
  };
  const backToList = () => setView({ name: "list" });

  useEffect(() => {
    if (view.name === "list" && listScroll.current) listScroll.current.scrollTop = listScrollTop.current;
  }, [view]);

  const changeFilters = (f: Filters) => {
    setFilters(f);
    listScrollTop.current = 0;
    if (view.name !== "list") setView({ name: "list" });
    else listScroll.current?.scrollTo(0, 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (view.name === "edit") return;
        if (view.name !== "list") setView({ name: "list" });
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setAddOpen(true);
      } else if (e.key === "Escape" && view.name === "recipe" && !document.querySelector("dialog[open]")) {
        backToList();
      } else if (e.key === "Escape" && view.name === "list" && document.activeElement === searchRef.current && filters.query) {
        setFilters({ ...filters, query: "" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, filters]);

  const toggleFavorite = async (r: RecipeSummary) => {
    await api.setFavorite(r.id, !r.favorite);
    await reload();
  };

  if (recipes === null) return null;

  return (
    <div className="flex h-full">
      <Sidebar
        recipes={library}
        filters={filters}
        onFiltersChange={changeFilters}
        filteredTagCounts={tagCounts}
        searchRef={searchRef}
        onManageTags={() => setTagsOpen(true)}
        onSettings={() => setSettingsTab("ai")}
      />

      <main className="min-w-0 flex-1">
        {view.name === "list" && (
          <div ref={listScroll} className="scrollbar-quiet h-full overflow-y-auto">
            <header
              data-tauri-drag-region
              className="sticky top-0 z-10 bg-stone-50/85 px-10 pt-7 pb-5 backdrop-blur-md dark:bg-stone-950/85"
            >
              <div className="flex items-end gap-4" data-tauri-drag-region>
                <div className="min-w-0 flex-1" data-tauri-drag-region>
                  <h1 className="truncate font-serif text-3xl font-semibold tracking-tight">{listTitle(filters)}</h1>
                  <p className="mt-1 text-[15px] text-stone-500 dark:text-stone-400">
                    {results.length} {results.length === 1 ? "recipe" : "recipes"}
                  </p>
                </div>
                {!filters.query.trim() && library.length > 1 && (
                  <label className="relative">
                    <span className="sr-only">Sort by</span>
                    <select
                      value={filters.sort}
                      onChange={(e) => setFilters({ ...filters, sort: e.target.value as Sort })}
                      className="h-10 appearance-none rounded-lg bg-transparent pr-9 pl-3 text-[15px] font-medium text-stone-700 hover:bg-stone-200/60 focus:outline-none dark:text-stone-300 dark:hover:bg-stone-800"
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="title">A to Z</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-stone-500" />
                  </label>
                )}
                <Button variant="primary" icon={<Plus className="size-[18px]" />} onClick={() => setAddOpen(true)}>
                  Add recipe
                </Button>
              </div>
              {hasFilters(filters) && (filters.tags.length > 0 || filters.maxMinutes) && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {filters.tags.map((t) => (
                    <TagChip key={t} name={t} selected onRemove={() => changeFilters({ ...filters, tags: filters.tags.filter((x) => x !== t) })} />
                  ))}
                  {filters.maxMinutes && (
                    <TagChip
                      name={`Ready in ${filters.maxMinutes === 60 ? "1 hour" : `${filters.maxMinutes} min`}`}
                      selected
                      onRemove={() => changeFilters({ ...filters, maxMinutes: null })}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => changeFilters({ ...NO_FILTERS, sort: filters.sort })}
                    className="ml-1 inline-flex items-center gap-1 text-sm font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                  >
                    <X className="size-3.5" /> Clear all
                  </button>
                </div>
              )}
            </header>

            <div className="px-10 pt-2 pb-16">
              {library.length === 0 ? (
                <EmptyLibrary onAdd={() => setAddOpen(true)} onExtension={() => setSettingsTab("extension")} />
              ) : results.length === 0 && !searching ? (
                <div className="flex flex-col items-center pt-24 text-center">
                  <SearchX className="size-10 text-stone-400" strokeWidth={1.5} />
                  <p className="mt-4 font-serif text-xl font-semibold">No recipes match</p>
                  <p className="mt-1 text-[15px] text-stone-500">Try fewer filters or a different search.</p>
                  <Button className="mt-5" onClick={() => changeFilters({ ...NO_FILTERS, sort: filters.sort })}>
                    Show all recipes
                  </Button>
                </div>
              ) : (
                <RecipeGrid recipes={results} onOpen={openRecipe} onToggleFavorite={toggleFavorite} />
              )}
            </div>
          </div>
        )}

        {view.name === "recipe" && (
          <RecipeView
            id={view.id}
            refreshKey={refreshKey}
            allTags={allTags}
            tagging={tagging.has(view.id)}
            onBack={backToList}
            onEdit={() => setView({ name: "edit", id: view.id, from: view })}
            onDeleted={async () => {
              await reload();
              backToList();
            }}
            onChanged={reload}
          />
        )}

        {view.name === "edit" && (
          <RecipeEditor
            id={view.id}
            allTags={allTags}
            onCancel={() => setView(view.from)}
            onSaved={async (id) => {
              await refresh();
              setView({ name: "recipe", id });
            }}
          />
        )}
      </main>

      <AddRecipeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onImport={importFromUrl}
        onWriteOwn={() => {
          setAddOpen(false);
          setView({ name: "edit", id: null, from: view });
        }}
        onShowExtensionHelp={() => {
          setAddOpen(false);
          setSettingsTab("extension");
        }}
      />
      <SettingsDialog
        open={settingsTab !== null}
        initialTab={settingsTab ?? "ai"}
        onClose={() => setSettingsTab(null)}
        onSettingsSaved={setSettings}
        onRestored={refresh}
      />
      <ManageTagsDialog open={tagsOpen} onClose={() => setTagsOpen(false)} tags={tagList} onChanged={refresh} />
    </div>
  );
}
