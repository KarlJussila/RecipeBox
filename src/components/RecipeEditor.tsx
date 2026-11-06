import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { formatMinutes, parseDuration } from "../lib/extract/duration";
import { tidyTitle } from "../lib/extract/text";
import { clean } from "../lib/page-lines";
import { partsToRecipe } from "../lib/source-page";
import { emptyRecipe, type Recipe, type Section } from "../lib/types";
import { RecipeImage } from "./RecipeImage";
import { RecipePreview, SourcePageView, type LineChoice } from "./SourcePageView";
import { TagEditor } from "./TagEditor";
import { Button, Field, Input, Textarea, cx, useToast } from "./ui";

// In the editor, sections are plain text: one item per line, and a line ending in
// a colon starts a new section ("For the sauce:").
export function sectionsToText(sections: Section[]): string {
  return sections
    .map((s) => [s.heading && `${s.heading}:`, ...s.items].filter(Boolean).join("\n"))
    .join("\n\n");
}

export function textToSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: "", items: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith(":") && line.length <= 60) {
      if (current.items.length || current.heading) sections.push(current);
      current = { heading: line.slice(0, -1).trim(), items: [] };
    } else {
      current.items.push(line);
    }
  }
  sections.push(current);
  return sections.filter((s) => s.items.length > 0);
}

function minutesText(minutes: number | null): string {
  return minutes === null ? "" : formatMinutes(minutes);
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-6 border-t border-line py-8 first:border-t-0 first:pt-0 @3xl:grid-cols-[12rem_minmax(0,1fr)]">
      <h2 className="font-serif text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function PageHelp({ className }: { className?: string }) {
  return (
    <p className={cx("text-[15px] leading-relaxed text-ink-soft", className)}>
      These are the lines Recipe Box read the recipe from, each marked with the part it became. If something’s missing or
      in the wrong place, click the line and choose what it should be. Changes here redo the ingredients, steps, and
      notes from the page, so make them before typing changes of your own.
    </p>
  );
}

