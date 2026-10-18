import { confirm, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Archive, Check, FolderOpen, Monitor, Moon, Palette, Puzzle, Sparkles, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, applyAppearance, loadAppInfo, type AppInfo, type Appearance, type LlmSettings, type Settings } from "../lib/api";
import { testConnection } from "../lib/llm";
import { Button, cx, Dialog, Field, Input, Spinner, useToast } from "./ui";

export type SettingsTab = "ai" | "extension" | "appearance" | "backup";

const PRESETS: { name: string; baseUrl: string; note: string }[] = [
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", note: "One key for models from many companies." },
  { name: "opencode Zen", baseUrl: "https://opencode.ai/zen/v1", note: "Uses an opencode Zen API key." },
  { name: "Ollama", baseUrl: "http://localhost:11434/v1", note: "Runs models on this computer. No key needed." },
];

function TabButton({ active, icon, children, onClick }: { active: boolean; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[15px] transition-colors",
        active
          ? "bg-white font-semibold text-leaf-800 shadow-card ring-1 ring-stone-200 dark:bg-stone-800 dark:text-leaf-200 dark:ring-stone-700"
          : "text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function AiTab({ settings, onSave }: { settings: Settings; onSave: (llm: LlmSettings) => Promise<void> }) {
  const [llm, setLlm] = useState<LlmSettings>(settings.llm ?? { baseUrl: "", apiKey: "", model: "" });
  const [status, setStatus] = useState<{ state: "idle" | "testing" | "ok" | "error"; message?: string }>({ state: "idle" });
  const set = (patch: Partial<LlmSettings>) => {
    setLlm({ ...llm, ...patch });
    setStatus({ state: "idle" });
  };

  const test = async () => {
    setStatus({ state: "testing" });
    try {
      await testConnection(llm);
      setStatus({ state: "ok" });
      await onSave(llm);
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        An AI service picks tags for new recipes and reads recipe pages that don’t include structured recipe
        details. Any service with an OpenAI-compatible API works. Small, inexpensive models are plenty.
      </p>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300">Quick setup</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.name}
              size="sm"
              variant={llm.baseUrl === p.baseUrl ? "primary" : "secondary"}
              title={p.note}
              onClick={() => set({ baseUrl: p.baseUrl })}
            >
              {p.name}
            </Button>
          ))}
        </div>
      </div>
      <Field label="API address">
        <Input value={llm.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://…/v1" spellCheck={false} />
      </Field>
      <Field label="API key">
        <Input
          type="password"
          value={llm.apiKey}
          onChange={(e) => set({ apiKey: e.target.value })}
          placeholder="Leave empty if the service doesn’t need one"
          spellCheck={false}
        />
      </Field>
      <Field label="Model" hint="The model name exactly as the service lists it.">
        <Input value={llm.model} onChange={(e) => set({ model: e.target.value })} spellCheck={false} />
      </Field>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={test} disabled={!llm.baseUrl.trim() || !llm.model.trim() || status.state === "testing"}>
          {status.state === "testing" ? "Checking…" : "Check and save"}
        </Button>
        {status.state === "testing" && <Spinner />}
        {status.state === "ok" && (
          <span className="inline-flex items-center gap-1.5 text-[15px] font-medium text-leaf-700 dark:text-leaf-400">
            <Check className="size-4" /> Working and saved
          </span>
        )}
        {status.state === "idle" && settings.llm && llm === settings.llm && (
          <span className="text-sm text-stone-500">Saved</span>
        )}
      </div>
      {status.state === "error" && <p className="text-[15px] leading-snug text-red-700 dark:text-red-400">{status.message}</p>}
    </div>
  );
}

function ExtensionTab({ info }: { info: AppInfo }) {
  const steps: ReactNode[] = [
    <>
      In Chrome, open <code className="rounded bg-stone-200/70 px-1.5 py-0.5 text-sm dark:bg-stone-800">chrome://extensions</code>{" "}
      (type it into the address bar).
    </>,
    <>Turn on <strong>Developer mode</strong> in the top-right corner.</>,
    <>
      Click <strong>Load unpacked</strong> and choose the Recipe Box extension folder.
    </>,
    <>Click the puzzle-piece icon in Chrome’s toolbar and pin <strong>Recipe Box</strong> so its button is always visible.</>,
  ];
  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        The Recipe Box button saves whatever recipe you’re looking at in Chrome, including recipes from sites you
        subscribe to. It only needs to be set up once.
      </p>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-sm font-semibold text-leaf-800 dark:bg-leaf-900/60 dark:text-leaf-200">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {info.extensionDir && (
        <div className="flex gap-2">
          <Button icon={<FolderOpen className="size-4" />} onClick={() => revealItemInDir(info.extensionDir!)}>
            Show extension folder
          </Button>
          <Button variant="ghost" onClick={() => navigator.clipboard.writeText(info.extensionDir!)}>
            Copy folder location
          </Button>
        </div>
      )}
      <p className="text-sm text-stone-500 dark:text-stone-400">
        Works in Chrome, Edge, Brave, and Arc. Recipe Box needs to be open to receive recipes; the button opens it if needed.
      </p>
    </div>
  );
}

