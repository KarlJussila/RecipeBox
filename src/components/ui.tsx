import { X } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
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
  primary:
    "bg-leaf-700 text-white shadow-sm hover:bg-leaf-800 active:bg-leaf-900 dark:bg-leaf-600 dark:hover:bg-leaf-500",
  secondary:
    "bg-white text-stone-800 ring-1 ring-stone-300/80 shadow-sm hover:bg-stone-50 active:bg-stone-100 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-700 dark:hover:bg-stone-700",
  ghost: "text-stone-700 hover:bg-stone-200/60 active:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-800",
  danger: "bg-red-700 text-white shadow-sm hover:bg-red-800 active:bg-red-900",
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
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-[15px]",
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
        "inline-flex size-10 items-center justify-center rounded-lg transition-colors duration-150",
        active
          ? "bg-leaf-100 text-leaf-800 dark:bg-leaf-900/60 dark:text-leaf-200"
          : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
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
  "w-full rounded-lg bg-white px-3 text-[15px] text-stone-900 ring-1 ring-stone-300/80 placeholder:text-stone-400 transition-shadow focus:ring-2 focus:ring-leaf-600 focus:outline-none dark:bg-stone-900 dark:text-stone-100 dark:ring-stone-700 dark:focus:ring-leaf-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cx(FIELD, "h-10", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cx(FIELD, "py-2.5 leading-relaxed", className)} {...props} />;
  },
);

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-stone-500 dark:text-stone-400">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tags

export function TagChip({
  name,
  selected,
  onClick,
  onRemove,
  size = "md",
}: {
  name: string;
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  size?: "sm" | "md";
}) {
  const base = cx(
    "inline-flex items-center gap-1 rounded-full font-medium transition-colors duration-150",
    size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[13px]",
    selected
      ? "bg-leaf-700 text-white dark:bg-leaf-600"
      : "bg-leaf-50 text-leaf-800 ring-1 ring-leaf-200/80 ring-inset dark:bg-leaf-950/60 dark:text-leaf-200 dark:ring-leaf-800/60",
  );
  if (onRemove) {
    return (
      <span className={cx(base, "group/chip pr-1")}>
        {name}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${name}`}
          className={cx(
            "inline-flex size-5 items-center justify-center rounded-full transition-opacity",
            selected ? "hover:bg-white/20" : "hover:bg-leaf-200/70 dark:hover:bg-leaf-800",
            // Quiet until needed, so a recipe's tags read as labels rather than a form.
            !selected && "opacity-40 group-hover/chip:opacity-100 focus-visible:opacity-100",
          )}
        >
          <X className="size-3" strokeWidth={2.5} />
        </button>
      </span>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cx(base, !selected && "hover:bg-leaf-100 dark:hover:bg-leaf-900")}>
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
        "m-auto w-[calc(100%-3rem)] rounded-2xl bg-stone-50 p-0 text-stone-900 shadow-2xl ring-1 ring-stone-900/5 backdrop:bg-stone-950/40 backdrop:backdrop-blur-[2px] open:animate-pop-in dark:bg-stone-900 dark:text-stone-100 dark:ring-white/10",
        width,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
            <h2 className="font-serif text-2xl font-semibold tracking-tight">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X className="size-5" />
            </IconButton>
          </div>
          <div className="scrollbar-quiet overflow-y-auto px-6 pb-6">{children}</div>
          {footer && (
            <div className="flex justify-end gap-3 border-t border-stone-200 px-6 py-4 dark:border-stone-800">{footer}</div>
          )}
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
    setToasts((list) => [...list, { ...toast, id }]);
    let timer = durationMs > 0 ? window.setTimeout(dismiss, durationMs) : 0;
    return {
      dismiss,
      update: (patch) => {
        setToasts((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
        // A toast that finished its work should go away on its own.
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
      <div className="no-print pointer-events-none fixed right-6 bottom-6 z-50 flex w-96 flex-col gap-3" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex animate-slide-up items-start gap-3 rounded-xl px-4 py-3 text-[15px] shadow-lift ring-1",
              t.tone === "error"
                ? "bg-red-50 text-red-900 ring-red-200 dark:bg-red-950 dark:text-red-100 dark:ring-red-900"
                : "bg-white text-stone-800 ring-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-700",
            )}
          >
            {t.busy && <Spinner className="mt-0.5" />}
            {!t.busy && t.tone === "success" && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-leaf-500" />}
            <p className="flex-1 leading-snug">{t.message}</p>
            {t.action && (
              <button
                type="button"
                className="font-semibold text-leaf-700 hover:text-leaf-900 dark:text-leaf-300"
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
      className={cx(
        "inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-leaf-600/25 border-t-leaf-600 dark:border-leaf-400/25 dark:border-t-leaf-400",
        className,
      )}
      aria-hidden
    />
  );
}
