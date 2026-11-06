// The page an AI-read recipe came from, kept with the recipe so the cook can see what
// each line of the page became and fix what the reader got wrong.

import { clean, group } from "./page-lines";
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
  const { lines, parts } = source;
  const of = (part: LinePart) => parts.flatMap((p, i) => (p === part ? [{ index: i, text: clean(lines[i]) }] : []));
  const isIngredient = (i: number) => parts[i] === "ingredient";
  // A line taken whole as an ingredient already holds what was quoted from it.
  const quotes = source.quotes.filter((q) => !isIngredient(q.line)).map((q) => ({ index: q.line, text: q.text }));
  // Steps that follow a part's ingredients come under that part's heading, and trailing
  // "Do ahead: ..." steps move to the tips, as they do on import.
  const { steps, tips } = splitTips(group(lines, of("step"), isIngredient));
  return {
    description: of("description").map((d) => d.text).join("\n\n"),
    ingredients: group(lines, [...of("ingredient"), ...quotes]),
    instructions: steps,
    tips: [...tips, ...group(lines, of("tip"))],
  };
}
