import { ArrowLeft, ChevronRight, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { headlineCase } from "../lib/extract/text";
import { CATEGORY_NAMES, OTHER, TAG_CATEGORIES } from "../lib/tags";
import { CATEGORY_ICONS, cx, Spinner } from "./ui";

const CATEGORIES = [...CATEGORY_NAMES, OTHER];
const EXAMPLES: Record<string, string> = {
  ...Object.fromEntries(TAG_CATEGORIES.map((c) => [c.name, c.examples.split(", ").slice(0, 2).join(", ")])),
  [OTHER]: "Anything else",
};

/**
 * One divider tab, outlined. Pointing at it shades it and shows the "×" that removes it,
 * in room kept for it beside the name. Nothing moves or fades: animating a tab repaints
 * the aged card under it every frame, and sweeping the pointer along the tabs doubled
 * the GPU's load.
 */
function Tab({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <div className="group/tab tab-cut relative flex h-[30px] shrink-0 items-start pt-[9px] pr-[28px] pl-[20px] text-[13.5px] leading-none font-semibold whitespace-nowrap text-ink-soft hover:text-ink">
      <span className="relative">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove tag ${name}`}
        title="Remove this tag"
        className="absolute top-[8px] right-[7px] flex size-4 items-center justify-center text-ink-faint opacity-0 group-hover/tab:opacity-100 hover:text-ink focus-visible:opacity-100"
      >
        <X className="size-[9px]" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/**
 * The recipe's tags as the tabs of a divider card standing in the box, with a "+" tab
 * that opens an autocompleting field to add existing or new tags. Creating a tag takes
 * a second step that files it under a category. It also serves as the rule between a
 * recipe's top and its ingredients and steps.
 */
export function TagEditor({
  tags,
  allTags,
  onChange,
  busy,
}: {
  tags: string[];
  allTags: string[];
  /** `categories` holds the category of each newly created tag. */
  onChange: (tags: string[], categories?: Record<string, string>) => void;
  /** Shown while tags are being chosen for the recipe. */
  busy?: boolean;
}) {
  const addRef = useRef<HTMLButtonElement>(null);
  const [menuLeft, setMenuLeft] = useState(0);
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
  useLayoutEffect(() => {
    if (adding && addRef.current) setMenuLeft(addRef.current.offsetLeft);
  }, [adding, tags]);

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
          "flex w-full items-center gap-2 rounded-[3px] px-3 py-1.5 text-left text-sm",
          i === highlight ? "bg-leaf/10 text-leaf-strong" : "text-ink-soft",
        )}
      >
        {content}
      </button>
    </li>
  );

  return (
    // The tags are the tabs of dividers standing behind this one, so its edge runs under
    // them. The "+" is this divider's own tab, so the edge runs up around it instead.
    <div className="no-print relative mt-[58px] mb-14 flex items-end">
      <div className="flex items-end border-b border-umber/42 pl-6">
        {tags.map((t) => (
          <Tab key={t} name={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
        ))}
      </div>
      <button
        ref={addRef}
        type="button"
        onMouseDown={(e) => adding && e.preventDefault()}
        onClick={() => setAdding((a) => !a)}
        aria-expanded={adding}
        aria-label="Add a tag"
        title="Add a tag"
        className={cx(
          "tab-cut relative flex h-[31px] shrink-0 items-start px-[18px] pt-[7px] hover:text-ink",
          adding ? "text-ink" : "text-ink-soft",
        )}
      >
        <Plus className="relative size-4" strokeWidth={2.25} />
      </button>
      <div className="relative h-px min-w-0 flex-1 bg-umber/42">
        {busy && (
          <span className="absolute bottom-2 left-4 inline-flex items-center gap-2 text-sm whitespace-nowrap text-ink-faint">
            <Spinner /> Choosing tags…
          </span>
        )}
      </div>
      {adding && (
        <div
          ref={menuRef}
          style={{ left: menuLeft }}
          className="absolute top-full z-20 mt-2 w-72 animate-pop-in card-stock p-1 shadow-card-lift"
        >
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
            className="h-9 w-full rounded-[3px] bg-field px-3 text-sm text-ink ring-1 ring-line placeholder:text-ink-faint focus:ring-2 focus:ring-leaf focus:outline-none"
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
  );
}
