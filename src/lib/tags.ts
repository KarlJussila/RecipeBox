// Tags are grouped into a few categories so the sidebar stays browsable. The AI
// picks tags in the "auto" categories, only from tags already in the collection
// (it starts with a set, see STARTER_TAGS in db.rs); the rest are left to the cook.

export const TAG_CATEGORIES = [
  { name: "Dish", examples: "Main Dish, Side Dish, Soup, Salad, Dessert, Breakfast, Bread, Drink, Sauce", auto: true },
  { name: "Ingredient", examples: "Poultry, Red Meat, Fish, Seafood, Pasta, Rice, Beans, Eggs, Chocolate", auto: true },
  { name: "Cuisine", examples: "Italian, Latin American, Thai, Indian, French", auto: true },
  { name: "Dietary", examples: "Vegetarian, Vegan, Gluten-Free, Dairy-Free", auto: true },
  { name: "Occasion", examples: "Thanksgiving, Christmas, Easter, Summer, Party", auto: false },
  { name: "Method", examples: "Slow Cooker, Grilling, Instant Pot, Air Fryer", auto: true },
] as const;

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
