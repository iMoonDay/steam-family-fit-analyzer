use serde::{Deserialize, Serialize};
use std::{error::Error, fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

const STEAMID64_INDIVIDUAL_BASE: u128 = 76_561_197_960_265_728;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
  steam_api_key: String,
  itad_api_key: String,
  current_steam_id64: String,
  store_country: String,
  locale: String,
  price_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeInput {
  target_input: String,
  settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisPreview {
  target_count: usize,
  normalized_targets: Vec<String>,
  price_mode: String,
  store_context: String,
  warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetProfile {
  steamid64: String,
  display_name: String,
  profile_url: String,
  avatar: String,
  game_count: usize,
  raw_game_count: usize,
  sample_games: Vec<TargetGame>,
  #[serde(skip_serializing)]
  appids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TargetGame {
  appid: String,
  name: String,
  store_link: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisReport {
  target_count: usize,
  total_public_games: usize,
  current_owned_overlap_count: usize,
  targets: Vec<TargetProfile>,
  warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
  app_name: String,
  storage_ready: bool,
  cache_directory: String,
}

#[tauri::command]
fn get_app_status(app: AppHandle) -> Result<AppStatus, String> {
  let config_dir = app_config_dir(&app)?;
  fs::create_dir_all(&config_dir).map_err(|error| error.to_string())?;

  Ok(AppStatus {
    app_name: "Steam 家庭库分析器".to_string(),
    storage_ready: true,
    cache_directory: config_dir.to_string_lossy().to_string(),
  })
}

#[tauri::command]
fn load_settings(app: AppHandle, defaults: AppSettings) -> Result<AppSettings, String> {
  let path = settings_path(&app)?;
  if !path.exists() {
    return Ok(defaults);
  }

  let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
  serde_json::from_str(&text).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
  let path = settings_path(&app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  let text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
  fs::write(path, text).map_err(|error| error.to_string())
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
async fn analyze_target(input: AnalyzeInput) -> Result<AnalysisReport, String> {
  let api_key = input.settings.steam_api_key.trim().to_string();
  if api_key.is_empty() {
    return Err("Steam Web API Key 未填写".to_string());
  }

  let tokens = split_target_input(&input.target_input);
  if tokens.is_empty() {
    return Err("请输入至少一个目标账号".to_string());
  }

  let client = reqwest::Client::builder()
    .user_agent("SteamFamilyFitAnalyzerDesktop/0.1")
    .use_native_tls()
    .timeout(Duration::from_secs(30))
    .build()
    .map_err(|error| error.to_string())?;

  let mut targets = Vec::new();
  for token in tokens {
    let identity = resolve_target_identity(&client, &api_key, &token).await?;
    let profile = fetch_target_profile(&client, &api_key, identity).await?;
    targets.push(profile);
  }

  let current_owned_appids = if input.settings.current_steam_id64.trim().is_empty() {
    Vec::new()
  } else {
    fetch_owned_appids(&client, &api_key, input.settings.current_steam_id64.trim()).await?
  };

  let current_owned_set = current_owned_appids
    .iter()
    .map(String::as_str)
    .collect::<std::collections::HashSet<_>>();
  let current_owned_overlap_count = targets
    .iter()
    .flat_map(|target| target.appids.iter())
    .filter(|appid| current_owned_set.contains(appid.as_str()))
    .count();

  let mut warnings = Vec::new();
  if input.settings.price_mode == "historyLow" && input.settings.itad_api_key.trim().is_empty() {
    warnings.push("史低模式需要 IsThereAnyDeal API Key".to_string());
  }
  if input.settings.current_steam_id64.trim().is_empty() {
    warnings.push("未填写当前 SteamID64，暂不计算当前账号已拥有重叠".to_string());
  }

  Ok(AnalysisReport {
    target_count: targets.len(),
    total_public_games: targets.iter().map(|target| target.game_count).sum(),
    current_owned_overlap_count,
    targets,
    warnings,
  })
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(app_config_dir(app)?.join("settings.json"))
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .app_config_dir()
    .map_err(|error| error.to_string())
}

fn split_target_input(input: &str) -> Vec<String> {
  input
    .split_whitespace()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(ToOwned::to_owned)
    .collect()
}

fn normalize_target_token(token: &str) -> String {
  let trimmed = token.trim();
  if trimmed.chars().all(|char| char.is_ascii_digit()) {
    return trimmed.to_string();
  }

  if let Some(value) = extract_between(trimmed, "/profiles/", "/") {
    return value;
  }
  if let Some(value) = extract_between(trimmed, "/id/", "/") {
    return value;
  }

  trimmed.trim_start_matches('@').to_string()
}

#[derive(Debug, Clone)]
struct TargetIdentity {
  steamid64: String,
  profile_url: String,
  display_name: String,
}

async fn resolve_target_identity(
  client: &reqwest::Client,
  api_key: &str,
  raw_token: &str,
) -> Result<TargetIdentity, String> {
  let token = normalize_target_token(raw_token);
  if token.chars().all(|char| char.is_ascii_digit()) {
    let steamid64 = if token.len() == 17 {
      token
    } else {
      steam_friend_code_to_steamid64(&token)?
    };
    return Ok(TargetIdentity {
      profile_url: format!("https://steamcommunity.com/profiles/{steamid64}"),
      display_name: steamid64.clone(),
      steamid64,
    });
  }

  let data = request_json(
    client,
    "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/",
    &[
      ("key", api_key),
      ("vanityurl", token.as_str()),
      ("format", "json"),
    ],
  )
  .await?;
  let response = data.get("response").unwrap_or(&serde_json::Value::Null);
  let success = response.get("success").and_then(serde_json::Value::as_i64).unwrap_or(0);
  let steamid64 = response.get("steamid").and_then(serde_json::Value::as_str).unwrap_or("");
  if success != 1 || !is_steamid64(steamid64) {
    return Err(format!("无法解析自定义 ID：{token}"));
  }

  Ok(TargetIdentity {
    steamid64: steamid64.to_string(),
    profile_url: format!("https://steamcommunity.com/id/{token}"),
    display_name: token,
  })
}

async fn fetch_target_profile(
  client: &reqwest::Client,
  api_key: &str,
  identity: TargetIdentity,
) -> Result<TargetProfile, String> {
  let summary = fetch_player_summary(client, api_key, &identity).await?;
  let games_data = request_json(
    client,
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
    &[
      ("key", api_key),
      ("steamid", identity.steamid64.as_str()),
      ("include_appinfo", "1"),
      ("include_played_free_games", "1"),
      ("format", "json"),
    ],
  )
  .await?;

  let games = games_data
    .get("response")
    .and_then(|response| response.get("games"))
    .and_then(serde_json::Value::as_array)
    .cloned()
    .unwrap_or_default();
  if games.is_empty() {
    return Err(format!("目标账号没有公开游戏库或游戏库为空：{}", identity.steamid64));
  }

  let normalized_games = games
    .iter()
    .filter_map(normalize_target_game)
    .collect::<Vec<_>>();
  let appids = normalized_games.iter().map(|game| game.appid.clone()).collect::<Vec<_>>();
  let sample_games = normalized_games.into_iter().take(30).collect::<Vec<_>>();

  Ok(TargetProfile {
    steamid64: identity.steamid64,
    display_name: summary.display_name,
    profile_url: summary.profile_url,
    avatar: summary.avatar,
    game_count: games.len(),
    raw_game_count: games.len(),
    sample_games,
    appids,
  })
}

#[derive(Debug, Clone)]
struct PlayerSummary {
  display_name: String,
  profile_url: String,
  avatar: String,
}

async fn fetch_player_summary(
  client: &reqwest::Client,
  api_key: &str,
  identity: &TargetIdentity,
) -> Result<PlayerSummary, String> {
  let data = request_json(
    client,
    "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/",
    &[
      ("key", api_key),
      ("steamids", identity.steamid64.as_str()),
      ("format", "json"),
    ],
  )
  .await?;
  let player = data
    .get("response")
    .and_then(|response| response.get("players"))
    .and_then(serde_json::Value::as_array)
    .and_then(|players| players.first());

  Ok(PlayerSummary {
    display_name: player
      .and_then(|value| value.get("personaname"))
      .and_then(serde_json::Value::as_str)
      .unwrap_or(identity.display_name.as_str())
      .to_string(),
    profile_url: player
      .and_then(|value| value.get("profileurl"))
      .and_then(serde_json::Value::as_str)
      .unwrap_or(identity.profile_url.as_str())
      .to_string(),
    avatar: player
      .and_then(|value| value.get("avatarfull").or_else(|| value.get("avatarmedium")).or_else(|| value.get("avatar")))
      .and_then(serde_json::Value::as_str)
      .unwrap_or("")
      .to_string(),
  })
}

async fn fetch_owned_appids(
  client: &reqwest::Client,
  api_key: &str,
  steamid64: &str,
) -> Result<Vec<String>, String> {
  if !is_steamid64(steamid64) {
    return Err("当前 SteamID64 必须是 17 位数字".to_string());
  }
  let data = request_json(
    client,
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/",
    &[
      ("key", api_key),
      ("steamid", steamid64),
      ("include_appinfo", "0"),
      ("include_played_free_games", "1"),
      ("format", "json"),
    ],
  )
  .await?;
  Ok(data
    .get("response")
    .and_then(|response| response.get("games"))
    .and_then(serde_json::Value::as_array)
    .map(|games| {
      games
        .iter()
        .filter_map(|game| game.get("appid").and_then(value_to_appid))
        .collect::<Vec<_>>()
    })
    .unwrap_or_default())
}

async fn request_json(
  client: &reqwest::Client,
  url: &str,
  query: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
  let request_url = build_request_url(url, query)?;
  let response = client
    .get(request_url)
    .header(reqwest::header::ACCEPT, "application/json,text/javascript,*/*;q=0.1")
    .send()
    .await
    .map_err(|error| format!("网络请求失败：{}", redact_secret(&format_error_chain(&error), query)))?;
  let status = response.status();
  if !status.is_success() {
    return Err(format!("Steam API 返回 HTTP {status}"));
  }
  response
    .json::<serde_json::Value>()
    .await
    .map_err(|error| format!("Steam API 响应无法解析：{}", redact_secret(&format_error_chain(&error), query)))
}

fn build_request_url(url: &str, query: &[(&str, &str)]) -> Result<reqwest::Url, String> {
  reqwest::Url::parse_with_params(url, query).map_err(|error| format!("请求 URL 无效：{error}"))
}

fn redact_secret(message: &str, query: &[(&str, &str)]) -> String {
  query.iter().fold(message.to_string(), |text, (key, value)| {
    if *key == "key" && !value.is_empty() {
      text.replace(value, "****")
    } else {
      text
    }
  })
}

fn format_error_chain(error: &dyn Error) -> String {
  let mut parts = vec![error.to_string()];
  let mut source = error.source();
  while let Some(error) = source {
    parts.push(error.to_string());
    source = error.source();
  }
  parts.join("；")
}

fn normalize_target_game(game: &serde_json::Value) -> Option<TargetGame> {
  let appid = game.get("appid").and_then(value_to_appid)?;
  let name = game
    .get("name")
    .and_then(serde_json::Value::as_str)
    .filter(|value| !value.trim().is_empty())
    .map(str::to_string)
    .unwrap_or_else(|| format!("App {appid}"));
  Some(TargetGame {
    store_link: format!("https://store.steampowered.com/app/{appid}/"),
    appid,
    name,
  })
}

fn value_to_appid(value: &serde_json::Value) -> Option<String> {
  value
    .as_u64()
    .map(|number| number.to_string())
    .or_else(|| value.as_str().filter(|text| text.chars().all(|char| char.is_ascii_digit())).map(str::to_string))
}

fn steam_friend_code_to_steamid64(friend_code: &str) -> Result<String, String> {
  let account_id = friend_code
    .parse::<u128>()
    .map_err(|_| "好友码格式不正确".to_string())?;
  if account_id == 0 {
    return Err("好友码格式不正确".to_string());
  }
  Ok((STEAMID64_INDIVIDUAL_BASE + account_id).to_string())
}

fn is_steamid64(value: &str) -> bool {
  value.len() == 17 && value.chars().all(|char| char.is_ascii_digit())
}

fn extract_between(input: &str, start: &str, end: &str) -> Option<String> {
  let start_index = input.find(start)? + start.len();
  let rest = &input[start_index..];
  let end_index = rest.find(end).unwrap_or(rest.len());
  let value = &rest[..end_index];
  if value.is_empty() {
    None
  } else {
    Some(value.to_string())
  }
}

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      get_app_status,
      load_settings,
      save_settings,
      analyze_preview,
      analyze_target
    ])
    .run(tauri::generate_context!())
    .expect("failed to run desktop app");
}
