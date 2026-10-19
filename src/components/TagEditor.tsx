import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { CATEGORY_NAMES, OTHER } from "../lib/tags";
import { cx, TagPill } from "./ui";

/**
 * Tag chips with removal, plus an autocompleting field to add existing or new
 * tags. A new tag is filed under a category chosen as it's created.
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
  // The AI fills in the other categories, so occasions are what people add most.
  const [newCategory, setNewCategory] = useState<string>("Occasion");
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const has = (name: string) => tags.some((t) => t.toLowerCase() === name.toLowerCase());
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    const available = allTags.filter((t) => !has(t));
    const matches = q ? available.filter((t) => t.toLowerCase().includes(q)) : available;
    // Prefix matches first.
    return matches.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q))).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, allTags, tags]);
  const exact = allTags.find((t) => t.toLowerCase() === text.trim().toLowerCase());
  const canCreate = text.trim() !== "" && !exact && !has(text.trim());
  const options = [...suggestions, ...(canCreate ? [text.trim()] : [])];

  const add = (name: string) => {
    const existing = allTags.find((t) => t.toLowerCase() === name.toLowerCase());
    const tag = existing ?? name.trim();
    if (tag && !has(tag)) {
      onChange([...tags, tag], existing || newCategory === OTHER ? undefined : { [tag]: newCategory });
    }
    setText("");
    setHighlight(0);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <TagPill key={t} name={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
      ))}
      {adding ? (
        <div className="relative">
          <input
            ref={inputRef}
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setHighlight(0);
            }}
            onBlur={() => window.setTimeout(() => setAdding(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && options[highlight]) {
                e.preventDefault();
                add(options[highlight]);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, options.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(false);
              } else if (e.key === "Backspace" && !text && tags.length) {
                onChange(tags.slice(0, -1));
              }
            }}
            placeholder="Add a tag"
            aria-label="Add a tag"
            className="h-8 w-44 rounded-full bg-card px-3.5 text-sm text-ink ring-1 ring-leaf-tint placeholder:text-ink-faint focus:ring-2 focus:ring-leaf focus:outline-none"
          />
          {options.length > 0 && (
            <ul
              role="listbox"
              className="absolute top-full left-0 z-20 mt-1.5 max-h-64 w-72 animate-fade-in overflow-y-auto rounded-2xl bg-card p-1.5 shadow-lift ring-1 ring-line"
            >
              {options.map((o, i) => (
                <li key={o} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(o)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-sm",
                      i === highlight ? "bg-leaf-wash text-leaf-strong" : "text-ink-soft",
                    )}
                  >
                    {canCreate && i === options.length - 1 ? (
                      <>
                        <Plus className="size-3.5" /> Create “{o}” in {newCategory}
                      </>
                    ) : (
                      o
                    )}
                  </button>
                </li>
              ))}
              {canCreate && (
                <li className="flex flex-wrap gap-1 border-t border-line px-2 pt-2 pb-1.5" aria-label="Category for the new tag">
                  {[...CATEGORY_NAMES, OTHER].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setNewCategory(c)}
                      aria-pressed={newCategory === c}
                      className={cx(
                        "h-6 rounded-full px-2.5 text-xs font-medium transition-colors",
                        newCategory === c ? "bg-leaf text-white dark:text-spine-deep" : "bg-paper-deep text-ink-soft hover:text-ink",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-ink-faint/50 px-3.5 text-sm font-medium text-ink-soft hover:border-leaf hover:bg-card hover:text-leaf-strong"
        >
          <Plus className="size-3.5" />
          Add tag
        </button>
      )}
    </div>
  );
}
