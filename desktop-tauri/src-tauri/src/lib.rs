mod analyzer;
mod auto_config;
mod cache;
mod error;
mod input;
mod itad;
mod models;
mod settings;
mod steam;
mod steam_login;

use crate::{
    analyzer::{apply_prices_to_report, apply_store_enrichment_to_report, build_analysis_report},
    input::{is_steamid64, normalize_target_token, split_target_input},
    models::{
        AnalysisPreview, AnalysisReport, AnalyzeInput, AppSettings, AppStatus,
        AutoSteamConfigResult, BrowserCallbackSession, CacheCoversInput, CacheCoversOutput,
        PriceInfo, RefreshReportPricesInput, SteamLoginCache, SteamLoginProfile,
        SteamLoginRefreshResult, SteamQrLoginPollResult, SteamQrLoginSession,
    },
    steam::StoreItemEnrichment,
};
use base64::{engine::general_purpose, Engine as _};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[tauri::command]
fn get_app_status(app: AppHandle) -> Result<AppStatus, String> {
    settings::app_status(app)
}

#[tauri::command]
fn load_settings(app: AppHandle, defaults: AppSettings) -> Result<AppSettings, String> {
    settings::load(app, defaults)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    settings::save(app, settings)
}

#[tauri::command]
fn export_settings(path: String, settings: AppSettings) -> Result<(), String> {
    settings::export_to_path(path, settings)
}

#[tauri::command]
fn import_settings(path: String) -> Result<AppSettings, String> {
    settings::import_from_path(path)
}

#[tauri::command]
fn migrate_config_directory(old_path: String, new_path: String) -> Result<(), String> {
    settings::migrate_config_directory(old_path, new_path)
}

#[tauri::command]
fn migrate_cache_directory(old_path: String, new_path: String) -> Result<(), String> {
    settings::migrate_cache_directory(old_path, new_path)
}

#[tauri::command]
fn load_steam_login_cache(app: AppHandle) -> Result<Option<SteamLoginCache>, String> {
    settings::load_steam_login_cache(app)
}

#[tauri::command]
fn save_steam_login_cache(app: AppHandle, cache: SteamLoginCache) -> Result<(), String> {
    settings::save_steam_login_cache(app, cache)
}

#[tauri::command]
fn clear_steam_login_cache(app: AppHandle) -> Result<(), String> {
    settings::clear_steam_login_cache(app)
}

#[tauri::command]
fn load_steam_login_notice(app: AppHandle) -> Result<String, String> {
    settings::load_steam_login_notice(app)
}

#[tauri::command]
fn save_steam_login_notice(app: AppHandle, message: String) -> Result<(), String> {
    settings::save_steam_login_notice(app, message)
}

#[tauri::command]
fn clear_steam_login_notice(app: AppHandle) -> Result<(), String> {
    settings::clear_steam_login_notice(app)
}

#[tauri::command]
fn clear_cache(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    cache::CacheStore::open(&app, &settings)?.clear_all()
}

#[tauri::command]
fn open_cache_directory(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    settings::open_cache_directory(app, settings)
}

#[tauri::command]
fn open_config_directory(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    settings::open_config_directory(app, settings)
}

#[tauri::command]
fn save_png_file(path: String, data_url: String) -> Result<(), String> {
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "导出图片数据格式错误".to_string())?;
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("导出图片解码失败：{error}"))?;
    let output_path = PathBuf::from(path);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("创建导出目录失败：{error}"))?;
    }
    std::fs::write(output_path, bytes).map_err(|error| format!("保存封面图失败：{error}"))
}

#[tauri::command]
async fn cache_covers(
    app: AppHandle,
    input: CacheCoversInput,
) -> Result<CacheCoversOutput, String> {
    let client = steam::build_client()?;
    let mut cache_store = cache::CacheStore::open(&app, &input.settings)?;
    cache_store.allow_cover_asset_scope(&app)?;
    Ok(cache_store
        .cache_covers(&client, &input.settings, &input.covers)
        .await)
}

#[tauri::command]
async fn auto_detect_steam_config(settings: AppSettings) -> Result<AutoSteamConfigResult, String> {
    auto_config::detect(&settings).await
}

#[tauri::command]
fn start_browser_config_callback(app: AppHandle) -> Result<BrowserCallbackSession, String> {
    auto_config::start_browser_callback(app)
}

#[tauri::command]
async fn begin_steam_qr_login() -> Result<SteamQrLoginSession, String> {
    let client = steam::build_client()?;
    steam_login::begin_qr_login(&client).await
}

