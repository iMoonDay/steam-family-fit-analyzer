use crate::{
    input::{is_steamid64, normalize_target_token, steam_friend_code_to_steamid64},
    models::{AppSettings, FamilyGame, FamilyLibrary, PriceInfo, TargetGame, TargetProfile},
};
use std::{collections::HashMap, error::Error, time::Duration};

const STORE_ITEM_ASSET_BASE_URL: &str = "https://shared.fastly.steamstatic.com/store_item_assets/";

#[derive(Debug, Clone)]
struct TargetIdentity {
    steamid64: String,
    profile_url: String,
    display_name: String,
}

#[derive(Debug, Clone)]
struct PlayerSummary {
    display_name: String,
    profile_url: String,
    avatar: String,
}

#[derive(Debug, Clone)]
pub struct StoreItemEnrichment {
    pub cover_url: String,
    pub price: Option<PriceInfo>,
}

pub fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("SteamFamilyFitAnalyzerDesktop/0.1")
        .use_native_tls()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

pub async fn fetch_target_profile(
    client: &reqwest::Client,
    api_key: &str,
    raw_token: &str,
) -> Result<TargetProfile, String> {
    let identity = resolve_target_identity(client, api_key, raw_token).await?;
    fetch_profile_games(client, api_key, identity).await
}

pub async fn fetch_owned_appids(
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

pub async fn fetch_family_group_id(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<String, String> {
    let data = request_json(
        client,
        "https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/",
        &[
            ("access_token", access_token),
            ("include_family_group_response", "true"),
        ],
    )
    .await?;
    let family_group_id = data
        .get("response")
        .and_then(|response| response.get("family_groupid"))
        .and_then(value_to_appid)
        .unwrap_or_default();

    if family_group_id.is_empty() {
        return Err(
            "无法获取家庭组 ID，请确认家庭库 access token 有效且账号已加入 Steam 家庭".to_string(),
        );
    }

    Ok(family_group_id)
}

pub async fn fetch_family_library(
    client: &reqwest::Client,
    access_token: &str,
    family_group_id: &str,
) -> Result<FamilyLibrary, String> {
    if family_group_id.trim().is_empty() {
        return Err("家庭组 ID 未填写".to_string());
    }

    let data = request_json(
        client,
        "https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/",
        &[
            ("access_token", access_token),
            ("family_groupid", family_group_id),
            ("include_own", "true"),
            ("include_excluded", "false"),
            ("include_non_games", "false"),
        ],
    )
    .await?;
    let apps = data
        .get("response")
        .and_then(|response| response.get("apps"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "家庭库为空或 Steam 家庭库接口未返回 apps".to_string())?;

    let mut games_by_id = HashMap::new();
    for app in apps {
        let exclude_reason = app
            .get("exclude_reason")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);
        if exclude_reason != 0 {
            continue;
        }
        let Some(appid) = app.get("appid").and_then(value_to_appid) else {
            continue;
        };
        let name = app
            .get("name")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("App {appid}"));
        let owners = app
            .get("owner_steamids")
            .and_then(serde_json::Value::as_array)
            .map(|owners| owners.iter().filter_map(value_to_appid).collect::<Vec<_>>())
            .unwrap_or_default();
        let acquired_at = app
            .get("rt_time_acquired")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0);

        games_by_id.insert(
            appid,
            FamilyGame {
                name,
                owners,
                acquired_at,
            },
        );
    }

    Ok(FamilyLibrary { games_by_id })
}

