import { Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { bucketItems, itemsToBucket, type Item } from "../lib/buckets";
import type { Recipe } from "../lib/types";
import { Button, cx, Eyebrow } from "./ui";

// The recipe's ingredients, steps, notes, and unused lines, laid out like the recipe
// page, for moving items between them, making them headings, editing, and deleting.

export type BucketName = "ingredients" | "instructions" | "tips" | "unused";
export interface EditItem extends Item {
  id: string;
}
export type Buckets = Record<BucketName, EditItem[]>;

let nextId = 0;
const withIds = (items: Item[]): EditItem[] => items.map((item) => ({ ...item, id: `item-${nextId++}` }));

export function toBuckets(recipe: Recipe): Buckets {
  return {
    ingredients: withIds(bucketItems(recipe.ingredients)),
    instructions: withIds(bucketItems(recipe.instructions)),
    tips: withIds(bucketItems(recipe.tips)),
    unused: withIds(bucketItems(recipe.unused)),
  };
}

export function fromBuckets(buckets: Buckets): Pick<Recipe, BucketName> {
  const text = (items: EditItem[]) => itemsToBucket(items.map(({ text, heading }) => ({ text, heading })));
  return { ingredients: text(buckets.ingredients), instructions: text(buckets.instructions), tips: text(buckets.tips), unused: text(buckets.unused) };
}

const NAMES: Record<BucketName, string> = { ingredients: "Ingredients", instructions: "Steps", tips: "Notes", unused: "Not used" };
const ORDER: BucketName[] = ["ingredients", "instructions", "tips", "unused"];

export function RecipeBoard({
  buckets,
  onChange,
  onToDescription,
}: {
  buckets: Buckets;
  onChange: (buckets: Buckets) => void;
  /** An item moved into the description, as a paragraph of its own. */
  onToDescription: (text: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const without = (id: string): Buckets =>
    Object.fromEntries(ORDER.map((name) => [name, buckets[name].filter((item) => item.id !== id)])) as Buckets;
  const change = (id: string, patch: Partial<Item>) =>
    onChange(Object.fromEntries(ORDER.map((name) => [name, buckets[name].map((item) => (item.id === id ? { ...item, ...patch } : item))])) as Buckets);
  const actions: ItemActions = {
    moveTo: (item, to) => {
      const rest = without(item.id);
      if (to === "description") onToDescription(item.text);
      else rest[to] = [...rest[to], item];
      onChange(rest);
      setSelected(null);
    },
    toggleHeading: (item) => change(item.id, { heading: !item.heading }),
    edit: (item) => setEditing(item.id),
    remove: (item) => {
      onChange(without(item.id));
      setSelected(null);
    },
  };

  const list = (name: BucketName, look: Look) => {
    let number = 0;
    return (
      <ul className={cx(look === "ingredient" && "divide-y divide-leaf/12", look === "step" && "space-y-1", look === "note" && "space-y-1")}>
        {buckets[name].map((item) => {
          if (!item.heading) number += 1;
          return (
            <ItemRow
              key={item.id}
              item={item}
              bucket={name}
              look={look}
              number={look === "step" && !item.heading ? number : null}
              selected={selected === item.id}
              editing={editing === item.id}
              onSelect={() => setSelected(selected === item.id ? null : item.id)}
              onEdited={(text) => {
                if (text !== null) change(item.id, { text });
                setEditing(null);
              }}
              actions={actions}
            />
          );
        })}
      </ul>
    );
  };
  const add = (name: BucketName) => (text: string) => onChange({ ...buckets, [name]: [...buckets[name], ...withIds(bucketItems(text))] });

  return (
    <div className={cx("grid gap-10", buckets.unused.length > 0 && "@5xl:grid-cols-[minmax(0,1fr)_19rem]")}>
      <div className="min-w-0 space-y-12">
        <section className="rounded-3xl bg-card p-7 shadow-soft ring-1 ring-black/5">
          <h2 className="mb-3 border-b-2 border-tomato/50 pb-3 font-serif text-[28px] leading-tight font-semibold tracking-tight">Ingredients</h2>
          {buckets.ingredients.length === 0 && <Empty>No ingredients yet.</Empty>}
          {list("ingredients", "ingredient")}
          <AddItems what="ingredients" onAdd={add("ingredients")} />
        </section>
        <section>
          <h2 className="mb-4 font-serif text-[28px] font-semibold tracking-tight">Method</h2>
          {buckets.instructions.length === 0 && <Empty>No steps yet.</Empty>}
          {list("instructions", "step")}
          <AddItems what="steps" onAdd={add("instructions")} />
        </section>
        <section>
          <h2 className="mb-4 font-serif text-[28px] font-semibold tracking-tight">Notes</h2>
          {buckets.tips.length === 0 && <Empty>No notes from the recipe.</Empty>}
          {list("tips", "note")}
          <AddItems what="notes" onAdd={add("tips")} />
        </section>
      </div>
      {buckets.unused.length > 0 && (
        // On wide windows it stays in view beside the steps, since that's where most of its lines go.
        <aside className="scrollbar-quiet min-w-0 @5xl:sticky @5xl:top-24 @5xl:max-h-[calc(100vh-8rem)] @5xl:self-start @5xl:overflow-y-auto">
          <h2 className="font-serif text-[22px] font-semibold tracking-tight">Not used</h2>
          <p className="mt-1 mb-4 text-[15px] text-ink-faint">From the recipe’s page, but not in the recipe.</p>
          {list("unused", "unused")}
        </aside>
      )}
    </div>
  );
}

type Look = "ingredient" | "step" | "note" | "unused";

interface ItemActions {
  moveTo: (item: EditItem, to: BucketName | "description") => void;
  toggleHeading: (item: EditItem) => void;
  edit: (item: EditItem) => void;
  remove: (item: EditItem) => void;
}

function Empty({ children }: { children: string }) {
  return <p className="py-2 text-ink-faint">{children}</p>;
}

function ItemRow({
  item,
  bucket,
  look,
  number,
  selected,
  editing,
  onSelect,
  onEdited,
  actions,
}: {
  item: EditItem;
  bucket: BucketName;
  look: Look;
  number: number | null;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  /** The new text, or null when editing was cancelled. */
  onEdited: (text: string | null) => void;
  actions: ItemActions;
}) {
  const text = item.heading ? (
    look === "ingredient" ? (
      <Eyebrow className="pt-2">{item.text}</Eyebrow>
    ) : (
      <span className={cx("font-serif leading-snug font-semibold tracking-tight", look === "unused" ? "text-[17px]" : "text-[22px]")}>{item.text}</span>
    )
  ) : (
    <span
      className={cx(
        "leading-snug",
        look === "ingredient" && "text-[17px] text-ink-soft",
        look === "step" && "text-[18px] leading-[1.6] text-ink",
        look === "note" && "text-[17px] leading-[1.6] text-ink-soft",
        look === "unused" && "text-[15px] text-ink-faint",
      )}
    >
      {item.text}
    </span>
  );
  return (
    <li className={cx(item.heading && look !== "ingredient" && "pt-3")}>
      {editing ? (
        <EditText text={item.text} onDone={onEdited} />
      ) : (
        <button
          type="button"
          aria-expanded={selected}
          onClick={onSelect}
          className={cx(
            "-mx-3 grid w-[calc(100%+1.5rem)] items-start gap-3 rounded-xl px-3 text-left transition-colors",
            number !== null ? "grid-cols-[2.5rem_minmax(0,1fr)] py-3" : "grid-cols-[minmax(0,1fr)] py-2",
            selected ? "bg-butter" : "hover:bg-ink/5",
          )}
        >
          {number !== null && <span className="font-serif text-[34px] leading-[0.9] font-medium text-leaf italic tabular-nums">{number}</span>}
          {text}
        </button>
      )}
      {selected && !editing && (
        <div role="group" aria-label="Change this item" className="mt-1 mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-ink-faint">Move to</span>
          {ORDER.filter((name) => name !== bucket).map((name) => (
            <Choice key={name} onClick={() => actions.moveTo(item, name)}>
              {NAMES[name]}
            </Choice>
          ))}
          {!item.heading && <Choice onClick={() => actions.moveTo(item, "description")}>Description</Choice>}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <Choice onClick={() => actions.toggleHeading(item)}>{item.heading ? "Make it an item" : "Make it a heading"}</Choice>
          <Choice onClick={() => actions.edit(item)}>Edit</Choice>
          <Choice onClick={() => actions.remove(item)}>Delete</Choice>
        </div>
      )}
    </li>
  );
}

function Choice({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-9 rounded-full bg-card px-4 text-[15px] font-semibold text-ink ring-1 ring-line hover:bg-paper-deep">
      {children}
    </button>
  );
}

/** A textarea that grows with its text. Enter keeps the change, Escape drops it. */
function GrowingText({ value, onChange, onKeyDown, placeholder, autoFocus, rows = 1 }: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={rows}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className="w-full resize-none rounded-xl bg-card px-4 py-2.5 text-[17px] leading-snug text-ink ring-1 ring-line placeholder:text-ink-faint focus:ring-2 focus:ring-leaf focus:outline-none"
    />
  );
}

function EditText({ text, onDone }: { text: string; onDone: (text: string | null) => void }) {
  const [value, setValue] = useState(text);
  const keep = () => onDone(value.replace(/\s+/g, " ").trim() || null);
  return (
    <div className="my-2 space-y-2">
      <GrowingText
        value={value}
        onChange={setValue}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            keep();
          } else if (e.key === "Escape") {
            onDone(null);
          }
        }}
      />
      <div className="flex gap-2">
        <Button variant="primary" onClick={keep}>
          Done
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Adds items, one per line; a line starting "# " is a heading. */
function AddItems({ what, onAdd }: { what: string; onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1.5 text-[15px] font-semibold text-leaf hover:underline">
        <Plus className="size-4" /> Add {what}
      </button>
    );
  }
  const done = () => {
    if (text.trim()) onAdd(text);
    setText("");
    setOpen(false);
  };
  return (
    <div className="mt-3 space-y-2">
      <GrowingText value={text} onChange={setText} autoFocus rows={3} placeholder={`One per line. Start a line with “# ” to make it a heading.`} />
      <div className="flex gap-2">
        <Button variant="primary" onClick={done}>
          Add
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setText("");
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
