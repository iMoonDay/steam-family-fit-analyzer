import { invoke } from "@tauri-apps/api/core";
import type {
  AnalysisPreview,
  AnalysisReport,
  AnalyzeInput,
  AppSettings,
  AppStatus,
  BrowserCallbackSession,
  CacheCoversOutput,
  CoverCacheRequest
} from "../types";
import { normalizeTargetToken, splitTargetInput } from "../core/input";

const fallbackStatus: AppStatus = {
  appName: "Steam 家庭库分析器",
  storageReady: false,
  cacheDirectory: "浏览器预览模式"
};

export async function getAppStatus(): Promise<AppStatus> {
  try {
    return await invoke<AppStatus>("get_app_status");
  } catch {
    return fallbackStatus;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await invoke("save_settings", { settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(`保存设置失败：${String(error)}`);
    }
    localStorage.setItem("sffa.desktop.settings", JSON.stringify(settings));
  }
}

export async function exportSettings(path: string, settings: AppSettings): Promise<void> {
  try {
    await invoke("export_settings", { path, settings });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(`导出设置失败：${String(error)}`);
    }
    throw new Error("浏览器预览模式不支持导出设置，请使用 Tauri 桌面窗口。");
  }
}

export async function importSettings(path: string): Promise<AppSettings> {
  try {
    return await invoke<AppSettings>("import_settings", { path });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(`导入设置失败：${String(error)}`);
    }
    throw new Error("浏览器预览模式不支持导入设置，请使用 Tauri 桌面窗口。");
  }
}

export async function loadSettings(defaults: AppSettings): Promise<AppSettings> {
  try {
    return await invoke<AppSettings>("load_settings", { defaults });
  } catch (error) {
    if (isTauriRuntimeError(error)) {
      throw new Error(`读取设置失败：${String(error)}`);
    }
    const saved = localStorage.getItem("sffa.desktop.settings");
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  }
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
