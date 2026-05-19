use crate::{
    input::is_steamid64,
    models::{AppSettings, AutoSteamConfigResult, BrowserCallbackSession},
    steam,
};
use rand::{distributions::Alphanumeric, Rng};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const BROWSER_CALLBACK_TTL_SECONDS: u64 = 10 * 60;

pub async fn detect(settings: &AppSettings) -> Result<AutoSteamConfigResult, String> {
    let client = steam::build_client()?;
    let mut result = AutoSteamConfigResult {
        family_access_token: String::new(),
        current_steam_id64: String::new(),
        family_group_id: String::new(),
        messages: Vec::new(),
    };

    match detect_recent_steamid64() {
        Some(steamid64) => {
            result.current_steam_id64 = steamid64;
            result
                .messages
                .push("已从本机 Steam 客户端读取最近登录的 SteamID64".to_string());
        }
        None => result
            .messages
            .push("未在本机 Steam 客户端配置中找到最近登录的 SteamID64".to_string()),
    }

    match fetch_steam_session_from_store_page(&client).await {
        Ok(session) => {
            if !session.access_token.is_empty() {
                result.family_access_token = session.access_token;
                result
                    .messages
                    .push("已从 Steam 商店页面读取家庭库 access token".to_string());
            }
            if result.current_steam_id64.is_empty() && !session.steamid64.is_empty() {
                result.current_steam_id64 = session.steamid64;
                result
                    .messages
                    .push("已从 Steam 商店页面读取 SteamID64".to_string());
            }
        }
        Err(error) => result.messages.push(error),
    }

    let access_token = if result.family_access_token.is_empty() {
        settings.family_access_token.trim()
    } else {
        result.family_access_token.as_str()
    };
    if !access_token.is_empty() {
        match steam::fetch_family_group_id(&client, access_token).await {
            Ok(family_group_id) => {
                result.family_group_id = family_group_id;
                result
                    .messages
                    .push("已通过 access token 获取家庭组 ID".to_string());
            }
            Err(error) => result
                .messages
                .push(format!("家庭组 ID 自动获取失败：{error}")),
        }
    } else {
        result
            .messages
            .push("未获取到 access token，暂不能自动获取家庭组 ID".to_string());
    }

    Ok(result)
}

pub fn start_browser_callback(app: AppHandle) -> Result<BrowserCallbackSession, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("启动本地回调服务失败：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("配置本地回调服务失败：{error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取本地回调地址失败：{error}"))?
        .port();
    let token = random_token();
    let callback_url = format!("http://127.0.0.1:{port}/steam-config-callback?token={token}");
    let bookmarklet = build_bookmarklet(&callback_url);
    let app_for_thread = app.clone();
    thread::spawn(move || run_callback_server(app_for_thread, listener, token));

    Ok(BrowserCallbackSession {
        callback_url,
        bookmarklet,
        steam_store_url: "https://store.steampowered.com/account/familymanagement".to_string(),
        expires_in_seconds: BROWSER_CALLBACK_TTL_SECONDS,
    })
}

fn run_callback_server(app: AppHandle, listener: TcpListener, token: String) {
    let deadline = Instant::now() + Duration::from_secs(BROWSER_CALLBACK_TTL_SECONDS);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let response = handle_callback_stream(&app, &token, &mut stream);
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(120));
            }
            Err(_) => break,
        }
    }
}

fn handle_callback_stream(app: &AppHandle, token: &str, stream: &mut TcpStream) -> String {
    let Ok(request) = read_http_request(stream) else {
        return http_response(400, "请求无法读取");
    };
    if request.starts_with("GET /favicon.ico") {
        return http_response(404, "");
    }
    let Some(first_line) = request.lines().next() else {
        return http_response(400, "请求为空");
    };
    let Some(path) = first_line.split_whitespace().nth(1) else {
        return http_response(400, "请求路径无效");
    };
    let Some(query) = path.split_once('?').map(|(_, query)| query) else {
        return http_response(400, "缺少回调参数");
    };
    let params = parse_query(query);
    if params.get("token").map(String::as_str) != Some(token) {
        return http_response(403, "一次性 token 无效或已过期");
    }
    let Some(payload_text) = params.get("payload") else {
        return http_response(400, "缺少 payload");
    };
    let Ok(mut payload) = serde_json::from_str::<AutoSteamConfigResult>(payload_text) else {
        return http_response(400, "payload 不是有效配置 JSON");
    };

    if payload.family_group_id.is_empty() && !payload.family_access_token.trim().is_empty() {
        match tauri::async_runtime::block_on(fetch_family_group_id_for_callback(
            payload.family_access_token.trim(),
        )) {
            Ok(family_group_id) => {
                payload.family_group_id = family_group_id;
                payload
                    .messages
                    .push("已通过浏览器回调获取家庭组 ID".to_string());
            }
            Err(error) => payload.messages.push(format!(
                "浏览器回调已获取 token，但家庭组 ID 获取失败：{error}"
            )),
        }
    }
    let _ = app.emit_to("main", "steam-auto-config-detected", payload);
    http_response(200, "配置已发送到 Steam 家庭库分析器，可以关闭这个页面。")
}

