import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect } from "react";
import type { Recipe } from "../lib/types";
import { bucketSections } from "../lib/buckets";
import { IngredientText, type Checked } from "./RecipeView";
import { Button, cx, Eyebrow, IconButton, PrintedHeading } from "./ui";

/**
 * A distraction-free, one-step-at-a-time view for when the cooking starts:
 * big type, arrow keys or buttons to move, and the screen kept awake. The step she's on and
 * what she's crossed off belong to the recipe page, so she can go back and forth freely.
 */
export function CookingMode({
  recipe,
  checked,
  step: wanted,
  onStep,
  onClose,
}: {
  recipe: Recipe;
  checked: Checked;
  /** The step she's on, counted across the whole recipe. */
  step: number;
  onStep: (step: number) => void;
  onClose: () => void;
}) {
  // Each heading's steps are a part, numbered on their own, like on the page.
  const parts = bucketSections(recipe.instructions).filter((s) => s.items.length > 0);
  const steps = parts.flatMap((s) => s.items.map((text, i) => ({ heading: s.heading, text, number: i + 1, of: s.items.length })));
  const sectioned = parts.length > 1;
  const index = Math.max(0, Math.min(wanted, steps.length - 1));
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        onStep(Math.min(index + 1, steps.length - 1));
      } else if (e.key === "ArrowLeft") onStep(Math.max(index - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep, index, steps.length]);

  // Keep the screen on while cooking, where the webview supports it.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release();
  }, []);

  if (!step) return null;

  return (
    // The card propped up on the counter: the list on a plain card beside the step in hand.
    <div className="paper-sheet fixed inset-0 z-40 flex animate-fade-in" role="dialog" aria-modal="true" aria-label={`Cooking ${recipe.title}`}>
      <aside className="card-stock scrollbar-quiet z-[1] flex w-[22rem] shrink-0 flex-col overflow-y-auto rounded-none px-7 pt-14 pb-8 shadow-card">
        <Eyebrow>You’ll need</Eyebrow>
        <h2 className="mt-2 font-hand text-[26px] leading-[1.5] text-hand-ink">{recipe.title}</h2>
        <div className="mt-6 space-y-5">
          {bucketSections(recipe.ingredients).map((section, si) => (
            <div key={si}>
              {section.heading && (
                <PrintedHeading as="p" faint className="mb-1 pt-2">
                  {section.heading}
                </PrintedHeading>
              )}
              <ul className="space-y-1">
                {section.items.map((item, i) => {
                  const key = `${si}-${i}`;
                  const done = checked.has(key);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => checked.toggle(key)}
                        className={cx("-mx-2 w-full rounded-[3px] px-2 py-1.5 text-left text-[16px] leading-snug transition-colors duration-200 hover:bg-umber/5", done ? "text-ink-faint" : "text-ink-soft")}
                      >
                        <span data-struck={done || undefined} className="pen-strike">
                          <IngredientText line={item} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col px-16 pt-14 pb-10">
        <IconButton label="Done cooking" onClick={onClose} className="absolute top-5 right-5">
          <X className="size-6" />
        </IconButton>

        {/* The way through, a segment for each part; pointed at, each part's name fades in
            above it. Each step's mark is thin, but the whole height around it takes a click. */}
        <div className="group/track flex gap-5" aria-hidden>
          {parts.map((part, pi) => {
            const first = parts.slice(0, pi).reduce((n, p) => n + p.items.length, 0);
            return (
              <div key={pi} className="min-w-0" style={{ flex: `${part.items.length} 1 0` }}>
                {sectioned && (
                  // Two lines' room, so a long name over a short part wraps rather than trails off.
                  <div className="flex h-[30px] items-end pb-0.5 opacity-0 transition-opacity duration-200 group-hover/track:opacity-100">
                    <p className="line-clamp-2 printed-label text-[10.5px] tracking-[0.18em]">{part.heading}</p>
                  </div>
                )}
                <div className="flex">
                  {part.items.map((_, i) => {
                    const n = first + i;
                    return (
                      <button key={i} type="button" tabIndex={-1} onClick={() => onStep(n)} className="group/tick flex h-7 flex-1 items-center px-[3px]">
                        <span
                          className={cx(
                            "h-1.5 w-full rounded-full transition-colors duration-300",
                            n <= index ? "bg-leaf group-hover/tick:bg-leaf-strong" : "bg-line group-hover/tick:bg-ink-faint/45",
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <div key={index} className="mx-auto w-full max-w-4xl animate-rise">
            <p className="font-serif text-2xl text-leaf italic">
              {sectioned && step.heading && <span className="text-ink-soft">{step.heading} · </span>}
              Step {step.number} <span className="text-ink-faint">of {step.of}</span>
            </p>
            <p className="selectable mt-6 font-serif text-[clamp(1.75rem,3vw,2.75rem)] leading-[1.35] text-ink">{step.text}</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button size="lg" icon={<ArrowLeft className="size-5" />} onClick={() => onStep(index - 1)} disabled={index === 0}>
            Back
          </Button>
          {last ? (
            <Button size="lg" variant="primary" onClick={onClose}>
              All done. Enjoy!
            </Button>
          ) : (
            <Button size="lg" variant="primary" onClick={() => onStep(index + 1)}>
              Next step <ArrowRight className="size-5" />
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
