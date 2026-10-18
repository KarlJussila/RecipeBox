/** A titled group of ingredient lines or instruction steps. Heading may be empty. */
export interface Section {
  heading: string;
  items: string[];
}

export interface Recipe {
  id: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  sourceName: string | null;
  author: string | null;
  /** File name inside the app's images directory. */
  image: string | null;
  yields: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  ingredients: Section[];
  instructions: Section[];
  notes: string;
  keywords: string[];
  rating: number | null;
  favorite: boolean;
  tags: string[];
  /** True until the LLM has chosen tags for an imported recipe. */
  needsTags: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeSummary {
  id: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  sourceName: string | null;
  image: string | null;
  totalMinutes: number | null;
  rating: number | null;
  favorite: boolean;
  tags: string[];
  needsTags: boolean;
  createdAt: string;
}

/** What the extractor pulls out of a web page, before anything is saved. */
export interface RecipeDraft {
  title: string;
  description: string;
  sourceUrl: string | null;
  sourceName: string | null;
  author: string | null;
  imageUrl: string | null;
  yields: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  ingredients: Section[];
  instructions: Section[];
  notes: string;
  keywords: string[];
  /** schema.org recipeCategory / recipeCuisine values, used for automatic tags. */
  categories: string[];
  cuisines: string[];
}

export function emptyRecipe(): Recipe {
  return {
    id: "",
    title: "",
    description: "",
    sourceUrl: null,
    sourceName: null,
    author: null,
    image: null,
    yields: null,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    ingredients: [],
    instructions: [],
    notes: "",
    keywords: [],
    rating: null,
    favorite: false,
    tags: [],
    needsTags: false,
    createdAt: "",
    updatedAt: "",
  };
}
