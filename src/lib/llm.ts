// The AI service: picks tags and reads recipes from pages without structured data.
//
// Every job runs through opencode (see src-tauri/src/opencode.rs), with either
// opencode's own models (OpenCode Zen's free ones by default) or an
// OpenAI-compatible service that Recipe Box adds to opencode as a provider.
// The model hands back its result through tools defined here, which check the
// result and explain any problem so the model can correct itself.

import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { api, type LlmSettings, type ToolCall } from "./api";
import { AI_CATEGORY_NAMES, TIME_TAG, type Tag } from "./tags";
import type { RecipeDraft, Section } from "./types";

export const DEFAULT_OPENCODE_MODEL = "opencode/mimo-v2.6-flash-free";
export const DEFAULT_LLM: LlmSettings = { provider: "opencode", baseUrl: "", apiKey: "", model: DEFAULT_OPENCODE_MODEL };

/** Saved settings, or the opencode default when nothing has been set up. */
export function effectiveLlm(llm: LlmSettings | undefined): LlmSettings {
  return llm ? { ...DEFAULT_LLM, ...llm } : DEFAULT_LLM;
}

export function llmConfigured(llm: LlmSettings | undefined): llm is LlmSettings {
  if (!llm?.model.trim()) return false;
  return llm.provider === "opencode" || Boolean(llm.baseUrl.trim());
}

// ---------------------------------------------------------------------------
// Jobs and tools

interface Tool {
  name: string;
  description: string;
  input: z.ZodType;
  /** Returns the model's answer, or throws to tell the model what to fix. */
  run: (args: never) => string;
}

function tool<S extends z.ZodType>(name: string, description: string, input: S, run: (args: z.infer<S>) => string): Tool {
  return { name, description, input, run };
}

