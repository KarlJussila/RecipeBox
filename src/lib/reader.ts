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
import { PageLines, flat } from "./page-lines";
import type { ReadablePage } from "./extract/page";
import { partsToRecipe, type LinePart, type SourcePage } from "./source-page";
import type { RecipeDraft } from "./types";

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
  /** The page's lines and what each became, to keep with the recipe. */
  source: SourcePage;
}

// ---------------------------------------------------------------------------
// Questions

interface Answer<T> {
  name: string;
  description: string;
  input: z.ZodType;
  /**
   * Turns the call into the answer, or throws to tell the model what to fix when the
   * answer can't be used. An answer that can be used but looks wrong goes to `doubt`.
   */
  read: (args: never, doubt: Doubt) => T;
}

/**
 * Sends an answer back with what looks wrong about it, the first time for each
 * question; after that the answer stands. The checks that doubt an answer only guess
 * from the page's layout, so the model gets to keep its answer by sending it again.
 */
type Doubt = (message: string) => void;

function answer<S extends z.ZodType, T>(name: string, description: string, input: S, read: (args: z.infer<S>, doubt: Doubt) => T): Answer<T> {
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
  /** Questions whose answer has been doubted once already. */
  private doubted = new Set<string>();

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
    const doubt: Doubt = (message) => {
      if (this.doubted.has(pending.question)) return;
      this.doubted.add(pending.question);
      throw new Error(message);
    };
    const value = a.read(args as never, doubt);
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
type Range = readonly [number, number];
/** Whether a range runs over the first or last line of another, rather than sitting inside it or apart from it. */
const crosses = (a: Range, b: Range) => (a[0] < b[0] ? a[1] >= b[0] : a[0] <= b[1] && a[1] > b[1]);

/** Reads the first recipe on a page, or returns null when the page has none. */
export async function readPage(
  llm: LlmSettings,
  pageText: string,
  title: string | null,
  url: string | null,
  /** links: each line's link texts, as readablePage finds them. */
  { warm = true, links = [] as string[][] } = {},
): Promise<Reading | null> {
  const page = new PageLines(pageText.split("\n").filter((line) => line.trim()));
  const { lines } = page;
  const prompt = [title && `Page title: ${title}`, url && `URL: ${url}`, "", ...lines].filter((x) => x !== null).join("\n");
  const notOnPage = (quotes: string[]) =>
    new Error(`${quotes.map(quoted).join(", ")} ${quotes.length === 1 ? "isn't" : "aren't"} on the page. Copy the page's words exactly.`);

  // What earlier answers found, which later answers are checked against.
  let name = "";
  let start = 0;
  let stepRange: Range | null = null;
  const taken = new Set<number>();

  /** Where a part starts and ends, from quotes of its first and last lines. */
  const range = (first: string, last: string) => {
    const a = page.findNear(first, start);
    const b = a && page.find(last, a.index);
    if (a && !b && page.find(last)) throw new Error(`${quoted(last)} comes before ${quoted(first)} on the page. Give the first one first.`);
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
    ({ names }, doubt) => {
      const found = names.map((n) => n.trim()).filter(Boolean);
      // A name the page only shows as a line that's nearly all link, like "Source: <a>Soft Sugar
      // Cookies</a>", is another page's. A card with a linked title and an excerpt under it can
      // be the page's own recipe, so those don't count.
      const [first, q] = [found[0] ?? "", flat(found[0] ?? "")];
      const mentions = page.mentions(first);
      const linked = (i: number) => {
        const texts = (links[i] ?? []).map(flat);
        const rest = texts.reduce((line, text) => line.replace(text, ""), flat(lines[i])).replace(/[^a-z0-9]+/g, "");
        return texts.some((text) => text.includes(q)) && rest.length <= 12;
      };
      if (mentions.length > 0 && mentions.every(linked) && !flat(title ?? "").includes(q)) {
        doubt(
          `${quoted(first)} only appears on the page as a link to another page. ` +
            "Which recipes are written out on this page itself? Call `return_recipe_names` with their names, verbatim, in order.",
        );
      }
      return found;
    },
  );
  const ingredientAnswers = [
    answer(
      "return_ingredients",
      "Return your answer: the recipe's ingredients, verbatim, in order.",
      z.strictObject({ ingredients: z.array(z.string()).describe("Each ingredient, verbatim") }),
      ({ ingredients }, doubt) => {
        let at = start;
        const used = new Set<number>();
        const matches = ingredients.map((q) => q.trim()).filter(Boolean).map((quote) => {
          let match = page.findNear(quote, at);
          // An ingredient listed twice, like oil for the meatballs and for the sauce, is its next copy.
          if (match?.whole && used.has(match.index)) match = page.find(quote, match.index + 1) ?? match;
          if (match) {
            at = match.index;
            if (match.whole) used.add(match.index);
          }
          return { quote, match };
        });
        const missing = matches.filter((m) => !m.match).map((m) => m.quote);
        // A line alone between two ingredients and marked like them, as an egg in the middle of a list, was skipped.
        const skipped = lines.flatMap((line, i) =>
          used.has(i - 1) && used.has(i + 1) && !used.has(i) && page.heading(i) === null &&
          page.marker(i) === page.marker(i - 1) && page.marker(i) === page.marker(i + 1) ? [line] : [],
        );
        // Ingredients copied without their amounts, like "sugar" for "2 cups sugar".
        const shortened = matches.flatMap(({ quote, match }) => (match && page.shortened(quote, match) ? [match] : []));
        // Doubted answers are sent back once; a second answer is taken with whatever it got right.
        if (shortened.length >= 2 && shortened.length * 2 >= matches.length) {
          doubt(`Copy each ingredient's whole line from the page, with its amount, like ${quoted(page.clean(shortened[0].index))}.`);
        }
        if (missing.length > 0) doubt(notOnPage(missing).message);
        if (skipped.length > 0) {
          doubt(
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
    answer("return_step_range", "Return your answer: where the recipe's steps start and end.", rangeInput("step"), ({ first, last }, doubt) => {
      const found = range(first, last);
      // A heading right after the last step that also heads some of the ingredients, like "For the croutons:",
      // with steps marked like the last under it, is probably another part.
      const after = found[1] + 1;
      const mark = page.marker(found[1]);
      const part = page.heading(after);
      const headsIngredients = !!part && lines.some((_, i) => taken.has(i + 1) && page.heading(i) === part);
      if (mark && headsIngredients && page.marker(after + 1) === mark) {
        doubt(
          `${quoted(lines[after])} and more steps come right after your last step. ` +
            `If they're part of ${name}, call \`return_step_range\` again with the last of them; if not, send the same range again.`,
        );
      }
      return found;
    }),
    answer("no_steps", "Return your answer: the recipe has no steps.", none, () => null),
  ];
  const noteAnswers = [
    answer("return_note_range", "Return your answer: where the recipe's notes start and end.", rangeInput("note"), ({ first, last }, doubt) => {
      const found = range(first, last);
      if (stepRange && crosses(found, stepRange)) {
        doubt(`Those notes run over ${name}'s steps. Give the first and last note that isn't a step, or call \`no_notes\`.`);
      }
      return found;
    }),
    answer("no_notes", "Return your answer: the recipe has no separate notes.", none, () => null),
  ];
  const descriptionAnswers = [
    answer("return_description", "Return your answer: the paragraph that introduces the recipe.", z.strictObject({ opening: z.string().describe("The paragraph's opening words, verbatim") }), ({ opening }) => {
      const match = page.findNear(opening, 0);
      if (!match) throw notOnPage([opening]);
      if (page.heading(match.index) !== null) throw new Error(`${quoted(opening)} is a heading. Choose the paragraph introducing ${name}, or call \`no_description\`.`);
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
  const questions = new Questions(llm, prompt, [names, ...ingredientAnswers, ...stepAnswers, ...noteAnswers, ...descriptionAnswers, ...detailAnswers] as Answer<unknown>[], warm);

  try {
    // Which recipes are on the page. Only the first is read.
    const nameQuestion = "Which recipes are written out on this page? Call `return_recipe_names` with their names, verbatim, in order.";
    let found = await questions.ask(nameQuestion, [names]);
    if (found?.length === 0) found = await questions.ask(nameQuestion, [names]);
    if (!found?.length) return null;
    name = found[0];
    const titleLine = page.find(name)?.index ?? null;
    start = titleLine ?? 0;

    // Its ingredients, each quoted, so lists split by steps or headings come out whole.
    const ingredients =
      (await questions.ask(
        `What are the ingredients of ${name}? If they're in parts, like the cake and then the frosting, include every part's. Call \`return_ingredients\` with each one, verbatim, in the order the page lists them. If ${name} has no list of ingredients, call \`no_ingredient_list\`.`,
        ingredientAnswers,
      )) ?? [];
    const ingredientLines = [...new Set(ingredients.filter((i) => i.whole).map((i) => i.index))];
    const ingredientParts = [...new Set(ingredients.filter((i) => !i.whole).map((i) => i.index))].filter((i) => !ingredientLines.includes(i));
    const quotes = ingredients.filter((i) => !i.whole && !ingredientLines.includes(i.index)).map((i) => ({ line: i.index, text: i.quote }));
    for (const i of ingredientLines) taken.add(i);

    // Its steps: the lines from the first step to the last, apart from ingredients and headings.
    const steps = await questions.ask(
      `What are the first and last steps of ${name}? A step tells the cook what to do; how much the recipe makes or how big a serving is isn't a step. If they're one paragraph, give its opening words as both. Call \`return_step_range\` with the opening words of each, verbatim. If ${name} has no steps, call \`no_steps\`.`,
      stepAnswers,
    );
    stepRange = steps;
    // Notes apart from the steps, which come out of the steps when they sit among them.
    const tips = await questions.ask(
      `Does ${name} have notes apart from its ingredients and steps, such as tips, variations, or how to store it? If so, call \`return_note_range\` with the opening words of the first and last, verbatim. If not, call \`no_notes\`.`,
      noteAnswers,
    );
    const span = (r: readonly [number, number] | null | undefined) => (r ? Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k) : []);
    // A line the model named as a part's first or last is that part's, even when it looks like a heading.
    const plain = (r: readonly [number, number] | null | undefined) => (i: number) =>
      !taken.has(i) && (page.heading(i) === null || i === r![0] || i === r![1]);
    let stepLines = span(steps).filter(plain(steps));
    let tipLines = span(tips).filter(plain(tips));
    // Notes that sit among the steps come out of them, unless they'd take every step.
    // Notes that run over the steps' first or last line keep only the lines outside them.
    if (tips && steps && crosses(tips, steps)) tipLines = tipLines.filter((i) => i < steps[0] || i > steps[1]);
    else if (stepLines.some((i) => !tipLines.includes(i))) stepLines = stepLines.filter((i) => !tipLines.includes(i));
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

    const parts: (LinePart | null)[] = lines.map(() => null);
    for (const i of ingredientLines) parts[i] = "ingredient";
    for (const i of stepLines) parts[i] = "step";
    for (const i of tipLines) parts[i] = "tip";
    if (descriptionLine !== null) parts[descriptionLine] = "description";
    const source: SourcePage = { lines, parts, titleLine, quotes };

    const recipe: PageRecipe = {
      ...partsToRecipe(source),
      title: name,
      yields: details?.yields?.trim() || null,
      prepMinutes: details?.prepMinutes ?? null,
      cookMinutes: details?.cookMinutes ?? null,
      totalMinutes: details?.totalMinutes ?? null,
    };
    return { recipe, lines, ingredientLines, ingredientParts, stepLines, tipLines, descriptionLine, source };
  } finally {
    questions.finish();
  }
}

/** Reads a recipe from a page's text, with the page it came from, or returns null when the page has none. */
export async function extractRecipe(
  llm: LlmSettings,
  page: ReadablePage,
  title: string | null,
  url: string | null,
): Promise<{ recipe: PageRecipe; source: SourcePage } | null> {
  const reading = await readPage(llm, page.text, title, url, { links: page.links });
  if (!reading || (reading.recipe.ingredients.length === 0 && reading.recipe.instructions.length === 0)) return null;
  return { recipe: reading.recipe, source: reading.source };
}
