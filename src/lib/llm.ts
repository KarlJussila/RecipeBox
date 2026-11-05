// The AI service: picks tags and reads recipes from pages without structured data.
//
// Every job runs through opencode (see src-tauri/src/opencode.rs), with either
// opencode's own models (OpenCode Zen's free ones by default) or an
// OpenAI-compatible service that Recipe Box adds to opencode as a provider.
// The model works through tools defined here: it reads the recipe or page with
// one and hands back its result with another, which checks the result and
// explains any problem so the model can correct itself.

import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { api, type LlmSettings, type ToolCall } from "./api";
import { AI_CATEGORIES, AI_CATEGORY_NAMES, SEED_TAGS, TIME_TAG, type Tag } from "./tags";
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

const NO_INPUT = z.strictObject({});

function answer(tool: Tool | undefined, args: unknown): { text: string; isError: boolean } {
  if (!tool) return { text: "Unknown tool", isError: true };
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) return { text: z.prettifyError(parsed.error), isError: true };
  try {
    return { text: tool.run(parsed.data as never), isError: false };
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
}

/** Runs one opencode session with the given tools and returns the model's closing words. */
async function runJob(llm: LlmSettings, instructions: string, message: string, tools: Tool[]): Promise<string> {
  const id = crypto.randomUUID();
  const unlisten = await listen<ToolCall>("ai-tool-call", ({ payload }) => {
    if (payload.job !== id) return;
    const result = answer(
      tools.find((t) => t.name === payload.name),
      payload.arguments,
    );
    void api.resolveToolCall(payload.call, result);
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

const TAG_INSTRUCTIONS = `You organize a home cook's personal recipe collection by choosing tags for one recipe.

Read the recipe with get_recipe and the collection's tags with list_tags, then save your choice with set_tags. If set_tags reports a problem, fix it and call set_tags again. Once set_tags succeeds you're done; reply with one short line.

Tags make the collection easy to browse and filter, so they must be accurate and consistent. Every tag belongs to one category:
${AI_CATEGORIES.map((c) => `- ${c.name}: ${c.hint} (e.g. ${c.examples})`).join("\n")}

How to choose:
- Pick 3 to 5 tags that a cook would use to find this recipe.
- Always include one Dish tag, and an Ingredient tag when the recipe has a clear main ingredient.
- Add a Cuisine only when it's distinctive, not for everyday American food.
- Add Dietary tags only when clearly true. Vegetarian and Vegan mean no meat, poultry, fish or seafood at all (check every ingredient, including broth and gelatin).
- Add Method tags only for a notable appliance or technique the recipe really uses, never for ordinary baking, roasting or stovetop cooking.
- Never tag holidays, seasons or events (the cook adds those herself), even when the website's keywords mention them.
- Tags describe the dish itself. Never tag timing, effort or planning (no "Quick", "Easy", "Weeknight" or "Make Ahead"); the app already filters by time.
- Reuse the collection's existing tags, spelled exactly as given, whenever one fits. Never use an existing tag that doesn't describe this recipe.
- New tags are short (one or two words) and in Title Case.`;

const TagInput = z.strictObject({
  tags: z.array(z.strictObject({ name: z.string(), category: z.enum(AI_CATEGORY_NAMES as [string, ...string[]]) })),
});

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
  // Only tags in the AI's own categories are offered. Occasion and uncategorized
  // tags are the cook's, so the model never sees or reuses them.
  const inCollection = new Set(collectionTags.map((t) => t.name.toLowerCase()));
  const offered = [...collectionTags, ...SEED_TAGS.filter((t) => !inCollection.has(t.name.toLowerCase()))].filter(
    (t) => t.category && AI_CATEGORY_NAMES.includes(t.category) && !TIME_TAG.test(t.name),
  );
  const known = new Map([...SEED_TAGS, ...collectionTags].map((t) => [t.name.toLowerCase(), t]));
  let chosen: SuggestedTag[] | null = null;

  const tools = [
    tool("get_recipe", "Reads the recipe to tag.", NO_INPUT, () =>
      JSON.stringify(
        {
          title: recipe.title,
          description: recipe.description,
          websiteKeywords: recipe.keywords,
          ingredients: recipe.ingredients.flatMap((s) => s.items),
          steps: recipe.instructions.flatMap((s) => s.items),
        },
        null,
        2,
      ),
    ),
    tool("list_tags", "Lists the collection's existing tags by category. Reuse one whenever it fits.", NO_INPUT, () =>
      JSON.stringify(Object.fromEntries(AI_CATEGORY_NAMES.map((c) => [c, offered.filter((t) => t.category === c).map((t) => t.name)])), null, 2),
    ),
    tool("set_tags", "Saves the recipe's tags, replacing any saved before: 3 to 5 tags, including one Dish tag.", TagInput, ({ tags }) => {
      const problems: string[] = [];
      const result: SuggestedTag[] = [];
      for (const raw of tags) {
        const name = raw.name.trim().replace(/\s+/g, " ");
        const existing = known.get(name.toLowerCase());
        if (!name || result.some((t) => t.name.toLowerCase() === name.toLowerCase())) continue;
        if (name.length > 40) problems.push(`"${name}" is too long for a tag.`);
        else if (TIME_TAG.test(name)) problems.push(`"${name}" is about timing or effort. Leave it out.`);
        else if (existing?.category && !AI_CATEGORY_NAMES.includes(existing.category))
          problems.push(`"${existing.name}" is one of the cook's ${existing.category} tags. Leave it out.`);
        else result.push({ name: existing?.name ?? name, category: existing?.category ?? raw.category });
      }
      if (result.length > 5) problems.push(`That's ${result.length} tags. Choose at most 5.`);
      if (!result.some((t) => t.category === "Dish")) problems.push("Include one Dish tag.");
      if (problems.length > 0) throw new Error(`Nothing was saved:\n${problems.join("\n")}`);
      chosen = result;
      return `Saved: ${result.map((t) => `${t.name} (${t.category})`).join(", ")}`;
    }),
  ];

  try {
    await runJob(llm, TAG_INSTRUCTIONS, "Choose tags for this recipe.", tools);
  } catch (e) {
    // A failure after the tags were saved, such as in the closing reply, doesn't matter.
    if (!chosen) throw e;
  }
  if (!chosen) throw new Error("The AI finished without choosing tags");
  return chosen;
}

/** Tags a tiny made-up recipe, without saving anything, to check the settings work. */
export async function testConnection(llm: LlmSettings): Promise<void> {
  const recipe = { title: "Grilled Cheese", description: "", ingredients: [{ heading: "", items: ["bread", "cheddar", "butter"] }], instructions: [], keywords: [] };
  await suggestTags(llm, recipe, []);
}

// ---------------------------------------------------------------------------
// Reading pages without structured recipe data

const READ_INSTRUCTIONS = `You read web pages for a home cook's recipe collection.

Read the page with get_page. If it contains a recipe (ingredients and steps), save it with save_recipe; if it doesn't, call no_recipe. If save_recipe reports a problem, fix it and call save_recipe again. Once either succeeds you're done; reply with one short line.

- Copy ingredients and steps faithfully; fix only obvious formatting problems. Never invent or "improve" content.
- Group ingredients and steps into sections only when the page does (e.g. "For the sauce"); otherwise use one section with an empty heading.
- Each step is one item, without its step number.
- The description is the recipe's short introduction, at most a few sentences.
- Tips, variations, make-ahead and storage advice from the recipe itself go in tips, under headings like "Notes" or "Do ahead", not in the steps.
- Times are whole minutes. Leave them out when the page doesn't state them.
- Ignore comments, ads, navigation, and other recipes linked from the page.`;

const Sections = z.array(z.strictObject({ heading: z.string(), items: z.array(z.string()) }));
const RecipeInput = z.strictObject({
  title: z.string(),
  description: z.string().nullish(),
  author: z.string().nullish(),
  yields: z.string().nullish().describe('How much it makes, e.g. "4 servings"'),
  prepMinutes: z.number().int().nullish(),
  cookMinutes: z.number().int().nullish(),
  totalMinutes: z.number().int().nullish(),
  ingredients: Sections,
  instructions: Sections,
  tips: Sections.nullish(),
});

function cleanSections(sections: Section[]): Section[] {
  return (
    sections
      .map((s) => ({ heading: s.heading.trim(), items: s.items.map((i) => i.trim()).filter(Boolean) }))
      .filter((s) => s.items.length > 0)
      // Models sometimes wrap each step in its own untitled section; fold those together.
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
  let result: PageRecipe | null | undefined;
  const positive = (n: number | null | undefined) => (n && n > 0 ? n : null);

  const tools = [
    tool("get_page", "Reads the page's address, title and text.", NO_INPUT, () =>
      [url && `URL: ${url}`, title && `Page title: ${title}`, "", pageText].filter((x) => x !== null).join("\n"),
    ),
    tool("save_recipe", "Saves the recipe from the page.", RecipeInput, (input) => {
      const ingredients = cleanSections(input.ingredients);
      const instructions = cleanSections(input.instructions);
      if (ingredients.length === 0 || instructions.length === 0) {
        throw new Error("A recipe needs both ingredients and steps. If the page doesn't have a recipe, call no_recipe instead.");
      }
      result = {
        title: input.title.trim(),
        description: input.description?.trim() ?? "",
        author: input.author?.trim() || null,
        yields: input.yields?.trim() || null,
        prepMinutes: positive(input.prepMinutes),
        cookMinutes: positive(input.cookMinutes),
        totalMinutes: positive(input.totalMinutes),
        ingredients,
        instructions,
        tips: cleanSections(input.tips ?? []),
      };
      return "Saved.";
    }),
    tool("no_recipe", "Reports that the page doesn't contain a recipe.", z.strictObject({ reason: z.string() }), () => {
      result = null;
      return "Noted.";
    }),
  ];

  try {
    await runJob(llm, READ_INSTRUCTIONS, "Read the recipe on this page.", tools);
  } catch (e) {
    if (result === undefined) throw e;
  }
  if (result === undefined) throw new Error("The AI finished without reading the page");
  return result;
}
