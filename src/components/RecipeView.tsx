import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ChefHat, ExternalLink, FileSearch, Heart, Pencil, Printer, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type Checked = { has: (key: string) => boolean; toggle: (key: string) => void };

/** The list she checks off as she gathers things, crossed off the same way wherever it shows. */
function IngredientList({ sections, checked, small }: { sections: Section[]; checked: Checked; small?: boolean }) {
  if (sections.length === 0) return <p className="text-ink-faint">No ingredients listed.</p>;
  return (
    <div className="space-y-5">
      {sections.map((section, si) => (
        // On paper a long list may run onto the next page, between items, never under a group's label.
        <div key={si}>
          {section.heading && (
            <PrintedHeading as="p" faint className={cx("mb-1.5 break-after-avoid", small ? "pt-4" : "pt-[22px]")}>
              {section.heading}
            </PrintedHeading>
          )}
          <ul className="divide-y divide-leaf/12 print:divide-black/15">
            {section.items.map((item, i) => {
              const key = `${si}-${i}`;
              const done = checked.has(key);
              return (
                <li key={key} className="break-inside-avoid">
                  <label className={cx("group flex cursor-pointer items-start gap-3 print:py-1.5", small ? "py-2" : "py-2.5")}>
                    <input type="checkbox" checked={done} onChange={() => checked.toggle(key)} className="peer sr-only" />
                    <span
                      aria-hidden
                      className={cx(
                        "no-print flex size-[18px] shrink-0 items-center justify-center rounded-full ring-[1.5px] transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-leaf",
                        small ? "mt-[2px]" : "mt-[3px]",
                        done ? "bg-leaf ring-leaf" : "ring-ink-faint/60 group-hover:ring-leaf",
                      )}
                    >
                      {done && <span className="size-1.5 rounded-full bg-card" />}
                    </span>
                    <span
                      className={cx(
                        "selectable leading-snug transition-colors duration-200 print:text-[11pt] print:text-ink",
                        small ? "text-[16px]" : "text-[17px]",
                        done ? "text-ink-faint [&_strong]:text-ink-faint" : "text-ink-soft",
                      )}
                    >
                      {/* Crossed off with a pen, the line drawn along the text as it wraps. */}
                      <span data-struck={done || undefined} className="pen-strike">
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
  );
}

function IngredientsHeading({ servings }: { servings: string | null }) {
  return (
    <div className="mb-4 text-center">
      <PrintedHeading centered className="text-[13px]">
        Ingredients
      </PrintedHeading>
      {servings && <p className="mt-1 text-sm text-ink-faint">Serves {servings}</p>}
    </div>
  );
}

/**
 * The ingredients on their own sheet of the same old stock as the card, laid on the tin
 * beside it so they stay in view while she works down the steps. It scrolls on its own
 * when the list is long.
 */
function IngredientsSheet({ sections, servings, checked }: { sections: Section[]; servings: string | null; checked: Checked }) {
  return (
    <div className="card-stock stock-aged flex max-h-full min-h-0 animate-fade-in flex-col text-ink shadow-card">
      <div className="scrollbar-quiet min-h-0 overflow-y-auto px-7 pt-7 pb-8">
        <IngredientsHeading servings={servings} />
        <IngredientList sections={sections} checked={checked} small />
      </div>
    </div>
  );
}

function StepHeading({ children }: { children: string }) {
  return <h3 className="mb-3 font-serif text-[22px] leading-snug font-semibold tracking-tight text-ink">{children}</h3>;
}

function Steps({ sections, tips }: { sections: Section[]; tips: Section[] }) {
  const [current, setCurrent] = useState<string | null>(null);
  let number = 0;
  return (
    <div>
      <PrintedHeading className="mb-7 text-[13px] print:mb-3">Directions</PrintedHeading>
      {sections.length === 0 && <p className="text-ink-faint">No steps listed.</p>}
      <div className="space-y-8 print:space-y-5">
        {sections.map((section, si) => (
          <div key={si}>
            {section.heading && <StepHeading>{section.heading}</StepHeading>}
            <ol className="space-y-1.5">
              {section.items.map((step, i) => {
                number += 1;
                const key = `${si}-${i}`;
                const active = current === key;
                return (
                  // In print, each step is its own formatting context: it sits beside the
                  // floated ingredients at the width left over, or takes the full width
                  // below them. WebKit only does that for a block with auto width and no
                  // negative margins, so the highlight's bleed lives on the button inside.
                  <li key={key} className="print-break-avoid flow-root">
                    <button
                      type="button"
                      onClick={() => setCurrent(active ? null : key)}
                      aria-pressed={active}
                      className={cx(
                        "-mx-5 grid w-[calc(100%+2.5rem)] max-w-[52.5rem] grid-cols-[3rem_minmax(0,1fr)] gap-3 rounded px-5 py-4 text-left transition-colors duration-200 print:mx-0 print:w-full print:grid-cols-[2rem_minmax(0,1fr)] print:gap-2 print:p-0 print:py-1",
                        active ? "bg-umber/9" : "hover:bg-umber/5",
                      )}
                    >
                      <span className="font-serif text-[40px] leading-[0.9] font-medium text-leaf italic tabular-nums print:text-[22pt]">{number}</span>
                      <span className="selectable pt-1 text-[18px] leading-[1.65] text-ink print:pt-0.5 print:text-[11pt] print:leading-normal">{step}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        {/* The recipe's own tips and make-ahead advice: worth reading, but not steps. */}
        {tips.map((section, si) => (
          <div key={`tip-${si}`}>
            <StepHeading>{section.heading || "Notes"}</StepHeading>
            <ul className="space-y-3">
              {section.items.map((tip, i) => (
                <li key={i} className="selectable print-break-avoid flow-root max-w-[50rem] text-[17px] leading-[1.65] text-ink-soft print:text-[11pt] print:leading-normal">
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
    <section className="print-break-avoid mx-auto mt-16 max-w-2xl -rotate-[0.6deg] rounded-[1px] bg-slip px-8 pt-6 pb-7 shadow-photo transition-[rotate,translate] duration-300 ease-paper focus-within:-translate-y-0.5 focus-within:rotate-0 print:mt-8 print:max-w-none print:rotate-0 print:p-0">
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
  sheetSlot,
  alone,
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
  /** Where the ingredients sheet goes, beside the card; without one they stay on the card. */
  sheetSlot: HTMLElement | null;
  /** No sidebar beside the page: the ingredients go on the card, and the header clears the macOS window buttons. */
  alone: boolean;
  onBack: () => void;
  /** Opens the editor, on the page the recipe came from when `page` is set. */
  onEdit: () => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(initial?.id === id ? initial : undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Lifted here so the sheet, the card's copy, and the printout agree.
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const checked: Checked = {
    has: (key) => checkedKeys.has(key),
    toggle: (key) =>
      setCheckedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
  };
  useEffect(() => setCheckedKeys(new Set()), [id]);

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
    <div ref={scrollRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)} className="scrollbar-quiet @container relative h-full overflow-y-auto print:h-auto print:overflow-visible">
      <header
        data-tauri-drag-region
        className={cx(
          "no-print sticky top-0 z-10 flex items-center gap-1 px-8 transition-colors duration-200",
          isMac ? "h-16 pt-2" : "h-16",
          isMac && alone && "pl-24",
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
      <div className="px-6 pt-2 pb-14 @3xl:px-8 print:p-0">
        <article
          style={{ viewTransitionName: "recipe-card" }}
          className="card-stock stock-aged mx-auto max-w-[68rem] animate-fade-in px-9 pt-12 pb-16 shadow-card @3xl:px-14 print:bg-none print:p-0 print:shadow-none"
        >
          <section className="grid items-center gap-14 @4xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] print:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] print:gap-8">
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
              <h1 className="selectable font-hand text-[42px] leading-[1.5] text-balance text-hand-ink print:text-[26pt]">{recipe.title}</h1>
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
            <figure className="mx-auto w-full max-w-md rotate-[1.4deg] rounded-[3px] bg-photo p-3 shadow-photo transition-[rotate] duration-500 ease-paper hover:rotate-0 @4xl:max-w-none print:max-w-none print:rotate-0 print:p-0">
              <div style={{ viewTransitionName: "recipe-photo" }} className="overflow-hidden rounded-[2px]">
                <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[4/3] w-full" />
              </div>
            </figure>
          </section>

          <TagEditor tags={recipe.tags} allTags={allTags.map((t) => t.name)} onChange={setTags} busy={tagging} />

          {sheetSlot &&
            createPortal(<IngredientsSheet sections={ingredients} servings={recipe.servings} checked={checked} />, sheetSlot)}

          {/* On the card when the window's too narrow for the sheet, and always on paper:
              the steps sit beside the list there, then take the full width below it. */}
          <section className="flow-root print:mt-10">
            <div className={cx("mb-12 print:float-left print:mr-8 print:mb-4 print:w-[38%]", !alone && "hidden print:block")}>
              <IngredientsHeading servings={recipe.servings} />
              <IngredientList sections={ingredients} checked={checked} />
            </div>
            <Steps key={recipe.id} sections={steps} tips={bucketSections(recipe.tips)} />
          </section>

          <div className={cx(!recipe.notes.trim() && "print:hidden")}>
            <Notes recipe={recipe} onSave={(notes) => save({ notes })} />
          </div>

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
