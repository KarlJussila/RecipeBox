import { describe, expect, test } from "vitest";
import { parseDuration } from "./duration";
import { extractFromHtml, readablePage, readableText } from "./page";
import { draftFromSchema, ingredientSections, instructionSections, pickImage } from "./schema";
import { cleanText, servingsFrom } from "./text";

function page(jsonLd: unknown, head = ""): string {
  return `<html><head>${head}<script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body></body></html>`;
}

describe("parseDuration", () => {
  test.each([
    ["PT45M", 45],
    ["PT1H15M", 75],
    ["PT295M", 295],
    ["P0DT1H30M", 90],
    ["P1D", 1440],
    ["20 minutes", 20],
    ["1 hour 20 mins", 80],
    ["2 hrs", 120],
    ["PT0S", null],
    ["", null],
    [undefined, null],
  ])("%s -> %s", (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });
});

describe("cleanText", () => {
  test("decodes entities and strips tags", () => {
    expect(cleanText("Salt &amp; pepper <b>to taste</b>")).toBe("Salt & pepper to taste");
  });
  test("handles double-encoded entities", () => {
    expect(cleanText("Mac &amp;amp; cheese")).toBe("Mac & cheese");
  });
  test("does not loop on text that only looks like an entity", () => {
    expect(cleanText("R&D; &x;")).toBe("R&D; &x;");
  });
  test("keeps paragraph breaks as lines", () => {
    expect(cleanText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  });
});

describe("instructionSections", () => {
  test("plain strings and HowToSteps become one section", () => {
    expect(instructionSections([{ "@type": "HowToStep", text: "Mix." }, "Bake."])).toEqual([
      { heading: "", items: ["Mix.", "Bake."] },
    ]);
  });
  test("HowToSections keep their headings, tidied", () => {
    const sections = instructionSections([
      { "@type": "HowToSection", name: "For the dough:", itemListElement: [{ "@type": "HowToStep", text: "Knead." }] },
      { "@type": "HowToSection", name: "TO MAKE AHEAD", itemListElement: [{ "@type": "HowToStep", text: "Chill." }] },
    ]);
    expect(sections).toEqual([
      { heading: "For the dough", items: ["Knead."] },
      { heading: "To make ahead", items: ["Chill."] },
    ]);
  });
  test("a single block of text is split into numbered steps", () => {
    expect(instructionSections("1. Mix the flour.\n2. Bake it.")).toEqual([{ heading: "", items: ["Mix the flour.", "Bake it."] }]);
  });
  test("a step title in `name` is kept when it differs from the text", () => {
    expect(instructionSections([{ "@type": "HowToStep", name: "Brown the meat", text: "Heat oil and add beef." }])).toEqual([
      { heading: "", items: ["Brown the meat. Heat oil and add beef."] },
    ]);
  });
});

describe("ingredientSections", () => {
  test("colon lines become headings", () => {
    expect(ingredientSections(["For the crust:", "2 cups flour", "FOR THE FILLING:", "3 apples"])).toEqual([
      { heading: "For the crust", items: ["2 cups flour"] },
      { heading: "For the filling", items: ["3 apples"] },
    ]);
  });
  test("drops template placeholders sites leak into their data", () => {
    expect(ingredientSections(["4 undefined garlic cloves", "null"])).toEqual([{ heading: "", items: ["4 garlic cloves"] }]);
  });
  test("keeps a note's own punctuation instead of wrapping it again", () => {
    expect(
      ingredientSections([
        "2 tbsp unsalted butter (, melted)",
        "Oil spray ((or olive oil))",
        "1 small onion (, diced (or half a large onion))",
        "600g starchy potatoes ((Note 1) OR 4 cups frozen hash browns, thawed)",
        "1 cup milk (whole)",
      ])[0].items,
    ).toEqual([
      "2 tbsp unsalted butter, melted",
      "Oil spray (or olive oil)",
      "1 small onion, diced (or half a large onion)",
      "600g starchy potatoes (Note 1) OR 4 cups frozen hash browns, thawed",
      "1 cup milk (whole)",
    ]);
  });
  test("lines with quantities are never headings", () => {
    expect(ingredientSections(["Ratio 1:2:"])).toEqual([{ heading: "", items: ["Ratio 1:2:"] }]);
  });
});

describe("pickImage", () => {
  test("prefers the widest image up to 2400px", () => {
    const images = [
      { "@type": "ImageObject", url: "https://x/small.jpg", width: 600 },
      { "@type": "ImageObject", url: "https://x/huge.jpg", width: 4800 },
      { "@type": "ImageObject", url: "https://x/good.jpg", width: 1600 },
    ];
    expect(pickImage(images, null)).toBe("https://x/good.jpg");
  });
  test("resolves relative URLs against the page", () => {
    expect(pickImage("/img/a.jpg", "https://site.com/recipe/1")).toBe("https://site.com/img/a.jpg");
  });
});

describe("extractFromHtml", () => {
  test("drops a trailing \"recipe\" from a one-word title", () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Meatloaf recipe","recipeIngredient":["1 lb beef"],"recipeInstructions":"Bake."}</script>`;
    expect(extractFromHtml(html, "https://site.com/meatloaf").draft.title).toBe("Meatloaf");
  });
  test("keeps a recipe told only in prose, with the prose as its method", () => {
    const prose = "Set a pot of nicely salted water over high heat to boil. ".repeat(10).trim();
    const html = page({ "@type": "Recipe", name: "Fettuccine", description: prose, recipeInstructions: { "@type": "HowToStep", url: "https://site.com/f#step-1" } });
    const { draft, complete } = extractFromHtml(html, "https://site.com/f");
    expect(complete).toBe(true);
    expect(draft.instructions).toEqual([{ heading: "", items: [prose] }]);
    expect(draft.description).toBe("");
  });
  test("still asks for more when a short summary is all there is", () => {
    const html = page({ "@type": "Recipe", name: "Fettuccine", description: "A quick pasta." });
    expect(extractFromHtml(html, "https://site.com/f").complete).toBe(false);
  });
  const recipe = {
    "@context": "https://schema.org",
    "@type": ["Recipe", "NewsArticle"],
    name: "Lemony Roast Chicken Recipe",
    description: "Bright &amp; crisp.",
    author: [{ "@type": "Person", name: "Ann Cook" }],
    publisher: { "@type": "Organization", name: "Good Food" },
    image: ["https://cdn.example/chicken.jpg"],
    recipeYield: ["4", "4 servings"],
    prepTime: "PT15M",
    cookTime: "PT1H",
    recipeIngredient: ["1 chicken", "2 lemons"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Roast it." }],
    keywords: "chicken, weeknight, 2024",
    recipeCategory: "Dinner, Main Course",
    recipeCuisine: ["French"],
  };

  test("reads a complete recipe", () => {
    const { draft, complete } = extractFromHtml(page(recipe), "https://example.com/roast-chicken");
    expect(complete).toBe(true);
    expect(draft).toMatchObject({
      title: "Lemony Roast Chicken",
      description: "Bright & crisp.",
      author: "Ann Cook",
      sourceName: "Good Food",
      sourceUrl: "https://example.com/roast-chicken",
      imageUrl: "https://cdn.example/chicken.jpg",
      servings: "4",
      prepMinutes: 15,
      cookMinutes: 60,
      totalMinutes: 75,
      keywords: ["chicken", "weeknight"],
      categories: ["Dinner", "Main Course"],
      cuisines: ["French"],
    });
    expect(draft.ingredients).toEqual([{ heading: "", items: ["1 chicken", "2 lemons"] }]);
  });

  test("finds recipes inside @graph and prefers og:site_name", () => {
    const html = page({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, recipe] }, '<meta property="og:site_name" content="Good Food Magazine">');
    const { draft } = extractFromHtml(html, "https://example.com/r");
    expect(draft.title).toBe("Lemony Roast Chicken");
    expect(draft.sourceName).toBe("Good Food Magazine");
  });

  test("uses the canonical URL from the same site", () => {
    const html = page(recipe, '<link rel="canonical" href="https://example.com/recipes/roast-chicken">');
    expect(extractFromHtml(html, "https://example.com/r?utm_source=x").draft.sourceUrl).toBe("https://example.com/recipes/roast-chicken");
  });

  test("tolerates raw newlines inside JSON-LD strings", () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Soup","recipeIngredient":["1 onion\n chopped"],"recipeInstructions":"Cook."}</script>`;
    const { draft, complete } = extractFromHtml(html, "https://example.com/soup");
    expect(complete).toBe(true);
    expect(draft.title).toBe("Soup");
  });

  test("reads microdata when there is no JSON-LD", () => {
    const html = `<div itemscope itemtype="http://schema.org/Recipe">
      <h1 itemprop="name">Old Fashioned Pancakes</h1>
      <li itemprop="recipeIngredient">1 cup flour</li><li itemprop="recipeIngredient">1 egg</li>
      <div itemprop="recipeInstructions">Whisk and fry.</div>
      <meta itemprop="totalTime" content="PT20M">
    </div>`;
    const { draft, complete } = extractFromHtml(html, "https://example.com/pancakes");
    expect(complete).toBe(true);
    expect(draft.title).toBe("Old Fashioned Pancakes");
    expect(draft.totalMinutes).toBe(20);
    expect(draft.ingredients[0].items).toEqual(["1 cup flour", "1 egg"]);
  });

  test("reads WordPress/Jetpack recipe blocks (microdata plus h-recipe classes)", () => {
    const html = `<div class="h-recipe jetpack-recipe" itemscope itemtype="https://schema.org/Recipe">
      <h3 class="p-name" itemprop="name">Tomato Risotto</h3>
      <li class="p-yield" itemprop="recipeYield"><strong>Servings: </strong>4</li>
      <time itemprop="totalTime" datetime="P0DT0H50M0S"><strong>Time:</strong> 50 minutes</time>
      <li class="p-ingredient" itemprop="recipeIngredient">1 cup rice</li>
      <div class="e-instructions"><p><strong>Heat oven:</strong> To 350°F.</p><p>Grate the tomatoes.</p></div>
    </div>`;
    const { draft, complete } = extractFromHtml(html, "https://blog.example/risotto");
    expect(complete).toBe(true);
    expect(draft).toMatchObject({ title: "Tomato Risotto", servings: "4", totalMinutes: 50 });
    expect(draft.instructions).toEqual([{ heading: "", items: ["Heat oven: To 350°F.", "Grate the tomatoes."] }]);
  });

  test("reads the notes a recipe card leaves out of its structured data", () => {
    const html = page({
      "@type": "Recipe",
      name: "Quiche",
      recipeIngredient: ["2 eggs"],
      recipeInstructions: ["Grease a pie dish (Note 1)", "Bake."],
    }).replace(
      "<body></body>",
      `<body><div class="wprm-recipe-notes-container"><h3 class="wprm-recipe-header">Recipe Notes:</h3><div class="wprm-recipe-notes">` +
        `<span style="display: block;"><strong>1. Pie dish</strong> – not one with a removable base.</span><div class="wprm-spacer"></div>` +
        `<span style="display: block;">2. Keeps for 3 days.</span><div class="wprm-spacer"></div>` +
        `<span style="display: block;">3. Nutrition per serving.</span></div></div></body>`,
    );
    expect(extractFromHtml(html, null).draft.tips).toEqual([
      { heading: "", items: ["1. Pie dish – not one with a removable base.", "2. Keeps for 3 days."] },
    ]);
  });
  test("leaves the site's name out of the author", () => {
    const html = page(
      { "@type": "Recipe", name: "Meatloaf", author: { "@type": "Person", name: "Nagi | RecipeTin Eats" }, recipeIngredient: ["1 egg"] },
      '<meta property="og:site_name" content="RecipeTin Eats">',
    );
    expect(extractFromHtml(html, null).draft.author).toBe("Nagi");
  });
  test("falls back to page metadata when there is no recipe data", () => {
    const html = '<head><meta property="og:title" content="A Blog Post"><meta property="og:image" content="/a.jpg"></head>';
    const { draft, complete } = extractFromHtml(html, "https://www.blog.com/post");
    expect(complete).toBe(false);
    expect(draft).toMatchObject({ title: "A Blog Post", imageUrl: "https://www.blog.com/a.jpg", sourceName: "blog.com" });
  });
});

