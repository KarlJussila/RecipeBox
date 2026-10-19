import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ChefHat, ExternalLink, Heart, Pencil, Printer, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { formatMinutes } from "../lib/extract/duration";
import { splitAmount } from "../lib/ingredients";
import type { Tag } from "../lib/tags";
import type { Recipe, Section } from "../lib/types";
import { CookingMode } from "./CookingMode";
import { RecipeImage } from "./RecipeImage";
import { TagEditor } from "./TagEditor";
import { Button, cx, Dialog, Eyebrow, IconButton, isMac, Spinner, Sprig } from "./ui";

export function IngredientText({ line }: { line: string }) {
  const [amount, rest] = splitAmount(line);
  return (
    <>
      {amount && <strong className="font-semibold text-ink">{amount}</strong>}
      {rest}
    </>
  );
}

function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 300;
  return (
    <div className="selectable">
      <p className={cx("text-[17px] leading-relaxed whitespace-pre-line text-ink-soft", long && !expanded && "line-clamp-4")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setExpanded(!expanded)} className="no-print mt-1 text-sm font-semibold text-leaf hover:underline">
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function Ornament() {
  return (
    <div className="my-14 flex items-center gap-5 text-leaf/50" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <Sprig className="size-7" />
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Ingredients({ sections, yields }: { sections: Section[]; yields: string | null }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="rounded-3xl bg-card p-7 shadow-soft ring-1 ring-black/5">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b-2 border-tomato/50 pb-3">
        <h2 className="font-serif text-[28px] font-semibold tracking-tight">Ingredients</h2>
        {yields && <span className="text-sm text-ink-faint">{yields}</span>}
      </div>
      {sections.length === 0 && <p className="text-ink-faint">No ingredients listed.</p>}
      <div className="space-y-5">
        {sections.map((section, si) => (
          <div key={si} className="print-break-avoid">
            {section.heading && <Eyebrow className="mb-1 pt-2">{section.heading}</Eyebrow>}
            <ul className="divide-y divide-leaf/12">
              {section.items.map((item, i) => {
                const key = `${si}-${i}`;
                const done = checked.has(key);
                return (
                  <li key={key}>
                    <label className="group flex cursor-pointer items-start gap-3 py-2.5">
                      <input type="checkbox" checked={done} onChange={() => toggle(key)} className="peer sr-only" />
                      <span
                        aria-hidden
                        className={cx(
                          "no-print mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full ring-[1.5px] transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-leaf",
                          done ? "bg-leaf ring-leaf" : "ring-ink-faint/60 group-hover:ring-leaf",
                        )}
                      >
                        {done && <span className="size-1.5 rounded-full bg-card" />}
                      </span>
                      <span className={cx("selectable text-[17px] leading-snug transition-colors", done ? "text-ink-faint line-through decoration-ink-faint/50" : "text-ink-soft")}>
                        <IngredientText line={item} />
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Steps({ sections }: { sections: Section[] }) {
  const [current, setCurrent] = useState<string | null>(null);
  let number = 0;
  return (
    <div>
      <h2 className="mb-6 font-serif text-[28px] font-semibold tracking-tight">Method</h2>
      {sections.length === 0 && <p className="text-ink-faint">No steps listed.</p>}
      <div className="space-y-8">
        {sections.map((section, si) => (
          <div key={si}>
            {section.heading && <Eyebrow className="mb-3">{section.heading}</Eyebrow>}
            <ol className="space-y-1.5">
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
                        "-mx-5 grid w-[calc(100%+2.5rem)] grid-cols-[3rem_minmax(0,1fr)] gap-3 rounded-2xl px-5 py-4 text-left transition-colors duration-200",
                        active ? "bg-butter" : "hover:bg-ink/4",
                      )}
                    >
                      <span className="font-serif text-[40px] leading-[0.9] font-medium text-leaf italic tabular-nums">{number}</span>
                      <span className="selectable pt-1 text-[18px] leading-[1.65] text-ink">{step}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
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
    <section className="print-break-avoid mx-auto mt-16 max-w-2xl -rotate-[0.6deg] rounded-sm bg-butter px-8 pt-6 pb-7 shadow-photo">
      <h2 className="font-serif text-xl font-semibold italic">Kitchen notes</h2>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== recipe.notes && onSave(text)}
        placeholder="What you changed, what you’d do next time, who loved it…"
        rows={3}
        className="mt-2 w-full resize-none bg-transparent font-serif text-[19px] leading-relaxed text-ink italic placeholder:text-ink/40 focus:outline-none"
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
  allTags: Tag[];
  /** True while the AI is choosing tags for this recipe. */
  tagging: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [scrolled, setScrolled] = useState(false);
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
      <div className="flex h-full flex-col items-center justify-center gap-4 text-ink-soft">
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
  const setTags = async (tags: string[], categories?: Record<string, string>) => {
    setRecipe({ ...recipe, tags, needsTags: false });
    await api.setRecipeTags(recipe.id, tags, categories);
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
  const hasSteps = recipe.instructions.some((s) => s.items.length > 0);

  return (
    <div ref={scrollRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)} className="paper-grain scrollbar-quiet @container h-full overflow-y-auto">
      <header
        data-tauri-drag-region
        className={cx(
          "no-print sticky top-0 z-10 flex items-center gap-1 px-8 transition-colors duration-200",
          isMac ? "h-16 pt-2" : "h-16",
          scrolled && "border-b border-line bg-paper/90 backdrop-blur-md",
        )}
      >
        <Button variant="ghost" icon={<ArrowLeft className="size-[18px]" />} onClick={onBack} className="-ml-3">
          All recipes
        </Button>
        <div className="flex-1" data-tauri-drag-region />
        <IconButton label={recipe.favorite ? "Remove from favorites" : "Add to favorites"} onClick={toggleFavorite}>
          <Heart className={cx("size-5", recipe.favorite && "text-tomato")} fill={recipe.favorite ? "currentColor" : "none"} />
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

      <article className="mx-auto max-w-6xl animate-fade-in px-12 pt-4 pb-24">
        <section className="grid items-center gap-14 @4xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          <div className="min-w-0">
            {(recipe.sourceName || recipe.author) && (
              <Eyebrow>
                {recipe.sourceName}
                {recipe.sourceName && recipe.author && <span className="text-ink-faint"> · </span>}
                {recipe.author && <span className="tracking-normal text-ink-faint normal-case">by {recipe.author}</span>}
              </Eyebrow>
            )}
            <h1 className="selectable mt-4 font-serif text-[44px] leading-[1.04] font-semibold tracking-tight text-balance text-ink @4xl:text-[56px]">
              {recipe.title}
            </h1>
            {recipe.description && (
              <div className="mt-6">
                <Description text={recipe.description} />
              </div>
            )}
            {stats.length > 0 && (
              <dl
                className={cx(
                  "mt-8 grid gap-y-4 rounded-2xl bg-leaf-wash py-4 ring-1 ring-leaf-tint",
                  stats.length > 3 ? "grid-cols-2 [&>*:nth-child(odd)]:border-l-0" : "auto-cols-fr grid-flow-col [&>*:first-child]:border-l-0",
                )}
              >
                {stats.map((s) => (
                  <div key={s.label} className="min-w-0 border-l border-leaf-tint px-5">
                    <dt className="text-[11px] font-bold tracking-[0.14em] text-leaf uppercase">{s.label}</dt>
                    <dd className="mt-1 font-serif text-xl leading-tight font-semibold text-ink tabular-nums">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="no-print mt-8 flex flex-wrap items-center gap-4">
              {hasSteps && (
                <Button variant="primary" size="lg" icon={<ChefHat className="size-5" />} onClick={() => setCooking(true)}>
                  Start cooking
                </Button>
              )}
            </div>
            <div className="no-print mt-6 flex items-start gap-3">
              <TagEditor tags={recipe.tags} allTags={allTags.map((t) => t.name)} onChange={setTags} />
              {tagging && (
                <span className="inline-flex h-8 items-center gap-2 text-sm text-ink-faint">
                  <Spinner /> Choosing tags…
                </span>
              )}
            </div>
          </div>

          {/* The photo, pinned like a snapshot tucked into a recipe box. */}
          <figure className="rotate-[1.4deg] rounded-[4px] bg-[#fffdf8] p-3 pb-12 shadow-photo transition-transform duration-500 hover:rotate-0 dark:bg-[#e9e4d6]">
            <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[4/3] w-full rounded-[2px]" />
            {recipe.sourceName && (
              <figcaption className="mt-3 text-center font-serif text-[17px] text-[#5c5f50] italic">from {recipe.sourceName}</figcaption>
            )}
          </figure>
        </section>

        <Ornament />

        <section className="grid gap-14 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div>
            <div className="@4xl:sticky @4xl:top-20">
              <Ingredients key={recipe.id} sections={recipe.ingredients} yields={recipe.yields} />
            </div>
          </div>
          <Steps key={recipe.id} sections={recipe.instructions} />
        </section>

        <Notes recipe={recipe} onSave={(notes) => save({ notes })} />

        {recipe.sourceUrl && (
          <p className="no-print mt-16 text-center text-[15px]">
            <button
              type="button"
              onClick={() => openUrl(recipe.sourceUrl!)}
              className="inline-flex items-center gap-1.5 font-semibold text-leaf hover:underline"
            >
              See the original{recipe.sourceName ? ` on ${recipe.sourceName}` : ""}
              <ExternalLink className="size-3.5" />
            </button>
          </p>
        )}
      </article>

      {cooking && <CookingMode recipe={recipe} onClose={() => setCooking(false)} />}

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
        <p className="text-[16px] leading-relaxed text-ink-soft">
          “{recipe.title}” will be removed from your recipe box, along with your notes. You can always save it again
          from the original website.
        </p>
      </Dialog>
    </div>
  );
}
