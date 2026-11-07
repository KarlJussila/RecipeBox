import { Check, ImagePlus, Link2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { formatMinutes, parseDuration } from "../lib/extract/duration";
import { servingsFrom } from "../lib/extract/text";
import { emptyRecipe, type Recipe } from "../lib/types";
import { fromBuckets, RecipeBoard, toBuckets, type Buckets } from "./RecipeBoard";
import { RecipeImage } from "./RecipeImage";
import { TagEditor } from "./TagEditor";
import { Button, cx, GrowingTextarea, isMac, useToast } from "./ui";

// The editor is the recipe's own page, made editable where it sits: the title, the
// description, the details band, and the photo up top, then the recipe's lists.

function minutesText(minutes: number | null): string {
  return minutes === null ? "" : formatMinutes(minutes);
}

/** Text that looks like the page until it's pointed at or clicked into. */
const IN_PLACE =
  "bg-transparent transition-[background-color,box-shadow] duration-150 placeholder:text-ink-faint/70 hover:bg-ink/5 focus:bg-field focus:ring-2 focus:ring-leaf/45 focus:outline-none";

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
  const [scrolled, setScrolled] = useState(false);
  const [photoOver, setPhotoOver] = useState(false);
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
  const imageFrom = (files: FileList | File[]) => {
    const file = [...files].find((f) => f.type.startsWith("image/"));
    if (file) void file.arrayBuffer().then(useImageBytes);
    return Boolean(file);
  };

  const prep = parseDuration(times.prep);
  const cook = parseDuration(times.cook);
  /** What the total will be if it's left empty. */
  const sum = prep || cook ? (prep ?? 0) + (cook ?? 0) : null;

  const submit = async () => {
    setSaving(true);
    try {
      const saved = await api.saveRecipe({
        ...recipe,
        title: recipe.title.replace(/\s+/g, " ").trim() || "Untitled recipe",
        description: recipe.description.trim(),
        ...fromBuckets(buckets),
        prepMinutes: prep,
        cookMinutes: cook,
        totalMinutes: parseDuration(times.total) ?? sum,
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

  const details = [
    { label: "Prep", value: times.prep, placeholder: "—", onChange: (v: string) => setTimes({ ...times, prep: v }) },
    { label: "Cook", value: times.cook, placeholder: "—", onChange: (v: string) => setTimes({ ...times, cook: v }) },
    { label: "Total", value: times.total, placeholder: sum === null ? "—" : formatMinutes(sum), onChange: (v: string) => setTimes({ ...times, total: v }) },
    { label: "Serves", value: recipe.servings ?? "", placeholder: "—", onChange: (v: string) => set({ servings: v }) },
  ];

  return (
    <div
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
      onPaste={(e) => {
        if (imageFrom(e.clipboardData.files)) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          if (!saving) void submit();
        }
      }}
      className="scrollbar-quiet @container relative h-full overflow-y-auto"
    >
      <header
        data-tauri-drag-region
        className={cx(
          "sticky top-0 z-30 flex items-center gap-2 px-8 transition-colors duration-200",
          isMac ? "h-16 pt-2" : "h-16",
          scrolled && "paper-sheet border-b border-(--sheet-border) [--sheet-size:100cqw_100vh]",
        )}
      >
        <Button variant="ghost" icon={<X className="size-[18px]" />} onClick={onCancel} className="-ml-3">
          Cancel
        </Button>
        <p data-tauri-drag-region className="flex-1 text-center font-serif text-[17px] text-ink-faint italic">
          {id ? "Editing this recipe" : "A new recipe"}
        </p>
        <Button variant="primary" icon={<Check className="size-[18px]" />} onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </header>

      {/* The recipe's own card, written on where it sits. */}
      <div className="px-8 pt-2 pb-14">
        <article className="card-stock stock-aged mx-auto max-w-[68rem] animate-fade-in px-14 pt-12 pb-16 shadow-card">
          <section className="grid items-center gap-14 @4xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
            <div className="min-w-0">
              <GrowingTextarea
                value={recipe.title}
                onChange={(e) => set({ title: e.target.value.replace(/\n/g, " ") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                autoFocus={!id}
                placeholder="Name this recipe"
                aria-label="Title"
                className={cx(
                  IN_PLACE,
                  "-mx-3 w-[calc(100%+1.5rem)] rounded px-3 py-0 font-hand text-[42px] leading-[1.5] text-hand-ink",
                )}
              />
              <GrowingTextarea
                value={recipe.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="A few words about it"
                aria-label="Description"
                className={cx(IN_PLACE, "mt-4 -mx-3 w-[calc(100%+1.5rem)] rounded px-3 py-2 text-[17px] leading-relaxed text-ink-soft")}
              />

              {/* The details band from the recipe page, two by two as it is there. */}
              <div className="mt-8 grid grid-cols-2 gap-y-3 border-y border-umber/18 py-3">
                {details.map((d) => (
                  <label key={d.label} className="min-w-0 border-l border-umber/14 px-4 odd:border-l-0 odd:pl-0 odd:-ml-1.5">
                    <span className="printed-label block px-1.5 after:content-[':']">{d.label}</span>
                    <input
                      value={d.value}
                      onChange={(e) => d.onChange(e.target.value)}
                      placeholder={d.placeholder}
                      className={cx(IN_PLACE, "mt-0.5 w-full rounded-[3px] px-1.5 py-0.5 font-serif text-xl leading-tight font-semibold text-ink tabular-nums placeholder:font-normal")}
                    />
                  </label>
                ))}
              </div>

              <label className="mt-4 -mx-3 flex h-11 items-center gap-2.5 rounded px-3 text-[15px] text-ink-soft transition-[background-color,box-shadow] duration-150 focus-within:bg-field focus-within:ring-2 focus-within:ring-leaf/45 hover:bg-ink/5">
                <Link2 className="size-4 shrink-0 text-ink-faint" />
                <input
                  value={recipe.sourceUrl ?? ""}
                  onChange={(e) => set({ sourceUrl: e.target.value })}
                  placeholder="Link to the original recipe"
                  aria-label="Link to the original recipe"
                  className="min-w-0 flex-1 bg-transparent placeholder:text-ink-faint/80 focus:outline-none"
                />
              </label>

            </div>

            {/* The snapshot from the recipe page: click it for a new photo, or drop or paste one on it. */}
            <figure
              onDragOver={(e) => {
                e.preventDefault();
                setPhotoOver(true);
              }}
              onDragLeave={() => setPhotoOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setPhotoOver(false);
                imageFrom(e.dataTransfer.files);
              }}
              className={cx(
                "group relative mx-auto w-full max-w-md rounded-[3px] bg-photo p-3 pb-12 shadow-photo transition-[rotate,scale,box-shadow] duration-300 ease-paper @4xl:max-w-none",
                photoOver ? "scale-[1.02] rotate-0 ring-4 ring-leaf/60" : "rotate-[1.4deg]",
              )}
            >
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label={recipe.image ? "Choose a different photo" : "Add a photo"}
                className="relative block w-full overflow-hidden rounded-[2px]"
              >
                <RecipeImage file={recipe.image} title={recipe.title} className="aspect-[4/3] w-full" />
                <span
                  className={cx(
                    "absolute inset-0 flex items-center justify-center transition duration-200",
                    recipe.image ? "bg-black/0 opacity-0 group-hover:bg-black/25 group-hover:opacity-100" : "opacity-100",
                  )}
                >
                  <span className="inline-flex h-10 items-center gap-2 rounded bg-card/95 px-4 text-[15px] font-semibold text-ink shadow-soft">
                    <ImagePlus className="size-[18px] text-leaf" />
                    {recipe.image ? "Choose a different photo" : "Add a photo"}
                  </span>
                </span>
              </button>
              <figcaption className="absolute inset-x-3 bottom-0 flex h-12 items-center justify-center font-serif text-[16px] text-[#6b5a4c] italic">
                {photoOver ? "Let go to use this photo" : "or drop one here"}
              </figcaption>
              {recipe.image && (
                <button
                  type="button"
                  onClick={() => set({ image: null })}
                  aria-label="Remove the photo"
                  title="Remove the photo"
                  className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full text-[#6b5a4c] opacity-0 transition group-hover:opacity-100 hover:bg-black/5 hover:text-tomato focus-visible:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  if (e.target.files) imageFrom(e.target.files);
                  e.target.value = "";
                }}
              />
            </figure>
          </section>

          <TagEditor
            tags={recipe.tags}
            allTags={allTags}
            onChange={(tags, categories) => {
              set({ tags, needsTags: false });
              if (categories) setNewCategories({ ...newCategories, ...categories });
            }}
          />

          <RecipeBoard buckets={buckets} onChange={setBuckets} onToDescription={toDescription} />

          {/* The cook's own notes, on the same slip as the recipe page. */}
          <section className="mx-auto mt-20 max-w-2xl -rotate-[0.6deg] rounded-[1px] bg-slip px-8 pt-6 pb-7 shadow-photo transition-[rotate,translate] duration-300 ease-paper focus-within:-translate-y-0.5 focus-within:rotate-0">
            <h2 className="font-hand text-[17px] text-hand-ink">Kitchen notes</h2>
            <GrowingTextarea
              value={recipe.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="What you changed, what you’d do next time, who loved it…"
              aria-label="Kitchen notes"
              className="mt-2 min-h-[5.5rem] w-full bg-transparent font-hand text-[18px] leading-[1.9] text-hand-ink placeholder:text-hand-ink/40 focus:outline-none"
            />
          </section>
        </article>
      </div>
    </div>
  );
}
