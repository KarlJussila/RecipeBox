import { useSyncExternalStore } from "react";

/** Whether a media query matches, kept current as the window changes. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/**
 * Wide enough for a recipe's ingredients to sit on their own sheet beside the card.
 * Narrower, the recipe takes the whole window and the ingredients go back on the card.
 */
export const SHEET_QUERY = "(min-width: 1000px)";

/** Wide enough for the index to stand beside the box; narrower, it's tucked behind a menu button. */
export const INDEX_QUERY = "(min-width: 900px)";