pub async fn fetch_store_item_enrichment(
    client: &reqwest::Client,
    appids: &[String],
    settings: &AppSettings,
) -> Result<HashMap<String, StoreItemEnrichment>, String> {
    let mut enrichment = HashMap::new();
    let unique_appids = appids
        .iter()
        .filter(|appid| appid.chars().all(|char| char.is_ascii_digit()))
        .cloned()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    for chunk in unique_appids.chunks(100) {
        let ids = chunk
            .iter()
            .filter_map(|appid| {
                appid
                    .parse::<u64>()
                    .ok()
                    .map(|appid| serde_json::json!({ "appid": appid }))
            })
            .collect::<Vec<_>>();
        if ids.is_empty() {
            continue;
        }

        let input = serde_json::json!({
            "ids": ids,
            "context": {
                "language": steam_store_language(settings.locale.as_str()),
                "country_code": normalized_store_country(settings.store_country.as_str())
            },
            "data_request": {
                "include_basic_info": false,
                "include_assets": true,
                "include_all_purchase_options": true,
                "include_tag_count": 0
            }
        })
        .to_string();
        let data = request_json(
            client,
            "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/",
            &[("input_json", input.as_str())],
        )
        .await?;
        let Some(items) = data
            .get("response")
            .and_then(|response| response.get("store_items"))
            .and_then(serde_json::Value::as_array)
        else {
            continue;
        };

        for item in items {
            if item
                .get("success")
                .and_then(serde_json::Value::as_i64)
                .is_some_and(|success| success != 1)
            {
                continue;
            }
            let Some(appid) = item.get("appid").and_then(value_to_appid) else {
                continue;
            };
            let cover_url = extract_store_card_cover_url(item);
            let price = normalize_store_item_original_price(item, settings);
            enrichment.insert(appid, StoreItemEnrichment { cover_url, price });
        }
    }

    Ok(enrichment)
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
    let success = response
        .get("success")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(0);
    let steamid64 = response
        .get("steamid")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    if success != 1 || !is_steamid64(steamid64) {
        return Err(format!("无法解析自定义 ID：{token}"));
    }

    Ok(TargetIdentity {
        steamid64: steamid64.to_string(),
        profile_url: format!("https://steamcommunity.com/id/{token}"),
        display_name: token,
    })
}

async fn fetch_profile_games(
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
        return Err(format!(
            "目标账号没有公开游戏库或游戏库为空：{}",
            identity.steamid64
        ));
    }

    let normalized_games = games
        .iter()
        .filter_map(normalize_target_game)
        .collect::<Vec<_>>();
    let sample_games = normalized_games
        .iter()
        .take(30)
        .cloned()
        .collect::<Vec<_>>();

    Ok(TargetProfile {
        steamid64: identity.steamid64,
        display_name: summary.display_name,
        profile_url: summary.profile_url,
        avatar: summary.avatar,
        game_count: games.len(),
        raw_game_count: games.len(),
        games: normalized_games,
        sample_games,
    })
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
            .and_then(|value| {
                value
                    .get("avatarfull")
                    .or_else(|| value.get("avatarmedium"))
                    .or_else(|| value.get("avatar"))
            })
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

