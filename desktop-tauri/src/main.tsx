import "@mantine/core/styles.css";
import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AppShell,
  MantineProvider,
  ScrollArea,
  Tooltip,
  createTheme
} from "@mantine/core";
import { createRoot } from "react-dom/client";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { AnalysisReport, AppSettings, AppStatus, PriceMode, SteamLoginRefreshResult, SteamQrLoginPollResult } from "./types";
import {
  analyzeTarget,
  fetchFamilyConfigFromSteamLogin,
  fetchSteamApiKeyFromSteamLogin,
  fetchSteamLoginProfile,
  getAppStatus,
  loadSettings,
  refreshReportPrices,
  refreshSteamLogin,
  saveSettings,
  validateFamilyAccessToken
} from "./services/desktop";
import type {
  AnalysisHistoryEntry,
  AppPage,
  ResultViewState
} from "./appTypes";
import { reportHasPriceModeData } from "./core/report";
import {
  getInitialLastAnalysisReport,
  loadAnalysisHistory,
  saveAnalysisHistory,
  saveLastAnalysisReport,
  upsertAnalysisHistory
} from "./core/storage";
import {
  clearSteamLoginCache,
  clearSteamLoginNotice,
  readSteamLoginCache,
  readSteamLoginNotice,
  writeSteamLoginCache,
  writeSteamLoginNotice
} from "./core/steamLoginCache";
import type { SteamLoginCache } from "./core/steamLoginCache";
import { ActivityIcon, WindowControlIcon } from "./components/icons";
import { AnalysisPreparePage } from "./pages/AnalysisPreparePage";
import { AnalysisResultPage, EmptyResultPage } from "./pages/AnalysisResultPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";

