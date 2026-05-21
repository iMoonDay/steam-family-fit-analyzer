import { invoke } from "@tauri-apps/api/core";
import type {
  AnalysisPreview,
  AnalysisReport,
  AnalyzeInput,
  AppSettings,
  AppStatus,
  AutoSteamConfigResult,
  BrowserCallbackSession,
  CacheCoversOutput,
  CoverCacheRequest,
  SteamLoginProfile,
  SteamLoginRefreshResult,
  SteamPasswordLoginResult,
  SteamQrLoginPollResult,
  SteamQrLoginSession
} from "../types";
import { normalizeTargetToken, splitTargetInput } from "../core/input";

const fallbackStatus: AppStatus = {
  appName: "Steam 家庭库分析器",
  storageReady: false,
  cacheDirectory: "浏览器预览模式",
  configDirectory: "浏览器预览模式"
};

const fallbackSettings: AppSettings = {
  steamApiKey: "",
  itadApiKey: "",
  currentSteamId64: "",
  familyAccessToken: "",
  familyGroupId: "",
  storeCountry: "CN",
  locale: "auto",
  priceMode: "original",
  cacheDirectory: "",
  configDirectory: ""
};

export async function getAppStatus(): Promise<AppStatus> {
  try {
    return await invoke<AppStatus>("get_app_status");
  } catch {
    return fallbackStatus;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const persistedSettings = stripLoginDerivedSettings(normalizeSettings(settings));
  try {
    await invoke("save_settings", { settings: persistedSettings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(`保存设置失败：${String(error)}`);
    }
    localStorage.setItem("sffa.desktop.settings", JSON.stringify(persistedSettings));
  }
}

export async function exportSettings(path: string, settings: AppSettings): Promise<void> {
  try {
    await invoke("export_settings", { path, settings: stripLoginDerivedSettings(normalizeSettings(settings)) });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(`导出设置失败：${String(error)}`);
    }
    throw new Error("浏览器预览模式不支持导出设置，请使用 Tauri 桌面窗口。");
  }
}

export async function importSettings(path: string): Promise<AppSettings> {
  try {
    return normalizeSettings(await invoke<AppSettings>("import_settings", { path }));
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(`导入设置失败：${String(error)}`);
    }
    throw new Error("浏览器预览模式不支持导入设置，请使用 Tauri 桌面窗口。");
  }
}

export async function loadSettings(defaults: AppSettings): Promise<AppSettings> {
  const normalizedDefaults = normalizeSettings(defaults);
  try {
    return normalizeSettings(await invoke<AppSettings>("load_settings", { defaults: normalizedDefaults }));
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(`读取设置失败：${String(error)}`);
    }
    const saved = localStorage.getItem("sffa.desktop.settings");
    return saved ? normalizeSettings({ ...normalizedDefaults, ...JSON.parse(saved) }) : normalizedDefaults;
  }
}

export async function migrateConfigDirectory(oldPath: string, newPath: string): Promise<void> {
  try {
    await invoke("migrate_config_directory", { oldPath, newPath });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能迁移配置目录，请使用 Tauri 桌面窗口。");
  }
}

export async function migrateCacheDirectory(oldPath: string, newPath: string): Promise<void> {
  try {
    await invoke("migrate_cache_directory", { oldPath, newPath });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能迁移缓存目录，请使用 Tauri 桌面窗口。");
  }
}

function stripLoginDerivedSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    steamApiKey: "",
    currentSteamId64: "",
    familyAccessToken: "",
    familyGroupId: ""
  };
}

function normalizeSettings(settings: Partial<AppSettings> | null | undefined): AppSettings {
  const parsed = settings || {};
  return {
    ...fallbackSettings,
    ...parsed,
    steamApiKey: parsed.steamApiKey || "",
    itadApiKey: parsed.itadApiKey || "",
    currentSteamId64: parsed.currentSteamId64 || "",
    familyAccessToken: parsed.familyAccessToken || "",
    familyGroupId: parsed.familyGroupId || "",
    storeCountry: parsed.storeCountry || fallbackSettings.storeCountry,
    locale: parsed.locale || fallbackSettings.locale,
    priceMode: parsed.priceMode || fallbackSettings.priceMode,
    cacheDirectory: parsed.cacheDirectory || "",
    configDirectory: parsed.configDirectory || ""
  };
}

