// Turns schema.org Recipe data (JSON-LD or microdata) into a RecipeDraft.
// Sites fill these fields in many slightly different shapes; everything here
// is defensive about types on purpose.

import type { RecipeDraft, Section } from "../types";
import { parseDuration } from "./duration";
import { cleanLine, cleanText, servingsFrom, splitList } from "./text";

type Json = unknown;
type Node = Record<string, Json>;

function isNode(value: Json): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function types(node: Node): string[] {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.filter((x): x is string => typeof x === "string").map((x) => x.replace(/^.*[/:]/, ""));
}

function asArray(value: Json): Json[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Parses JSON-LD script contents, forgiving the mistakes sites commonly make. */
export function parseJsonLd(text: string): Json {
  const trimmed = text.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/^\s*\/\/.*$/gm, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      // Raw newlines/tabs inside strings are the usual culprit.
      return JSON.parse(trimmed.replace(/[\u0000-\u001f]+/g, " "));
    } catch {
      return null;
    }
  }
}

/** Finds every Recipe node in a JSON-LD document, however deeply nested. */
export function findRecipes(data: Json, depth = 0): Node[] {
  if (depth > 8) return [];
  if (Array.isArray(data)) return data.flatMap((item) => findRecipes(item, depth + 1));
  if (!isNode(data)) return [];
  if (types(data).includes("Recipe")) return [data];
  return ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item", "hasPart"].flatMap(
    (key) => findRecipes(data[key], depth + 1),
  );
}

/** "TO MAKE AHEAD:" -> "To make ahead" */
function cleanHeading(value: Json): string {
  const heading = cleanLine(value).replace(/:$/, "").trim();
  return heading === heading.toUpperCase() && /[A-Z]/.test(heading)
    ? heading.charAt(0) + heading.slice(1).toLowerCase()
    : heading;
}

// Placeholders some sites' templates leak into their data ("4 undefined garlic cloves").
const LEAKED = /\b(?:undefined|null)\b\s*/gi;

function names(value: Json): string[] {
  return asArray(value)
    .map((item) => (isNode(item) ? cleanLine(item.name) : cleanLine(item)))
    .filter((name) => name && !/^(?:undefined|null)$/i.test(name));
}

function resolveUrl(url: string, base: string | null): string | null {
  try {
    return new URL(url, base ?? undefined).href;
  } catch {
    return null;
  }
}

interface ImageCandidate {
  url: string;
  width: number;
}

function imageCandidates(value: Json): ImageCandidate[] {
  return asArray(value).flatMap((item): ImageCandidate[] => {
    if (typeof item === "string") return item.trim() ? [{ url: item.trim(), width: 0 }] : [];
    if (!isNode(item)) return [];
    const url = item.url ?? item.contentUrl;
    if (typeof url === "string") return [{ url, width: Number(item.width) || 0 }];
    return imageCandidates(url);
  });
}

/** Picks a sharp but reasonably sized image: the widest one up to ~2400px. */
export function pickImage(value: Json, base: string | null): string | null {
  const candidates = imageCandidates(value);
  if (candidates.length === 0) return null;
  const sized = candidates.filter((c) => c.width > 0).sort((a, b) => b.width - a.width);
  const best = sized.find((c) => c.width <= 2400) ?? sized.at(-1) ?? candidates[0];
  return resolveUrl(best.url, base);
}

const STEP_NUMBER = /^(?:step\s*)?\d{1,2}\s*[.):-]\s+/i;

function splitSteps(text: string): string[] {
  return cleanText(text)
    .split("\n")
    .map((line) => line.replace(STEP_NUMBER, "").trim())
    .filter(Boolean);
}

function stepText(node: Node): string[] {
  const text = cleanText(node.text);
  const name = cleanText(node.name);
  if (text) {
    // Some sites put a short title in `name` and the step in `text`; others repeat it.
    const lead = name && !text.startsWith(name) && name.length < 80 && !name.endsWith(".") ? `${name}. ` : "";
    return splitSteps(lead + text);
  }
  if (node.itemListElement) return asArray(node.itemListElement).flatMap((x) => (isNode(x) ? stepText(x) : splitSteps(String(x))));
  return name ? splitSteps(name) : [];
}

