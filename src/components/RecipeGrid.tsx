import { Clock, Heart } from "lucide-react";
import { formatMinutes } from "../lib/extract/duration";
import type { RecipeSummary } from "../lib/types";
import { RecipeImage } from "./RecipeImage";
import { cx, Eyebrow } from "./ui";

function FavoriteButton({ recipe, onToggle, className }: { recipe: RecipeSummary; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={recipe.favorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={recipe.favorite}
      className={cx(
        "flex size-10 items-center justify-center rounded-full bg-card/90 shadow-soft backdrop-blur transition duration-150 hover:scale-105",
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

export function RecipeCard({ recipe, onOpen, onToggleFavorite }: { recipe: RecipeSummary; onOpen: () => void; onToggleFavorite: () => void }) {
  return (
    <article className="group relative">
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={recipe.title}>
        <div className="overflow-hidden rounded-2xl bg-paper-deep shadow-soft ring-1 ring-black/5 transition duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-lift">
          <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[4/3] w-full transition duration-500 ease-out group-hover:scale-[1.04]" />
        </div>
        <div className="px-1 pt-3.5">
          {recipe.sourceName && <Eyebrow className="truncate text-[11px]">{recipe.sourceName}</Eyebrow>}
          <h3 className="mt-1.5 line-clamp-2 font-serif text-xl leading-snug font-semibold text-ink">{recipe.title}</h3>
          <div className="mt-1.5">
            <Meta recipe={recipe} />
          </div>
        </div>
      </button>
      <FavoriteButton recipe={recipe} onToggle={onToggleFavorite} className="absolute top-3 right-3" />
    </article>
  );
}

/** The newest recipe, set large like a magazine cover. */
export function FeaturedRecipe({ recipe, onOpen, onToggleFavorite }: { recipe: RecipeSummary; onOpen: () => void; onToggleFavorite: () => void }) {
  return (
    <article className="group relative animate-rise">
      <button
        type="button"
        onClick={onOpen}
        aria-label={recipe.title}
        className="grid w-full overflow-hidden rounded-3xl bg-card text-left shadow-soft ring-1 ring-black/5 transition duration-300 hover:shadow-lift @3xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
      >
        <div className="overflow-hidden">
          <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[16/10] size-full transition duration-700 ease-out group-hover:scale-[1.03]" />
        </div>
        <div className="flex flex-col justify-center gap-4 p-8 @3xl:p-10">
          <p className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.16em] text-tomato uppercase">
            <span className="size-1.5 rounded-full bg-tomato" />
            Just added
          </p>
          <h2 className="font-serif text-4xl leading-[1.08] font-semibold tracking-tight text-balance text-ink">{recipe.title}</h2>
          {recipe.description && <p className="line-clamp-3 text-[16px] leading-relaxed text-ink-soft">{recipe.description}</p>}
          <div className="flex items-center gap-4 pt-1">
            {recipe.sourceName && <Eyebrow className="text-[11px]">{recipe.sourceName}</Eyebrow>}
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
  onOpen,
  onToggleFavorite,
}: {
  recipes: RecipeSummary[];
  onOpen: (id: string) => void;
  onToggleFavorite: (recipe: RecipeSummary) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] gap-x-7 gap-y-10">
      {recipes.map((r) => (
        <RecipeCard key={r.id} recipe={r} onOpen={() => onOpen(r.id)} onToggleFavorite={() => onToggleFavorite(r)} />
      ))}
    </div>
  );
}
