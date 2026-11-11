import { dropFiller, tidyNotes } from "../steps";
import type { RecipeDraft, Section } from "../types";
import { draftFromSchema, findRecipes, parseJsonLd, type PageMeta } from "./schema";
import { cleanLine, cleanText } from "./text";

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

// Recipe card plugins show the recipe's notes on the card but leave them out of its
// structured data, though steps and ingredients point at them ("Note 2").
// WP Recipe Maker, Tasty Recipes, Mediavine Create, and Jetpack, most specific first.
const CARD_NOTES = [
  ".wprm-recipe-notes",
  ".wprm-recipe-notes-container",
  ".tasty-recipes-notes-body",
  ".tasty-recipes-notes",
  ".mv-create-notes-content",
  ".mv-create-notes",
  ".jetpack-recipe-notes",
];

/** The recipe card's notes, one per paragraph or list item, leaving out any the steps already have. */
function cardNotes(doc: Document, draft: RecipeDraft): Section[] {
  const found = CARD_NOTES.map((selector) => doc.querySelector(selector)).find(Boolean);
  if (!found) return [];
  const notes = found.cloneNode(true) as Element;
  notes.querySelectorAll("h1, h2, h3, h4, h5, h6, .wprm-recipe-header, script, style, .adthrive-ad").forEach((el) => el.remove());
  // WP Recipe Maker sets each note in a span styled as a block.
  notes.querySelectorAll("span[style*='block']").forEach((el) => el.after("\n"));
  const known = new Set([...draft.instructions, ...draft.tips].flatMap((s) => s.items));
  const items = cleanText(notes.innerHTML)
    .split("\n")
    // WP Recipe Maker's note on the nutrition facts, which Recipe Box doesn't show.
    .filter((line) => !known.has(line) && !/^(?:\d+\.\s*)?nutrition\b/i.test(line))
    .map(dropFiller)
    .filter(Boolean);
  return tidyNotes([{ heading: "", items }]);
}

/**
 * A recipe told in a few paragraphs, with no ingredient list or steps, like NYT Cooking's
 * "no-recipe recipes". Its recipe data has only the prose, as the description; a summary
 * that long is the recipe itself.
 */
function isProseRecipe(draft: RecipeDraft): boolean {
  return draft.ingredients.length === 0 && draft.instructions.length === 0 && draft.description.length >= 400;
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
  if (best && (score(best) > 0 || isProseRecipe(best))) {
    best.tips = [...best.tips, ...cardNotes(doc, best)];
    if (isProseRecipe(best)) {
      best.instructions = [{ heading: "", items: [best.description] }];
      best.description = "";
      return { draft: best, complete: true, doc };
    }
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
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      totalMinutes: null,
      ingredients: [],
      instructions: [],
      tips: [],
      unused: "",
      keywords: [],
      categories: [],
      cuisines: [],
    },
    complete: false,
    doc,
  };
}

const SKIPPED =
  "script, style, noscript, template, svg, iframe, video, audio, canvas, nav, footer, header, aside, form, button, dialog, " +
  // Things the page doesn't show, such as share buttons' labels for screen readers.
  "[hidden], [aria-hidden=true], [style*='display:none'], [style*='display: none'], " +
  // Share buttons. Only classes that start with these words: WordPress turns a post's
  // tags into classes on the article itself, like "tag-social-gatherings".
  '.sharedaddy, [class^="share"], [class*=" share"], [class^="sharing"], [class*=" sharing"], [class^="social"], [class*=" social"], ' +
  // Reader comments can dwarf the recipe itself (hundreds of thousands of characters on popular blogs).
  "#comments, #respond, .comments, .comments-area, .comment-list, .commentlist, .comment, " +
  // MediaWiki's "[edit | edit source]" links beside each heading.
  ".mw-editsection";

// Blog sidebars: archives, category lists, profiles. Blogger wraps the post itself in a widget too.
const SIDEBARS = "#sidebar, [id^=sidebar], .sidebar, .widget";
const POST = "article, [itemprop=articleBody], .post-body, .entry-content, .post, h1";

