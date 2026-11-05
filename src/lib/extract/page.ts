import type { RecipeDraft } from "../types";
import { draftFromSchema, findRecipes, parseJsonLd, type PageMeta } from "./schema";
import { cleanLine } from "./text";

export interface Extraction {
  draft: RecipeDraft;
  /** False when we found little more than a title; the page needs another approach. */
  complete: boolean;
  doc: Document;
}

function meta(doc: Document, ...keys: string[]): string | null {
  for (const key of keys) {
    const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
    const content = cleanLine(el?.getAttribute("content"));
    if (content) return content;
  }
  return null;
}

function canonicalUrl(doc: Document, fallback: string | null): string | null {
  const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? meta(doc, "og:url");
  if (!href) return fallback;
  try {
    const url = new URL(href, fallback ?? undefined);
    // A canonical link pointing at a different site is a mistake we shouldn't follow.
    if (fallback && new URL(fallback).hostname !== url.hostname) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}

export function pageMeta(doc: Document, url: string | null): PageMeta {
  const pageUrl = canonicalUrl(doc, url);
  const image = meta(doc, "og:image", "twitter:image");
  let imageUrl: string | null = null;
  try {
    imageUrl = image ? new URL(image, pageUrl ?? undefined).href : null;
  } catch {
    /* ignore malformed og:image */
  }
  return {
    url: pageUrl,
    siteName: meta(doc, "og:site_name", "application-name"),
    title: meta(doc, "og:title", "twitter:title") ?? (cleanLine(doc.title) || null),
    description: meta(doc, "og:description", "description"),
    image: imageUrl,
  };
}

function score(draft: RecipeDraft): number {
  const count = (sections: RecipeDraft["ingredients"]) => sections.reduce((n, s) => n + s.items.length, 0);
  return count(draft.ingredients) + count(draft.instructions);
}

// Properties whose markup carries structure (paragraphs, list items) worth keeping.
const RICH_PROPS = new Set(["recipeInstructions", "description"]);
const LIST_PROPS = new Set(["recipeIngredient", "ingredients", "recipeInstructions", "image", "recipeCategory", "recipeCuisine"]);

function itemValue(el: Element, prop: string): string | null {
  return (
    el.getAttribute("content") ??
    el.getAttribute("datetime") ??
    (el.tagName === "IMG" ? (el.getAttribute("src") ?? el.getAttribute("data-src")) : null) ??
    (el.tagName === "META" ? null : RICH_PROPS.has(prop) ? el.innerHTML : el.textContent)
  );
}

/**
 * Reads recipes marked up in HTML rather than JSON-LD: schema.org microdata
 * (itemprop attributes) and the h-recipe microformat (p-name, p-ingredient,
 * e-instructions classes). WordPress recipe blocks often use one or both.
 */
function markupRecipe(doc: Document): Record<string, unknown> | null {
  const root = doc.querySelector('[itemtype*="schema.org/Recipe" i], .h-recipe, .hrecipe');
  if (!root) return null;
  const node: Record<string, unknown> = { "@type": "Recipe" };
  for (const el of root.querySelectorAll("[itemprop]")) {
    const prop = el.getAttribute("itemprop")!;
    const value = itemValue(el, prop);
    if (!value) continue;
    if (LIST_PROPS.has(prop)) node[prop] = [...((node[prop] as unknown[] | undefined) ?? []), value];
    else if (!(prop in node)) node[prop] = value;
  }
  const byClass = (selector: string) => [...root.querySelectorAll(selector)];
  node.name ??= byClass(".p-name")[0]?.textContent;
  node.recipeIngredient ??= byClass(".p-ingredient").map((el) => el.textContent);
  node.recipeInstructions ??= byClass(".e-instructions").map((el) => el.innerHTML);
  node.recipeYield ??= byClass(".p-yield")[0]?.textContent;
  return node;
}

export function extractFromHtml(html: string, url: string | null): Extraction {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const page = pageMeta(doc, url);

  const nodes = [...doc.querySelectorAll('script[type="application/ld+json" i]')].flatMap((script) =>
    findRecipes(parseJsonLd(script.textContent ?? "")),
  );
  const markup = markupRecipe(doc);
  if (markup) nodes.push(markup);

  const drafts = nodes.map((node) => draftFromSchema(node, page)).sort((a, b) => score(b) - score(a));
  const best = drafts[0];
  if (best && score(best) > 0) {
    return { draft: best, complete: best.ingredients.length > 0 && best.instructions.length > 0, doc };
  }

  return {
    draft: best ?? {
      title: page.title ?? "",
      description: page.description ?? "",
      sourceUrl: page.url,
      sourceName: page.siteName ?? (page.url ? new URL(page.url).hostname.replace(/^www\./, "") : null),
      author: null,
      imageUrl: page.image,
      yields: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      ingredients: [],
      instructions: [],
      tips: [],
      keywords: [],
      categories: [],
      cuisines: [],
    },
    complete: false,
    doc,
  };
}

/**
 * The readable text of a page, for when an LLM has to find the recipe itself.
 * Drops navigation, ads and scripts so the prompt stays small.
 */
export function readableText(doc: Document, limit = 60_000): string {
  const clone = doc.body?.cloneNode(true) as HTMLElement | undefined;
  if (!clone) return "";
  clone
    .querySelectorAll(
      "script, style, noscript, svg, iframe, nav, footer, header, aside, form, button, [aria-hidden=true], " +
        // Reader comments can dwarf the recipe itself (hundreds of thousands of characters on popular blogs).
        "#comments, #respond, .comments, .comments-area, .comment-list, .commentlist, .comment",
    )
    .forEach((el) => el.remove());
  const main = clone.querySelector("main, article, [role=main]") ?? clone;
  const text = (main.textContent ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text.slice(0, limit);
}
