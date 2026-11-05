//! The tools an AI job can use, served to opencode as an MCP server on the
//! extension server's port (see server.rs).
//!
//! The frontend defines each job's tools and does the work: a tool call arrives
//! here, goes to the frontend as an `ai-tool-call` event, and the answer comes
//! back through `resolve_tool_call`. Each job's id is the bearer token for its
//! tools, so a request only reaches the tools of a job that is running.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

const CALL_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    text: String,
    is_error: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ToolCall {
    job: String,
    call: String,
    name: String,
    arguments: Value,
}

#[derive(Default)]
pub struct Jobs {
    tools: Mutex<HashMap<String, Vec<ToolDef>>>,
    waiting: Mutex<HashMap<String, mpsc::Sender<ToolResult>>>,
}

impl Jobs {
    pub fn start(&self, job: &str, tools: Vec<ToolDef>) {
        self.tools.lock().unwrap().insert(job.to_string(), tools);
    }

    pub fn finish(&self, job: &str) {
        self.tools.lock().unwrap().remove(job);
    }

    pub fn resolve(&self, call: &str, result: ToolResult) {
        if let Some(tx) = self.waiting.lock().unwrap().remove(call) {
            let _ = tx.send(result);
        }
    }
}

/// Answers one JSON-RPC message. `None` means a notification, which gets no reply.
pub fn handle(app: &AppHandle, token: Option<&str>, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let jobs = &app.state::<AppState>().jobs;
    let tools = token.and_then(|t| jobs.tools.lock().unwrap().get(t).cloned());
    let Some(tools) = tools else {
        return Some(error(id, -32001, "No AI job is running for this token"));
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match message.get("method").and_then(Value::as_str) {
        Some("initialize") => json!({
            "protocolVersion": params.get("protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "recipe-box", "version": app.package_info().version.to_string() },
        }),
        Some("ping") => json!({}),
        Some("tools/list") => json!({ "tools": tools }),
        Some("tools/call") => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
            if !tools.iter().any(|t| t.name == name) {
                return Some(error(id, -32602, &format!("Unknown tool: {name}")));
            }
            let call = ToolCall {
                job: token.unwrap_or_default().to_string(),
                call: uuid::Uuid::new_v4().to_string(),
                name,
                arguments: params.get("arguments").cloned().unwrap_or(json!({})),
            };
            let (text, is_error) = run_tool(app, call);
            json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
        }
        _ => return Some(error(id, -32601, "Method not found")),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn run_tool(app: &AppHandle, call: ToolCall) -> (String, bool) {
    let jobs = &app.state::<AppState>().jobs;
    let (tx, rx) = mpsc::channel();
    jobs.waiting.lock().unwrap().insert(call.call.clone(), tx);
    let id = call.call.clone();
    if app.emit("ai-tool-call", call).is_err() {
        jobs.waiting.lock().unwrap().remove(&id);
        return ("Recipe Box couldn't run the tool".into(), true);
    }
    match rx.recv_timeout(CALL_TIMEOUT) {
        Ok(result) => (result.text, result.is_error),
        Err(_) => {
            jobs.waiting.lock().unwrap().remove(&id);
            ("Recipe Box didn't answer in time".into(), true)
        }
    }
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}
