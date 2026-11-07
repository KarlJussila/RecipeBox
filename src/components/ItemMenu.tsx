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
  /** Where across the row it was clicked, so the menu opens under the pointer. */
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
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const panels = { actions: useRef<HTMLDivElement>(null), move: useRef<HTMLDivElement>(null) };

  // The frame takes the size of the panel showing, and animates between them.
  useLayoutEffect(() => {
    const el = panels[view].current!;
    setSize({ width: el.offsetWidth, height: el.offsetHeight });
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Under the item, or over it when there's no room below; it follows the item as the page scrolls.
  useLayoutEffect(() => {
    if (!size) return;
    const position = () => {
      const row = anchor.getBoundingClientRect();
      const width = size.width + 10;
      const height = size.height + 10;
      const left = Math.min(Math.max(x - 28, GAP), window.innerWidth - width - GAP);
      const below = row.bottom + GAP;
      const top = below + height > window.innerHeight - GAP ? row.top - height - GAP : below;
      setPlace({ left, top });
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [anchor, x, size]);

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
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}
      className="fixed z-50 animate-pop-in rounded-2xl bg-card p-[5px] shadow-lift ring-1 ring-line"
    >
      <div
        style={size ?? undefined}
        className="relative overflow-hidden transition-[width,height] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.3,1)] motion-reduce:transition-none"
      >
        {panel(
          "actions",
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              onClick={() => setView("move")}
              className="flex h-9 items-center gap-2 rounded-xl pr-2 pl-3 text-sm font-semibold text-ink transition-colors hover:bg-paper-deep"
            >
              <ArrowRightLeft className="size-4 text-ink-faint" />
              Move to
              <ChevronRight className="size-4 text-ink-faint" />
            </button>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <Tool label={heading ? "Make it a line again" : "Make it a heading"} pressed={heading} onClick={onToggleHeading}>
              <Heading className="size-[18px]" />
            </Tool>
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
              className="flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-xs font-semibold tracking-wide text-ink-faint transition-colors hover:text-ink"
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
                    className="group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-wash hover:text-leaf-strong focus-visible:bg-leaf-wash"
                  >
                    <span className="text-ink-faint transition-colors group-hover:text-leaf">{d.icon}</span>
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
        "flex size-9 items-center justify-center rounded-xl transition-colors",
        pressed ? "bg-leaf-tint text-leaf-strong" : danger ? "text-ink-soft hover:bg-tomato/10 hover:text-tomato" : "text-ink-soft hover:bg-paper-deep hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
