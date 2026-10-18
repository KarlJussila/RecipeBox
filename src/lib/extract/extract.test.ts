import { describe, expect, test } from "vitest";
import { parseDuration } from "./duration";
import { extractFromHtml } from "./page";
import { ingredientSections, instructionSections, pickImage } from "./schema";
import { cleanText } from "./text";

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
      yields: "4 servings",
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

  test("falls back to page metadata when there is no recipe data", () => {
    const html = '<head><meta property="og:title" content="A Blog Post"><meta property="og:image" content="/a.jpg"></head>';
    const { draft, complete } = extractFromHtml(html, "https://www.blog.com/post");
    expect(complete).toBe(false);
    expect(draft).toMatchObject({ title: "A Blog Post", imageUrl: "https://www.blog.com/a.jpg", sourceName: "blog.com" });
  });
});
