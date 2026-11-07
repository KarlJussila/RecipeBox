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
import { GripVertical, Plus } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { bucketItems, itemsToBucket, type Item } from "../lib/buckets";
import type { Recipe } from "../lib/types";
import { ItemMenu, type BucketName, type Destination } from "./ItemMenu";
import { IngredientText } from "./RecipeView";
import { Button, cx, GrowingTextarea, PrintedHeading } from "./ui";

// The recipe's ingredients, steps, and notes, drawn as they are on the recipe's page,
// with the lines the reader left out beside them. Any line can be dragged to a new
// place, or clicked for a menu to move, retitle, edit, or delete it.

export type { BucketName };
export interface EditItem extends Item {
  id: string;
}
export type Buckets = Record<BucketName, EditItem[]>;

let nextId = 0;
const withIds = (items: Item[]): EditItem[] => items.map((item) => ({ ...item, id: `item-${nextId++}` }));
/** Left-out lines are plain lines, never headings. */
const plain = <T extends Item>(item: T): T => ({ ...item, heading: false });
const into = <T extends Item>(bucket: BucketName, item: T): T => (bucket === "unused" ? plain(item) : item);

export function toBuckets(recipe: Pick<Recipe, BucketName>): Buckets {
  return {
    ingredients: withIds(bucketItems(recipe.ingredients)),
    instructions: withIds(bucketItems(recipe.instructions)),
    tips: withIds(bucketItems(recipe.tips)),
    unused: withIds(bucketItems(recipe.unused)).map(plain),
  };
}

export function fromBuckets(buckets: Buckets): Pick<Recipe, BucketName> {
  const text = (items: EditItem[]) => itemsToBucket(items.map(({ text, heading }) => ({ text, heading })));
  return { ingredients: text(buckets.ingredients), instructions: text(buckets.instructions), tips: text(buckets.tips), unused: text(buckets.unused) };
}

const ORDER: BucketName[] = ["ingredients", "instructions", "tips", "unused"];
const ADD_LABEL: Partial<Record<BucketName, string>> = { ingredients: "Add ingredients", instructions: "Add steps", tips: "Add notes" };

