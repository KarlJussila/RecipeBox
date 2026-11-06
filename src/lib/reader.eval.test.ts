/// <reference types="node" />
// Scores the page reader against hand-labeled pages, with a real model through
// opencode. Skipped unless RB_EVAL is set, since it runs a model:
//
//   RB_EVAL=1 npx vitest run src/lib/reader.eval.test.ts
//
// RB_LAB      folder with the saved pages and labels (default ~/rb-lab/tmp)
// RB_SERVICE  OpenAI-compatible service (default LM Studio's), or "none" for opencode's own models
// RB_MODEL    model (default qwen3.5-4b-mtp)
// RB_PAGES    page names to read, separated by spaces (default all labeled pages)
// RB_RUN      a name for the run; answers are cached per run, so a new name asks again
// RB_WARM     0 to ask each question in a job of its own instead of one warm session
//
// opencode runs the way the app runs it (src-tauri/src/opencode.rs): the same
// command, config, and plugin. Only the Tauri side is stood in for here.

import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

const LAB = process.env.RB_LAB ?? join(homedir(), "rb-lab/tmp");
const OUT = join(homedir(), "rb-lab/app-eval");
const SERVICE = process.env.RB_SERVICE ?? "http://127.0.0.1:1234/v1";
const MODEL = process.env.RB_MODEL ?? "qwen3.5-4b-mtp";
const RUN = process.env.RB_RUN ?? "1";
const WARM = process.env.RB_WARM !== "0";

interface Job { id: string; model: string; service: { baseUrl: string; apiKey: string } | null; instructions: string; message: string }
interface ToolDef { name: string; description: string; inputSchema: unknown }
type Call = { name: string; arguments: unknown };

const bridge = vi.hoisted(() => ({
  /** As with Tauri events, every job's listener hears every call. */
  listeners: new Set<(event: { payload: unknown }) => void>(),
  waiting: new Map<string, (reply: { text: string; endJob: boolean }) => void>(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, callback: (event: { payload: unknown }) => void) => {
    bridge.listeners.add(callback);
    return () => { bridge.listeners.delete(callback); };
  },
}));
vi.mock("./api", () => ({
  api: {
    opencodeRun: (job: Job, tools: ToolDef[]) => opencodeRun(job, tools),
    resolveToolCall: (call: string, reply: { text: string; endJob: boolean }) => {
      bridge.waiting.get(call)?.(reply);
      bridge.waiting.delete(call);
    },
  },
}));

import { extractFromHtml, readableText } from "./extract/page";
import { headingText, readPage, type Reading } from "./reader";

// ---------------------------------------------------------------------------
// The app's side of a job, with answers cached per run

/** Hands one call to the job's tools, the way tools.rs does, and returns the reply. */
function dispatch(job: Job, call: Call): Promise<{ text: string; endJob: boolean }> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    bridge.waiting.set(id, resolve);
    bridge.listeners.forEach((listener) => listener({ payload: { job: job.id, call: id, ...call } }));
  });
}

/** As config() in opencode.rs. */
function config(job: Job, tools: ToolDef[]) {
  const permission = Object.fromEntries([["*", "deny"], ...tools.map((t) => [t.name, "allow"])]);
  const config: Record<string, unknown> = {
    agent: { recipebox: { mode: "primary", prompt: job.instructions, steps: 20, permission }, title: { disable: true } },
  };
  if (job.service) {
    config.providers = {
      "recipebox-service": {
        name: "Recipe Box service",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: job.service.baseUrl },
        models: { [job.model]: { name: job.model, capabilities: { tools: true, input: ["text"], output: ["text"] } } },
        ...(job.service.apiKey ? { headers: { Authorization: `Bearer ${job.service.apiKey}` } } : {}),
      },
    };
  }
  return config;
}

const cachePath = join(OUT, "cache.json");
const cache: Record<string, { calls: Call[]; secs: number }> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
let modelSeconds = 0;
/** How often each job has been asked in this run, so asking again gets a new answer. */
const asked = new Map<string, number>();

