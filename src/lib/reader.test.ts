import { beforeEach, expect, test, vi } from "vitest";

type Reply = { text: string; endJob: boolean };
const bridge = vi.hoisted(() => ({
  /** As with Tauri events, every job's listener hears every call. */
  listeners: new Set<(event: { payload: unknown }) => void>(),
  run: vi.fn(),
  replies: [] as Reply[],
  waiting: new Map<string, (reply: Reply) => void>(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, callback: (event: { payload: unknown }) => void) => {
    bridge.listeners.add(callback);
    return () => { bridge.listeners.delete(callback); };
  },
}));
vi.mock("./api", () => ({
  api: {
    opencodeRun: bridge.run,
    resolveToolCall: (call: string, reply: Reply) => {
      bridge.replies.push(reply);
      bridge.waiting.get(call)?.(reply);
      bridge.waiting.delete(call);
    },
  },
}));

import { findQuote, headingText } from "./page-lines";
import { readPage } from "./reader";
import { choosePart, markHeadings, partsToRecipe } from "./source-page";

const llm = { provider: "opencode" as const, model: "test/model", baseUrl: "", apiKey: "" };
beforeEach(() => {
  vi.clearAllMocks();
  bridge.replies = [];
});

const PAGE = `My grandmother made this every Sunday, and the crust is the best part.
## Grandma's Cream Pie
### Pie Crust
- 4 cups flour
- 2 tsp salt
1. Mix the flour and salt.
1. Bake for 20 minutes.
### Filling
- 2 cups sugar
- 3 cups milk
1. Cook until thick, then pour into the crust.
Keeps for three days in the fridge.
Comments
Lovely pie!`;

/**
 * A model that answers each question with the next queued call for a tool the
 * question names, and stops when its job ends or it has no answer queued.
 */
function model(answers: Record<string, unknown[]>) {
  bridge.run.mockImplementation(async (job: { id: string; message: string }) => {
    let question = job.message.slice(job.message.lastIndexOf("\n\n"));
    for (;;) {
      const name = [...question.matchAll(/`(\w+)`/g)].map((m) => m[1]).find((n) => answers[n]?.length);
      if (!name) return "";
      const reply = await new Promise<Reply>((resolve) => {
        const payload = { job: job.id, call: crypto.randomUUID(), name, arguments: answers[name].shift() };
        bridge.waiting.set(payload.call, resolve);
        bridge.listeners.forEach((listener) => listener({ payload }));
      });
      if (reply.endJob) return "";
      if (reply.text.startsWith("Got it. Next question:")) question = reply.text;
    }
  });
}

