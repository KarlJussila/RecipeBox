use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use serde::Serialize;

const MAX_PAGE_BYTES: usize = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

// Recipe sites often serve stripped-down pages (or nothing) to unfamiliar clients.
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
                          (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .expect("http client")
});

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    /// URL after redirects.
    pub url: String,
    pub html: String,
}

pub async fn fetch_page(url: &str) -> Result<Page, String> {
    let response = CLIENT
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach that page ({e})"))?;
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403 | 429) {
        // Paywalls and bot protection. The user's own browser gets through.
        return Err("This website doesn't let Recipe Box read it directly. Open the recipe in Chrome and \
                    click the Recipe Box button instead."
            .into());
    }
    if !status.is_success() {
        return Err(format!("The website answered with an error ({status})"));
    }
    let url = response.url().to_string();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PAGE_BYTES {
        return Err("That page is too large to import".into());
    }
    Ok(Page { url, html: String::from_utf8_lossy(&bytes).into_owned() })
}

/// Downloads an image into `dir` and returns the new file name.
pub async fn download_image(url: &str, referer: Option<&str>, dir: &Path) -> Result<String, String> {
    let mut request = CLIENT.get(url).header("Accept", "image/avif,image/webp,image/*");
    if let Some(referer) = referer {
        request = request.header("Referer", referer);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Image download failed ({})", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    save_image(&bytes, dir)
}

pub fn save_image(bytes: &[u8], dir: &Path) -> Result<String, String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("That image is too large".into());
    }
    let ext = image_extension(bytes).ok_or("That file doesn't look like an image")?;
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    std::fs::write(dir.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(name)
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Some("jpg"),
        [0x89, b'P', b'N', b'G', ..] => Some("png"),
        [b'G', b'I', b'F', b'8', ..] => Some("gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("webp"),
        [_, _, _, _, b'f', b't', b'y', b'p', b'a', b'v', b'i', b'f', ..] => Some("avif"),
        [_, _, _, _, b'f', b't', b'y', b'p', b'h', b'e', b'i', b'c', ..] => Some("heic"),
        _ => None,
    }
}

static LLM_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .expect("http client")
});

#[derive(Serialize)]
pub struct LlmResponse {
    pub status: u16,
    pub body: String,
}

/// Posts a JSON request to an OpenAI-compatible endpoint. Done here rather than in
/// the webview because most providers don't allow browser (CORS) requests.
pub async fn llm_post(url: &str, api_key: &str, body: &serde_json::Value) -> Result<LlmResponse, String> {
    let mut request = LLM_CLIENT.post(url).json(body);
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    let response = request
        // OpenRouter shows this name in its usage dashboard; others ignore it.
        .header("X-Title", "Recipe Box")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the AI service ({e})"))?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok(LlmResponse { status, body })
}
