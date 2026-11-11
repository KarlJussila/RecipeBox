import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Clock, Heart } from "lucide-react";
import { formatMinutes } from "../lib/extract/duration";
import type { RecipeSummary } from "../lib/types";
import { RecipeImage } from "./RecipeImage";
import { cx, Eyebrow } from "./ui";

/** Recipes added in the last few minutes are set down into the box once, the first time they're shown. */
const settled = new Set<string>();
function useArriving(recipe: RecipeSummary): boolean {
  const [arriving] = useState(() => !settled.has(recipe.id) && Date.now() - Date.parse(recipe.createdAt) < 10 * 60 * 1000);
  useEffect(() => void settled.add(recipe.id), [recipe.id]);
  return arriving;
}

/** Names the card that turns into the recipe page, and its photo, for the page-turn. */
function turning(recipe: RecipeSummary, active: string | null | undefined, part: "card" | "photo") {
  return recipe.id === active ? { viewTransitionName: `recipe-${part}` } : undefined;
}

function FavoriteButton({ recipe, onToggle, className }: { recipe: RecipeSummary; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={recipe.favorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={recipe.favorite}
      className={cx(
        "flex size-10 items-center justify-center rounded-full bg-card/90 shadow-soft backdrop-blur transition duration-150 hover:scale-105 active:scale-95",
        recipe.favorite ? "text-tomato" : "text-ink-soft opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        className,
      )}
    >
      <Heart className="size-[19px]" fill={recipe.favorite ? "currentColor" : "none"} strokeWidth={2} />
    </button>
  );
}

function Meta({ recipe }: { recipe: RecipeSummary }) {
  if (recipe.totalMinutes === null) return null;
  return (
    <p className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-faint tabular-nums">
      <Clock className="size-3.5" />
      {formatMinutes(recipe.totalMinutes)}
    </p>
  );
}

/**
 * A card's photo keeps its own shape, so the cards fall at different heights, but one much
 * taller than 5:7 is trimmed so it doesn't run the length of the column. A missing photo
 * gets the usual 4:3 patch.
 */
function photoShape(recipe: RecipeSummary): string {
  const aspect = recipe.image && recipe.imageAspect ? Math.min(Math.max(recipe.imageAspect, 9 / 16), 7 / 5) : 3 / 4;
  return `1 / ${aspect}`;
}

/**
 * Each recipe is an index card in the box. Pointed at, it lifts and tips a little as if
 * drawn out by a corner; pressed, it settles back down.
 */
const HANDLED =
  "transition-[translate,rotate,box-shadow] duration-300 ease-paper hover:-translate-y-[3px] hover:-rotate-[0.5deg] hover:shadow-card-lift active:translate-y-0 active:rotate-0 active:shadow-card-press active:duration-100";

export function RecipeCard({
  recipe,
  active,
  onOpen,
  onToggleFavorite,
}: {
  recipe: RecipeSummary;
  /** The recipe last opened, which the page-turn returns to. */
  active?: string | null;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const arriving = useArriving(recipe);
  return (
    <article className={cx("group relative", arriving && "animate-drop-in")}>
      <button
        type="button"
        onClick={onOpen}
        style={turning(recipe, active, "card")}
        className={cx("card-stock block w-full px-3 pt-3 pb-4 text-left shadow-card", HANDLED)}
        aria-label={recipe.title}
      >
        <div
          style={{ aspectRatio: photoShape(recipe), ...turning(recipe, active, "photo") }}
          className="overflow-hidden rounded-[2px] ring-1 ring-[rgb(60_40_20/0.12)]"
        >
          <RecipeImage file={recipe.image} title={recipe.title} card className="size-full" />
        </div>
        <div className="px-1.5 pt-3.5">
          {recipe.sourceName && <Eyebrow className="truncate">{recipe.sourceName}</Eyebrow>}
          <h3 className="mt-1.5 line-clamp-2 font-hand text-[17px] leading-[1.7] text-hand-ink">{recipe.title}</h3>
          <div className="mt-1">
            <Meta recipe={recipe} />
          </div>
        </div>
      </button>
      <FavoriteButton recipe={recipe} onToggle={onToggleFavorite} className="absolute top-3 right-3" />
    </article>
  );
}

/** The newest recipe, set large like a magazine cover. */
export function FeaturedRecipe({
  recipe,
  active,
  onOpen,
  onToggleFavorite,
}: {
  recipe: RecipeSummary;
  active?: string | null;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const arriving = useArriving(recipe);
  return (
    <article className={cx("group relative", arriving ? "animate-drop-in" : "animate-rise")}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={recipe.title}
        style={turning(recipe, active, "card")}
        className="card-stock grid w-full p-4 text-left shadow-card transition-[translate,box-shadow] duration-300 ease-paper hover:-translate-y-[2px] hover:shadow-card-lift active:translate-y-0 active:shadow-card-press active:duration-100 @3xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
      >
        <div style={turning(recipe, active, "photo")} className="overflow-hidden rounded-[2px] ring-1 ring-[rgb(60_40_20/0.12)]">
          <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[16/10] size-full" />
        </div>
        <div className="flex flex-col justify-center gap-4 p-8 @3xl:p-10">
          <p className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.16em] text-tomato uppercase">
            <span className="size-1.5 rounded-full bg-tomato" />
            Just added
          </p>
          <h2 className="font-hand text-[30px] leading-[1.6] text-balance text-hand-ink">{recipe.title}</h2>
          {recipe.description && <p className="line-clamp-3 text-[16px] leading-relaxed text-ink-soft">{recipe.description}</p>}
          <div className="flex items-center gap-4 pt-1">
            {recipe.sourceName && <Eyebrow>{recipe.sourceName}</Eyebrow>}
            <Meta recipe={recipe} />
          </div>
        </div>
      </button>
      <FavoriteButton recipe={recipe} onToggle={onToggleFavorite} className="absolute top-4 left-4" />
    </article>
  );
}

/** The narrowest a card gets, and the space around each card, across and down alike. */
const CARD_MIN = 248;
const GAP = 28;

/**
 * The cards laid out like a spread of index cards: in columns, each card dropped into
 * whichever column is shortest so far, so the space between cards is the same every way
 * while their tops don't line up in rows. Each card's height is measured as it renders.
 */
export function RecipeGrid({
  recipes,
  active,
  onOpen,
  onToggleFavorite,
}: {
  recipes: RecipeSummary[];
  active?: string | null;
  onOpen: (id: string) => void;
  onToggleFavorite: (recipe: RecipeSummary) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const count = Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP)));

  const heights = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const observer = useMemo(
    () =>
      new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.id!;
          const height = (entry.target as HTMLElement).offsetHeight;
          if (heights.current.get(id) !== height) {
            heights.current.set(id, height);
            changed = true;
          }
        }
        if (changed) setMeasured((m) => m + 1);
      }),
    [],
  );
  useEffect(() => () => observer.disconnect(), [observer]);

  const columns = useMemo(() => {
    const cols: RecipeSummary[][] = Array.from({ length: count }, () => []);
    const tops = new Array<number>(count).fill(0);
    for (const r of recipes) {
      const i = tops.indexOf(Math.min(...tops));
      cols[i].push(r);
      // Before a card is measured, it's taken to be about as tall as a card usually is.
      tops[i] += (heights.current.get(r.id) ?? 330) + GAP;
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, count, measured]);

  return (
    <div ref={ref} data-masonry className="flex items-start" style={{ gap: GAP }}>
      {columns.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
          {col.map((r) => (
            <div
              key={r.id}
              data-id={r.id}
              ref={(el) => {
                if (!el) return;
                observer.observe(el);
                return () => observer.unobserve(el);
              }}
            >
              <RecipeCard recipe={r} active={active} onOpen={() => onOpen(r.id)} onToggleFavorite={() => onToggleFavorite(r)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
