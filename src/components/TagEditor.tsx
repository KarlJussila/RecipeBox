import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { headlineCase } from "../lib/extract/text";
import { CATEGORY_NAMES, OTHER, TAG_CATEGORIES } from "../lib/tags";
import { CATEGORY_ICONS, cx, TagPill } from "./ui";

const CATEGORIES = [...CATEGORY_NAMES, OTHER];
const EXAMPLES: Record<string, string> = {
  ...Object.fromEntries(TAG_CATEGORIES.map((c) => [c.name, c.examples.split(", ").slice(0, 2).join(", ")])),
  [OTHER]: "Anything else",
};

/**
 * Tag chips with removal, plus an autocompleting field to add existing or new
 * tags. Creating a tag takes a second step that files it under a category.
 */
export function TagEditor({
  tags,
  allTags,
  onChange,
}: {
  tags: string[];
  allTags: string[];
  /** `categories` holds the category of each newly created tag. */
  onChange: (tags: string[], categories?: Record<string, string>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  /** The new tag being filed under a category, once "New tag" is chosen. */
  const [filing, setFiling] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const has = (name: string) => tags.some((t) => t.toLowerCase() === name.toLowerCase());
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    const available = allTags.filter((t) => !has(t));
    const matches = q ? available.filter((t) => t.toLowerCase().includes(q)) : available;
    // Prefix matches first.
    // A short list: typing narrows it faster than scrolling would.
    return matches.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q))).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, allTags, tags]);
  const exact = allTags.find((t) => t.toLowerCase() === text.trim().toLowerCase());
  // New tags are title-cased: "christmas eve" becomes "Christmas Eve".
  const newName = headlineCase(text.trim().replace(/\s+/g, " "));
  const canCreate = newName !== "" && !exact && !has(newName);
  const rowCount = filing ? CATEGORIES.length : suggestions.length + Number(canCreate);

  // The page shouldn't scroll underneath the open menu.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    menu.addEventListener("wheel", stop, { passive: false });
    return () => menu.removeEventListener("wheel", stop);
  }, [adding]);

  const add = (name: string, category?: string) => {
    const existing = allTags.find((t) => t.toLowerCase() === name.toLowerCase());
    const tag = existing ?? name.trim();
    if (tag && !has(tag)) {
      onChange([...tags, tag], existing || !category || category === OTHER ? undefined : { [tag]: category });
    }
    setText("");
    setFiling(null);
    setHighlight(0);
    inputRef.current?.focus();
  };

  const choose = (i: number) => {
    if (filing) add(filing, CATEGORIES[i]);
    else if (i < suggestions.length) add(suggestions[i]);
    else {
      setFiling(newName);
      // Other unless she picks something, so a hurried Enter never misfiles a tag.
      setHighlight(CATEGORIES.length - 1);
    }
  };

  const row = (i: number, content: ReactNode, className?: string) => (
    <li key={i} role="option" aria-selected={i === highlight} className={className}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(i)}
        onMouseEnter={() => setHighlight(i)}
        className={cx(
          "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm",
          i === highlight ? "bg-leaf-wash text-leaf-strong" : "text-ink-soft",
        )}
      >
        {content}
      </button>
    </li>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <TagPill key={t} name={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
      ))}
      {/* The button stays put and the field opens below it, so nothing in the row moves. */}
      <div className="relative">
        <button
          type="button"
          onMouseDown={(e) => adding && e.preventDefault()}
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
          className={cx(
            "inline-flex h-8 items-center gap-1 rounded-full border border-dashed px-3.5 text-sm font-medium hover:border-leaf hover:bg-card hover:text-leaf-strong",
            adding ? "border-leaf bg-card text-leaf-strong" : "border-ink-faint/50 text-ink-soft",
          )}
        >
          <Plus className="size-3.5" />
          Add tag
        </button>
        {adding && (
          <div ref={menuRef} className="absolute top-full left-0 z-20 mt-1.5 w-72 animate-fade-in rounded-xl bg-card p-1 shadow-lift ring-1 ring-line">
            <input
              ref={inputRef}
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFiling(null);
                setHighlight(0);
              }}
              onBlur={() => window.setTimeout(() => setAdding(false), 120)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && highlight < rowCount) {
                  e.preventDefault();
                  choose(highlight);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, rowCount - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  if (filing) {
                    setFiling(null);
                    setHighlight(suggestions.length);
                  } else setAdding(false);
                }
              }}
              placeholder="Find or create a tag"
              aria-label="Add a tag"
              className="h-9 w-full rounded-lg bg-paper px-3 text-sm text-ink ring-1 ring-line placeholder:text-ink-faint focus:ring-2 focus:ring-leaf focus:outline-none"
            />
            {filing ? (
              <>
                <div className="flex items-center gap-1 px-1.5 pt-2 pb-1 text-xs text-ink-faint">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setFiling(null);
                      setHighlight(suggestions.length);
                    }}
                    aria-label="Back"
                    className="flex size-5 items-center justify-center rounded-full hover:bg-paper-deep hover:text-ink"
                  >
                    <ArrowLeft className="size-3.5" />
                  </button>
                  File “{filing}” under
                </div>
                <ul role="listbox" aria-label={`Category for ${filing}`}>
                  {CATEGORIES.map((c, i) =>
                    row(
                      i,
                      <>
                        <span className={i === highlight ? "text-leaf" : "text-ink-faint"}>{CATEGORY_ICONS[c]}</span>
                        <span className="font-medium">{c}</span>
                        <span className="ml-auto truncate pl-2 text-xs text-ink-faint">{EXAMPLES[c]}</span>
                      </>,
                      c === OTHER ? "mt-1 border-t border-line pt-1" : undefined,
                    ),
                  )}
                </ul>
              </>
            ) : (
              rowCount > 0 && (
                <ul role="listbox" className="mt-1">
                  {suggestions.map((t, i) => row(i, t))}
                  {canCreate &&
                    row(
                      suggestions.length,
                      <>
                        <Plus className="size-3.5 shrink-0" />
                        <span className="truncate">New tag “{newName}”</span>
                        <ChevronRight className="ml-auto size-4 shrink-0" />
                      </>,
                    )}
                </ul>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
