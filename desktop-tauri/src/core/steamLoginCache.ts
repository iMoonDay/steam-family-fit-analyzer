import { invoke } from "@tauri-apps/api/core";

export type SteamLoginCache = {
  steamid64: string;
  accountName: string;
  displayName: string;
  profileUrl: string;
  avatar: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number | null;
  steamApiKey: string;
  familyGroupId: string;
  savedAt: number;
};

const legacyLoginCacheKey = "sffa.desktop.steam.login";
const legacyLoginNoticeKey = "sffa.desktop.steam.login.notice";
let migrationDone = false;

export async function readSteamLoginCache(): Promise<SteamLoginCache | null> {
  await migrateLegacySteamLoginStorage();
  try {
    return normalizeSteamLoginCache(await invoke<SteamLoginCache | null>("load_steam_login_cache"));
  } catch {
    return readLegacySteamLoginCache();
  }
}

export async function writeSteamLoginCache(cache: SteamLoginCache): Promise<void> {
  await migrateLegacySteamLoginStorage();
  try {
    await invoke("save_steam_login_cache", { cache });
    localStorage.removeItem(legacyLoginCacheKey);
  } catch {
    localStorage.setItem(legacyLoginCacheKey, JSON.stringify(cache));
  }
}

export async function clearSteamLoginCache(): Promise<void> {
  try {
    await invoke("clear_steam_login_cache");
  } catch {
    // Browser preview fallback only.
  }
  localStorage.removeItem(legacyLoginCacheKey);
}

export async function readSteamLoginNotice(): Promise<string> {
  await migrateLegacySteamLoginStorage();
  try {
    return await invoke<string>("load_steam_login_notice");
  } catch {
    return localStorage.getItem(legacyLoginNoticeKey) || "";
  }
}

export async function writeSteamLoginNotice(message: string): Promise<void> {
  await migrateLegacySteamLoginStorage();
  try {
    await invoke("save_steam_login_notice", { message });
    localStorage.removeItem(legacyLoginNoticeKey);
  } catch {
    if (message) {
      localStorage.setItem(legacyLoginNoticeKey, message);
    } else {
      localStorage.removeItem(legacyLoginNoticeKey);
    }
  }
}

export async function clearSteamLoginNotice(): Promise<void> {
  try {
    await invoke("clear_steam_login_notice");
  } catch {
    // Browser preview fallback only.
  }
  localStorage.removeItem(legacyLoginNoticeKey);
}

async function migrateLegacySteamLoginStorage(): Promise<void> {
  if (migrationDone) {
    return;
  }
  migrationDone = true;

  const legacyCache = readLegacySteamLoginCache();
  if (legacyCache) {
    try {
      await invoke("save_steam_login_cache", { cache: legacyCache });
      localStorage.removeItem(legacyLoginCacheKey);
    } catch {
      // Keep legacy data in browser preview.
    }
  }

  const legacyNotice = localStorage.getItem(legacyLoginNoticeKey) || "";
  if (legacyNotice) {
    try {
      await invoke("save_steam_login_notice", { message: legacyNotice });
      localStorage.removeItem(legacyLoginNoticeKey);
    } catch {
      // Keep legacy data in browser preview.
    }
  }
}

function readLegacySteamLoginCache(): SteamLoginCache | null {
  try {
    return normalizeSteamLoginCache(JSON.parse(localStorage.getItem(legacyLoginCacheKey) || "null"));
  } catch {
    localStorage.removeItem(legacyLoginCacheKey);
    return null;
  }
}

function normalizeSteamLoginCache(value: unknown): SteamLoginCache | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const parsed = value as Partial<SteamLoginCache>;
  if (!parsed.steamid64 || !parsed.refreshToken) {
    return null;
  }
  const legacy = value as { familyAccessToken?: unknown };
  const legacyFamilyAccessToken = typeof legacy.familyAccessToken === "string"
    ? legacy.familyAccessToken
    : "";
  return {
    steamid64: parsed.steamid64,
    accountName: parsed.accountName || "",
    displayName: parsed.displayName || "",
    profileUrl: parsed.profileUrl || "",
    avatar: parsed.avatar || "",
    accessToken: parsed.accessToken || legacyFamilyAccessToken,
    refreshToken: parsed.refreshToken,
    accessTokenExpiresAt: parsed.accessTokenExpiresAt || null,
    steamApiKey: parsed.steamApiKey || "",
    familyGroupId: parsed.familyGroupId || "",
    savedAt: parsed.savedAt || Date.now()
  };
}
