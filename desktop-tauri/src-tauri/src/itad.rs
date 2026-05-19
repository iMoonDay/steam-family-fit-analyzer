use crate::models::{AppSettings, PriceInfo};
use std::{collections::HashMap, error::Error};

const ITAD_API_BASE_URL: &str = "https://api.isthereanydeal.com";
const ITAD_STEAM_SHOP_ID: i64 = 61;
const ITAD_PRICE_BATCH_SIZE: usize = 200;

pub async fn fetch_history_low_prices(
    client: &reqwest::Client,
    appids: &[String],
    settings: &AppSettings,
) -> Result<HashMap<String, PriceInfo>, String> {
    let api_key = settings.itad_api_key.trim();
    if api_key.is_empty() {
        return Err("史低模式需要 IsThereAnyDeal API Key".to_string());
    }

    let unique_appids = appids
        .iter()
        .map(|appid| appid.trim().to_string())
        .filter(|appid| appid.chars().all(|char| char.is_ascii_digit()))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut prices = unique_appids
        .iter()
        .map(|appid| (appid.clone(), unavailable_history_low_price(settings)))
        .collect::<HashMap<_, _>>();
    if unique_appids.is_empty() {
        return Ok(prices);
    }

    let lookup_input = unique_appids
        .iter()
        .map(|appid| format!("app/{appid}"))
        .collect::<Vec<_>>();
    let lookup_data = request_post_json(
        client,
        &format!("{ITAD_API_BASE_URL}/lookup/id/shop/{ITAD_STEAM_SHOP_ID}/v1"),
        &[("key", api_key)],
        &lookup_input,
    )
    .await?;
    let appid_to_itad_id = parse_itad_lookup_response(&lookup_data, &unique_appids);
    let mut itad_id_to_appids = HashMap::<String, Vec<String>>::new();
    for appid in &unique_appids {
        if let Some(itad_id) = appid_to_itad_id.get(appid) {
            itad_id_to_appids
                .entry(itad_id.clone())
                .or_default()
                .push(appid.clone());
        }
    }

    let itad_ids = itad_id_to_appids.keys().cloned().collect::<Vec<_>>();
    for chunk in itad_ids.chunks(ITAD_PRICE_BATCH_SIZE) {
        let price_data = request_post_json(
            client,
            &format!("{ITAD_API_BASE_URL}/games/storelow/v2"),
            &[
                (
                    "country",
                    normalized_store_country(settings.store_country.as_str()).as_str(),
                ),
                ("shops", ITAD_STEAM_SHOP_ID.to_string().as_str()),
                ("key", api_key),
            ],
            &chunk.to_vec(),
        )
        .await?;
        let low_by_id = parse_itad_store_low_response(&price_data);
        for itad_id in chunk {
            let price = normalize_history_low_price(low_by_id.get(itad_id), settings);
            for appid in itad_id_to_appids.get(itad_id).into_iter().flatten() {
                prices.insert(appid.clone(), price.clone());
            }
        }
    }

    Ok(prices)
}

