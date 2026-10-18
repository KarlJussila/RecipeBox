import { Clock, Heart } from "lucide-react";
import { formatMinutes } from "../lib/extract/duration";
import type { RecipeSummary } from "../lib/types";
import { RecipeImage } from "./RecipeImage";
import { cx } from "./ui";

function RecipeCard({
  recipe,
  onOpen,
  onToggleFavorite,
}: {
  recipe: RecipeSummary;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-card ring-1 ring-stone-200/70 transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift dark:bg-stone-900 dark:ring-stone-800">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left" aria-label={recipe.title}>
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-stone-100 dark:bg-stone-800">
          <RecipeImage
            file={recipe.image}
            title={recipe.title}
            className="size-full transition duration-300 ease-out group-hover:scale-[1.03]"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2 px-4 pt-3 pb-4">
          {recipe.sourceName && (
            <p className="truncate text-xs font-semibold tracking-wide text-leaf-700 uppercase dark:text-leaf-400">
              {recipe.sourceName}
            </p>
          )}
          <h3 className="line-clamp-2 font-serif text-lg leading-snug font-semibold text-stone-900 dark:text-stone-50">
            {recipe.title}
          </h3>
          {recipe.totalMinutes !== null && (
            <p className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm whitespace-nowrap text-stone-500 tabular-nums dark:text-stone-400">
              <Clock className="size-3.5" />
              {formatMinutes(recipe.totalMinutes)}
            </p>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label={recipe.favorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={recipe.favorite}
        className={cx(
          "absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition duration-150 hover:scale-105 dark:bg-stone-900/80",
          recipe.favorite ? "text-rose-600" : "text-stone-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Heart className="size-[18px]" fill={recipe.favorite ? "currentColor" : "none"} />
      </button>
    </article>
  );
}

export function RecipeGrid({
  recipes,
  onOpen,
  onToggleFavorite,
}: {
  recipes: RecipeSummary[];
  onOpen: (id: string) => void;
  onToggleFavorite: (recipe: RecipeSummary) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
      {recipes.map((r) => (
        <RecipeCard key={r.id} recipe={r} onOpen={() => onOpen(r.id)} onToggleFavorite={() => onToggleFavorite(r)} />
      ))}
    </div>
  );
}
