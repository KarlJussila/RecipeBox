//! Card-sized copies of recipe photos for the recipe grid. Photos are saved as
//! downloaded, often 2000 px across, and a grid of hundreds of them is more than the
//! webview can keep decoded: it drops them and decodes them again while scrolling,
//! and the grid flashes blank. Each copy is made the first time its card is shown and
//! kept in `images/thumbs`. Backups leave them out, since they can be made again.

use std::path::{Path, PathBuf};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageReader, Rgb, RgbImage};

pub const DIR: &str = "thumbs";
/// Wide enough for the widest card on a 2× display.
const WIDTH: u32 = 640;
const QUALITY: u8 = 82;
/// The card stock a transparent photo sits on.
const CARD: [u8; 3] = [0xfb, 0xf6, 0xea];

pub fn path(images_dir: &Path, name: &str) -> PathBuf {
    images_dir.join(DIR).join(format!("{name}.jpg"))
}

/// The card-sized copy of a photo, as a JPEG. None when the photo can't be read, such
/// as a format this can't decode, so the full photo is shown instead.
pub fn get(images_dir: &Path, name: &str) -> Option<Vec<u8>> {
    let path = path(images_dir, name);
    if let Ok(bytes) = std::fs::read(&path) {
        return Some(bytes);
    }
    let image = ImageReader::open(images_dir.join(name)).ok()?.with_guessed_format().ok()?.decode().ok()?;
    let image = if image.width() > WIDTH { image.resize(WIDTH, u32::MAX, FilterType::Triangle) } else { image };
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, QUALITY).encode_image(&on_card(image)).ok()?;

    // Written under a temporary name first, so a copy still being written is never read.
    std::fs::create_dir_all(path.parent()?).ok()?;
    let partial = path.with_extension(format!("{}.part", uuid::Uuid::new_v4()));
    if std::fs::write(&partial, &bytes).is_ok() && std::fs::rename(&partial, &path).is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    Some(bytes)
}

/// JPEG has no transparency, so a transparent photo is laid on the card's color.
fn on_card(image: DynamicImage) -> RgbImage {
    if !image.color().has_alpha() {
        return image.into_rgb8();
    }
    let rgba = image.into_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let mix = |c: u8, card: u8| ((c as u16 * a as u16 + card as u16 * (255 - a as u16)) / 255) as u8;
        Rgb([mix(r, CARD[0]), mix(g, CARD[1]), mix(b, CARD[2])])
    })
}

/// Removes copies whose photo no recipe uses any more.
pub fn remove_unused(images_dir: &Path, used: &std::collections::HashSet<&str>) {
    let Ok(entries) = std::fs::read_dir(images_dir.join(DIR)) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let photo = name.strip_suffix(".jpg").unwrap_or(&name);
        if !used.contains(photo) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
