import { BookOpen, Check, Heart, Search, Settings, Sprout, X } from "lucide-react";
import type { RefObject } from "react";
import type { RecipeSummary } from "../lib/types";
import { allTagCounts, type Filters } from "../state";
import { cx, isMac } from "./ui";

const TIME_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "Any", minutes: null },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
];

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[15px] transition-colors duration-150",
        active
          ? "bg-leaf-100 font-semibold text-leaf-900 dark:bg-leaf-900/50 dark:text-leaf-100"
          : "text-stone-700 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800/70",
      )}
    >
      <span className={cx("shrink-0", active ? "text-leaf-700 dark:text-leaf-300" : "text-stone-500")}>{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {count !== undefined && <span className="text-sm text-stone-500 tabular-nums dark:text-stone-400">{count}</span>}
    </button>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-6 mb-1.5 flex items-center justify-between px-3">
      <h3 className="text-xs font-semibold tracking-wider text-stone-500 uppercase dark:text-stone-400">{children}</h3>
      {action}
    </div>
  );
}

export function Sidebar({
  recipes,
  filters,
  onFiltersChange,
  filteredTagCounts,
  searchRef,
  onManageTags,
  onSettings,
}: {
  recipes: RecipeSummary[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  filteredTagCounts: Map<string, number>;
  searchRef: RefObject<HTMLInputElement | null>;
  onManageTags: () => void;
  onSettings: () => void;
}) {
  const set = (patch: Partial<Filters>) => onFiltersChange({ ...filters, ...patch });
  const favorites = recipes.filter((r) => r.favorite).length;
  const narrowed = filters.tags.length > 0 || filters.favorites || filters.maxMinutes || filters.query.trim();
  // While filtering, only offer tags that would still match something.
  const tags = allTagCounts(recipes)
    .map(([name, total]) => [name, narrowed ? (filteredTagCounts.get(name) ?? 0) : total] as const)
    .filter(([name, count]) => count > 0 || filters.tags.includes(name));

  const toggleTag = (name: string) =>
    set({ tags: filters.tags.includes(name) ? filters.tags.filter((t) => t !== name) : [...filters.tags, name] });

  return (
    <aside className="no-print flex h-full w-64 shrink-0 flex-col border-r border-stone-200/80 bg-stone-100/70 dark:border-stone-800 dark:bg-stone-900/60">
      {/* Leaves room for the macOS window buttons and lets the window be dragged from here. */}
      <div data-tauri-drag-region className={isMac ? "h-12 shrink-0" : "h-3 shrink-0"} />

      <div className="flex items-center gap-2.5 px-5 pb-4" data-tauri-drag-region>
        <span className="flex size-8 items-center justify-center rounded-lg bg-leaf-700 text-leaf-50 shadow-sm dark:bg-leaf-600">
          <Sprout className="size-[18px]" strokeWidth={2.25} />
        </span>
        <span className="font-serif text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">Recipe Box</span>
      </div>

      <div className="px-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <input
            ref={searchRef}
            type="search"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search recipes"
            aria-label="Search recipes"
            className="h-10 w-full rounded-lg bg-white pr-9 pl-9 text-[15px] ring-1 ring-stone-300/70 placeholder:text-stone-400 focus:ring-2 focus:ring-leaf-600 focus:outline-none dark:bg-stone-950 dark:ring-stone-700 [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.query ? (
            <button
              type="button"
              onClick={() => set({ query: "" })}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800"
            >
              <X className="size-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 font-sans text-xs text-stone-400">
              {isMac ? "⌘F" : "Ctrl F"}
            </kbd>
          )}
        </div>
      </div>

      <nav className="scrollbar-quiet mt-4 flex-1 overflow-y-auto px-3 pb-4">
        <NavItem
          icon={<BookOpen className="size-[18px]" />}
          label="All recipes"
          count={recipes.length}
          active={!filters.favorites}
          onClick={() => set({ favorites: false })}
        />
        <NavItem
          icon={<Heart className="size-[18px]" />}
          label="Favorites"
          count={favorites}
          active={filters.favorites}
          onClick={() => set({ favorites: true })}
        />

        <SectionTitle>Ready in</SectionTitle>
        <div className="flex gap-1 px-1" role="radiogroup" aria-label="Ready in">
          {TIME_OPTIONS.map((o) => {
            const active = filters.maxMinutes === o.minutes;
            return (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ maxMinutes: o.minutes })}
                className={cx(
                  "h-8 flex-1 rounded-lg text-sm transition-colors duration-150",
                  active
                    ? "bg-white font-semibold text-leaf-800 shadow-card ring-1 ring-stone-200 dark:bg-stone-800 dark:text-leaf-200 dark:ring-stone-700"
                    : "text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800/70",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <SectionTitle
          action={
            tags.length > 0 && (
              <button
                type="button"
                onClick={onManageTags}
                className="text-xs font-medium text-stone-500 hover:text-leaf-700 dark:text-stone-400 dark:hover:text-leaf-300"
              >
                Edit
              </button>
            )
          }
        >
          Tags
        </SectionTitle>
        {tags.length === 0 && (
          <p className="px-3 py-1 text-sm leading-relaxed text-stone-500 dark:text-stone-400">
            {narrowed ? "No tags match." : "Tags appear here as recipes are added."}
          </p>
        )}
        <ul className="space-y-px">
          {tags.map(([name, count]) => {
            const selected = filters.tags.includes(name);
            return (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => toggleTag(name)}
                  aria-pressed={selected}
                  className={cx(
                    "flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-[15px] transition-colors duration-150",
                    selected
                      ? "bg-leaf-700 text-white dark:bg-leaf-600"
                      : "text-stone-700 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800/70",
                  )}
                >
                  <span
                    className={cx(
                      "flex size-4 shrink-0 items-center justify-center rounded",
                      selected ? "bg-white/20" : "ring-1 ring-stone-300 ring-inset dark:ring-stone-600",
                    )}
                  >
                    {selected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate text-left">{name}</span>
                  <span className={cx("text-sm tabular-nums", selected ? "text-leaf-100" : "text-stone-500 dark:text-stone-400")}>
                    {count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-stone-200/80 p-3 dark:border-stone-800">
        <NavItem icon={<Settings className="size-[18px]" />} label="Settings" active={false} onClick={onSettings} />
      </div>
    </aside>
  );
}
