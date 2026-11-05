import { Link2, PenLine, Puzzle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dialog, Input, Spinner } from "./ui";

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+\.\S+/i.test(text.trim());
}

export function AddRecipeDialog({
  open,
  onClose,
  onImport,
  onWriteOwn,
  onShowExtensionHelp,
}: {
  open: boolean;
  onClose: () => void;
  /** Resolves with an error message, or null on success. */
  onImport: (url: string) => Promise<string | null>;
  onWriteOwn: () => void;
  onShowExtensionHelp: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl("");
      setError(null);
      setBusy(false);
      // Pre-fill from the clipboard when it holds a link; that's usually why the dialog was opened.
      navigator.clipboard
        ?.readText()
        .then((text) => looksLikeUrl(text) && setUrl(text.trim()))
        .catch(() => {});
    }
  }, [open]);

  const submit = async () => {
    if (!looksLikeUrl(url)) {
      setError("That doesn't look like a web address. It should start with https://");
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onImport(url.trim());
    setBusy(false);
    if (message) setError(message);
    else onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add a recipe" width="max-w-xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="recipe-url" className="flex items-center gap-2 text-[15px] font-semibold text-ink-soft">
          <Link2 className="size-4 text-leaf" />
          Paste a link to a recipe
        </label>
        <div className="mt-2 flex gap-2">
          <Input
            id="recipe-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://cooking.nytimes.com/recipes/…"
            autoFocus
            disabled={busy}
            className="h-12 rounded-2xl text-base"
          />
          <Button type="submit" variant="primary" size="lg" disabled={busy || !url.trim()}>
            {busy ? <><Spinner className="border-current/30 border-t-current" /> Adding…</> : "Add"}
          </Button>
        </div>
        {error && <p className="mt-2 text-[15px] leading-snug text-tomato">{error}</p>}
      </form>

      <div className="mt-6 rounded-2xl bg-leaf-wash p-4 ring-1 ring-leaf-tint">
        <p className="flex items-start gap-3 text-[15px] leading-relaxed text-ink">
          <Puzzle className="mt-0.5 size-5 shrink-0 text-leaf" />
          <span>
            For subscription sites like NYT Cooking, use the <strong>Recipe Box button</strong> in Chrome while you’re
            looking at the recipe. It saves the recipe exactly as you see it.{" "}
            <button type="button" onClick={onShowExtensionHelp} className="font-semibold text-leaf-strong underline underline-offset-2">
              Set it up
            </button>
          </span>
        </p>
      </div>

      <div className="mt-5 flex items-center justify-center">
        <Button variant="ghost" icon={<PenLine className="size-4" />} onClick={onWriteOwn}>
          Or type in a recipe yourself
        </Button>
      </div>
    </Dialog>
  );
}
