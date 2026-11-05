import { expect, test } from "vitest";
import { isNoteSection, tidyInstructions } from "./steps";

test("a Notes: line starts a notes section", () => {
  const tidied = tidyInstructions([{ heading: "", items: ["Simmer.", "Serve.", "Notes:", "Any can of tomatoes works.", "Freezes well."] }]);
  expect(tidied).toEqual([
    { heading: "", items: ["Simmer.", "Serve."] },
    { heading: "Notes", items: ["Any can of tomatoes works.", "Freezes well."] },
  ]);
  expect(tidied.map(isNoteSection)).toEqual([false, true]);
});

test("trailing tips become their own sections and filler is dropped", () => {
  const tidied = tidyInstructions([
    {
      heading: "",
      items: [
        "Note: chill the dough first.",
        "Bake 10 minutes.",
        "Do Ahead: Dough balls can be frozen 3 months ahead.",
        "Editor’s note: This recipe was first published in April 2019; it has been updated for style. Head this way for 31 of our easiest cookie recipes →",
      ],
    },
  ]);
  expect(tidied).toEqual([
    { heading: "", items: ["Note: chill the dough first.", "Bake 10 minutes."] },
    { heading: "Do ahead", items: ["Dough balls can be frozen 3 months ahead."] },
  ]);
});

test("make-ahead sections are notes, other headed sections are steps", () => {
  expect(isNoteSection({ heading: "To make ahead", items: [] })).toBe(true);
  expect(isNoteSection({ heading: "Cook’s notes", items: [] })).toBe(true);
  expect(isNoteSection({ heading: "For the sauce", items: [] })).toBe(false);
  expect(isNoteSection({ heading: "To serve", items: [] })).toBe(false);
});

test("tidying is idempotent", () => {
  const once = tidyInstructions([{ heading: "", items: ["Mix.", "Notes:", "Keeps a week.", "Tip: double it."] }]);
  expect(tidyInstructions(once)).toEqual(once);
});
