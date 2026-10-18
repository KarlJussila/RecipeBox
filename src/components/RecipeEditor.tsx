import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { formatMinutes, parseDuration } from "../lib/extract/duration";
import { emptyRecipe, type Recipe, type Section } from "../lib/types";
import { RecipeImage } from "./RecipeImage";
import { TagEditor } from "./TagEditor";
import { Button, Field, Input, Textarea, useToast } from "./ui";

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
    <section className="grid gap-6 border-t border-stone-200 py-8 first:border-t-0 first:pt-0 @3xl:grid-cols-[12rem_minmax(0,1fr)] dark:border-stone-800">
      <h2 className="font-serif text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function RecipeEditor({
  id,
  allTags,
  onCancel,
  onSaved,
}: {
  id: string | null;
  allTags: string[];
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const [recipe, setRecipe] = useState<Recipe | null>(id ? null : emptyRecipe());
  const [ingredients, setIngredients] = useState("");
  const [instructions, setInstructions] = useState("");
  const [times, setTimes] = useState({ prep: "", cook: "", total: "" });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    api.getRecipe(id).then((r) => {
      if (!r) return;
      setRecipe(r);
      setIngredients(sectionsToText(r.ingredients));
      setInstructions(sectionsToText(r.instructions));
      setTimes({ prep: minutesText(r.prepMinutes), cook: minutesText(r.cookMinutes), total: minutesText(r.totalMinutes) });
    });
  }, [id]);

  if (!recipe) return null;
  const set = (patch: Partial<Recipe>) => setRecipe({ ...recipe, ...patch });

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
        prepMinutes: prep,
        cookMinutes: cook,
        totalMinutes: parseDuration(times.total) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null),
        sourceUrl: recipe.sourceUrl?.trim() || null,
        yields: recipe.yields?.trim() || null,
      });
      onSaved(saved.id);
    } catch (e) {
      toast({ message: `Couldn't save: ${e}`, tone: "error" });
      setSaving(false);
    }
  };

  return (
    <div
      className="scrollbar-quiet @container h-full overflow-y-auto"
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
        className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-stone-200/70 bg-stone-50/85 px-6 backdrop-blur-md dark:border-stone-800 dark:bg-stone-950/85"
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
        className="mx-auto max-w-4xl animate-fade-in px-10 pt-8 pb-24"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
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
              <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[4/3] w-48 shrink-0 rounded-xl ring-1 ring-stone-200 dark:ring-stone-800" />
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
            <TagEditor tags={recipe.tags} allTags={allTags} onChange={(tags) => set({ tags, needsTags: false })} />
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

        <FormSection title="Notes">
          <Textarea value={recipe.notes} onChange={(e) => set({ notes: e.target.value })} rows={4} placeholder="Your own notes" />
        </FormSection>
      </form>
    </div>
  );
}
