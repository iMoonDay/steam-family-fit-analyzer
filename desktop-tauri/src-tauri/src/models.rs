use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub steam_api_key: String,
    pub itad_api_key: String,
    pub current_steam_id64: String,
    #[serde(default)]
    pub family_access_token: String,
    #[serde(default)]
    pub family_group_id: String,
    pub store_country: String,
    pub locale: String,
    pub price_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeInput {
    pub target_input: String,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSteamConfigResult {
    pub family_access_token: String,
    pub current_steam_id64: String,
    pub family_group_id: String,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCallbackSession {
    pub callback_url: String,
    pub bookmarklet: String,
    pub steam_store_url: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisPreview {
    pub target_count: usize,
    pub normalized_targets: Vec<String>,
    pub price_mode: String,
    pub store_context: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetProfile {
    pub steamid64: String,
    pub display_name: String,
    pub profile_url: String,
    pub avatar: String,
    pub game_count: usize,
    pub raw_game_count: usize,
    pub games: Vec<TargetGame>,
    pub sample_games: Vec<TargetGame>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetGame {
    pub appid: String,
    pub name: String,
    pub store_link: String,
}

#[derive(Debug, Clone)]
pub struct FamilyGame {
    pub name: String,
    pub owners: Vec<String>,
    pub acquired_at: i64,
}

#[derive(Debug, Clone)]
pub struct FamilyLibrary {
    pub games_by_id: HashMap<String, FamilyGame>,
    pub owner_names_by_id: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportGame {
    pub appid: String,
    pub name: String,
    pub store_link: String,
    pub cover_url: String,
    pub target_owners: Vec<String>,
    pub target_owner_names: Vec<String>,
    pub family_owners: Vec<String>,
    pub family_owner_names: Vec<String>,
    pub family_acquired_at: i64,
    pub price: Option<PriceInfo>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceInfo {
    pub initial: Option<i64>,
    pub currency: String,
    pub localized_name: String,
    pub source: String,
    pub is_free: bool,
    pub unavailable: bool,
    pub history_low_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportGameLists {
    pub all: Vec<ReportGame>,
    pub new: Vec<ReportGame>,
    pub relative_new: Vec<ReportGame>,
    pub overlap: Vec<ReportGame>,
    pub current_owned: Vec<ReportGame>,
    pub not_current_owned: Vec<ReportGame>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReport {
    pub target_count: usize,
    pub total_public_games: usize,
    pub family_game_count: usize,
    pub new_game_count: usize,
    pub overlap_count: usize,
    pub current_owned_overlap_count: usize,
    pub targets: Vec<TargetProfile>,
    pub games: ReportGameLists,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub app_name: String,
    pub storage_ready: bool,
    pub cache_directory: String,
}
