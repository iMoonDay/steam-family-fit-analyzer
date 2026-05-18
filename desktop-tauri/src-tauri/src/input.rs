const STEAMID64_INDIVIDUAL_BASE: u128 = 76_561_197_960_265_728;

pub fn split_target_input(input: &str) -> Vec<String> {
    input
        .split_whitespace()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

pub fn normalize_target_token(token: &str) -> String {
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

pub fn steam_friend_code_to_steamid64(friend_code: &str) -> Result<String, String> {
    let account_id = friend_code
        .parse::<u128>()
        .map_err(|_| "好友码格式不正确".to_string())?;
    if account_id == 0 {
        return Err("好友码格式不正确".to_string());
    }
    Ok((STEAMID64_INDIVIDUAL_BASE + account_id).to_string())
}

pub fn is_steamid64(value: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_target_token_extracts_common_steam_identity_forms() {
        assert_eq!(
            normalize_target_token("https://steamcommunity.com/profiles/76561190000000001/"),
            "76561190000000001"
        );
        assert_eq!(
            normalize_target_token("https://steamcommunity.com/id/example/"),
            "example"
        );
        assert_eq!(normalize_target_token("@example"), "example");
    }
}
