// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK 2.54.1's Skia compositor flashes stale frames at the end of
    // hover transitions. Keep accelerated compositing with TextureMapper.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_USE_SKIA_FOR_COMPOSITION").is_none() {
        // SAFETY: This is the start of main, before Tauri starts any threads.
        unsafe { std::env::set_var("WEBKIT_USE_SKIA_FOR_COMPOSITION", "0") };
    }

    recipe_box_lib::run()
}