async fn request_post_json<T: serde::Serialize>(
    client: &reqwest::Client,
    url: &str,
    query: &[(&str, &str)],
    body: &T,
) -> Result<serde_json::Value, String> {
    let request_url = reqwest::Url::parse_with_params(url, query).map_err(|error| {
        crate::error::AppError::DataFormat(format!("ITAD 请求 URL 无效：{error}")).user_message()
    })?;
    let response = client
        .post(request_url)
        .header(
            reqwest::header::ACCEPT,
            "application/json,text/javascript,*/*;q=0.1",
        )
        .json(body)
        .send()
        .await
        .map_err(|error| crate::error::AppError::from_reqwest(error, "ITAD API"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(crate::error::AppError::from_http_status(status, "ITAD API").user_message());
    }
    response.json::<serde_json::Value>().await.map_err(|error| {
        crate::error::AppError::DataFormat(format!(
            "ITAD 响应无法解析：{}",
            redact_secret(&format_error_chain(&error), query)
        ))
        .user_message()
    })
}

fn parse_itad_lookup_response(
    response: &serde_json::Value,
    appids: &[String],
) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let wanted = appids
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let rows = response.get("data").unwrap_or(response);

    if let Some(items) = rows.as_array() {
        for (index, item) in items.iter().enumerate() {
            let appid = extract_appid_from_itad_lookup_item(item)
                .or_else(|| appids.get(index).cloned())
                .unwrap_or_default();
            let itad_id = extract_itad_game_id(item);
            if wanted.contains(appid.as_str()) && !itad_id.is_empty() {
                result.insert(appid, itad_id);
            }
        }
        return result;
    }

    if let Some(items) = rows.as_object() {
        for (key, item) in items {
            let appid = key.strip_prefix("app/").unwrap_or(key).to_string();
            let itad_id = extract_itad_game_id(item);
            if wanted.contains(appid.as_str()) && !itad_id.is_empty() {
                result.insert(appid, itad_id);
            }
        }
    }

    result
}

fn parse_itad_store_low_response(
    response: &serde_json::Value,
) -> HashMap<String, serde_json::Value> {
    let source = response.get("data").unwrap_or(response);
    let mut result = HashMap::new();

    if let Some(items) = source.as_array() {
        for item in items {
            let id = extract_store_low_id("", item);
            if !id.is_empty() {
                result.insert(id, item.clone());
            }
        }
        return result;
    }

    if let Some(items) = source.as_object() {
        for (key, item) in items {
            let id = extract_store_low_id(key, item);
            if !id.is_empty() {
                result.insert(id, item.clone());
            }
        }
    }

    result
}

