mod backup;
mod db;
mod fetch;
mod opencode;
mod server;
mod tools;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request};
use tauri::{Manager, State};

use db::{Db, Recipe, RecipeSummary};
use server::{ImportBridge, ImportRequest};

pub struct AppState {
    pub db: Mutex<Db>,
    pub imports: ImportBridge,
    pub jobs: tools::Jobs,
    data_dir: PathBuf,
    images_dir: PathBuf,
}

impl AppState {
    fn db_path(&self) -> PathBuf {
        self.data_dir.join("recipes.db")
    }

    fn remove_image(&self, name: Option<String>) {
        if let Some(name) = name {
            let _ = std::fs::remove_file(self.images_dir.join(name));
        }
    }
}

type Result<T> = std::result::Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: PathBuf,
    images_dir: PathBuf,
    extension_dir: Option<PathBuf>,
    extension_port: u16,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, state: State<AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.clone(),
        images_dir: state.images_dir.clone(),
        extension_dir: app.path().resolve("extension", tauri::path::BaseDirectory::Resource).ok(),
        extension_port: server::PORT,
    }
}

#[tauri::command]
fn list_recipes(state: State<AppState>) -> Result<Vec<RecipeSummary>> {
    state.db.lock().unwrap().list()
}

#[tauri::command]
fn get_recipe(state: State<AppState>, id: String) -> Result<Option<Recipe>> {
    state.db.lock().unwrap().get(&id)
}

#[tauri::command]
fn save_recipe(state: State<AppState>, mut recipe: Recipe) -> Result<Recipe> {
    let old_image = state.db.lock().unwrap().save(&mut recipe)?;
    state.remove_image(old_image);
    Ok(recipe)
}

#[tauri::command]
fn delete_recipe(state: State<AppState>, id: String) -> Result<()> {
    let image = state.db.lock().unwrap().delete(&id)?;
    state.remove_image(image);
    Ok(())
}

#[tauri::command]
fn set_favorite(state: State<AppState>, id: String, favorite: bool) -> Result<()> {
    state.db.lock().unwrap().set_favorite(&id, favorite)
}

#[tauri::command]
fn set_recipe_tags(
    state: State<AppState>,
    id: String,
    tags: Vec<String>,
    categories: Option<HashMap<String, String>>,
) -> Result<Vec<String>> {
    state.db.lock().unwrap().set_tags(&id, &tags, &categories.unwrap_or_default())
}

#[tauri::command]
fn create_tag(state: State<AppState>, name: String, category: Option<String>) -> Result<()> {
    state.db.lock().unwrap().create_tag(&name, category.as_deref())
}

#[tauri::command]
fn set_tag_category(state: State<AppState>, name: String, category: Option<String>) -> Result<()> {
    state.db.lock().unwrap().set_tag_category(&name, category.as_deref())
}

#[tauri::command]
fn search_recipes(state: State<AppState>, query: String) -> Result<Vec<String>> {
    state.db.lock().unwrap().search(&query)
}

#[tauri::command]
fn find_by_source_url(state: State<AppState>, url: String) -> Result<Option<String>> {
    state.db.lock().unwrap().find_by_source_url(&url)
}

#[tauri::command]
fn all_tags(state: State<AppState>) -> Result<Vec<db::Tag>> {
    state.db.lock().unwrap().all_tags()
}

#[tauri::command]
fn rename_tag(state: State<AppState>, from: String, to: String) -> Result<()> {
    state.db.lock().unwrap().rename_tag(&from, &to)
}

#[tauri::command]
fn delete_tag(state: State<AppState>, name: String) -> Result<()> {
    state.db.lock().unwrap().delete_tag(&name)
}

#[tauri::command]
async fn fetch_page(url: String) -> Result<fetch::Page> {
    fetch::fetch_page(&url).await
}

#[tauri::command]
async fn download_image(state: State<'_, AppState>, url: String, referer: Option<String>) -> Result<String> {
    fetch::download_image(&url, referer.as_deref(), &state.images_dir).await
}

/// Saves raw image bytes (from a paste or a dropped file) and returns the file name.
#[tauri::command]
fn save_image_bytes(state: State<AppState>, request: Request) -> Result<String> {
    match request.body() {
        InvokeBody::Raw(bytes) => fetch::save_image(bytes, &state.images_dir),
        InvokeBody::Json(_) => Err("Expected image bytes".into()),
    }
}

#[derive(Serialize)]
struct OpencodeStatus {
    path: Option<PathBuf>,
    version: Option<String>,
}

#[tauri::command]
async fn opencode_status() -> OpencodeStatus {
    let path = opencode::find_binary();
    let version = match &path {
        Some(p) => opencode::version(p).await,
        None => None,
    };
    OpencodeStatus { path, version }
}

/// Runs one AI job: opencode with the job's instructions and tools.
#[tauri::command]
async fn opencode_run(state: State<'_, AppState>, job: opencode::Job, tools: Vec<tools::ToolDef>) -> Result<String> {
    state.jobs.start(&job.id, tools.clone());
    let reply = opencode::run(&state.data_dir, &job, &tools).await;
    state.jobs.finish(&job.id);
    reply
}

