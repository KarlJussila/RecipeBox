import { flushSync } from "react-dom";

export const prefersStill = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Applies a change to the page as a view transition, so named pieces (the recipe card,
 * its photo, the ingredients) move to their new places instead of jumping. Where the
 * webview has no view transitions, or motion is turned down, the change just happens.
 */
export function turnPage(update: () => void): void {
  if (!document.startViewTransition || prefersStill()) {
    update();
    return;
  }
  const root = document.documentElement;
  // Entrance animations finish at once while the new page is captured (see styles.css).
  root.classList.add("turning");
  const transition = document.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => root.classList.remove("turning"));
}
