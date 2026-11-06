import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddRecipeDialog, looksLikeUrl } from "./components/AddRecipeDialog";
import { ManageTagsDialog } from "./components/ManageTagsDialog";
import { RecipeEditor } from "./components/RecipeEditor";
import { LibraryView } from "./components/LibraryView";
import { RecipeView } from "./components/RecipeView";
import { SettingsDialog, type SettingsTab } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { isMac, useToast } from "./components/ui";
import { api, type Settings } from "./lib/api";
import { importHtml, importUrl, tagRecipe, type ImportResult } from "./lib/importer";
import { effectiveLlm } from "./lib/llm";
import type { RecipeSummary } from "./lib/types";
import { allTagCounts, NO_FILTERS, useFilteredRecipes, useLibrary, type Filters } from "./state";

type View = { name: "list" } | { name: "recipe"; id: string } | { name: "edit"; id: string | null; from: View; page?: boolean };

const RETAG_INTERVAL_MS = 15 * 60 * 1000;
const RETRY_MIN_MS = 60 * 1000;

export default function App() {
  const toast = useToast();
  const { recipes, tags, reload } = useLibrary();
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

  const refresh = useCallback(async () => {
    await reload();
    setRefreshKey((k) => k + 1);
  }, [reload]);

  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, []);

  // ---- Automatic tagging ---------------------------------------------------
  // Recipes are saved untagged and tagged afterwards, so imports never wait on the
  // AI service. Anything left untagged (offline, service hiccup) is retried soon,
  // backing off to every 15 minutes.
  const taggingRun = useRef(false);
  const retryTimer = useRef(0);
  const retryDelay = useRef(RETRY_MIN_MS);
  const tagPending = useCallback(
    async (opts: { reportErrors?: boolean } = {}) => {
      if (taggingRun.current) return;
      taggingRun.current = true;
      window.clearTimeout(retryTimer.current);
      let failed = false;
      try {
        // Re-read the list each time so recipes imported meanwhile are included.
        for (;;) {
          const next = (await api.listRecipes()).find((r) => r.needsTags);
          if (!next) break;
          setTagging((s) => new Set(s).add(next.id));
          try {
            await tagRecipe(next.id, effectiveLlm(settingsRef.current.llm));
          } catch (e) {
            if (opts.reportErrors) toast({ message: `Couldn't choose tags: ${e instanceof Error ? e.message : e}`, tone: "error" });
            failed = true;
            break;
          } finally {
            setTagging((s) => {
              const rest = new Set(s);
              rest.delete(next.id);
              return rest;
            });
          }
          retryDelay.current = RETRY_MIN_MS;
          await refresh();
        }
      } finally {
        taggingRun.current = false;
      }
      if (failed) {
        retryTimer.current = window.setTimeout(() => void tagPending(), retryDelay.current);
        retryDelay.current = Math.min(retryDelay.current * 2, RETAG_INTERVAL_MS);
      }
    },
    [refresh, toast],
  );

  useEffect(() => {
    void tagPending();
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
      const result = await importUrl(url, effectiveLlm(settingsRef.current.llm));
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
              result = await importHtml(request.html, request.url, effectiveLlm(settingsRef.current.llm));
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
        tags={tags}
        filters={filters}
        onFiltersChange={changeFilters}
        filteredTagCounts={tagCounts}
        onManageTags={() => setTagsOpen(true)}
        onSettings={() => setSettingsTab("ai")}
      />

      <main className="min-w-0 flex-1">
        {view.name === "list" && (
          <LibraryView
            library={library}
            results={results}
            filters={filters}
            searching={searching}
            searchRef={searchRef}
            scrollRef={listScroll}
            onFiltersChange={changeFilters}
            onSortChange={(sort) => setFilters({ ...filters, sort })}
            onOpen={openRecipe}
            onToggleFavorite={toggleFavorite}
            onAdd={() => setAddOpen(true)}
            onExtensionHelp={() => setSettingsTab("extension")}
          />
        )}

        {view.name === "recipe" && (
          <RecipeView
            id={view.id}
            refreshKey={refreshKey}
            allTags={tags}
            tagging={tagging.has(view.id)}
            onBack={backToList}
            onEdit={(page) => setView({ name: "edit", id: view.id, from: view, page })}
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
            allTags={tags.map((t) => t.name)}
            startOnPage={view.page}
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
      <ManageTagsDialog open={tagsOpen} onClose={() => setTagsOpen(false)} tags={tags} counts={allTagCounts(library)} onChanged={refresh} />
    </div>
  );
}