#[tauri::command]
async fn poll_steam_qr_login(
    client_id: String,
    request_id: String,
) -> Result<SteamQrLoginPollResult, String> {
    let client = steam::build_client()?;
    steam_login::poll_qr_login(&client, &client_id, &request_id).await
}

#[tauri::command]
async fn fetch_family_config_from_steam_login(
    steamid64: String,
    access_token: String,
) -> Result<AutoSteamConfigResult, String> {
    let client = steam::build_client()?;
    steam_login::fetch_family_config_from_login(&client, &steamid64, &access_token).await
}

#[tauri::command]
async fn fetch_steam_api_key_from_steam_login(
    steamid64: String,
    access_token: String,
) -> Result<Option<String>, String> {
    let client = steam::build_client()?;
    steam_login::fetch_steam_api_key_from_login(&client, &steamid64, &access_token).await
}

#[tauri::command]
async fn refresh_steam_login(
    steamid64: String,
    refresh_token: String,
) -> Result<SteamLoginRefreshResult, String> {
    let client = steam::build_client()?;
    steam_login::refresh_access_token(&client, &steamid64, &refresh_token).await
}

#[tauri::command]
async fn fetch_steam_login_profile(
    steamid64: String,
    steam_api_key: String,
) -> Result<SteamLoginProfile, String> {
    let client = steam::build_client()?;
    steam::fetch_steam_login_profile(&client, &steam_api_key, &steamid64).await
}

#[tauri::command]
fn analyze_preview(input: AnalyzeInput) -> Result<AnalysisPreview, String> {
    let normalized_targets = split_target_input(&input.target_input)
        .into_iter()
        .map(|target| normalize_target_token(&target))
        .collect::<Vec<_>>();
    let mut warnings = Vec::new();

    if input.settings.price_mode == "historyLow" && input.settings.itad_api_key.trim().is_empty() {
        warnings.push("史低模式需要 IsThereAnyDeal API Key".to_string());
    }

    if input.settings.steam_api_key.trim().is_empty() {
        warnings.push("Steam Web API Key 未填写".to_string());
    }

    Ok(AnalysisPreview {
        target_count: normalized_targets.len(),
        normalized_targets,
        price_mode: input.settings.price_mode,
        store_context: format!("{}:{}", input.settings.store_country, input.settings.locale),
        warnings,
    })
}

#[tauri::command]
async fn validate_steam_api_key(settings: AppSettings) -> Result<String, String> {
    let api_key = settings.steam_api_key.trim();
    if api_key.is_empty() {
        return Err(crate::error::AppError::InputValidation(
            "Steam Web API Key 未填写".to_string(),
        )
        .user_message());
    }

    let client = steam::build_client()?;
    let probe_steamid = if is_steamid64(settings.current_steam_id64.trim()) {
        settings.current_steam_id64.trim()
    } else {
        "76561197960435530"
    };
    steam::fetch_player_display_names(&client, api_key, &[probe_steamid.to_string()]).await?;
    Ok("Steam Web API Key 有效".to_string())
}

#[tauri::command]
async fn validate_itad_api_key(settings: AppSettings) -> Result<String, String> {
    if settings.itad_api_key.trim().is_empty() {
        return Err(crate::error::AppError::InputValidation(
            "IsThereAnyDeal API Key 未填写".to_string(),
        )
        .user_message());
    }

    let client = steam::build_client()?;
    itad::fetch_history_low_prices(&client, &["10".to_string()], &settings).await?;
    Ok("IsThereAnyDeal API Key 有效".to_string())
}

#[tauri::command]
async fn validate_family_access_token(settings: AppSettings) -> Result<String, String> {
    let access_token = settings.family_access_token.trim();
    if access_token.is_empty() {
        return Err(crate::error::AppError::InputValidation(
            "家庭库 Access Token 未填写".to_string(),
        )
        .user_message());
    }

    let client = steam::build_client()?;
    let family_group_id = steam::fetch_family_group_id(&client, access_token).await?;
    Ok(format!(
        "家庭库 Access Token 有效，家庭组 ID：{family_group_id}"
    ))
}

