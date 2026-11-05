//! Runs AI jobs through the opencode CLI. opencode reaches OpenCode Zen's free
//! models (they only accept requests from opencode itself), and an OpenAI-compatible
//! service set up in Settings is added to it as a provider, so every model is used
//! the same way.
//!
//! A job's config goes in through OPENCODE_CONFIG_CONTENT: an agent with the job's
//! instructions that may use only Recipe Box's own tools (served at /mcp, see
//! mcp.rs), and the service when there is one. Nothing is written to disk.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

const TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    /// Also the bearer token for the job's tools.
    pub id: String,
    pub model: String,
    /// An OpenAI-compatible service, or none for opencode's own models.
    pub service: Option<Service>,
    pub instructions: String,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub base_url: String,
    pub api_key: String,
}

fn config(job: &Job) -> Value {
    let mut config = json!({
        "agent": {
            "recipebox": {
                "mode": "primary",
                "prompt": job.instructions,
                "steps": 12,
                "permission": { "*": "deny", "recipebox_*": "allow" },
            }
        },
        "mcp": {
            "servers": {
                "recipebox": {
                    "type": "remote",
                    "url": format!("http://127.0.0.1:{}/mcp", crate::server::PORT),
                    "headers": { "Authorization": format!("Bearer {}", job.id) },
                    // Plain tool calls rather than JavaScript run through opencode's `execute`.
                    "codemode": false,
                    "oauth": false,
                }
            }
        },
        // Page text runs to 60,000 characters; past the default 51,200 bytes opencode
        // would cut it short and point to a file the agent can't read.
        "tool_output": { "max_bytes": 200_000 },
    });
    if let Some(service) = &job.service {
        let mut provider = json!({
            "name": "Recipe Box service",
            "package": "@opencode/ai/providers/openai-compatible",
            "settings": { "baseURL": service.base_url },
            "models": {
                job.model.clone(): { "name": job.model, "capabilities": { "tools": true, "input": ["text"], "output": ["text"] } }
            },
        });
        if !service.api_key.is_empty() {
            provider["headers"] = json!({ "Authorization": format!("Bearer {}", service.api_key) });
        }
        config["providers"] = json!({ "recipebox-service": provider });
    }
    config
}

/// One opencode session at a time: tagging and page reading queue up behind each other.
static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn exe_name() -> &'static str {
    if cfg!(windows) { "opencode.exe" } else { "opencode" }
}

/// Finds the opencode binary. Apps launched from the Dock or Finder don't get the
/// shell's PATH, so the usual install locations are checked as well.
pub fn find_binary() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = &home {
        for rel in [".opencode/bin", ".local/bin", ".npm-global/bin", ".bun/bin"] {
            dirs.push(home.join(rel));
        }
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    dirs.into_iter().map(|d| d.join(exe_name())).find(|p| p.is_file())
}

pub async fn version(binary: &Path) -> Option<String> {
    let output = Command::new(binary).arg("--version").output().await.ok()?;
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!version.is_empty()).then_some(version)
}

/// Runs a job to the end and returns the model's closing words. Results arrive
/// through the job's tools, not this text.
pub async fn run(sandbox: &Path, job: &Job) -> Result<String, String> {
    let binary = find_binary().ok_or("opencode isn't installed on this computer")?;
    std::fs::create_dir_all(sandbox).map_err(|e| e.to_string())?;
    let model = match job.service {
        Some(_) => format!("recipebox-service/{}", job.model),
        None => job.model.clone(),
    };
    let _turn = ONE_AT_A_TIME.lock().await;

    let mut child = Command::new(binary)
        // --standalone runs a private server instead of the shared background
        // service, so the job reads this config and killing this process on
        // timeout also ends the session.
        .args(["run", "--standalone", "--agent", "recipebox", "--format", "json", "-m", &model])
        .arg(&job.message)
        .env("OPENCODE_CONFIG_CONTENT", config(job).to_string())
        // opencode takes its project folder from PWD when set, which is inherited
        // from whatever launched the app. Keep it in the empty sandbox.
        .current_dir(sandbox)
        .env("PWD", sandbox)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Couldn't start opencode ({e})"))?;

    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let collect = async {
        let (mut out, mut err) = (String::new(), String::new());
        let _ = tokio::join!(stdout.read_to_string(&mut out), stderr.read_to_string(&mut err));
        let status = child.wait().await;
        (out, err, status)
    };
    let (out, err, status) = tokio::time::timeout(TIMEOUT, collect)
        .await
        .map_err(|_| "opencode took too long to answer".to_string())?;

    let mut text = String::new();
    for line in out.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else { continue };
        match event["type"].as_str() {
            Some("text") => text.push_str(event["part"]["text"].as_str().unwrap_or("")),
            Some("error") => {
                let message = event["error"]["data"]["message"]
                    .as_str()
                    .or(event["error"]["message"].as_str())
                    .unwrap_or("unknown error");
                return Err(format!("opencode: {message}"));
            }
            _ => {}
        }
    }
    match status {
        Ok(s) if s.success() => Ok(text),
        _ => {
            let detail = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("no details");
            let code = status.map(|s| s.to_string()).unwrap_or_default();
            Err(format!("opencode failed ({code}): {detail}"))
        }
    }
}
