// The page an AI-read recipe came from, kept with the recipe so the cook can see what
// each line of the page became and fix what the reader got wrong.

import { clean, group, headingText } from "./page-lines";
import { splitTips } from "./steps";
import type { Section } from "./types";

/** What a line of the page became in the recipe. */
export type LinePart = "description" | "ingredient" | "step" | "tip";

/** The parts of a recipe that come in sections under headings. */
export type HeadedPart = "ingredient" | "step" | "tip";

export interface SourcePage {
  /** The page's lines, as the reader saw them. */
  lines: string[];
  /** What each line became, or null for a line left out or used only as a heading. */
  parts: (LinePart | null)[];
  /**
   * The lines the recipe's sections come under, like "For the cake", and the part each
   * heads. A line that heads both a part's ingredients and its steps is here twice.
   */
  headings: { line: number; of: HeadedPart }[];
  /** The line the recipe's name came from, when the page has it. */
  titleLine: number | null;
  /** Ingredients copied from inside a sentence, like "2 cups flour" from a step. */
  quotes: { line: number; text: string }[];
}

export interface PageParts {
  description: string;
  ingredients: Section[];
  instructions: Section[];
  tips: Section[];
}

/**
 * Finds the headings the recipe's sections come under, from how the page writes them.
 * The reader does this once; after that, the headings kept with the page are what
 * count, so one taken wrongly can be unmarked.
 */
export function markHeadings(source: Omit<SourcePage, "headings">): SourcePage {
  const { lines, parts, titleLine } = source;
  // Steps come under a part's heading when each part has its own ingredients and then
  // its steps. When all the steps follow all the ingredients, the last part's heading
  // heads only its ingredients.
  const firstStep = parts.indexOf("step");
  const interleaved = firstStep >= 0 && parts.some((p, i) => p === "ingredient" && i > firstStep);
  const found = sections({ ...source, headings: [] }, (i) => (i === titleLine ? null : headingText(lines[i] ?? "")), interleaved);
  const headings = (["ingredient", "step", "tip"] as const).flatMap((of) => found[of].flatMap(({ line }) => (line === null ? [] : [{ line, of }])));
  return { ...source, headings };
}

/** The recipe's parts as the page's lines make them. */
export function partsToRecipe(source: SourcePage): PageParts {
  const { lines, parts, headings } = source;
  const heading = (i: number, of: HeadedPart) =>
    headings.some((h) => h.line === i && h.of === of) ? (headingText(lines[i]) ?? clean(lines[i]).replace(/:\s*$/, "")) : null;
  const found = sections(source, heading, true);
  // Trailing "Do ahead: ..." steps move to the tips, as they do on import.
  const { steps, tips } = splitTips(found.step.map((g) => g.section));
  return {
    description: parts.flatMap((p, i) => (p === "description" ? [clean(lines[i])] : [])).join("\n\n"),
    ingredients: found.ingredient.map((g) => g.section),
    instructions: steps,
    tips: [...tips, ...found.tip.map((g) => g.section)],
  };
}

/**
 * The page with one line made into something else: a part of the recipe, a heading, or
 * nothing. `heading` names the line's heading being changed, when it is one; setting
 * that to nothing leaves the line's other heading, if it heads two parts.
 */
export function choosePart(source: SourcePage, line: number, choice: LinePart | "heading" | null, heading?: HeadedPart): SourcePage {
  if (heading ? choice === "heading" : source.parts[line] === choice) return source;
  // A new heading heads the part that follows it.
  const next = source.parts.slice(line + 1).find((p): p is HeadedPart => p === "ingredient" || p === "step" || p === "tip");
  if (choice === "heading" && !next) return source;
  const headings = source.headings.filter((h) => h.line !== line || (choice === null && heading && h.of !== heading));
  if (choice === "heading") headings.push({ line, of: next! });
  const parts = [...source.parts];
  if (!(heading && choice === null)) parts[line] = choice === "heading" ? null : choice;
  return { ...source, parts, headings };
}

function sections(source: SourcePage, heading: (index: number, of: HeadedPart) => string | null, stepsSkipIngredients: boolean) {
  const { lines, parts } = source;
  const of = (part: LinePart) => parts.flatMap((p, i) => (p === part ? [{ index: i, text: clean(lines[i]) }] : []));
  const isIngredient = (i: number) => parts[i] === "ingredient";
  // A line taken whole as an ingredient already holds what was quoted from it.
  const quotes = source.quotes.filter((q) => !isIngredient(q.line)).map((q) => ({ index: q.line, text: q.text }));
  return {
    ingredient: group(lines, [...of("ingredient"), ...quotes], undefined, (i) => heading(i, "ingredient")),
    // Looking back past a part's ingredients finds its heading, if it heads the steps too.
    step: group(lines, of("step"), stepsSkipIngredients ? isIngredient : undefined, (i) => heading(i, "step")),
    tip: group(lines, of("tip"), undefined, (i) => heading(i, "tip")),
  };
}