/** The tool's answer, or what went wrong, which the model reads either way. */
function answer(tool: Tool | undefined, args: unknown): string {
  if (!tool) return "Unknown tool";
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) return z.prettifyError(parsed.error);
  try {
    return tool.run(parsed.data as never);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Runs one opencode session with the given tools and returns the model's closing words. */
async function runJob(llm: LlmSettings, instructions: string, message: string, tools: Tool[]): Promise<string> {
  const id = crypto.randomUUID();
  const unlisten = await listen<ToolCall>("ai-tool-call", ({ payload }) => {
    if (payload.job !== id) return;
    const text = answer(
      tools.find((t) => t.name === payload.name),
      payload.arguments,
    );
    void api.resolveToolCall(payload.call, { text });
  });
  try {
    return await api.opencodeRun(
      {
        id,
        model: llm.model.trim(),
        service: llm.provider === "api" ? { baseUrl: llm.baseUrl.trim(), apiKey: llm.apiKey.trim() } : null,
        instructions,
        message,
      },
      tools.map((t) => {
        const { $schema: _, ...inputSchema } = z.toJSONSchema(t.input);
        return { name: t.name, description: t.description, inputSchema };
      }),
    );
  } finally {
    unlisten();
  }
}

// ---------------------------------------------------------------------------
// Tagging

const TAG_INSTRUCTIONS = `You tag recipes in a home cook's collection.

Choose 3 to 5 of the tags listed in the message and save them with set_tags. If set_tags reports a problem, fix it and call it again. Once it succeeds, you're done.

- Include one Dish tag, and an Ingredient tag when the recipe has a clear main ingredient.
- Add a Cuisine tag only when the cuisine is distinctive.
- Add a Dietary tag only when the recipe says so itself, in its title, description or website keywords.`;

const TagInput = z.strictObject({ tags: z.array(z.string()) });

export interface TaggableRecipe {
  title: string;
  description: string;
  ingredients: Section[];
  instructions: Section[];
  keywords: string[];
}

export interface SuggestedTag {
  name: string;
  category: string;
}

export async function suggestTags(llm: LlmSettings, recipe: TaggableRecipe, collectionTags: Tag[]): Promise<SuggestedTag[]> {
  // The model chooses only from the collection's tags in the AI's categories.
  // Occasion and uncategorized tags are the cook's alone.
  const offered = new Map(
    collectionTags
      .filter((t) => t.category && AI_CATEGORY_NAMES.includes(t.category) && !TIME_TAG.test(t.name))
      .map((t) => [t.name.toLowerCase(), { name: t.name, category: t.category! }]),
  );
  let chosen: SuggestedTag[] | null = null;

  const tools = [
    tool("set_tags", "Saves the recipe's tags, replacing any saved before: 3 to 5 of the listed tags, including one Dish tag.", TagInput, ({ tags }) => {
      const unknown = tags.filter((name) => !offered.has(name.trim().toLowerCase()));
      const result = [...new Set(tags.map((name) => name.trim().toLowerCase()))].flatMap((key) => offered.get(key) ?? []);
      const problems = [
        ...unknown.map((name) => `"${name}" isn't one of the listed tags.`),
        ...(result.length > 5 ? [`That's ${result.length} tags. Choose at most 5.`] : []),
        ...(result.some((t) => t.category === "Dish") ? [] : ["Include one Dish tag."]),
      ];
      if (problems.length > 0) throw new Error(`Nothing was saved:\n${problems.join("\n")}`);
      chosen = result;
      return `Saved: ${result.map((t) => t.name).join(", ")}`;
    }),
  ];

  try {
    await runJob(llm, TAG_INSTRUCTIONS, tagMessage(recipe, [...offered.values()]), tools);
  } catch (e) {
    // A failure after the tags were saved, such as in the closing reply, doesn't matter.
    if (!chosen) throw e;
  }
  if (!chosen) throw new Error("The AI finished without choosing tags");
  return chosen;
}

function tagMessage(recipe: TaggableRecipe, tags: SuggestedTag[]): string {
  const lines = [`Recipe: ${recipe.title}`];
  if (recipe.description) lines.push("", recipe.description);
  if (recipe.keywords.length > 0) lines.push("", `Website keywords: ${recipe.keywords.join(", ")}`);
  lines.push("", "Ingredients:", ...recipe.ingredients.flatMap((s) => s.items).map((i) => `- ${i}`));
  const steps = recipe.instructions.flatMap((s) => s.items);
  if (steps.length > 0) lines.push("", "Steps:", ...steps.map((step, i) => `${i + 1}. ${step}`));
  lines.push("", "Tags you can use:");
  for (const category of AI_CATEGORY_NAMES) {
    const names = tags.filter((t) => t.category === category).map((t) => t.name);
    if (names.length > 0) lines.push(`${category}: ${names.join(", ")}`);
  }
  return lines.join("\n");
}

/** Tags a tiny made-up recipe, without saving anything, to check the settings work. */
export async function testConnection(llm: LlmSettings): Promise<void> {
  const recipe = { title: "Grilled Cheese", description: "", ingredients: [{ heading: "", items: ["bread", "cheddar", "butter"] }], instructions: [], keywords: [] };
  await suggestTags(llm, recipe, await api.allTags());
}

// ---------------------------------------------------------------------------
// Reading pages without structured recipe data

const READ_INSTRUCTIONS = `You read web pages for a home cook's recipe collection. The page is in the message, as Markdown.

If the page has a recipe (ingredients and steps), save it piece by piece:
1. add_ingredients for the ingredients. When the recipe splits them into sections, like "For the sauce", call it once per section with the section's heading; otherwise call it once, without a heading.
2. add_steps for the steps, the same way.
3. add_tips for the recipe's own notes, variations, make-ahead and storage advice, if it has any.
4. done, with the recipe's title and whatever other details the page gives.

If the page has no recipe, call no_recipe instead. If a tool reports a problem, fix it and call it again.

- Copy the page's text word for word; fix only obvious formatting problems. Never summarize, reword, or invent anything.
- Each step is one item, without its step number.
- The description is the recipe's own introduction, word for word: its first few sentences at most.
- Times are whole minutes. Leave them out when the page doesn't state them.
- Ignore comments, ads, navigation, and other recipes linked from the page.`;

const DetailsInput = z.strictObject({
  title: z.string(),
  description: z.string().nullish(),
  author: z.string().nullish(),
  yields: z.string().nullish().describe('How much it makes, e.g. "4 servings"'),
  prepMinutes: z.number().int().nullish(),
  cookMinutes: z.number().int().nullish(),
  totalMinutes: z.number().int().nullish(),
});
const SectionInput = z.strictObject({
  heading: z.string().nullish().describe('The section\'s heading, like "For the sauce". Leave it out when the recipe has no sections.'),
  items: z.array(z.string()),
});

function cleanSections(sections: Section[]): Section[] {
  return (
    sections
      .map((s) => ({ heading: s.heading.trim(), items: s.items.map((i) => i.trim()).filter(Boolean) }))
      .filter((s) => s.items.length > 0)
      // Models sometimes add each step as its own untitled section; fold those together.
      .reduce<Section[]>((out, s) => {
        const last = out.at(-1);
        if (last && !s.heading) last.items.push(...s.items);
        else out.push(s);
        return out;
      }, [])
  );
}

type PageRecipe = Pick<
  RecipeDraft,
  "title" | "description" | "author" | "yields" | "prepMinutes" | "cookMinutes" | "totalMinutes" | "ingredients" | "instructions" | "tips"
>;

/** Reads a recipe from a page's text, or returns null when the page has none. */
export async function extractRecipe(llm: LlmSettings, pageText: string, title: string | null, url: string | null): Promise<PageRecipe | null> {
  const parts = { ingredients: [] as Section[], steps: [] as Section[], tips: [] as Section[] };
  let result: PageRecipe | null | undefined;
  const positive = (n: number | null | undefined) => (n && n > 0 ? n : null);

  const adder = (part: keyof typeof parts, noun: string) =>
    tool(`add_${part}`, `Adds the recipe's ${part}, one section at a time.`, SectionInput, (input) => {
      const section = { heading: input.heading?.trim() ?? "", items: input.items.map((i) => i.trim()).filter(Boolean) };
      if (section.items.length === 0) throw new Error(`No ${part} were given.`);
      // A model repeating a call it already made, e.g. after done reported a problem.
      const same = (s: Section) => s.heading === section.heading && s.items.join("\n") === section.items.join("\n");
      if (parts[part].some(same)) return "Those were already added.";
      parts[part].push(section);
      return `Added ${section.items.length} ${section.items.length === 1 ? noun : part}.`;
    });

  const tools = [
    adder("ingredients", "ingredient"),
    adder("steps", "step"),
    adder("tips", "tip"),
    tool("done", "Saves the recipe with its title and details, once its ingredients and steps are added.", DetailsInput, (details) => {
      const ingredients = cleanSections(parts.ingredients);
      const instructions = cleanSections(parts.steps);
      const missing = [
        ...(details.title.trim() ? [] : ["The title is empty."]),
        ...(ingredients.length > 0 ? [] : ["Add the ingredients with add_ingredients."]),
        ...(instructions.length > 0 ? [] : ["Add the steps with add_steps."]),
      ];
      if (missing.length > 0) {
        throw new Error(`Nothing was saved:\n${missing.join("\n")}\nIf the page doesn't have a recipe, call no_recipe instead.`);
      }
      result = {
        title: details.title.trim(),
        description: details.description?.trim() ?? "",
        author: details.author?.trim() || null,
        yields: details.yields?.trim() || null,
        prepMinutes: positive(details.prepMinutes),
        cookMinutes: positive(details.cookMinutes),
        totalMinutes: positive(details.totalMinutes),
        ingredients,
        instructions,
        tips: cleanSections(parts.tips),
      };
      return "Saved the recipe.";
    }),
    tool("no_recipe", "Reports that the page doesn't contain a recipe.", z.strictObject({ reason: z.string() }), () => {
      result = null;
      return "Noted.";
    }),
  ];

  const message = [url && `URL: ${url}`, title && `Page title: ${title}`, "", pageText].filter((x) => x !== null).join("\n");
  try {
    await runJob(llm, READ_INSTRUCTIONS, message, tools);
  } catch (e) {
    if (result === undefined) throw e;
  }
  if (result === undefined) throw new Error("The AI finished without reading the page");
  return result;
}
