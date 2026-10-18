// Talks to any OpenAI-compatible chat completions endpoint (OpenRouter, opencode
// Zen, DeepSeek, Groq, a local Ollama...). Requests go through Rust to avoid CORS.

import { z } from "zod";
import { api, type LlmSettings } from "./api";
import type { RecipeDraft } from "./types";

export function llmConfigured(llm: LlmSettings | undefined): llm is LlmSettings {
  return Boolean(llm?.baseUrl.trim() && llm.model.trim());
}

type Message = { role: "system" | "user"; content: string };

// Providers differ in how much of `response_format` they support. Try the strictest
// form first and remember what worked for each endpoint + model.
type FormatMode = "json_schema" | "json_object" | "none";
const MODES: FormatMode[] = ["json_schema", "json_object", "none"];
const workingMode = new Map<string, FormatMode>();

/** Strips JSON Schema keywords that some providers' strict modes reject. */
function portableSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portableSchema);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["$schema", "minimum", "maximum"].includes(key))
      .map(([key, v]) => [key, portableSchema(v)]),
  );
}

/** Pulls a JSON object out of a reply, tolerating code fences and chatter around it. */
function parseJsonReply(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The AI didn't return any JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message ?? parsed?.message;
    if (typeof message === "string") return `AI service error (${status}): ${message}`;
  } catch {
    /* not JSON */
  }
  return `AI service error (${status})`;
}

