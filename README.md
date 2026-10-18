# Recipe Box

A desktop recipe collection that works offline. Recipes are saved from cooking
websites with one click, then searched, tagged, and read in a clean,
print-friendly layout.

- **Tauri 2** app (Rust backend, React + Tailwind frontend), so it's small and native on macOS and Linux.
- Recipes live in a local **SQLite** database with full-text search. Photos are downloaded, so everything works offline.
- A **Chrome extension** sends the page you're looking at to the app. Because it reads the page from your own logged-in browser, subscription sites like NYT Cooking work.
- An optional **AI service** (any OpenAI-compatible API) picks tags and reads pages that lack structured recipe data.

## How importing works

1. The extension (or a pasted link) hands the app a page's HTML.
2. The app looks for schema.org `Recipe` data (JSON-LD or microdata). Nearly every recipe site publishes it for Google, including NYT Cooking, Serious Eats, Bon Appétit, Allrecipes, and America's Test Kitchen, so there's no per-site scraping code to maintain.
3. If a page has no structured data and an AI service is configured, the page text goes to the model for extraction.
4. The recipe is saved right away, with its photo downloaded. Tagging happens next in the background. The model sees the existing tag list so tags stay consistent. If the service is unreachable, the recipe is tagged on a later retry.

Pasting a link only works for pages that are publicly readable and don't block automated requests. For subscription sites, and for sites like Food52 that block them, use the browser button.

### Sites checked so far

| Site | Recipe data | Notes |
|---|---|---|
| NYT Cooking | JSON-LD | Full recipe, even for paywalled pages |
| America's Test Kitchen | JSON-LD | Full recipe, even for paywalled pages |
| Food52 | JSON-LD | Blocks direct downloads, so use the browser button |
| Smitten Kitchen, 2020s posts | Microdata and h-recipe | Jetpack recipe block |
| Smitten Kitchen, older posts | None, recipe is prose | Needs the AI service |
| Serious Eats, Bon Appétit, Allrecipes | JSON-LD | |

## Installing on a Mac

1. Push a tag like `v0.1.0` (or run the **Release** workflow by hand). GitHub Actions builds the app and attaches `Recipe Box_x.y.z_aarch64.dmg` to a draft release.
2. Open the `.dmg` and drag **Recipe Box** to Applications.
3. The app isn't notarized (that needs a paid Apple developer account), so macOS refuses to open it the first time. Do one of these once:
   - Try to open it, dismiss the warning, then go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**. (On macOS 15 and later, right-click → Open no longer skips the warning.)
   - Or clear the quarantine flag in Terminal:
     ```sh
     xattr -dr com.apple.quarantine "/Applications/Recipe Box.app"
     ```

   Updates work the same way. Downloading the `.dmg` with `curl -LO <url>` in Terminal skips the quarantine flag entirely.
4. Set up the browser button: **Settings → Browser button** walks through it. In short: `chrome://extensions` → Developer mode → **Load unpacked** → choose the extension folder (**Show extension folder** opens it; it ships inside the app), then pin the button.
5. Optional: **Settings → AI service**. Pick a preset (OpenRouter, opencode Zen, or Ollama), paste a key, enter a model name, and click **Check and save**. A small, cheap model is enough. A local 8B model works but tags noticeably less accurately.

## Data and backups

Everything lives in the app data folder (**Settings → Backups → Open data folder**):

| | macOS | Linux |
|---|---|---|
| Data folder | `~/Library/Application Support/com.jussila.recipebox/` | `~/.local/share/com.jussila.recipebox/` |

- `recipes.db`: the SQLite database
- `images/`: recipe photos
- `backups/`: automatic daily database snapshots (the last 14 days)
- `settings.json`: AI service settings and appearance. Not included in backup files, since it holds the API key.

**Save a backup…** writes one `.zip` with the database and every photo. **Restore from a backup…** replaces the library and keeps a snapshot of the old one in `backups/`.

## Development

Prerequisites: Node.js, Rust, and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) (on Linux, `webkit2gtk-4.1`).

```sh
npm install
npm run tauri dev      # run the app with hot reload
npm test               # extractor tests (vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # database tests
npm run tauri build    # build an installer for this platform
```

Layout:

```
src/                  React frontend
  lib/extract/        schema.org recipe extraction (pure TS, unit tested)
  lib/importer.ts     page → saved recipe pipeline
  lib/llm.ts          OpenAI-compatible client, tagging and extraction prompts
  components/         UI
src-tauri/src/
  db.rs               SQLite schema, queries, full-text search
  server.rs           localhost server the extension talks to (127.0.0.1:47811)
  fetch.rs            page/image downloads, AI request proxy
  backup.rs           zip export/restore, daily snapshots
extension/            Chrome extension (Manifest V3, no build step)
```

The extension only accepts requests carrying an extension origin (or no origin at all, i.e. local tools like `curl`), so ordinary web pages can't push recipes into the app.