async fn fetch_family_group_id_for_callback(access_token: &str) -> Result<String, String> {
    let client = steam::build_client()?;
    steam::fetch_family_group_id(&client, access_token).await
}

fn read_http_request(stream: &mut TcpStream) -> Result<String, std::io::Error> {
    let mut buffer = [0_u8; 65536];
    let size = stream.read(&mut buffer)?;
    Ok(String::from_utf8_lossy(&buffer[..size]).to_string())
}

fn http_response(status: u16, body: &str) -> String {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    )
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            Some((percent_decode(key), percent_decode(value)))
        })
        .collect()
}

fn percent_decode(value: &str) -> String {
    let mut bytes = Vec::with_capacity(value.len());
    let mut chars = value.as_bytes().iter().copied();
    while let Some(byte) = chars.next() {
        if byte == b'%' {
            let hi = chars.next();
            let lo = chars.next();
            if let (Some(hi), Some(lo)) = (hi, lo) {
                if let Ok(decoded) = u8::from_str_radix(&String::from_utf8_lossy(&[hi, lo]), 16) {
                    bytes.push(decoded);
                    continue;
                }
            }
            bytes.push(byte);
            continue;
        }
        bytes.push(if byte == b'+' { b' ' } else { byte });
    }
    String::from_utf8_lossy(&bytes).to_string()
}

fn random_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn build_bookmarklet(callback_url: &str) -> String {
    let escaped_callback = callback_url.replace('\\', "\\\\").replace('\'', "\\'");
    format!(
        "javascript:(()=>{{const cb='{escaped_callback}';function a(n){{const e=document.getElementById('application_config')||document.querySelector('[data-store_user_config][data-userinfo]');if(!e)return null;try{{return JSON.parse(e.getAttribute(n)||'null')}}catch(_ ){{return null}}}}const s=a('data-store_user_config')||{{}};const u=a('data-userinfo')||{{}};let id=String(u.steamid||window.g_steamID||window.g_steamID64||'');if(!/^\\d{{17}}$/.test(id))id='';const p={{familyAccessToken:String(s.webapi_token||''),currentSteamId64:id,familyGroupId:'',messages:['已通过浏览器辅助脚本读取家庭库配置']}};if(!p.familyAccessToken&&!p.currentSteamId64){{alert('当前页面没有可读取的 Steam 家庭库配置，请在 Steam 家庭管理页面执行。');return}}window.open(cb+'&payload='+encodeURIComponent(JSON.stringify(p)),'_blank','noopener,noreferrer');}})()"
    )
}

#[derive(Debug, Clone)]
struct SteamSession {
    access_token: String,
    steamid64: String,
}

async fn fetch_steam_session_from_store_page(
    client: &reqwest::Client,
) -> Result<SteamSession, String> {
    let html = request_text(
        client,
        "https://store.steampowered.com/account/familymanagement",
    )
    .await?;
    let access_token = extract_json_attribute(&html, "data-store_user_config")
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|value| {
            value
                .get("webapi_token")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    let steamid64 = extract_json_attribute(&html, "data-userinfo")
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|value| {
            value
                .get("steamid")
                .and_then(serde_json::Value::as_str)
                .filter(|steamid| is_steamid64(steamid))
                .map(str::to_string)
        })
        .or_else(|| extract_steam_global_id(&html))
        .unwrap_or_default();

    if access_token.is_empty() && steamid64.is_empty() {
        return Err("Steam access token 自动获取失败：桌面端当前没有 Steam 商店登录态".to_string());
    }

    Ok(SteamSession {
        access_token,
        steamid64,
    })
}

async fn request_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .send()
        .await
        .map_err(|error| format!("Steam 页面请求失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Steam 页面返回 HTTP {status}"));
    }
    response
        .text()
        .await
        .map_err(|error| format!("Steam 页面无法读取：{error}"))
}

fn detect_recent_steamid64() -> Option<String> {
    steam_install_dirs()
        .into_iter()
        .map(|dir| dir.join("config").join("loginusers.vdf"))
        .find_map(|path| read_recent_steamid64_from_loginusers(&path))
}