#[tauri::command]
async fn analyze_target(app: AppHandle, input: AnalyzeInput) -> Result<AnalysisReport, String> {
    let api_key = input.settings.steam_api_key.trim().to_string();
    if api_key.is_empty() {
        return Err(crate::error::AppError::InputValidation(
            "Steam Web API Key 未填写".to_string(),
        )
        .user_message());
    }
    if input.settings.price_mode == "historyLow" && input.settings.itad_api_key.trim().is_empty() {
        return Err(crate::error::AppError::InputValidation(
            "史低模式需要 IsThereAnyDeal API Key".to_string(),
        )
        .user_message());
    }

    let tokens = split_target_input(&input.target_input);
    if tokens.is_empty() {
        return Err(
            crate::error::AppError::InputValidation("请输入至少一个目标账号".to_string())
                .user_message(),
        );
    }

    let client = steam::build_client()?;
    let mut targets = Vec::new();
    for token in tokens {
        targets.push(steam::fetch_target_profile(&client, &api_key, &token).await?);
    }

    let current_owned_appids = if input.settings.current_steam_id64.trim().is_empty() {
        Vec::new()
    } else {
        steam::fetch_owned_appids(&client, &api_key, input.settings.current_steam_id64.trim())
            .await?
    };
    let family_library = if input.settings.family_access_token.trim().is_empty() {
        None
    } else {
        let family_group_id = if input.settings.family_group_id.trim().is_empty() {
            steam::fetch_family_group_id(&client, input.settings.family_access_token.trim()).await?
        } else {
            input.settings.family_group_id.trim().to_string()
        };
        let mut library = steam::fetch_family_library(
            &client,
            input.settings.family_access_token.trim(),
            family_group_id.as_str(),
        )
        .await?;
        let family_owner_ids = library
            .games_by_id
            .values()
            .flat_map(|game| game.owners.iter().cloned())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        library.owner_names_by_id =
            steam::fetch_player_display_names(&client, &api_key, &family_owner_ids).await?;
        Some(library)
    };

    let mut warnings = Vec::new();
    if input.settings.price_mode == "historyLow" && input.settings.itad_api_key.trim().is_empty() {
        warnings.push("史低模式需要 IsThereAnyDeal API Key".to_string());
    }
    if input.settings.current_steam_id64.trim().is_empty() {
        warnings.push("未填写当前 SteamID64，暂不计算当前账号已拥有重叠".to_string());
    }
    if input.settings.family_access_token.trim().is_empty() {
        warnings.push("未填写家庭库 access token，暂不计算家庭库重复与新增候选".to_string());
    }

    let mut report = build_analysis_report(
        targets,
        &current_owned_appids,
        family_library.as_ref(),
        warnings,
    );
    let report_appids = collect_report_appids(&report);
    let mut cache_store = match cache::CacheStore::open(&app, &input.settings) {
        Ok(cache_store) => Some(cache_store),
        Err(error) => {
            report.warnings.push(format!("缓存不可用：{error}"));
            None
        }
    };

    apply_store_enrichment(
        &client,
        cache_store.as_mut(),
        &report_appids,
        &input.settings,
        &mut report,
    )
    .await;
    if input.settings.price_mode == "historyLow" {
        apply_history_low_prices(
            &client,
            cache_store.as_mut(),
            &report_appids,
            &input.settings,
            &mut report,
        )
        .await?;
    } else {
        apply_display_prices(&mut report, "original");
    }

    Ok(report)
}

#[tauri::command]
async fn refresh_report_prices(
    app: AppHandle,
    input: RefreshReportPricesInput,
) -> Result<AnalysisReport, String> {
    if input.settings.price_mode == "historyLow" && input.settings.itad_api_key.trim().is_empty() {
        return Err("史低模式需要 IsThereAnyDeal API Key".to_string());
    }

    let client = steam::build_client()?;
    let mut report = input.report;
    let report_appids = collect_report_appids(&report);
    let mut cache_store = match cache::CacheStore::open(&app, &input.settings) {
        Ok(cache_store) => Some(cache_store),
        Err(error) => {
            report.warnings.push(format!("缓存不可用：{error}"));
            None
        }
    };

    if input.settings.price_mode == "historyLow" {
        apply_history_low_prices(
            &client,
            cache_store.as_mut(),
            &report_appids,
            &input.settings,
            &mut report,
        )
        .await?;
        apply_display_prices(&mut report, "historyLow");
    } else {
        apply_store_enrichment(
            &client,
            cache_store.as_mut(),
            &report_appids,
            &input.settings,
            &mut report,
        )
        .await;
        apply_display_prices(&mut report, "original");
    }

    Ok(report)
}

