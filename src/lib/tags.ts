// Tags are grouped into a few categories so the sidebar stays browsable.

export const TAG_CATEGORIES = [
  { name: "Dish", hint: "the kind of dish or course", examples: "Main Course, Side Dish, Soup, Salad, Dessert, Breakfast, Appetizer, Bread, Drink, Sauce" },
  { name: "Ingredient", hint: "the main ingredient, as a broad group (Poultry not Chicken, Red Meat for beef, lamb or pork, Fish not Cod)", examples: "Poultry, Red Meat, Fish, Seafood, Pasta, Rice, Beans, Eggs, Chocolate" },
  { name: "Cuisine", hint: "a distinctive regional cuisine", examples: "Italian, Mexican, Thai, Indian, French" },
  { name: "Dietary", hint: "dietary fit", examples: "Vegetarian, Vegan, Gluten-Free, Dairy-Free" },
  { name: "Occasion", hint: "holidays, seasons and events", examples: "Thanksgiving, Christmas, Easter, Summer, Party" },
  { name: "Method", hint: "a notable appliance or technique", examples: "Slow Cooker, Grilling, Instant Pot, Air Fryer, No-Bake" },
] as const;

/**
 * Offered to the model as if already in the collection, so the common tags are
 * spelled one way from the very first recipe.
 */
export const SEED_TAGS: Tag[] = [
  ...["Main Course", "Side Dish", "Soup", "Salad", "Dessert", "Breakfast", "Appetizer", "Bread", "Sauce"].map((name) => ({ name, category: "Dish" })),
  ...["Poultry", "Red Meat", "Fish", "Seafood", "Pasta", "Rice", "Beans", "Eggs", "Chocolate"].map((name) => ({ name, category: "Ingredient" })),
  ...["Italian", "Mexican", "Indian", "French", "Chinese", "Thai"].map((name) => ({ name, category: "Cuisine" })),
  ...["Vegetarian", "Vegan", "Gluten-Free"].map((name) => ({ name, category: "Dietary" })),
];

/** Tags about timing or effort rather than the dish. The app filters by time instead. */
export const TIME_TAG = /^(quick|easy|fast|simple|make[- ]ahead|weeknight|weekday|\d+[- ]?(minute|min|hour)s?)\b/i;

export type TagCategory = (typeof TAG_CATEGORIES)[number]["name"];
export const CATEGORY_NAMES: TagCategory[] = TAG_CATEGORIES.map((c) => c.name);
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
