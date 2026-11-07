import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ChefHat, ChevronDown, ChevronUp, ExternalLink, FileSearch, Heart, Pencil, Printer, Trash2 } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "../lib/api";
import { bucketSections } from "../lib/buckets";
import { formatMinutes } from "../lib/extract/duration";
import { splitAmount } from "../lib/ingredients";
import type { Tag } from "../lib/tags";
import type { Recipe, Section } from "../lib/types";
import { CookingMode } from "./CookingMode";
import { RecipeImage } from "./RecipeImage";
import { TagEditor } from "./TagEditor";
import { Button, cx, Dialog, IconButton, isMac, PrintedHeading } from "./ui";
import { prefersStill } from "../lib/motion";

export function IngredientText({ line }: { line: string }) {
  const [amount, rest] = splitAmount(line);
  return (
    <>
      {amount && <strong className="font-semibold text-ink transition-colors duration-200">{amount}</strong>}
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

const COLLAPSED_KEY = "recipebox.ingredientsCollapsed";

function Ingredients({
  sections,
  servings,
  collapsed,
  onCollapsedChange,
}: {
  sections: Section[];
  servings: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const count = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <>
      {collapsed && (
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          aria-expanded={false}
          className="no-print group flex w-full items-center gap-4 text-left"
        >
          <PrintedHeading className="min-w-0 flex-1 text-[13px]">Ingredients</PrintedHeading>
          <span className="text-[15px] text-ink-faint">
            {count} {count === 1 ? "item" : "items"}
            {servings && ` · Serves ${servings}`}
          </span>
          <span className="inline-flex h-10 items-center gap-2 rounded px-5 text-[15px] font-semibold text-leaf-strong ring-[1.5px] ring-leaf/75 ring-inset transition-[background-color,translate] duration-150 group-hover:bg-leaf/8 group-active:translate-y-px">
            Show ingredients <ChevronDown className="size-4" />
          </span>
        </button>
      )}
      {/* Printing always includes the list, even while it's collapsed on screen. */}
      <div className={cx("pt-1", collapsed && "hidden print:block")}>
        <div className="mb-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <PrintedHeading className="text-[13px]">Ingredients</PrintedHeading>
            {servings && <p className="mt-1 text-sm text-ink-faint">Serves {servings}</p>}
          </div>
          <Button
            size="sm"
            onClick={() => onCollapsedChange(true)}
            aria-expanded
            title="Hide the ingredients so the steps can use the full width"
            className="no-print gap-1 px-3"
          >
            Hide <ChevronUp className="size-4" />
          </Button>
        </div>
        {sections.length === 0 && <p className="text-ink-faint">No ingredients listed.</p>}
        <div className="space-y-5">
          {sections.map((section, si) => (
            <div key={si} className="print-break-avoid">
              {section.heading && (
                <PrintedHeading as="p" faint className="mb-1.5 pt-[22px]">
                  {section.heading}
                </PrintedHeading>
              )}
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
                        <span className={cx("selectable text-[17px] leading-snug transition-colors duration-200", done ? "text-ink-faint [&_strong]:text-ink-faint" : "text-ink-soft")}>
                          {/* Crossed off with a pen, the line drawn along the text as it wraps. */}
                          <span data-struck={done || undefined} className="pen-strike print:bg-none">
                            <IngredientText line={item} />
                          </span>
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
    </>
  );
}

/**
 * Beside the floated ingredients card, a step that would hang mostly below the card
 * clears it and takes the full width instead. Headings move with a section's first step.
 */
function useClearCard(root: RefObject<HTMLDivElement | null>, card: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const steps = root.current;
    const float = card.current;
    if (!steps || !float) return;
    const place = () => {
      const blocks = [...steps.querySelectorAll<HTMLElement>("[data-block]")];
      for (const el of steps.querySelectorAll<HTMLElement>("[data-block], [data-section]")) el.style.clear = "";
      const style = getComputedStyle(float);
      if (style.float === "none") return;
      const edge = float.getBoundingClientRect().bottom;
      const reach = edge + parseFloat(style.marginBottom);
      for (const block of blocks) {
        const r = block.getBoundingClientRect();
        // A section's first step is measured from the section's heading, so a heading
        // beside the card never ends up apart from a step that starts below it.
        const section = block.closest<HTMLElement>("[data-section]");
        const first = section !== null && section.querySelector("[data-block]") === block;
        if ((first ? section.getBoundingClientRect().top : r.top) >= reach) break;
        if (r.bottom - edge > r.height / 2) {
          (first ? section : block).style.clear = "left";
          break;
        }
      }
    };
    const observer = new ResizeObserver(place);
    observer.observe(steps);
    observer.observe(float);
    return () => observer.disconnect();
  }, [root, card]);
}

function StepHeading({ children }: { children: string }) {
  return <h3 className="mb-3 font-serif text-[22px] leading-snug font-semibold tracking-tight text-ink">{children}</h3>;
}

function Steps({ sections, tips, card }: { sections: Section[]; tips: Section[]; card: RefObject<HTMLDivElement | null> }) {
  const [current, setCurrent] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useClearCard(root, card);
  let number = 0;
  return (
    <div ref={root}>
      <PrintedHeading className="mb-7 h-9 text-[13px]">Directions</PrintedHeading>
      {sections.length === 0 && <p className="text-ink-faint">No steps listed.</p>}
      <div className="space-y-8">
        {sections.map((section, si) => (
          <div key={si} data-section>
            {section.heading && <StepHeading>{section.heading}</StepHeading>}
            <ol className="space-y-1.5">
              {section.items.map((step, i) => {
                number += 1;
                const key = `${si}-${i}`;
                const active = current === key;
                return (
                  // The list item sits beside the ingredients and shrinks to the width left
                  // over. WebKit only does that for a block with auto width and no negative
                  // margins, so the highlight's bleed lives on the button inside.
                  <li key={key} data-block className="print-break-avoid flow-root">
                    <button
                      type="button"
                      onClick={() => setCurrent(active ? null : key)}
                      aria-pressed={active}
                      className={cx(
                        "-mx-5 grid w-[calc(100%+2.5rem)] max-w-[52.5rem] grid-cols-[3rem_minmax(0,1fr)] gap-3 rounded px-5 py-4 text-left transition-colors duration-200",
                        active ? "bg-umber/9" : "hover:bg-umber/5",
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
        {/* The recipe's own tips and make-ahead advice: worth reading, but not steps. */}
        {tips.map((section, si) => (
          <div key={`tip-${si}`} data-section>
            <StepHeading>{section.heading || "Notes"}</StepHeading>
            <ul className="space-y-3">
              {section.items.map((tip, i) => (
                <li key={i} data-block className="selectable print-break-avoid flow-root max-w-[50rem] text-[17px] leading-[1.65] text-ink-soft">
                  {tip}
                </li>
              ))}
            </ul>
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
    // Her own notes: a slip tucked in with the card, in her hand. It straightens while she writes.
    <section className="print-break-avoid mx-auto mt-16 max-w-2xl -rotate-[0.6deg] rounded-[1px] bg-slip px-8 pt-6 pb-7 shadow-photo transition-[rotate,translate] duration-300 ease-paper focus-within:-translate-y-0.5 focus-within:rotate-0">
      <h2 className="font-hand text-[17px] text-hand-ink">Kitchen notes</h2>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== recipe.notes && onSave(text)}
        placeholder="What you changed, what you’d do next time, who loved it…"
        rows={3}
        className="mt-2 w-full resize-none bg-transparent font-hand text-[18px] leading-[1.9] text-hand-ink placeholder:text-hand-ink/40 focus:outline-none"
      />
    </section>
  );
}

export function RecipeView({
  id,
  initial,
  refreshKey,
  allTags,
  tagging,
  onBack,
  onEdit,
  onDeleted,
  onChanged,
}: {
  id: string;
  /** The recipe, when it's already been read, so the page can draw at once. */
  initial?: Recipe | null;
  refreshKey: number;
  allTags: Tag[];
  /** True while the AI is choosing tags for this recipe. */
  tagging: boolean;
  onBack: () => void;
  /** Opens the editor, on the page the recipe came from when `page` is set. */
  onEdit: () => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(initial?.id === id ? initial : undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [ingredientsCollapsed, setIngredientsCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "true");
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // The list is lifted off to the left and the steps settle into its room, or it's laid
  // back down. Only opacity and position move, which the compositor animates on its own;
  // a view transition here repainted the whole page for every frame.
  const foldIngredients = async (collapsed: boolean) => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    const card = cardRef.current;
    if (!card || prefersStill()) return setIngredientsCollapsed(collapsed);
    const steps = card.nextElementSibling;
    if (collapsed) {
      await card.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: "-16px 0" }], { duration: 150, easing: "ease-in" }).finished;
    }
    flushSync(() => setIngredientsCollapsed(collapsed));
    const settle = { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" };
    card.animate(collapsed ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: "-16px 0" }, { opacity: 1, translate: "0 0" }], settle);
    steps?.animate([{ opacity: 0.4 }, { opacity: 1 }], settle);
  };

  useEffect(() => {
    let cancelled = false;
    api.getRecipe(id).then((r) => !cancelled && setRecipe(r));
    return () => {
      cancelled = true;
    };
  }, [id, refreshKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [id]);

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
    recipe.servings && { label: "Serves", value: recipe.servings },
  ].filter((s): s is { label: string; value: string } => Boolean(s));
  const ingredients = bucketSections(recipe.ingredients);
  const steps = bucketSections(recipe.instructions);
  const hasSteps = steps.length > 0;

  // `relative` keeps the ingredients' visually hidden checkboxes positioned inside this
  // scroller; otherwise they hang off the page body and the whole window scrolls.
  return (
    <div ref={scrollRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)} className="scrollbar-quiet @container relative h-full overflow-y-auto">
      <header
        data-tauri-drag-region
        className={cx(
          "no-print sticky top-0 z-10 flex items-center gap-1 px-8 transition-colors duration-200",
          isMac ? "h-16 pt-2" : "h-16",
          // Cut from the same sheet as the page, so it doesn't show as a strip.
          scrolled && "paper-sheet border-b border-(--sheet-border) [--sheet-size:100cqw_100vh]",
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

      {/* The card pulled out of the box: one older card holding the whole recipe. */}
      <div className="px-8 pt-2 pb-14 print:p-0">
        <article
          style={{ viewTransitionName: "recipe-card" }}
          className="card-stock stock-aged mx-auto max-w-[68rem] animate-fade-in px-14 pt-12 pb-16 shadow-card print:bg-none print:p-0 print:shadow-none"
        >
          <section className="grid items-center gap-14 @4xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
            <div className="min-w-0">
              {(recipe.sourceName || recipe.author) && (
                // Filled in by hand on the card's printed line.
                <p className="mb-[22px] flex w-[min(100%,26rem)] items-baseline gap-3 border-b border-print-rule pb-0.5">
                  <span className="printed-label shrink-0 text-[11px]">From the kitchen of</span>
                  <span className="selectable truncate font-hand text-[21px] text-hand-ink">
                    {recipe.sourceName}
                    {recipe.author && (recipe.sourceName ? `, by ${recipe.author}` : recipe.author)}
                  </span>
                </p>
              )}
              <h1 className="selectable font-hand text-[42px] leading-[1.5] text-balance text-hand-ink">{recipe.title}</h1>
              {recipe.description && (
                <div className="mt-6">
                  <Description text={recipe.description} />
                </div>
              )}
              {stats.length > 0 && (
                <dl
                  className={cx(
                    // A ruled line across the card.
                    "mt-8 grid gap-y-4 border-y border-umber/18 py-4",
                    stats.length > 3 ? "grid-cols-2 [&>*:nth-child(odd)]:border-l-0 [&>*:nth-child(odd)]:pl-0" : "auto-cols-fr grid-flow-col [&>*:first-child]:border-l-0 [&>*:first-child]:pl-0",
                  )}
                >
                  {stats.map((s) => (
                    <div key={s.label} className="min-w-0 border-l border-umber/14 px-5">
                      <dt className="printed-label after:content-[':']">{s.label}</dt>
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
            </div>

            {/* The photo, a print tucked in with the card: crisp white, just not a light source. */}
            <figure className="mx-auto w-full max-w-md rotate-[1.4deg] rounded-[3px] bg-photo p-3 shadow-photo transition-[rotate] duration-500 ease-paper hover:rotate-0 @4xl:max-w-none">
              <div style={{ viewTransitionName: "recipe-photo" }} className="overflow-hidden rounded-[2px]">
                <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[4/3] w-full" />
              </div>
            </figure>
          </section>

          <TagEditor tags={recipe.tags} allTags={allTags.map((t) => t.name)} onChange={setTags} busy={tagging} />

          {/* Steps sit beside the ingredients, then take the full width below them. Each step
              is its own formatting context, so it never wraps partway around the card. */}
          <section className="flow-root">
            <div
              ref={cardRef}
              className={cx("mb-12", !ingredientsCollapsed && "@4xl:float-left @4xl:mr-14 @4xl:mb-8 @4xl:w-[40%]")}
            >
              <Ingredients
                key={recipe.id}
                sections={ingredients}
                servings={recipe.servings}
                collapsed={ingredientsCollapsed}
                onCollapsedChange={foldIngredients}
              />
            </div>
            <Steps key={recipe.id} sections={steps} tips={bucketSections(recipe.tips)} card={cardRef} />
          </section>

          <Notes recipe={recipe} onSave={(notes) => save({ notes })} />

          {recipe.unused && (
            <div className="no-print mx-auto mt-16 flex max-w-xl flex-col items-center gap-3 border-y border-print-rule px-6 py-[22px] text-center">
              <p className="text-[16px] leading-relaxed text-ink-soft">
                Recipe Box read this recipe from its web page and left a few of its lines out. If a step or ingredient is
                missing or in the wrong place, you can fix it.
              </p>
              <Button icon={<FileSearch className="size-4" />} onClick={onEdit}>
                Fix the recipe
              </Button>
            </div>
          )}

          {recipe.sourceUrl && (
            <p className={cx("no-print text-center text-[15px]", recipe.unused ? "mt-8" : "mt-16")}>
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
      </div>

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
