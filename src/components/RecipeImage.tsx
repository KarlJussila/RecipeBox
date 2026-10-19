import { useEffect, useState } from "react";
import { imageSrc } from "../lib/api";
import { cx, Sprig } from "./ui";

/** A recipe photo, or a soft placeholder with the recipe's initial when there isn't one. */
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
      title={title}
      className={cx("relative flex items-center justify-center overflow-hidden bg-leaf-wash text-leaf/40", className)}
    >
      <span className="font-serif text-[min(9rem,40%)] leading-none font-semibold italic opacity-60">{title.trim().charAt(0) || "·"}</span>
      <Sprig className="absolute right-[8%] bottom-[8%] size-[18%] opacity-60" />
    </div>
  );
}
