use crate::{
    input::is_steamid64,
    models::{
        AutoSteamConfigResult, SteamGuardConfirmation, SteamLoginRefreshResult,
        SteamPasswordLoginResult, SteamQrLoginPollResult, SteamQrLoginSession,
    },
    steam,
};
use base64::{engine::general_purpose, Engine as _};
use prost::Message;
use rand::{distributions::Alphanumeric, rngs::OsRng, Rng};
use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, COOKIE, REFERER};
use rsa::{BigUint, Pkcs1v15Encrypt, RsaPublicKey};
use serde::Deserialize;

const BEGIN_QR_URL: &str =
    "https://api.steampowered.com/IAuthenticationService/BeginAuthSessionViaQR/v1/";
const POLL_QR_URL: &str =
    "https://api.steampowered.com/IAuthenticationService/PollAuthSessionStatus/v1/";
const GET_PASSWORD_RSA_URL: &str =
    "https://api.steampowered.com/IAuthenticationService/GetPasswordRSAPublicKey/v1/";
const BEGIN_CREDENTIALS_URL: &str =
    "https://api.steampowered.com/IAuthenticationService/BeginAuthSessionViaCredentials/v1/";
const UPDATE_GUARD_URL: &str =
    "https://api.steampowered.com/IAuthenticationService/UpdateAuthSessionWithSteamGuardCode/v1/";
const REFRESH_ACCESS_TOKEN_URL: &str =
    "https://api.steampowered.com/IAuthenticationService/GenerateAccessTokenForApp/v1/";
const EAUTH_TOKEN_PLATFORM_TYPE_WEB_BROWSER: i32 = 2;
const EAUTH_SESSION_PERSISTENCE_PERSISTENT: i32 = 1;
const STEAM_QR_OS_TYPE_WINDOWS: i32 = 20;

pub async fn begin_qr_login(client: &reqwest::Client) -> Result<SteamQrLoginSession, String> {
    let response = request_form_protobuf::<_, BeginAuthSessionViaQrResponse>(
        client,
        BEGIN_QR_URL,
        BeginAuthSessionViaQrRequest {
            device_friendly_name: Some("Steam Family Fit Analyzer".to_string()),
            platform_type: Some(EAUTH_TOKEN_PLATFORM_TYPE_WEB_BROWSER),
            device_details: Some(AuthenticationDeviceDetails {
                device_friendly_name: Some("Steam Family Fit Analyzer".to_string()),
                platform_type: Some(EAUTH_TOKEN_PLATFORM_TYPE_WEB_BROWSER),
                os_type: Some(STEAM_QR_OS_TYPE_WINDOWS),
                ..Default::default()
            }),
            website_id: Some("Client".to_string()),
        },
    )
    .await?;

    let client_id = response.client_id.unwrap_or_default();
    let request_id = response.request_id;
    let challenge_url = response.challenge_url.unwrap_or_default();
    if client_id == 0 || request_id.is_empty() || challenge_url.trim().is_empty() {
        return Err("Steam 二维码登录初始化返回缺少必要字段".to_string());
    }

    Ok(SteamQrLoginSession {
        client_id: client_id.to_string(),
        request_id: general_purpose::STANDARD.encode(request_id),
        challenge_url,
        interval_seconds: interval_seconds(response.interval),
    })
}

pub async fn poll_qr_login(
    client: &reqwest::Client,
    client_id: &str,
    request_id: &str,
) -> Result<SteamQrLoginPollResult, String> {
    poll_login_session(
        client,
        client_id,
        request_id,
        "waiting_scan",
        "等待手机 Steam 扫码",
        "Steam 已收到扫码，请在手机端确认登录",
    )
    .await
}

