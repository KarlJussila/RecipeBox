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

Choose all the tags that fit from the list in the message and save them with set_tags. If set_tags reports a problem, fix it and call it again. Once it succeeds, you're done.

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
    tool("set_tags", "Saves the fitting tags from the list, replacing any saved before.", TagInput, ({ tags }) => {
      const unknown = tags.filter((name) => !offered.has(name.trim().toLowerCase()));
      const result = [...new Set(tags.map((name) => name.trim().toLowerCase()))].flatMap((key) => offered.get(key) ?? []);
      const problems = [
        ...unknown.map((name) => `"${name}" isn't one of the listed tags.`),
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

const READ_INSTRUCTIONS = `Extract the recipe from the numbered page lines in the message.

Select the lines containing ingredients, steps, and separate notes. The app copies the selected lines, so do not include headings in the line ranges. Keep notes that are part of a step with that step. Ignore comments, ads, navigation, and other recipes.

Call add_ingredients and add_steps, then add_tips if there are separate notes. Call done with the title and any other details the page states. If there is no recipe, call no_recipe instead. If a tool reports a problem, fix it and call it again.`;

const DetailsInput = z.strictObject({
  title: z.string(),
  description: z.string().nullish().describe("The recipe’s own introduction, copied verbatim, at most a few sentences."),
  author: z.string().nullish(),
  yields: z.string().nullish().describe('How much it makes, e.g. "4 servings"'),
  prepMinutes: z.number().int().nullish().describe("Preparation time in whole minutes, if stated."),
  cookMinutes: z.number().int().nullish().describe("Cooking or baking time in whole minutes, if stated."),
  totalMinutes: z.number().int().nullish().describe("Total time in whole minutes, only if the page states a total."),
});
const SectionInput = z.strictObject({
  heading: z.string().nullish().describe('The section heading, like "For the sauce". Leave it out when there is no heading.'),
  start: z.number().int().describe("First line number to copy, inclusive."),
  end: z.number().int().describe("Last line number to copy, inclusive."),
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
  const lines = pageText.split("\n");
  const parts = { ingredients: [] as Section[], steps: [] as Section[], tips: [] as Section[] };
  const selected = { ingredients: [] as [number, number][], steps: [] as [number, number][], tips: [] as [number, number][] };
  let result: PageRecipe | null | undefined;
  const positive = (n: number | null | undefined) => (n && n > 0 ? n : null);

  const adder = (part: keyof typeof parts, noun: string, description: string) =>
    tool(`add_${part}`, description, SectionInput, ({ heading, start, end }) => {
      if (start < 1 || end < start || end > lines.length) {
        throw new Error(`Choose a valid line range from 1 to ${lines.length}.`);
      }
      if (selected[part].some(([first, last]) => start <= last && end >= first)) {
        throw new Error("Those lines overlap lines already added. Choose only the new lines.");
      }
      const pageHeading = (line: string) => /^(?:\*\*(.+)\*\*|#{1,6} (.+))$/.exec(line)?.slice(1).find(Boolean);
      const sections: Section[] = [{ heading: heading?.trim() || pageHeading(lines[start - 2] ?? "") || "", items: [] }];
      for (const line of lines.slice(start - 1, end)) {
        const title = pageHeading(line);
        if (title) sections.push({ heading: title, items: [] });
        else if (line.trim()) sections[sections.length - 1].items.push(line.replace(/^(?:- |\d+\. )/, "").trim());
      }
      const count = sections.reduce((total, section) => total + section.items.length, 0);
      if (count === 0) throw new Error(`No ${part} were given.`);
      selected[part].push([start, end]);
      parts[part].push(...sections.filter((section) => section.items.length));
      return `Added ${count} ${count === 1 ? noun : part}.`;
    });

  const tools = [
    adder("ingredients", "ingredient", "Select the ingredient lines, including optional ingredients. Call once per section with its heading, or without a heading if there are no sections. Do not include the heading line."),
    adder("steps", "step", "Select all instruction lines, including final cooling and serving directions. Keep inline notes with their steps. Call once per section with its heading, or without a heading if there are no sections. Do not include the heading line."),
    adder("tips", "tip", "Select separate recipe notes, variations, make-ahead, and storage advice. Call once per section with its heading, or without a heading if there are no sections. Do not include the heading line."),
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

  const numberedPage = lines.map((line, index) => `${index + 1}: ${line}`).join("\n");
  const message = [url && `URL: ${url}`, title && `Page title: ${title}`, "", numberedPage].filter((x) => x !== null).join("\n");
  try {
    await runJob(llm, READ_INSTRUCTIONS, message, tools);
  } catch (e) {
    if (result === undefined) throw e;
  }
  if (result === undefined) throw new Error("The AI finished without reading the page");
  return result;
}
