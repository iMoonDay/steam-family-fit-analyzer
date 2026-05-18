use crate::models::{AppSettings, AppStatus};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

pub fn app_status(app: AppHandle) -> Result<AppStatus, String> {
    let config_dir = app_config_dir(&app)?;
    let cache_dir = app_cache_dir(&app)?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

    Ok(AppStatus {
        app_name: "Steam 家庭库分析器".to_string(),
        storage_ready: true,
        cache_directory: cache_dir.to_string_lossy().to_string(),
    })
}

pub fn load(app: AppHandle, defaults: AppSettings) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(defaults);
    }

    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

pub fn save(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("settings.json"))
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| error.to_string())
}

fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|error| error.to_string())
}