async function opencodeRun(job: Job, tools: ToolDef[]): Promise<string> {
  const same = createHash("sha1").update(JSON.stringify([RUN, job.model, job.service?.baseUrl, job.instructions, job.message, tools])).digest("hex");
  const n = (asked.get(same) ?? 0) + 1;
  asked.set(same, n);
  const key = n === 1 ? same : `${same}#${n}`;
  const cached = cache[key];
  if (cached) {
    modelSeconds += cached.secs;
    for (const call of cached.calls) if ((await dispatch(job, call)).endJob) break;
    return "";
  }

  const calls: Call[] = [];
  let child: ChildProcess | null = null;
  const started = Date.now();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const call: Call = JSON.parse(body);
        calls.push(call);
        const reply = await dispatch(job, call);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: reply.text }));
        // As opencode.rs does once an answer ends the job.
        if (reply.endJob) child?.kill("SIGKILL");
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const dir = join(OUT, "opencode");
  mkdirSync(join(dir, "config/plugin"), { recursive: true });
  mkdirSync(join(dir, "sandbox"), { recursive: true });
  copyFileSync("src-tauri/src/opencode-plugin.js", join(dir, "config/plugin/recipebox.js"));
  const model = job.service ? `recipebox-service/${job.model}` : job.model;
  try {
    await new Promise<void>((resolve, reject) => {
      child = spawn("opencode", ["run", "--standalone", "--agent", "recipebox", "--format", "json", "-m", model], {
        cwd: join(dir, "sandbox"),
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config(job, tools)),
          OPENCODE_CONFIG_DIR: join(dir, "config"),
          RECIPEBOX_TOOLS: JSON.stringify(tools),
          RECIPEBOX_TOOL_URL: `http://127.0.0.1:${port}/tool`,
          RECIPEBOX_JOB: job.id,
          PWD: join(dir, "sandbox"),
        },
      });
      let err = "";
      child.stderr!.on("data", (chunk) => { err += chunk; });
      child.stdout!.resume();
      child.on("error", reject);
      child.on("close", (code, signal) => (code === 0 || signal === "SIGKILL" ? resolve() : reject(new Error(`opencode failed (${code}): ${err.slice(-400)}`))));
      child.stdin!.end(job.message);
    });
  } finally {
    server.close();
  }
  const secs = (Date.now() - started) / 1000;
  modelSeconds += secs;
  cache[key] = { calls, secs };
  writeFileSync(cachePath, JSON.stringify(cache));
  return "";
}

// ---------------------------------------------------------------------------
// Pages and labels

/** Each labeled page: its folder, and its labels by line text. */
function labeledPages() {
  const pages = new Map<string, { dir: string; labels: Record<string, string[] | "*"> }>();
  for (const set of readdirSync(join(LAB, "rb-lightning")).filter((d) => d.startsWith("labels"))) {
    const kind = set.slice("labels".length); // "", "-heldout", ...
    for (const file of readdirSync(join(LAB, "rb-lightning", set))) {
      const name = file.replace(/\.json$/, "");
      const dir = join(LAB, kind ? `rb${kind}` : "rb-fixtures", name);
      if (existsSync(join(dir, "page.html"))) pages.set(name, { dir, labels: JSON.parse(readFileSync(join(LAB, "rb-lightning", set, file), "utf8")) });
    }
  }
  return pages;
}

/** As norm() in the labeling scripts. */
const norm = (s: string) => s.replace(/^(?:#+ |\*\*|- |\d+\. )/, "").replace(/[*#_\s]+/g, " ").trim();

/** Each line's labels. A label keyed "text#2" is for the second line with that text. */
function lineLabels(lines: string[], labels: Record<string, string[] | "*">): (string[] | "*" | null)[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = norm(line);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return labels[`${key}#${n}`] ?? labels[key] ?? null;
  });
}

/** As decode_page() in fetch.rs: valid UTF-8, else the declared charset, else Windows-1252. */
function decode(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 4096).toString("latin1"))?.[1] ?? "windows-1252";
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }
}

/** Lines a part must include (labeled only as that part, or a heading), and lines it must not. */
const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The part's lines a reading missed and the ones it wrongly took. Lines in `quoted` only had
 * a few words quoted from them, like an ingredient named in a step, so they can count but
 * aren't wrong.
 */
function score(reading: Reading | null, labels: (string[] | "*" | null)[], part: string, got: number[], quoted: number[] = []) {
  const required = labels.flatMap((l, i) => (l && l !== "*" && l.includes(part) && l.every((x) => x === part || x === "heading") ? [i] : []));
  const has = new Set([...got, ...quoted]);
  // A heading among the part's lines becomes a section heading, so it's kept.
  const lines = reading?.lines ?? [];
  for (const i of required) if (got.some((g) => g < i) && got.some((g) => g > i) && headingText(lines[i]) !== null) has.add(i);
  const missing = required.filter((i) => !has.has(i));
  const extra = got.filter((i) => labels[i] !== "*" && !(labels[i] ?? []).some((x) => x === part || x === "heading"));
  return { missing, extra, reading };
}

