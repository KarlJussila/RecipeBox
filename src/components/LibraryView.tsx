import { ChevronDown, Plus, Puzzle, Search, SearchX, X } from "lucide-react";
import type { RefObject } from "react";
import type { RecipeSummary } from "../lib/types";
import { hasFilters, NO_FILTERS, type Filters, type Sort } from "../state";
import { FeaturedRecipe, RecipeGrid } from "./RecipeGrid";
import { Button, isMac, Sprig, TagPill } from "./ui";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function heading(filters: Filters): string {
  if (filters.query.trim()) return `“${filters.query.trim()}”`;
  if (filters.favorites) return "Favorites";
  if (filters.tags.length) return filters.tags.join(" & ");
  if (filters.maxMinutes) return `Ready in ${filters.maxMinutes === 60 ? "an hour" : `${filters.maxMinutes} minutes`}`;
  return "All recipes";
}

/** Line drawing of herbs in a pot, for the empty library. */
function HerbPot() {
  return (
    <svg viewBox="0 0 160 140" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-36 text-leaf" aria-hidden>
      <path d="M48 92h64l-8 40H56z" fill="currentColor" fillOpacity="0.08" />
      <path d="M44 92h72" />
      <path d="M80 92V40M68 92c0-18-6-30-20-38M92 92c0-16 8-30 22-36M80 64c-10-2-18-10-20-20 10 0 18 8 20 20zM80 52c8-2 16-10 18-20-10 0-16 8-18 20zM58 64c-8-4-12-12-12-20 8 2 12 10 12 20zM104 66c8-4 14-10 14-18-8 2-14 8-14 18z" />
      <path d="M30 132h100" opacity="0.4" />
    </svg>
  );
}

export function LibraryView({
  library,
  results,
  filters,
  searching,
  searchRef,
  scrollRef,
  onFiltersChange,
  onSortChange,
  onOpen,
  onToggleFavorite,
  onAdd,
  onExtensionHelp,
}: {
  library: RecipeSummary[];
  results: RecipeSummary[];
  filters: Filters;
  searching: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onFiltersChange: (f: Filters) => void;
  onSortChange: (s: Sort) => void;
  onOpen: (id: string) => void;
  onToggleFavorite: (r: RecipeSummary) => void;
  onAdd: () => void;
  onExtensionHelp: () => void;
}) {
  const filtered = hasFilters(filters);
  const showFeatured = !filtered && filters.sort === "newest" && library.length >= 4;
  const featured = showFeatured ? results[0] : null;
  const rest = featured ? results.slice(1) : results;
  const clearAll = () => onFiltersChange({ ...NO_FILTERS, sort: filters.sort });

  return (
    <div ref={scrollRef} className="paper-grain scrollbar-quiet @container h-full overflow-y-auto">
      <header data-tauri-drag-region className={`px-12 pb-6 ${isMac ? "pt-12" : "pt-10"}`}>
        <div className="flex items-start justify-between gap-6" data-tauri-drag-region>
          <div data-tauri-drag-region>
            <p className="font-serif text-lg text-ink-soft italic" data-tauri-drag-region>
              {greeting()}
            </p>
            <h1 className="mt-1 font-serif text-[44px] leading-[1.05] font-semibold tracking-tight text-ink" data-tauri-drag-region>
              What shall we cook?
            </h1>
          </div>
          <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={onAdd} className="mt-2">
            Add a recipe
          </Button>
        </div>

        <div className="relative mt-7 max-w-3xl">
          <Search className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            type="search"
            value={filters.query}
            onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
            placeholder={library.length ? `Search ${library.length} recipes by name, ingredient, or note` : "Search recipes"}
            aria-label="Search recipes"
            className="h-14 w-full rounded-2xl bg-card pr-14 pl-13 text-[17px] text-ink shadow-soft ring-1 ring-line placeholder:text-ink-faint focus:ring-2 focus:ring-leaf focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.query ? (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...filters, query: "" })}
              aria-label="Clear search"
              className="absolute top-1/2 right-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint hover:bg-ink/6 hover:text-ink"
            >
              <X className="size-5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 font-sans text-sm text-ink-faint">{isMac ? "⌘F" : "Ctrl F"}</kbd>
          )}
        </div>
      </header>

      <div className="px-12 pb-20">
        {library.length === 0 ? (
          <div className="mx-auto flex max-w-lg flex-col items-center pt-10 text-center">
            <HerbPot />
            <h2 className="mt-6 font-serif text-3xl font-semibold tracking-tight">Your recipe box is ready</h2>
            <p className="mt-3 text-[17px] leading-relaxed text-ink-soft">
              Save recipes from your favorite cooking websites with one click, and they’ll live here, even without an
              internet connection.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={onAdd}>
                Add your first recipe
              </Button>
              <Button variant="ghost" icon={<Puzzle className="size-4" />} onClick={onExtensionHelp}>
                Set up the Chrome button
              </Button>
            </div>
          </div>
        ) : (
          <>
            {featured && (
              <div className="mb-14">
                <FeaturedRecipe recipe={featured} onOpen={() => onOpen(featured.id)} onToggleFavorite={() => onToggleFavorite(featured)} />
              </div>
            )}

            <div className="mb-7 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line pb-4">
              <h2 className="font-serif text-2xl font-semibold tracking-tight">{featured ? "The whole box" : heading(filters)}</h2>
              <span className="text-[15px] text-ink-faint tabular-nums">
                {results.length} {results.length === 1 ? "recipe" : "recipes"}
              </span>
              {filters.tags.map((t) => (
                <TagPill key={t} name={t} selected onRemove={() => onFiltersChange({ ...filters, tags: filters.tags.filter((x) => x !== t) })} />
              ))}
              {filtered && (
                <button type="button" onClick={clearAll} className="text-sm font-semibold text-ink-faint hover:text-ink">
                  Clear filters
                </button>
              )}
              <div className="flex-1" />
              {!filters.query.trim() && library.length > 1 && (
                <label className="relative">
                  <span className="sr-only">Sort by</span>
                  <select
                    value={filters.sort}
                    onChange={(e) => onSortChange(e.target.value as Sort)}
                    className="h-9 appearance-none rounded-full bg-transparent pr-9 pl-4 text-[15px] font-semibold text-ink-soft hover:bg-ink/6 focus:outline-none"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="title">A to Z</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-faint" />
                </label>
              )}
            </div>

            {results.length === 0 && !searching ? (
              <div className="flex flex-col items-center pt-16 text-center">
                <SearchX className="size-10 text-ink-faint" strokeWidth={1.5} />
                <p className="mt-4 font-serif text-2xl font-semibold">Nothing matches that</p>
                <p className="mt-1 text-[15px] text-ink-soft">Try fewer filters or a different word.</p>
                <Button className="mt-6" onClick={clearAll}>
                  Show all recipes
                </Button>
              </div>
            ) : (
              <RecipeGrid recipes={rest} onOpen={onOpen} onToggleFavorite={onToggleFavorite} />
            )}

            {results.length > 6 && (
              <div className="mt-16 flex justify-center text-leaf/50">
                <Sprig className="size-7" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
