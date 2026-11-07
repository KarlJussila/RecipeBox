import { useEffect, useState } from "react";
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
        <div style={turning(recipe, active, "photo")} className="overflow-hidden rounded-[2px] ring-1 ring-[rgb(60_40_20/0.12)]">
          <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[4/3] w-full" />
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
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-x-7 gap-y-10">
      {recipes.map((r) => (
        <RecipeCard key={r.id} recipe={r} active={active} onOpen={() => onOpen(r.id)} onToggleFavorite={() => onToggleFavorite(r)} />
      ))}
    </div>
  );
}