// ---------------------------------------------------------------------------

describe.runIf(process.env.RB_EVAL)("reading labeled pages", () => {
  test("reads each page's first recipe", async () => {
    mkdirSync(OUT, { recursive: true });
    const pages = labeledPages();
    const names = process.env.RB_PAGES?.split(/\s+/).filter(Boolean) ?? [...pages.keys()];
    const llm = SERVICE === "none"
      ? { provider: "opencode" as const, baseUrl: "", apiKey: "", model: MODEL }
      : { provider: "api" as const, baseUrl: SERVICE, apiKey: "", model: MODEL };
    const report: string[] = [];
    const totals = { pages: 0, wrong: 0, title: 0, ingredients: 0, steps: 0, description: 0 };
    const say = (line: string) => { report.push(line); console.log(line); };

    for (const name of names) {
      const page = pages.get(name);
      if (!page) throw new Error(`No labels for ${name}`);
      const url = readFileSync(join(page.dir, "url.txt"), "utf8").trim();
      const { draft, doc } = extractFromHtml(decode(readFileSync(join(page.dir, "page.html"))), url);
      const before = modelSeconds;
      const reading = await readPage(llm, readableText(doc), draft.title || null, draft.sourceUrl, { warm: WARM });
      const lines = reading?.lines ?? readableText(doc).split("\n").filter((l) => l.trim());
      const labels = lineLabels(lines, page.labels);
      const ingredients = score(reading, labels, "ingredient", reading?.ingredientLines ?? [], reading?.ingredientParts ?? []);
      // The name read should be one the page gives the recipe.
      const titles = [...lines.filter((_, i) => { const l = labels[i]; return l && l !== "*" && l.includes("title"); }), ...(draft.title ? [draft.title] : [])];
      const titleRight = !reading || titles.length === 0 || titles.some((t) => letters(t).includes(letters(reading.recipe.title)));
      const steps = score(reading, labels, "step", reading?.stepLines ?? []);
      const intro = reading?.descriptionLine ?? null;
      // "description" marks a paragraph about the dish, which the page shouldn't be read without;
      // "description-ok" a line that's fine to take, though none is fine too.
      const introWanted = labels.some((l) => l && l !== "*" && l.includes("description"));
      const introRight =
        intro === null ? !introWanted : labels[intro] === "*" || (labels[intro] ?? []).some((x) => x === "description" || x === "description-ok");
      const unlabeled = labels.filter((l) => l === null).length;

      const wrongIngredients = ingredients.missing.length + ingredients.extra.length > 0;
      const wrongSteps = steps.missing.length + steps.extra.length > 0;
      totals.pages++;
      totals.ingredients += +wrongIngredients;
      totals.steps += +wrongSteps;
      totals.description += +!introRight;
      totals.title += +!titleRight;
      totals.wrong += +(wrongIngredients || wrongSteps || !titleRight);
      say(
        `${name.padEnd(22)} ${(modelSeconds - before).toFixed(1).padStart(5)}s  ` +
          `ingredients −${ingredients.missing.length} +${ingredients.extra.length}  steps −${steps.missing.length} +${steps.extra.length}  ` +
          `description ${introRight ? "ok" : "wrong"}` + (unlabeled ? `  (${unlabeled} unlabeled lines)` : "") +
          (reading ? `  “${reading.recipe.title}”${titleRight ? "" : " WRONG TITLE"}` : "  NO RECIPE"),
      );
      const show = (what: string, list: number[]) => list.slice(0, 4).forEach((i) => say(`${"".padEnd(26)}${what} ${i + 1}: ${lines[i].slice(0, 80)}`));
      show("missing ingredient", ingredients.missing);
      show("extra ingredient  ", ingredients.extra);
      show("missing step      ", steps.missing);
      show("extra step        ", steps.extra);
      if (!introRight) say(`${"".padEnd(26)}description: ${intro === null ? "none" : `${intro + 1}: ${lines[intro].slice(0, 80)}`}`);
    }
    say(
      `\n${totals.pages - totals.wrong}/${totals.pages} pages right. Wrong title on ${totals.title}, wrong ingredients on ${totals.ingredients}, ` +
        `wrong steps on ${totals.steps}, wrong description on ${totals.description}. Model time ${modelSeconds.toFixed(0)} s.`,
    );
    writeFileSync(join(OUT, `report-${RUN}.txt`), report.join("\n") + "\n");
    expect(totals.pages).toBeGreaterThan(0);
  }, 3 * 60 * 60 * 1000);
});
