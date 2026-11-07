// A page's lines as readableText writes them for the model: Markdown, with "#" headings,
// "**bold**" lines, and "- " or "1. " list items. The reader finds the model's quotes
// among these lines and reads each line's kind back from that markup.

import type { Section } from "./types";

/** A line as quotes are compared with it: no markup or list marker, plain quotes and spaces, lowercase. */
export const flat = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*#_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^(?:[-•] |\d+[.)] )/, "");

/** A line as it's saved, without its markup. */
export const clean = (line: string) =>
  line
    .replace(/^(?:#{1,6} +|[-*•] +|\d+[.)] +)/, "")
    .replace(/\*\*/g, "")
    .trim();

/** How a line is marked as part of a list: "-", "1.", and so on, or "" when it isn't. */
export const marker = (line: string) => /^\s*(?:[-*•]|\d+[.)])\s/.exec(line)?.[0].trim().replace(/\d+/, "1") ?? "";

const HEADING = /^(?:#{1,6} +(.+?)|\*\*(.+?)\*\*|([^.!?]{1,60}):)\s*$/;
/** Headings that only say what part of the recipe follows. */
const GENERIC = /^(?:the )?(?:ingredients?|instructions?|directions?|method|steps?|preparation|notes?|tips?|recipe)$/i;

/**
 * A heading's text, "" for one that only names the part (like "Ingredients"), or null
 * for other lines. A heading is a "#" line, a bold line, or a short line ending in a
 * colon, like "For the sauce:".
 */
export function headingText(line: string): string | null {
  const m = HEADING.exec(line.trim());
  if (!m) return null;
  const text = (m[1] ?? m[2] ?? m[3]).replace(/[*#]+/g, "").replace(/:\s*$/, "").trim();
  return GENERIC.test(text) ? "" : text;
}

/**
 * Groups lines into sections, starting one at each heading between or just before
 * them. Looking back for the first heading passes over `skip`ped lines, so steps
 * that follow a part's ingredients come under that part's heading.
 */
export function group(lines: string[], items: { index: number; text: string }[], skip: (index: number) => boolean = () => false): Section[] {
  return groupAt(lines, items, skip).map((g) => g.section);
}

/** Like `group`, along with the line each section's heading came from, if any. */
export function groupAt(
  lines: string[],
  items: { index: number; text: string }[],
  skip: (index: number) => boolean = () => false,
): { section: Section; line: number | null }[] {
  items = [...items].sort((a, b) => a.index - b.index);
  if (items.length === 0) return [];
  const sections: { section: Section; line: number | null }[] = [];
  let back = items[0].index - 1;
  while (back >= 0 && skip(back)) back--;
  const before = headingText(lines[back] ?? "");
  let current = { section: { heading: before ?? "", items: [] as string[] }, line: before === null ? null : back };
  let last = items[0].index - 1;
  for (const item of items) {
    for (let i = last + 1; i < item.index; i++) {
      const heading = headingText(lines[i]);
      if (heading === null) continue;
      if (current.section.items.length > 0) sections.push(current);
      current = { section: { heading, items: [] }, line: i };
    }
    current.section.items.push(item.text);
    last = item.index;
  }
  sections.push(current);
  return sections;
}

export interface Found {
  index: number;
  /** The quote is the line (or most of it), not just a few words inside a sentence. */
  whole: boolean;
}

/** How alike two strings are, from 0 to 1, by the letter pairs they share. */
function likeness(a: string, b: string): number {
  const pairs = (s: string) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) counts.set(s.slice(i, i + 2), (counts.get(s.slice(i, i + 2)) ?? 0) + 1);
    return counts;
  };
  const [pa, pb] = [pairs(a), pairs(b)];
  let shared = 0;
  for (const [pair, n] of pa) shared += Math.min(n, pb.get(pair) ?? 0);
  return (2 * shared) / Math.max(1, a.length - 1 + b.length - 1);
}

/** A page's lines, for finding quotes among them. */
export class PageLines {
  private readonly flats: string[];

  constructor(readonly lines: string[]) {
    this.flats = lines.map(flat);
  }

  /**
   * Finds a quote at or after `start`: a line that is the quote, then one that starts
   * with it, then one that contains it, and last a line that is nearly the quote, for a
   * model that copied a character or two wrong.
   */
  find(quote: string, start = 0): Found | null {
    const q = flat(quote);
    if (!q) return null;
    const flats = this.flats;
    const tests: ((f: string) => boolean)[] = [(f) => f === q, (f) => f.startsWith(q), (f) => f.includes(q) || (f.length > 8 && q.includes(f))];
    for (const test of tests) {
      for (let i = Math.max(0, start); i < flats.length; i++) {
        if (test(flats[i])) return { index: i, whole: !flats[i].includes(q) || flats[i].length <= q.length + 25 || flats[i].startsWith(q) };
      }
    }
    let best: Found | null = null;
    let bestLikeness = 0.8;
    for (let i = Math.max(0, start); i < flats.length; i++) {
      const l = likeness(flats[i], q);
      if (l > bestLikeness) [best, bestLikeness] = [{ index: i, whole: true }, l];
    }
    return best;
  }

  /** Finds a quote after `start`, or anywhere on the page when it isn't there. */
  findNear(quote: string, start: number): Found | null {
    return this.find(quote, start) ?? this.find(quote);
  }

  /** Whether a quote found as a whole line leaves part of it out, like "sugar" for "2 cups sugar". */
  shortened(quote: string, found: Found): boolean {
    const [line, q] = [this.flats[found.index], flat(quote)];
    return found.whole && line.length > q.length + 3 && !line.startsWith(q);
  }

  /** The lines that contain a quote. */
  mentions(quote: string): number[] {
    const q = flat(quote);
    return q ? this.flats.flatMap((f, i) => (f.includes(q) ? [i] : [])) : [];
  }

  heading(index: number): string | null {
    return headingText(this.lines[index] ?? "");
  }

  marker(index: number): string {
    return marker(this.lines[index] ?? "");
  }

  clean(index: number): string {
    return clean(this.lines[index]);
  }
}

/** Finds a quote among lines; see PageLines.find. */
export function findQuote(lines: string[], quote: string, start = 0): Found | null {
  return new PageLines(lines).find(quote, start);
}
