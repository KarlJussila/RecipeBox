// The page an AI-read recipe came from, kept with the recipe so the cook can see what
// each line of the page became and fix what the reader got wrong.

import { clean, groupAt } from "./page-lines";
import { splitTips } from "./steps";
import type { Section } from "./types";

/** What a line of the page became in the recipe. */
export type LinePart = "description" | "ingredient" | "step" | "tip";

export interface SourcePage {
  /** The page's lines, as the reader saw them. */
  lines: string[];
  /** What each line became, or null for a line left out. */
  parts: (LinePart | null)[];
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

/** The recipe's parts as the page's lines make them. */
export function partsToRecipe(source: SourcePage): PageParts {
  const { description, ingredients, steps, tips } = build(source);
  // Trailing "Do ahead: ..." steps move to the tips, as they do on import.
  const split = splitTips(steps.map((g) => g.section));
  return {
    description,
    ingredients: ingredients.map((g) => g.section),
    instructions: split.steps,
    tips: [...split.tips, ...tips.map((g) => g.section)],
  };
}

/** The page's lines the recipe takes as headings, and the part each one heads. */
export function headingLines(source: SourcePage): Map<number, LinePart> {
  const { ingredients, steps, tips } = build(source);
  const headings = new Map<number, LinePart>();
  for (const [part, groups] of [["ingredient", ingredients], ["step", steps], ["tip", tips]] as const) {
    for (const { line } of groups) if (line !== null && !headings.has(line)) headings.set(line, part);
  }
  return headings;
}

function build(source: SourcePage) {
  const { lines, parts } = source;
  const of = (part: LinePart) => parts.flatMap((p, i) => (p === part ? [{ index: i, text: clean(lines[i]) }] : []));
  const isIngredient = (i: number) => parts[i] === "ingredient";
  // A line taken whole as an ingredient already holds what was quoted from it.
  const quotes = source.quotes.filter((q) => !isIngredient(q.line)).map((q) => ({ index: q.line, text: q.text }));
  // When each part of the recipe has its own ingredients and then its steps, the steps
  // come under that part's heading. When all the steps follow all the ingredients, the
  // last part's heading heads only its ingredients.
  const firstStep = parts.indexOf("step");
  const interleaved = firstStep >= 0 && parts.some((p, i) => p === "ingredient" && i > firstStep);
  return {
    description: of("description").map((d) => d.text).join("\n\n"),
    ingredients: groupAt(lines, [...of("ingredient"), ...quotes]),
    steps: groupAt(lines, of("step"), interleaved ? isIngredient : undefined),
    tips: groupAt(lines, of("tip")),
  };
}
