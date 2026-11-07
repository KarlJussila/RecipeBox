// Where each line of a page goes in the recipe, decided once, when the reader has found
// the recipe's lines: the ingredients, steps, and notes under the headings the page
// gives them, and the lines around the recipe the reader left out, for the cook to
// move in if they belong.

import { itemsToBucket, type Item } from "./buckets";
import { clean, group, headingText } from "./page-lines";
import { splitTips } from "./steps";
import type { Section } from "./types";

export interface PageLines {
  lines: string[];
  ingredientLines: number[];
  stepLines: number[];
  tipLines: number[];
  descriptionLine: number | null;
  /** The line the recipe's name came from, when the page has it. */
  titleLine: number | null;
  /** Ingredients copied from inside a sentence, like "2 cups flour" from a step. */
  quotes: { line: number; text: string }[];
}

export interface PageLayout {
  description: string;
  ingredients: Section[];
  instructions: Section[];
  tips: Section[];
  /** The unused lines around the recipe, as bucket text. */
  unused: string;
}

/** How far past the recipe's last line unused lines are kept, when no heading comes first. */
const AFTER = 15;

export function layOut(page: PageLines): PageLayout {
  const { lines, titleLine } = page;
  const items = (indexes: number[]) => [...indexes].sort((a, b) => a - b).map((i) => ({ index: i, text: clean(lines[i]) }));
  const isIngredient = (i: number) => page.ingredientLines.includes(i);
  const heading = (i: number) => (i === titleLine ? null : headingText(lines[i] ?? ""));
  // An ingredient copied from a sentence sits where that sentence is.
  const quotes = page.quotes.map((q) => ({ index: q.line, text: q.text }));
  // Steps come under a part's heading when each part has its own ingredients and then
  // its steps; a heading over both is kept over each. When all the steps follow all the
  // ingredients, the last part's heading heads only its ingredients.
  const firstStep = Math.min(...page.stepLines);
  const interleaved = page.ingredientLines.some((i) => i > firstStep);
  const ingredients = group(lines, [...items(page.ingredientLines), ...quotes], undefined, heading);
  const steps = group(lines, items(page.stepLines), interleaved ? isIngredient : undefined, heading);
  const notes = group(lines, items(page.tipLines), undefined, heading);
  // Trailing "Do ahead: ..." steps move to the notes.
  const split = splitTips(steps.map((g) => g.section));

  const used = new Set([
    ...page.ingredientLines,
    ...page.stepLines,
    ...page.tipLines,
    ...(page.descriptionLine === null ? [] : [page.descriptionLine]),
    ...(titleLine === null ? [] : [titleLine]),
    ...[...ingredients, ...steps, ...notes].flatMap((g) => (g.line === null ? [] : [g.line])),
  ]);
  const parts = [...page.ingredientLines, ...page.stepLines, ...page.tipLines];
  const unused: Item[] = [];
  if (parts.length > 0) {
    const start = titleLine ?? Math.min(...parts);
    let end = Math.max(...parts);
    while (end + 1 < lines.length && end < Math.max(...parts) + AFTER && heading(end + 1) === null) end++;
    for (let i = start; i <= end; i++) {
      if (used.has(i)) continue;
      const text = heading(i);
      unused.push(text === null ? { text: clean(lines[i]), heading: false } : { text, heading: true });
    }
  }

  return {
    description: page.descriptionLine === null ? "" : clean(lines[page.descriptionLine]),
    ingredients: ingredients.map((g) => g.section),
    instructions: split.steps,
    tips: [...split.tips, ...notes.map((g) => g.section)],
    unused: itemsToBucket(unused),
  };
}
