mod analyzer;
mod auto_config;
mod cache;
mod input;
mod itad;
mod models;
mod settings;
mod steam;

use crate::{
    analyzer::{apply_prices_to_report, apply_store_enrichment_to_report, build_analysis_report},
    input::{normalize_target_token, split_target_input},
    models::{
        AnalysisPreview, AnalysisReport, AnalyzeInput, AppSettings, AppStatus,
        AutoSteamConfigResult, BrowserCallbackSession, PriceInfo,
    },
    steam::StoreItemEnrichment,
};
use std::collections::HashMap;
use tauri::AppHandle;

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
fn clear_cache(app: AppHandle) -> Result<(), String> {
    cache::CacheStore::open(&app)?.clear_all()
}

#[tauri::command]
async fn auto_detect_steam_config(
    settings: AppSettings,
) -> Result<AutoSteamConfigResult, String> {
    auto_config::detect(&settings).await
}

#[tauri::command]
fn start_browser_config_callback(app: AppHandle) -> Result<BrowserCallbackSession, String> {
    auto_config::start_browser_callback(app)
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
async fn analyze_target(app: AppHandle, input: AnalyzeInput) -> Result<AnalysisReport, String> {
    let api_key = input.settings.steam_api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("Steam Web API Key 未填写".to_string());
    }
    if input.settings.price_mode == "historyLow" && input.settings.itad_api_key.trim().is_empty() {
        return Err("史低模式需要 IsThereAnyDeal API Key".to_string());
    }

    let tokens = split_target_input(&input.target_input);
    if tokens.is_empty() {
        return Err("请输入至少一个目标账号".to_string());
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
    let report_appids = report
        .games
        .all
        .iter()
        .chain(report.games.relative_new.iter())
        .map(|game| game.appid.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut cache_store = match cache::CacheStore::open(&app) {
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
    }

    Ok(report)
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            load_settings,
            save_settings,
            clear_cache,
            auto_detect_steam_config,
            start_browser_config_callback,
            analyze_preview,
            analyze_target
        ])
        .run(tauri::generate_context!())
        .expect("failed to run desktop app");
}
