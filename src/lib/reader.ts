// Reading a recipe from a page without structured recipe data.
//
// The model gets one easy question at a time, each answered by calling a tool:
// which recipes the page has, the ingredients of the first one, where its steps
// start and end, and so on. Answers quote the page, and the code finds those
// quotes among the page's lines, so what's saved is the page's own text. A quote
// that isn't on the page goes back to the model to fix.

import { z } from "zod";
import type { LlmSettings } from "./api";
import { runJob, tool, type ToolReply } from "./llm";
import type { RecipeDraft, Section } from "./types";

const INSTRUCTIONS = "You read recipes from web pages for a home cook's recipe collection.";

type PageRecipe = Pick<
  RecipeDraft,
  "title" | "description" | "yields" | "prepMinutes" | "cookMinutes" | "totalMinutes" | "ingredients" | "instructions" | "tips"
>;

/** Where each part of the recipe came from on the page, by line index. */
export interface Reading {
  recipe: PageRecipe;
  lines: string[];
  /** Ingredient lines, and lines that only contain an ingredient inside a sentence. */
  ingredientLines: number[];
  ingredientParts: number[];
  stepLines: number[];
  tipLines: number[];
  descriptionLine: number | null;
}

// ---------------------------------------------------------------------------
// Finding quotes among the page's lines

const flat = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*#_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^(?:[-•] |\d+[.)] )/, "");

interface Found {
  index: number;
  /** The quote is the line (or most of it), not just a few words inside a sentence. */
  whole: boolean;
}

/** How alike two strings are, from 0 to 1, by the letter pairs they share. */
function likeness(a: string, b: string): number {
  const pairs = (s: string) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) counts.set(s.slice(i, i + 2), (counts.get(s.slice(i, i + 2)) ?? 0) + 1);
    return counts;
  };
  const [pa, pb] = [pairs(a), pairs(b)];
  let shared = 0;
  for (const [pair, n] of pa) shared += Math.min(n, pb.get(pair) ?? 0);
  return (2 * shared) / Math.max(1, a.length - 1 + b.length - 1);
}

/**
 * Finds a quote on the page, at or after `start`: a line that is the quote, then
 * one that starts with it, then one that contains it, and last a line that is
 * nearly the quote, for a model that copied a character or two wrong.
 */
export function findQuote(lines: string[], quote: string, start = 0): Found | null {
  const q = flat(quote);
  if (!q) return null;
  const flats = lines.map(flat);
  const tests: ((f: string) => boolean)[] = [(f) => f === q, (f) => f.startsWith(q), (f) => f.includes(q) || (f.length > 8 && q.includes(f))];
  for (const test of tests) {
    for (let i = Math.max(0, start); i < lines.length; i++) {
      if (test(flats[i])) return { index: i, whole: !flats[i].includes(q) || flats[i].length <= q.length + 25 || flats[i].startsWith(q) };
    }
  }
  let best: Found | null = null;
  let bestLikeness = 0.8;
  for (let i = Math.max(0, start); i < lines.length; i++) {
    const l = likeness(flats[i], q);
    if (l > bestLikeness) [best, bestLikeness] = [{ index: i, whole: true }, l];
  }
  return best;
}

/** Finds a quote after `start`, or anywhere on the page when it isn't there. */
function findNear(lines: string[], quote: string, start: number): Found | null {
  return findQuote(lines, quote, start) ?? findQuote(lines, quote);
}