fn apply_display_prices(report: &mut AnalysisReport, price_mode: &str) {
    apply_display_prices_to_games(&mut report.games.all, price_mode);
    apply_display_prices_to_games(&mut report.games.new, price_mode);
    apply_display_prices_to_games(&mut report.games.relative_new, price_mode);
    apply_display_prices_to_games(&mut report.games.overlap, price_mode);
    apply_display_prices_to_games(&mut report.games.current_owned, price_mode);
    apply_display_prices_to_games(&mut report.games.not_current_owned, price_mode);
}

fn apply_display_prices_to_games(games: &mut [crate::models::ReportGame], price_mode: &str) {
    for game in games {
        game.price = if price_mode == "historyLow" {
            game.prices.history_low.clone()
        } else {
            game.prices.original.clone()
        };
    }
}

fn collect_report_appids(report: &AnalysisReport) -> Vec<String> {
    report
        .games
        .all
        .iter()
        .chain(report.games.relative_new.iter())
        .map(|game| game.appid.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect()
}

async fn apply_store_enrichment(
    client: &reqwest::Client,
    cache_store: Option<&mut cache::CacheStore>,
    appids: &[String],
    settings: &AppSettings,
    report: &mut AnalysisReport,
) {
    let mut enrichment = HashMap::<String, StoreItemEnrichment>::new();
    let mut cache_store = cache_store;

    if let Some(cache_store) = cache_store.as_ref() {
        match cache_store.load_store_enrichment(appids, settings) {
            Ok(cached) => enrichment.extend(cached),
            Err(error) => report.warnings.push(format!("读取商店缓存失败：{error}")),
        }
    }

    let missing_appids = appids
        .iter()
        .filter(|appid| !enrichment.contains_key(*appid))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_appids.is_empty() {
        match steam::fetch_store_item_enrichment(client, &missing_appids, settings).await {
            Ok(fetched) => {
                if let Some(cache_store) = cache_store.as_mut() {
                    if let Err(error) = cache_store.save_store_enrichment(&fetched, settings) {
                        report.warnings.push(format!("写入商店缓存失败：{error}"));
                    }
                }
                enrichment.extend(fetched);
            }
            Err(error) => report
                .warnings
                .push(format!("部分商店信息获取失败：{error}")),
        }
    }

    apply_store_enrichment_to_report(report, &enrichment);
}

async fn apply_history_low_prices(
    client: &reqwest::Client,
    cache_store: Option<&mut cache::CacheStore>,
    appids: &[String],
    settings: &AppSettings,
    report: &mut AnalysisReport,
) -> Result<(), String> {
    let mut prices = HashMap::<String, PriceInfo>::new();
    let mut cache_store = cache_store;

    if let Some(cache_store) = cache_store.as_ref() {
        match cache_store.load_prices(appids, settings, "historyLow") {
            Ok(cached) => prices.extend(cached),
            Err(error) => report.warnings.push(format!("读取史低缓存失败：{error}")),
        }
    }

    let missing_appids = appids
        .iter()
        .filter(|appid| !prices.contains_key(*appid))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_appids.is_empty() {
        let fetched = itad::fetch_history_low_prices(client, &missing_appids, settings).await?;
        if let Some(cache_store) = cache_store.as_mut() {
            if let Err(error) = cache_store.save_prices(&fetched, settings, "historyLow") {
                report.warnings.push(format!("写入史低缓存失败：{error}"));
            }
        }
        prices.extend(fetched);
    }

    apply_prices_to_report(report, &prices);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.center()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            load_settings,
            save_settings,
            export_settings,
            import_settings,
            migrate_config_directory,
            migrate_cache_directory,
            load_steam_login_cache,
            save_steam_login_cache,
            clear_steam_login_cache,
            load_steam_login_notice,
            save_steam_login_notice,
            clear_steam_login_notice,
            clear_cache,
            open_cache_directory,
            open_config_directory,
            save_png_file,
            cache_covers,
            auto_detect_steam_config,
            start_browser_config_callback,
            begin_steam_qr_login,
            poll_steam_qr_login,
            fetch_family_config_from_steam_login,
            fetch_steam_api_key_from_steam_login,
            refresh_steam_login,
            fetch_steam_login_profile,
            analyze_preview,
            validate_steam_api_key,
            validate_itad_api_key,
            validate_family_access_token,
            analyze_target,
            refresh_report_prices
        ])
        .run(tauri::generate_context!())
        .expect("failed to run desktop app");
}
