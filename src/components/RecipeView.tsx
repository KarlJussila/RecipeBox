import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ExternalLink, Heart, Pencil, Printer, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { formatMinutes } from "../lib/extract/duration";
import type { Recipe, Section } from "../lib/types";
import { RecipeImage } from "./RecipeImage";
import { TagEditor } from "./TagEditor";
import { Button, cx, Dialog, IconButton, Spinner } from "./ui";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-5 first:pl-0 last:pr-0">
      <dt className="text-xs font-semibold tracking-wider text-stone-500 uppercase dark:text-stone-400">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold text-stone-900 tabular-nums dark:text-stone-100">{value}</dd>
    </div>
  );
}

function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 320;
  return (
    <div className="selectable">
      <p
        className={cx(
          "text-[17px] leading-relaxed whitespace-pre-line text-stone-600 dark:text-stone-300",
          long && !expanded && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="no-print mt-1 text-sm font-semibold text-leaf-700 hover:text-leaf-900 dark:text-leaf-400"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function Ingredients({ sections }: { sections: Section[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-6">
      {sections.map((section, si) => (
        <div key={si} className="print-break-avoid">
          {section.heading && (
            <h3 className="mb-2 font-serif text-lg font-semibold text-stone-800 dark:text-stone-200">{section.heading}</h3>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item, i) => {
              const key = `${si}-${i}`;
              const done = checked.has(key);
              return (
                <li key={key}>
                  <label className="group flex gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-stone-100/80 dark:hover:bg-stone-800/50">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => toggle(key)}
                      className="no-print mt-[5px] size-[18px] shrink-0 accent-leaf-700"
                    />
                    <span
                      className={cx(
                        "selectable text-[17px] leading-relaxed transition-colors",
                        done ? "text-stone-400 line-through decoration-stone-300 dark:text-stone-600" : "text-stone-800 dark:text-stone-200",
                      )}
                    >
                      {item}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Instructions({ sections }: { sections: Section[] }) {
  const [current, setCurrent] = useState<string | null>(null);
  let number = 0;
  return (
    <div className="space-y-8">
      {sections.map((section, si) => (
        <div key={si}>
          {section.heading && (
            <h3 className="mb-3 font-serif text-lg font-semibold text-stone-800 dark:text-stone-200">{section.heading}</h3>
          )}
          <ol className="space-y-2">
            {section.items.map((step, i) => {
              number += 1;
              const key = `${si}-${i}`;
              const active = current === key;
              return (
                <li key={key} className="print-break-avoid">
                  <button
                    type="button"
                    onClick={() => setCurrent(active ? null : key)}
                    aria-pressed={active}
                    className={cx(
                      "-mx-4 flex w-[calc(100%+2rem)] gap-4 rounded-xl px-4 py-3 text-left transition-colors duration-150",
                      active ? "bg-leaf-50 ring-1 ring-leaf-200 dark:bg-leaf-950/60 dark:ring-leaf-900" : "hover:bg-stone-100/70 dark:hover:bg-stone-800/40",
                    )}
                  >
                    <span
                      className={cx(
                        "flex size-8 shrink-0 items-center justify-center rounded-full font-serif text-base font-semibold tabular-nums transition-colors",
                        active ? "bg-leaf-700 text-white dark:bg-leaf-600" : "bg-leaf-100 text-leaf-800 dark:bg-leaf-900/60 dark:text-leaf-200",
                      )}
                    >
                      {number}
                    </span>
                    <span className="selectable pt-0.5 text-[17px] leading-relaxed text-stone-800 dark:text-stone-200">{step}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Notes({ recipe, onSave }: { recipe: Recipe; onSave: (notes: string) => void }) {
  const [text, setText] = useState(recipe.notes);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(recipe.notes), [recipe.id, recipe.notes]);
  // Grow with the content so notes never scroll inside a tiny box.
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    }
  }, [text]);

  return (
    <section className="mt-14 print-break-avoid">
      <h2 className="font-serif text-2xl font-semibold tracking-tight">Notes</h2>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== recipe.notes && onSave(text)}
        placeholder="Add your own notes, like changes you made or who loved it…"
        rows={3}
        className="mt-3 w-full resize-none rounded-xl bg-amber-50/60 px-5 py-4 text-[17px] leading-relaxed text-stone-800 ring-1 ring-amber-200/70 placeholder:text-stone-400 focus:ring-2 focus:ring-leaf-600 focus:outline-none dark:bg-stone-900 dark:text-stone-200 dark:ring-stone-700"
      />
    </section>
  );
}

export function RecipeView({
  id,
  refreshKey,
  allTags,
  tagging,
  onBack,
  onEdit,
  onDeleted,
  onChanged,
}: {
  id: string;
  refreshKey: number;
  allTags: string[];
  /** True while the LLM is choosing tags for this recipe. */
  tagging: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.getRecipe(id).then((r) => !cancelled && setRecipe(r));
    return () => {
      cancelled = true;
    };
  }, [id, refreshKey]);

  useEffect(() => scrollRef.current?.scrollTo(0, 0), [id]);

  if (recipe === undefined) return null;
  if (recipe === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-stone-500">
        <p>This recipe no longer exists.</p>
        <Button onClick={onBack}>Back to recipes</Button>
      </div>
    );
  }

  const save = async (patch: Partial<Recipe>) => {
    const saved = await api.saveRecipe({ ...recipe, ...patch });
    setRecipe(saved);
    onChanged();
  };
  const setTags = async (tags: string[]) => {
    setRecipe({ ...recipe, tags, needsTags: false });
    await api.setRecipeTags(recipe.id, tags);
    onChanged();
  };
  const toggleFavorite = async () => {
    setRecipe({ ...recipe, favorite: !recipe.favorite });
    await api.setFavorite(recipe.id, !recipe.favorite);
    onChanged();
  };

  const stats = [
    recipe.prepMinutes !== null && { label: "Prep", value: formatMinutes(recipe.prepMinutes) },
    recipe.cookMinutes !== null && { label: "Cook", value: formatMinutes(recipe.cookMinutes) },
    recipe.totalMinutes !== null && { label: "Total", value: formatMinutes(recipe.totalMinutes) },
    recipe.yields && { label: "Makes", value: recipe.yields.replace(/^(makes|serves|yield:?)\s+/i, "") },
  ].filter((s): s is { label: string; value: string } => Boolean(s));

  return (
    <div ref={scrollRef} className="scrollbar-quiet @container h-full overflow-y-auto">
      <header
        data-tauri-drag-region
        className="no-print sticky top-0 z-10 flex h-16 items-center gap-2 border-b border-transparent bg-stone-50/85 px-6 backdrop-blur-md dark:bg-stone-950/85"
      >
        <Button variant="ghost" icon={<ArrowLeft className="size-[18px]" />} onClick={onBack} className="-ml-2">
          Recipes
        </Button>
        <div className="flex-1" data-tauri-drag-region />
        <IconButton label={recipe.favorite ? "Remove from favorites" : "Add to favorites"} active={recipe.favorite} onClick={toggleFavorite}>
          <Heart className={cx("size-5", recipe.favorite && "text-rose-600")} fill={recipe.favorite ? "currentColor" : "none"} />
        </IconButton>
        <IconButton label="Print" onClick={() => window.print()}>
          <Printer className="size-5" />
        </IconButton>
        <IconButton label="Delete recipe" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-5" />
        </IconButton>
        <Button icon={<Pencil className="size-4" />} onClick={onEdit} className="ml-2">
          Edit
        </Button>
      </header>

      <article className="mx-auto max-w-6xl animate-fade-in px-10 pt-4 pb-24">
        <section className="grid items-center gap-10 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <RecipeImage
            file={recipe.image}
            title={recipe.title}
            className="aspect-[4/3] w-full rounded-2xl shadow-lift ring-1 ring-stone-900/5 @4xl:order-none"
          />
          <div className="min-w-0">
            {(recipe.sourceName || recipe.author) && (
              <p className="text-sm font-semibold tracking-wide text-leaf-700 uppercase dark:text-leaf-400">
                {recipe.sourceName}
                {recipe.sourceName && recipe.author && <span className="text-stone-400"> · </span>}
                {recipe.author && <span className="normal-case tracking-normal text-stone-500 dark:text-stone-400">By {recipe.author}</span>}
              </p>
            )}
            <h1 className="selectable mt-3 font-serif text-4xl leading-[1.1] font-semibold tracking-tight text-balance text-stone-900 @4xl:text-5xl dark:text-stone-50">
              {recipe.title}
            </h1>
            {recipe.description && (
              <div className="mt-5">
                <Description text={recipe.description} />
              </div>
            )}
            {stats.length > 0 && (
              <dl className="mt-7 flex divide-x divide-stone-200 border-y border-stone-200 py-4 dark:divide-stone-800 dark:border-stone-800">
                {stats.map((s) => (
                  <Stat key={s.label} {...s} />
                ))}
              </dl>
            )}
            <div className="no-print mt-6 flex items-start gap-3">
              <TagEditor tags={recipe.tags} allTags={allTags} onChange={setTags} />
              {tagging && (
                <span className="inline-flex h-7 items-center gap-2 text-sm text-stone-500">
                  <Spinner /> Choosing tags…
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="mt-14 grid gap-12 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <div className="@4xl:sticky @4xl:top-20">
              <h2 className="mb-5 font-serif text-2xl font-semibold tracking-tight">Ingredients</h2>
              {recipe.ingredients.length > 0 ? (
                <Ingredients key={recipe.id} sections={recipe.ingredients} />
              ) : (
                <p className="text-stone-500">No ingredients listed.</p>
              )}
            </div>
          </div>
          <div>
            <h2 className="mb-5 font-serif text-2xl font-semibold tracking-tight">Steps</h2>
            {recipe.instructions.length > 0 ? (
              <Instructions key={recipe.id} sections={recipe.instructions} />
            ) : (
              <p className="text-stone-500">No steps listed.</p>
            )}
          </div>
        </section>

        <Notes recipe={recipe} onSave={(notes) => save({ notes })} />

        {recipe.sourceUrl && (
          <p className="no-print mt-10 border-t border-stone-200 pt-6 text-[15px] text-stone-500 dark:border-stone-800">
            <button
              type="button"
              onClick={() => openUrl(recipe.sourceUrl!)}
              className="inline-flex items-center gap-1.5 font-medium text-leaf-700 hover:text-leaf-900 hover:underline dark:text-leaf-400"
            >
              View the original{recipe.sourceName ? ` on ${recipe.sourceName}` : ""}
              <ExternalLink className="size-3.5" />
            </button>
          </p>
        )}
      </article>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this recipe?"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await api.deleteRecipe(recipe.id);
                setConfirmDelete(false);
                onDeleted();
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[15px] leading-relaxed text-stone-600 dark:text-stone-300">
          “{recipe.title}” will be removed from your recipe box, along with your notes. You can always import it
          again from the original website.
        </p>
      </Dialog>
    </div>
  );
}
