import { Check, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { headlineCase } from "../lib/extract/text";
import { CATEGORY_NAMES, groupTags, OTHER, type Tag } from "../lib/tags";
import { Button, cx, Dialog, Eyebrow, IconButton, Input, useToast } from "./ui";

function CategorySelect({ value, onChange, label, className }: { value: string; onChange: (category: string) => void; label: string; className?: string }) {
  return (
    <label className={cx("relative", className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full appearance-none rounded bg-field pr-8 pl-3.5 text-sm text-ink-soft ring-1 ring-line hover:bg-umber/5 focus:ring-2 focus:ring-leaf focus:outline-none"
      >
        {CATEGORY_NAMES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value="">{OTHER}</option>
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
    </label>
  );
}

function NewTagForm({ tags, onChanged }: { tags: Tag[]; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const newName = headlineCase(name.trim().replace(/\s+/g, " "));
  const exists = tags.some((t) => t.name.toLowerCase() === newName.toLowerCase());
  return (
    <form
      className="mb-6 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!newName || exists) return;
        await api.createTag(newName, category || null);
        toast({ message: `Added the “${newName}” tag`, tone: "success" });
        setName("");
        onChanged();
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag, like Thanksgiving" aria-label="New tag name" className="flex-1" />
      <CategorySelect value={category} onChange={setCategory} label="Category for the new tag" className="h-11 w-36 shrink-0" />
      <Button type="submit" variant="primary" icon={<Plus className="size-4" />} className="h-11" disabled={!name.trim() || exists} title={exists ? "There's already a tag with this name" : undefined}>
        Add
      </Button>
    </form>
  );
}

function TagRow({ tag, count, onChanged }: { tag: Tag; count: number; onChanged: () => void }) {
  const toast = useToast();
  const { name } = tag;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const [confirming, setConfirming] = useState(false);

  const rename = async () => {
    setEditing(false);
    if (text.trim() && text.trim() !== name) {
      await api.renameTag(name, text.trim());
      onChanged();
    }
  };

  return (
    <li className="flex h-12 items-center gap-2 border-b border-line last:border-0">
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus onBlur={rename} className="h-9" />
          <IconButton label="Save" type="submit">
            <Check className="size-4" />
          </IconButton>
        </form>
      ) : confirming ? (
        <>
          <span className="flex-1 text-[15px]">
            Remove “{name}” from {count} {count === 1 ? "recipe" : "recipes"}?
          </span>
          <Button size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              await api.deleteTag(name);
              toast({ message: `Removed the “${name}” tag`, tone: "success" });
              onChanged();
            }}
          >
            Remove
          </Button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{name}</span>
          <span className="w-8 text-right text-sm text-ink-faint tabular-nums">{count}</span>
          <CategorySelect
            value={tag.category ?? ""}
            onChange={async (category) => {
              await api.setTagCategory(name, category || null);
              onChanged();
            }}
            label={`Category for ${name}`}
            className="h-8 w-32 shrink-0"
          />
          <IconButton label={`Rename ${name}`} onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton label={`Delete ${name}`} onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" />
          </IconButton>
        </>
      )}
    </li>
  );
}

export function ManageTagsDialog({
  open,
  onClose,
  tags,
  counts,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  tags: Tag[];
  counts: [string, number][];
  onChanged: () => void;
}) {
  const countOf = new Map(counts);
  const groups = groupTags(tags, (t) => t.category);
  return (
    <Dialog open={open} onClose={onClose} title="Organize tags" width="max-w-xl">
      <p className="mb-4 text-[15px] leading-relaxed text-ink-soft">
        Add your own tags, move a tag to another group, or rename it to the name of another tag to combine them.
      </p>
      <NewTagForm tags={tags} onChanged={onChanged} />
      <div className="space-y-6">
        {groups.map(([category, list]) => (
          <section key={category}>
            <Eyebrow className="mb-1">{category}</Eyebrow>
            <ul>
              {list.map((tag) => (
                <TagRow key={tag.name} tag={tag} count={countOf.get(tag.name) ?? 0} onChanged={onChanged} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