/** Lets replies still on their way arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

test.each([true, false])("reads ingredient lists that steps split apart, and keeps the steps whole (warm: %s)", async (warm) => {
  model({
    return_recipe_names: [{ names: ["Grandma's Cream Pie"] }],
    return_ingredients: [{ ingredients: ["4 cups flour", "2 tsp salt", "2 cups sugar", "3 cups milk"] }],
    return_step_range: [{ first: "Mix the flour", last: "Cook until thick" }],
    return_note_range: [{ first: "Keeps for three days", last: "Keeps for three days" }],
    return_description: [{ opening: "My grandmother made this" }],
    return_details: [{ servings: "Serves 8" }],
  });
  const reading = await readPage(llm, PAGE, null, null, { warm });
  expect(reading?.recipe).toEqual({
    title: "Grandma's Cream Pie",
    description: "My grandmother made this every Sunday, and the crust is the best part.",
    servings: "8",
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    ingredients: [{ heading: "Pie Crust", items: ["4 cups flour", "2 tsp salt"] }, { heading: "Filling", items: ["2 cups sugar", "3 cups milk"] }],
    instructions: [
      { heading: "Pie Crust", items: ["Mix the flour and salt.", "Bake for 20 minutes."] },
      { heading: "Filling", items: ["Cook until thick, then pour into the crust."] },
    ],
    tips: [{ heading: "", items: ["Keeps for three days in the fridge."] }],
  });
  await settle();
  // Warm, one job takes every question and the last answer ends it; otherwise each answer ends its own.
  expect(bridge.run).toHaveBeenCalledTimes(warm ? 1 : 6);
  expect(bridge.replies.map((r) => r.endJob)).toEqual(warm ? [false, false, false, false, false, true] : Array(6).fill(true));
  if (warm) expect(bridge.replies[0].text).toMatch(/^Got it. Next question: What are the ingredients of Grandma's Cream Pie\?/);
});

test("sends a quote that isn't on the page back to the model once", async () => {
  model({
    return_recipe_names: [{ names: ["Grandma's Cream Pie"] }],
    return_ingredients: [{ ingredients: ["4 cups flour", "a pinch of love"] }, { ingredients: ["4 cups flour", "a pinch of love"] }],
  });
  const reading = await readPage(llm, PAGE, null, null);
  expect(bridge.replies[1]).toEqual({ text: `"a pinch of love" isn't on the page. Copy the page's words exactly.`, endJob: false });
  expect(reading?.recipe.ingredients).toEqual([{ heading: "Pie Crust", items: ["4 cups flour"] }]);
});

test("asks once about a recipe name that only appears as a link", async () => {
  const page = "Sugar Cookies\n- 2 cups flour\n1. Mix and bake.\nSource: Soft Sugar Cookies";
  model({
    return_recipe_names: [{ names: ["Soft Sugar Cookies"] }, { names: ["Sugar Cookies"] }],
    return_ingredients: [{ ingredients: ["2 cups flour"] }],
    return_step_range: [{ first: "Mix and bake", last: "Mix and bake" }],
  });
  const reading = await readPage(llm, page, null, null, { links: [[], [], [], ["Soft Sugar Cookies"]] });
  expect(bridge.replies[0].text).toMatch(/^"Soft Sugar Cookies" only appears on the page as a link to another page\./);
  expect(reading?.recipe.title).toBe("Sugar Cookies");
});

test("takes a recipe name from a linked card title with text under it", async () => {
  const page = "Cookie Recipes\nHoney CookiesMix the butter and honey, then bake.\n- 2 cups flour\n1. Mix and bake.";
  model({
    return_recipe_names: [{ names: ["Honey Cookies"] }],
    return_ingredients: [{ ingredients: ["2 cups flour"] }],
    return_step_range: [{ first: "Mix and bake", last: "Mix and bake" }],
  });
  const reading = await readPage(llm, page, null, null, { links: [[], ["Honey Cookies"], [], []] });
  expect(bridge.replies.some((r) => /only appears on the page as a link/.test(r.text))).toBe(false);
  expect(reading?.recipe.title).toBe("Honey Cookies");
});

test("reads an ingredient listed twice as both of its lines", async () => {
  const page = "Meatballs\n- 1 lb beef\n- 1 tbsp olive oil\nSauce\n- 1 tbsp olive oil\n- 1 can tomatoes\n1. Mix and fry.";
  model({
    return_recipe_names: [{ names: ["Meatballs"] }],
    return_ingredients: [{ ingredients: ["1 lb beef", "1 tbsp olive oil", "1 tbsp olive oil", "1 can tomatoes"] }],
    return_step_range: [{ first: "Mix and fry", last: "Mix and fry" }],
  });
  const reading = await readPage(llm, page, null, null);
  expect(reading?.ingredientLines).toEqual([1, 2, 4, 5]);
});

test("asks once about a line skipped in the middle of the ingredients", async () => {
  const page = "Meatballs\n- 1 lb beef\n- 1 large egg\n- 1 cup crumbs\n1. Mix and fry.";
  model({
    return_recipe_names: [{ names: ["Meatballs"] }],
    return_ingredients: [{ ingredients: ["1 lb beef", "1 cup crumbs"] }, { ingredients: ["1 lb beef", "1 large egg", "1 cup crumbs"] }],
    return_step_range: [{ first: "Mix and fry", last: "Mix and fry" }],
  });
  const reading = await readPage(llm, page, null, null);
  expect(bridge.replies[1].text).toMatch(/^"- 1 large egg" is between two of your ingredients\./);
  expect(reading?.ingredientLines).toEqual([1, 2, 3]);
});

test("asks once whether steps under an ingredient part's heading right after the last step are that part", async () => {
  const page =
    "Soup\n**For the soup:**\n- 1 onion\n**For the croutons:**\n- 1 naan\n**For the soup:**\n1. Cook the onion.\n**For the croutons:**\n1. Toast the naan.\n" +
    "**For the church freezer:**\n1. Bring the pan on Sunday.";
  model({
    return_recipe_names: [{ names: ["Soup"] }],
    return_ingredients: [{ ingredients: ["1 onion", "1 naan"] }],
    return_step_range: [{ first: "Cook the onion", last: "Cook the onion" }, { first: "Cook the onion", last: "Toast the naan" }],
  });
  const reading = await readPage(llm, page, null, null);
  expect(bridge.replies[2].text).toMatch(/^"\*\*For the croutons:\*\*" and more steps come right after your last step\./);
  // Steps under a heading that heads no ingredients, like the church's, aren't asked about.
  expect(bridge.replies).toHaveLength(4);
  expect(reading?.recipe.instructions).toEqual([
    { heading: "For the soup", items: ["Cook the onion."] },
    { heading: "For the croutons", items: ["Toast the naan."] },
  ]);
});

test("asks once for whole lines when ingredients come back without their amounts", async () => {
  model({
    return_recipe_names: [{ names: ["Grandma's Cream Pie"] }],
    return_ingredients: [
      { ingredients: ["flour", "salt", "sugar", "milk"] },
      { ingredients: ["4 cups flour", "2 tsp salt", "2 cups sugar", "3 cups milk"] },
    ],
  });
  const reading = await readPage(llm, PAGE, null, null);
  expect(bridge.replies[1]).toEqual({ text: `Copy each ingredient's whole line from the page, with its amount, like "4 cups flour".`, endJob: false });
  expect(reading?.ingredientLines).toEqual([3, 4, 8, 9]);
});

test("asks once when notes run over the steps, then keeps the notes outside them", async () => {
  model({
    return_recipe_names: [{ names: ["Grandma's Cream Pie"] }],
    return_ingredients: [{ ingredients: ["4 cups flour", "2 tsp salt", "2 cups sugar", "3 cups milk"] }],
    return_step_range: [{ first: "Mix the flour", last: "Cook until thick" }],
    return_note_range: [
      { first: "My grandmother made this", last: "Keeps for three days" },
      { first: "My grandmother made this", last: "Keeps for three days" },
    ],
  });
  const reading = await readPage(llm, PAGE, null, null);
  expect(bridge.replies.find((r) => r.text.startsWith("Those notes"))?.text).toBe(
    "Those notes run over Grandma's Cream Pie's steps. Give the first and last note that isn't a step, or call `no_notes`.",
  );
  expect(reading?.stepLines).toEqual([5, 6, 10]);
  expect(reading?.tipLines).toEqual([0, 11]);
});

test("keeps an ingredient named inside a sentence as its own words", async () => {
  const page = "Cake\n- 1 cup sugar\nCream the sugar with butter, then add 1 cup milk and 2 eggs.";
  model({
    return_recipe_names: [{ names: ["Cake"] }],
    return_ingredients: [{ ingredients: ["1 cup sugar", "1 cup milk", "2 eggs"] }],
    return_step_range: [{ first: "Cream the sugar", last: "Cream the sugar" }],
  });
  const reading = await readPage(llm, page, null, null);
  expect(reading?.recipe.ingredients).toEqual([{ heading: "", items: ["1 cup sugar", "1 cup milk", "2 eggs"] }]);
  expect(reading?.recipe.instructions).toEqual([{ heading: "", items: ["Cream the sugar with butter, then add 1 cup milk and 2 eggs."] }]);
});

test("returns nothing for a page without recipes", async () => {
  model({ return_recipe_names: [{ names: [] }, { names: [] }] });
  expect(await readPage(llm, PAGE, null, null)).toBeNull();
  await settle();
  expect(bridge.run).toHaveBeenCalledTimes(1);
  expect(bridge.replies.at(-1)).toEqual({ text: "Got it. That's all.", endJob: true });
});

test("finds quotes and headings the way pages write them", () => {
  const lines = ["**For the croutons:**", "- 1 package naan, cut into pieces", "1. Toss the naan with butter, garlic, and parsley until well coated."];
  expect(findQuote(lines, "1 package naan")).toEqual({ index: 1, whole: true });
  expect(findQuote(lines, "garlic")).toEqual({ index: 2, whole: false });
  expect(findQuote(["1 1/2 teaspoon salt", "1 tablespoon baking powder"], "1 2 teaspoon salt")).toEqual({ index: 0, whole: true });
  expect(headingText(lines[0])).toBe("For the croutons");
  expect(headingText("## Ingredients")).toBe("");
  expect(headingText("Cream filling:")).toBe("Cream filling");
  expect(headingText("Mix the flour and salt.")).toBeNull();
});

test("keeps what each line of the page became, and rebuilds the recipe from it", async () => {
  const page = "Cookies\nThese are soft.\n- 2 cups flour\n1. Mix and bake.\n1. Cool on a rack.\nTip: They freeze well.";
  model({
    return_recipe_names: [{ names: ["Cookies"] }],
    return_ingredients: [{ ingredients: ["2 cups flour"] }],
    return_step_range: [{ first: "Mix and bake", last: "Mix and bake" }],
    return_note_range: [{ first: "Tip: They freeze", last: "Tip: They freeze" }],
    return_description: [{ opening: "These are soft" }],
  });
  const reading = await readPage(llm, page, null, null);
  const source = reading!.source;
  expect(source.titleLine).toBe(0);
  expect(source.parts).toEqual([null, "description", "ingredient", "step", null, "tip"]);

  source.parts[4] = "step";
  const fixed = partsToRecipe(source);
  expect(fixed.instructions).toEqual([{ heading: "", items: ["Mix and bake.", "Cool on a rack."] }]);
  expect(fixed.description).toBe("These are soft.");
});

test("marks the headings the recipe uses once, and puts steps under one only when each part has its own steps", () => {
  // Like Mom's Apple Cake: two ingredient parts, then all the steps.
  const cake = markHeadings({
    lines: ["**Apple Cake**", "**For the apples**", "- 6 apples", "**For the cake**", "- 2 cups flour", "1. Toss the apples.", "1. Bake."],
    parts: [null, null, "ingredient", null, "ingredient", "step", "step"],
    titleLine: 0,
    quotes: [],
  });
  expect(cake.headings).toEqual([
    { line: 1, of: "ingredient" },
    { line: 3, of: "ingredient" },
  ]);
  expect(partsToRecipe(cake).ingredients.map((s) => s.heading)).toEqual(["For the apples", "For the cake"]);
  expect(partsToRecipe(cake).instructions).toEqual([{ heading: "", items: ["Toss the apples.", "Bake."] }]);

  // A heading marked as not used no longer splits the ingredients.
  const one = choosePart(cake, 3, null, "ingredient");
  expect(partsToRecipe(one).ingredients).toEqual([{ heading: "For the apples", items: ["6 apples", "2 cups flour"] }]);
  // And marked again, it heads what follows it.
  expect(choosePart(one, 3, "heading").headings).toEqual(cake.headings.slice(0, 1).concat({ line: 3, of: "ingredient" }));
});

test("keeps a heading over a part's ingredients and its steps twice, so either can be unmarked", () => {
  const pie = markHeadings({
    lines: ["### Crust", "- 1 cup flour", "1. Roll it out.", "### Filling", "- 2 eggs", "1. Whisk the eggs."],
    parts: [null, "ingredient", "step", null, "ingredient", "step"],
    titleLine: null,
    quotes: [],
  });
  expect(pie.headings).toEqual([
    { line: 0, of: "ingredient" },
    { line: 3, of: "ingredient" },
    { line: 0, of: "step" },
    { line: 3, of: "step" },
  ]);
  const steps = partsToRecipe(choosePart(pie, 3, null, "step")).instructions;
  expect(steps).toEqual([{ heading: "Crust", items: ["Roll it out.", "Whisk the eggs."] }]);
  expect(partsToRecipe(choosePart(pie, 3, null, "step")).ingredients.map((s) => s.heading)).toEqual(["Crust", "Filling"]);
});
