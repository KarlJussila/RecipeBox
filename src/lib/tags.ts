// Tags are grouped into a few categories so the sidebar stays browsable.

export const TAG_CATEGORIES = [
  { name: "Dish", hint: "the kind of dish or course", examples: "Main Course, Side Dish, Soup, Salad, Dessert, Breakfast, Appetizer, Bread, Drink, Sauce" },
  { name: "Ingredient", hint: "the main ingredient or protein", examples: "Chicken, Beef, Pork, Seafood, Pasta, Beans, Eggs, Chocolate" },
  { name: "Cuisine", hint: "a distinctive regional cuisine", examples: "Italian, Mexican, Thai, Indian, French" },
  { name: "Dietary", hint: "dietary fit", examples: "Vegetarian, Vegan, Gluten-Free, Dairy-Free" },
  { name: "Occasion", hint: "holidays, seasons and events", examples: "Thanksgiving, Christmas, Summer, Party, Weeknight" },
  { name: "Method", hint: "a notable appliance or technique", examples: "Slow Cooker, Grilling, Instant Pot, Make Ahead, One Pot" },
] as const;

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
