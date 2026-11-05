import { beforeEach, expect, test, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  listener: null as ((event: { payload: unknown }) => void) | null,
  run: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, callback: typeof bridge.listener) => {
    bridge.listener = callback;
    return () => { bridge.listener = null; };
  },
}));
vi.mock("./api", () => ({ api: { opencodeRun: bridge.run, resolveToolCall: bridge.resolve } }));

import { extractRecipe, suggestTags } from "./llm";

const llm = { provider: "opencode" as const, model: "test/model", baseUrl: "", apiKey: "" };
beforeEach(() => { vi.clearAllMocks(); });

test("copies selected page lines, rejects overlaps, and keeps inline notes", async () => {
  const page = "Cake\n**For the filling**\n- 2 apples (any kind)\n- 1 cup sugar\n**For the cake**\n- 1 cup flour\nSteps\nMix well. (Do not overmix.)\nBake until golden.\nNotes\n* Tip: Keep covered.";
  bridge.run.mockImplementation(async (job: { id: string; message: string }) => {
    expect(job.message).toContain("3: - 2 apples (any kind)");
    const call = (name: string, args: unknown) => bridge.listener!({ payload: { job: job.id, call: name, name, arguments: args } });
    call("add_ingredients", { start: 3, end: 6 });
    call("add_ingredients", { heading: "Other", start: 4, end: 4 });
    expect(bridge.resolve.mock.lastCall?.[1].text).toContain("overlap");
    call("add_steps", { start: 8, end: 9 });
    call("add_tips", { start: 11, end: 11 });
    call("done", { title: "Cake" });
    return "";
  });
  const result = await extractRecipe(llm, page, null, null);
  expect(result?.ingredients).toEqual([{ heading: "For the filling", items: ["2 apples (any kind)", "1 cup sugar"] }, { heading: "For the cake", items: ["1 cup flour"] }]);
  expect(result?.instructions).toEqual([{ heading: "", items: ["Mix well. (Do not overmix.)", "Bake until golden."] }]);
  expect(result?.tips).toEqual([{ heading: "", items: ["* Tip: Keep covered."] }]);
});

test("accepts all fitting existing tags without a count or category requirement", async () => {
  const tags = [
    { name: "Cake", category: "Dish" }, { name: "Dessert", category: "Dish" },
    { name: "Fruit", category: "Ingredient" }, { name: "Apple", category: "Ingredient" },
    { name: "Baking", category: "Method" }, { name: "Snack", category: "Dish" },
  ];
  bridge.run.mockImplementation(async (job: { id: string }) => {
    bridge.listener!({ payload: { job: job.id, call: "1", name: "set_tags", arguments: { tags: tags.map((t) => t.name) } } });
    return "";
  });
  const recipe = { title: "Cake", description: "", ingredients: [], instructions: [], keywords: [] };
  expect(await suggestTags(llm, recipe, tags)).toHaveLength(6);
});
