use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use zip::write::SimpleFileOptions;

use crate::db::Db;

const DB_ENTRY: &str = "recipes.db";
const IMAGES_PREFIX: &str = "images/";
const DAILY_BACKUPS_KEPT: usize = 14;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Writes the database and every recipe image into a single zip file.
pub fn export(db: &Db, images_dir: &Path, dest: &Path) -> Result<(), String> {
    let snapshot = std::env::temp_dir().join(format!("recipebox-{}.db", uuid::Uuid::new_v4()));
    db.backup_to(&snapshot)?;
    let images = db.image_files()?;

    let result = (|| {
        let mut zip = zip::ZipWriter::new(File::create(dest).map_err(err)?);
        let options = SimpleFileOptions::default();
        zip.start_file(DB_ENTRY, options).map_err(err)?;
        zip.write_all(&std::fs::read(&snapshot).map_err(err)?).map_err(err)?;
        // Images are already compressed; storing them avoids wasted effort.
        let stored = options.compression_method(zip::CompressionMethod::Stored);
        for name in images {
            let Ok(bytes) = std::fs::read(images_dir.join(&name)) else { continue };
            zip.start_file(format!("{IMAGES_PREFIX}{name}"), stored).map_err(err)?;
            zip.write_all(&bytes).map_err(err)?;
        }
        zip.finish().map_err(err)?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&snapshot);
    result
}

/// Unpacks a backup made by `export` into a fresh directory and returns
/// `(database path, images directory)`.
pub fn unpack(src: &Path, into: &Path) -> Result<(PathBuf, PathBuf), String> {
    let mut archive = zip::ZipArchive::new(File::open(src).map_err(err)?)
        .map_err(|_| "That file isn't a Recipe Box backup".to_string())?;
    if archive.index_for_name(DB_ENTRY).is_none() {
        return Err("That file isn't a Recipe Box backup".into());
    }
    let images_dir = into.join("images");
    std::fs::create_dir_all(&images_dir).map_err(err)?;
    let db_path = into.join(DB_ENTRY);
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(err)?;
        let name = entry.name().map_err(err)?.to_string();
        let target = if name == DB_ENTRY {
            db_path.clone()
        } else if let Some(file) = name.strip_prefix(IMAGES_PREFIX) {
            // Only plain file names; never let an entry escape the directory.
            if file.is_empty() || file.contains(['/', '\\']) || file.starts_with('.') {
                continue;
            }
            images_dir.join(file)
        } else {
            continue;
        };
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(err)?;
        std::fs::write(target, bytes).map_err(err)?;
    }
    // Make sure it opens (and migrates) before anything is replaced.
    Db::open(&db_path)?;
    Ok((db_path, images_dir))
}

/// Keeps one database snapshot per day in `dir`, dropping the oldest ones.
pub fn daily_snapshot(db: &Db, dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(err)?;
    let today = chrono::Local::now().format("%Y-%m-%d");
    let path = dir.join(format!("recipes-{today}.db"));
    if !path.exists() {
        db.backup_to(&path)?;
    }
    let mut snapshots: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(err)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("recipes-") && n.ends_with(".db")))
        .collect();
    snapshots.sort();
    let excess = snapshots.len().saturating_sub(DAILY_BACKUPS_KEPT);
    for old in &snapshots[..excess] {
        let _ = std::fs::remove_file(old);
    }
    Ok(())
}
