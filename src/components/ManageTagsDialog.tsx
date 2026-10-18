import { Check, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { Button, Dialog, IconButton, Input, useToast } from "./ui";

function TagRow({ name, count, onChanged }: { name: string; count: number; onChanged: () => void }) {
  const toast = useToast();
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
    <li className="flex h-12 items-center gap-3 border-b border-stone-200/70 last:border-0 dark:border-stone-800">
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
          <span className="flex-1 truncate text-[15px] font-medium">{name}</span>
          <span className="text-sm text-stone-500 tabular-nums">{count}</span>
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
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  tags: [string, number][];
  onChanged: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Tags">
      <p className="mb-3 text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Rename a tag to the name of another tag to combine them.
      </p>
      <ul>
        {tags.map(([name, count]) => (
          <TagRow key={name} name={name} count={count} onChanged={onChanged} />
        ))}
      </ul>
    </Dialog>
  );
}
