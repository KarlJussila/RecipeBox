// Recipe sites mix tips and asides into their steps: a "Notes:" line followed by
// notes, a trailing "Do Ahead: ..." step, or a whole "To make ahead" section.
// On import these are sorted out of the steps into the recipe's tips, under
// headings of their own, and editorial filler that means nothing offline is dropped.

import type { Section } from "./types";

const NOTE_NAMES =
  "notes?|recipe notes?|cook'?s notes?|chef'?s notes?|editor'?s notes?|tips?|cook'?s tips?|(?:to )?(?:make|do)[ -]ahead|storage|to store|leftovers|variations?|substitutions?|to freeze";

/** Headings like "Notes", "To make ahead" or "Storage". */
const NOTE_HEADING = new RegExp(`^(?:${NOTE_NAMES})$`, "i");
/** "Do Ahead: Dough balls can be..." */
const NOTE_PREFIX = new RegExp(`^(${NOTE_NAMES})\\s*:\\s*(.+)$`, "i");

/** Sentences about the page rather than the food. */
const FILLER =
  /\b(?:first|originally) published\b|\bupdated for style\b|^head (?:this way|here|over)\b|\bclick here\b|\brefreshed (?:in|on)\b|\bgave this recipe a\b.*\brefresh\b|\baffiliate links?\b|^additional notes are\b/i;

const plain = (text: string) => text.replace(/[‘’]/g, "'").trim();

/** "DO AHEAD" or "Do Ahead" -> "Do ahead" */
function sentenceCase(heading: string): string {
  return heading.charAt(0).toUpperCase() + heading.slice(1).toLowerCase();
}

export function isNoteSection(section: Section): boolean {
  return NOTE_HEADING.test(plain(section.heading));
}

export function dropFiller(text: string): string {
  return text
    .split(/(?<=[.!?→])\s+/)
    .filter((sentence) => !FILLER.test(sentence))
    .join(" ")
    .trim();
}

/** A step that is only a heading, such as "Notes:" or "For the glaze:". */
function headingLine(item: string): string | null {
  return item.length <= 48 && item.endsWith(":") && !/\d/.test(item) ? item.slice(0, -1).trim() : null;
}

/**
 * Splits heading-only steps into sections, and a trailing run of "Note: ..." style
 * steps into note sections. Safe to run on already tidied sections.
 */
export function tidyInstructions(sections: Section[]): Section[] {
  return tidy(sections, false);
}

/**
 * Gives each "Do ahead: ..." or "Tip: ..." note a heading of its own, wherever it
 * is among the notes, and makes heading-only lines such as "Storage:" headings.
 */
export function tidyNotes(sections: Section[]): Section[] {
  return tidy(sections, true);
}

function tidy(sections: Section[], notes: boolean): Section[] {
  const out: Section[] = [];
  for (const section of sections) {
    let current: Section = { heading: section.heading, items: [] };
    out.push(current);
    // Among steps, only tips at the end of a section are pulled out; one mid-way is part of the method.
    let tipsFrom = notes ? 0 : section.items.length;
    while (tipsFrom > 0 && NOTE_PREFIX.test(plain(section.items[tipsFrom - 1]))) tipsFrom -= 1;

    section.items.forEach((item, i) => {
      const heading = headingLine(item);
      const tip = i >= tipsFrom ? plain(item).match(NOTE_PREFIX) : null;
      if (heading) {
        current = { heading, items: [] };
        out.push(current);
      } else if (tip) {
        const name = sentenceCase(tip[1]);
        if (current.heading !== name) {
          current = { heading: name, items: [] };
          out.push(current);
        }
        current.items.push(item.slice(item.length - tip[2].length));
      } else {
        current.items.push(item);
      }
    });
  }
  return out
    .map((s) => (isNoteSection(s) ? { ...s, items: s.items.map(dropFiller).filter(Boolean) } : s))
    .filter((s) => s.items.length > 0);
}

/** Sorts imported instructions into the steps and the recipe's own tips. */
export function splitTips(sections: Section[]): { steps: Section[]; tips: Section[] } {
  const tidied = tidyInstructions(sections);
  return { steps: tidied.filter((s) => !isNoteSection(s)), tips: tidied.filter(isNoteSection) };
}
