import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  const [dragging, setDragging] = useState<EditItem | null>(null);
  /** Whether the unused lines were showing when the drag began, so they stay while it lasts. */
  const [unusedAtStart, setUnusedAtStart] = useState(false);
  /** The buckets as they were when a drag started, to put back if it's cancelled. */
  const before = useRef<Buckets | null>(null);
  /** A drag ends with a click on the item let go of, which shouldn't open its menu. */
  const justDropped = useRef(false);
  // A press that moves a few pixels drags; one that doesn't is a click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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

  /** The bucket an item is in, or the bucket itself when dropping on its empty space. */
  const bucketOf = (id: string): BucketName | null =>
    (ORDER as string[]).includes(id) ? (id as BucketName) : (ORDER.find((name) => buckets[name].some((item) => item.id === id)) ?? null);

  const dragStart = ({ active }: DragStartEvent) => {
    before.current = buckets;
    setUnusedAtStart(buckets.unused.length > 0);
    setSelected(null);
    setDragging(ORDER.flatMap((name) => buckets[name]).find((item) => item.id === active.id) ?? null);
  };
  // Over another bucket, the item moves into it at once, so that bucket makes room for it.
  const dragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = bucketOf(String(active.id));
    const to = bucketOf(String(over.id));
    if (!from || !to || from === to) return;
    const item = buckets[from].find((i) => i.id === active.id)!;
    const at = buckets[to].findIndex((i) => i.id === over.id);
    const into = [...buckets[to]];
    into.splice(at < 0 ? into.length : at, 0, item);
    onChange({ ...buckets, [from]: buckets[from].filter((i) => i.id !== active.id), [to]: into });
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    justDropped.current = true;
    setTimeout(() => (justDropped.current = false));
    const name = over && bucketOf(String(active.id));
    if (!over || !name || bucketOf(String(over.id)) !== name) return;
    const from = buckets[name].findIndex((i) => i.id === active.id);
    const to = buckets[name].findIndex((i) => i.id === over.id);
    if (to >= 0 && from !== to) onChange({ ...buckets, [name]: arrayMove(buckets[name], from, to) });
  };
  const dragCancel = () => {
    setDragging(null);
    if (before.current) onChange(before.current);
  };

  const list = (name: BucketName, look: Look) => (
    <BucketList
      name={name}
      look={look}
      items={buckets[name]}
      selected={selected}
      editing={editing}
      onSelect={(id) => {
        if (!justDropped.current) setSelected(selected === id ? null : id);
      }}
      onEdited={(id, text) => {
        if (text !== null) change(id, { text });
        setEditing(null);
      }}
      actions={actions}
    />
  );
  const add = (name: BucketName) => (text: string) => onChange({ ...buckets, [name]: [...buckets[name], ...withIds(bucketItems(text))] });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      onDragStart={dragStart}
      onDragOver={dragOver}
      onDragEnd={dragEnd}
      onDragCancel={dragCancel}
    >
      <div className={cx("grid gap-10", (buckets.unused.length > 0 || (dragging && unusedAtStart)) && "@5xl:grid-cols-[minmax(0,1fr)_19rem]")}>
        <div className="min-w-0 space-y-12">
          <section className="rounded-3xl bg-card p-7 shadow-soft ring-1 ring-black/5">
            <h2 className="mb-3 border-b-2 border-tomato/50 pb-3 font-serif text-[28px] leading-tight font-semibold tracking-tight">Ingredients</h2>
            {list("ingredients", "ingredient")}
            <AddItems what="ingredients" onAdd={add("ingredients")} />
          </section>
          <section>
            <h2 className="mb-4 font-serif text-[28px] font-semibold tracking-tight">Method</h2>
            {list("instructions", "step")}
            <AddItems what="steps" onAdd={add("instructions")} />
          </section>
          <section>
            <h2 className="mb-4 font-serif text-[28px] font-semibold tracking-tight">Notes</h2>
            {list("tips", "note")}
            <AddItems what="notes" onAdd={add("tips")} />
          </section>
        </div>
        {(buckets.unused.length > 0 || (dragging && unusedAtStart)) && (
          // On wide windows it stays in view beside the steps, since that's where most of its lines go.
          <aside className="scrollbar-quiet min-w-0 @5xl:sticky @5xl:top-24 @5xl:max-h-[calc(100vh-8rem)] @5xl:self-start @5xl:overflow-y-auto">
            <h2 className="font-serif text-[22px] font-semibold tracking-tight">Not used</h2>
            <p className="mt-1 mb-4 text-[15px] text-ink-faint">From the recipe’s page, but not in the recipe.</p>
            {list("unused", "unused")}
          </aside>
        )}
      </div>
      <DragOverlay>
        {dragging && (
          <div
            className={cx(
              "cursor-grabbing rounded-xl bg-card px-4 py-2.5 text-[17px] leading-snug text-ink shadow-soft ring-2 ring-leaf",
              dragging.heading && "font-serif font-semibold",
            )}
          >
            {dragging.text}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// Over a list, the item under the pointer; between lists, the nearest one.
const collisions: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

function BucketList({
  name,
  look,
  items,
  selected,
  editing,
  onSelect,
  onEdited,
  actions,
}: {
  name: BucketName;
  look: Look;
  items: EditItem[];
  selected: string | null;
  editing: string | null;
  onSelect: (id: string) => void;
  onEdited: (id: string, text: string | null) => void;
  actions: ItemActions;
}) {
  // The list itself takes drops too, so an empty one can be filled.
  const { setNodeRef, isOver } = useDroppable({ id: name });
  let number = 0;
  return (
    <SortableContext id={name} items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
      <ul
        ref={setNodeRef}
        className={cx(
          look === "ingredient" && "divide-y divide-leaf/12",
          (look === "step" || look === "note") && "space-y-1",
          items.length === 0 && "rounded-xl py-2 transition-colors",
          items.length === 0 && isOver && "bg-ink/5",
        )}
      >
        {items.length === 0 && <li className="text-ink-faint">{EMPTY[name]}</li>}
        {items.map((item) => {
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
              onSelect={() => onSelect(item.id)}
              onEdited={(text) => onEdited(item.id, text)}
              actions={actions}
            />
          );
        })}
      </ul>
    </SortableContext>
  );
}

const EMPTY: Record<BucketName, string> = {
  ingredients: "No ingredients yet.",
  instructions: "No steps yet.",
  tips: "No notes from the recipe.",
  unused: "Drop lines here to leave them out.",
};

type Look = "ingredient" | "step" | "note" | "unused";

interface ItemActions {
  moveTo: (item: EditItem, to: BucketName | "description") => void;
  toggleHeading: (item: EditItem) => void;
  edit: (item: EditItem) => void;
  remove: (item: EditItem) => void;
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
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: item.id, disabled: editing });
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
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx(item.heading && look !== "ingredient" && "pt-3", isDragging && "opacity-30")}
    >
      {editing ? (
        <EditText text={item.text} onDone={onEdited} />
      ) : (
        <button
          type="button"
          aria-expanded={selected}
          onClick={onSelect}
          {...listeners}
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
