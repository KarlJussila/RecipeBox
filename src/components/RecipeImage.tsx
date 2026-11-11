import { useEffect, useState } from "react";
import { imageSrc } from "../lib/api";
import { cx, Sprig } from "./ui";

/**
 * A recipe photo, or a placeholder with the recipe's initial when there isn't one.
 * `card` shows the small copy made for the recipe grid.
 */
export function RecipeImage({ file, title, card, className }: { file: string | null; title: string; card?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [file]);
  const src = imageSrc(file, card);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        // Linux webviews refuse no-cors loads from the app's image protocol.
        crossOrigin="anonymous"
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cx("object-cover", className)}
      />
    );
  }
  return (
    <div
      aria-hidden
      title={title}
      className={cx(
        "relative flex items-center justify-center overflow-hidden bg-(--stock-patch) text-[rgb(110_80_40/0.45)] ring-1 ring-[rgb(120_85_30/0.12)] ring-inset dark:text-ink-faint",
        className,
      )}
    >
      {/* A darker patch of the card, with the initial in her hand and a faint sprig. */}
      <span className="font-hand text-[clamp(48px,30cqw,110px)] leading-none">{title.trim().charAt(0) || "·"}</span>
      <Sprig className="absolute right-[8%] bottom-[8%] size-[18%] text-leaf/50" />
    </div>
  );
}
