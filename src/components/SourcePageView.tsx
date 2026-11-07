import { useEffect, useRef, useState } from "react";
import { clean, headingText } from "../lib/page-lines";
import type { HeadedPart, LinePart, SourcePage } from "../lib/source-page";
import type { Section } from "../lib/types";
import { cx } from "./ui";

/** What a line can be made into: a part of the recipe, a heading, the title, or nothing. */
export type LineChoice = LinePart | "heading" | "title" | null;

const PARTS: { part: LinePart | "heading" | null; label: string }[] = [
  { part: "heading", label: "Heading" },
  { part: "ingredient", label: "Ingredient" },
  { part: "step", label: "Step" },
  { part: "tip", label: "Note" },
  { part: "description", label: "Description" },
  { part: null, label: "Not used" },
];

const LOOKS: Record<LinePart, { bar: string; chip: string; label: string }> = {
  ingredient: { bar: "bg-leaf", chip: "bg-leaf-tint text-leaf-strong", label: "Ingredient" },
  step: { bar: "bg-ink-soft", chip: "bg-paper-deep text-ink", label: "Step" },
  tip: { bar: "bg-cream-soft", chip: "bg-butter text-ink", label: "Note" },
  description: { bar: "bg-line", chip: "bg-paper-deep text-ink-soft", label: "Description" },
};

function Chip({ className, children }: { className: string; children: string }) {
  return <span className={cx("rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap", className)}>{children}</span>;
}

/**
 * The page a recipe was read from, a line at a time, each marked with the part of the
 * recipe it became. A heading over two parts, like a part's ingredients and its steps,
 * shows once for each, so either can be unmarked. Choosing a row opens what it can be
 * made into instead.
 */
export function SourcePageView({
  source,
  onChoose,
}: {
  source: SourcePage;
  onChoose: (line: number, choice: LineChoice, heading?: HeadedPart) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const firstRef = useRef<HTMLLIElement>(null);
  // The recipe usually starts well down the page, below the site's menus.
  const first = source.titleLine ?? source.parts.findIndex((p) => p !== null);

  useEffect(() => firstRef.current?.scrollIntoView({ block: "center" }), []);

  return (
    <ol className="space-y-0.5">
      {source.lines.flatMap((line, i) => {
        const part = source.parts[i];
        const isTitle = source.titleLine === i;
        const heads = part ? [] : source.headings.filter((h) => h.line === i).map((h) => h.of);
        const rows: (HeadedPart | undefined)[] = heads.length > 0 ? heads : [undefined];
        return rows.map((heading, row) => {
          const key = `${i}:${heading ?? ""}`;
          const look = heading ?? part;
          const choose = (choice: LineChoice) => {
            onChoose(i, choice, heading);
            setOpen(null);
          };
          return (
            <li key={key} ref={i === first && row === 0 ? firstRef : undefined}>
              <button
                type="button"
                aria-expanded={open === key}
                onClick={() => setOpen(open === key ? null : key)}
                className={cx("flex w-full items-stretch gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-ink/5", open === key && "bg-ink/5")}
              >
                <span aria-hidden="true" className={cx("w-1 shrink-0 rounded-full", look ? LOOKS[look].bar : isTitle ? "bg-ink" : "bg-transparent")} />
                <span
                  className={cx(
                    "min-w-0 flex-1 text-[16px] leading-relaxed [overflow-wrap:anywhere]",
                    (heading || headingText(line) !== null) && "font-semibold",
                    !look && !isTitle && "text-ink-faint",
                  )}
                >
                  {clean(line)}
                </span>
                <span className="flex shrink-0 items-start gap-1.5 pt-0.5">
                  {isTitle && <Chip className="bg-ink text-paper">Title</Chip>}
                  {part && <Chip className={LOOKS[part].chip}>{LOOKS[part].label}</Chip>}
                  {heading && <Chip className={LOOKS[heading].chip}>{`${LOOKS[heading].label} heading`}</Chip>}
                </span>
              </button>
              {row === 0 &&
                source.quotes
                  .filter((q) => q.line === i && part !== "ingredient")
                  .map((q, k) => (
                    <p key={k} className="ml-7 pb-1 text-sm text-leaf-strong">
                      Ingredient from this line: {q.text}
                    </p>
                  ))}
              {open === key && (
                <div role="group" aria-label="What this line is" className="mt-1 mb-3 ml-7 flex flex-wrap gap-2">
                  <ChoiceButton pressed={isTitle} onClick={() => choose("title")}>
                    Title
                  </ChoiceButton>
                  {PARTS.map(({ part: p, label }) => (
                    <ChoiceButton key={label} pressed={heading ? p === "heading" : part === p} onClick={() => choose(p)}>
                      {label}
                    </ChoiceButton>
                  ))}
                </div>
              )}
            </li>
          );
        });
      })}
    </ol>
  );
}

function ChoiceButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "h-9 rounded-full px-4 text-[15px] font-semibold transition-colors",
        pressed ? "bg-leaf text-white dark:text-spine-deep" : "bg-card text-ink ring-1 ring-line hover:bg-paper-deep",
      )}
    >
      {children}
    </button>
  );
}

/** The recipe as it stands, beside the page, so each change shows where it went. */
export function RecipePreview({
  title,
  ingredients,
  steps,
  tips,
  changed,
}: {
  title: string;
  ingredients: Section[];
  steps: Section[];
  tips: Section[];
  /** An item just added from the page, pointed out and scrolled into view. */
  changed: string | null;
}) {
  const changedRef = useRef<HTMLLIElement>(null);
  useEffect(() => changedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [changed]);
  let pointed = false;
  const part = (name: string, sections: Section[], numbered: boolean) =>
    sections.length > 0 && (
      <div className="mt-6">
        <h3 className="text-xs font-bold tracking-[0.14em] text-leaf uppercase">{name}</h3>
        {sections.map((s, k) => {
          const List = numbered ? "ol" : "ul";
          return (
            <div key={k} className="mt-2">
              {s.heading && <p className="mt-3 font-semibold">{s.heading}</p>}
              <List className={cx("space-y-1 pl-5 text-[15px] leading-snug", numbered ? "list-decimal" : "list-disc")}>
                {s.items.map((item, j) => {
                  const point = !pointed && item === changed;
                  pointed ||= point;
                  return (
                    <li key={j} ref={point ? changedRef : undefined} className={cx(point && "-mx-1 rounded bg-butter px-1")}>
                      {item}
                    </li>
                  );
                })}
              </List>
            </div>
          );
        })}
      </div>
    );
  return (
    <div className="rounded-2xl bg-card p-6 shadow-soft ring-1 ring-line">
      <h2 className="font-serif text-2xl font-semibold tracking-tight">{title || "Untitled recipe"}</h2>
      {part("Ingredients", ingredients, false)}
      {part("Steps", steps, true)}
      {part("Notes", tips, false)}
    </div>
  );
}
