// The AI service: picks tags, and runs the jobs that read recipes from pages
// without structured data (see reader.ts).
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
import { bucketItems } from "./buckets";

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

/** What the model reads back from a tool, and whether that ends the job. */
export type ToolReply = string | { text: string; endJob: boolean };

export interface Tool {
  name: string;
  description: string;
  input: z.ZodType;
  /** Returns the model's answer, or throws to tell the model what to fix. */
  run: (args: never) => ToolReply | Promise<ToolReply>;
  /** A successful call is the job's answer, so the job ends without the model's closing reply. */
  ends: boolean;
}

export function tool<S extends z.ZodType>(
  name: string,
  description: string,
  input: S,
  run: (args: z.infer<S>) => ToolReply | Promise<ToolReply>,
  { ends = false } = {},
): Tool {
  return { name, description, input, run, ends };
}

/** The tool's answer, or what went wrong, which the model reads either way. */
async function answer(tool: Tool | undefined, args: unknown): Promise<{ text: string; endJob: boolean }> {
  if (!tool) return { text: "Unknown tool", endJob: false };
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) return { text: z.prettifyError(parsed.error), endJob: false };
  try {
    const reply = await tool.run(parsed.data as never);
    return typeof reply === "string" ? { text: reply, endJob: tool.ends } : reply;
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), endJob: false };
  }
}

/**
 * Runs one opencode session with the given tools and returns the model's closing
 * words, which are empty when a tool's answer ended the job.
 */
export async function runJob(llm: LlmSettings, instructions: string, message: string, tools: Tool[]): Promise<string> {
  const id = crypto.randomUUID();
  const unlisten = await listen<ToolCall>("ai-tool-call", ({ payload }) => {
    if (payload.job !== id) return;
    void answer(
      tools.find((t) => t.name === payload.name),
      payload.arguments,
    ).then((result) => api.resolveToolCall(payload.call, result));
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

const TAG_INSTRUCTIONS = `You tag recipes in a home cook's collection, so she can find each one again by browsing her tags.

Choose the tags from the list in the message that she would look under to find this recipe, and save them with set_tags. If set_tags reports a problem, fix it and call it again. Once it succeeds, you're done.

- Dish: what kind of dish is it? Don't stretch to fit a tag. If multiple fit, choose multiple.
- Ingredient: the ones that define the dish, which she'd search for to find it, or none if no listed tag does. Leave out what is merely in it.
- Cuisine: only when the recipe plainly belongs to one.
- Method: only when the recipe is made that way.
- Dietary: only when the recipe says so itself, in its title, description, or website keywords.`;

const TagInput = z.strictObject({ tags: z.array(z.string()) });

export interface TaggableRecipe {
  title: string;
  description: string;
  /** Bucket text, as a recipe keeps it. */
  ingredients: string;
  instructions: string;
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
    tool("set_tags", "Saves the fitting tags from the list, replacing any saved before.", TagInput, ({ tags }) => {
      const unknown = tags.filter((name) => !offered.has(name.trim().toLowerCase()));
      const result = [...new Set(tags.map((name) => name.trim().toLowerCase()))].flatMap((key) => offered.get(key) ?? []);
      const problems = [
        ...unknown.map((name) => `"${name}" isn't one of the listed tags.`),
      ];
      if (problems.length > 0) throw new Error(`Nothing was saved:\n${problems.join("\n")}`);
      chosen = result;
      return `Saved: ${result.map((t) => t.name).join(", ")}`;
    }, { ends: true }),
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
  lines.push("", "Ingredients:", ...bucketItems(recipe.ingredients).flatMap((i) => (i.heading ? [] : [`- ${i.text}`])));
  const steps = bucketItems(recipe.instructions).flatMap((i) => (i.heading ? [] : [i.text]));
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
  const recipe = { title: "Grilled Cheese", description: "", ingredients: "bread\ncheddar\nbutter", instructions: "", keywords: [] };
  await suggestTags(llm, recipe, await api.allTags());
}
