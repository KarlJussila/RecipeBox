// The AI service: picks tags and reads recipes from pages without structured data.
//
// Two ways to reach a model:
// - "opencode": runs the opencode CLI (see src-tauri/src/opencode.rs), which can use
//   OpenCode Zen's free models. This is the default.
// - "api": any OpenAI-compatible chat completions endpoint.
//   Requests go through Rust because most providers don't allow browser requests.

import { z } from "zod";
import { api, type LlmSettings } from "./api";
import { AI_CATEGORIES, AI_CATEGORY_NAMES, SEED_TAGS, TIME_TAG, type Tag } from "./tags";
import { notesSection } from "./steps";
import type { RecipeDraft } from "./types";

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

function validate<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const parsed = schema.safeParse(parseJsonReply(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// opencode can't take a system prompt or response format (Zen's free tier only
// accepts opencode's own setup), so everything goes into one message.
async function opencodeJson<T>(llm: LlmSettings, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const prompt = [
    system,
    "Do not use any tools. Reply with a single JSON object and nothing else, matching this JSON Schema:",
    JSON.stringify(portableSchema(z.toJSONSchema(schema))),
    "---",
    user,
  ].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = validate(schema, await api.opencodeRun(llm.model.trim(), prompt));
    if (result) return result;
  }
  throw new Error("The AI's reply wasn't in the expected format");
}

// Providers differ in how much of `response_format` they support. Try the strictest
// form first and remember what worked for each endpoint + model.
type FormatMode = "json_schema" | "json_object" | "none";
const MODES: FormatMode[] = ["json_schema", "json_object", "none"];
const workingMode = new Map<string, FormatMode>();

async function apiJson<T>(llm: LlmSettings, system: string, user: string, schema: z.ZodType<T>, name: string): Promise<T> {
  const url = `${llm.baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
  const key = `${url}|${llm.model}`;
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let lastError: Error | null = null;
  for (const mode of MODES.slice(MODES.indexOf(workingMode.get(key) ?? "json_schema"))) {
    const body: Record<string, unknown> = { model: llm.model.trim(), messages };
    if (mode === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: { name, strict: true, schema: portableSchema(z.toJSONSchema(schema)) },
      };
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
    const result = validate(schema, content);
    if (!result) {
      lastError = new Error("The AI's reply wasn't in the expected format");
      continue;
    }
    workingMode.set(key, mode);
    return result;
  }
  throw lastError ?? new Error("The AI request failed");
}

function askJson<T>(llm: LlmSettings, system: string, user: string, schema: z.ZodType<T>, name: string): Promise<T> {
  return llm.provider === "opencode" ? opencodeJson(llm, system, user, schema) : apiJson(llm, system, user, schema, name);
}

// ---------------------------------------------------------------------------
// Tagging

const TagReply = z.strictObject({
  tags: z.array(z.strictObject({ name: z.string(), category: z.enum(AI_CATEGORY_NAMES as [string, ...string[]]) })),
});

const TAG_SYSTEM = `You organize a home cook's personal recipe collection by choosing tags for one recipe.

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

export interface TaggableRecipe {
  title: string;
  description: string;
  ingredients: { items: string[] }[];
  totalMinutes: number | null;
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
  const byCategory = AI_CATEGORY_NAMES.map((c) => {
    const names = offered.filter((t) => t.category === c).map((t) => t.name);
    return names.length ? `- ${c}: ${names.join(", ")}` : null;
  }).filter(Boolean);

  const ingredients = recipe.ingredients.flatMap((s) => s.items).slice(0, 40);
  const user = [
    `Existing tags in the collection:\n${byCategory.length ? byCategory.join("\n") : "(none yet)"}`,
    "",
    `Recipe: ${recipe.title}`,
    recipe.description && `Description: ${recipe.description.slice(0, 600)}`,
    recipe.keywords.length > 0 && `Website keywords: ${recipe.keywords.join(", ")}`,
    `Ingredients:\n${ingredients.map((i) => `- ${i}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const reply = await askJson(llm, TAG_SYSTEM, user, TagReply, "recipe_tags");
  const existing = new Map([...SEED_TAGS, ...collectionTags].map((t) => [t.name.toLowerCase(), t]));
  const seen = new Set<string>();
  const tags: SuggestedTag[] = [];
  for (const raw of reply.tags) {
    const name = raw.name.trim();
    const key = name.toLowerCase();
    if (!name || name.length > 40 || seen.has(key) || TIME_TAG.test(name)) continue;
    seen.add(key);
    const known = existing.get(key);
    // Leave the cook's own categories, like Occasion, to her.
    if (known?.category && !AI_CATEGORY_NAMES.includes(known.category)) continue;
    tags.push({ name: known?.name ?? name, category: known?.category ?? raw.category });
  }
  return tags.slice(0, 5);
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
- Times are whole minutes, or null if the page doesn't state them.
- Ignore comments, ads, navigation, and other recipes linked from the page.`;

export async function extractRecipe(llm: LlmSettings, pageText: string, title: string | null, url: string | null) {
  const user = [url && `URL: ${url}`, title && `Page title: ${title}`, "", "Page text:", pageText].filter((x) => x !== null).join("\n");
  const reply = await askJson(llm, EXTRACT_SYSTEM, user, ExtractReply, "recipe");
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
    tips: [notesSection(reply.notes)],
  } satisfies Partial<RecipeDraft>;
}

/** Sends a tiny request to check the settings work. */
export async function testConnection(llm: LlmSettings): Promise<void> {
  await suggestTags(llm, { title: "Grilled Cheese", description: "", ingredients: [{ items: ["bread", "cheddar", "butter"] }], totalMinutes: 10, keywords: [] }, []);
}
