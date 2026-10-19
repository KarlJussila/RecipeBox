import { BookOpen, ChevronDown, EyeOff, Flame, Globe, Heart, PartyPopper, Salad, Settings, Sprout, Tag as TagIcon, UtensilsCrossed, Wheat } from "lucide-react";
import { useState, type ReactNode } from "react";
import { groupTags, type Tag } from "../lib/tags";
import type { RecipeSummary } from "../lib/types";
import type { Filters } from "../state";
import { cx, isMac, Sprig } from "./ui";

const CATEGORY_ICONS: Record<string, ReactNode> = {
  Dish: <UtensilsCrossed className="size-4" />,
  Ingredient: <Wheat className="size-4" />,
  Cuisine: <Globe className="size-4" />,
  Dietary: <Salad className="size-4" />,
  Occasion: <PartyPopper className="size-4" />,
  Method: <Flame className="size-4" />,
  Other: <TagIcon className="size-4" />,
};

const TIME_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "Any time", minutes: null },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
];

const COLLAPSED_KEY = "recipebox.collapsedCategories";

function useCollapsed(): [Set<string>, (category: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const toggle = (category: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  return [collapsed, toggle];
}

function SpineLink({ icon, label, count, active, onClick }: { icon: ReactNode; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[15px] transition-colors duration-150",
        active ? "bg-cream font-semibold text-spine" : "text-cream/85 hover:bg-white/8 hover:text-cream",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <span className={cx("text-sm tabular-nums", active ? "text-spine/60" : "text-cream-soft/70")}>{count}</span>
    </button>
  );
}

export function Sidebar({
  recipes,
  tags,
  filters,
  onFiltersChange,
  filteredTagCounts,
  onManageTags,
  onSettings,
}: {
  recipes: RecipeSummary[];
  tags: Tag[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  filteredTagCounts: Map<string, number>;
  onManageTags: () => void;
  onSettings: () => void;
}) {
  const [collapsed, toggleCollapsed] = useCollapsed();
  const set = (patch: Partial<Filters>) => onFiltersChange({ ...filters, ...patch });
  const narrowed = filters.tags.length > 0 || filters.excludedTags.length > 0 || filters.favorites || filters.maxMinutes || filters.query.trim();

  const totals = new Map<string, number>();
  for (const r of recipes) for (const t of r.tags) totals.set(t, (totals.get(t) ?? 0) + 1);
  // While filtering, only offer tags that would still match something.
  const visible = tags
    .map((t) => ({
      ...t,
      // A hidden tag shows how many recipes it's hiding.
      count: narrowed && !filters.excludedTags.includes(t.name) ? (filteredTagCounts.get(t.name) ?? 0) : (totals.get(t.name) ?? 0),
    }))
    .filter((t) => t.count > 0 || filters.tags.includes(t.name) || filters.excludedTags.includes(t.name));
  const groups = groupTags(visible, (t) => t.category);

  // Each click moves a tag along: off → show only these → hide these → off.
  const cycleTag = (name: string) => {
    const tags = filters.tags.filter((t) => t !== name);
    const excludedTags = filters.excludedTags.filter((t) => t !== name);
    if (filters.tags.includes(name)) excludedTags.push(name);
    else if (!filters.excludedTags.includes(name)) tags.push(name);
    set({ tags, excludedTags });
  };

  return (
    <aside className="linen no-print relative flex h-full w-72 shrink-0 flex-col bg-spine text-cream">
      {/* Leaves room for the macOS window buttons and lets the window be dragged from here. */}
      <div data-tauri-drag-region className={isMac ? "h-11 shrink-0" : "h-4 shrink-0"} />

      <div className="flex items-center gap-2.5 px-6 pt-2 pb-6" data-tauri-drag-region>
        <Sprig className="size-8 text-[#a8d1a2]" />
        <span className="font-serif text-[27px] leading-none font-medium tracking-tight italic" data-tauri-drag-region>
          Recipe Box
        </span>
      </div>

      <nav className="scrollbar-spine flex-1 overflow-y-auto px-4 pb-6">
        <div className="space-y-1">
          <SpineLink
            icon={<BookOpen className="size-[18px]" />}
            label="All recipes"
            count={recipes.length}
            active={!filters.favorites}
            onClick={() => set({ favorites: false })}
          />
          <SpineLink
            icon={<Heart className="size-[18px]" />}
            label="Favorites"
            count={recipes.filter((r) => r.favorite).length}
            active={filters.favorites}
            onClick={() => set({ favorites: true })}
          />
        </div>

        <h3 className="mt-8 mb-2.5 px-3 text-[11px] font-bold tracking-[0.16em] text-cream-soft uppercase">Ready in</h3>
        <div className="flex rounded-xl bg-black/20 p-1" role="radiogroup" aria-label="Ready in">
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
                  "h-8 flex-1 rounded-lg text-[13px] font-medium transition-colors duration-150",
                  active ? "bg-cream text-spine shadow-sm" : "text-cream/75 hover:text-cream",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <div className="mt-8 mb-1 flex items-center justify-between px-3">
          <h3 className="text-[11px] font-bold tracking-[0.16em] text-cream-soft uppercase">Tags</h3>
          <button type="button" onClick={onManageTags} className="text-xs font-semibold text-cream-soft hover:text-cream">
            Organize
          </button>
        </div>
        {groups.length > 0 && <p className="px-3 pb-1 text-xs text-cream-soft/80">Click a tag to show only those recipes, again to hide them.</p>}
        {groups.length === 0 && (
          <p className="flex items-start gap-2 px-3 pt-2 text-sm leading-relaxed text-cream-soft">
            <Sprout className="mt-0.5 size-4 shrink-0" />
            {narrowed ? "No tags match these filters." : "Tags appear here as recipes are added."}
          </p>
        )}
        {groups.map(([category, list]) => {
          const open = !collapsed.has(category);
          return (
            <section key={category} className="border-b border-spine-line py-1 last:border-0">
              <button
                type="button"
                onClick={() => toggleCollapsed(category)}
                aria-expanded={open}
                className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-[15px] font-semibold text-cream/90 hover:text-cream"
              >
                <span className="text-cream-soft">{CATEGORY_ICONS[category]}</span>
                <span className="flex-1 text-left">{category}</span>
                <ChevronDown className={cx("size-4 text-cream-soft transition-transform duration-200", !open && "-rotate-90")} />
              </button>
              {open && (
                <div className="flex animate-fade-in flex-wrap gap-1.5 px-2 pt-0.5 pb-3">
                  {list.map((t) => {
                    const selected = filters.tags.includes(t.name);
                    const hidden = filters.excludedTags.includes(t.name);
                    return (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => cycleTag(t.name)}
                        aria-label={hidden ? `${t.name}, hidden` : selected ? `${t.name}, showing only these` : t.name}
                        title={hidden ? "Hidden. Click to stop hiding." : selected ? "Click again to hide these recipes" : undefined}
                        className={cx(
                          "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition-colors duration-150",
                          selected && "bg-cream font-semibold text-spine",
                          hidden && "bg-tomato/30 text-cream/80 line-through decoration-cream/50 ring-1 ring-tomato/70 ring-inset",
                          !selected && !hidden && "bg-white/7 text-cream/90 ring-1 ring-white/8 ring-inset hover:bg-white/14",
                        )}
                      >
                        {hidden && <EyeOff className="size-3.5 shrink-0" />}
                        {t.name}
                        <span className={cx("text-xs tabular-nums", selected ? "text-spine/55" : "text-cream-soft/70")}>{t.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </nav>

      <div className="border-t border-spine-line p-4">
        <button
          type="button"
          onClick={onSettings}
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[15px] text-cream/80 hover:bg-white/8 hover:text-cream"
        >
          <Settings className="size-[18px]" />
          Settings
        </button>
      </div>
    </aside>
  );
}
