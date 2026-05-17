"use strict";

globalThis.SFFA_CREATE_STEAM_API = function createSteamApi(dependencies) {
  const {
    config,
    decodeHtml,
    document,
    getApplicationLocation,
    getLastRawData,
    getPageState,
    getState,
    getStoreLang,
    isMultiTargetReport,
    readJsonAttribute,
    requestJson,
    requestText,
    setRawData,
    t,
    window
  } = dependencies;

async function fetchExistingSteamApiKey() {
  const html = await requestText("https://steamcommunity.com/dev/apikey");
  setRawData("steamApiKeyPage", {
    signedIn: !isSteamSignInPage(html),
    hasExtractableKey: Boolean(extractSteamApiKeyFromDevPage(html)),
    htmlLength: html.length
  });
  if (isSteamSignInPage(html)) {
    throw new Error(t("communityNotSignedIn"));
  }

  const apiKey = extractSteamApiKeyFromDevPage(html);
  if (apiKey) {
    return apiKey;
  }

  if (/\/dev\/registerkey|Registering\s+for\s+a\s+Steam\s+Web\s+API\s+Key|Domain\s+Name/i.test(html)) {
    throw new Error(t("apiKeyNotRegistered"));
  }

  throw new Error(t("apiKeyNotFound"));
}

function extractSteamApiKeyFromDevPage(html) {
  const text = htmlToPlainText(html);
  const labelMatch = text.match(/(?:Key|密钥)\s*[:：]\s*([0-9A-F]{32})\b/i);
  if (labelMatch) {
    return labelMatch[1].toUpperCase();
  }

  const nearbyMatch = text.match(/Steam\s+Web\s+API\s+Key[\s\S]{0,260}?([0-9A-F]{32})\b/i);
  return nearbyMatch ? nearbyMatch[1].toUpperCase() : "";
}

function htmlToPlainText(html) {
  return decodeHtml(String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function isSteamSignInPage(html) {
  return /<title>\s*Sign In\s*<\/title>/i.test(html) || /g_steamID\s*=\s*false/i.test(html);
}

function getSteamSession() {
  const pageWindow = getPageState();
  const accountId = Number(pageWindow.g_AccountID || window.g_AccountID || 0);
  const configNode = getApplicationConfigNode(pageWindow);
  let accessToken = "";
  let steamid = "";

  steamid = readSteamGlobalSteamId(pageWindow);
  if (configNode) {
    accessToken = readJsonAttribute(configNode, "data-store_user_config")?.webapi_token || "";
    steamid = readJsonAttribute(configNode, "data-userinfo")?.steamid || steamid;
  }

  return {
    isLoggedIn: accountId !== 0 || Boolean(accessToken && steamid) || Boolean(steamid),
    accessToken,
    steamid: steamid || getSteamCommunityProfileSteamId()
  };
}

function readSteamGlobalSteamId(pageWindow) {
  const candidates = [pageWindow?.g_steamID, window.g_steamID, pageWindow?.g_steamID64, window.g_steamID64];
  for (const candidate of candidates) {
    const steamid = normalizeSteamId(candidate);
    if (steamid) {
      return steamid;
    }
  }
  return "";
}

function normalizeSteamId(value) {
  if (typeof value === "string" && /^\d{17}$/.test(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    const direct = String(value.steamid || value.steamId || value.accountid || value.accountId || "");
    if (/^\d{17}$/.test(direct)) {
      return direct;
    }
    if (typeof value.GetSteamID64 === "function") {
      try {
        const result = String(value.GetSteamID64());
        if (/^\d{17}$/.test(result)) {
          return result;
        }
      } catch (error) {
        // 忽略异常。
      }
    }
  }
  return "";
}

function isSteamCommunityProfilePage() {
  return getApplicationLocation().hostname === "steamcommunity.com" && (
    /^\/profiles\/\d{17}(?:\/|$)/.test(getApplicationLocation().pathname) ||
    /^\/id\/[^/?#]+/.test(getApplicationLocation().pathname)
  );
}

function getSteamCommunityProfileSteamId() {
  if (!isSteamCommunityProfilePage()) {
    return "";
  }
  const profileMatch = getApplicationLocation().pathname.match(/^\/profiles\/(\d{17})(?:\/|$)/);
  if (profileMatch) {
    return profileMatch[1];
  }
  const vanityMatch = getApplicationLocation().pathname.match(/^\/id\/([^/?#]+)/);
  if (vanityMatch) {
    return getApplicationLocation().href;
  }
  return "";
}

function getApplicationConfigNode(pageWindow, doc = document) {
  const candidates = [
    doc.getElementById("application_config"),
    doc.querySelector("#application_config"),
    doc.querySelector("[data-store_user_config][data-userinfo]"),
    pageWindow?.application_config,
    doc === document ? window.application_config : null
  ];

  return candidates.find(node => node && typeof node.getAttribute === "function") || null;
}

async function getFamilyInfo(accessToken) {
  const url = `https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/?access_token=${encodeURIComponent(accessToken)}&include_family_group_response=true`;
  const data = await requestJson(url);
  setRawData("familyGroupForUser", data);
  const response = data.response;
  if (!response?.family_groupid || !response?.family_group?.members) {
    throw new Error(t("noFamilyGroup"));
  }

  const members = response.family_group.members;
  const names = await getUserNames(accessToken, members);
  return {
    family_groupid: response.family_groupid,
    family_name: response.family_group.name || t("unnamed"),
    family_member: members.map(member => ({
      ...member,
      userName: names[member.steamid] || member.steamid
    })),
    steamIdtoName: names
  };
}

async function getFamilyGameList(accessToken, familyGroupId) {
  const url = `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?access_token=${encodeURIComponent(accessToken)}&family_groupid=${encodeURIComponent(familyGroupId)}&include_own=true&include_excluded=false&include_non_games=false`;
  const data = await requestJson(url);
  setRawData("sharedLibraryApps", data);
  const apps = data.response?.apps;
  if (!Array.isArray(apps)) {
    throw new Error(t("emptyFamilyLibrary"));
  }

  const appidSet = [];
  const appInfoById = {};
  apps.forEach(app => {
    if (app.exclude_reason !== 0) {
      return;
    }
    const appid = String(app.appid);
    appidSet.push(appid);
    appInfoById[appid] = {
      appid,
      name: app.name || `App ${appid}`,
      owners: Array.isArray(app.owner_steamids) ? app.owner_steamids.map(String) : [],
      time: Number(app.rt_time_acquired || 0),
      icon_hash: app.img_icon_hash || ""
    };
  });

  return {
    appidSet,
    appInfoById,
    updatedAt: Date.now()
  };
}

async function getUserNames(accessToken, members) {
  if (!members.length) {
    return {};
  }

  const params = members
    .map((member, index) => `steamids[${index}]=${encodeURIComponent(member.steamid)}`)
    .join("&");
  const url = `https://api.steampowered.com/IPlayerService/GetPlayerLinkDetails/v1/?access_token=${encodeURIComponent(accessToken)}&${params}`;
  const data = await requestJson(url);
  setRawData("playerLinkDetails", data);
  const names = {};
  const accounts = data.response?.accounts || [];
  accounts.forEach(account => {
    const publicData = account.public_data || {};
    if (publicData.steamid) {
      names[String(publicData.steamid)] = publicData.persona_name || String(publicData.steamid);
    }
  });
  return names;
}

async function getTargetProfile(rawInput) {
  const targetInputs = splitTargetInputs(rawInput);
  const rawDataPrefixByIndex = targetInputs.length > 1
    ? targetInputs.map((_, index) => `targets.${index}`)
    : targetInputs.map(() => "");
  const profiles = await Promise.all(targetInputs.map((targetInput, index) => fetchSingleTargetProfile(targetInput, rawDataPrefixByIndex[index])));
  const uniqueProfiles = dedupeTargetProfiles(profiles);
  return uniqueProfiles.length === 1 ? uniqueProfiles[0] : mergeTargetProfiles(uniqueProfiles);
}

async function fetchSingleTargetProfile(rawInput, rawDataPrefix = "") {
  const parsed = parseTargetInput(rawInput);
  const identity = parsed.steamid64
    ? {
      steamid64: parsed.steamid64,
      profileUrl: `https://steamcommunity.com/profiles/${parsed.steamid64}`,
      source: parsed.source || "steamid64"
    }
    : await resolveVanity(parsed.vanity, getState().apiKey, rawDataPrefix);

  return fetchPublicGames(identity, getState().apiKey, rawDataPrefix);
}

function splitTargetInputs(rawInput) {
  const inputs = String(rawInput || "").trim().split(/\s+/).filter(Boolean);
  if (!inputs.length) {
    throw new Error(t("enterAccount"));
  }
  return inputs;
}

function parseTargetInput(rawInput) {
  const input = rawInput.trim();
  if (/^\d{17}$/.test(input)) {
    return { steamid64: input };
  }
  if (/^\d+$/.test(input)) {
    return { steamid64: steamFriendCodeToSteamId64(input), source: "friendCode" };
  }

  try {
    const url = new URL(input);
    const profileMatch = url.pathname.match(/^\/profiles\/(\d{17})(?:\/|$)/);
    if (profileMatch) {
      return { steamid64: profileMatch[1] };
    }
    const vanityMatch = url.pathname.match(/^\/id\/([^/?#]+)(?:\/|$)/);
    if (vanityMatch) {
      return { vanity: decodeURIComponent(vanityMatch[1]) };
    }
  } catch (error) {
    // 纯自定义 ID 字符串会在下方继续处理。
  }

  const vanity = input.replace(/^@/, "");
  if (/^[A-Za-z0-9_-]{2,64}$/.test(vanity)) {
    return { vanity };
  }

  throw new Error(t("invalidAccount"));
}

function steamFriendCodeToSteamId64(friendCode) {
  if (friendCode.length > config.MAX_STEAM_ACCOUNT_ID_LENGTH) {
    throw new Error(t("invalidFriendCode"));
  }

  const accountId = BigInt(friendCode);
  if (accountId <= 0n || accountId > config.MAX_STEAM_ACCOUNT_ID) {
    throw new Error(t("invalidFriendCode"));
  }

  return String(config.STEAMID64_INDIVIDUAL_BASE + accountId);
}

function dedupeTargetProfiles(profiles) {
  const profileBySteamId = new Map();
  profiles.forEach(profile => {
    const steamid64 = String(profile.steamid64 || "");
    if (steamid64 && !profileBySteamId.has(steamid64)) {
      profileBySteamId.set(steamid64, profile);
    }
  });
  return Array.from(profileBySteamId.values());
}

function mergeTargetProfiles(profiles) {
  const gameById = new Map();
  profiles.forEach(profile => {
    profile.games.forEach(game => {
      const appid = String(game.appid);
      const existing = gameById.get(appid);
      if (!existing) {
        gameById.set(appid, {
          ...game,
          targetOwners: [profile.steamid64]
        });
        return;
      }

      existing.targetOwners = Array.from(new Set([...(existing.targetOwners || []), profile.steamid64]));
      if (!existing.localizedName && game.localizedName) {
        existing.localizedName = game.localizedName;
      }
    });
  });

  const displayNames = profiles.map(getTargetProfileDisplayName);
  return {
    steamid64: profiles.map(profile => profile.steamid64).join(", "),
    displayName: displayNames.join(" + "),
    profileUrl: "",
    avatar: "",
    targets: profiles.map(profile => ({
      steamid64: profile.steamid64,
      displayName: profile.displayName,
      profileUrl: profile.profileUrl,
      avatar: profile.avatar || "",
      selected: true,
      gameAppids: profile.games.map(game => String(game.appid))
    })),
    games: Array.from(gameById.values()),
    rawGameCount: profiles.reduce((sum, profile) => sum + Number(profile.rawGameCount || profile.games.length || 0), 0)
  };
}

function getTargetSteamIds(targetProfile) {
  const targets = Array.isArray(targetProfile?.targets) && targetProfile.targets.length
    ? targetProfile.targets
    : [targetProfile];
  return targets.map(target => String(target?.steamid64 || "")).filter(Boolean);
}

function getSelectedTargetSteamIds(report) {
  const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
  if (!targets.length) {
    return getTargetSteamIds(report?.target || {});
  }
  return targets
    .filter(target => target.selected !== false)
    .map(target => String(target.steamid64 || ""))
    .filter(Boolean);
}

function isGameIncludedBySelectedTargets(game, report) {
  if (!isMultiTargetReport(report)) {
    return true;
  }
  const selectedIds = new Set(getSelectedTargetSteamIds(report));
  if (selectedIds.size === 0) {
    return false;
  }
  return (game.targetOwners || []).map(String).some(steamid => selectedIds.has(steamid));
}

function getTargetProfileDisplayName(profile) {
  return profile?.displayName || profile?.steamid64 || t("unknownAccount");
}

function getRawDataPath(prefix, leaf) {
  return prefix ? `${prefix}.${leaf}` : leaf;
}

async function resolveVanity(vanity, apiKey, rawDataPrefix = "") {
  if (!vanity) {
    throw new Error(t("missingVanity"));
  }

  if (!apiKey) {
    throw new Error(t("missingApiKey"));
  }

  return resolveVanityWithApiKey(vanity, apiKey, rawDataPrefix);
}

async function resolveVanityWithApiKey(vanity, apiKey, rawDataPrefix = "") {
  const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}&format=json`;
  const data = await requestJson(url);
  setRawData(getRawDataPath(rawDataPrefix, "resolveVanityUrl"), data);
  const response = data.response || {};
  if (Number(response.success) !== 1 || !/^\d{17}$/.test(String(response.steamid || ""))) {
    const message = response.message ? `：${response.message}` : "";
    throw new Error(t("resolveVanityFailed", { message }));
  }

  return {
    steamid64: String(response.steamid),
    profileUrl: `https://steamcommunity.com/id/${encodeURIComponent(vanity)}`,
    displayName: vanity
  };
}

async function fetchPublicGames(identity, apiKey, rawDataPrefix = "") {
  if (!apiKey) {
    throw new Error(t("missingApiKey"));
  }

  return fetchPublicGamesFromOwnedGames(identity, apiKey, rawDataPrefix);
}

async function fetchPublicGamesFromOwnedGames(identity, apiKey, rawDataPrefix = "") {
  const steamid64 = identity.steamid64;
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid64)}&include_appinfo=1&include_played_free_games=1&format=json`;
  const [data, playerSummary] = await Promise.all([
    requestJson(url),
    fetchTargetPlayerSummary(steamid64, apiKey, rawDataPrefix)
  ]);
  setRawData(getRawDataPath(rawDataPrefix, "ownedGames"), data);
  if (identity.source === "friendCode" && !playerSummary.exists) {
    throw new Error(t("invalidFriendCode"));
  }
  const response = data.response || {};
  const rawGames = Array.isArray(response.games) ? response.games : [];
  if (rawGames.length === 0) {
    throw new Error(t("privateTargetLibrary"));
  }

  return {
    steamid64,
    profileUrl: playerSummary.profileUrl || identity.profileUrl || `https://steamcommunity.com/profiles/${steamid64}`,
    displayName: playerSummary.personaName || identity.displayName || steamid64,
    avatar: playerSummary.avatar || "",
    games: rawGames.map(game => ({
      appid: String(game.appid),
      name: game.name || `App ${game.appid}`,
      logo: game.img_icon_url || "",
      storeLink: `https://store.steampowered.com/app/${game.appid}/`
    })).filter(game => /^\d+$/.test(game.appid)),
    rawGameCount: rawGames.length,
    source: "webapi-ownedgames"
  };
}

async function fetchTargetPlayerSummary(steamid64, apiKey, rawDataPrefix = "") {
  const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(steamid64)}&format=json`;
  const data = await requestJson(url);
  setRawData(getRawDataPath(rawDataPrefix, "targetPlayerSummaries"), data);
  const player = data.response?.players?.[0];
  return {
    exists: String(player?.steamid || "") === String(steamid64),
    personaName: player?.personaname || "",
    avatar: player?.avatarfull || player?.avatarmedium || player?.avatar || "",
    profileUrl: player?.profileurl || ""
  };
}

async function fetchCurrentOwnedAppids(steamid64, apiKey) {
  if (!steamid64 || !apiKey) {
    throw new Error(t("missingApiKey"));
  }

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid64)}&include_appinfo=0&include_played_free_games=1&format=json`;
  const data = await requestJson(url);
  setRawData("currentOwnedGames", data);
  const games = Array.isArray(data.response?.games) ? data.response.games : [];
  return new Set(games.map(game => String(game.appid)).filter(appid => /^\d+$/.test(appid)));
}


  return {
    fetchCurrentOwnedAppids,
    fetchExistingSteamApiKey,
    getApplicationConfigNode,
    getFamilyGameList,
    getFamilyInfo,
    getSteamCommunityProfileSteamId,
    getSteamSession,
    getTargetProfile,
    getTargetProfileDisplayName,
    getSelectedTargetSteamIds,
    getTargetSteamIds,
    isGameIncludedBySelectedTargets,
    isSteamCommunityProfilePage
  };
};
