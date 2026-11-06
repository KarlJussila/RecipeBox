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

import { suggestTags } from "./llm";

const llm = { provider: "opencode" as const, model: "test/model", baseUrl: "", apiKey: "" };
beforeEach(() => { vi.clearAllMocks(); });

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