pub async fn begin_password_login(
    client: &reqwest::Client,
    account_name: &str,
    password: &str,
) -> Result<SteamPasswordLoginResult, String> {
    let account_name = account_name.trim();
    if account_name.is_empty() || password.is_empty() {
        return Err("Steam 账号或密码未填写".to_string());
    }

    let rsa_key = request_form_protobuf::<_, GetPasswordRsaPublicKeyResponse>(
        client,
        GET_PASSWORD_RSA_URL,
        GetPasswordRsaPublicKeyRequest {
            account_name: Some(account_name.to_string()),
        },
    )
    .await?;
    let encrypted_password = encrypt_password(
        password,
        &rsa_key.publickey_mod.unwrap_or_default(),
        &rsa_key.publickey_exp.unwrap_or_default(),
    )?;
    let encryption_timestamp = rsa_key.timestamp.unwrap_or_default();
    if encryption_timestamp == 0 {
        return Err("Steam 登录未返回密码加密时间戳".to_string());
    }

    let response = request_form_protobuf::<_, BeginAuthSessionViaCredentialsResponse>(
        client,
        BEGIN_CREDENTIALS_URL,
        BeginAuthSessionViaCredentialsRequest {
            device_friendly_name: Some("Steam Family Fit Analyzer".to_string()),
            account_name: Some(account_name.to_string()),
            encrypted_password: Some(encrypted_password),
            encryption_timestamp: Some(encryption_timestamp),
            remember_login: Some(true),
            platform_type: Some(EAUTH_TOKEN_PLATFORM_TYPE_WEB_BROWSER),
            persistence: Some(EAUTH_SESSION_PERSISTENCE_PERSISTENT),
            website_id: Some("Community".to_string()),
            device_details: Some(AuthenticationDeviceDetails {
                device_friendly_name: Some("Steam Family Fit Analyzer".to_string()),
                platform_type: Some(EAUTH_TOKEN_PLATFORM_TYPE_WEB_BROWSER),
                os_type: Some(STEAM_QR_OS_TYPE_WINDOWS),
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .await?;

    let client_id = response.client_id.unwrap_or_default();
    let request_id = response.request_id;
    if let Some(message) = response
        .extended_error_message
        .filter(|message| !message.trim().is_empty())
    {
        return Err(message);
    }
    if client_id == 0 || request_id.is_empty() {
        return Err("Steam 账号密码登录初始化返回缺少必要字段".to_string());
    }

    let request_id = general_purpose::STANDARD.encode(request_id);
    let allowed_confirmations = map_allowed_confirmations(response.allowed_confirmations);
    if !allowed_confirmations.is_empty() {
        return Ok(SteamPasswordLoginResult {
            status: "guard_required".to_string(),
            steamid64: response
                .steamid
                .filter(|steamid| *steamid != 0)
                .map(|steamid| steamid.to_string())
                .unwrap_or_default(),
            account_name: account_name.to_string(),
            access_token: String::new(),
            refresh_token: String::new(),
            access_token_expires_at: None,
            client_id: client_id.to_string(),
            request_id,
            interval_seconds: interval_seconds(response.interval),
            allowed_confirmations,
            message: "需要 Steam Guard".to_string(),
        });
    }

    poll_password_login(client, &client_id.to_string(), &request_id).await
}

pub async fn poll_password_login(
    client: &reqwest::Client,
    client_id: &str,
    request_id: &str,
) -> Result<SteamPasswordLoginResult, String> {
    let result = poll_login_session(
        client,
        client_id,
        request_id,
        "waiting_confirmation",
        "等待登录确认",
        "请完成登录确认",
    )
    .await?;
    Ok(password_result_from_poll(
        result,
        client_id,
        request_id,
        Vec::new(),
    ))
}

pub async fn submit_password_login_guard(
    client: &reqwest::Client,
    client_id: &str,
    request_id: &str,
    steamid64: &str,
    code: &str,
    code_type: &str,
) -> Result<SteamPasswordLoginResult, String> {
    if client_id.trim().is_empty() || request_id.trim().is_empty() || steamid64.trim().is_empty() {
        return Err("Steam 登录会话不完整".to_string());
    }
    let guard_code_type = guard_type_to_steam_value(code_type)?;
    let code = code.trim();
    if requires_guard_code(code_type) && code.is_empty() {
        return Err("Steam Guard 验证码未填写".to_string());
    }

    let client_id_value = client_id
        .trim()
        .parse::<u64>()
        .map_err(|_| "Steam 登录会话 client_id 格式无效".to_string())?;
    let steamid64_value = steamid64
        .trim()
        .parse::<u64>()
        .map_err(|_| "SteamID64 格式无效".to_string())?;
    request_form_protobuf::<_, UpdateAuthSessionWithSteamGuardCodeResponse>(
        client,
        UPDATE_GUARD_URL,
        UpdateAuthSessionWithSteamGuardCodeRequest {
            client_id: Some(client_id_value),
            steamid: Some(steamid64_value),
            code: Some(code.to_string()),
            code_type: Some(guard_code_type),
        },
    )
    .await?;

    poll_password_login(client, client_id, request_id).await
}

async fn poll_login_session(
    client: &reqwest::Client,
    client_id: &str,
    request_id: &str,
    pending_status: &str,
    pending_message: &str,
    remote_message: &str,
) -> Result<SteamQrLoginPollResult, String> {
    if client_id.trim().is_empty() || request_id.trim().is_empty() {
        return Err("Steam 登录会话缺少 client_id 或 request_id".to_string());
    }

    let client_id = client_id
        .trim()
        .parse::<u64>()
        .map_err(|_| "Steam 登录会话 client_id 格式无效".to_string())?;
    let request_id = general_purpose::STANDARD
        .decode(request_id.trim())
        .map_err(|_| "Steam 登录会话 request_id 格式无效".to_string())?;
    let response = request_form_protobuf::<_, PollAuthSessionStatusResponse>(
        client,
        POLL_QR_URL,
        PollAuthSessionStatusRequest {
            client_id: Some(client_id),
            request_id,
            token_to_revoke: None,
        },
    )
    .await?;

    let access_token = response.access_token.unwrap_or_default();
    let refresh_token = response.refresh_token.unwrap_or_default();
    let steamid64 = access_token_steamid64(&access_token).unwrap_or_default();
    let account_name = response.account_name.unwrap_or_default();
    let access_token_expires_at = access_token_expires_at(&access_token);
    let status = if !access_token.is_empty() && !refresh_token.is_empty() {
        "confirmed"
    } else if response.had_remote_interaction.unwrap_or(false) {
        "waiting_confirmation"
    } else {
        pending_status
    };
    let message = match status {
        "confirmed" => "已登录".to_string(),
        "waiting_confirmation" => remote_message.to_string(),
        _ => pending_message.to_string(),
    };

    Ok(SteamQrLoginPollResult {
        status: status.to_string(),
        steamid64,
        account_name,
        access_token,
        refresh_token,
        access_token_expires_at,
        message,
    })
}

pub async fn fetch_family_config_from_login(
    client: &reqwest::Client,
    steamid64: &str,
    access_token: &str,
) -> Result<AutoSteamConfigResult, String> {
    if !is_steamid64(steamid64) || access_token.trim().is_empty() {
        return Err("Steam 登录态缺少 SteamID64 或 access token".to_string());
    }

    let sessionid = random_sessionid();
    let html = client
        .get("https://store.steampowered.com/account/familymanagement")
        .header(
            ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .header(REFERER, "https://store.steampowered.com/")
        .header(
            COOKIE,
            steam_login_cookie(steamid64, access_token, &sessionid),
        )
        .send()
        .await
        .map_err(|error| crate::error::AppError::from_reqwest(error, "Steam 家庭管理页"))?;
    let status = html.status();
    if !status.is_success() {
        return Err(
            crate::error::AppError::from_http_status(status, "Steam 家庭管理页").user_message(),
        );
    }
    let html = html.text().await.map_err(|error| {
        crate::error::AppError::DataFormat(format!("Steam 家庭管理页无法读取：{error}"))
            .user_message()
    })?;
    let family_access_token = extract_json_attribute(&html, "data-store_user_config")
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| {
            value
                .get("webapi_token")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();

    if family_access_token.is_empty() {
        return Err("Steam 登录 API 已确认，但家庭管理页未返回家庭库 webapi_token".to_string());
    }

    let family_group_id = match steam::fetch_family_group_id(client, &family_access_token).await {
        Ok(family_group_id) => family_group_id,
        Err(error) => {
            return Ok(AutoSteamConfigResult {
                access_token: family_access_token,
                current_steam_id64: steamid64.to_string(),
                family_group_id: String::new(),
                messages: vec![
                    "已通过 Steam 登录 API 获取家庭库 Access Token".to_string(),
                    format!("家庭组 ID 获取失败：{error}"),
                ],
            });
        }
    };

    Ok(AutoSteamConfigResult {
        access_token: family_access_token,
        current_steam_id64: steamid64.to_string(),
        family_group_id,
        messages: vec!["已通过 Steam 登录 API 获取家庭库配置".to_string()],
    })
}

pub async fn fetch_steam_api_key_from_login(
    client: &reqwest::Client,
    steamid64: &str,
    access_token: &str,
) -> Result<Option<String>, String> {
    if !is_steamid64(steamid64) || access_token.trim().is_empty() {
        return Err("Steam 登录态缺少 SteamID64 或 access token".to_string());
    }

    let sessionid = random_sessionid();
    let html = client
        .get("https://steamcommunity.com/dev/apikey")
        .header(
            ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .header(REFERER, "https://steamcommunity.com/dev/")
        .header(
            COOKIE,
            steam_login_cookie(steamid64, access_token, &sessionid),
        )
        .send()
        .await
        .map_err(|error| crate::error::AppError::from_reqwest(error, "Steam Web API Key 页面"))?;
    let status = html.status();
    if !status.is_success() {
        return Err(
            crate::error::AppError::from_http_status(status, "Steam Web API Key 页面")
                .user_message(),
        );
    }
    let html = html.text().await.map_err(|error| {
        crate::error::AppError::DataFormat(format!("Steam Web API Key 页面无法读取：{error}"))
            .user_message()
    })?;
    Ok(extract_steam_web_api_key(&html))
}

pub async fn refresh_access_token(
    client: &reqwest::Client,
    steamid64: &str,
    refresh_token: &str,
) -> Result<SteamLoginRefreshResult, String> {
    if !is_steamid64(steamid64) || refresh_token.trim().is_empty() {
        return Err("Steam 登录缓存缺少 SteamID64 或 refresh token".to_string());
    }

    let response = client
        .post(REFRESH_ACCESS_TOKEN_URL)
        .header(ACCEPT, "application/json")
        .form(&[
            ("refresh_token", refresh_token.trim()),
            ("steamid", steamid64.trim()),
        ])
        .send()
        .await
        .map_err(|error| crate::error::AppError::from_reqwest(error, "Steam 登录刷新"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(
            crate::error::AppError::from_http_status(status, "Steam 登录刷新").user_message(),
        );
    }
    let response = response
        .json::<RefreshAccessTokenResponse>()
        .await
        .map_err(|error| {
            crate::error::AppError::DataFormat(format!("Steam 登录刷新返回格式无法解析：{error}"))
                .user_message()
        })?;

    let access_token = response.response.access_token.unwrap_or_default();
    let next_refresh_token = response
        .response
        .refresh_token
        .filter(|token| !token.trim().is_empty())
        .unwrap_or_else(|| refresh_token.to_string());
    if access_token.trim().is_empty() {
        return Err("Steam 登录刷新未返回 access token".to_string());
    }

    Ok(SteamLoginRefreshResult {
        steamid64: steamid64.to_string(),
        access_token: access_token.clone(),
        refresh_token: next_refresh_token,
        access_token_expires_at: access_token_expires_at(&access_token),
    })
}

async fn request_form_protobuf<I, O>(
    client: &reqwest::Client,
    url: &str,
    input: I,
) -> Result<O, String>
where
    I: Message,
    O: Message + Default,
{
    let input_protobuf_encoded = general_purpose::STANDARD.encode(input.encode_to_vec());
    let response = client
        .post(url)
        .header(ACCEPT, "application/octet-stream,application/x-protobuf")
        .form(&[("input_protobuf_encoded", input_protobuf_encoded)])
        .send()
        .await
        .map_err(|error| crate::error::AppError::from_reqwest(error, "Steam 登录 API"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(
            crate::error::AppError::from_http_status(status, "Steam 登录 API").user_message(),
        );
    }
    if let Some(eresult) = response.headers().get("x-eresult") {
        let eresult = eresult.to_str().unwrap_or_default().trim();
        if !eresult.is_empty() && eresult != "0" && eresult != "1" {
            return Err(steam_eresult_message(eresult));
        }
    }
    let bytes = response.bytes().await.map_err(|error| {
        crate::error::AppError::DataFormat(format!("Steam 登录 API 返回无法读取：{error}"))
            .user_message()
    })?;
    O::decode(bytes).map_err(|error| {
        crate::error::AppError::DataFormat(format!("Steam 登录 API protobuf 返回无法解析：{error}"))
            .user_message()
    })
}

fn encrypt_password(
    password: &str,
    publickey_mod: &str,
    publickey_exp: &str,
) -> Result<String, String> {
    let modulus = BigUint::from_bytes_be(&hex_to_bytes(publickey_mod)?);
    let exponent = BigUint::from_bytes_be(&hex_to_bytes(publickey_exp)?);
    let public_key = RsaPublicKey::new(modulus, exponent)
        .map_err(|error| format!("Steam 密码公钥无效：{error}"))?;
    let encrypted = public_key
        .encrypt(&mut OsRng, Pkcs1v15Encrypt, password.as_bytes())
        .map_err(|error| format!("Steam 密码加密失败：{error}"))?;
    Ok(general_purpose::STANDARD.encode(encrypted))
}

fn hex_to_bytes(value: &str) -> Result<Vec<u8>, String> {
    let value = value.trim();
    if value.is_empty() || value.len() % 2 != 0 {
        return Err("Steam 密码公钥格式无效".to_string());
    }

    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| "Steam 密码公钥格式无效".to_string())
        })
        .collect()
}

fn password_result_from_poll(
    result: SteamQrLoginPollResult,
    client_id: &str,
    request_id: &str,
    allowed_confirmations: Vec<SteamGuardConfirmation>,
) -> SteamPasswordLoginResult {
    SteamPasswordLoginResult {
        status: result.status,
        steamid64: result.steamid64,
        account_name: result.account_name,
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        access_token_expires_at: result.access_token_expires_at,
        client_id: client_id.to_string(),
        request_id: request_id.to_string(),
        interval_seconds: 5,
        allowed_confirmations,
        message: result.message,
    }
}

fn map_allowed_confirmations(
    confirmations: Vec<AllowedConfirmation>,
) -> Vec<SteamGuardConfirmation> {
    confirmations
        .into_iter()
        .filter_map(|confirmation| {
            let confirmation_type = guard_type_from_steam_value(confirmation.confirmation_type?)?;
            Some(SteamGuardConfirmation {
                confirmation_type: confirmation_type.to_string(),
                message: confirmation.associated_message.unwrap_or_default(),
            })
        })
        .collect()
}

fn guard_type_from_steam_value(value: i32) -> Option<&'static str> {
    match value {
        2 => Some("email_code"),
        3 => Some("device_code"),
        4 => Some("device_confirmation"),
        5 => Some("email_confirmation"),
        6 => Some("machine_token"),
        7 => Some("legacy_machine_auth"),
        _ => None,
    }
}

fn guard_type_to_steam_value(value: &str) -> Result<i32, String> {
    match value {
        "email_code" => Ok(2),
        "device_code" => Ok(3),
        "device_confirmation" => Ok(4),
        "email_confirmation" => Ok(5),
        "machine_token" => Ok(6),
        "legacy_machine_auth" => Ok(7),
        _ => Err("Steam Guard 验证方式无效".to_string()),
    }
}

fn requires_guard_code(value: &str) -> bool {
    matches!(
        value,
        "email_code" | "device_code" | "machine_token" | "legacy_machine_auth"
    )
}

fn steam_eresult_message(eresult: &str) -> String {
    match eresult {
        "5" => "Steam 账号或密码错误".to_string(),
        "63" => "Steam Guard 验证码错误".to_string(),
        "65" => "Steam Guard 验证码错误".to_string(),
        "84" => "Steam 请求过于频繁，请稍后再试".to_string(),
        _ => format!("Steam 登录失败（EResult {eresult}）"),
    }
}

fn random_sessionid() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn steam_login_cookie(steamid64: &str, access_token: &str, sessionid: &str) -> String {
    let steam_login_secure = format!("{steamid64}%7C%7C{access_token}");
    format!("steamLoginSecure={steam_login_secure}; sessionid={sessionid}; timezoneOffset=28800,0")
}

fn access_token_expires_at(access_token: &str) -> Option<i64> {
    let payload = access_token.split('.').nth(1)?;
    let decoded = general_purpose::URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;
    value.get("exp")?.as_i64()
}

fn access_token_steamid64(access_token: &str) -> Option<String> {
    let payload = access_token.split('.').nth(1)?;
    let decoded = general_purpose::URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value = serde_json::from_slice::<serde_json::Value>(&decoded).ok()?;
    let steamid64 = value.get("sub")?.as_str()?.to_string();
    is_steamid64(&steamid64).then_some(steamid64)
}

fn interval_seconds(interval: Option<f32>) -> u64 {
    match interval {
        Some(value) if value.is_finite() && value > 0.0 => value.ceil() as u64,
        _ => 5,
    }
}

fn extract_json_attribute(html: &str, attr: &str) -> Option<String> {
    let double = extract_attribute(html, attr, '"');
    let single = extract_attribute(html, attr, '\'');
    double.or(single).map(|value| decode_html_entities(&value))
}

fn extract_attribute(html: &str, attr: &str, quote: char) -> Option<String> {
    let pattern = format!("{attr}={quote}");
    let start = html.find(&pattern)? + pattern.len();
    let rest = &html[start..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&#x22;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn extract_steam_web_api_key(html: &str) -> Option<String> {
    if !html.contains("/dev/revokekey") && !html.contains("revoke") {
        return None;
    }

    let text = decode_html_entities(&strip_html_tags(html));
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .find(|part| part.len() == 32 && part.chars().all(|ch| ch.is_ascii_hexdigit()))
        .map(str::to_string)
}

fn strip_html_tags(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                output.push(' ');
            }
            '>' => {
                in_tag = false;
                output.push(' ');
            }
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output
}

#[derive(Clone, PartialEq, Message)]
struct AuthenticationDeviceDetails {
    #[prost(string, optional, tag = "1")]
    device_friendly_name: Option<String>,
    #[prost(int32, optional, tag = "2")]
    platform_type: Option<i32>,
    #[prost(int32, optional, tag = "3")]
    os_type: Option<i32>,
    #[prost(uint32, optional, tag = "4")]
    gaming_device_type: Option<u32>,
}

#[derive(Clone, PartialEq, Message)]
struct GetPasswordRsaPublicKeyRequest {
    #[prost(string, optional, tag = "1")]
    account_name: Option<String>,
}

#[derive(Clone, PartialEq, Message)]
struct GetPasswordRsaPublicKeyResponse {
    #[prost(string, optional, tag = "1")]
    publickey_mod: Option<String>,
    #[prost(string, optional, tag = "2")]
    publickey_exp: Option<String>,
    #[prost(uint64, optional, tag = "3")]
    timestamp: Option<u64>,
}

#[derive(Clone, PartialEq, Message)]
struct BeginAuthSessionViaQrRequest {
    #[prost(string, optional, tag = "1")]
    device_friendly_name: Option<String>,
    #[prost(int32, optional, tag = "2")]
    platform_type: Option<i32>,
    #[prost(message, optional, tag = "3")]
    device_details: Option<AuthenticationDeviceDetails>,
    #[prost(string, optional, tag = "4")]
    website_id: Option<String>,
}

#[derive(Clone, PartialEq, Message)]
struct BeginAuthSessionViaQrResponse {
    #[prost(uint64, optional, tag = "1")]
    client_id: Option<u64>,
    #[prost(string, optional, tag = "2")]
    challenge_url: Option<String>,
    #[prost(bytes = "vec", tag = "3")]
    request_id: Vec<u8>,
    #[prost(float, optional, tag = "4")]
    interval: Option<f32>,
}

#[derive(Clone, PartialEq, Message)]
struct BeginAuthSessionViaCredentialsRequest {
    #[prost(string, optional, tag = "1")]
    device_friendly_name: Option<String>,
    #[prost(string, optional, tag = "2")]
    account_name: Option<String>,
    #[prost(string, optional, tag = "3")]
    encrypted_password: Option<String>,
    #[prost(uint64, optional, tag = "4")]
    encryption_timestamp: Option<u64>,
    #[prost(bool, optional, tag = "5")]
    remember_login: Option<bool>,
    #[prost(int32, optional, tag = "6")]
    platform_type: Option<i32>,
    #[prost(int32, optional, tag = "7")]
    persistence: Option<i32>,
    #[prost(string, optional, tag = "8")]
    website_id: Option<String>,
    #[prost(message, optional, tag = "9")]
    device_details: Option<AuthenticationDeviceDetails>,
    #[prost(bytes = "vec", tag = "10")]
    guard_data: Vec<u8>,
    #[prost(uint32, optional, tag = "11")]
    language: Option<u32>,
    #[prost(int32, optional, tag = "12")]
    qos_level: Option<i32>,
}

#[derive(Clone, PartialEq, Message)]
struct AllowedConfirmation {
    #[prost(int32, optional, tag = "1")]
    confirmation_type: Option<i32>,
    #[prost(string, optional, tag = "2")]
    associated_message: Option<String>,
}

#[derive(Clone, PartialEq, Message)]
struct BeginAuthSessionViaCredentialsResponse {
    #[prost(uint64, optional, tag = "1")]
    client_id: Option<u64>,
    #[prost(bytes = "vec", tag = "2")]
    request_id: Vec<u8>,
    #[prost(float, optional, tag = "3")]
    interval: Option<f32>,
    #[prost(message, repeated, tag = "4")]
    allowed_confirmations: Vec<AllowedConfirmation>,
    #[prost(fixed64, optional, tag = "5")]
    steamid: Option<u64>,
    #[prost(string, optional, tag = "6")]
    weak_token: Option<String>,
    #[prost(string, optional, tag = "8")]
    extended_error_message: Option<String>,
}

#[derive(Clone, PartialEq, Message)]
struct UpdateAuthSessionWithSteamGuardCodeRequest {
    #[prost(uint64, optional, tag = "1")]
    client_id: Option<u64>,
    #[prost(fixed64, optional, tag = "2")]
    steamid: Option<u64>,
    #[prost(string, optional, tag = "3")]
    code: Option<String>,
    #[prost(int32, optional, tag = "4")]
    code_type: Option<i32>,
}

#[derive(Clone, PartialEq, Message)]
struct UpdateAuthSessionWithSteamGuardCodeResponse {}

#[derive(Clone, PartialEq, Message)]
struct PollAuthSessionStatusRequest {
    #[prost(uint64, optional, tag = "1")]
    client_id: Option<u64>,
    #[prost(bytes = "vec", tag = "2")]
    request_id: Vec<u8>,
    #[prost(fixed64, optional, tag = "3")]
    token_to_revoke: Option<u64>,
}

#[derive(Clone, PartialEq, Message)]
struct PollAuthSessionStatusResponse {
    #[prost(uint64, optional, tag = "1")]
    new_client_id: Option<u64>,
    #[prost(string, optional, tag = "2")]
    new_challenge_url: Option<String>,
    #[prost(string, optional, tag = "3")]
    refresh_token: Option<String>,
    #[prost(string, optional, tag = "4")]
    access_token: Option<String>,
    #[prost(bool, optional, tag = "5")]
    had_remote_interaction: Option<bool>,
    #[prost(string, optional, tag = "6")]
    account_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RefreshAccessTokenResponse {
    response: RefreshAccessTokenBody,
}

#[derive(Debug, Deserialize)]
struct RefreshAccessTokenBody {
    access_token: Option<String>,
    refresh_token: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_access_token_expiry() {
        let token = "header.eyJleHAiOjE3MDAwMDAwMDAsInN1YiI6Ijc2NTYxMTk5OTk5OTk5OTk5In0.signature";
        assert_eq!(access_token_expires_at(token), Some(1_700_000_000));
    }

    #[test]
    fn parses_steamid64_from_access_token_subject() {
        let token = "header.eyJleHAiOjE3MDAwMDAwMDAsInN1YiI6Ijc2NTYxMTk5OTk5OTk5OTk5In0.signature";
        assert_eq!(
            access_token_steamid64(token).as_deref(),
            Some("76561199999999999")
        );
    }

    #[test]
    fn encodes_poll_request_id_as_protobuf_bytes() {
        let request_id = vec![1, 2, 3, 4];
        let request = PollAuthSessionStatusRequest {
            client_id: Some(42),
            request_id: request_id.clone(),
            token_to_revoke: None,
        };
        let decoded = PollAuthSessionStatusRequest::decode(request.encode_to_vec().as_slice())
            .expect("poll request should roundtrip");

        assert_eq!(decoded.client_id, Some(42));
        assert_eq!(decoded.request_id, request_id);
    }

    #[test]
    fn encodes_password_login_request_as_protobuf() {
        let request = BeginAuthSessionViaCredentialsRequest {
            account_name: Some("account".to_string()),
            encrypted_password: Some("secret".to_string()),
            encryption_timestamp: Some(123),
            remember_login: Some(true),
            platform_type: Some(EAUTH_TOKEN_PLATFORM_TYPE_WEB_BROWSER),
            website_id: Some("Community".to_string()),
            ..Default::default()
        };
        let decoded =
            BeginAuthSessionViaCredentialsRequest::decode(request.encode_to_vec().as_slice())
                .expect("password login request should roundtrip");

        assert_eq!(decoded.account_name.as_deref(), Some("account"));
        assert_eq!(decoded.encryption_timestamp, Some(123));
        assert_eq!(decoded.remember_login, Some(true));
        assert_eq!(decoded.website_id.as_deref(), Some("Community"));
    }

    #[test]
    fn maps_guard_confirmation_types() {
        assert_eq!(guard_type_from_steam_value(2), Some("email_code"));
        assert_eq!(guard_type_from_steam_value(3), Some("device_code"));
        assert_eq!(guard_type_to_steam_value("device_confirmation"), Ok(4));
        assert!(requires_guard_code("email_code"));
        assert!(!requires_guard_code("device_confirmation"));
    }

    #[test]
    fn extracts_family_token_from_store_config_attribute() {
        let html = r#"<div id="application_config"
          data-store_user_config="{&quot;webapi_token&quot;:&quot;family-token&quot;}"></div>"#;
        let token = extract_json_attribute(html, "data-store_user_config")
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|value| {
                value
                    .get("webapi_token")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            });

        assert_eq!(token.as_deref(), Some("family-token"));
    }

    #[test]
    fn extracts_existing_steam_web_api_key_from_dev_page() {
        let html = r#"
          <form id="editForm" action="https://steamcommunity.com/dev/revokekey"></form>
          <div id="bodyContents_ex"><p>Key: 0123456789ABCDEF0123456789ABCDEF</p></div>
        "#;

        assert_eq!(
            extract_steam_web_api_key(html).as_deref(),
            Some("0123456789ABCDEF0123456789ABCDEF")
        );
    }

    #[test]
    fn ignores_steam_web_api_page_without_existing_key() {
        let html = r#"<form action="https://steamcommunity.com/dev/registerkey"></form>"#;

        assert_eq!(extract_steam_web_api_key(html), None);
    }
}
