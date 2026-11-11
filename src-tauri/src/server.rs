//! A tiny HTTP server on localhost that the browser extension talks to.
//!
//! The extension sends the HTML of the page the user is looking at (with their
//! logged-in session, so paywalled recipes come through). The frontend does the
//! actual recipe extraction and answers through `resolve_import`.
//!
//! It also runs the AI's tool calls from Recipe Box's opencode plugin at /tool (see tools.rs).

use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::AppState;

pub const PORT: u16 = 47811;
const MAX_BODY_BYTES: usize = 30 * 1024 * 1024;
const IMPORT_TIMEOUT: Duration = Duration::from_secs(660);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    #[serde(default)]
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub html: String,
    /// Set when the page is one of many sent together, like a whole saved-recipes list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batch: Option<Batch>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Batch {
    pub index: usize,
    pub total: usize,
}

#[derive(Default)]
pub struct ImportBridge {
    queue: Mutex<Vec<ImportRequest>>,
    waiting: Mutex<HashMap<String, mpsc::Sender<Value>>>,
}

impl ImportBridge {
    pub fn take_pending(&self) -> Vec<ImportRequest> {
        std::mem::take(&mut *self.queue.lock().unwrap())
    }

    pub fn resolve(&self, id: &str, result: Value) {
        if let Some(tx) = self.waiting.lock().unwrap().remove(id) {
            let _ = tx.send(result);
        }
    }
}

#[derive(Deserialize)]
struct KnownBody {
    urls: Vec<String>,
}

#[derive(Deserialize)]
struct TagsBody {
    id: String,
    tags: Vec<String>,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let server = match Server::http(("127.0.0.1", PORT)) {
            Ok(server) => server,
            Err(e) => {
                eprintln!("Extension server couldn't start on port {PORT}: {e}");
                return;
            }
        };
        for request in server.incoming_requests() {
            let app = app.clone();
            std::thread::spawn(move || handle(app, request));
        }
    });
}

fn handle(app: AppHandle, mut request: Request) {
    if !from_extension(&request) {
        let _ = request.respond(Response::empty(403));
        return;
    }
    let result = match (request.method(), request.url()) {
        (Method::Get, "/ping") => Ok(json!({ "app": "Recipe Box", "version": app.package_info().version.to_string() })),
        (Method::Get, "/tags") => app.state::<AppState>().db.lock().unwrap().all_tags().map(|t| json!(t)),
        (Method::Post, "/known") => read_json::<KnownBody>(&mut request).and_then(|body| {
            let state = app.state::<AppState>();
            let db = state.db.lock().unwrap();
            let mut known = Vec::new();
            for url in body.urls {
                if db.find_by_source_url(&url)?.is_some() {
                    known.push(url);
                }
            }
            Ok(json!(known))
        }),
        (Method::Post, "/import") => read_json::<ImportRequest>(&mut request).map(|body| import(&app, body)),
        (Method::Post, "/tool") => {
            let token = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .and_then(|h| h.value.as_str().strip_prefix("Bearer "))
                .map(str::to_string);
            read_json::<crate::tools::CallRequest>(&mut request)
                .and_then(|body| crate::tools::call(&app, token.as_deref(), body))
                .map(|text| json!({ "text": text }))
        }
        (Method::Post, "/recipe-tags") => read_json::<TagsBody>(&mut request).and_then(|body| {
            let tags = app.state::<AppState>().db.lock().unwrap().set_tags(&body.id, &body.tags, &Default::default())?;
            let _ = app.emit("library-changed", &body.id);
            Ok(json!(tags))
        }),
        _ => {
            let _ = request.respond(Response::empty(404));
            return;
        }
    };
    let (status, body) = match result {
        Ok(value) => (200, value),
        Err(message) => (400, json!({ "status": "error", "message": message })),
    };
    let header = Header::from_bytes("Content-Type", "application/json").unwrap();
    let _ = request.respond(Response::from_string(body.to_string()).with_status_code(status).with_header(header));
}

/// Web pages can send requests to localhost too, but browsers always attach their
/// origin. Only accept requests from extensions or from non-browser clients.
fn from_extension(request: &Request) -> bool {
    let origin = request.headers().iter().find(|h| h.field.equiv("Origin"));
    match origin {
        None => true,
        Some(h) => {
            let origin = h.value.as_str();
            ["chrome-extension://", "moz-extension://", "safari-web-extension://"]
                .iter()
                .any(|prefix| origin.starts_with(prefix))
        }
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let mut body = Vec::new();
    request
        .as_reader()
        .take(MAX_BODY_BYTES as u64 + 1)
        .read_to_end(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() > MAX_BODY_BYTES {
        return Err("Page is too large".into());
    }
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}

fn import(app: &AppHandle, mut body: ImportRequest) -> Value {
    let bridge = &app.state::<AppState>().imports;
    body.id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel();
    bridge.waiting.lock().unwrap().insert(body.id.clone(), tx);
    bridge.queue.lock().unwrap().push(body.clone());

    // A batch would raise the window hundreds of times; its first page does it once.
    let raise = body.batch.as_ref().is_none_or(|b| b.index == 0);
    if let Some(window) = app.get_webview_window("main").filter(|_| raise) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("import-requested", ());

    let result = rx.recv_timeout(IMPORT_TIMEOUT);
    bridge.waiting.lock().unwrap().remove(&body.id);
    result.unwrap_or_else(|_| json!({ "status": "error", "message": "Recipe Box took too long to respond" }))
}
