import { CookingPot } from "lucide-react";
import { useEffect, useState } from "react";
import { imageSrc } from "../lib/api";
import { cx } from "./ui";

/** A recipe photo, or a soft green placeholder when there isn't one. */
export function RecipeImage({ file, title, className }: { file: string | null; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [file]);
  const src = imageSrc(file);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        // Linux webviews refuse no-cors loads from the app's image protocol.
        crossOrigin="anonymous"
        draggable={false}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cx("object-cover", className)}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cx(
        "flex items-center justify-center bg-gradient-to-br from-leaf-100 via-leaf-50 to-stone-100 text-leaf-600/60 dark:from-leaf-950 dark:via-stone-900 dark:to-stone-900 dark:text-leaf-700",
        className,
      )}
      title={title}
    >
      <CookingPot className="size-1/4 max-h-16 max-w-16" strokeWidth={1.25} />
    </div>
  );
}
