import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { formatMinutes, parseDuration } from "../lib/extract/duration";
import { servingsFrom } from "../lib/extract/text";
import { emptyRecipe, type Recipe } from "../lib/types";
import { fromBuckets, RecipeBoard, toBuckets, type Buckets } from "./RecipeBoard";
import { RecipeImage } from "./RecipeImage";
import { TagEditor } from "./TagEditor";
import { Button, Field, Input, Textarea, cx, useToast } from "./ui";

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
  const [buckets, setBuckets] = useState<Buckets>(() => toBuckets(emptyRecipe()));
  const [times, setTimes] = useState({ prep: "", cook: "", total: "" });
  const [saving, setSaving] = useState(false);
  const [newCategories, setNewCategories] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    api.getRecipe(id).then((r) => {
      if (!r) return;
      setRecipe(r);
      setBuckets(toBuckets(r));
      setTimes({ prep: minutesText(r.prepMinutes), cook: minutesText(r.cookMinutes), total: minutesText(r.totalMinutes) });
    });
  }, [id]);

  if (!recipe) return null;
  const set = (patch: Partial<Recipe>) => setRecipe({ ...recipe, ...patch });

  const toDescription = (text: string) =>
    setRecipe((r) => r && { ...r, description: r.description.trim() ? `${r.description.trim()}\n\n${text}` : text });

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
        ...fromBuckets(buckets),
        prepMinutes: prep,
        cookMinutes: cook,
        totalMinutes: parseDuration(times.total) ?? (prep || cook ? (prep ?? 0) + (cook ?? 0) : null),
        sourceUrl: recipe.sourceUrl?.trim() || null,
        servings: servingsFrom(recipe.servings),
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
        className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-paper/90 px-6 backdrop-blur-md"
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
        className={cx("mx-auto w-full animate-fade-in px-10 pt-8 pb-24", buckets.unused.length > 0 ? "max-w-6xl" : "max-w-4xl")}
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
            <Field label="Serves">
              <Input value={recipe.servings ?? ""} onChange={(e) => set({ servings: e.target.value })} placeholder="4" />
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

        <section className="border-t border-line py-8">
          <h2 className="mb-6 font-serif text-xl font-semibold tracking-tight">Recipe</h2>
          <RecipeBoard buckets={buckets} onChange={setBuckets} onToDescription={toDescription} />
        </section>

        <FormSection title="Kitchen notes">
          <Textarea value={recipe.notes} onChange={(e) => set({ notes: e.target.value })} rows={4} placeholder="Your own notes" />
        </FormSection>
      </form>
    </div>
  );
}
