import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Clock, Heart } from "lucide-react";
import { formatMinutes } from "../lib/extract/duration";
import { LoadPhotos, nearScreen, scrollParent, useNearScreen, type NearScreen } from "../lib/nearScreen";
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
        "flex size-10 items-center justify-center rounded-full bg-card/90 shadow-soft transition duration-150 hover:scale-105 active:scale-95",
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
      <FavoriteButton recipe={recipe} onToggle={onToggleFavorite} className="absolute top-4 left-4 backdrop-blur" />
    </article>
  );
}

/** The narrowest a card gets, and the space around each card, across and down alike. */
const CARD_MIN = 248;
const GAP = 28;

/**
 * Room around each card for its shadow, its lift when pointed at, and its drop when new.
 * The slot around a card clips to its own box (that's what lets the browser skip cards
 * off screen), so it's padded out by this much and pulled back in by the same.
 */
const ROOM = { top: 20, side: 20, bottom: 40 };

/**
 * Each card's measured height, by everything that sets it: the column width, and the
 * parts of the recipe the card shows. Kept between visits, so coming back from a recipe
 * finds every card already sized and the grid doesn't have to lay all of them out again.
 * A height measured before the fonts were in isn't `sure`: the handwriting can wrap a
 * title differently once it arrives.
 */
const cardHeights = new Map<string, { height: number; sure: boolean }>();
const sizeKey = (r: RecipeSummary, column: number) =>
  [column, r.id, r.title, r.sourceName, r.totalMinutes === null, r.image, r.imageAspect].join("|");

/**
 * Holds one card in its column. Once the card's height is sure, the browser skips
 * drawing it while it's off screen, standing in a box of that height, so a box of
 * hundreds of recipes lays out as quickly as a few dozen. Its photo starts loading when
 * the card comes within a screen or so of view.
 *
 * Nothing in a card may get a compositing layer of its own (backdrop-filter, will-change,
 * and the like): WebKitGTK 2.54 can deadlock when layers come and go while the page
 * scrolls on its own thread, and skipping cards makes their layers come and go.
 */
function Slot({
  recipe,
  height,
  near,
  measure,
  children,
}: {
  recipe: RecipeSummary;
  height: number | undefined;
  near: NearScreen;
  measure: ResizeObserver;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const load = useNearScreen(near, ref);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (!el) return;
        measure.observe(el);
        return () => measure.unobserve(el);
      }}
      data-id={recipe.id}
      style={{
        padding: `${ROOM.top}px ${ROOM.side}px ${ROOM.bottom}px`,
        margin: `-${ROOM.top}px -${ROOM.side}px -${ROOM.bottom}px`,
        ...(height !== undefined && { contentVisibility: "auto", containIntrinsicHeight: `${height}px` }),
      }}
    >
      <LoadPhotos value={load}>{children}</LoadPhotos>
    </div>
  );
}

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
  const column = Math.round((width - GAP * (count - 1)) / count);

  const near = useMemo(() => nearScreen(() => scrollParent(ref.current)), []);
  useEffect(() => () => near.stop(), [near]);

  // While the box scrolls, cards passing under the pointer don't lift. Each lift gives the
  // card a compositing layer for a moment, and WebKitGTK can deadlock when layers come and
  // go mid-scroll (see Slot). It also spares the browser restyling cards it's sliding past.
  useEffect(() => {
    const grid = ref.current;
    const scroller = scrollParent(grid);
    if (!grid || !scroller) return;
    let settle = 0;
    const onScroll = () => {
      if (!("scrolling" in grid.dataset)) grid.dataset.scrolling = "";
      clearTimeout(settle);
      settle = window.setTimeout(() => delete grid.dataset.scrolling, 150);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      clearTimeout(settle);
    };
  }, []);

  const byId = useRef(new Map<string, RecipeSummary>());
  byId.current = new Map(recipes.map((r) => [r.id, r]));
  const columnRef = useRef(column);
  columnRef.current = column;
  const [measured, setMeasured] = useState(0);
  const record = useMemo(
    () => (slots: Iterable<Element>) => {
      const sure = document.fonts.status === "loaded";
      let changed = false;
      for (const slot of slots) {
        const recipe = byId.current.get((slot as HTMLElement).dataset.id!);
        if (!recipe) continue;
        const key = sizeKey(recipe, columnRef.current);
        // Exact, not rounded: rounding would leave every card skipped off screen up to half
        // a pixel off, and the cards below would creep as the ones above came into view.
        const height = slot.getBoundingClientRect().height - ROOM.top - ROOM.bottom;
        const known = cardHeights.get(key);
        if (known?.height !== height || known.sure !== sure) {
          cardHeights.set(key, { height, sure });
          changed = true;
        }
      }
      if (changed) setMeasured((m) => m + 1);
    },
    [],
  );
  const measure = useMemo(() => new ResizeObserver((entries) => record(entries.map((e) => e.target))), [record]);
  useEffect(() => () => measure.disconnect(), [measure]);
  // Once the fonts are in, every card is measured again, so it can be skipped while off screen.
  useEffect(() => {
    const again = () => ref.current && record(ref.current.querySelectorAll("[data-id]"));
    document.fonts.addEventListener("loadingdone", again);
    return () => document.fonts.removeEventListener("loadingdone", again);
  }, [record]);

  const columns = useMemo(() => {
    const cols: { recipe: RecipeSummary; height: number | undefined }[][] = Array.from({ length: count }, () => []);
    const tops = new Array<number>(count).fill(0);
    for (const recipe of recipes) {
      const i = tops.indexOf(Math.min(...tops));
      const known = cardHeights.get(sizeKey(recipe, column));
      cols[i].push({ recipe, height: known?.sure ? known.height : undefined });
      // Before a card is measured, it's taken to be about as tall as a card usually is.
      tops[i] += (known?.height ?? 330) + GAP;
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, count, column, measured]);

  return (
    <div ref={ref} data-masonry className="flex items-start" style={{ gap: GAP }}>
      {columns.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
          {col.map(({ recipe: r, height }) => (
            <Slot key={r.id} recipe={r} height={height} near={near} measure={measure}>
              <RecipeCard recipe={r} active={active} onOpen={() => onOpen(r.id)} onToggleFavorite={() => onToggleFavorite(r)} />
            </Slot>
          ))}
        </div>
      ))}
    </div>
  );
}