fn steam_install_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    dirs.extend(steam_install_dirs_from_registry());
    if let Ok(steam_path) = env::var("STEAM_PATH") {
        dirs.push(PathBuf::from(steam_path));
    }
    if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
        dirs.push(PathBuf::from(program_files_x86).join("Steam"));
    }
    if let Ok(program_files) = env::var("ProgramFiles") {
        dirs.push(PathBuf::from(program_files).join("Steam"));
    }
    if let Ok(home) = env::var("HOME") {
        dirs.push(PathBuf::from(home).join(".steam").join("steam"));
    }
    for drive in 'A'..='Z' {
        dirs.push(PathBuf::from(format!(
            "{drive}:\\Program Files (x86)\\Steam"
        )));
        dirs.push(PathBuf::from(format!("{drive}:\\Program Files\\Steam")));
        dirs.push(PathBuf::from(format!("{drive}:\\Steam")));
    }
    dirs.sort();
    dirs.dedup();
    dirs
}

#[cfg(windows)]
fn steam_install_dirs_from_registry() -> Vec<PathBuf> {
    use winreg::{enums::*, RegKey};

    let mut dirs = Vec::new();
    let registry_locations = [
        (HKEY_CURRENT_USER, "Software\\Valve\\Steam", "SteamPath"),
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\WOW6432Node\\Valve\\Steam",
            "InstallPath",
        ),
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\Valve\\Steam", "InstallPath"),
    ];

    for (hkey, subkey, value_name) in registry_locations {
        let Ok(key) = RegKey::predef(hkey).open_subkey(subkey) else {
            continue;
        };
        let Ok(value) = key.get_value::<String, _>(value_name) else {
            continue;
        };
        if !value.trim().is_empty() {
            dirs.push(PathBuf::from(value));
        }
    }

    dirs
}

#[cfg(not(windows))]
fn steam_install_dirs_from_registry() -> Vec<PathBuf> {
    Vec::new()
}

fn read_recent_steamid64_from_loginusers(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let mut current_id = String::new();
    let mut fallback_id = String::new();
    let mut current_is_recent = false;

    for line in text.lines() {
        let tokens = parse_vdf_quoted_tokens(line);
        if tokens.len() == 1 && is_steamid64(&tokens[0]) {
            if current_is_recent && is_steamid64(&current_id) {
                return Some(current_id);
            }
            if fallback_id.is_empty() {
                fallback_id = tokens[0].clone();
            }
            current_id = tokens[0].clone();
            current_is_recent = false;
            continue;
        }
        if tokens.len() >= 2 && tokens[0] == "MostRecent" && tokens[1] == "1" {
            current_is_recent = true;
        }
    }

    if current_is_recent && is_steamid64(&current_id) {
        Some(current_id)
    } else if is_steamid64(&fallback_id) {
        Some(fallback_id)
    } else {
        None
    }
}

fn parse_vdf_quoted_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = line.chars().peekable();
    while let Some(char) = chars.next() {
        if char != '"' {
            continue;
        }
        let mut token = String::new();
        for inner in chars.by_ref() {
            if inner == '"' {
                break;
            }
            token.push(inner);
        }
        tokens.push(token);
    }
    tokens
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

fn extract_steam_global_id(html: &str) -> Option<String> {
    ["g_steamID", "g_steamID64"].into_iter().find_map(|name| {
        let index = html.find(name)?;
        let end = (index + name.len() + 80).min(html.len());
        html[index..end]
            .split(|char: char| !char.is_ascii_digit())
            .find(|part| is_steamid64(part))
            .map(str::to_string)
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_recent_steamid64_from_loginusers_vdf() {
        let dir = env::temp_dir().join(format!("sffa-loginusers-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("loginusers.vdf");
        fs::write(
            &path,
            r#""users"
{
  "76561190000000001"
  {
    "MostRecent" "0"
  }
  "76561190000000002"
  {
    "MostRecent" "1"
  }
}"#,
        )
        .expect("write vdf");

        assert_eq!(
            read_recent_steamid64_from_loginusers(&path).as_deref(),
            Some("76561190000000002")
        );

        let _ = fs::remove_file(path);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn extracts_session_from_application_config_attributes() {
        let html = r#"<div id="application_config"
          data-store_user_config="{&quot;webapi_token&quot;:&quot;token-123&quot;}"
          data-userinfo="{&quot;steamid&quot;:&quot;76561190000000003&quot;}"></div>"#;

        let token = extract_json_attribute(html, "data-store_user_config")
            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
            .and_then(|value| {
                value
                    .get("webapi_token")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            });
        let steamid = extract_json_attribute(html, "data-userinfo")
            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
            .and_then(|value| {
                value
                    .get("steamid")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            });

        assert_eq!(token.as_deref(), Some("token-123"));
        assert_eq!(steamid.as_deref(), Some("76561190000000003"));
    }
}
