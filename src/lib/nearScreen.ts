import { createContext, useEffect, useState, type RefObject } from "react";

/**
 * Tells elements in a long scrolling list when they come within reach of the screen, so
 * their photos can start loading a screen or so ahead. The recipe grid skips drawing
 * cards that are off screen, and `loading="lazy"` wouldn't start a photo until its card
 * was drawn, which is too late.
 */
export interface NearScreen {
  watch(el: Element, onNear: () => void): () => void;
  stop(): void;
}

/** `getRoot` is asked for the scrolling element the first time something is watched. */
export function nearScreen(getRoot: () => Element | null, margin = "150% 0px"): NearScreen {
  let observer: IntersectionObserver | null = null;
  const waiting = new Map<Element, () => void>();
  return {
    watch(el, onNear) {
      observer ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            waiting.get(entry.target)?.();
            waiting.delete(entry.target);
            observer?.unobserve(entry.target);
          }
        },
        { root: getRoot(), rootMargin: margin },
      );
      waiting.set(el, onNear);
      observer.observe(el);
      return () => {
        waiting.delete(el);
        observer?.unobserve(el);
      };
    },
    stop() {
      observer?.disconnect();
      observer = null;
      waiting.clear();
    },
  };
}

/** The nearest ancestor that scrolls up and down, which is what "near the screen" is measured against. */
export function scrollParent(el: Element | null): Element | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/** Whether the element has come near the screen yet; once it has, it stays true. */
export function useNearScreen(near: NearScreen, ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    return near.watch(ref.current, () => setSeen(true));
  }, [near, seen, ref]);
  return seen;
}

/**
 * Whether photos inside should load yet. A list that watches what's near the screen sets
 * it; elsewhere it's null and the browser decides.
 */
export const LoadPhotos = createContext<boolean | null>(null);
