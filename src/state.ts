import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./lib/api";
import type { Tag } from "./lib/tags";
import type { RecipeSummary } from "./lib/types";

export type Sort = "newest" | "oldest" | "title";

export interface Filters {
  query: string;
  tags: string[];
  favorites: boolean;
  maxMinutes: number | null;
  sort: Sort;
}

export const NO_FILTERS: Filters = { query: "", tags: [], favorites: false, maxMinutes: null, sort: "newest" };

export function hasFilters(f: Filters): boolean {
  return Boolean(f.query.trim() || f.tags.length || f.favorites || f.maxMinutes);
}

/** All recipe summaries, refreshed whenever something changes them. */
export function useLibrary() {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const reload = useCallback(async () => {
    const [list, tagList] = await Promise.all([api.listRecipes(), api.allTags()]);
    setRecipes(list);
    setTags(tagList);
  }, []);

  useEffect(() => {
    void reload();
    // Changes made outside this window's own actions, e.g. tags set from the browser extension.
    const unlisten = listen("library-changed", () => void reload());
    return () => void unlisten.then((fn) => fn());
  }, [reload]);

  return { recipes, tags, reload };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Applies search, tag, favorite and time filters. Search ranking comes from SQLite FTS. */
export function useFilteredRecipes(recipes: RecipeSummary[], filters: Filters) {
  const query = useDebounced(filters.query.trim(), 120);
  const [ranked, setRanked] = useState<string[] | null>(null);

  useEffect(() => {
    if (!query) {
      setRanked(null);
      return;
    }
    let cancelled = false;
    api.searchRecipes(query).then((ids) => {
      if (!cancelled) setRanked(ids);
    });
    return () => {
      cancelled = true;
    };
    // Re-run when the library changes so new recipes show up in an active search.
  }, [query, recipes]);

  return useMemo(() => {
    let list = recipes;
    if (ranked) {
      const byId = new Map(recipes.map((r) => [r.id, r]));
      list = ranked.map((id) => byId.get(id)).filter((r): r is RecipeSummary => Boolean(r));
    }
    const wanted = filters.tags.map((t) => t.toLowerCase());
    list = list.filter((r) => {
      if (filters.favorites && !r.favorite) return false;
      if (filters.maxMinutes && (r.totalMinutes === null || r.totalMinutes > filters.maxMinutes)) return false;
      const tags = r.tags.map((t) => t.toLowerCase());
      return wanted.every((t) => tags.includes(t));
    });
    // Search results stay in relevance order; otherwise use the chosen sort.
    if (!ranked) {
      list = [...list].sort((a, b) => {
        if (filters.sort === "title") return a.title.localeCompare(b.title);
        if (filters.sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
        return b.createdAt.localeCompare(a.createdAt);
      });
    }

    const tagCounts = new Map<string, number>();
    for (const r of list) for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    return { results: list, tagCounts, searching: Boolean(query) && ranked === null };
  }, [recipes, ranked, filters, query]);
}

/** Every tag in the library with how many recipes use it. */
export function allTagCounts(recipes: RecipeSummary[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of recipes) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));
}
