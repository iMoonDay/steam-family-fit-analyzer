use crate::models::{AppSettings, AppStatus, SteamLoginCache};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigDirectoryPointer {
    config_directory: String,
}

pub fn app_status(app: AppHandle) -> Result<AppStatus, String> {
    let config_dir = app_config_dir(&app)?;
    let cache_dir = app_cache_dir(&app)?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;

    Ok(AppStatus {
        app_name: "Steam 家庭库分析器".to_string(),
        storage_ready: true,
        cache_directory: cache_dir.to_string_lossy().to_string(),
        config_directory: config_dir.to_string_lossy().to_string(),
    })
}

pub fn load(app: AppHandle, defaults: AppSettings) -> Result<AppSettings, String> {
    let path = active_settings_path(&app, &defaults)?;
    if !path.exists() {
        if let Some(config_directory) = load_config_directory_pointer(&app)? {
            let mut settings = defaults;
            settings.config_directory = config_directory;
            return Ok(settings);
        }
        return Ok(defaults);
    }

    load_settings_file(path)
}

pub fn save(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let cache_dir = cache_directory(&app, &settings)?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let path = settings_path(&app, &settings)?;
    write_settings_file(&path, &settings)?;

    if settings.config_directory.trim().is_empty() {
        remove_file_if_exists(config_directory_pointer_path(&app)?)?;
    } else {
        save_config_directory_pointer(&app, settings.config_directory.trim())?;
    }
    Ok(())
}

pub fn export_to_path(path: String, settings: AppSettings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| error.to_string())
}

pub fn import_from_path(path: String) -> Result<AppSettings, String> {
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| format!("配置文件格式不正确：{}", error))
}

pub fn migrate_config_directory(old_path: String, new_path: String) -> Result<(), String> {
    let old_dir = directory_path(old_path, "旧配置目录")?;
    let new_dir = directory_path(new_path, "新配置目录")?;
    if same_path(&old_dir, &new_dir) {
        return Ok(());
    }
    move_file_if_exists(old_dir.join("settings.json"), new_dir.join("settings.json"))
}

pub fn migrate_cache_directory(old_path: String, new_path: String) -> Result<(), String> {
    let old_dir = directory_path(old_path, "旧缓存目录")?;
    let new_dir = directory_path(new_path, "新缓存目录")?;
    if same_path(&old_dir, &new_dir) {
        return Ok(());
    }
    move_file_if_exists(old_dir.join("cache.sqlite3"), new_dir.join("cache.sqlite3"))?;
    move_dir_if_exists(old_dir.join("covers"), new_dir.join("covers"))
}

pub fn load_steam_login_cache(app: AppHandle) -> Result<Option<SteamLoginCache>, String> {
    let path = steam_login_cache_path(&app)?;
    let legacy_path = legacy_steam_login_cache_path(&app)?;
    let is_legacy = !path.exists() && legacy_path.exists();
    let source_path = if path.exists() {
        path.clone()
    } else if is_legacy {
        legacy_path.clone()
    } else {
        return Ok(None);
    };

    let text = fs::read_to_string(&source_path).map_err(|error| error.to_string())?;
    let cache = serde_json::from_str::<SteamLoginCache>(&text)
        .map_err(|error| format!("登录缓存格式不正确：{error}"))?;
    if cache.steamid64.trim().is_empty() || cache.refresh_token.trim().is_empty() {
        return Ok(None);
    }
    if is_legacy {
        write_steam_login_cache_file(&path, &cache)?;
        fs::remove_file(legacy_path).map_err(|error| error.to_string())?;
    } else if text.contains("\"familyAccessToken\"") {
        write_steam_login_cache_file(&path, &cache)?;
    }
    Ok(Some(cache))
}

pub fn save_steam_login_cache(app: AppHandle, cache: SteamLoginCache) -> Result<(), String> {
    if cache.steamid64.trim().is_empty() || cache.refresh_token.trim().is_empty() {
        return Err("登录缓存缺少必要字段".to_string());
    }
    let path = steam_login_cache_path(&app)?;
    write_steam_login_cache_file(&path, &cache)?;
    remove_file_if_exists(legacy_steam_login_cache_path(&app)?)?;
    Ok(())
}

pub fn clear_steam_login_cache(app: AppHandle) -> Result<(), String> {
    remove_file_if_exists(steam_login_cache_path(&app)?)?;
    remove_file_if_exists(legacy_steam_login_cache_path(&app)?)?;
    Ok(())
}

pub fn load_steam_login_notice(app: AppHandle) -> Result<String, String> {
    let path = steam_login_notice_path(&app)?;
    let legacy_path = legacy_steam_login_notice_path(&app)?;
    let is_legacy = !path.exists() && legacy_path.exists();
    let source_path = if path.exists() {
        path.clone()
    } else if is_legacy {
        legacy_path.clone()
    } else {
        return Ok(String::new());
    };
    let message = fs::read_to_string(source_path).map_err(|error| error.to_string())?;
    if is_legacy {
        write_steam_login_notice_file(&path, &message)?;
        fs::remove_file(legacy_path).map_err(|error| error.to_string())?;
    }
    Ok(message)
}