describe("readableText", () => {
  const text = (body: string) => readableText(new DOMParser().parseFromString(`<body>${body}</body>`, "text/html"));

  test("keeps headings, list items, and line breaks, without relying on the source's newlines", () => {
    expect(text("<h2>Cake</h2><ul><li>2 eggs</li><li>1 cup <a>flour</a></li></ul><ol><li>Mix.</li></ol><p>Serves 4<br>Keeps a week</p>")).toBe(
      "## Cake\n- 2 eggs\n- 1 cup flour\n1. Mix.\nServes 4\nKeeps a week",
    );
  });

  test("finds each line's link texts, but not a heading's", () => {
    const page = readablePage(
      new DOMParser().parseFromString(
        '<body><h1><a href="/">Honey Cookies</a></h1><p>Source: <a href="/x">Soft Sugar Cookies</a></p><p><a href="/y">Apple Pie Cookies</a>Taste like pie. <a href="/z">More</a></p><p>Mix well.</p></body>',
        "text/html",
      ),
    );
    expect(page.text).toBe("# Honey Cookies\nSource: Soft Sugar Cookies\nApple Pie CookiesTaste like pie. More\nMix well.");
    expect(page.links).toEqual([[], ["Soft Sugar Cookies"], ["Apple Pie Cookies", "More"], []]);
  });

  test("marks a line that's all bold or underlined, but not one that only starts that way", () => {
    expect(text("<p><u>For the apples</u><br>6 apples</p><p><b>Do ahead:</b> Cover it.</p>")).toBe(
      "**For the apples**\n6 apples\nDo ahead: Cover it.",
    );
  });

  test("drops share buttons, hidden text, and headings left with nothing under them", () => {
    expect(
      text(
        '<article class="post tag-social-gatherings"><h5>Video</h5><p><iframe></iframe></p><h5>Notes</h5><p>Good cold.</p>' +
          '<div class="sharedaddy"><span>Share this:</span></div><ul><li class="share-email"><span hidden>Email a friend</span>Email</li></ul></article>',
      ),
    ).toBe("##### Notes\nGood cold.");
  });

  test("keeps each table row on one line", () => {
    expect(
      text(
        "<table><tr><td>&nbsp;</td><th><b>Jar</b></th><th><b>Time</b></th></tr>\n<tr>\n<td>Pints</td>\n<td>15 min</td>\n<td></td></tr></table>",
      ),
    ).toBe("**Jar | Time**\nPints | 15 min");
  });

  test("drops blog sidebars, but not the widget a post is in", () => {
    expect(
      text(
        '<div class="widget Blog"><div class="post"><h3>Zucchini Bread</h3><div class="post-body">3 eggs</div></div></div>' +
          '<div id="sidebar-right-1"><div class="widget Label"><h2>Categories</h2><ul><li><a>Aldi</a></li></ul></div></div>',
      ),
    ).toBe("### Zucchini Bread\n3 eggs");
  });

  test("reads ingredients typed in two columns down each column", () => {
    const gap = "&nbsp; &nbsp; &nbsp; &nbsp;";
    expect(
      text(
        `<h2>Casserole</h2><p>1 pound ground beef${gap}1 (10 ounce) can cream of</p><p>1 cup onion, chopped${gap}mushroom soup</p>` +
          `<p>1 (8 ounce) package${gap}1 cup milk</p><p>&nbsp; noodles, cooked and drained${gap}1/4 teaspoon pepper</p><p>1. Brown the beef.</p>`,
      ),
    ).toBe(
      "## Casserole\n1 pound ground beef\n1 cup onion, chopped\n1 (8 ounce) package noodles, cooked and drained\n" +
        "1 (10 ounce) can cream of mushroom soup\n1 cup milk\n1/4 teaspoon pepper\n1. Brown the beef.",
    );
  });

  test("keeps lines spaced out as labels and values, amounts and ingredients, or alone, as they are", () => {
    const gap = "&nbsp; &nbsp; &nbsp; &nbsp;";
    expect(text(`<p>Prep time:${gap}10 min</p><p>Cook time:${gap}20 min</p><p>Serves:${gap}4</p><p>Bake${gap}at 350.</p>`)).toBe(
      "Prep time: 10 min\nCook time: 20 min\nServes: 4\nBake at 350.",
    );
    expect(text(`<p>1${gap}cup sugar</p><p>1/2${gap}cup flour</p><p>3/4${gap}teaspoon cinnamon</p>`)).toBe(
      "1 cup sugar\n1/2 cup flour\n3/4 teaspoon cinnamon",
    );
  });

  test("breaks preformatted text at its newlines, but not where an email wrapped a line", () => {
    expect(
      text(
        "<pre>    Ingredients:\n\n*1 pound <b>butter</b> *\n*12 eggs *\n\nBeat butter and sugar until creamed, add lightly beaten egg yolks. Beat \nwell then add flour.</pre>",
      ),
    ).toBe(
      "Ingredients:\n*1 pound butter *\n*12 eggs *\nBeat butter and sugar until creamed, add lightly beaten egg yolks. Beat well then add flour.",
    );
  });
});

test("keeps how many a recipe serves, and nothing that only says what it makes", () => {
  expect(servingsFrom("Serves 6")).toBe("6");
  expect(servingsFrom("About 8 servings")).toBe("8");
  expect(servingsFrom("6 to 8")).toBe("6–8");
  expect(servingsFrom("None")).toBeNull();
  const yieldOf = (recipeYield: unknown) => draftFromSchema({ "@type": "Recipe", name: "Cake", recipeYield } as never, {} as never).servings;
  expect(yieldOf("4, more as a side")).toBe("4");
  expect(yieldOf("4 dozen cookies")).toBeNull();
  expect(yieldOf("Makes 16")).toBeNull();
});
