//! Runs prompts through the opencode CLI, which gives access to OpenCode Zen's free
//! models (they only accept requests from opencode itself).
//!
//! Prompts include text from arbitrary web pages, so they run with opencode's
//! read-only `plan` agent from an empty folder: in non-interactive mode its shell,
//! file-edit and outside-folder read permissions are all refused.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

const TIMEOUT: Duration = Duration::from_secs(240);

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

/// Sends one prompt and returns the model's reply text.
pub async fn run(sandbox: &Path, model: &str, prompt: &str) -> Result<String, String> {
    let binary = find_binary().ok_or("opencode isn't installed on this computer")?;
    std::fs::create_dir_all(sandbox).map_err(|e| e.to_string())?;

    let mut child = Command::new(binary)
        .args(["run", "--pure", "--agent", "plan", "--format", "json", "-m", model, prompt])
        .current_dir(sandbox)
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
    if text.trim().is_empty() {
        let detail = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("no reply");
        let code = status.map(|s| s.to_string()).unwrap_or_default();
        return Err(format!("opencode returned nothing ({code}): {detail}"));
    }
    Ok(text)
}