const APPEARANCES: { value: Appearance; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="size-6" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-6" /> },
  { value: "system", label: "Match computer", icon: <Monitor className="size-6" /> },
];

function AppearanceTab({ value, onChange }: { value: Appearance; onChange: (a: Appearance) => void }) {
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-3">
      {APPEARANCES.map((a) => {
        const active = a.value === value;
        return (
          <button
            key={a.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(a.value)}
            className={cx(
              "flex flex-col items-center gap-3 rounded-xl px-4 py-5 text-[15px] font-medium ring-1 transition-colors",
              active
                ? "bg-leaf-50 text-leaf-900 ring-2 ring-leaf-600 dark:bg-leaf-950/60 dark:text-leaf-100 dark:ring-leaf-500"
                : "bg-white text-stone-700 ring-stone-200 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700 dark:hover:bg-stone-700",
            )}
          >
            {a.icon}
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

function BackupTab({ info, onRestored }: { info: AppInfo; onRestored: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const exportBackup = async () => {
    const date = new Date().toISOString().slice(0, 10);
    const dest = await saveDialog({ defaultPath: `Recipe Box Backup ${date}.zip`, filters: [{ name: "Recipe Box backup", extensions: ["zip"] }] });
    if (!dest) return;
    setBusy(true);
    try {
      await api.exportBackup(dest);
      toast({ message: "Backup saved", tone: "success", action: { label: "Show", run: () => revealItemInDir(dest) } });
    } catch (e) {
      toast({ message: `Backup failed: ${e}`, tone: "error" });
    }
    setBusy(false);
  };

  const restore = async () => {
    const src = await openDialog({ filters: [{ name: "Recipe Box backup", extensions: ["zip"] }] });
    if (!src || typeof src !== "string") return;
    const ok = await confirm(
      "Everything in your recipe box will be replaced with this backup. Your current recipes are kept in the backups folder first.",
      { title: "Restore this backup?", kind: "warning", okLabel: "Restore" },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.restoreBackup(src);
      toast({ message: "Backup restored", tone: "success" });
      onRestored();
    } catch (e) {
      toast({ message: `Restore failed: ${e}`, tone: "error" });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-stone-600 dark:text-stone-400">
        Recipe Box quietly keeps a copy of your recipes every day (the last two weeks). A backup file holds
        everything, including photos, so you can keep it somewhere safe or move it to another computer.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={exportBackup} disabled={busy}>
          Save a backup…
        </Button>
        <Button onClick={restore} disabled={busy}>
          Restore from a backup…
        </Button>
        <Button variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => openPath(info.dataDir)}>
          Open data folder
        </Button>
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400">Recipe Box {info.version}</p>
    </div>
  );
}

export function SettingsDialog({
  open,
  initialTab,
  onClose,
  onSettingsSaved,
  onRestored,
}: {
  open: boolean;
  initialTab: SettingsTab;
  onClose: () => void;
  onSettingsSaved: (settings: Settings) => void;
  onRestored: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    void api.getSettings().then(setSettings);
    void loadAppInfo().then(setInfo);
  }, [open, initialTab]);

  const saveLlm = async (llm: LlmSettings) => {
    const next = { ...settings, llm };
    await api.saveSettings(next);
    setSettings(next);
    onSettingsSaved(next);
  };

  const saveAppearance = async (appearance: Appearance) => {
    applyAppearance(appearance);
    const next = { ...settings, appearance };
    await api.saveSettings(next);
    setSettings(next);
    onSettingsSaved(next);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Settings" width="max-w-2xl">
      <div role="tablist" className="mb-6 flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-950">
        <TabButton active={tab === "ai"} icon={<Sparkles className="size-4" />} onClick={() => setTab("ai")}>
          AI service
        </TabButton>
        <TabButton active={tab === "extension"} icon={<Puzzle className="size-4" />} onClick={() => setTab("extension")}>
          Browser button
        </TabButton>
        <TabButton active={tab === "appearance"} icon={<Palette className="size-4" />} onClick={() => setTab("appearance")}>
          Appearance
        </TabButton>
        <TabButton active={tab === "backup"} icon={<Archive className="size-4" />} onClick={() => setTab("backup")}>
          Backups
        </TabButton>
      </div>
      {settings && info && (
        <>
          {tab === "ai" && <AiTab settings={settings} onSave={saveLlm} />}
          {tab === "extension" && <ExtensionTab info={info} />}
          {tab === "appearance" && <AppearanceTab value={settings.appearance ?? "light"} onChange={saveAppearance} />}
          {tab === "backup" && <BackupTab info={info} onRestored={onRestored} />}
        </>
      )}
    </Dialog>
  );
}