export async function clearCache(settings: AppSettings): Promise<void> {
  try {
    await invoke("clear_cache", { settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    localStorage.removeItem("sffa.desktop.cache");
  }
}

export async function openCacheDirectory(settings: AppSettings): Promise<void> {
  try {
    await invoke("open_cache_directory", { settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能打开缓存目录，请使用 Tauri 桌面窗口。");
  }
}

export async function openConfigDirectory(settings: AppSettings): Promise<void> {
  try {
    await invoke("open_config_directory", { settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能打开配置目录，请使用 Tauri 桌面窗口。");
  }
}

export async function savePngFile(path: string, dataUrl: string): Promise<void> {
  try {
    await invoke("save_png_file", { path, dataUrl });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能保存封面图，请使用 Tauri 桌面窗口。");
  }
}

export async function cacheCovers(settings: AppSettings, covers: CoverCacheRequest[]): Promise<CacheCoversOutput> {
  if (!covers.length) {
    return { covers: [], warnings: [] };
  }
  try {
    return await invoke<CacheCoversOutput>("cache_covers", { input: { settings, covers } });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    return { covers: [], warnings: [] };
  }
}

export async function startBrowserConfigCallback(): Promise<BrowserCallbackSession> {
  try {
    return await invoke<BrowserCallbackSession>("start_browser_config_callback");
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能启动本地回调服务，请使用 Tauri 桌面窗口。");
  }
}

export async function beginSteamQrLogin(): Promise<SteamQrLoginSession> {
  try {
    return await invoke<SteamQrLoginSession>("begin_steam_qr_login");
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能启动 Steam 登录 API，请使用 Tauri 桌面窗口。");
  }
}

export async function pollSteamQrLogin(session: SteamQrLoginSession): Promise<SteamQrLoginPollResult> {
  try {
    return await invoke<SteamQrLoginPollResult>("poll_steam_qr_login", {
      clientId: session.clientId,
      requestId: session.requestId
    });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能轮询 Steam 登录 API，请使用 Tauri 桌面窗口。");
  }
}

export async function beginSteamPasswordLogin(accountName: string, password: string): Promise<SteamPasswordLoginResult> {
  try {
    return await invoke<SteamPasswordLoginResult>("begin_steam_password_login", {
      accountName,
      password
    });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能使用 Steam 账号密码登录，请使用 Tauri 桌面窗口。");
  }
}

export async function pollSteamPasswordLogin(session: Pick<SteamPasswordLoginResult, "clientId" | "requestId">): Promise<SteamPasswordLoginResult> {
  try {
    return await invoke<SteamPasswordLoginResult>("poll_steam_password_login", {
      clientId: session.clientId,
      requestId: session.requestId
    });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能检查 Steam 账号密码登录，请使用 Tauri 桌面窗口。");
  }
}

export async function submitSteamPasswordLoginGuard(
  session: Pick<SteamPasswordLoginResult, "clientId" | "requestId" | "steamid64">,
  code: string,
  codeType: string
): Promise<SteamPasswordLoginResult> {
  try {
    return await invoke<SteamPasswordLoginResult>("submit_steam_password_login_guard", {
      clientId: session.clientId,
      requestId: session.requestId,
      steamid64: session.steamid64,
      code,
      codeType
    });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能提交 Steam Guard 验证码，请使用 Tauri 桌面窗口。");
  }
}

export async function fetchFamilyConfigFromSteamLogin(result: Pick<SteamQrLoginPollResult, "steamid64" | "accessToken">): Promise<AutoSteamConfigResult> {
  try {
    return await invoke<AutoSteamConfigResult>("fetch_family_config_from_steam_login", {
      steamid64: result.steamid64,
      accessToken: result.accessToken
    });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能通过 Steam 登录态读取家庭库配置，请使用 Tauri 桌面窗口。");
  }
}

export async function fetchSteamApiKeyFromSteamLogin(result: Pick<SteamQrLoginPollResult, "steamid64" | "accessToken">): Promise<string | null> {
  try {
    return await invoke<string | null>("fetch_steam_api_key_from_steam_login", {
      steamid64: result.steamid64,
      accessToken: result.accessToken
    });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能通过 Steam 登录态读取 Steam Web API Key，请使用 Tauri 桌面窗口。");
  }
}

export async function refreshSteamLogin(steamid64: string, refreshToken: string): Promise<SteamLoginRefreshResult> {
  try {
    return await invoke<SteamLoginRefreshResult>("refresh_steam_login", {
      steamid64,
      refreshToken
    });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能刷新 Steam 登录态，请使用 Tauri 桌面窗口。");
  }
}

export async function fetchSteamLoginProfile(steamid64: string, steamApiKey: string): Promise<SteamLoginProfile> {
  try {
    return await invoke<SteamLoginProfile>("fetch_steam_login_profile", {
      steamid64,
      steamApiKey
    });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能读取 Steam 资料，请使用 Tauri 桌面窗口。");
  }
}

export async function validateSteamApiKey(settings: AppSettings): Promise<string> {
  try {
    return await invoke<string>("validate_steam_api_key", { settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能校验 Steam Web API Key，请使用 Tauri 桌面窗口。");
  }
}

export async function validateItadApiKey(settings: AppSettings): Promise<string> {
  try {
    return await invoke<string>("validate_itad_api_key", { settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能校验 IsThereAnyDeal API Key，请使用 Tauri 桌面窗口。");
  }
}

export async function validateFamilyAccessToken(settings: AppSettings): Promise<string> {
  try {
    return await invoke<string>("validate_family_access_token", { settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    throw new Error("浏览器预览模式不能校验家庭库 Access Token，请使用 Tauri 桌面窗口。");
  }
}

export async function analyzePreview(input: AnalyzeInput): Promise<AnalysisPreview> {
  try {
    return await invoke<AnalysisPreview>("analyze_preview", { input });
  } catch {
    const normalizedTargets = splitTargetInput(input.targetInput).map(normalizeTargetToken);
    return {
      targetCount: normalizedTargets.length,
      normalizedTargets,
      priceMode: input.settings.priceMode,
      storeContext: `${input.settings.storeCountry}:${input.settings.locale}`,
      warnings: input.settings.priceMode === "historyLow" && !input.settings.itadApiKey
        ? ["史低模式需要 IsThereAnyDeal API Key"]
        : []
    };
  }
}

export async function analyzeTarget(input: AnalyzeInput): Promise<AnalysisReport> {
  try {
    return await invoke<AnalysisReport>("analyze_target", { input });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    const normalizedTargets = splitTargetInput(input.targetInput).map(normalizeTargetToken);
    return {
      targetCount: normalizedTargets.length,
      totalPublicGames: 0,
      familyGameCount: 0,
      newGameCount: 0,
      overlapCount: 0,
      currentOwnedOverlapCount: 0,
      targets: normalizedTargets.map(target => ({
        steamid64: /^\d{17}$/.test(target) ? target : "",
        displayName: target,
        profileUrl: "",
        avatar: "",
        gameCount: 0,
        rawGameCount: 0,
        games: [],
        sampleGames: []
      })),
      games: {
        all: [],
        new: [],
        relativeNew: [],
        overlap: [],
        currentOwned: [],
        notCurrentOwned: []
      },
      warnings: ["浏览器预览模式不会请求 Steam API，请使用 Tauri 桌面窗口运行真实分析。"]
    };
  }
}

export async function fetchFamilyLibraryReport(settings: AppSettings): Promise<AnalysisReport> {
  try {
    return await invoke<AnalysisReport>("fetch_family_library_report", { settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    return {
      targetCount: 0,
      totalPublicGames: 0,
      familyGameCount: 0,
      newGameCount: 0,
      overlapCount: 0,
      currentOwnedOverlapCount: 0,
      targets: [],
      games: {
        all: [],
        new: [],
        relativeNew: [],
        overlap: [],
        currentOwned: [],
        notCurrentOwned: []
      },
      warnings: ["浏览器预览模式不会请求 Steam API，请使用 Tauri 桌面窗口运行真实家庭库。"]
    };
  }
}

export async function refreshReportPrices(report: AnalysisReport, settings: AppSettings): Promise<AnalysisReport> {
  try {
    return await invoke<AnalysisReport>("refresh_report_prices", { input: { report, settings } });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(String(error));
    }
    return report;
  }
}

function isTauriRuntimeError(error: unknown): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && Boolean(error);
}