// Each list's rows, matching the recipe page. A row's box bleeds past its text by
// `bleed` on each side, so the text lines up with the headings above it.
const LOOK: Record<BucketName, { row: string; bleed: string; text: string; heading?: string }> = {
  ingredients: {
    row: "-mx-3 rounded px-3 py-2.5",
    bleed: "1.5rem",
    text: "text-[17px] leading-snug text-ink-soft",
    // A printed group label with a light rule off it, as on the recipe page.
    heading: "printed-label flex items-center gap-3.5 pt-[22px] after:h-px after:min-w-6 after:flex-1 after:bg-print-rule/50",
  },
  instructions: {
    row: "-mx-5 rounded px-5 py-4",
    bleed: "2.5rem",
    text: "pt-1 text-[18px] leading-[1.65] text-ink",
    heading: "pt-4 font-serif text-[22px] leading-snug font-semibold tracking-tight text-ink",
  },
  tips: {
    row: "-mx-3 rounded px-3 py-2",
    bleed: "1.5rem",
    text: "text-[17px] leading-[1.65] text-ink-soft",
    // Under the card's title and rule, a note's heading is a step down from it.
    heading: "pt-4 font-serif text-[19px] leading-snug font-semibold text-ink",
  },
  unused: {
    row: "-mx-2.5 rounded-[3px] px-2.5 py-1.5",
    bleed: "1.25rem",
    text: "text-[15px] leading-snug text-ink-soft",
  },
};

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
  const [menu, setMenu] = useState<{ id: string; x: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ item: EditItem; bucket: BucketName; number: number | null } | null>(null);
  /** Whether the left-out lines were showing when a drag began, so they stay while it lasts. */
  const [trayAtStart, setTrayAtStart] = useState(false);
  /** The buckets as they were when a drag started, to put back if it's cancelled. */
  const before = useRef<Buckets | null>(null);
  /** Letting go of a drag clicks the item, which shouldn't open its menu. */
  const justDropped = useRef(false);
  // A press that moves a few pixels drags; one that doesn't is a click.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const closeMenu = useCallback(() => setMenu(null), []);

  const bucketOf = (id: string): BucketName | null =>
    (ORDER as string[]).includes(id) ? (id as BucketName) : (ORDER.find((name) => buckets[name].some((item) => item.id === id)) ?? null);
  const without = (id: string): Buckets =>
    Object.fromEntries(ORDER.map((name) => [name, buckets[name].filter((item) => item.id !== id)])) as Buckets;
  const change = (id: string, patch: Partial<Item>) =>
    onChange(Object.fromEntries(ORDER.map((name) => [name, buckets[name].map((item) => (item.id === id ? { ...item, ...patch } : item))])) as Buckets);
  const moveTo = (item: EditItem, to: Destination) => {
    const rest = without(item.id);
    if (to === "description") onToDescription(item.text);
    else rest[to] = [...rest[to], into(to, item)];
    onChange(rest);
    setMenu(null);
  };

  const dragStart = ({ active }: DragStartEvent) => {
    const bucket = bucketOf(String(active.id))!;
    const item = buckets[bucket].find((i) => i.id === active.id)!;
    const number =
      bucket === "instructions" && !item.heading
        ? buckets.instructions.slice(0, buckets.instructions.indexOf(item) + 1).filter((i) => !i.heading).length
        : null;
    before.current = buckets;
    setTrayAtStart(buckets.unused.length > 0);
    setMenu(null);
    setDragging({ item, bucket, number });
  };
  // Over another list, the item moves into it at once, so that list makes room for it.
  const dragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = bucketOf(String(active.id));
    const to = bucketOf(String(over.id));
    if (!from || !to || from === to) return;
    const item = buckets[from].find((i) => i.id === active.id)!;
    const at = buckets[to].findIndex((i) => i.id === over.id);
    const list = [...buckets[to]];
    list.splice(at < 0 ? list.length : at, 0, into(to, item));
    onChange({ ...buckets, [from]: buckets[from].filter((i) => i.id !== active.id), [to]: list });
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

  const list = (name: BucketName) => (
    <BucketList
      name={name}
      items={buckets[name]}
      menuFor={menu?.id ?? null}
      editing={editing}
      dragging={dragging !== null}
      onOpen={(id, x) => {
        if (justDropped.current) return;
        setMenu(menu?.id === id ? null : { id, x });
      }}
      onEdited={(id, text) => {
        if (text !== null) change(id, { text });
        setEditing(null);
      }}
      onAdd={(text) => onChange({ ...buckets, [name]: [...buckets[name], ...withIds(bucketItems(text))] })}
    />
  );

  const open = menu && ORDER.flatMap((name) => buckets[name]).find((item) => item.id === menu.id);
  const anchor = menu && document.querySelector<HTMLElement>(`[data-item="${menu.id}"]`);
  const tray = buckets.unused.length > 0 || (dragging !== null && trayAtStart);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      onDragStart={dragStart}
      onDragOver={dragOver}
      onDragEnd={dragEnd}
      onDragCancel={dragCancel}
    >
      <div className={cx("grid items-start gap-x-14 gap-y-16", tray && "@5xl:grid-cols-[minmax(0,1fr)_17rem]")}>
        <div className="min-w-0 space-y-16">
          <section className="pt-1">
            <PrintedHeading className="mb-3 text-[13px]">Ingredients</PrintedHeading>
            {list("ingredients")}
          </section>
          <section>
            <PrintedHeading className="mb-4 h-9 text-[13px]">Directions</PrintedHeading>
            {list("instructions")}
          </section>
          <section>
            <PrintedHeading className="mb-2 h-9 text-[13px]">Notes</PrintedHeading>
            {list("tips")}
          </section>
        </div>

        {tray && (
          // Beside the recipe on wide windows, where it stays in view while the steps scroll past.
          <aside className="@5xl:sticky @5xl:top-20">
            {/* A scrap set beside the card: the lines that didn't make it onto it. */}
            <div className="scrollbar-quiet overflow-x-hidden rounded-[2px] bg-umber/5 px-5 pt-5 pb-4 ring-1 ring-umber/15 ring-inset @5xl:max-h-[calc(100vh-7rem)] @5xl:overflow-y-auto">
              <h2 className="font-serif text-xl font-semibold tracking-tight">Left out</h2>
              <p className="mt-1 mb-3 text-sm leading-snug text-ink-faint">Lines from the recipe’s web page that aren’t in the recipe.</p>
              {list("unused")}
            </div>
          </aside>
        )}
      </div>

      <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" }}>
        {dragging && (
          <div className={cx(LOOK[dragging.bucket].row, "mx-0 rotate-[0.8deg] cursor-grabbing bg-card shadow-lift ring-1 ring-umber/20")}>
            <RowContent item={dragging.item} bucket={dragging.bucket} number={dragging.number} />
          </div>
        )}
      </DragOverlay>

      {open && anchor && (
        <ItemMenu
          key={open.id}
          anchor={anchor}
          x={menu.x}
          bucket={bucketOf(open.id)!}
          heading={open.heading}
          onMove={(to) => moveTo(open, to)}
          onToggleHeading={() => change(open.id, { heading: !open.heading })}
          onEdit={() => {
            setEditing(open.id);
            setMenu(null);
          }}
          onDelete={() => {
            onChange(without(open.id));
            setMenu(null);
          }}
          onClose={closeMenu}
        />
      )}
    </DndContext>
  );
}

