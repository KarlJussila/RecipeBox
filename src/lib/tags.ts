// Tags are grouped into a few categories so the sidebar stays browsable. The AI
// picks tags in the "auto" categories, only from the starter tags below and tags
// the cook has made; the rest are left to her.

export const TAG_CATEGORIES = [
  { name: "Dish", examples: "Main Course, Side Dish, Soup, Salad, Dessert, Breakfast, Appetizer, Bread, Drink, Sauce", auto: true },
  { name: "Ingredient", examples: "Poultry, Red Meat, Fish, Seafood, Pasta, Rice, Beans, Eggs, Chocolate", auto: true },
  { name: "Cuisine", examples: "Italian, Mexican, Thai, Indian, French", auto: true },
  { name: "Dietary", examples: "Vegetarian, Vegan, Gluten-Free, Dairy-Free", auto: true },
  { name: "Occasion", examples: "Thanksgiving, Christmas, Easter, Summer, Party", auto: false },
  { name: "Method", examples: "Slow Cooker, Grilling, Instant Pot, Air Fryer, No-Bake", auto: true },
] as const;

/**
 * The tags the AI may choose from, along with any the cook makes in its categories.
 * Each is created in the collection the first time a recipe uses it.
 */
export const SEED_TAGS: Tag[] = [
  ...[
    "Main Course", "Side Dish", "Soup", "Stew", "Salad", "Sandwich", "Casserole", "Breakfast", "Appetizer", "Snack",
    "Bread", "Sauce", "Drink", "Dessert", "Cake", "Cookies", "Pie",
  ].map((name) => ({ name, category: "Dish" })),
  ...[
    "Poultry", "Red Meat", "Fish", "Seafood", "Pasta", "Rice", "Beans", "Eggs", "Cheese", "Potatoes", "Vegetables",
    "Fruit", "Nuts", "Chocolate",
  ].map((name) => ({ name, category: "Ingredient" })),
  ...[
    "Italian", "Mexican", "French", "Greek", "Spanish", "Middle Eastern", "Indian", "Chinese", "Japanese", "Korean",
    "Thai", "Vietnamese",
  ].map((name) => ({ name, category: "Cuisine" })),
  ...["Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free"].map((name) => ({ name, category: "Dietary" })),
  ...["Slow Cooker", "Instant Pot", "Air Fryer", "Grilling", "No-Bake"].map((name) => ({ name, category: "Method" })),
];

/** Tags about timing or effort rather than the dish. The app filters by time instead. */
export const TIME_TAG = /^(quick|easy|fast|simple|make[- ]ahead|weeknight|weekday|\d+[- ]?(minute|min|hour)s?)\b/i;

export type TagCategory = (typeof TAG_CATEGORIES)[number]["name"];
export const CATEGORY_NAMES: TagCategory[] = TAG_CATEGORIES.map((c) => c.name);
export const AI_CATEGORIES = TAG_CATEGORIES.filter((c) => c.auto);
export const AI_CATEGORY_NAMES: string[] = AI_CATEGORIES.map((c) => c.name);
export const OTHER = "Other";

export interface Tag {
  name: string;
  category: string | null;
}

/** Groups tags by category in display order, with uncategorized tags last. */
export function groupTags<T extends { name: string }>(tags: T[], categoryOf: (t: T) => string | null): [string, T[]][] {
  const groups = new Map<string, T[]>([...CATEGORY_NAMES, OTHER].map((c) => [c, []]));
  for (const tag of tags) {
    const category = categoryOf(tag);
    groups.get(category && groups.has(category) ? category : OTHER)!.push(tag);
  }
  return [...groups.entries()].filter(([, list]) => list.length > 0);
}