const BLOCKS = new Set([
  "ADDRESS", "ARTICLE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE", "HR", "LI", "MAIN",
  "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TR", "UL",
]);
const CELLS = new Set(["TD", "TH"]);
const EMPHASIS = new Set(["B", "STRONG", "U"]);

/**
 * A gap of three or more non-breaking spaces inside a line, which lines up a second
 * column, as on a recipe card typed with its ingredients side by side.
 */
const COLUMN_GAP = /\s*(?:\u00a0\s*){3,}/;

/** Collects a page's text as Markdown lines. */
class Lines {
  lines: string[] = [];
  /** Each line's link texts, like the name of another recipe in a list of them. */
  links: string[][] = [];
  /** Each line's two cells when spaces line it up as two columns. */
  private columns: (string[] | null)[] = [];
  private parts: { text: string; emphasized: boolean; linked: boolean }[] = [];
  private prefix = "";

  private newCell = false;

  add(text: string, emphasized: boolean, linked: boolean) {
    if (this.newCell && text.trim()) {
      // Between two cells with text; empty cells get no separator. It doesn't count against a bold heading.
      if (this.parts.some((p) => p.text.trim())) this.parts.push({ text: " | ", emphasized: true, linked: false });
      this.newCell = false;
    }
    this.parts.push({ text, emphasized, linked });
  }

  /**
   * Adds preformatted text, like an email in a mailing-list archive, where a newline ends
   * a line. A line as long as the email's wrap width continues on the next one.
   */
  addPreformatted(text: string, emphasized: boolean, linked: boolean) {
    text.split("\n").forEach((segment, i, all) => {
      this.add(segment, emphasized, linked);
      if (i === all.length - 1) return;
      const length = this.parts.map((p) => p.text).join("").trim().length;
      if (length >= 60 && all[i + 1].trim()) this.add(" ", emphasized, linked);
      else this.end();
    });
  }

  /** Starts a table cell. A row stays one line, with its cells separated. */
  cell() {
    this.newCell = true;
  }

  /** Starts a list item, whose first line gets the marker. */
  item(marker: string) {
    this.end();
    this.prefix = marker;
  }

  /** Ends the current line. */
  end() {
    const raw = this.parts.map((p) => p.text).join("").trim();
    const line = raw.replace(/\s+/g, " ");
    if (line) {
      // A line that's all bold or underlined is usually a heading, like "For the sauce".
      const heading = this.parts.every((p) => p.emphasized || !p.text.trim());
      const cells = raw.split(COLUMN_GAP).map((cell) => cell.replace(/\s+/g, " "));
      this.lines.push(this.prefix + (heading ? `**${line}**` : line));
      this.links.push(this.linkTexts());
      this.columns.push(!this.prefix && !heading && cells.length === 2 ? cells : null);
      this.prefix = "";
    }
    this.parts = [];
  }

  /** The current line's link texts: runs of linked parts. */
  private linkTexts(): string[] {
    const texts: string[] = [];
    let run = "";
    const close = () => {
      if (run.trim()) texts.push(run.replace(/\s+/g, " ").trim());
      run = "";
    };
    for (const part of this.parts) {
      if (part.linked) run += part.text;
      else close();
    }
    close();
    return texts;
  }

  heading(level: number, text: string) {
    this.end();
    const line = text.replace(/\s+/g, " ").trim();
    if (line) {
      // A heading that's a link is usually a post's title, linking to the post itself.
      this.lines.push(`${"#".repeat(level)} ${line}`);
      this.links.push([]);
      this.columns.push(null);
    }
  }