// Over a list, the line under the pointer; between lists, the nearest one.
const collisions: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

function BucketList({
  name,
  items,
  menuFor,
  editing,
  dragging,
  onOpen,
  onEdited,
  onAdd,
}: {
  name: BucketName;
  items: EditItem[];
  menuFor: string | null;
  editing: string | null;
  dragging: boolean;
  onOpen: (id: string, x: number) => void;
  onEdited: (id: string, text: string | null) => void;
  onAdd: (text: string) => void;
}) {
  // The whole list takes drops, so an empty one can be filled.
  const { setNodeRef, isOver } = useDroppable({ id: name });
  let number = 0;
  return (
    <SortableContext id={name} items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef}>
        <ul className={cx(name === "ingredients" && "divide-y divide-leaf/12", name === "instructions" && "space-y-1")}>
          {items.map((item) => {
            if (!item.heading) number += 1;
            return (
              <Row
                key={item.id}
                item={item}
                bucket={name}
                number={name === "instructions" && !item.heading ? number : null}
                open={menuFor === item.id}
                editing={editing === item.id}
                onOpen={(x) => onOpen(item.id, x)}
                onEdited={(text) => onEdited(item.id, text)}
              />
            );
          })}
        </ul>
        {items.length === 0 && dragging && (
          <p
            className={cx(
              "mt-1 rounded border border-dashed px-4 py-3 text-[15px] transition-colors",
              isOver ? "border-leaf bg-leaf/8 text-leaf-strong" : "border-ink-faint/35 text-ink-faint",
            )}
          >
            Drop it here
          </p>
        )}
        {ADD_LABEL[name] && !dragging && <AddLines label={ADD_LABEL[name]} first={items.length === 0} onAdd={onAdd} />}
      </div>
    </SortableContext>
  );
}

function RowContent({ item, bucket, number, children }: { item: EditItem; bucket: BucketName; number: number | null; children?: ReactNode }) {
  const look = LOOK[bucket];
  return (
    <div className="flex items-start gap-4">
      {number !== null && <span className="w-9 shrink-0 font-serif text-[40px] leading-[0.9] font-medium text-leaf italic tabular-nums">{number}</span>}
      <div className={cx("min-w-0 flex-1", item.heading ? look.heading : look.text)}>
        {children ?? (bucket === "ingredients" && !item.heading ? <IngredientText line={item.text} /> : item.text)}
      </div>
    </div>
  );
}

