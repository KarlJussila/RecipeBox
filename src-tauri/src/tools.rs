//! The tools an AI job can use. Recipe Box's opencode plugin (opencode-plugin.js)
//! gives them to the agent and posts each call to /tool on the extension server's
//! port (see server.rs).
//!
//! The frontend defines each job's tools and does the work: a tool call arrives
//! here, goes to the frontend as an `ai-tool-call` event, and the answer comes
//! back through `resolve_tool_call`. Each job's id is the bearer token for its
//! tools, so a request only reaches the tools of a job that is running.
//!
//! An answer can also end its job: once a tool has the answer it asked for, the
//! model's closing reply is only a wait, so the job stops there (see opencode.rs).

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

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
    /// The answer is complete, so the job can stop without the model's closing reply.
    #[serde(default)]
    end_job: bool,
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
    ends: Mutex<HashMap<String, Arc<Notify>>>,
}

impl Jobs {
    /// Registers a job's tools, returning what signals that an answer ended it.
    pub fn start(&self, job: &str, tools: Vec<ToolDef>) -> Arc<Notify> {
        self.tools.lock().unwrap().insert(job.to_string(), tools);
        let end = Arc::new(Notify::new());
        self.ends.lock().unwrap().insert(job.to_string(), end.clone());
        end
    }

    pub fn finish(&self, job: &str) {
        self.tools.lock().unwrap().remove(job);
        self.ends.lock().unwrap().remove(job);
    }

    pub fn resolve(&self, call: &str, result: ToolResult) {
        if let Some(tx) = self.waiting.lock().unwrap().remove(call) {
            let _ = tx.send(result);
        }
    }
}

#[derive(Deserialize)]
pub struct CallRequest {
    name: String,
    #[serde(default)]
    arguments: Value,
}

/// Runs one tool call from the opencode plugin, for the job whose id is `token`.
pub fn call(app: &AppHandle, token: Option<&str>, request: CallRequest) -> Result<String, String> {
    let jobs = &app.state::<AppState>().jobs;
    let tools = token.and_then(|t| jobs.tools.lock().unwrap().get(t).cloned());
    let Some(tools) = tools else {
        return Err("No AI job is running for this token".into());
    };
    if !tools.iter().any(|t| t.name == request.name) {
        return Err(format!("Unknown tool: {}", request.name));
    }
    let call = ToolCall {
        job: token.unwrap_or_default().to_string(),
        call: uuid::Uuid::new_v4().to_string(),
        name: request.name,
        arguments: request.arguments,
    };
    let job = call.job.clone();
    let result = run_tool(app, call);
    if result.end_job {
        if let Some(end) = jobs.ends.lock().unwrap().get(&job) {
            end.notify_one();
        }
    }
    Ok(result.text)
}

fn run_tool(app: &AppHandle, call: ToolCall) -> ToolResult {
    let jobs = &app.state::<AppState>().jobs;
    let (tx, rx) = mpsc::channel();
    jobs.waiting.lock().unwrap().insert(call.call.clone(), tx);
    let id = call.call.clone();
    if app.emit("ai-tool-call", call).is_err() {
        jobs.waiting.lock().unwrap().remove(&id);
        return ToolResult { text: "Recipe Box couldn't run the tool".into(), end_job: false };
    }
    match rx.recv_timeout(CALL_TIMEOUT) {
        Ok(result) => result,
        Err(_) => {
            jobs.waiting.lock().unwrap().remove(&id);
            ToolResult { text: "Recipe Box didn't answer in time".into(), end_job: false }
        }
    }
}
