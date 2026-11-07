import { Flame, Globe, PartyPopper, Salad, Tag as TagIcon, UtensilsCrossed, Wheat, X } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export const isMac = navigator.userAgent.includes("Mac");

// ---------------------------------------------------------------------------
// Buttons

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-leaf text-white shadow-soft hover:bg-leaf-strong dark:text-spine-deep",
  secondary: "bg-card text-ink ring-1 ring-line shadow-soft hover:bg-paper-deep",
  ghost: "text-ink-soft hover:bg-ink/6 hover:text-ink",
  danger: "bg-tomato text-white shadow-soft hover:brightness-95 dark:text-spine-deep",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3.5 text-sm",
        size === "md" && "h-10 px-5 text-[15px]",
        size === "lg" && "h-12 px-6 text-base",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
}

export function IconButton({ label, active, className, children, type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-10 items-center justify-center rounded-full transition-colors duration-150",
        active ? "bg-leaf-tint text-leaf" : "text-ink-soft hover:bg-ink/6 hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form fields

const FIELD =
  "w-full rounded-xl bg-card px-3.5 text-[15px] text-ink ring-1 ring-line placeholder:text-ink-faint transition-shadow focus:ring-2 focus:ring-leaf focus:outline-none";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx(FIELD, "h-11", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cx(FIELD, "py-3 leading-relaxed", className)} {...props} />;
  },
);

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-ink-faint">{hint}</span>}
    </label>
  );
}

/**
 * A textarea as tall as its text, so it reads like the page around it rather than a box.
 * It measures again when its width changes, since that changes where lines wrap.
 */
export const GrowingTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function GrowingTextarea({ className, value, ...props }, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    const fit = useCallback(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, []);
    useLayoutEffect(fit, [value, fit]);
    useEffect(() => {
      const el = inner.current;
      if (!el) return;
      let width = el.offsetWidth;
      const observer = new ResizeObserver(() => {
        if (el.offsetWidth !== width) {
          width = el.offsetWidth;
          fit();
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, [fit]);
    return (
      <textarea
        ref={(el) => {
          inner.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        value={value}
        rows={1}
        className={cx("block resize-none overflow-hidden", className)}
        {...props}
      />
    );
  },
);

/** Small-caps label used above groups of content. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-xs font-bold tracking-[0.14em] text-leaf uppercase", className)}>{children}</p>;
}

// ---------------------------------------------------------------------------
// Tags

export const CATEGORY_ICONS: Record<string, ReactNode> = {
  Dish: <UtensilsCrossed className="size-4" />,
  Ingredient: <Wheat className="size-4" />,
  Cuisine: <Globe className="size-4" />,
  Dietary: <Salad className="size-4" />,
  Occasion: <PartyPopper className="size-4" />,
  Method: <Flame className="size-4" />,
  Other: <TagIcon className="size-4" />,
};

export function TagPill({
  name,
  selected,
  excluded,
  onClick,
  onRemove,
}: {
  name: string;
  selected?: boolean;
  /** Shown as a "hide these" filter. */
  excluded?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  const base = cx(
    "inline-flex h-8 items-center gap-1 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
    excluded
      ? "bg-tomato/12 text-tomato ring-1 ring-tomato/35 ring-inset"
      : selected
        ? "bg-leaf text-white dark:text-spine-deep"
        : "bg-leaf-wash text-leaf-strong ring-1 ring-leaf-tint ring-inset",
  );
  if (onRemove) {
    return (
      <span className={cx(base, "group/pill pr-1.5")}>
        {name}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${name}`}
          className="inline-flex size-5 items-center justify-center rounded-full opacity-40 transition-opacity group-hover/pill:opacity-100 hover:bg-black/10 focus-visible:opacity-100"
        >
          <X className="size-3" strokeWidth={2.75} />
        </button>
      </span>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx(base, !selected && "hover:bg-leaf-tint")}>
        {name}
      </button>
    );
  }
  return <span className={base}>{name}</span>;
}

// ---------------------------------------------------------------------------
// Dialog (native <dialog>, which gives focus trapping and Escape for free)

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "paper-grain m-auto w-[calc(100%-3rem)] rounded-3xl bg-paper p-0 text-ink shadow-lift ring-1 ring-black/5 backdrop:bg-spine-deep/45 backdrop:backdrop-blur-[3px] open:animate-pop-in dark:ring-white/10",
        width,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-4 px-7 pt-6 pb-2">
            <h2 className="font-serif text-[28px] leading-tight font-semibold tracking-tight">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X className="size-5" />
            </IconButton>
          </div>
          <div className="scrollbar-quiet overflow-y-auto px-7 pt-1 pb-7">{children}</div>
          {footer && <div className="flex justify-end gap-3 border-t border-line px-7 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts

interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
  action?: { label: string; run: () => void };
  busy?: boolean;
}

type ShowToast = (toast: Omit<Toast, "id">, durationMs?: number) => { dismiss: () => void; update: (t: Partial<Toast>) => void };

const ToastContext = createContext<ShowToast>(() => ({ dismiss() {}, update() {} }));

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ShowToast>((toast, durationMs = 5000) => {
    const id = nextId.current++;
    const dismiss = () => setToasts((list) => list.filter((t) => t.id !== id));
    // Keep the stack short when many recipes arrive at once.
    setToasts((list) => [...list.slice(-2), { ...toast, id }]);
    let timer = durationMs > 0 ? window.setTimeout(dismiss, durationMs) : 0;
    return {
      dismiss,
      update: (patch) => {
        setToasts((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
        if (patch.busy === false) {
          window.clearTimeout(timer);
          timer = window.setTimeout(dismiss, 5000);
        }
      },
    };
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-[28rem] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex w-full animate-rise items-center gap-3 rounded-2xl px-5 py-3.5 text-[15px] shadow-lift",
              t.tone === "error" ? "bg-tomato text-white dark:text-spine-deep" : "bg-spine text-cream",
            )}
          >
            {t.busy && <Spinner className="border-cream/30 border-t-cream" />}
            {!t.busy && t.tone === "success" && <span className="size-2 shrink-0 rounded-full bg-[#9aab55]" />}
            <p className="flex-1 leading-snug">{t.message}</p>
            {t.action && (
              <button
                type="button"
                className="font-semibold underline-offset-2 hover:underline"
                onClick={() => {
                  t.action!.run();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-leaf/25 border-t-leaf", className)}
      aria-hidden
    />
  );
}

/** A small hand-drawn sprig, used as the brand mark and as an ornament. */
/** A rule with a sprig in the middle, between a recipe's top and its ingredients and steps. */
export function Ornament() {
  return (
    <div className="my-14 flex items-center gap-5 text-leaf/50" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <Sprig className="size-7" />
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Sprig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M16 29c0-7 .5-13 3-19" />
      <path d="M16.6 20c-4.5.4-7.6-2-8.6-6.5 4.3-.6 7.6 1.7 8.6 6.5Z" fill="currentColor" fillOpacity="0.18" />
      <path d="M17.6 14.5c3.6-1.4 6.6-.6 8.6 2.4-3.4 1.6-6.5.8-8.6-2.4Z" fill="currentColor" fillOpacity="0.18" />
      <path d="M18.6 9.5c-1.8-3-1.3-5.7 1.2-7.5 1.6 2.8 1.2 5.5-1.2 7.5Z" fill="currentColor" fillOpacity="0.18" />
    </svg>
  );
}