#[tauri::command]
fn resolve_tool_call(state: State<'_, AppState>, call: String, result: tools::ToolResult) {
    state.jobs.resolve(&call, result);
}

/// App settings live in a small JSON file next to the database (not in backups,
/// since they hold the AI service key).
#[tauri::command]
fn get_settings(state: State<AppState>) -> Value {
    std::fs::read_to_string(state.data_dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| Value::Object(Default::default()))
}

#[tauri::command]
fn save_settings(state: State<AppState>, settings: Value) -> Result<()> {
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(state.data_dir.join("settings.json"), text).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_imports(state: State<AppState>) -> Vec<ImportRequest> {
    state.imports.take_pending()
}

#[tauri::command]
fn resolve_import(state: State<AppState>, id: String, result: Value) {
    state.imports.resolve(&id, result);
}

#[tauri::command]
async fn export_backup(state: State<'_, AppState>, dest: PathBuf) -> Result<()> {
    let db = state.db.lock().unwrap();
    backup::export(&db, &state.images_dir, &dest)
}

/// Replaces the whole library with the contents of a backup file.
/// The current library is kept in the backups folder first.
#[tauri::command]
async fn restore_backup(state: State<'_, AppState>, src: PathBuf) -> Result<()> {
    let staging = state.data_dir.join(format!("restore-{}", uuid::Uuid::new_v4()));
    let unpacked = backup::unpack(&src, &staging);
    let result = unpacked.and_then(|(db_path, images_dir)| {
        let mut db = state.db.lock().unwrap();
        let stamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
        db.backup_to(&state.data_dir.join("backups").join(format!("before-restore-{stamp}.db")))?;

        // Close the current database before swapping files underneath it.
        *db = Db::open(Path::new(":memory:"))?;
        let live = state.db_path();
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", live.display()));
        }
        std::fs::rename(&db_path, &live).map_err(|e| e.to_string())?;
        let old_images = state.data_dir.join(format!("images-old-{stamp}"));
        let _ = std::fs::rename(&state.images_dir, &old_images);
        std::fs::rename(&images_dir, &state.images_dir).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_dir_all(&old_images);
        *db = Db::open(&live)?;
        Ok(())
    });
    let _ = std::fs::remove_dir_all(&staging);
    result
}

/// Removes images that no recipe refers to, e.g. from an import that was abandoned.
fn remove_orphan_images(db: &Db, images_dir: &Path) {
    let Ok(used) = db.image_files() else { return };
    let Ok(entries) = std::fs::read_dir(images_dir) else { return };
    let day_ago = SystemTime::now() - Duration::from_secs(24 * 60 * 60);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let old = entry.metadata().and_then(|m| m.modified()).is_ok_and(|t| t < day_ago);
        if old && !used.contains(&name) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Serves recipe photos to the webview at recipeimg://localhost/<file name>.
/// File names are random and never reused, so they can be cached forever.
fn serve_image(app: &tauri::AppHandle, path: &str) -> tauri::http::Response<Vec<u8>> {
    let name = path.trim_start_matches('/');
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
        return not_found();
    }
    let Ok(bytes) = std::fs::read(app.state::<AppState>().images_dir.join(name)) else {
        return not_found();
    };
    let mime = match name.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        _ => "image/jpeg",
    };
    tauri::http::Response::builder()
        .header("Content-Type", mime)
        // WebKitGTK only loads custom-scheme images as CORS requests (see RecipeImage).
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .body(bytes)
        .unwrap()
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("recipeimg", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || responder.respond(serve_image(&app, &path)));
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let images_dir = data_dir.join("images");
            std::fs::create_dir_all(&images_dir)?;
            let db = Db::open(&data_dir.join("recipes.db"))?;
            if let Err(e) = backup::daily_snapshot(&db, &data_dir.join("backups")) {
                eprintln!("Daily backup failed: {e}");
            }
            remove_orphan_images(&db, &images_dir);
            app.manage(AppState { db: Mutex::new(db), imports: ImportBridge::default(), jobs: Default::default(), data_dir, images_dir });

            #[cfg(any(target_os = "linux", target_os = "windows"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            // The browser extension opens recipebox:// links to launch or raise the app.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |_| focus_main_window(&handle));
            }
            server::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_recipes,
            get_recipe,
            save_recipe,
            delete_recipe,
            set_favorite,
            set_recipe_tags,
            create_tag,
            set_tag_category,
            search_recipes,
            find_by_source_url,
            all_tags,
            rename_tag,
            delete_tag,
            fetch_page,
            download_image,
            save_image_bytes,
            opencode_status,
            opencode_run,
            resolve_tool_call,
            get_settings,
            save_settings,
            take_pending_imports,
            resolve_import,
            export_backup,
            restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Recipe Box");
}
