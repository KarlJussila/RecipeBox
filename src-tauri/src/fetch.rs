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
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PAGE_BYTES {
        return Err("That page is too large to import".into());
    }
    Ok(Page { url, html: decode_page(&bytes, content_type.as_deref()) })
}

/// Decodes a page: UTF-8 when the bytes are valid UTF-8, else the charset the
/// server names, else one in a `<meta>` tag. Old pages that declare nothing and
/// aren't UTF-8 are Windows-1252, where "¼" is a single byte.
///
/// Valid UTF-8 wins over a declared single-byte charset, unlike in a browser:
/// pages copied into newer sites often keep their old Latin-1 `<meta>` tag, and
/// real Latin-1 text is almost never valid UTF-8 (its "¼" is a lone byte).
fn decode_page(bytes: &[u8], content_type: Option<&str>) -> String {
    let declared = content_type.and_then(charset_in).or_else(|| {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).to_ascii_lowercase();
        head.split("<meta").skip(1).find_map(|tag| charset_in(&tag[..tag.find('>').unwrap_or(tag.len())]))
    });
    let encoding = declared.and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()));
    let utf16 = encoding.is_some_and(|e| e == encoding_rs::UTF_16LE || e == encoding_rs::UTF_16BE);
    if let (Ok(text), false) = (std::str::from_utf8(bytes), utf16) {
        return text.to_owned();
    }
    encoding.unwrap_or(encoding_rs::WINDOWS_1252).decode(bytes).0.into_owned()
}

/// The value after `charset=` in a Content-Type header or a `<meta>` tag.
fn charset_in(text: &str) -> Option<String> {
    let start = text.to_ascii_lowercase().find("charset=")? + "charset=".len();
    let label: String = text[start..]
        .trim_start_matches(['"', '\''])
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
        .collect();
    (!label.is_empty()).then_some(label)
}

#[cfg(test)]
mod tests {
    use super::decode_page;

    #[test]
    fn decodes_by_header_meta_tag_or_content() {
        let latin = b"<p>\xbc cup milk</p>";
        assert_eq!(decode_page(latin, Some("text/html; charset=ISO-8859-1")), "<p>¼ cup milk</p>");
        assert_eq!(decode_page(b"<meta charset=\"windows-1252\"><p>\xbd</p>", Some("text/html")), "<meta charset=\"windows-1252\"><p>½</p>");
        assert_eq!(
            decode_page(b"<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=iso-8859-1\"><p>\xbc</p>", None),
            "<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=iso-8859-1\"><p>¼</p>"
        );
        // A Latin-1 declaration on a page that is really UTF-8.
        assert_eq!(
            decode_page("<meta charset=\"iso-8859-1\"><p>¼ cup</p>".as_bytes(), None),
            "<meta charset=\"iso-8859-1\"><p>¼ cup</p>"
        );
        // Nothing declared: UTF-8 when it is valid, otherwise the old Windows default.
        assert_eq!(decode_page("<p>¼ cup</p>".as_bytes(), Some("text/html")), "<p>¼ cup</p>");
        assert_eq!(decode_page(latin, Some("text/html")), "<p>¼ cup milk</p>");
    }
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