const defaultSettings: AppSettings = {
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

const defaultResultViewState: ResultViewState = {
  searchQuery: "",
  activeGameList: "all",
  viewMode: "cover",
  showAppId: false,
  selectedTargetIds: [],
  tableSortByList: {}
};

type PageMessageState = Record<AppPage, string>;

type AuthEnsureResult = {
  ok: boolean;
  settings: AppSettings;
  message?: string;
};

type AuthRefreshNeed = {
  steamApiKey: boolean;
  accessToken: boolean;
};

type AuthEnsureOptions = {
  forceRefresh?: boolean;
  statusMessage?: string;
  required?: AuthRefreshNeed;
};

const theme = createTheme({
  primaryColor: "steamBlue",
  colors: {
    steamBlue: [
      "#e8f5fc",
      "#d4edf9",
      "#a9d9f0",
      "#78bfe3",
      "#4fa5d2",
      "#2f86bd",
      "#246a96",
      "#1e5578",
      "#1a4059",
      "#102a3d"
    ],
    steamGreen: [
      "#f1f8ea",
      "#e1efd3",
      "#c5dfaa",
      "#a6cb7e",
      "#84b657",
      "#66963d",
      "#4f762f",
      "#3c5b25",
      "#2b411b",
      "#1b2a11"
    ]
  },
  fontFamily: "Aptos, Segoe UI, sans-serif",
  headings: {
    fontFamily: "Bahnschrift, Aptos, Segoe UI, sans-serif"
  },
  radius: {
    sm: "6px",
    md: "8px",
    lg: "10px"
  }
});

function App() {
  const restoredReport = getInitialLastAnalysisReport();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [targetInput, setTargetInput] = useState("");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(restoredReport);
  const [busy, setBusy] = useState(false);
  const [globalMessage, setGlobalMessage] = useState("");
  const [loginPersistentMessage, setLoginPersistentMessage] = useState("");
  const [navLoginAccount, setNavLoginAccount] = useState<SteamLoginCache | null>(null);
  const [pageMessages, setPageMessages] = useState<PageMessageState>({
    analysis: "",
    result: restoredReport ? "已恢复上次分析结果" : "暂无分析结果",
    login: "",
    settings: ""
  });
  const [activePage, setActivePage] = useState<AppPage>(restoredReport ? "result" : "analysis");
  const [priceModeControlValue, setPriceModeControlValue] = useState<PriceMode>(defaultSettings.priceMode);
  const [resultViewState, setResultViewState] = useState<ResultViewState>(defaultResultViewState);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryEntry[]>(() => loadAnalysisHistory());
  const [settingsReady, setSettingsReady] = useState(false);
  const priceModeRevertTimerRef = useRef<number | null>(null);
  const activePageRef = useRef<AppPage>(activePage);
  const settingsSaveMessagePageRef = useRef<AppPage>("settings");
  const authRefreshInFlightRef = useRef<Promise<AuthEnsureResult> | null>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  useEffect(() => {
    const handleContextMenu = (event: Event) => {
      event.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    if (!settingsReady) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveSettings(settings).catch(error => {
        updatePageMessage(settingsSaveMessagePageRef.current, error instanceof Error ? error.message : String(error));
      });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [settings, settingsReady]);

  const priceLabel = settings.priceMode === "historyLow" ? "Steam 史低" : "Steam 原价";
  const tablePriceLabel = settings.priceMode === "historyLow" ? "史低" : "原价";
  const warningText = useMemo(() => report?.warnings.join("；") || "", [report]);
  const loginNavLabel = navLoginAccount ? getLoginNavLabel(navLoginAccount) : "登录";

  const handleLoginAccountChange = useCallback((account: SteamLoginCache | null) => {
    setNavLoginAccount(account);
  }, []);

  function updatePageMessage(page: AppPage, nextMessage: string) {
    setPageMessages(current => ({
      ...current,
      [page]: nextMessage
    }));
    setGlobalMessage(nextMessage);
  }

  function updatePagesMessage(pages: AppPage[], nextMessage: string) {
    setPageMessages(current => {
      const nextMessages = { ...current };
      for (const page of pages) {
        nextMessages[page] = nextMessage;
      }
      return nextMessages;
    });
    setGlobalMessage(nextMessage);
  }

  async function migrateSettingsLoginDataToCache(savedSettings: AppSettings): Promise<SteamLoginCache | null> {
    const cached = await readSteamLoginCache();
    if (!cached) {
      return null;
    }
    const nextCache: SteamLoginCache = {
      ...cached,
      steamApiKey: cached.steamApiKey || safeTrim(savedSettings.steamApiKey),
      accessToken: cached.accessToken || safeTrim(savedSettings.familyAccessToken),
      familyGroupId: cached.familyGroupId || safeTrim(savedSettings.familyGroupId)
    };
    if (safeTrim(savedSettings.currentSteamId64) && !safeTrim(nextCache.steamid64)) {
      nextCache.steamid64 = safeTrim(savedSettings.currentSteamId64);
    }
    if (JSON.stringify(nextCache) !== JSON.stringify(cached)) {
      await writeSteamLoginCache(nextCache);
    }
    return nextCache;
  }

  async function getRuntimeSettings(baseSettings: AppSettings): Promise<AppSettings> {
    const cache = await readSteamLoginCache();
    return applyLoginCacheToSettings(baseSettings, cache || navLoginAccount);
  }

  async function bootstrap() {
    try {
      const [nextStatus, savedSettings] = await Promise.all([
        getAppStatus(),
        loadSettings(defaultSettings)
      ]);
      const migratedLoginCache = await migrateSettingsLoginDataToCache(savedSettings);
      const cleanSettings = stripLoginDerivedSettings(savedSettings);
      setStatus(nextStatus);
      setSettings(cleanSettings);
      setPriceModeControlValue(cleanSettings.priceMode);
      setLoginPersistentMessage(await readSteamLoginNotice());
      setNavLoginAccount(migratedLoginCache);
      if (hasLoginDerivedSettings(savedSettings)) {
        void saveSettings(cleanSettings);
      }
      void syncNavLoginProfile();
      void ensureSteamLoginFresh(cleanSettings, "login").then(result => {
        if (result.ok) {
          setSettings(stripLoginDerivedSettings(result.settings));
          void syncNavLoginProfile();
        }
      });
    } catch (error) {
      updatePageMessage(activePageRef.current, error instanceof Error ? error.message : String(error));
    } finally {
      setSettingsReady(true);
    }
  }

  function handleSettingsChange(nextSettings: AppSettings) {
    settingsSaveMessagePageRef.current = "settings";
    setSettings(nextSettings);
    if (!settingsReady) {
      return;
    }
    void saveSettings(nextSettings).catch(error => {
      updatePageMessage("settings", error instanceof Error ? error.message : String(error));
    });
  }

  async function handleAnalyze(inputOverride?: string, settingsOverride?: AppSettings, sourcePage: AppPage = "analysis") {
    const analysisInput = inputOverride ?? targetInput;
    const analysisSettings = stripLoginDerivedSettings(settingsOverride || settings);
    setBusy(true);
    updatePageMessage(sourcePage, "分析中");
    try {
      await saveSettings(analysisSettings);
      const nextReport = await analyzeWithLoginRetry(analysisInput, analysisSettings, sourcePage);
      handleAnalyzeSuccess(nextReport, analysisInput, sourcePage);
    } catch (error) {
      updatePageMessage(sourcePage, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function analyzeWithLoginRetry(analysisInput: string, analysisSettings: AppSettings, sourcePage: AppPage): Promise<AnalysisReport> {
    try {
      return await analyzeTarget({ targetInput: analysisInput, settings: await getRuntimeSettings(analysisSettings) });
    } catch (firstError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      const refreshNeed = getTokenRefreshNeed(firstMessage);
      const cache = await readSteamLoginCache() || navLoginAccount;
      if (!cache || !refreshNeed) {
        throw firstError;
      }

      const authResult = await ensureSteamLoginFresh(analysisSettings, "login", {
        forceRefresh: true,
        statusMessage: "刷新登录",
        required: refreshNeed
      });
      if (!authResult.ok) {
        setActivePage("login");
        throw new Error(authResult.message || "登录失效");
      }
      return await analyzeTarget({ targetInput: analysisInput, settings: await getRuntimeSettings(authResult.settings) });
    }
  }

  function handleAnalyzeSuccess(nextReport: AnalysisReport, analysisInput: string, sourcePage: AppPage) {
    if (nextReport.targetCount > 0) {
      setReport(nextReport);
      saveLastAnalysisReport(nextReport);
      setAnalysisHistory(previousHistory => saveAnalysisHistory(upsertAnalysisHistory(previousHistory, analysisInput, nextReport)));
      setActivePage("result");
    }
    if (nextReport.targetCount) {
      updatePagesMessage(sourcePage === "analysis" ? ["analysis", "result"] : ["result"], "完成");
    } else {
      updatePageMessage(sourcePage, "请输入账号");
    }
  }

  function handleDeleteHistoryEntry(entryId: string) {
    setAnalysisHistory(previousHistory => saveAnalysisHistory(previousHistory.filter(entry => entry.id !== entryId)));
  }

  function handlePriceModeChange(priceMode: PriceMode) {
    if (priceMode === "historyLow" && !safeTrim(settings.itadApiKey)) {
      if (priceModeRevertTimerRef.current !== null) {
        window.clearTimeout(priceModeRevertTimerRef.current);
      }
      setPriceModeControlValue("historyLow");
      updatePageMessage("result", "缺少 ITAD Key");
      priceModeRevertTimerRef.current = window.setTimeout(() => {
        priceModeRevertTimerRef.current = null;
        setPriceModeControlValue("original");
      }, 260);
      return;
    }

    if (priceModeRevertTimerRef.current !== null) {
      window.clearTimeout(priceModeRevertTimerRef.current);
      priceModeRevertTimerRef.current = null;
    }
    setPriceModeControlValue(priceMode);
    const nextSettings = { ...settings, priceMode };
    settingsSaveMessagePageRef.current = "result";
    setSettings(nextSettings);
    void saveSettings(nextSettings);
    if (report && !reportHasPriceModeData(report, priceMode)) {
      void handleRefreshReportPrices(report, nextSettings);
    }
  }

  async function handleRefreshReportPrices(currentReport: AnalysisReport, nextSettings: AppSettings) {
    setBusy(true);
    updatePageMessage("result", "更新价格");
    try {
      const nextReport = await refreshReportPrices(currentReport, nextSettings);
      setReport(nextReport);
      saveLastAnalysisReport(nextReport);
      updatePageMessage("result", "已更新");
    } catch (error) {
      updatePageMessage("result", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleNavigatePage(page: AppPage) {
    startTransition(() => setActivePage(page));
  }

  async function syncNavLoginProfile() {
    const cache = await readSteamLoginCache();
    if (!cache) {
      return;
    }
    const steamid64 = safeTrim(cache.steamid64);
    if (!steamid64) {
      return;
    }
    if (hasCachedLoginProfile(cache)) {
      setNavLoginAccount(cache);
      return;
    }
    try {
      const profile = await fetchSteamLoginProfile(steamid64, safeTrim(cache.steamApiKey));
      const nextAccount: SteamLoginCache = {
        steamid64,
        accountName: cache?.accountName || "",
        displayName: profile.displayName,
        profileUrl: profile.profileUrl,
        avatar: profile.avatar,
        accessToken: cache?.accessToken || "",
        refreshToken: cache?.refreshToken || "",
        accessTokenExpiresAt: cache?.accessTokenExpiresAt || null,
        steamApiKey: cache?.steamApiKey || "",
        familyGroupId: cache?.familyGroupId || "",
        savedAt: Date.now()
      };
      if (cache) {
        await writeSteamLoginCache(nextAccount);
      }
      setNavLoginAccount(nextAccount);
    } catch {
      // Startup profile sync is best-effort; login page can retry with visible context.
    }
  }

  async function ensureSteamLoginFresh(currentSettings: AppSettings, messagePage: AppPage, options: AuthEnsureOptions = {}): Promise<AuthEnsureResult> {
    if (!options.forceRefresh && authRefreshInFlightRef.current) {
      return authRefreshInFlightRef.current;
    }
    const task = doEnsureSteamLoginFresh(currentSettings, messagePage, options).finally(() => {
      authRefreshInFlightRef.current = null;
    });
    if (!options.forceRefresh) {
      authRefreshInFlightRef.current = task;
    }
    return task;
  }

  async function doEnsureSteamLoginFresh(currentSettings: AppSettings, messagePage: AppPage, options: AuthEnsureOptions): Promise<AuthEnsureResult> {
    const persistedCache = await readSteamLoginCache();
    const cache = persistedCache || navLoginAccount;
    if (!cache) {
      return { ok: true, settings: currentSettings };
    }

    if (!options.forceRefresh && safeTrim(cache.accessToken)) {
      try {
        await validateFamilyAccessToken(applyLoginCacheToSettings(currentSettings, cache));
        await clearSteamLoginNotice();
        setLoginPersistentMessage("");
        return { ok: true, settings: currentSettings };
      } catch {
        // Token may be expired; try the remembered Steam login below.
      }
    }

    updatePageMessage(messagePage, options.statusMessage || "刷新登录");
    try {
      const refreshed = await refreshSteamLogin(cache.steamid64, cache.refreshToken);
      const loginResult = steamRefreshToPollResult(refreshed);
      let nextLoginCache: SteamLoginCache = {
        steamid64: refreshed.steamid64,
        accountName: cache.accountName,
        displayName: cache.displayName,
        profileUrl: cache.profileUrl,
        avatar: cache.avatar,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        steamApiKey: cache.steamApiKey,
        familyGroupId: cache.familyGroupId,
        savedAt: Date.now()
      };

      const detected = await fetchFamilyConfigFromSteamLogin(loginResult);
      nextLoginCache = {
        ...nextLoginCache,
        steamid64: detected.currentSteamId64 || refreshed.steamid64,
        accessToken: detected.accessToken || nextLoginCache.accessToken,
        familyGroupId: detected.familyGroupId || nextLoginCache.familyGroupId
      };
      if (options.required?.accessToken && !nextLoginCache.accessToken) {
        throw new Error("无法获取家庭库 Token");
      }
      const steamApiKey = await fetchSteamApiKeyFromSteamLogin(loginResult);
      if (options.required?.steamApiKey && !steamApiKey) {
        throw new Error("无法获取 API Key");
      }
      if (steamApiKey) {
        nextLoginCache = { ...nextLoginCache, steamApiKey };
      }
      if (persistedCache) {
        await writeSteamLoginCache(nextLoginCache);
      }
      setNavLoginAccount(nextLoginCache);
      await clearSteamLoginNotice();
      setLoginPersistentMessage("");
      settingsSaveMessagePageRef.current = messagePage;
      setSettings(currentSettings);
      await saveSettings(currentSettings);
      updatePageMessage(messagePage, "登录已刷新");
      return { ok: true, settings: currentSettings };
    } catch (error) {
      const message = `登录失效：${error instanceof Error ? error.message : String(error)}`;
      await writeSteamLoginNotice(message);
      setLoginPersistentMessage(message);
      updatePageMessage("login", message);
      return { ok: false, settings: currentSettings, message };
    }
  }

  function handleLogout() {
    void clearSteamLoginCache();
    void clearSteamLoginNotice();
    setNavLoginAccount(null);
    setLoginPersistentMessage("");
    const nextSettings = stripLoginDerivedSettings(settings);
    settingsSaveMessagePageRef.current = "login";
    setSettings(nextSettings);
    void saveSettings(nextSettings);
  }

  return (
    <AppShell className="app-shell" padding={0}>
      <div className="frameless-shell">
        <TitleBar />
        <div className="workbench">
          <aside className="activity-bar">
            <Tooltip label={loginNavLabel} position="right" withArrow openDelay={250}>
              <button
                type="button"
                className={`activity-logo activity-login-entry ${activePage === "login" ? "is-active" : ""} ${navLoginAccount ? "has-account" : ""}`}
                aria-label={loginNavLabel}
                onClick={() => handleNavigatePage("login")}
              >
                {navLoginAccount ? (
                  <NavLoginAvatar account={navLoginAccount} />
                ) : (
                  <ActivityIcon type="logo" />
                )}
              </button>
            </Tooltip>
            <Tooltip label="分析" position="right" withArrow openDelay={250}>
              <button
                type="button"
                className={`activity-item ${activePage === "analysis" ? "is-active" : ""}`}
                aria-label="分析"
                onClick={() => handleNavigatePage("analysis")}
              >
                <ActivityIcon type="analysis" />
              </button>
            </Tooltip>
            <Tooltip label="分析结果" position="right" withArrow openDelay={250}>
              <button
                type="button"
                className={`activity-item ${activePage === "result" ? "is-active" : ""}`}
                aria-label="分析结果"
                onClick={() => handleNavigatePage("result")}
              >
                <ActivityIcon type="result" />
              </button>
            </Tooltip>
            <Tooltip label="配置" position="right" withArrow openDelay={250}>
              <button
                type="button"
                className={`activity-item ${activePage === "settings" ? "is-active" : ""}`}
                aria-label="配置"
                onClick={() => handleNavigatePage("settings")}
              >
                <ActivityIcon type="settings" />
              </button>
            </Tooltip>
            <div className="activity-spacer" />
            <Tooltip label="帮助" position="right" withArrow openDelay={250}>
              <button type="button" className="activity-item" aria-label="帮助">
                <ActivityIcon type="help" />
              </button>
            </Tooltip>
          </aside>

          <main className="main-pane">
            <ScrollArea className={`editor-body ${activePage === "result" && report ? "is-result-view" : ""} ${activePage === "settings" ? "is-settings-view" : ""} ${activePage === "login" ? "is-login-view" : ""}`} type="auto" scrollbarSize={10}>
              <div className="page-stack">
                <div className={`page-slot ${activePage === "analysis" ? "is-active" : ""}`}>
                  <AnalysisPreparePage
                    targetInput={targetInput}
                    history={analysisHistory}
                    message={pageMessages.analysis}
                    busy={busy}
                    onTargetInputChange={setTargetInput}
                    onAnalyze={(inputOverride) => handleAnalyze(inputOverride, undefined, "analysis")}
                    onDeleteHistoryEntry={handleDeleteHistoryEntry}
                    onMessage={nextMessage => updatePageMessage("analysis", nextMessage)}
                  />
                </div>
                <div className={`page-slot ${activePage === "result" ? "is-active" : ""}`}>
                  {report ? (
                    <AnalysisResultPage
                      report={report}
                      message={pageMessages.result}
                      warningText={warningText}
                      priceLabel={priceLabel}
                      tablePriceLabel={tablePriceLabel}
                      settings={settings}
                      priceMode={settings.priceMode}
                      priceModeControlValue={priceModeControlValue}
                      hasHistoryLowApiKey={Boolean(safeTrim(settings.itadApiKey))}
                      viewState={resultViewState}
                      busy={busy}
                      onPriceModeChange={handlePriceModeChange}
                      onViewStateChange={setResultViewState}
                      onBack={() => handleNavigatePage("analysis")}
                      onAnalyze={(inputOverride) => handleAnalyze(inputOverride, undefined, "result")}
                      onMessage={nextMessage => updatePageMessage("result", nextMessage)}
                    />
                  ) : (
                    <EmptyResultPage onGoAnalysis={() => handleNavigatePage("analysis")} />
                  )}
                </div>
                <div className={`page-slot ${activePage === "login" ? "is-active" : ""}`}>
                  <LoginPage
                    isActive={activePage === "login"}
                    message={pageMessages.login}
                    persistentMessage={loginPersistentMessage}
                    onLoginAccountChange={handleLoginAccountChange}
                    onMessage={nextMessage => updatePageMessage("login", nextMessage)}
                    onLogout={handleLogout}
                  />
                </div>
                <div className={`page-slot ${activePage === "settings" ? "is-active" : ""}`}>
                  <SettingsPage
                    settings={settings}
                    status={status}
                    message={pageMessages.settings}
                    onSettingsChange={handleSettingsChange}
                    onMessage={nextMessage => updatePageMessage("settings", nextMessage)}
                  />
                </div>
              </div>
            </ScrollArea>

            <footer className="status-bar">
              {globalMessage ? <span>{globalMessage}</span> : null}
              <span>{settings.storeCountry}:{settings.locale}</span>
              <span>{priceLabel}</span>
            </footer>
          </main>
        </div>
      </div>
    </AppShell>
  );
}

function TitleBar() {
  async function handleTitleBarMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || event.detail > 1) {
      return;
    }

    const appWindow = getCurrentWindow();
    if (await appWindow.isMaximized()) {
      return;
    }

    await appWindow.startDragging();
  }

  async function handleTitleBarDoubleClick() {
    await getCurrentWindow().toggleMaximize();
  }

  return (
    <header
      className="titlebar"
      onMouseDown={event => void handleTitleBarMouseDown(event).catch(() => undefined)}
      onDoubleClick={() => void handleTitleBarDoubleClick().catch(() => undefined)}
    >
      <div className="titlebar-brand">Steam 家庭库分析器</div>
      <div className="titlebar-drag-region" />
      <div className="window-controls" onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <button type="button" aria-label="最小化" onClick={() => void getCurrentWindow().minimize().catch(() => undefined)}>
          <WindowControlIcon type="minimize" />
        </button>
        <button type="button" aria-label="最大化" onClick={() => void getCurrentWindow().toggleMaximize().catch(() => undefined)}>
          <WindowControlIcon type="maximize" />
        </button>
        <button type="button" className="is-close" aria-label="关闭" onClick={() => void getCurrentWindow().close().catch(() => undefined)}>
          <WindowControlIcon type="close" />
        </button>
      </div>
    </header>
  );
}

function NavLoginAvatar({ account }: { account: SteamLoginCache }) {
  const label = getLoginNavLabel(account);
  if (account.avatar) {
    return <img src={account.avatar} alt={label} />;
  }
  return <span>{label.slice(0, 1).toUpperCase()}</span>;
}

function getLoginNavLabel(account: SteamLoginCache) {
  return account.displayName || account.accountName || account.steamid64 || "Steam 账号";
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

function hasLoginDerivedSettings(settings: AppSettings) {
  return Boolean(
    safeTrim(settings.steamApiKey) ||
    safeTrim(settings.currentSteamId64) ||
    safeTrim(settings.familyAccessToken) ||
    safeTrim(settings.familyGroupId)
  );
}

function applyLoginCacheToSettings(settings: AppSettings, cache: SteamLoginCache | null): AppSettings {
  if (!cache) {
    return stripLoginDerivedSettings(settings);
  }
  return {
    ...stripLoginDerivedSettings(settings),
    steamApiKey: cache.steamApiKey,
    currentSteamId64: cache.steamid64,
    familyAccessToken: cache.accessToken,
    familyGroupId: cache.familyGroupId
  };
}

function hasCachedLoginProfile(account: SteamLoginCache) {
  return Boolean(safeTrim(account.displayName) || safeTrim(account.avatar));
}

function safeTrim(value: string | null | undefined) {
  return value?.trim() || "";
}

function steamRefreshToPollResult(refreshed: SteamLoginRefreshResult): SteamQrLoginPollResult {
  return {
    status: "confirmed",
    steamid64: refreshed.steamid64,
    accountName: "",
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
    message: "Steam 登录态已刷新"
  };
}

function getTokenRefreshNeed(message: string): AuthRefreshNeed | null {
  const normalized = message.toLowerCase();
  if (message.includes("HTTP 403") || message.includes("访问被拒绝") || message.includes("私密资料")) {
    return null;
  }
  const need: AuthRefreshNeed = {
    steamApiKey: false,
    accessToken: false
  };
  if (message.includes("Steam Web API Key")) {
    need.steamApiKey = true;
  }
  if (message.includes("家庭库 Access Token") || normalized.includes("家庭库 access token")) {
    need.accessToken = true;
  }
  if (normalized.includes("access token")) {
    need.accessToken = true;
  }
  if (normalized.includes("http 401") && !need.steamApiKey && !need.accessToken) {
    need.steamApiKey = true;
  }
  return need.steamApiKey || need.accessToken ? need : null;
}

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) {
  throw new Error("Missing #app");
}

createRoot(rootElement).render(
  <MantineProvider theme={theme} defaultColorScheme="light">
    <App />
  </MantineProvider>
);
