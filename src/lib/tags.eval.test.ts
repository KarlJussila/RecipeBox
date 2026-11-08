/// <reference types="node" />
// Tags recipes from the collection with a real model through opencode and reports what
// each got. Skipped unless RB_EVAL is set, since it runs a model:
//
//   RB_EVAL=1 RB_SERVICE=http://127.0.0.1:8092/v1 npx vitest run src/lib/tags.eval.test.ts
//
// RB_SERVICE  OpenAI-compatible service, or "none" for opencode's own models. Required:
//             LM Studio's server loads whatever model a request names.
// RB_MODEL    model (default spark)
// RB_RECIPES  recipe titles, separated by "|" (default three with a known answer)
// RB_RUN      a name for the run's folder in ~/rb-lab/app-eval/tags
//
// opencode runs the way the app runs it (src-tauri/src/opencode.rs): the same command,
// config, and plugin. Each job's opencode events are saved as they arrive.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test, vi } from "vitest";

const SERVICE = process.env.RB_SERVICE;
const MODEL = process.env.RB_MODEL ?? "spark";
const RECIPES = (process.env.RB_RECIPES ?? "Hash Brown Crust Quiche Lorraine|15-Minute Vegetable Curry|Zucchini Muffins").split("|");
const OUT = join(homedir(), "rb-lab/app-eval/tags", process.env.RB_RUN ?? "1");

interface Job { id: string; model: string; service: { baseUrl: string; apiKey: string } | null; instructions: string; message: string }
interface ToolDef { name: string; description: string; inputSchema: unknown }

const bridge = vi.hoisted(() => ({
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

import { suggestTags } from "./llm";

/** The job's opencode events, saved as they arrive. */
let eventLog = "";

/** As run() in opencode.rs, with tools.rs's side done by the bridge. */
async function opencodeRun(job: Job, tools: ToolDef[]): Promise<string> {
  let child: ChildProcess | null = null;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const call = JSON.parse(body);
      const id = crypto.randomUUID();
      bridge.waiting.set(id, (reply) => {
        appendFileSync(eventLog, JSON.stringify({ type: "recipebox-reply", call, reply }) + "\n");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: reply.text }));
        if (reply.endJob) child?.kill("SIGKILL");
      });
      bridge.listeners.forEach((listener) => listener({ payload: { job: job.id, call: id, ...call } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const dir = join(OUT, "opencode");
  mkdirSync(join(dir, "config/plugin"), { recursive: true });
  mkdirSync(join(dir, "sandbox"), { recursive: true });
  copyFileSync("src-tauri/src/opencode-plugin.js", join(dir, "config/plugin/recipebox.js"));
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
      },
    };
  }
  try {
    await new Promise<void>((resolve, reject) => {
      child = spawn("opencode", ["run", "--standalone", "--agent", "recipebox", "--format", "json", "-m", job.service ? `recipebox-service/${job.model}` : job.model], {
        cwd: join(dir, "sandbox"),
        env: {
          ...process.env,
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          OPENCODE_CONFIG_DIR: join(dir, "config"),
          RECIPEBOX_TOOLS: JSON.stringify(tools),
          RECIPEBOX_TOOL_URL: `http://127.0.0.1:${port}/tool`,
          RECIPEBOX_JOB: job.id,
          PWD: join(dir, "sandbox"),
        },
      });
      let err = "";
      child.stderr!.on("data", (chunk) => { err += chunk; });
      child.stdout!.on("data", (chunk) => { appendFileSync(eventLog, chunk); });
      child.on("error", reject);
      child.on("close", (code, signal) => (code === 0 || signal === "SIGKILL" ? resolve() : reject(new Error(`opencode failed (${code}): ${err.slice(-400)}`))));
      child.stdin!.end(job.message);
    });
  } finally {
    server.close();
  }
  return "";
}

describe.runIf(process.env.RB_EVAL)("tagging recipes", () => {
  test("tags each recipe", async () => {
    if (!SERVICE) throw new Error("Set RB_SERVICE");
    const db = new DatabaseSync(join(homedir(), ".local/share/com.jussila.recipebox/recipes.db"), { readOnly: true });
    const tags = db.prepare("SELECT name, category FROM tags").all() as { name: string; category: string | null }[];
    const llm = SERVICE === "none"
      ? { provider: "opencode" as const, baseUrl: "", apiKey: "", model: MODEL }
      : { provider: "api" as const, baseUrl: SERVICE, apiKey: "", model: MODEL };
    mkdirSync(OUT, { recursive: true });
    const report: string[] = [];
    for (const [i, title] of RECIPES.entries()) {
      const row = db.prepare("SELECT title, description, ingredients, instructions, keywords FROM recipes WHERE title = ?").get(title) as
        | { title: string; description: string; ingredients: string; instructions: string; keywords: string }
        | undefined;
      if (!row) throw new Error(`No recipe called ${title}`);
      eventLog = join(OUT, `${String(i + 1).padStart(2, "0")}-events.jsonl`);
      writeFileSync(eventLog, "");
      const started = Date.now();
      let line: string;
      try {
        const chosen = await suggestTags(llm, { ...row, keywords: JSON.parse(row.keywords) }, tags);
        line = `${title}: ${chosen.map((t) => t.name).join(", ")}`;
      } catch (e) {
        line = `${title}: failed: ${e instanceof Error ? e.message : String(e)}`;
      }
      line += ` (${((Date.now() - started) / 1000).toFixed(1)} s)`;
      report.push(line);
      console.log(line);
    }
    writeFileSync(join(OUT, "report.txt"), report.join("\n") + "\n");
  }, 3_600_000);
});
