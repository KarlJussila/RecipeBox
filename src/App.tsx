import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { turnPage } from "./lib/motion";
import { INDEX_QUERY, SHEET_QUERY, useMedia } from "./lib/useMedia";
import type { Recipe, RecipeSummary } from "./lib/types";
import { allTagCounts, NO_FILTERS, useFilteredRecipes, useLibrary, type Filters } from "./state";

type View = { name: "list" } | { name: "recipe"; id: string } | { name: "edit"; id: string | null; from: View };

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
  /** The recipe last opened: its card is the one the page turns from and back to. */
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const [preloaded, setPreloaded] = useState<Recipe | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const listScrollTop = useRef(0);
  const wide = useMedia(SHEET_QUERY);
  /** Where a recipe's ingredients sheet goes, in the sidebar, while one is open. */
  const [sheetSlot, setSheetSlot] = useState<HTMLDivElement | null>(null);
  const roomy = useMedia(INDEX_QUERY);
  /** A recipe or the editor puts its own sheet in the sidebar: the index is no use there. */
  const onCard = view.name === "recipe" || view.name === "edit";
  const sheetMode = wide && onCard;
  /** Too narrow for the sheet, a recipe or the editor takes the whole window. */
  const alone = !wide && onCard;
  /** On a narrow window the box's index is tucked behind a menu button. */
  const tucked = !roomy && view.name === "list";
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!tucked) setMenuOpen(false);
  }, [tucked]);

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
  const openRecipe = async (id: string) => {
    listScrollTop.current = listScroll.current?.scrollTop ?? 0;
    // Name the card first, then read the recipe, so the page can be drawn whole the
    // moment the card starts turning into it.
    flushSync(() => setLastOpened(id));
    const recipe = await api.getRecipe(id);
    turnPage(() => {
      setPreloaded(recipe);
      setView({ name: "recipe", id });
    });
  };
  const backToList = () => turnPage(() => setView({ name: "list" }));

  useEffect(() => {
    if (view.name === "recipe") setLastOpened(view.id);
  }, [view]);
  // Before the page-turn captures the list, so it lands where she left it.
  useLayoutEffect(() => {
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
      if (e.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        return;
      }
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
  }, [view, filters, menuOpen]);

  const toggleFavorite = async (r: RecipeSummary) => {
    await api.setFavorite(r.id, !r.favorite);
    await reload();
  };

  const sidebar = (sheetRef?: (el: HTMLDivElement | null) => void) => (
    <Sidebar
      recipes={library}
      tags={tags}
      filters={filters}
      onFiltersChange={changeFilters}
      filteredTagCounts={tagCounts}
      onManageTags={() => setTagsOpen(true)}
      onSettings={() => setSettingsTab("ai")}
      sheetRef={sheetRef}
    />
  );

  if (recipes === null) return null;

  return (
    <div className="flex h-full print:block print:h-auto">
      {!alone && !tucked && sidebar(sheetMode ? setSheetSlot : undefined)}
      {tucked && menuOpen && (
        // Kept open while she picks filters; Escape, the page, or the button puts it away.
        <>
          <div aria-hidden onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 animate-fade-in bg-black/30" />
          <div className="fixed inset-y-0 left-0 z-50 animate-slide-in">{sidebar()}</div>
        </>
      )}

      {/* The sheet the cards lie on. The views scroll over it, so it never repaints. */}
      <main className="paper-sheet min-w-0 flex-1">
        {view.name === "list" && (
          <LibraryView
            library={library}
            results={results}
            filters={filters}
            searching={searching}
            searchRef={searchRef}
            scrollRef={listScroll}
            active={lastOpened}
            onFiltersChange={changeFilters}
            onSortChange={(sort) => setFilters({ ...filters, sort })}
            onOpen={openRecipe}
            onToggleFavorite={toggleFavorite}
            onAdd={() => setAddOpen(true)}
            onExtensionHelp={() => setSettingsTab("extension")}
            menu={tucked ? { open: menuOpen, toggle: () => setMenuOpen((o) => !o) } : null}
          />
        )}

        {view.name === "recipe" && (
          <RecipeView
            id={view.id}
            initial={preloaded}
            refreshKey={refreshKey}
            allTags={tags}
            tagging={tagging.has(view.id)}
            sheetSlot={sheetMode ? sheetSlot : null}
            alone={alone}
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
            allTags={tags.map((t) => t.name)}
            sheetSlot={sheetMode ? sheetSlot : null}
            alone={alone}
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
