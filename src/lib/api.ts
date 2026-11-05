// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.

import { invoke } from "@tauri-apps/api/core";
import type { Tag } from "./tags";
import type { Recipe, RecipeSummary } from "./types";

export interface AppInfo {
  version: string;
  dataDir: string;
  imagesDir: string;
  extensionDir: string | null;
  extensionPort: number;
}

export interface ImportRequest {
  id: string;
  url: string;
  html: string;
}

export interface LlmSettings {
  /** "opencode" uses opencode's own models; "api" adds an OpenAI-compatible service to opencode. */
  provider: "opencode" | "api";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiJob {
  id: string;
  model: string;
  service: { baseUrl: string; apiKey: string } | null;
  instructions: string;
  message: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** Sent by Rust when the model calls one of a running job's tools. */
export interface ToolCall {
  job: string;
  call: string;
  name: string;
  arguments: unknown;
}

export type Appearance = "light" | "dark" | "system";

export interface Settings {
  llm?: LlmSettings;
  /** Light unless chosen otherwise. */
  appearance?: Appearance;
}

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
let currentAppearance: Appearance = "light";

export function applyAppearance(appearance: Appearance = "light") {
  currentAppearance = appearance;
  const dark = appearance === "dark" || (appearance === "system" && darkQuery.matches);
  document.documentElement.classList.toggle("dark", dark);
}

darkQuery.addEventListener("change", () => applyAppearance(currentAppearance));

let info: AppInfo | null = null;

export async function loadAppInfo(): Promise<AppInfo> {
  info ??= await invoke<AppInfo>("app_info");
  return info;
}

// Served by the recipeimg:// protocol registered in lib.rs. Windows webviews
// reach custom protocols through http://<scheme>.localhost instead.
const IMAGE_BASE = navigator.userAgent.includes("Windows") ? "http://recipeimg.localhost/" : "recipeimg://localhost/";

/** URL the webview can load for an image stored in the app's images folder. */
export function imageSrc(file: string | null): string | null {
  return file ? IMAGE_BASE + encodeURIComponent(file) : null;
}

export const api = {
  listRecipes: () => invoke<RecipeSummary[]>("list_recipes"),
  getRecipe: (id: string) => invoke<Recipe | null>("get_recipe", { id }),
  saveRecipe: (recipe: Recipe) => invoke<Recipe>("save_recipe", { recipe }),
  deleteRecipe: (id: string) => invoke<void>("delete_recipe", { id }),
  setFavorite: (id: string, favorite: boolean) => invoke<void>("set_favorite", { id, favorite }),
  setRecipeTags: (id: string, tags: string[], categories?: Record<string, string>) =>
    invoke<string[]>("set_recipe_tags", { id, tags, categories }),
  createTag: (name: string, category: string | null) => invoke<void>("create_tag", { name, category }),
  setTagCategory: (name: string, category: string | null) => invoke<void>("set_tag_category", { name, category }),
  searchRecipes: (query: string) => invoke<string[]>("search_recipes", { query }),
  findBySourceUrl: (url: string) => invoke<string | null>("find_by_source_url", { url }),
  allTags: () => invoke<Tag[]>("all_tags"),
  renameTag: (from: string, to: string) => invoke<void>("rename_tag", { from, to }),
  deleteTag: (name: string) => invoke<void>("delete_tag", { name }),
  fetchPage: (url: string) => invoke<{ url: string; html: string }>("fetch_page", { url }),
  downloadImage: (url: string, referer: string | null) => invoke<string>("download_image", { url, referer }),
  saveImageBytes: (bytes: Uint8Array) => invoke<string>("save_image_bytes", bytes),
  opencodeStatus: () => invoke<{ path: string | null; version: string | null }>("opencode_status"),
  opencodeRun: (job: AiJob, tools: ToolDef[]) => invoke<string>("opencode_run", { job, tools }),
  resolveToolCall: (call: string, result: { text: string }) => invoke<void>("resolve_tool_call", { call, result }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  takePendingImports: () => invoke<ImportRequest[]>("take_pending_imports"),
  resolveImport: (id: string, result: unknown) => invoke<void>("resolve_import", { id, result }),
  exportBackup: (dest: string) => invoke<void>("export_backup", { dest }),
  restoreBackup: (src: string) => invoke<void>("restore_backup", { src }),
};
