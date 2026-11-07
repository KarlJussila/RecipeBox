// A recipe's ingredients, steps, notes, and unused lines are each kept as plain text:
// one item per line, and a line starting "# " is a heading over the items after it.
//
//   # For the crust
//   2 cups flour
//   1 tsp salt
//
// "#10 can of tomatoes" has no space after the "#", so it stays an item.

import type { Section } from "./types";

export interface Item {
  text: string;
  heading: boolean;
}

const HEADING = /^#\s+(.*)$/;

export function bucketItems(text: string): Item[] {
  return text.split("\n").flatMap((raw) => {
    const line = raw.trim();
    if (!line) return [];
    const heading = HEADING.exec(line);
    return [heading ? { text: heading[1].trim(), heading: true } : { text: line, heading: false }];
  });
}

export function itemsToBucket(items: Item[]): string {
  return items
    .flatMap(({ text, heading }) => {
      const line = text.replace(/\s+/g, " ").trim();
      return line ? [heading ? `# ${line}` : line] : [];
    })
    .join("\n");
}

/** The bucket's items in sections, for showing the recipe. */
export function bucketSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: "", items: [] };
  for (const item of bucketItems(text)) {
    if (item.heading) {
      if (current.items.length > 0) sections.push(current);
      current = { heading: item.text, items: [] };
    } else {
      current.items.push(item.text);
    }
  }
  if (current.items.length > 0) sections.push(current);
  return sections;
}

export function sectionsToBucket(sections: Section[]): string {
  return itemsToBucket(sections.flatMap((s) => [...(s.heading ? [{ text: s.heading, heading: true }] : []), ...s.items.map((text) => ({ text, heading: false }))]));
}
