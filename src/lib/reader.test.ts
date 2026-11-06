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

import { findQuote, headingText, readPage } from "./reader";

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
    return_details: [{ yields: "1 pie" }],
  });
  const reading = await readPage(llm, PAGE, null, null, { warm });
  expect(reading?.recipe).toEqual({
    title: "Grandma's Cream Pie",
    description: "My grandmother made this every Sunday, and the crust is the best part.",
    yields: "1 pie",
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