const HEADING = /^(?:#{1,6} +(.+?)|\*\*(.+?)\*\*|([^.!?]{1,60}):)\s*$/;
/** Headings that only say what part of the recipe follows. */
const GENERIC = /^(?:the )?(?:ingredients?|instructions?|directions?|method|steps?|preparation|notes?|tips?|recipe)$/i;

/** A heading's text, "" for one that only names the part (like "Ingredients"), or null for other lines. */
export function headingText(line: string): string | null {
  const m = HEADING.exec(line.trim());
  if (!m) return null;
  const text = (m[1] ?? m[2] ?? m[3]).replace(/[*#]+/g, "").replace(/:\s*$/, "").trim();
  return GENERIC.test(text) ? "" : text;
}

const clean = (line: string) =>
  line
    .replace(/^(?:#{1,6} +|[-*•] +|\d+[.)] +)/, "")
    .replace(/\*\*/g, "")
    .trim();

/**
 * Groups lines into sections, starting one at each heading between or just before
 * them. Looking back for the first heading passes over `skip`ped lines, so steps
 * that follow a part's ingredients come under that part's heading.
 */
function group(lines: string[], items: { index: number; text: string }[], skip: (index: number) => boolean = () => false): Section[] {
  items = [...items].sort((a, b) => a.index - b.index);
  if (items.length === 0) return [];
  const sections: Section[] = [];
  let back = items[0].index - 1;
  while (back >= 0 && skip(back)) back--;
  const before = headingText(lines[back] ?? "");
  let current: Section = { heading: before ?? "", items: [] };
  let last = items[0].index - 1;
  for (const item of items) {
    for (let i = last + 1; i < item.index; i++) {
      const heading = headingText(lines[i]);
      if (heading === null) continue;
      if (current.items.length > 0) sections.push(current);
      current = { heading, items: [] };
    }
    current.items.push(item.text);
    last = item.index;
  }
  sections.push(current);
  return sections;
}

// ---------------------------------------------------------------------------
// Questions

interface Answer<T> {
  name: string;
  description: string;
  input: z.ZodType;
  /** Turns the call into the answer, or throws to tell the model what to fix. */
  read: (args: never) => T;
}

function answer<S extends z.ZodType, T>(name: string, description: string, input: S, read: (args: z.infer<S>) => T): Answer<T> {
  return { name, description, input, read };
}

const none = z.strictObject({});

interface Pending {
  /** The job asking the question. */
  job: number;
  question: string;
  answers: Answer<unknown>[];
  settle: (result: { value: unknown } | null) => void;
  fail: (error: unknown) => void;
}

/**
 * Asks a page's questions one at a time, each answered by calling a tool.
 *
 * Warm, all the questions share one job: the reply to each answer carries the
 * next question, so the model keeps the page and its own reasoning about it, and
 * each request only extends the last, which keeps the model's cache. (A new chat
 * message would make Qwen's chat format drop the earlier reasoning.) Otherwise
 * each question is a job of its own.
 */
class Questions {
  private pending: Pending | null = null;
  /** The answer whose reply waits for the next question, in the running job. */
  private waiting: ((reply: ToolReply) => void) | null = null;
  private job = 0;

  constructor(
    private llm: LlmSettings,
    private page: string,
    private answers: Answer<unknown>[],
    private warm: boolean,
  ) {}

  async ask<T>(question: string, answers: Answer<T>[]): Promise<T | null> {
    // A model sometimes ends its turn without answering; asking again usually works.
    for (let attempt = 0; attempt < 2; attempt++) {
      const waiting = this.waiting;
      this.waiting = null;
      if (!waiting) this.job++;
      const result = new Promise<{ value: unknown } | null>((settle, fail) => {
        this.pending = { job: this.job, question, answers, settle, fail };
      });
      if (waiting) waiting(`Got it. Next question: ${question}`);
      else this.start(question);
      const answered = await result;
      if (answered) return answered.value as T;
    }
    return null;
  }

  /** Ends a warm job once there are no more questions. */
  finish() {
    this.waiting?.({ text: "Got it. That's all.", endJob: true });
    this.waiting = null;
  }

  private start(question: string) {
    const tools = (this.warm ? this.answers : this.pending!.answers).map((a) =>
      tool(a.name, a.description, a.input, (args) => this.answer(a, args)),
    );
    const job = this.job;
    runJob(this.llm, INSTRUCTIONS, `${this.page}\n\n${question}`, tools).then(
      () => this.ended(job, null),
      (error) => this.ended(job, error),
    );
  }

  /** A job ended: a question it left unanswered gets no answer, unless the job failed. */
  private ended(job: number, error: unknown) {
    if (job !== this.job) return;
    this.waiting = null;
    const pending = this.pending;
    this.pending = null;
    if (pending && error) pending.fail(error);
    else pending?.settle(null);
  }

  private answer(a: Answer<unknown>, args: unknown): ToolReply | Promise<ToolReply> {
    const pending = this.pending;
    if (!pending?.answers.includes(a)) {
      throw new Error(pending ? `First answer this question: ${pending.question}` : "There's no question to answer.");
    }
    const value = a.read(args as never);
    this.pending = null;
    if (!this.warm) {
      pending.settle({ value });
      return { text: "Got it.", endJob: true };
    }
    return new Promise<ToolReply>((reply) => {
      this.waiting = reply;
      pending.settle({ value });
    });
  }
}

const quoted = (q: string) => `"${q}"`;
/** How a line is marked as part of a list: "-", "1.", and so on, or "" when it isn't. */
const marker = (line: string) => /^\s*(?:[-*•]|\d+[.)])\s/.exec(line)?.[0].trim().replace(/\d+/, "1") ?? "";

/** Reads the first recipe on a page, or returns null when the page has none. */
export async function readPage(
  llm: LlmSettings,
  pageText: string,
  title: string | null,
  url: string | null,
  { warm = true } = {},
): Promise<Reading | null> {
  const lines = pageText.split("\n").filter((line) => line.trim());
  const page = [title && `Page title: ${title}`, url && `URL: ${url}`, "", ...lines].filter((x) => x !== null).join("\n");
  const notOnPage = (quotes: string[]) =>
    new Error(`${quotes.map(quoted).join(", ")} ${quotes.length === 1 ? "isn't" : "aren't"} on the page. Copy the page's words exactly.`);

  // What earlier answers found, which later answers are checked against.
  let name = "";
  let start = 0;
  let complained = false;
  const taken = new Set<number>();

  /** Where a part starts and ends, from quotes of its first and last lines. */
  const range = (first: string, last: string) => {
    const a = findNear(lines, first, start);
    const b = a && findQuote(lines, last, a.index);
    if (a && !b && findQuote(lines, last)) throw new Error(`${quoted(last)} comes before ${quoted(first)} on the page. Give the first one first.`);
    const missing = [...(a ? [] : [first]), ...(a && !b ? [last] : [])];
    if (missing.length > 0) throw notOnPage(missing);
    return [a!.index, b!.index] as const;
  };
  const rangeInput = (what: string) =>
    z.strictObject({ first: z.string().describe(`The first ${what}'s opening words, verbatim`), last: z.string().describe(`The last ${what}'s opening words, verbatim`) });
  const minutes = z.number().int().positive().nullish();

  const names = answer(
    "return_recipe_names",
    "Return your answer: the names of the recipes on this page, in the order they appear.",
    z.strictObject({ names: z.array(z.string()).describe("Each recipe's name") }),
    ({ names }) => names.map((n) => n.trim()).filter(Boolean),
  );
  const ingredientAnswers = [
    answer(
      "return_ingredients",
      "Return your answer: the recipe's ingredients, verbatim, in order.",
      z.strictObject({ ingredients: z.array(z.string()).describe("Each ingredient, verbatim") }),
      ({ ingredients }) => {
        let at = start;
        const used = new Set<number>();
        const matches = ingredients.map((q) => q.trim()).filter(Boolean).map((quote) => {
          let match = findNear(lines, quote, at);
          // An ingredient listed twice, like oil for the meatballs and for the sauce, is its next copy.
          if (match?.whole && used.has(match.index)) match = findQuote(lines, quote, match.index + 1) ?? match;
          if (match) {
            at = match.index;
            if (match.whole) used.add(match.index);
          }
          return { quote, match };
        });
        const missing = matches.filter((m) => !m.match).map((m) => m.quote);
        // A line alone between two ingredients and marked like them, as an egg in the middle of a list, was skipped.
        const skipped = lines.flatMap((line, i) =>
          used.has(i - 1) && used.has(i + 1) && !used.has(i) && headingText(line) === null &&
          marker(line) === marker(lines[i - 1]) && marker(line) === marker(lines[i + 1]) ? [line] : [],
        );
        // Complain once; a second answer is taken with whatever it got right.
        if (missing.length > 0 && !complained) {
          complained = true;
          throw notOnPage(missing);
        }
        if (skipped.length > 0 && !complained) {
          complained = true;
          throw new Error(
            `${skipped.map(quoted).join(", ")} ${skipped.length === 1 ? "is" : "are"} between two of your ingredients. ` +
              "If you skipped an ingredient, call `return_ingredients` again with all of them; if not, send the same list again.",
          );
        }
        return matches.flatMap(({ quote, match }) => (match ? [{ ...match, quote }] : []));
      },
    ),
    answer("no_ingredient_list", "Return your answer: the recipe has no list of ingredients.", none, () => []),
  ];
  const stepAnswers = [
    answer("return_step_range", "Return your answer: where the recipe's steps start and end.", rangeInput("step"), ({ first, last }) => range(first, last)),
    answer("no_steps", "Return your answer: the recipe has no steps.", none, () => null),
  ];
  const noteAnswers = [
    answer("return_note_range", "Return your answer: where the recipe's notes start and end.", rangeInput("note"), ({ first, last }) => range(first, last)),
    answer("no_notes", "Return your answer: the recipe has no separate notes.", none, () => null),
  ];
  const descriptionAnswers = [
    answer("return_description", "Return your answer: the paragraph that introduces the recipe.", z.strictObject({ opening: z.string().describe("The paragraph's opening words, verbatim") }), ({ opening }) => {
      const match = findNear(lines, opening, 0);
      if (!match) throw notOnPage([opening]);
      if (headingText(lines[match.index]) !== null) throw new Error(`${quoted(opening)} is a heading. Choose the paragraph introducing ${name}, or call \`no_description\`.`);
      return taken.has(match.index) ? null : match.index;
    }),
    answer("no_description", "Return your answer: the page doesn't introduce the recipe.", none, () => null as number | null),
  ];
  const detailAnswers = [
    answer(
      "return_details",
      "Return your answer: the recipe's yield and times, as the page states them.",
      z.strictObject({
        yields: z.string().nullish().describe('How much it makes, like "12 muffins"'),
        prepMinutes: minutes.describe("Preparation time in minutes"),
        cookMinutes: minutes.describe("Cooking or baking time in minutes"),
        totalMinutes: minutes.describe("Total time in minutes, only if the page states a total"),
      }),
      (details) => details,
    ),
  ];
  const questions = new Questions(llm, page, [names, ...ingredientAnswers, ...stepAnswers, ...noteAnswers, ...descriptionAnswers, ...detailAnswers] as Answer<unknown>[], warm);

  try {
    // Which recipes are on the page. Only the first is read.
    const nameQuestion = "Which recipes are written out on this page? Call `return_recipe_names` with their names, verbatim, in order.";
    let found = await questions.ask(nameQuestion, [names]);
    if (found?.length === 0) found = await questions.ask(nameQuestion, [names]);
    if (!found?.length) return null;
    name = found[0];
    start = findQuote(lines, name)?.index ?? 0;

    // Its ingredients, each quoted, so lists split by steps or headings come out whole.
    const ingredients =
      (await questions.ask(
        `What are the ingredients of ${name}? Call \`return_ingredients\` with each one, verbatim, in the order the page lists them. If ${name} has no list of ingredients, call \`no_ingredient_list\`.`,
        ingredientAnswers,
      )) ?? [];
    const ingredientLines = [...new Set(ingredients.filter((i) => i.whole).map((i) => i.index))];
    const ingredientParts = [...new Set(ingredients.filter((i) => !i.whole).map((i) => i.index))].filter((i) => !ingredientLines.includes(i));
    const ingredientItems = [
      ...ingredientLines.map((index) => ({ index, text: clean(lines[index]) })),
      ...ingredients.filter((i) => !i.whole && !ingredientLines.includes(i.index)).map((i) => ({ index: i.index, text: i.quote })),
    ];
    for (const i of ingredientLines) taken.add(i);

    // Its steps: the lines from the first step to the last, apart from ingredients and headings.
    const steps = await questions.ask(
      `What are the first and last steps of ${name}? A step tells the cook what to do; how much the recipe makes or how big a serving is isn't a step. If the steps are in parts, like the filling and then the topping, the last step is the end of the last part. Call \`return_step_range\` with the opening words of each, verbatim. If ${name} has no steps, call \`no_steps\`.`,
      stepAnswers,
    );
    // Notes apart from the steps, which come out of the steps when they sit among them.
    const tips = await questions.ask(
      `Does ${name} have notes apart from its ingredients and steps, such as tips, variations, or how to store it? If so, call \`return_note_range\` with the opening words of the first and last, verbatim. If not, call \`no_notes\`.`,
      noteAnswers,
    );
    const span = (r: readonly [number, number] | null | undefined) => (r ? Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k) : []);
    // A line the model named as a part's first or last is that part's, even when it looks like a heading.
    const plain = (r: readonly [number, number] | null | undefined) => (i: number) =>
      !taken.has(i) && (headingText(lines[i]) === null || i === r![0] || i === r![1]);
    let tipLines = span(tips).filter(plain(tips));
    let stepLines = span(steps).filter(plain(steps));
    const withoutTips = stepLines.filter((i) => !tipLines.includes(i));
    if (withoutTips.length > 0) stepLines = withoutTips;
    else tipLines = tipLines.filter((i) => !stepLines.includes(i));
    for (const i of [...stepLines, ...tipLines]) taken.add(i);

    // The paragraph introducing the dish, if the page has one.
    const descriptionLine = await questions.ask(
      `Does the page have a paragraph that introduces ${name} itself, such as where it comes from or what it's like? If so, call \`return_description\` with that paragraph's opening words, verbatim. If not, call \`no_description\`.`,
      descriptionAnswers,
    );

    // What it makes and how long it takes, as the page states them.
    const details = await questions.ask(
      `How much does ${name} make, and how long does it take? Call \`return_details\` with what the page states, and leave out anything it doesn't say.`,
      detailAnswers,
    );

    const recipe: PageRecipe = {
      title: name,
      description: descriptionLine === null ? "" : clean(lines[descriptionLine]),
      yields: details?.yields?.trim() || null,
      prepMinutes: details?.prepMinutes ?? null,
      cookMinutes: details?.cookMinutes ?? null,
      totalMinutes: details?.totalMinutes ?? null,
      ingredients: group(lines, ingredientItems),
      instructions: group(lines, stepLines.map((index) => ({ index, text: clean(lines[index]) })), (i) => ingredientLines.includes(i)),
      tips: group(lines, tipLines.map((index) => ({ index, text: clean(lines[index]) }))),
    };
    return { recipe, lines, ingredientLines, ingredientParts, stepLines, tipLines, descriptionLine };
  } finally {
    questions.finish();
  }
}

/** Reads a recipe from a page's text, or returns null when the page has none. */
export async function extractRecipe(llm: LlmSettings, pageText: string, title: string | null, url: string | null): Promise<PageRecipe | null> {
  const reading = await readPage(llm, pageText, title, url);
  if (!reading || (reading.recipe.ingredients.length === 0 && reading.recipe.instructions.length === 0)) return null;
  return reading.recipe;
}