/** Normalizes recipeInstructions into sections of steps. */
export function instructionSections(value: Json): Section[] {
  const sections: Section[] = [];
  let loose: Section | null = null;
  const addLoose = (steps: string[]) => {
    if (steps.length === 0) return;
    if (!loose) {
      loose = { heading: "", items: [] };
      sections.push(loose);
    }
    loose.items.push(...steps);
  };

  for (const item of asArray(value)) {
    if (typeof item === "string") {
      addLoose(splitSteps(item));
    } else if (isNode(item)) {
      const t = types(item);
      if (t.includes("HowToSection") || (t.includes("ItemList") && item.itemListElement)) {
        const steps = asArray(item.itemListElement).flatMap((x) =>
          isNode(x) ? stepText(x) : splitSteps(String(x)),
        );
        if (steps.length) sections.push({ heading: cleanHeading(item.name), items: steps });
        loose = null;
      } else {
        addLoose(stepText(item));
      }
    }
  }
  return sections.filter((s) => s.items.length > 0);
}

/** A short line ending in a colon with no quantities, e.g. "For the glaze:". */
function looksLikeHeading(line: string): boolean {
  return line.length <= 48 && /:$/.test(line) && !/\d/.test(line);
}

/** Normalizes recipeIngredient into sections, recognizing "For the X:" headings. */
export function ingredientSections(value: Json): Section[] {
  const lines = asArray(value).flatMap((item) =>
    typeof item === "string" ? cleanText(item).split("\n") : isNode(item) ? [cleanLine(item.name ?? item.text)] : [],
  );
  const sections: Section[] = [];
  let current: Section = { heading: "", items: [] };
  for (const raw of lines) {
    const line = raw.replace(LEAKED, "").trim();
    if (!line) continue;
    if (looksLikeHeading(line)) {
      if (current.items.length || current.heading) sections.push(current);
      current = { heading: cleanHeading(line), items: [] };
    } else {
      current.items.push(line);
    }
  }
  sections.push(current);
  return sections.filter((s) => s.items.length > 0);
}

/**
 * How many the recipe serves, from a yield that says so ("Serves 6", "4 servings", a bare
 * "4"). A yield that counts what it makes instead, like "4 dozen cookies", isn't kept.
 */
function pickServings(value: Json): string | null {
  const options = asArray(value).map(cleanLine).filter(Boolean);
  const servings = options.find((o) => /serv|people|person|portion/i.test(o) || /^(about\s+)?\d+(\s*(-|–|to)\s*\d+)?\s*($|[,;(])/i.test(o));
  return servingsFrom(servings);
}

function hostName(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function cleanTitle(title: string): string {
  const stripped = title.replace(/\s+recipe$/i, "");
  return stripped.includes(" ") ? stripped : title;
}

export interface PageMeta {
  url: string | null;
  siteName: string | null;
  title: string | null;
  description: string | null;
  image: string | null;
}

export function draftFromSchema(node: Node, page: PageMeta): RecipeDraft {
  const sourceUrl = page.url ?? resolveUrl(String(node.url ?? ""), null);
  const publisher = names(node.publisher)[0] ?? null;
  const sourceName = page.siteName ?? publisher ?? hostName(sourceUrl);
  const authors = names(node.author).filter((a) => a !== sourceName);
  const prep = parseDuration(node.prepTime);
  const cook = parseDuration(node.cookTime);
  const total = parseDuration(node.totalTime) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null);

  return {
    title: cleanTitle(cleanLine(node.name ?? node.headline) || page.title || ""),
    description: cleanText(node.description) || page.description || "",
    sourceUrl,
    sourceName,
    author: authors.length ? authors.join(", ") : null,
    imageUrl: pickImage(node.image ?? node.thumbnailUrl, sourceUrl) ?? page.image,
    servings: pickServings(node.recipeYield ?? node.yield),
    prepMinutes: prep,
    cookMinutes: cook,
    totalMinutes: total,
    ingredients: ingredientSections(node.recipeIngredient ?? node.ingredients),
    instructions: instructionSections(node.recipeInstructions),
    tips: [],
    unused: "",
    keywords: splitList(node.keywords).filter((k) => !/^\d+$/.test(k)),
    categories: splitList(node.recipeCategory),
    cuisines: splitList(node.recipeCuisine),
  };
}
