import { confirm, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Archive, Check, FolderOpen, Monitor, Moon, Palette, Puzzle, Sparkles, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, applyAppearance, loadAppInfo, type AppInfo, type Appearance, type LlmSettings, type Settings } from "../lib/api";
import { DEFAULT_OPENCODE_MODEL, effectiveLlm, llmConfigured, testConnection } from "../lib/llm";
import { Button, cx, Dialog, Field, Input, Spinner, useToast } from "./ui";

export type SettingsTab = "ai" | "extension" | "appearance" | "backup";

function TabButton({ active, icon, children, onClick }: { active: boolean; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[3px] px-3 text-[15px] whitespace-nowrap transition-colors",
        active ? "animate-settle bg-card font-semibold text-ink shadow-[0_1px_2px_rgb(60_40_20/0.18)]" : "text-ink-soft hover:text-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Choice({ active, title, description, onClick }: { active: boolean; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        "flex flex-1 flex-col gap-1 rounded px-4 py-3.5 text-left transition-colors",
        active ? "bg-leaf/8 ring-2 ring-leaf/75" : "ring-1 ring-umber/25 hover:bg-umber/5",
      )}
    >
      <span className="text-[15px] font-semibold text-ink">{title}</span>
      <span className="text-sm leading-snug text-ink-soft">{description}</span>
    </button>
  );
}

function OpencodeStatus() {
  const [status, setStatus] = useState<{ path: string | null; version: string | null } | null>(null);
  useEffect(() => {
    void api.opencodeStatus().then(setStatus);
  }, []);
  if (!status) return <Spinner />;
  if (status.path) {
    return (
      <p className="flex items-center gap-2 text-[15px] text-ink-soft">
        <span className="size-2 rounded-full bg-leaf" />
        Found opencode{status.version ? ` ${status.version}` : ""} at <code className="text-sm">{status.path}</code>
      </p>
    );
  }
  return (
    <div className="rounded bg-butter/50 px-4 py-3 text-[15px] leading-relaxed text-ink">
      opencode isn’t installed on this computer. Install it from{" "}
      <code className="text-sm">opencode.ai</code> (in Terminal: <code className="text-sm">curl -fsSL https://opencode.ai/install | bash</code>),
      then reopen Settings.
    </div>
  );
}

function AiTab({
  settings,
  onSave,
  onAutoTag,
}: {
  settings: Settings;
  onSave: (llm: LlmSettings) => Promise<void>;
  onAutoTag: (on: boolean) => Promise<void>;
}) {
  const [llm, setLlm] = useState<LlmSettings>(effectiveLlm(settings.llm));
  const [status, setStatus] = useState<{ state: "idle" | "testing" | "ok" | "error"; message?: string }>({ state: "idle" });
  const set = (patch: Partial<LlmSettings>) => {
    setLlm({ ...llm, ...patch });
    setStatus({ state: "idle" });
  };
  const switchProvider = (provider: LlmSettings["provider"]) =>
    set(provider === "opencode" ? { provider, model: DEFAULT_OPENCODE_MODEL } : { provider, model: "" });

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
      <p className="text-[15px] leading-relaxed text-ink-soft">
        An AI model sorts new recipes into tags and reads recipe pages that don’t include structured recipe details.
        Small, free models are plenty.
      </p>
      <div role="radiogroup" aria-label="AI service" className="flex gap-3">
        <Choice
          active={llm.provider === "opencode"}
          title="opencode"
          description="Uses the opencode app on this computer and its free models."
          onClick={() => switchProvider("opencode")}
        />
        <Choice
          active={llm.provider === "api"}
          title="Another service"
          description="Any OpenAI-compatible API, used through opencode."
          onClick={() => switchProvider("api")}
        />
      </div>

      <OpencodeStatus />
      {llm.provider === "opencode" ? (
        <>
          <Field label="Model" hint={`opencode’s name for the model. The default, ${DEFAULT_OPENCODE_MODEL}, is free.`}>
            <Input value={llm.model} onChange={(e) => set({ model: e.target.value })} spellCheck={false} />
          </Field>
        </>
      ) : (
        <>
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
        </>
      )}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={test} disabled={!llmConfigured(llm) || status.state === "testing"}>
          {status.state === "testing" ? "Checking…" : "Check and save"}
        </Button>
        {status.state === "testing" && <Spinner />}
        {status.state === "ok" && (
          <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-leaf">
            <Check className="size-4" /> Working and saved
          </span>
        )}
      </div>
      {status.state === "error" && <p className="text-[15px] leading-snug text-tomato">{status.message}</p>}

      <label className="flex cursor-pointer items-start gap-3 border-t border-line pt-5">
        <input
          type="checkbox"
          checked={settings.autoTag !== false}
          onChange={(e) => void onAutoTag(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-leaf"
        />
        <span className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold text-ink">Tag new recipes automatically</span>
          <span className="text-sm leading-snug text-ink-soft">
            Turn this off to save recipes now and tag them later. Recipes saved meanwhile get their tags once it’s back on.
          </span>
        </span>
      </label>
    </div>
  );
}

function ExtensionTab({ info }: { info: AppInfo }) {
  const steps: ReactNode[] = [
    <>
      In Chrome, open <code className="rounded-[3px] bg-umber/8 px-1.5 py-0.5 text-sm">chrome://extensions</code>{" "}
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
      <p className="text-[15px] leading-relaxed text-ink-soft">
        The Recipe Box button saves whatever recipe you’re looking at in Chrome, including recipes from sites you
        subscribe to. It only needs to be set up once.
      </p>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-leaf/12 font-serif text-sm font-semibold text-leaf-strong italic">
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
      <p className="text-sm text-ink-faint">
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
              "flex flex-col items-center gap-3 rounded px-4 py-5 text-[15px] font-semibold transition-colors",
              active ? "bg-leaf/8 text-leaf-strong ring-2 ring-leaf/75" : "text-ink-soft ring-1 ring-umber/25 hover:bg-umber/5",
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
      <p className="text-[15px] leading-relaxed text-ink-soft">
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
      <p className="text-sm text-ink-faint">Recipe Box {info.version}</p>
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

  const saveAutoTag = async (autoTag: boolean) => {
    const next = { ...settings, autoTag };
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
      <div role="tablist" className="mb-6 flex gap-1 rounded bg-umber/8 p-1">
        <TabButton active={tab === "ai"} icon={<Sparkles className="size-4" />} onClick={() => setTab("ai")}>
          AI service
        </TabButton>
        <TabButton active={tab === "extension"} icon={<Puzzle className="size-4" />} onClick={() => setTab("extension")}>
          Chrome button
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
          {tab === "ai" && <AiTab settings={settings} onSave={saveLlm} onAutoTag={saveAutoTag} />}
          {tab === "extension" && <ExtensionTab info={info} />}
          {tab === "appearance" && <AppearanceTab value={settings.appearance ?? "light"} onChange={saveAppearance} />}
          {tab === "backup" && <BackupTab info={info} onRestored={onRestored} />}
        </>
      )}
    </Dialog>
  );
}