async function chatJson<T>(llm: LlmSettings, messages: Message[], schema: z.ZodType<T>, name: string): Promise<T> {
  const url = `${llm.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
  const key = `${url}|${llm.model}`;
  const jsonSchema = portableSchema(z.toJSONSchema(schema));
  const startAt = MODES.indexOf(workingMode.get(key) ?? "json_schema");

  let lastError: Error | null = null;
  for (const mode of MODES.slice(startAt)) {
    const body: Record<string, unknown> = { model: llm.model.trim(), messages };
    if (mode === "json_schema") {
      body.response_format = { type: "json_schema", json_schema: { name, strict: true, schema: jsonSchema } };
    } else if (mode === "json_object") {
      body.response_format = { type: "json_object" };
    }
    const res = await api.llmPost(url, llm.apiKey.trim(), body);
    if (res.status === 400 || res.status === 422) {
      // Most likely an unsupported response_format; fall back to a looser one.
      lastError = new Error(errorMessage(res.status, res.body));
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(errorMessage(res.status, res.body));

    const content = JSON.parse(res.body)?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("The AI returned an empty reply");
    const parsed = schema.safeParse(parseJsonReply(content));
    if (!parsed.success) {
      lastError = new Error("The AI's reply wasn't in the expected format");
      continue;
    }
    workingMode.set(key, mode);
    return parsed.data;
  }
  throw lastError ?? new Error("The AI request failed");
}

// ---------------------------------------------------------------------------
// Tagging

const TagReply = z.strictObject({ tags: z.array(z.string()) });

const TAG_SYSTEM = `You organize a home cook's personal recipe collection by choosing tags for one recipe.

Tags make the collection easy to browse and filter, so they must be accurate and consistent.

How to choose:
- Pick 3 to 5 tags that a cook would use to find this recipe.
- Include the kind of dish (e.g. Main Course, Side Dish, Soup, Salad, Dessert, Breakfast, Appetizer, Bread, Drink, Sauce), and the main ingredient or protein when there is one (e.g. Chicken, Beef, Pork, Seafood, Pasta, Beans).
- Add a cuisine only when it's distinctive (e.g. Italian, Mexican, Thai), not for everyday American food.
- Add a trait only when it's clearly true:
  - Vegetarian / Vegan: no meat, poultry, fish or seafood at all (check every ingredient, including broth and gelatin).
  - Quick: ready in 30 minutes or less in total.
  - Make Ahead: the recipe itself says it can be prepared in advance, frozen, or refrigerated before serving.
  - Slow Cooker, Grilling, Instant Pot: only when the recipe uses that appliance or method.
- Reuse the collection's existing tags, spelled exactly as given, whenever one fits. Never use an existing tag that doesn't describe this recipe.
- New tags are short (one or two words) and in Title Case.`;

export interface TaggableRecipe {
  title: string;
  description: string;
  ingredients: { items: string[] }[];
  totalMinutes: number | null;
  keywords: string[];
}

export async function suggestTags(llm: LlmSettings, recipe: TaggableRecipe, existingTags: string[]): Promise<string[]> {
  const ingredients = recipe.ingredients.flatMap((s) => s.items).slice(0, 40);
  const user = [
    `Existing tags in the collection: ${existingTags.length ? existingTags.join(", ") : "(none yet)"}`,
    "",
    `Recipe: ${recipe.title}`,
    recipe.description && `Description: ${recipe.description.slice(0, 600)}`,
    recipe.totalMinutes && `Total time: ${recipe.totalMinutes} minutes`,
    recipe.keywords.length > 0 && `Website keywords: ${recipe.keywords.join(", ")}`,
    `Ingredients:\n${ingredients.map((i) => `- ${i}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const reply = await chatJson(llm, [{ role: "system", content: TAG_SYSTEM }, { role: "user", content: user }], TagReply, "recipe_tags");
  const existing = new Map(existingTags.map((t) => [t.toLowerCase(), t]));
  const seen = new Set<string>();
  return reply.tags
    .map((t) => t.trim())
    .filter((t) => t && t.length <= 40)
    .map((t) => existing.get(t.toLowerCase()) ?? t)
    .filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    // Small models often call anything "Quick"; the recipe's own time settles it.
    .filter((t) => !(t.toLowerCase() === "quick" && (recipe.totalMinutes ?? Infinity) > 30))
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Extraction from page text (for pages without structured recipe data)

const SectionSchema = z.strictObject({ heading: z.string(), items: z.array(z.string()) });
const ExtractReply = z.strictObject({
  found: z.boolean(),
  title: z.string(),
  description: z.string(),
  author: z.string().nullable(),
  yields: z.string().nullable(),
  prepMinutes: z.number().int().nullable(),
  cookMinutes: z.number().int().nullable(),
  totalMinutes: z.number().int().nullable(),
  ingredients: z.array(SectionSchema),
  instructions: z.array(SectionSchema),
  notes: z.string(),
});

const EXTRACT_SYSTEM = `You extract a recipe from the text of a web page.

- Set "found" to false if the page doesn't contain an actual recipe (ingredients and steps).
- Copy ingredients and steps faithfully; fix only obvious formatting problems. Never invent or "improve" content.
- Group ingredients and steps into sections only when the page does (e.g. "For the sauce"); otherwise use one section with an empty heading.
- Each instruction item is one step, without its step number.
- "description" is the recipe's short introduction, at most a few sentences. "notes" holds tips, variations or storage advice from the recipe itself; leave it empty if there are none.
- Times are whole minutes, or null if not stated.
- Ignore comments, ads, navigation, and other recipes linked from the page.`;

export async function extractRecipe(llm: LlmSettings, pageText: string, title: string | null, url: string | null) {
  const user = [url && `URL: ${url}`, title && `Page title: ${title}`, "", "Page text:", pageText].filter((x) => x !== null).join("\n");
  const reply = await chatJson(
    llm,
    [{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: user }],
    ExtractReply,
    "recipe",
  );
  if (!reply.found) return null;
  const clean = (sections: z.infer<typeof SectionSchema>[]) =>
    sections
      .map((s) => ({ heading: s.heading.trim(), items: s.items.map((i) => i.trim()).filter(Boolean) }))
      .filter((s) => s.items.length > 0)
      // Models sometimes wrap each step in its own untitled section; fold those together.
      .reduce<{ heading: string; items: string[] }[]>((out, s) => {
        const last = out.at(-1);
        if (last && !s.heading) last.items.push(...s.items);
        else out.push(s);
        return out;
      }, []);
  const positive = (n: number | null) => (n && n > 0 ? n : null);
  return {
    title: reply.title.trim(),
    description: reply.description.trim(),
    author: reply.author?.trim() || null,
    yields: reply.yields?.trim() || null,
    prepMinutes: positive(reply.prepMinutes),
    cookMinutes: positive(reply.cookMinutes),
    totalMinutes: positive(reply.totalMinutes),
    ingredients: clean(reply.ingredients),
    instructions: clean(reply.instructions),
    notes: reply.notes.trim(),
  } satisfies Partial<RecipeDraft>;
}

/** Sends a tiny request to check the settings work. */
export async function testConnection(llm: LlmSettings): Promise<void> {
  await suggestTags(llm, { title: "Grilled Cheese", description: "", ingredients: [{ items: ["bread", "cheddar", "butter"] }], totalMinutes: 10, keywords: [] }, []);
}
