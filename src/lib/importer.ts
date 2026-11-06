import { api, type LlmSettings } from "./api";
import { extractFromHtml, readablePage } from "./extract/page";
import { headlineCase } from "./extract/text";
import { llmConfigured, suggestTags } from "./llm";
import { extractRecipe } from "./reader";
import { splitTips } from "./steps";
import { emptyRecipe, type Recipe } from "./types";

export type ImportResult =
  | { status: "saved"; id: string; title: string }
  | { status: "duplicate"; id: string; title: string }
  | { status: "error"; message: string };

function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|smid|ref$)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

/**
 * Turns a web page into a saved recipe: structured data first, the LLM as a
 * fallback for pages without it. Tagging happens afterwards (see tagRecipe) so a
 * slow or missing AI service never holds up saving.
 */
export async function importHtml(html: string, pageUrl: string, llm: LlmSettings | undefined): Promise<ImportResult> {
  const { draft, complete, doc } = extractFromHtml(html, pageUrl);

  if (!complete && llmConfigured(llm)) {
    try {
      const found = await extractRecipe(llm, readablePage(doc), draft.title || null, draft.sourceUrl);
      if (found) {
        Object.assign(draft, {
          ...found,
          title: found.title || draft.title,
          description: found.description || draft.description,
        });
      }
    } catch (e) {
      console.warn("LLM extraction failed", e);
    }
  }
  if (draft.ingredients.length === 0 && draft.instructions.length === 0) {
    return {
      status: "error",
      message: llmConfigured(llm)
        ? "Couldn't find a recipe on this page."
        : "This page doesn't have recipe details Recipe Box can read on its own. Setting up an AI service in Settings lets it read pages like this.",
    };
  }

  const sourceUrl = stripTracking(draft.sourceUrl ?? pageUrl);
  const existing = (await api.findBySourceUrl(sourceUrl)) ?? (await api.findBySourceUrl(stripTracking(pageUrl)));
  if (existing) return { status: "duplicate", id: existing, title: draft.title };

  let image: string | null = null;
  if (draft.imageUrl) {
    image = await api.downloadImage(draft.imageUrl, pageUrl).catch(() => null);
  }

  // The AI reader files tips apart already; structured data mixes them into the steps.
  const { steps, tips } = splitTips(draft.instructions);
  const recipe: Recipe = {
    ...emptyRecipe(),
    // Some blogs (Smitten Kitchen) style their titles in lowercase, and old pages in capitals.
    title: draft.title === draft.title.toLowerCase() || draft.title === draft.title.toUpperCase() ? headlineCase(draft.title.toLowerCase()) : draft.title,
    description: draft.description,
    sourceUrl,
    sourceName: draft.sourceName,
    author: draft.author,
    image,
    yields: draft.yields,
    prepMinutes: draft.prepMinutes,
    cookMinutes: draft.cookMinutes,
    totalMinutes: draft.totalMinutes,
    ingredients: draft.ingredients,
    instructions: steps,
    tips: [...tips, ...draft.tips],
    // Site categories and cuisines are good search terms even when they aren't tags.
    keywords: [...new Set([...draft.keywords, ...draft.categories, ...draft.cuisines])],
    needsTags: true,
  };
  const saved = await api.saveRecipe(recipe);
  return { status: "saved", id: saved.id, title: saved.title };
}

export async function importUrl(url: string, llm: LlmSettings | undefined): Promise<ImportResult> {
  try {
    const page = await api.fetchPage(url.trim());
    return await importHtml(page.html, page.url, llm);
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}

/** Asks the LLM for tags and applies them, keeping any tags added by hand meanwhile. */
export async function tagRecipe(id: string, llm: LlmSettings): Promise<string[] | null> {
  const recipe = await api.getRecipe(id);
  if (!recipe || !recipe.needsTags) return null;
  const suggested = await suggestTags(llm, recipe, await api.allTags());
  const merged = [...recipe.tags];
  for (const tag of suggested) {
    if (!merged.some((t) => t.toLowerCase() === tag.name.toLowerCase())) merged.push(tag.name);
  }
  return api.setRecipeTags(id, merged, Object.fromEntries(suggested.map((t) => [t.name, t.category])));
}