function Row({
  item,
  bucket,
  number,
  open,
  editing,
  onOpen,
  onEdited,
}: {
  item: EditItem;
  bucket: BucketName;
  number: number | null;
  open: boolean;
  editing: boolean;
  onOpen: (x: number) => void;
  /** The new text, or null when editing was cancelled. */
  onEdited: (text: string | null) => void;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: item.id, disabled: editing });
  const look = LOOK[bucket];
  const box = cx(look.row, "relative block w-[calc(100%+var(--bleed))]");
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, ["--bleed" as string]: look.bleed }}>
      {editing ? (
        <div className={cx(box, "bg-card ring-2 ring-leaf/45")}>
          <RowContent item={item} bucket={bucket} number={number}>
            <EditLine text={item.text} onDone={onEdited} />
          </RowContent>
        </div>
      ) : (
        <button
          type="button"
          data-item={item.id}
          aria-haspopup="menu"
          aria-expanded={open}
          // A click from the keyboard has no pointer position, so the menu opens near the start of the line.
          onClick={(e) => onOpen(e.clientX || e.currentTarget.getBoundingClientRect().left + 40)}
          {...listeners}
          className={cx(
            box,
            "group cursor-grab pr-8 text-left transition-colors duration-150 active:cursor-grabbing",
            isDragging ? "opacity-35" : open ? "bg-leaf/8 ring-1 ring-leaf/30" : "hover:bg-umber/5",
          )}
        >
          <RowContent item={item} bucket={bucket} number={number} />
          <GripVertical
            aria-hidden
            className={cx(
              "absolute top-1/2 right-2 size-4 -translate-y-1/2 text-ink-faint transition-opacity duration-150",
              open ? "opacity-70" : "opacity-0 group-hover:opacity-70",
            )}
          />
        </button>
      )}
    </li>
  );
}

/** The line's text, editable where it sits. Enter or clicking away keeps the change; Escape drops it. */
function EditLine({ text, onDone }: { text: string; onDone: (text: string | null) => void }) {
  const [value, setValue] = useState(text);
  const done = useRef(false);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(keep ? value.replace(/\s+/g, " ").trim() || null : null);
  };
  return (
    <GrowingTextarea
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.setSelectionRange(value.length, value.length)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      aria-label="Edit this line"
      className="w-full bg-transparent p-0 [font:inherit] text-inherit focus:outline-none"
    />
  );
}

/** A dashed slot at the end of a list that opens into a box for new lines, one on each line. */
function AddLines({ label, first, onAdd }: { label: string; first: boolean; onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const close = () => {
    setText("");
    setOpen(false);
  };
  const add = () => {
    if (text.trim()) onAdd(text);
    close();
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          "flex w-full items-center gap-2 rounded border border-dashed border-ink-faint/35 px-4 py-2.5 text-[15px] font-medium text-ink-faint transition-colors hover:border-ink-faint/60 hover:bg-umber/5 hover:text-ink-soft",
          first ? "mt-1" : "mt-4",
        )}
      >
        <Plus className="size-4" />
        {label}
      </button>
    );
  }
  return (
    <div className={cx("animate-fade-in rounded bg-card ring-2 ring-leaf/45", first ? "mt-1" : "mt-4")}>
      <GrowingTextarea
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
        }}
        placeholder="One on each line"
        className="min-h-[4.5rem] w-full bg-transparent px-4 pt-3 pb-1 text-[16px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
      />
      <div className="flex items-center gap-2 py-2 pr-2 pl-4">
        <p className="flex-1 text-[13px] text-ink-faint">Start a line with # to make it a heading.</p>
        <Button variant="ghost" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}
