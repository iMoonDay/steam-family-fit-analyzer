import { invoke } from "@tauri-apps/api/core";
import type { AnalysisPreview, AnalysisReport, AnalyzeInput, AppSettings, AppStatus } from "../types";
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
  } catch {
    localStorage.setItem("sffa.desktop.settings", JSON.stringify(settings));
  }
}

export async function loadSettings(defaults: AppSettings): Promise<AppSettings> {
  try {
    return await invoke<AppSettings>("load_settings", { defaults });
  } catch {
    const saved = localStorage.getItem("sffa.desktop.settings");
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
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
      currentOwnedOverlapCount: 0,
      targets: normalizedTargets.map(target => ({
        steamid64: /^\d{17}$/.test(target) ? target : "",
        displayName: target,
        profileUrl: "",
        avatar: "",
        gameCount: 0,
        rawGameCount: 0,
        sampleGames: []
      })),
      warnings: ["浏览器预览模式不会请求 Steam API，请使用 Tauri 桌面窗口运行真实分析。"]
    };
  }
}

function isTauriRuntimeError(error: unknown): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && Boolean(error);
}
