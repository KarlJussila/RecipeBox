import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cx, TagChip } from "./ui";

/** Tag chips with removal, plus an autocompleting field to add existing or new tags. */
export function TagEditor({
  tags,
  allTags,
  onChange,
}: {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
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
    const tag = allTags.find((t) => t.toLowerCase() === name.toLowerCase()) ?? name.trim();
    if (tag && !has(tag)) onChange([...tags, tag]);
    setText("");
    setHighlight(0);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <TagChip key={t} name={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
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
            className="h-7 w-40 rounded-full bg-white px-3 text-[13px] ring-1 ring-leaf-300 focus:ring-2 focus:ring-leaf-600 focus:outline-none dark:bg-stone-900 dark:ring-leaf-800"
          />
          {options.length > 0 && (
            <ul
              role="listbox"
              className="absolute top-full left-0 z-20 mt-1.5 max-h-64 w-56 animate-fade-in overflow-y-auto rounded-xl bg-white p-1 shadow-lift ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700"
            >
              {options.map((o, i) => (
                <li key={o} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(o)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm",
                      i === highlight ? "bg-leaf-50 text-leaf-900 dark:bg-leaf-900/50 dark:text-leaf-100" : "text-stone-700 dark:text-stone-200",
                    )}
                  >
                    {canCreate && i === options.length - 1 ? (
                      <>
                        <Plus className="size-3.5" /> Create “{o}”
                      </>
                    ) : (
                      o
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-[13px] font-medium border border-dashed border-stone-300 text-stone-600 hover:border-leaf-400 hover:bg-white hover:text-leaf-800 dark:border-stone-700 dark:text-stone-400 dark:hover:bg-stone-900"
        >
          <Plus className="size-3.5" />
          Add tag
        </button>
      )}
    </div>
  );
}
