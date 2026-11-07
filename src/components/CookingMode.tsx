import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Recipe } from "../lib/types";
import { bucketSections } from "../lib/buckets";
import { IngredientText } from "./RecipeView";
import { Button, cx, Eyebrow, IconButton } from "./ui";

/**
 * A distraction-free, one-step-at-a-time view for when the cooking starts:
 * big type, arrow keys or buttons to move, and the screen kept awake.
 */
export function CookingMode({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const steps = bucketSections(recipe.instructions).flatMap((s) => s.items.map((text) => ({ heading: s.heading, text })));
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, steps.length - 1));
      } else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  // Keep the screen on while cooking, where the webview supports it.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release();
  }, []);

  if (!step) return null;

  return (
    <div className="paper-grain fixed inset-0 z-40 flex animate-fade-in bg-paper" role="dialog" aria-modal="true" aria-label={`Cooking ${recipe.title}`}>
      <aside className="scrollbar-quiet flex w-[22rem] shrink-0 flex-col overflow-y-auto border-r border-line bg-card px-7 pt-14 pb-8">
        <Eyebrow>You’ll need</Eyebrow>
        <h2 className="mt-2 font-serif text-2xl leading-tight font-semibold">{recipe.title}</h2>
        <div className="mt-6 space-y-5">
          {bucketSections(recipe.ingredients).map((section, si) => (
            <div key={si}>
              {section.heading && <p className="mb-1 text-sm font-semibold text-ink-faint">{section.heading}</p>}
              <ul className="space-y-1">
                {section.items.map((item, i) => {
                  const key = `${si}-${i}`;
                  const done = checked.has(key);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setChecked((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })}
                        className={cx("w-full rounded-lg px-2 py-1.5 -mx-2 text-left text-[16px] leading-snug hover:bg-ink/4", done ? "text-ink-faint line-through" : "text-ink-soft")}
                      >
                        <IngredientText line={item} />
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

        <div className="flex items-center gap-1.5" aria-hidden>
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              onClick={() => setIndex(i)}
              className={cx("h-1.5 flex-1 rounded-full transition-colors duration-300", i <= index ? "bg-leaf" : "bg-line")}
            />
          ))}
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <div key={index} className="mx-auto w-full max-w-4xl animate-rise">
            <p className="font-serif text-2xl text-leaf italic">
              Step {index + 1} <span className="text-ink-faint">of {steps.length}</span>
              {step.heading && <span className="text-ink-faint"> · {step.heading}</span>}
            </p>
            <p className="selectable mt-6 font-serif text-[clamp(1.75rem,3vw,2.75rem)] leading-[1.35] text-ink">{step.text}</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button size="lg" icon={<ArrowLeft className="size-5" />} onClick={() => setIndex(index - 1)} disabled={index === 0}>
            Back
          </Button>
          {last ? (
            <Button size="lg" variant="primary" onClick={onClose}>
              All done. Enjoy!
            </Button>
          ) : (
            <Button size="lg" variant="primary" onClick={() => setIndex(index + 1)}>
              Next step <ArrowRight className="size-5" />
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
