use crate::models::{AppSettings, AppStatus};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

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
    let cache_dir = cache_directory(&app, &settings)?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

pub fn export_to_path(path: String, settings: AppSettings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| error.to_string())
}

pub fn import_from_path(path: String) -> Result<AppSettings, String> {
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| format!("配置文件格式不正确：{}", error))
}

pub fn open_cache_directory(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let cache_dir = cache_directory(&app, &settings)?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(cache_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

pub fn cache_directory(app: &AppHandle, settings: &AppSettings) -> Result<PathBuf, String> {
    let custom_dir = settings.cache_directory.trim();
    if custom_dir.is_empty() {
        return app_cache_dir(app);
    }

    let path = PathBuf::from(custom_dir);
    if !path.is_absolute() {
        return Err("缓存目录必须使用绝对路径".to_string());
    }
    Ok(path)
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