fn normalize_history_low_price(
    item: Option<&serde_json::Value>,
    settings: &AppSettings,
) -> PriceInfo {
    let low = item.and_then(select_itad_steam_low);
    let initial = low.and_then(|low| low.get("price")).and_then(|price| {
        price
            .get("amountInt")
            .and_then(value_to_i64)
            .or_else(|| price.get("amount").and_then(value_to_amount_cents))
    });

    if let Some(initial) = initial {
        return PriceInfo {
            initial: Some(initial),
            currency: low
                .and_then(|low| low.get("price"))
                .and_then(|price| price.get("currency"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_else(|| store_currency(settings.store_country.as_str()))
                .to_string(),
            localized_name: String::new(),
            source: "itadStoreLow".to_string(),
            is_free: initial <= 0,
            unavailable: false,
            history_low_at: low
                .and_then(|low| low.get("timestamp"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_string(),
        };
    }

    unavailable_history_low_price(settings)
}

fn unavailable_history_low_price(settings: &AppSettings) -> PriceInfo {
    PriceInfo {
        initial: None,
        currency: store_currency(settings.store_country.as_str()).to_string(),
        localized_name: String::new(),
        source: "itadStoreLow".to_string(),
        is_free: false,
        unavailable: true,
        history_low_at: String::new(),
    }
}

fn select_itad_steam_low(item: &serde_json::Value) -> Option<&serde_json::Value> {
    let lows = item
        .get("lows")
        .and_then(serde_json::Value::as_array)
        .or_else(|| item.get("low").and_then(serde_json::Value::as_array));

    if let Some(lows) = lows {
        return lows
            .iter()
            .find(|low| {
                low.get("shop")
                    .and_then(|shop| shop.get("id").or(Some(shop)))
                    .or_else(|| low.get("shopId"))
                    .or_else(|| low.get("shop"))
                    .and_then(value_to_i64)
                    .is_some_and(|shop_id| shop_id == ITAD_STEAM_SHOP_ID)
            })
            .or_else(|| lows.first());
    }

    item.get("low").filter(|low| low.is_object()).or(Some(item))
}

fn extract_appid_from_itad_lookup_item(item: &serde_json::Value) -> Option<String> {
    [
        item.get("shop").and_then(|shop| shop.get("id")),
        item.get("shopId"),
        item.get("shop_id"),
        item.get("id"),
        item.get("uid"),
        item.get("input"),
        item.get("plain"),
        item.get("shop").and_then(|shop| shop.get("plain")),
    ]
    .into_iter()
    .flatten()
    .find_map(extract_trailing_digits)
}

fn extract_itad_game_id(item: &serde_json::Value) -> String {
    if let Some(text) = item.as_str() {
        return if is_likely_itad_game_id(text) {
            text.trim().to_string()
        } else {
            String::new()
        };
    }

    [
        item.get("game").and_then(|game| game.get("id")),
        item.get("game_id"),
        item.get("gameId"),
        item.get("id"),
        item.get("uuid"),
    ]
    .into_iter()
    .flatten()
    .find_map(|value| value.as_str().filter(|text| is_likely_itad_game_id(text)))
    .unwrap_or("")
    .to_string()
}

fn extract_store_low_id(key: &str, item: &serde_json::Value) -> String {
    [
        item.get("id"),
        item.get("game").and_then(|game| game.get("id")),
        item.get("game_id"),
    ]
    .into_iter()
    .flatten()
    .filter_map(serde_json::Value::as_str)
    .chain(std::iter::once(key))
    .find(|value| !value.trim().is_empty())
    .unwrap_or("")
    .trim()
    .to_string()
}

fn extract_trailing_digits(value: &serde_json::Value) -> Option<String> {
    let text = value.as_str().map(str::to_string).or_else(|| {
        value
            .as_u64()
            .map(|number| number.to_string())
            .or_else(|| value.as_i64().map(|number| number.to_string()))
    })?;
    let digits = text
        .rsplit_once('/')
        .map(|(_, suffix)| suffix)
        .unwrap_or(text.as_str());
    digits
        .chars()
        .all(|char| char.is_ascii_digit())
        .then(|| digits.to_string())
}

fn is_likely_itad_game_id(value: &str) -> bool {
    let text = value.trim();
    !text.is_empty() && !text.starts_with("app/") && !text.chars().all(|char| char.is_ascii_digit())
}

fn value_to_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
}

fn value_to_amount_cents(value: &serde_json::Value) -> Option<i64> {
    let amount = value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))?;
    amount.is_finite().then(|| (amount * 100.0).round() as i64)
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

fn redact_secret(message: &str, query: &[(&str, &str)]) -> String {
    query
        .iter()
        .fold(message.to_string(), |text, (key, value)| {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lookup_accepts_array_shape_like_script() {
        let response = serde_json::json!({
            "data": [
                { "shop": { "id": "app/10" }, "game": { "id": "018d-test" } },
                { "input": "app/20", "gameId": "019d-test" }
            ]
        });
        let result = parse_itad_lookup_response(&response, &["10".to_string(), "20".to_string()]);

        assert_eq!(result.get("10").map(String::as_str), Some("018d-test"));
        assert_eq!(result.get("20").map(String::as_str), Some("019d-test"));
    }

    #[test]
    fn normalize_history_low_price_selects_steam_shop_low() {
        let item = serde_json::json!({
            "lows": [
                { "shop": { "id": 1 }, "price": { "amountInt": 1200, "currency": "CNY" } },
                { "shopId": 61, "price": { "amount": 9.9, "currency": "CNY" }, "timestamp": "2024-01-02T00:00:00Z" }
            ]
        });
        let settings = AppSettings {
            steam_api_key: String::new(),
            itad_api_key: String::new(),
            current_steam_id64: String::new(),
            family_access_token: String::new(),
            family_group_id: String::new(),
            store_country: "CN".to_string(),
            locale: "zh-CN".to_string(),
            price_mode: "historyLow".to_string(),
            cache_directory: String::new(),
            config_directory: String::new(),
        };

        let price = normalize_history_low_price(Some(&item), &settings);

        assert_eq!(price.initial, Some(990));
        assert_eq!(price.source, "itadStoreLow");
        assert_eq!(price.history_low_at, "2024-01-02T00:00:00Z");
        assert!(!price.unavailable);
    }
}