export function RecipeEditor({
  id,
  allTags,
  startOnPage = false,
  onCancel,
  onSaved,
}: {
  id: string | null;
  allTags: string[];
  /** Open on the page the recipe was read from, when it has one. */
  startOnPage?: boolean;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const [recipe, setRecipe] = useState<Recipe | null>(id ? null : emptyRecipe());
  const [ingredients, setIngredients] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tips, setTips] = useState("");
  const [times, setTimes] = useState({ prep: "", cook: "", total: "" });
  const [saving, setSaving] = useState(false);
  const [newCategories, setNewCategories] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"recipe" | "page">(startOnPage ? "page" : "recipe");
  /** The text of the line last made part of the recipe, to point out in the preview. */
  const [changed, setChanged] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    api.getRecipe(id).then((r) => {
      if (!r) return;
      setRecipe(r);
      setIngredients(sectionsToText(r.ingredients));
      setInstructions(sectionsToText(r.instructions));
      setTips(sectionsToText(r.tips));
      setTimes({ prep: minutesText(r.prepMinutes), cook: minutesText(r.cookMinutes), total: minutesText(r.totalMinutes) });
    });
  }, [id]);

  if (!recipe) return null;
  const set = (patch: Partial<Recipe>) => setRecipe({ ...recipe, ...patch });

  // A line of the page changed part: the recipe's parts are made again from the page's lines.
  const choose = (line: number, choice: LineChoice) => {
    const source = recipe.sourcePage!;
    if (choice === "title") {
      set({ title: tidyTitle(clean(source.lines[line])), sourcePage: { ...source, titleLine: line } });
      return;
    }
    const before = source.parts[line];
    if (before === choice) return;
    setChanged(choice ? clean(source.lines[line]) : null);
    const parts = [...source.parts];
    parts[line] = choice;
    const sourcePage = { ...source, parts };
    const rebuilt = partsToRecipe(sourcePage);
    const changed = [before, choice];
    if (changed.some((p) => p === "ingredient" || p === "step" || p === "tip")) {
      setIngredients(sectionsToText(rebuilt.ingredients));
      setInstructions(sectionsToText(rebuilt.instructions));
      setTips(sectionsToText(rebuilt.tips));
    }
    set({ sourcePage, ...(changed.includes("description") ? { description: rebuilt.description } : {}) });
  };

  const useImageBytes = async (bytes: ArrayBuffer) => {
    try {
      set({ image: await api.saveImageBytes(new Uint8Array(bytes)) });
    } catch (e) {
      toast({ message: String(e), tone: "error" });
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const prep = parseDuration(times.prep);
      const cook = parseDuration(times.cook);
      const saved = await api.saveRecipe({
        ...recipe,
        title: recipe.title.trim() || "Untitled recipe",
        ingredients: textToSections(ingredients),
        instructions: textToSections(instructions),
        tips: textToSections(tips),
        prepMinutes: prep,
        cookMinutes: cook,
        totalMinutes: parseDuration(times.total) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null),
        sourceUrl: recipe.sourceUrl?.trim() || null,
        yields: recipe.yields?.trim() || null,
      });
      for (const tag of saved.tags) {
        if (newCategories[tag]) await api.setTagCategory(tag, newCategories[tag]);
      }
      onSaved(saved.id);
    } catch (e) {
      toast({ message: `Couldn't save: ${e}`, tone: "error" });
      setSaving(false);
    }
  };

  return (
    <div
      className="paper-grain scrollbar-quiet @container h-full overflow-y-auto"
      onPaste={(e) => {
        const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
        if (file) {
          e.preventDefault();
          void file.arrayBuffer().then(useImageBytes);
        }
      }}
    >
      <header
        data-tauri-drag-region
        className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-6 backdrop-blur-md"
      >
        <h1 className="font-serif text-xl font-semibold tracking-tight" data-tauri-drag-region>
          {id ? "Edit recipe" : "New recipe"}
        </h1>
        <div className="flex-1" data-tauri-drag-region />
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save recipe"}
        </Button>
      </header>

      <form
        className={cx("mx-auto animate-fade-in px-10 pt-8 pb-24", tab === "page" ? "max-w-6xl" : "max-w-4xl")}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {recipe.sourcePage && (
          <div role="tablist" aria-label="Show" className="mb-8 inline-flex rounded-full bg-paper-deep p-1 ring-1 ring-line">
            {(
              [
                ["recipe", "Recipe"],
                ["page", "The page it came from"],
              ] as const
            ).map(([name, label]) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className={cx(
                  "h-9 rounded-full px-4 text-[15px] font-semibold transition-colors",
                  tab === name ? "bg-card text-ink shadow-soft" : "text-ink-soft hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === "page" && recipe.sourcePage ? (
          <>
            <div className="grid gap-10 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div>
                <PageHelp className="mb-6 @4xl:hidden" />
                <SourcePageView source={recipe.sourcePage} onChoose={choose} />
              </div>
              {/* The page opens at the recipe, well down it, so the help stays in view beside it. */}
              <aside className="hidden @4xl:block">
                <div className="sticky top-24 flex max-h-[calc(100vh-8rem)] flex-col gap-5">
                  <PageHelp />
                  <div className="scrollbar-quiet min-h-0 overflow-y-auto rounded-2xl">
                    <RecipePreview
                      title={recipe.title}
                      ingredients={textToSections(ingredients)}
                      steps={textToSections(instructions)}
                      tips={textToSections(tips)}
                      changed={changed}
                    />
                  </div>
                </div>
              </aside>
            </div>
          </>
        ) : (
          <>
            <FormSection title="Basics">
              <Field label="Title">
                <Input
                  value={recipe.title}
                  onChange={(e) => set({ title: e.target.value })}
                  autoFocus={!id}
                  placeholder="Grandma’s apple pie"
                  className="h-12 font-serif text-xl"
                />
              </Field>
              <Field label="Description">
                <Textarea value={recipe.description} onChange={(e) => set({ description: e.target.value })} rows={3} />
              </Field>
              <Field label="Photo" hint="Drop a picture here, paste one, or choose a file.">
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
                    if (file) void file.arrayBuffer().then(useImageBytes);
                  }}
                  className="flex items-center gap-5"
                >
                  <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[4/3] w-48 shrink-0 rounded-2xl shadow-soft ring-1 ring-black/5" />
                  <div className="flex flex-col gap-2">
                    <Button icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>
                      {recipe.image ? "Replace photo" : "Choose photo"}
                    </Button>
                    {recipe.image && (
                      <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => set({ image: null })}>
                        Remove photo
                      </Button>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void file.arrayBuffer().then(useImageBytes);
                      e.target.value = "";
                    }}
                  />
                </div>
              </Field>
              <Field label="Tags">
                <TagEditor tags={recipe.tags} allTags={allTags} onChange={(tags, categories) => {
                    set({ tags, needsTags: false });
                    if (categories) setNewCategories({ ...newCategories, ...categories });
                  }}
                />
              </Field>
            </FormSection>

            <FormSection title="Details">
              <div className="grid gap-5 @2xl:grid-cols-2">
                <Field label="Makes">
                  <Input value={recipe.yields ?? ""} onChange={(e) => set({ yields: e.target.value })} placeholder="4 servings" />
                </Field>
                <Field label="Prep time">
                  <Input value={times.prep} onChange={(e) => setTimes({ ...times, prep: e.target.value })} placeholder="15 min" />
                </Field>
                <Field label="Cook time">
                  <Input value={times.cook} onChange={(e) => setTimes({ ...times, cook: e.target.value })} placeholder="1 hr" />
                </Field>
                <Field label="Total time">
                  <Input
                    value={times.total}
                    onChange={(e) => setTimes({ ...times, total: e.target.value })}
                    placeholder="Prep + cook if left empty"
                  />
                </Field>
              </div>
              <Field label="Original recipe link">
                <Input
                  value={recipe.sourceUrl ?? ""}
                  onChange={(e) => set({ sourceUrl: e.target.value })}
                  placeholder="https://"
                  type="url"
                />
              </Field>
            </FormSection>

            <FormSection title="Ingredients">
              <Field label="One ingredient per line" hint="To group ingredients, put a heading on its own line ending in a colon, like “For the sauce:”.">
                <Textarea
                  value={ingredients}
                  onChange={(e) => setIngredients(e.target.value)}
                  rows={Math.max(8, ingredients.split("\n").length + 1)}
                  placeholder={"2 cups flour\n1 teaspoon salt\n…"}
                />
              </Field>
            </FormSection>

            <FormSection title="Steps">
              <Field label="One step per line" hint="Headings ending in a colon work here too.">
                <Textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={Math.max(8, instructions.split("\n").length + 2)}
                  placeholder={"Heat the oven to 350°F.\nWhisk the dry ingredients together.\n…"}
                />
              </Field>
            </FormSection>

            <FormSection title="Tips">
              <Field label="Notes and tips from the recipe" hint="Shown after the steps, without numbers. Group them under headings like “Do ahead:”.">
                <Textarea
                  value={tips}
                  onChange={(e) => setTips(e.target.value)}
                  rows={Math.max(4, tips.split("\n").length + 2)}
                  placeholder={"Do ahead:\nThe dough keeps in the fridge for 3 days."}
                />
              </Field>
            </FormSection>

            <FormSection title="Kitchen notes">
              <Textarea value={recipe.notes} onChange={(e) => set({ notes: e.target.value })} rows={4} placeholder="Your own notes" />
            </FormSection>
          </>
        )}
      </form>
    </div>
  );
}
