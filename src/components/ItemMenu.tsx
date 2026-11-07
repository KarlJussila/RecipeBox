import { ArrowLeft, ArrowRightLeft, Carrot, ChevronRight, EyeOff, Heading, ListOrdered, Pencil, StickyNote, TextAlignStart, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./ui";

export type BucketName = "ingredients" | "instructions" | "tips" | "unused";
export type Destination = BucketName | "description";

const DESTINATIONS: { to: Destination; label: string; icon: ReactNode }[] = [
  { to: "ingredients", label: "Ingredients", icon: <Carrot className="size-4" /> },
  { to: "instructions", label: "Steps", icon: <ListOrdered className="size-4" /> },
  { to: "tips", label: "Notes", icon: <StickyNote className="size-4" /> },
  { to: "description", label: "Description", icon: <TextAlignStart className="size-4" /> },
  { to: "unused", label: "Left out", icon: <EyeOff className="size-4" /> },
];

/** Space kept between the menu and the item, and between the menu and the window's edges. */
const GAP = 8;
/** The menu's padding, on both sides together, around the panel showing. */
const PAD = 10;
const EASE = "ease-[cubic-bezier(0.2,0.8,0.3,1)]";

/**
 * A small toolbar floating under an item of the recipe: move it, make it a heading,
 * edit it, or delete it. "Move to" turns the toolbar into the list of places it can go.
 */
export function ItemMenu({
  anchor,
  x,
  bucket,
  heading,
  onMove,
  onToggleHeading,
  onEdit,
  onDelete,
  onClose,
}: {
  /** The item's row, which the menu sits under. */
  anchor: HTMLElement;
  /** Where across the row it was clicked; the menu centers on it. */
  x: number;
  bucket: BucketName;
  heading: boolean;
  onMove: (to: Destination) => void;
  onToggleHeading: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"actions" | "move">("actions");
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  /** Once it's in place, it slides sideways as it changes width, instead of jumping. */
  const [settled, setSettled] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const panels = { actions: useRef<HTMLDivElement>(null), move: useRef<HTMLDivElement>(null) };

  // The frame takes the size of the panel showing, and animates between them.
  useLayoutEffect(() => {
    const el = panels[view].current!;
    setSize({ width: el.offsetWidth, height: el.offsetHeight });
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Centered on the click and kept inside the window. It sits under the item, or over it
  // when the taller of its two panels wouldn't fit below, so it never flips while open.
  // Over the item, it hangs from its bottom edge and grows upward. It follows the item
  // as the page scrolls.
  useLayoutEffect(() => {
    if (!size) return;
    const position = () => {
      const row = anchor.getBoundingClientRect();
      const width = size.width + PAD;
      const tallest = Math.max(panels.actions.current!.offsetHeight, panels.move.current!.offsetHeight) + PAD;
      const left = Math.min(Math.max(x - width / 2, GAP), window.innerWidth - width - GAP);
      const below = row.bottom + GAP;
      if (below + tallest <= window.innerHeight - GAP) setPlace({ left, top: below });
      else if (row.top - GAP - tallest >= GAP) setPlace({ left, bottom: window.innerHeight - row.top + GAP });
      else setPlace({ left, top: Math.max(GAP, window.innerHeight - size.height - PAD - GAP) });
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, x, size]);

  useEffect(() => {
    if (place && !settled) requestAnimationFrame(() => setSettled(true));
  }, [place, settled]);

  // A press anywhere else closes it; a press on the item is the item's to handle.
  useEffect(() => {
    const press = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    document.addEventListener("pointerdown", press, true);
    return () => document.removeEventListener("pointerdown", press, true);
  }, [anchor, onClose]);

  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (view === "move") setView("actions");
      else {
        onClose();
        anchor.focus();
      }
    }
  };

  const panel = (name: "actions" | "move", children: ReactNode) => (
    <div
      ref={panels[name]}
      aria-hidden={view !== name}
      inert={view !== name}
      className={cx(
        "absolute top-0 left-0 w-max transition duration-200 ease-out motion-reduce:transition-none",
        view === name ? "translate-x-0 opacity-100" : name === "actions" ? "-translate-x-6 opacity-0" : "translate-x-6 opacity-0",
      )}
    >
      {children}
    </div>
  );

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label="Change this line"
      onKeyDown={keyDown}
      style={place ? { left: place.left, top: place.top, bottom: place.bottom } : { left: -9999, top: -9999 }}
      className={cx(
        "fixed z-50 animate-pop-in rounded bg-card p-[5px] shadow-lift ring-1 ring-line",
        settled && `transition-[left] duration-[240ms] motion-reduce:transition-none ${EASE}`,
      )}
    >
      <div
        style={size ?? undefined}
        className={`relative overflow-hidden transition-[width,height] duration-[240ms] motion-reduce:transition-none ${EASE}`}
      >
        {panel(
          "actions",
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              onClick={() => setView("move")}
              className="flex h-9 items-center gap-2 rounded-[3px] pr-2 pl-3 text-sm font-semibold text-ink transition-colors hover:bg-ink/5"
            >
              <ArrowRightLeft className="size-4 text-ink-faint" />
              Move to
              <ChevronRight className="size-4 text-ink-faint" />
            </button>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            {bucket !== "unused" && (
              <Tool label={heading ? "Make it a line again" : "Make it a heading"} pressed={heading} onClick={onToggleHeading}>
                <Heading className="size-[18px]" />
              </Tool>
            )}
            <Tool label="Edit" onClick={onEdit}>
              <Pencil className="size-[17px]" />
            </Tool>
            <Tool label="Delete" danger onClick={onDelete}>
              <Trash2 className="size-[17px]" />
            </Tool>
          </div>,
        )}
        {panel(
          "move",
          <div className="w-52">
            <button
              type="button"
              onClick={() => setView("actions")}
              className="flex h-8 w-full items-center gap-1.5 rounded-[3px] px-2 text-xs font-semibold tracking-wide text-ink-faint transition-colors hover:text-ink"
            >
              <ArrowLeft className="size-3.5" />
              Move to
            </button>
            <ul className="pb-0.5">
              {DESTINATIONS.filter((d) => d.to !== bucket && !(heading && d.to === "description")).map((d) => (
                <li key={d.to} className={cx(d.to === "unused" && "mt-1 border-t border-line pt-1")}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onMove(d.to)}
                    className="flex h-9 w-full items-center gap-2.5 rounded-[3px] px-2.5 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-ink/5 hover:text-ink focus-visible:bg-ink/5"
                  >
                    <span className="text-ink-faint">{d.icon}</span>
                    {d.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
        )}
      </div>
    </div>,
    document.body,
  );
}

function Tool({ label, pressed, danger, onClick, children }: { label: string; pressed?: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={cx(
        "flex size-9 items-center justify-center rounded-[3px] transition-colors",
        pressed ? "bg-leaf/12 text-leaf-strong" : danger ? "text-ink-soft hover:bg-tomato/10 hover:text-tomato" : "text-ink-soft hover:bg-ink/5 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