pub fn save_steam_login_notice(app: AppHandle, message: String) -> Result<(), String> {
    let path = steam_login_notice_path(&app)?;
    if message.trim().is_empty() {
        remove_file_if_exists(path)?;
        remove_file_if_exists(legacy_steam_login_notice_path(&app)?)?;
        return Ok(());
    }
    write_steam_login_notice_file(&path, &message)?;
    remove_file_if_exists(legacy_steam_login_notice_path(&app)?)?;
    Ok(())
}

fn write_steam_login_cache_file(path: &PathBuf, cache: &SteamLoginCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(cache).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn write_steam_login_notice_file(path: &PathBuf, message: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, message).map_err(|error| error.to_string())
}

fn directory_path(value: String, label: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label}为空"));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("{label}必须使用绝对路径"));
    }
    Ok(path)
}

fn same_path(left: &PathBuf, right: &PathBuf) -> bool {
    left == right
        || left
            .canonicalize()
            .ok()
            .zip(right.canonicalize().ok())
            .map(|(left, right)| left == right)
            .unwrap_or(false)
}

fn move_file_if_exists(from: PathBuf, to: PathBuf) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if to.exists() {
        if to.is_dir() {
            return Err(format!("目标路径已存在且是目录：{}", to.display()));
        }
        fs::remove_file(&to).map_err(|error| format!("清理目标文件失败：{error}"))?;
    }
    match fs::rename(&from, &to) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            fs::copy(&from, &to).map_err(|error| format!("迁移文件失败：{error}"))?;
            fs::remove_file(&from)
                .map_err(|error| format!("清理旧文件失败：{error}；重命名失败：{rename_error}"))?;
            Ok(())
        }
    }
}

fn move_dir_if_exists(from: PathBuf, to: PathBuf) -> Result<(), String> {
    if !from.exists() {
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if to.exists() && !to.is_dir() {
        fs::remove_file(&to).map_err(|error| format!("清理目标文件失败：{error}"))?;
    }
    match fs::rename(&from, &to) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::create_dir_all(&to).map_err(|error| error.to_string())?;
            for entry in fs::read_dir(&from).map_err(|error| format!("读取旧目录失败：{error}"))?
            {
                let entry = entry.map_err(|error| error.to_string())?;
                let from_path = entry.path();
                let to_path = to.join(entry.file_name());
                if from_path.is_dir() {
                    move_dir_if_exists(from_path, to_path)?;
                } else {
                    move_file_if_exists(from_path, to_path)?;
                }
            }
            fs::remove_dir_all(&from).map_err(|error| format!("清理旧目录失败：{error}"))?;
            Ok(())
        }
    }
}

fn remove_file_if_exists(path: PathBuf) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn clear_steam_login_notice(app: AppHandle) -> Result<(), String> {
    save_steam_login_notice(app, String::new())
}

pub fn open_cache_directory(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let cache_dir = cache_directory(&app, &settings)?;
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(cache_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

pub fn open_config_directory(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let config_dir = config_directory(&app, &settings)?;
    fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(config_dir.to_string_lossy().to_string(), None::<&str>)
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

fn config_directory(app: &AppHandle, settings: &AppSettings) -> Result<PathBuf, String> {
    let custom_dir = settings.config_directory.trim();
    if custom_dir.is_empty() {
        return app_config_dir(app);
    }

    let path = PathBuf::from(custom_dir);
    if !path.is_absolute() {
        return Err("配置目录必须使用绝对路径".to_string());
    }
    Ok(path)
}

fn active_settings_path(app: &AppHandle, defaults: &AppSettings) -> Result<PathBuf, String> {
    let Some(config_directory) = load_config_directory_pointer(app)? else {
        return settings_path(app, defaults);
    };
    let mut settings = defaults.clone();
    settings.config_directory = config_directory;
    settings_path(app, &settings)
}

fn load_config_directory_pointer(app: &AppHandle) -> Result<Option<String>, String> {
    let pointer_path = config_directory_pointer_path(app)?;
    if !pointer_path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(pointer_path).map_err(|error| error.to_string())?;
    let pointer = serde_json::from_str::<ConfigDirectoryPointer>(&text)
        .map_err(|error| format!("配置目录指针格式不正确：{error}"))?;
    Ok(Some(pointer.config_directory))
}

fn load_settings_file(path: PathBuf) -> Result<AppSettings, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn write_settings_file(path: &PathBuf, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn save_config_directory_pointer(app: &AppHandle, config_directory: &str) -> Result<(), String> {
    let path = config_directory_pointer_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let pointer = ConfigDirectoryPointer {
        config_directory: config_directory.to_string(),
    };
    let text = serde_json::to_string_pretty(&pointer).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn settings_path(app: &AppHandle, settings: &AppSettings) -> Result<PathBuf, String> {
    Ok(config_directory(app, settings)?.join("settings.json"))
}

fn config_directory_pointer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("config-directory.json"))
}

fn steam_login_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_cache_dir(app)?.join("steam-login.json"))
}

fn steam_login_notice_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_cache_dir(app)?.join("steam-login-notice.txt"))
}

fn legacy_steam_login_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("steam-login.json"))
}

fn legacy_steam_login_notice_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("steam-login-notice.txt"))
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