async fn request_json(
    client: &reqwest::Client,
    url: &str,
    query: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let request_url = build_request_url(url, query)?;
    let response = client
        .get(request_url)
        .header(
            reqwest::header::ACCEPT,
            "application/json,text/javascript,*/*;q=0.1",
        )
        .send()
        .await
        .map_err(|error| {
            format!(
                "网络请求失败：{}",
                redact_secret(&format_error_chain(&error), query)
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Steam API 返回 HTTP {status}"));
    }
    response.json::<serde_json::Value>().await.map_err(|error| {
        format!(
            "Steam API 响应无法解析：{}",
            redact_secret(&format_error_chain(&error), query)
        )
    })
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

fn extract_store_card_cover_url(item: &serde_json::Value) -> String {
    extract_store_asset_url_from_item(
        item,
        &[
            "library_capsule",
            "library_capsule_2x",
            "main_capsule",
            "small_capsule",
            "header",
        ],
    )
}

fn normalize_store_item_original_price(
    item: &serde_json::Value,
    settings: &AppSettings,
) -> Option<PriceInfo> {
    let localized_name = item
        .get("name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let purchase_option = item.get("best_purchase_option")?;
    let initial = purchase_option
        .get("original_price_in_cents")
        .or_else(|| purchase_option.get("final_price_in_cents"))
        .and_then(value_to_i64)?;

    Some(PriceInfo {
        initial: Some(initial),
        currency: store_currency(settings.store_country.as_str()).to_string(),
        localized_name,
        source: "original".to_string(),
        is_free: initial <= 0,
        unavailable: false,
        history_low_at: String::new(),
    })
}

fn value_to_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
}

fn extract_store_asset_url_from_item(item: &serde_json::Value, asset_keys: &[&str]) -> String {
    let assets = item.get("assets").unwrap_or(&serde_json::Value::Null);
    let asset_url_format = assets
        .get("asset_url_format")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    if asset_url_format.trim().is_empty() {
        return String::new();
    }

    asset_keys
        .iter()
        .filter_map(|key| assets.get(*key).and_then(serde_json::Value::as_str))
        .map(|filename| build_store_item_asset_url(asset_url_format, filename))
        .find(|url| !url.is_empty())
        .unwrap_or_default()
}

fn build_store_item_asset_url(asset_url_format: &str, filename: &str) -> String {
    let normalized_format = asset_url_format.trim();
    let normalized_filename = filename.trim();
    if normalized_format.is_empty() || normalized_filename.is_empty() {
        return String::new();
    }
    format!(
        "{}{}",
        STORE_ITEM_ASSET_BASE_URL,
        normalized_format.replace("${FILENAME}", normalized_filename)
    )
}

fn steam_store_language(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "schinese",
        "en" => "english",
        _ => "schinese",
    }
}

fn normalized_store_country(country: &str) -> String {
    let normalized = country.trim().to_uppercase();
    if normalized.len() == 2 {
        normalized
    } else {
        "CN".to_string()
    }
}

fn store_currency(country: &str) -> &'static str {
    match normalized_store_country(country).as_str() {
        "US" => "USD",
        "CA" => "CAD",
        "MX" => "MXN",
        "BR" => "BRL",
        "GB" => "GBP",
        "JP" => "JPY",
        "KR" => "KRW",
        "CN" => "CNY",
        "TW" => "TWD",
        "HK" => "HKD",
        "SG" => "SGD",
        "AU" => "AUD",
        "NZ" => "NZD",
        "RU" => "RUB",
        "TR" => "TRY",
        "IN" => "INR",
        "ZA" => "ZAR",
        "PL" => "PLN",
        "NO" => "NOK",
        "SE" => "SEK",
        "DK" => "DKK",
        "CH" => "CHF",
        _ => "CNY",
    }
}

fn build_request_url(url: &str, query: &[(&str, &str)]) -> Result<reqwest::Url, String> {
    reqwest::Url::parse_with_params(url, query).map_err(|error| format!("请求 URL 无效：{error}"))
}

fn value_to_appid(value: &serde_json::Value) -> Option<String> {
    value.as_u64().map(|number| number.to_string()).or_else(|| {
        value
            .as_str()
            .filter(|text| text.chars().all(|char| char.is_ascii_digit()))
            .map(str::to_string)
    })
}

fn redact_secret(message: &str, query: &[(&str, &str)]) -> String {
    query
        .iter()
        .fold(message.to_string(), |text, (key, value)| {
            if (*key == "key" || *key == "access_token") && !value.is_empty() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_store_card_cover_url_uses_store_item_assets_like_script() {
        let item = serde_json::json!({
            "appid": 10,
            "success": 1,
            "assets": {
                "asset_url_format": "apps/10/${FILENAME}",
                "library_capsule": "library.jpg",
                "header": "header.jpg"
            }
        });

        assert_eq!(
            extract_store_card_cover_url(&item),
            "https://shared.fastly.steamstatic.com/store_item_assets/apps/10/library.jpg"
        );
    }

    #[test]
    fn normalize_store_item_original_price_uses_best_purchase_option() {
        let item = serde_json::json!({
            "name": "Example",
            "best_purchase_option": {
                "original_price_in_cents": "9900",
                "final_price_in_cents": "4950"
            }
        });
        let settings = AppSettings {
            steam_api_key: String::new(),
            itad_api_key: String::new(),
            current_steam_id64: String::new(),
            family_access_token: String::new(),
            family_group_id: String::new(),
            store_country: "CN".to_string(),
            locale: "zh-CN".to_string(),
            price_mode: "original".to_string(),
        };

        let price = normalize_store_item_original_price(&item, &settings).expect("price");

        assert_eq!(price.initial, Some(9900));
        assert_eq!(price.currency, "CNY");
        assert_eq!(price.localized_name, "Example");
        assert!(!price.unavailable);
    }
}