  /**
   * Reads three or more rows lined up as two columns down the left column, then the
   * right, joining a cell that starts in lowercase to the one above it, since it
   * continues that ingredient. Rows like "Prep time:   10 min" stay as they are.
   */
  unfoldColumns() {
    const lines: string[] = [];
    const links: string[][] = [];
    for (let i = 0; i < this.lines.length; ) {
      let j = i;
      while (this.columns[j]) j++;
      const rows = this.columns.slice(i, j) as string[][];
      // Amounts spaced out from their ingredients, like "1   cup sugar", aren't a column.
      if (rows.length < 3 || rows.some(([left]) => left.endsWith(":") || !/\p{L}{3}/u.test(left))) {
        lines.push(...this.lines.slice(i, Math.max(j, i + 1)));
        links.push(...this.links.slice(i, Math.max(j, i + 1)));
        i = Math.max(j, i + 1);
        continue;
      }
      for (const side of [0, 1]) {
        const cells: string[] = [];
        for (const cell of rows.map((row) => row[side])) {
          if (cells.length > 0 && /^[a-z]/.test(cell)) cells[cells.length - 1] += ` ${cell}`;
          else cells.push(cell);
        }
        lines.push(...cells);
        links.push(...cells.map(() => []));
      }
      i = j;
    }
    this.lines = lines;
    this.links = links;
    this.columns = lines.map(() => null);
  }
}

function collect(node: Node, out: Lines, emphasized: boolean, preformatted = false, linked = false) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (preformatted) out.addPreformatted(node.textContent ?? "", emphasized, linked);
    else out.add(node.textContent ?? "", emphasized, linked);
    return;
  }
  if (!(node instanceof Element)) return;
  const tag = node.tagName;
  const heading = /^H([1-6])$/.exec(tag);
  if (heading) return out.heading(Number(heading[1]), node.textContent ?? "");
  if (tag === "BR") return out.end();
  if (tag === "LI") out.item(node.parentElement?.tagName === "OL" ? "1. " : "- ");
  else if (CELLS.has(tag)) out.cell();
  else if (BLOCKS.has(tag)) out.end();
  for (const child of node.childNodes) collect(child, out, emphasized || EMPHASIS.has(tag), preformatted || tag === "PRE", linked || tag === "A");
  if (BLOCKS.has(tag)) out.end();
}

const headingLevel = (line: string) => /^(#+) /.exec(line)?.[1].length ?? null;

/** A page's readable text, and the link texts on each of its lines. */
export interface ReadablePage {
  text: string;
  /** Each line's link texts, like the name of another recipe in a list of them. */
  links: string[][];
}

/**
 * The readable text of a page as Markdown, for when an LLM has to find the recipe
 * itself. Keeps headings, lists, and line breaks, and drops navigation, ads, share
 * buttons, and scripts so the prompt stays small.
 */
export function readableText(doc: Document, limit = 60_000): string {
  return readablePage(doc, limit).text;
}

/** The page's readable text (see readableText), with each line's link texts. */
export function readablePage(doc: Document, limit = 60_000): ReadablePage {
  const clone = doc.body?.cloneNode(true) as HTMLElement | undefined;
  if (!clone) return { text: "", links: [] };
  clone.querySelectorAll(SKIPPED).forEach((el) => el.remove());
  clone.querySelectorAll(SIDEBARS).forEach((el) => {
    if (!el.querySelector(POST) && !el.closest(".post-body, .entry-content")) el.remove();
  });
  const out = new Lines();
  collect(clone.querySelector("main, article, [role=main]") ?? clone, out, false);
  out.end();
  out.unfoldColumns();
  // A heading with nothing under it, like "Video" over a removed player, is left over.
  const kept = out.lines.flatMap((line, i, all) => {
    const level = headingLevel(line);
    const next = all[i + 1];
    const nextLevel = next === undefined ? 0 : headingLevel(next);
    return level === null || nextLevel === null || nextLevel > level ? [i] : [];
  });
  const text = kept.map((i) => out.lines[i]).join("\n").slice(0, limit);
  const count = text.split("\n").length;
  return { text, links: kept.slice(0, count).map((i) => out.links[i]) };
}
