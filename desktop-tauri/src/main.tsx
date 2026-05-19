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
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { AnalysisReport, AppSettings, AppStatus, PriceMode } from "./types";
import { analyzeTarget, getAppStatus, loadSettings, refreshReportPrices, saveSettings } from "./services/desktop";
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
import { ActivityIcon, WindowControlIcon } from "./components/icons";
import { AnalysisPreparePage } from "./pages/AnalysisPreparePage";
import { AnalysisResultPage, EmptyResultPage } from "./pages/AnalysisResultPage";
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
  cacheDirectory: ""
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
  const [pageMessages, setPageMessages] = useState<PageMessageState>({
    analysis: "",
    result: restoredReport ? "已恢复上次分析结果" : "暂无分析结果",
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

  async function bootstrap() {
    try {
      const [nextStatus, savedSettings] = await Promise.all([
        getAppStatus(),
        loadSettings(defaultSettings)
      ]);
      setStatus(nextStatus);
      setSettings(savedSettings);
      setPriceModeControlValue(savedSettings.priceMode);
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
    const analysisSettings = settingsOverride || settings;
    setBusy(true);
    updatePageMessage(sourcePage, "正在请求 Steam Web API");
    try {
      await saveSettings(analysisSettings);
      const nextReport = await analyzeTarget({ targetInput: analysisInput, settings: analysisSettings });
      if (nextReport.targetCount > 0) {
        setReport(nextReport);
        saveLastAnalysisReport(nextReport);
        setAnalysisHistory(previousHistory => saveAnalysisHistory(upsertAnalysisHistory(previousHistory, analysisInput, nextReport)));
        setActivePage("result");
      }
      if (nextReport.targetCount) {
        updatePagesMessage(sourcePage === "analysis" ? ["analysis", "result"] : ["result"], "目标公开游戏库读取完成");
      } else {
        updatePageMessage(sourcePage, "请输入至少一个目标账号");
      }
    } catch (error) {
      updatePageMessage(sourcePage, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleDeleteHistoryEntry(entryId: string) {
    setAnalysisHistory(previousHistory => saveAnalysisHistory(previousHistory.filter(entry => entry.id !== entryId)));
  }

  function handlePriceModeChange(priceMode: PriceMode) {
    if (priceMode === "historyLow" && !settings.itadApiKey.trim()) {
      if (priceModeRevertTimerRef.current !== null) {
        window.clearTimeout(priceModeRevertTimerRef.current);
      }
      setPriceModeControlValue("historyLow");
      updatePageMessage("result", "史低需要先在配置中填写 IsThereAnyDeal API Key");
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
    updatePageMessage("result", "正在更新价格");
    try {
      const nextReport = await refreshReportPrices(currentReport, nextSettings);
      setReport(nextReport);
      saveLastAnalysisReport(nextReport);
      updatePageMessage("result", "价格已更新");
    } catch (error) {
      updatePageMessage("result", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleNavigatePage(page: AppPage) {
    startTransition(() => setActivePage(page));
  }

  return (
    <AppShell className="app-shell" padding={0}>
      <div className="frameless-shell">
        <TitleBar />
        <div className="workbench">
          <aside className="activity-bar">
            <Tooltip label="Steam 家庭库分析器" position="right" withArrow openDelay={250}>
              <div className="activity-logo" aria-label="应用">
                <ActivityIcon type="logo" />
              </div>
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
            <ScrollArea className={`editor-body ${activePage === "result" && report ? "is-result-view" : ""} ${activePage === "settings" ? "is-settings-view" : ""}`} type="auto" scrollbarSize={10}>
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
                      hasHistoryLowApiKey={Boolean(settings.itadApiKey.trim())}
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

const rootElement = document.querySelector<HTMLDivElement>("#app");
if (!rootElement) {
  throw new Error("Missing #app");
}

createRoot(rootElement).render(
  <MantineProvider theme={theme} defaultColorScheme="light">
    <App />
  </MantineProvider>
);
