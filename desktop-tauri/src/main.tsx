import "@mantine/core/styles.css";
import "./styles.css";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ActionIcon,
  AppShell,
  Avatar,
  Button,
  Divider,
  Group,
  MantineProvider,
  PasswordInput,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  createTheme
} from "@mantine/core";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import type { AnalysisReport, AppSettings, AppStatus, LocaleMode, PriceInfo, PriceMode, ReportGame, ReportGameStatus, TargetProfile } from "./types";
import { analyzeTarget, clearCache, getAppStatus, loadSettings, saveSettings, startBrowserConfigCallback } from "./services/desktop";
import type { AutoSteamConfigResult } from "./types";

const analysisHistoryKey = "sffa.desktop.analysisInputHistory";
const lastAnalysisReportKey = "sffa.desktop.lastAnalysisReport";
let initialLastAnalysisReport: AnalysisReport | null | undefined;

const defaultSettings: AppSettings = {
  steamApiKey: "",
  itadApiKey: "",
  currentSteamId64: "",
  familyAccessToken: "",
  familyGroupId: "",
  storeCountry: "CN",
  locale: "auto",
  priceMode: "original"
};

type AppPage = "analysis" | "result" | "settings";

type AnalysisHistoryEntry = {
  id: string;
  inputValue: string;
  accounts: AnalysisHistoryAccount[];
  updatedAt: number;
};

type AnalysisHistoryAccount = {
  displayName: string;
  steamid64: string;
};

type ResultGameRow = {
  appid: string;
  name: string;
  storeLink: string;
  coverUrl: string;
  ownerNames: string[];
  ownerIds: string[];
  familyOwners: string[];
  familyOwnerNames: string[];
  price: PriceInfo | null;
  status: ReportGameStatus;
};

type ResultGameListKey = "all" | "new" | "relativeNew" | "overlap";
type ResultGameSortKey = "nameAsc" | "priceDesc" | "priceAsc" | "ownersDesc" | "ownersAsc";
type ResultGameViewMode = "cover" | "table";
type TableSortDirection = "asc" | "desc";
type TableSortState = {
  key: string;
  direction: TableSortDirection;
};

type GameContextMenuState = {
  x: number;
  y: number;
  game: ResultGameRow;
};

type HistoryContextMenuState = {
  x: number;
  y: number;
  entry: AnalysisHistoryEntry;
};

type MoreMenuState = {
  x: number;
  y: number;
};

type MetricTooltipRow = {
  label: string;
  value: string;
};

type ResultMetric = {
  label: string;
  value: string;
  tooltipRows: MetricTooltipRow[];
};

type OwnerTagItem = {
  id: string;
  label: string;
};

type GameTableColumn = {
  key: string;
  label: string;
  className?: string;
  sortable?: boolean;
  render: (game: ResultGameRow) => ReactNode;
};

const helpLinks = {
  steamApiKey: {
    url: "https://steamcommunity.com/dev/apikey",
    steps: [
      "1. 打开 Steam Web API Key 页面，并确认已登录要用于分析的 Steam 账号。",
      "2. 如果页面已经显示 Key，复制那串 32 位密钥；如果还没有 Key，按页面提示注册域名后再复制。",
      "3. 回到这里手动粘贴 Key。这个字段不会由自动配置脚本读取。"
    ]
  },
  itadApiKey: {
    url: "https://isthereanydeal.com/apps/",
    steps: [
      "1. 打开 IsThereAnyDeal Apps 页面，并登录你的 ITAD 账号。",
      "2. 创建一个应用，或进入已有应用详情，找到 API Key。",
      "3. 复制完整 Key 后粘贴到这里；只有使用 Steam 史低价格模式时才需要它。"
    ]
  },
  currentSteamId64: {
    url: "https://steamid.io/",
    steps: [
      "1. 打开 SteamID 查询页。",
      "2. 粘贴你的 Steam 个人主页地址、好友码或自定义 ID 并查询。",
      "3. 复制结果里的 steamID64，也就是 17 位数字，粘贴到这里。"
    ]
  },
  familyAccessToken: {
    url: "https://store.steampowered.com/account/familymanagement",
    steps: [
      "1. 优先点击上方“前往获取”，它会打开 Steam 家庭管理页并复制一次性脚本。",
      "2. 在已登录 Steam 的家庭管理页，把脚本粘贴到地址栏或控制台执行。",
      "3. 成功后桌面端会自动回填 Access Token、SteamID64 和家庭组 ID。"
    ]
  }
} as const;

const browserConfigHelpSteps = [
  "1. 点击“前往获取”后，桌面端会启动 10 分钟本地回调，并把一次性脚本复制到剪贴板。",
  "2. 浏览器打开 Steam 家庭管理页后，确认已登录，再把剪贴板里的脚本粘贴到地址栏或控制台执行。",
  "3. 执行成功后会自动回填家庭库 Access Token、当前 SteamID64 和家庭组 ID；Steam Web API Key 仍需在字段旁帮助页手动复制。"
];

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
  const [message, setMessage] = useState("准备就绪");
  const [activePage, setActivePage] = useState<AppPage>(restoredReport ? "result" : "analysis");
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryEntry[]>(() => loadAnalysisHistory());
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, []);

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
      void saveSettings(settings);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [settings, settingsReady]);

  const priceLabel = settings.priceMode === "historyLow" ? "Steam 史低" : "Steam 原价";
  const tablePriceLabel = settings.priceMode === "historyLow" ? "史低" : "原价";
  const warningText = useMemo(() => report?.warnings.join("；") || "", [report]);

  async function bootstrap() {
    const [nextStatus, savedSettings] = await Promise.all([
      getAppStatus(),
      loadSettings(defaultSettings)
    ]);
    setStatus(nextStatus);
    setSettings(savedSettings);
    setSettingsReady(true);
  }

  async function handleAnalyze(inputOverride?: string) {
    const analysisInput = inputOverride ?? targetInput;
    setBusy(true);
    setMessage("正在请求 Steam Web API");
    try {
      await saveSettings(settings);
      const nextReport = await analyzeTarget({ targetInput: analysisInput, settings });
      if (nextReport.targetCount > 0) {
        setReport(nextReport);
        saveLastAnalysisReport(nextReport);
        setAnalysisHistory(previousHistory => saveAnalysisHistory(upsertAnalysisHistory(previousHistory, analysisInput, nextReport)));
        setActivePage("result");
      }
      setMessage(nextReport.targetCount ? "目标公开游戏库读取完成" : "请输入至少一个目标账号");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function handleDeleteHistoryEntry(entryId: string) {
    setAnalysisHistory(previousHistory => saveAnalysisHistory(previousHistory.filter(entry => entry.id !== entryId)));
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
                onClick={() => setActivePage("analysis")}
              >
                <ActivityIcon type="analysis" />
              </button>
            </Tooltip>
            <Tooltip label="分析结果" position="right" withArrow openDelay={250}>
              <button
                type="button"
                className={`activity-item ${activePage === "result" ? "is-active" : ""}`}
                aria-label="分析结果"
                onClick={() => setActivePage("result")}
              >
                <ActivityIcon type="result" />
              </button>
            </Tooltip>
            <Tooltip label="配置" position="right" withArrow openDelay={250}>
              <button
                type="button"
                className={`activity-item ${activePage === "settings" ? "is-active" : ""}`}
                aria-label="配置"
                onClick={() => setActivePage("settings")}
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
            <ScrollArea className={`editor-body ${activePage === "result" && report ? "is-result-view" : ""}`} type="auto" scrollbarSize={10}>
              {activePage === "analysis" ? (
                <AnalysisPreparePage
                  targetInput={targetInput}
                  history={analysisHistory}
                  message={message}
                  busy={busy}
                  onTargetInputChange={setTargetInput}
                  onAnalyze={handleAnalyze}
                  onDeleteHistoryEntry={handleDeleteHistoryEntry}
                  onMessage={setMessage}
                />
              ) : activePage === "result" ? (
                report ? (
                  <AnalysisResultPage
                    report={report}
                    message={message}
                    warningText={warningText}
                    priceLabel={priceLabel}
                    tablePriceLabel={tablePriceLabel}
                    busy={busy}
                    onBack={() => setActivePage("analysis")}
                    onAnalyze={handleAnalyze}
                    onMessage={setMessage}
                  />
                ) : (
                  <EmptyResultPage onGoAnalysis={() => setActivePage("analysis")} />
                )
              ) : (
                <SettingsPage
                  settings={settings}
                  status={status}
                  onSettingsChange={setSettings}
                />
              )}
            </ScrollArea>

            <footer className="status-bar">
              <span>{message}</span>
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

function WindowControlIcon({ type }: { type: "minimize" | "maximize" | "close" }) {
  if (type === "minimize") {
    return (
      <svg className="window-control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2.25 6.5h7.5" />
      </svg>
    );
  }

  if (type === "maximize") {
    return (
      <svg className="window-control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <rect x="2.75" y="2.75" width="6.5" height="6.5" rx="0.5" />
      </svg>
    );
  }

  return (
    <svg className="window-control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3 3l6 6M9 3L3 9" />
    </svg>
  );
}

function ActivityIcon({ type }: { type: "logo" | "analysis" | "result" | "settings" | "help" }) {
  if (type === "logo") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path d="M3.25 9.5a5.75 5.75 0 1 1 2.18 4.5" />
        <path d="M3.25 12.5h4.5a3 3 0 0 0 0-6H6.5" />
      </svg>
    );
  }

  if (type === "analysis") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path d="M3.25 14.25h11.5" />
        <path d="M5 11.5V7.75" />
        <path d="M9 11.5V4" />
        <path d="M13 11.5V6" />
      </svg>
    );
  }

  if (type === "result") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <path d="M4 3.5h7.25L14 6.25v8.25H4z" />
        <path d="M11.25 3.5v2.75H14" />
        <path d="M6.25 8.25h5.5" />
        <path d="M6.25 10.75h5.5" />
        <path d="M6.25 13.25h3.25" />
      </svg>
    );
  }

  if (type === "settings") {
    return (
      <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
        <circle cx="9" cy="9" r="2.1" />
        <path d="M9 2.75v2" />
        <path d="M9 13.25v2" />
        <path d="M3.59 5.88l1.73 1" />
        <path d="M12.68 11.13l1.73 1" />
        <path d="M3.59 12.12l1.73-1" />
        <path d="M12.68 6.87l1.73-1" />
      </svg>
    );
  }

  return (
    <svg className="activity-icon" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle cx="9" cy="9" r="6.25" />
      <path d="M7.35 7.2a1.8 1.8 0 1 1 2.7 1.56c-.7.42-1.05.84-1.05 1.74" />
      <path d="M9 13.05h.01" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg className="field-help-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" />
      <path d="M6.55 6.55a1.55 1.55 0 1 1 2.3 1.36c-.58.36-.85.72-.85 1.49" />
      <path d="M8 11.75h.01" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="more-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="4" cy="8" r="1.15" />
      <circle cx="8" cy="8" r="1.15" />
      <circle cx="12" cy="8" r="1.15" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="history-delete-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.25 4.25h9.5" />
      <path d="M6.25 4.25V3h3.5v1.25" />
      <path d="M5 6.25l.35 6.25h5.3L11 6.25" />
      <path d="M7.1 7.25v3.9" />
      <path d="M8.9 7.25v3.9" />
    </svg>
  );
}

function SettingsPage({
  settings,
  status,
  onSettingsChange
}: {
  settings: AppSettings;
  status: AppStatus | null;
  onSettingsChange: (settings: AppSettings) => void;
}) {
  return (
    <div className="settings-workspace">
      <div className="main-heading settings-heading">
        <Stack gap={1}>
          <Text component="h1" className="title">配置</Text>
          <Text size="sm" c="dimmed">管理 Steam Web API、IsThereAnyDeal、地区、语言和价格口径。</Text>
        </Stack>
      </div>

      <section className="settings-page-panel">
        <SettingsPanel
          settings={settings}
          status={status}
          onSettingsChange={onSettingsChange}
        />
      </section>
    </div>
  );
}

function SettingsPanel({
  settings,
  status,
  onSettingsChange
}: {
  settings: AppSettings;
  status: AppStatus | null;
  onSettingsChange: (settings: AppSettings) => void;
}) {
  const [draftSettings, setDraftSettings] = useState(settings);
  const [autoDetectBusy, setAutoDetectBusy] = useState(false);
  const [autoDetectMessage, setAutoDetectMessage] = useState("");
  const latestDraftRef = useRef(draftSettings);

  useEffect(() => {
    latestDraftRef.current = settings;
    setDraftSettings(settings);
  }, [settings]);

  useEffect(() => {
    latestDraftRef.current = draftSettings;
  }, [draftSettings]);

  useEffect(() => {
    return () => onSettingsChange(latestDraftRef.current);
  }, [onSettingsChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onSettingsChange(draftSettings);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [
    draftSettings.steamApiKey,
    draftSettings.itadApiKey,
    draftSettings.currentSteamId64,
    draftSettings.familyAccessToken,
    draftSettings.familyGroupId,
    draftSettings.storeCountry,
    onSettingsChange
  ]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AutoSteamConfigResult>("steam-auto-config-detected", event => {
      const changed = applyDetectedSteamConfig(event.payload);
      setAutoDetectMessage(`${event.payload.messages.join("；")}；${changed ? "已自动回填到配置。" : "没有新的可回填配置。"}`);
    }).then(nextUnlisten => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    }).catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const updateDraft = <K extends keyof AppSettings>(key: K, value: AppSettings[K], commitNow = false) => {
    const nextSettings = { ...latestDraftRef.current, [key]: value };
    latestDraftRef.current = nextSettings;
    setDraftSettings(nextSettings);
    if (commitNow) {
      onSettingsChange(nextSettings);
    }
  };

  function applyDetectedSteamConfig(detected: AutoSteamConfigResult): boolean {
    const nextSettings = {
      ...latestDraftRef.current,
      familyAccessToken: detected.familyAccessToken || latestDraftRef.current.familyAccessToken,
      currentSteamId64: detected.currentSteamId64 || latestDraftRef.current.currentSteamId64,
      familyGroupId: detected.familyGroupId || latestDraftRef.current.familyGroupId
    };
    const changed = JSON.stringify(nextSettings) !== JSON.stringify(latestDraftRef.current);
    if (changed) {
      latestDraftRef.current = nextSettings;
      setDraftSettings(nextSettings);
      onSettingsChange(nextSettings);
    }
    return changed;
  }

  async function handleStartBrowserCallback() {
    setAutoDetectBusy(true);
    setAutoDetectMessage("正在启动本地回调服务");
    try {
      const session = await startBrowserConfigCallback();
      await writeClipboard(session.bookmarklet);
      await openHelpUrl(session.steamStoreUrl);
      setAutoDetectMessage(`已复制一次性书签脚本，并打开 Steam 家庭管理页。本地回调将在 ${Math.floor(session.expiresInSeconds / 60)} 分钟后过期：请在已登录页面把脚本粘贴到地址栏或控制台执行；Steam Web API Key 请点击字段旁帮助自行复制。`);
    } catch (error) {
      setAutoDetectMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutoDetectBusy(false);
    }
  }

  return (
    <div className="settings-pane">
      <Stack gap="md">
        <Group justify="space-between" align="center" className="settings-auto-row">
          <Text fw={700}>Steam 自动配置</Text>
          <Tooltip
            label={<HelpSteps steps={browserConfigHelpSteps} />}
            multiline
            w={360}
            withArrow
          >
            <Button
              size="xs"
              color="steamBlue"
              loading={autoDetectBusy}
              onClick={() => void handleStartBrowserCallback()}
            >
              前往获取
            </Button>
          </Tooltip>
        </Group>
        {autoDetectMessage ? (
          <Text size="xs" className="settings-auto-status">{autoDetectMessage}</Text>
        ) : null}
        <PasswordInput
          label={<FieldLabel label="Steam Web API Key" helpKey="steamApiKey" />}
          value={draftSettings.steamApiKey}
          onBlur={() => onSettingsChange(latestDraftRef.current)}
          onChange={event => updateDraft("steamApiKey", event.currentTarget.value)}
          autoComplete="off"
        />
        <PasswordInput
          label={<FieldLabel label="IsThereAnyDeal API Key" helpKey="itadApiKey" />}
          value={draftSettings.itadApiKey}
          onBlur={() => onSettingsChange(latestDraftRef.current)}
          onChange={event => updateDraft("itadApiKey", event.currentTarget.value)}
          autoComplete="off"
        />
        <TextInput
          label={<FieldLabel label="当前 SteamID64" helpKey="currentSteamId64" />}
          value={draftSettings.currentSteamId64}
          onBlur={() => onSettingsChange(latestDraftRef.current)}
          onChange={event => updateDraft("currentSteamId64", event.currentTarget.value.trim())}
        />
        <PasswordInput
          label={<FieldLabel label="家庭库 Access Token" helpKey="familyAccessToken" />}
          value={draftSettings.familyAccessToken}
          onBlur={() => onSettingsChange(latestDraftRef.current)}
          onChange={event => updateDraft("familyAccessToken", event.currentTarget.value.trim())}
          autoComplete="off"
        />
        <TextInput
          label="家庭组 ID（可留空自动获取）"
          value={draftSettings.familyGroupId}
          onBlur={() => onSettingsChange(latestDraftRef.current)}
          onChange={event => updateDraft("familyGroupId", event.currentTarget.value.trim())}
        />

        <SimpleGrid cols={2} spacing="xs">
          <TextInput
            label="地区"
            value={draftSettings.storeCountry}
            maxLength={2}
            onBlur={() => onSettingsChange(latestDraftRef.current)}
            onChange={event => updateDraft("storeCountry", event.currentTarget.value.trim().toUpperCase())}
          />
          <Select
            label="语言"
            value={draftSettings.locale}
            data={[
              { value: "auto", label: "自动" },
              { value: "zh-CN", label: "中文" },
              { value: "en", label: "English" }
            ]}
            onChange={value => updateDraft("locale", (value || "auto") as LocaleMode, true)}
          />
        </SimpleGrid>

        <SegmentedControl
          className="price-mode-control"
          color="steamBlue"
          value={draftSettings.priceMode}
          data={[
            { value: "original", label: "原价" },
            { value: "historyLow", label: "史低" }
          ]}
          onChange={value => updateDraft("priceMode", value as PriceMode, true)}
        />

        <Divider />
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={700}>缓存目录</Text>
          <Text size="xs" className="path-text">{status?.cacheDirectory || "-"}</Text>
        </Stack>
      </Stack>
    </div>
  );
}

function AnalysisPreparePage({
  targetInput,
  history,
  message,
  busy,
  onTargetInputChange,
  onAnalyze,
  onDeleteHistoryEntry,
  onMessage
}: {
  targetInput: string;
  history: AnalysisHistoryEntry[];
  message: string;
  busy: boolean;
  onTargetInputChange: (value: string) => void;
  onAnalyze: (inputOverride?: string) => Promise<void>;
  onDeleteHistoryEntry: (entryId: string) => void;
  onMessage: (message: string) => void;
}) {
  const [historyContextMenu, setHistoryContextMenu] = useState<HistoryContextMenuState | null>(null);

  useEffect(() => {
    if (!historyContextMenu) {
      return;
    }

    const closeContextMenu = () => setHistoryContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [historyContextMenu]);

  function handleHistoryContextMenu(event: MouseEvent<HTMLElement>, entry: AnalysisHistoryEntry) {
    event.preventDefault();
    event.stopPropagation();
    setHistoryContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 72),
      entry
    });
  }

  async function handleCopyHistoryEntry(entry: AnalysisHistoryEntry) {
    await writeClipboard(formatHistoryAnalysisInput(entry));
    setHistoryContextMenu(null);
    onMessage("已复制历史分析账号");
  }

  return (
    <div className="analysis-prepare-layout">
      <aside className="history-pane">
        <Group justify="space-between" align="center" className="history-head">
          <Text fw={700}>历史分析</Text>
        </Group>
        <ScrollArea className="history-scroll">
          <Stack gap={4}>
            {history.length ? history.map(entry => (
              <div
                key={entry.id}
                className="history-item"
                onContextMenu={event => handleHistoryContextMenu(event, entry)}
              >
                <button
                  type="button"
                  className="history-item-main"
                  disabled={busy}
                  onClick={() => void onAnalyze(entry.inputValue)}
                >
                  <span className="history-item-copy">
                    <span className="history-item-name">{formatHistoryAccountNames(entry)}</span>
                    <span className="history-item-id">{formatHistoryAccountIds(entry)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="history-delete"
                  aria-label="删除历史分析"
                  onClick={() => onDeleteHistoryEntry(entry.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            )) : (
              <Text className="history-empty" c="dimmed" size="sm">暂无历史分析</Text>
            )}
          </Stack>
        </ScrollArea>
        {historyContextMenu ? (
          <HistoryContextMenu
            state={historyContextMenu}
            onCopy={entry => void handleCopyHistoryEntry(entry).catch(error => onMessage(String(error)))}
          />
        ) : null}
      </aside>

      <section className="analysis-draft-pane">
        <section className="input-pane">
          <Group justify="space-between" mb="xs" align="flex-start">
            <Stack gap={2}>
              <Text component="h1" className="title">账号分析</Text>
              <Text className={`inline-status ${message.includes("失败") || message.includes("错误") ? "is-error" : ""}`} size="xs">
                {message}
              </Text>
            </Stack>
            <Button color="steamBlue" loading={busy} onClick={() => void onAnalyze()}>开始分析</Button>
          </Group>
          <Textarea
            minRows={6}
            autosize
            value={targetInput}
            onChange={event => onTargetInputChange(event.currentTarget.value)}
            placeholder="SteamID64、好友码、个人主页 URL 或自定义 ID；多个账号用空格或换行分隔"
          />
        </section>

        <section className="analysis-blank-pane" aria-label="预留区域" />
      </section>
    </div>
  );
}

function EmptyResultPage({ onGoAnalysis }: { onGoAnalysis: () => void }) {
  return (
    <div className="empty-result-page">
      <Stack gap={12} align="center" maw={460}>
        <Text component="h1" className="title">暂无分析结果</Text>
        <Button color="steamBlue" onClick={onGoAnalysis}>
          前往分析
        </Button>
      </Stack>
    </div>
  );
}

function AnalysisResultPage({
  report,
  message,
  warningText,
  priceLabel,
  tablePriceLabel,
  busy,
  onBack,
  onAnalyze,
  onMessage
}: {
  report: AnalysisReport;
  message: string;
  warningText: string;
  priceLabel: string;
  tablePriceLabel: string;
  busy: boolean;
  onBack: () => void;
  onAnalyze: (inputOverride?: string) => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGameList, setActiveGameList] = useState<ResultGameListKey>("all");
  const [sortKey, setSortKey] = useState<ResultGameSortKey>("nameAsc");
  const [viewMode, setViewMode] = useState<ResultGameViewMode>("cover");
  const [showAppId, setShowAppId] = useState(false);
  const [tableSortByList, setTableSortByList] = useState<Partial<Record<ResultGameListKey, TableSortState>>>({});
  const [coverReloadTokens, setCoverReloadTokens] = useState<Record<string, number>>({});
  const [gameContextMenu, setGameContextMenu] = useState<GameContextMenuState | null>(null);
  const [moreMenu, setMoreMenu] = useState<MoreMenuState | null>(null);
  const resultMetrics = useMemo(() => buildResultMetrics(report), [report]);
  const games = useMemo(() => buildResultGameRows(report.games[activeGameList]), [activeGameList, report]);
  const filteredGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return games;
    }
    return games.filter(game => game.name.toLowerCase().includes(query) || game.appid.includes(query));
  }, [games, searchQuery]);
  const visibleGames = useMemo(() => {
    if (viewMode === "table") {
      return sortTableGameRows(filteredGames, tableSortByList[activeGameList]);
    }
    return sortResultGameRows(filteredGames, sortKey);
  }, [activeGameList, filteredGames, sortKey, tableSortByList, viewMode]);

  useEffect(() => {
    if (!gameContextMenu) {
      return;
    }

    const closeContextMenu = () => setGameContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [gameContextMenu]);

  useEffect(() => {
    if (!moreMenu) {
      return;
    }

    const closeMoreMenu = () => setMoreMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMoreMenu();
      }
    };

    window.addEventListener("pointerdown", closeMoreMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMoreMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreMenu]);

  function handleGameContextMenu(event: MouseEvent<HTMLElement>, game: ResultGameRow) {
    event.preventDefault();
    event.stopPropagation();
    setGameContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 96),
      game
    });
  }

  function handleRefreshCover(game: ResultGameRow) {
    setCoverReloadTokens(tokens => ({
      ...tokens,
      [game.appid]: Date.now()
    }));
    setGameContextMenu(null);
  }

  function handleMoreMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreMenu(current => current ? null : {
      x: Math.max(12, Math.min(rect.right - 190, window.innerWidth - 206)),
      y: Math.min(rect.bottom + 8, window.innerHeight - 184)
    });
  }

  function handleToggleAppId() {
    const nextShowAppId = !showAppId;
    setShowAppId(nextShowAppId);
    if (!nextShowAppId && tableSortByList[activeGameList]?.key === "appid") {
      setTableSortByList(current => {
        const next = { ...current };
        delete next[activeGameList];
        return next;
      });
    }
  }

  function handleTableSort(columnKey: string) {
    setTableSortByList(current => {
      const previous = current[activeGameList];
      const direction: TableSortDirection = previous?.key === columnKey && previous.direction === "asc" ? "desc" : "asc";
      return {
        ...current,
        [activeGameList]: { key: columnKey, direction }
      };
    });
  }

  async function handleCopyCurrentList() {
    await writeClipboard(formatGameListText(visibleGames));
    onMessage(`已复制当前列表：${visibleGames.length} 个游戏`);
  }

  async function handleCopyReport() {
    await writeClipboard(formatReportText(report));
    onMessage("已复制分析报告");
  }

  async function handleClearCache() {
    await clearCache();
    onMessage("缓存已清理，下次分析会重新请求商店与价格数据");
  }

  return (
    <div className="analysis-result-layout">
      <aside className="result-data-pane">
        <div className="result-data-head">
          <Stack gap={2}>
            <Text component="h1" className="title">分析结果</Text>
            <Text className={`inline-status ${message.includes("失败") || message.includes("错误") ? "is-error" : ""}`} size="xs">
              {message}
            </Text>
          </Stack>
          <div className="result-actions">
            <Button size="xs" variant="subtle" color="steamBlue" onClick={onBack}>返回</Button>
            <Button size="xs" color="steamBlue" variant="light" loading={busy} onClick={() => void onAnalyze(buildReportTargetInput(report))}>
              重新分析
            </Button>
          </div>
        </div>

        <div className="result-metrics">
          {resultMetrics.map(metric => (
            <Metric
              key={metric.label}
              label={metric.label}
              value={metric.value}
              tooltipRows={metric.tooltipRows}
            />
          ))}
        </div>

        <section className="result-targets">
          <Group justify="space-between" className="result-head">
            <Text fw={700}>目标账号</Text>
            {warningText ? <Text size="xs" c="orange">{warningText}</Text> : null}
          </Group>
          <ScrollArea.Autosize mah={360}>
            <Stack gap={0}>
              {report.targets.map(target => <TargetRow key={target.steamid64 || target.displayName} target={target} />)}
            </Stack>
          </ScrollArea.Autosize>
        </section>
      </aside>

      <section className="result-games-pane">
        <Group justify="space-between" align="flex-start" className="game-list-head">
          <Stack gap={0} className="game-list-primary">
            <SegmentedControl
              className="game-list-tabs"
              size="xs"
              color="steamBlue"
              value={activeGameList}
              data={[
                { value: "all", label: `全部 ${report.games.all.length}` },
                { value: "new", label: `新增 ${report.games.new.length}` },
                { value: "relativeNew", label: `相对新增 ${report.games.relativeNew.length}` },
                { value: "overlap", label: `重复 ${report.games.overlap.length}` }
              ]}
              onChange={value => setActiveGameList(value as ResultGameListKey)}
            />
          </Stack>
          <div className="game-list-tools">
            <SegmentedControl
              className="game-view-toggle"
              size="xs"
              color="steamBlue"
              value={viewMode}
              data={[
                { value: "cover", label: "封面" },
                { value: "table", label: "表格" }
              ]}
              onChange={value => setViewMode(value as ResultGameViewMode)}
            />
            <Select
              className="game-sort"
              size="xs"
              value={sortKey}
              data={[
                { value: "nameAsc", label: "名称 A-Z" },
                { value: "priceDesc", label: "价格从高到低" },
                { value: "priceAsc", label: "价格从低到高" },
                { value: "ownersDesc", label: "拥有者多到少" },
                { value: "ownersAsc", label: "拥有者少到多" }
              ]}
              onChange={value => setSortKey((value || "nameAsc") as ResultGameSortKey)}
              allowDeselect={false}
            />
            <TextInput
              className="game-search"
              size="xs"
              value={searchQuery}
              onChange={event => setSearchQuery(event.currentTarget.value)}
              placeholder="搜索游戏名或 AppID"
            />
            <ActionIcon
              className="more-menu-button"
              size={30}
              radius="md"
              variant="light"
              color="steamBlue"
              aria-label="更多"
              onClick={handleMoreMenu}
            >
              <MoreIcon />
            </ActionIcon>
          </div>
        </Group>

        {visibleGames.length ? (
          viewMode === "cover" ? (
            <ScrollArea className="game-scroll">
              <div className="game-card-grid">
                {visibleGames.map(game => (
                  <GameCard
                    key={game.appid}
                    game={game}
                    showAppId={showAppId}
                    coverReloadToken={coverReloadTokens[game.appid] || 0}
                    onContextMenu={handleGameContextMenu}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
              <GameTable
                games={visibleGames}
                listKey={activeGameList}
                includeTargetOwners={report.targets.length > 1}
                showAppId={showAppId}
                priceLabel={tablePriceLabel}
                sort={tableSortByList[activeGameList]}
                coverReloadTokens={coverReloadTokens}
                onSort={handleTableSort}
                onContextMenu={handleGameContextMenu}
              />
          )
        ) : (
          <ScrollArea className="game-scroll">
            <Text c="dimmed" p="md">没有匹配的游戏</Text>
          </ScrollArea>
        )}
      </section>

      {gameContextMenu ? (
        <GameContextMenu
          state={gameContextMenu}
          onOpenWebpage={game => {
            setGameContextMenu(null);
            void openHelpUrl(game.storeLink);
          }}
          onRefreshCover={handleRefreshCover}
        />
      ) : null}
      {moreMenu ? (
        <ResultMoreMenu
          state={moreMenu}
          showAppId={showAppId}
          onToggleAppId={handleToggleAppId}
          onCopyList={() => void handleCopyCurrentList().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null))}
          onCopyReport={() => void handleCopyReport().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null))}
          onClearCache={() => void handleClearCache().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null))}
        />
      ) : null}
    </div>
  );
}

function FieldLabel({ label, helpKey }: { label: string; helpKey: keyof typeof helpLinks }) {
  const help = helpLinks[helpKey];
  const ariaLabel = help.steps.join(" ");
  return (
    <Group gap={6}>
      <span>{label}</span>
      <Tooltip label={<HelpSteps steps={help.steps} />} multiline w={340} withArrow>
        <ActionIcon
          size={18}
          radius="xl"
          variant="light"
          color="steamBlue"
          aria-label={ariaLabel}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            void openHelpUrl(help.url);
          }}
        >
          <HelpIcon />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function HelpSteps({ steps }: { steps: readonly string[] }) {
  return (
    <Stack gap={5}>
      {steps.map(step => (
        <Text key={step} size="xs" lh={1.45}>
          {step}
        </Text>
      ))}
    </Stack>
  );
}

function Metric({
  label,
  value,
  tooltipRows
}: {
  label: string;
  value: string;
  tooltipRows: MetricTooltipRow[];
}) {
  const content = (
    <div className="metric-cell">
      <Text size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text className="metric-value">{value}</Text>
    </div>
  );

  if (tooltipRows.length <= 1) {
    return content;
  }

  return (
    <Tooltip label={<MetricTooltip rows={tooltipRows} />} multiline w={220} withArrow>
      {content}
    </Tooltip>
  );
}

function MetricTooltip({ rows }: { rows: MetricTooltipRow[] }) {
  return (
    <ScrollArea className="metric-tooltip" type="always" scrollbarSize={8}>
      <div className="metric-tooltip-list">
        {rows.map(row => (
          <div key={`${row.label}-${row.value}`} className="metric-tooltip-row">
            <span title={row.label}>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function TargetRow({ target }: { target: TargetProfile }) {
  return (
    <div className="target-row">
      <Group wrap="nowrap" align="center">
        <Avatar src={target.avatar || null} radius="md" size={42}>
          {(target.displayName || target.steamid64 || "?").slice(0, 1)}
        </Avatar>
        <Stack gap={2} className="target-copy">
          <Text fw={700} truncate>{target.displayName || target.steamid64}</Text>
          <Text size="xs" c="dimmed" truncate>
            {target.steamid64} · {target.gameCount} 个公开游戏
          </Text>
        </Stack>
      </Group>
    </div>
  );
}

function GameCard({
  game,
  showAppId,
  coverReloadToken,
  onContextMenu
}: {
  game: ResultGameRow;
  showAppId: boolean;
  coverReloadToken: number;
  onContextMenu: (event: MouseEvent<HTMLElement>, game: ResultGameRow) => void;
}) {
  return (
    <a
      className="game-card"
      href={game.storeLink}
      onClick={event => {
        event.preventDefault();
        void openHelpUrl(game.storeLink);
      }}
      onContextMenu={event => onContextMenu(event, game)}
      style={{ "--game-cover": `url("${getSteamCoverUrl(game, coverReloadToken)}")` } as CSSProperties}
      aria-label={game.name}
      title={game.name}
    >
      <span className="game-card-media">
        <span className="game-card-title">{game.name}</span>
        {showAppId ? <span className="game-card-chip">AppID {game.appid}</span> : null}
      </span>
      <span className="game-card-body">
        <span className="game-card-line">
          <span>{getReportGameStatusLabel(game.status)}</span>
          <span className="game-card-price">{formatPrice(game.price)}</span>
        </span>
        <span>{getGameOwnerSummary(game)}</span>
        <span>{game.ownerIds.join("、") || "-"}</span>
      </span>
    </a>
  );
}

function GameTable({
  games,
  listKey,
  includeTargetOwners,
  showAppId,
  priceLabel,
  sort,
  coverReloadTokens,
  onSort,
  onContextMenu
}: {
  games: ResultGameRow[];
  listKey: ResultGameListKey;
  includeTargetOwners: boolean;
  showAppId: boolean;
  priceLabel: string;
  sort?: TableSortState;
  coverReloadTokens: Record<string, number>;
  onSort: (columnKey: string) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, game: ResultGameRow) => void;
}) {
  const columns = buildGameTableColumns(listKey, includeTargetOwners, showAppId, priceLabel, coverReloadTokens);
  const tableStyle = {
    "--game-table-columns": getGameTableColumnsTemplate(listKey, includeTargetOwners, showAppId)
  } as CSSProperties;

  return (
    <ScrollArea className="game-table-wrap" type="always" scrollbarSize={10}>
      <div className="game-table-frame" role="table" aria-label="游戏列表" style={tableStyle}>
        <div className="game-table-head" role="row">
          {columns.map(column => (
            <span key={column.key}>
              {column.sortable === false ? column.label : (
                <button
                  type="button"
                  className={`game-table-sort ${sort?.key === column.key ? "is-active" : ""} ${sort?.key === column.key && sort.direction === "desc" ? "is-desc" : ""}`}
                  onClick={() => onSort(column.key)}
                >
                  <span>{column.label}</span>
                  <span className="game-table-sort-indicator" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
        {games.map(game => (
          <a
            key={game.appid}
            className="game-table-row"
            href={game.storeLink}
            role="row"
            title={game.name}
            onClick={event => {
              event.preventDefault();
              void openHelpUrl(game.storeLink);
            }}
            onContextMenu={event => onContextMenu(event, game)}
          >
            {columns.map(column => (
              <span key={column.key} className={column.className}>
                {column.render(game)}
              </span>
            ))}
          </a>
        ))}
      </div>
    </ScrollArea>
  );
}

function buildGameTableColumns(
  listKey: ResultGameListKey,
  includeTargetOwners: boolean,
  showAppId: boolean,
  priceLabel: string,
  coverReloadTokens: Record<string, number>
): GameTableColumn[] {
  const appidColumn: GameTableColumn = {
    key: "appid",
    label: "AppID",
    className: "game-table-appid",
    render: game => game.appid
  };
  const nameColumn: GameTableColumn = {
    key: "name",
    label: "游戏",
    className: "game-table-name",
    render: game => (
      <>
        <span
          className="game-table-cover"
          style={{ "--game-cover": `url("${getSteamCoverUrl(game, coverReloadTokens[game.appid] || 0)}")` } as CSSProperties}
          aria-hidden="true"
        />
        <span className="game-table-title">{game.name}</span>
      </>
    )
  };
  const targetOwnersColumn: GameTableColumn = {
    key: "targetOwners",
    label: "拥有者",
    className: "game-table-owner-cell",
    render: game => <OwnerTagList owners={getTargetOwnerTags(game)} />
  };
  const familyOwnersColumn: GameTableColumn = {
    key: "owners",
    label: "贡献者",
    className: "game-table-owner-cell",
    render: game => <OwnerTagList owners={getFamilyOwnerTags(game)} />
  };
  const statusColumn: GameTableColumn = {
    key: "status",
    label: "状态",
    className: "game-table-status-cell",
    render: game => <StatusTag status={game.status} />
  };
  const priceColumn: GameTableColumn = {
    key: "price",
    label: priceLabel,
    className: "game-table-price",
    render: game => formatPrice(game.price)
  };

  if (listKey === "all") {
    const columns = includeTargetOwners
      ? [nameColumn, targetOwnersColumn, statusColumn]
      : [nameColumn, statusColumn];
    return showAppId ? [...columns, appidColumn] : columns;
  }
  if (listKey === "new") {
    const columns = includeTargetOwners
      ? [nameColumn, targetOwnersColumn, priceColumn]
      : [nameColumn, priceColumn];
    return showAppId ? [...columns, appidColumn] : columns;
  }
  if (listKey === "relativeNew") {
    const columns = [nameColumn, familyOwnersColumn, priceColumn];
    return showAppId ? [...columns, appidColumn] : columns;
  }
  const columns = [nameColumn, familyOwnersColumn];
  return showAppId ? [...columns, appidColumn] : columns;
}

function getGameTableColumnsTemplate(listKey: ResultGameListKey, includeTargetOwners: boolean, showAppId: boolean): string {
  if (listKey === "all" || listKey === "new") {
    if (includeTargetOwners) {
      return showAppId
        ? "minmax(0, 5fr) minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.2fr)"
        : "minmax(0, 5fr) minmax(0, 2fr) minmax(0, 1.4fr)";
    }
    return showAppId
      ? "minmax(0, 6fr) minmax(0, 1.5fr) minmax(0, 1.2fr)"
      : "minmax(0, 6fr) minmax(0, 1.5fr)";
  }
  if (listKey === "relativeNew") {
    return showAppId
      ? "minmax(0, 5fr) minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.2fr)"
      : "minmax(0, 5fr) minmax(0, 2fr) minmax(0, 1.4fr)";
  }
  return showAppId
    ? "minmax(0, 5fr) minmax(0, 3fr) minmax(0, 1.2fr)"
    : "minmax(0, 5fr) minmax(0, 3fr)";
}

function OwnerTagList({ owners }: { owners: OwnerTagItem[] }) {
  if (!owners.length) {
    return "-";
  }

  return (
    <span className="owner-tag-list">
      {owners.map(owner => (
        <span
          key={`${owner.id}-${owner.label}`}
          className="owner-tag"
          style={{ "--owner-tag-hue": getOwnerTagHue(owner.id || owner.label) } as CSSProperties}
          title={owner.id && owner.id !== owner.label ? owner.id : undefined}
        >
          {owner.label}
        </span>
      ))}
    </span>
  );
}

function StatusTag({ status }: { status: ReportGameStatus }) {
  const label = getReportGameStatusLabel(status);
  if (label === "-") {
    return label;
  }

  return (
    <span className={`status-tag status-tag-${status}`}>
      {label}
    </span>
  );
}

function ResultMoreMenu({
  state,
  showAppId,
  onToggleAppId,
  onCopyList,
  onCopyReport,
  onClearCache
}: {
  state: MoreMenuState;
  showAppId: boolean;
  onToggleAppId: () => void;
  onCopyList: () => void;
  onCopyReport: () => void;
  onClearCache: () => void;
}) {
  return (
    <div
      className="context-menu result-more-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
      onPointerDown={event => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={onCopyList}>
        复制列表
      </button>
      <button type="button" role="menuitem" onClick={onCopyReport}>
        复制报告
      </button>
      <button type="button" role="menuitem" onClick={onClearCache}>
        清除缓存
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={showAppId}
        className="menu-switch-item"
        onClick={onToggleAppId}
      >
        <span>显示 AppID</span>
        <span className={`menu-switch ${showAppId ? "is-on" : ""}`} aria-hidden="true">
          <span />
        </span>
      </button>
    </div>
  );
}

function GameContextMenu({
  state,
  onOpenWebpage,
  onRefreshCover
}: {
  state: GameContextMenuState;
  onOpenWebpage: (game: ResultGameRow) => void;
  onRefreshCover: (game: ResultGameRow) => void;
}) {
  return (
    <div
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
      onPointerDown={event => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => onOpenWebpage(state.game)}>
        打开网页
      </button>
      <button type="button" role="menuitem" onClick={() => onRefreshCover(state.game)}>
        刷新封面
      </button>
    </div>
  );
}

function HistoryContextMenu({
  state,
  onCopy
}: {
  state: HistoryContextMenuState;
  onCopy: (entry: AnalysisHistoryEntry) => void;
}) {
  return (
    <div
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
      onPointerDown={event => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => onCopy(state.entry)}>
        复制
      </button>
    </div>
  );
}

function getInitialLastAnalysisReport(): AnalysisReport | null {
  if (initialLastAnalysisReport === undefined) {
    initialLastAnalysisReport = loadLastAnalysisReport();
  }
  return initialLastAnalysisReport;
}

function loadLastAnalysisReport(): AnalysisReport | null {
  const raw = localStorage.getItem(lastAnalysisReportKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AnalysisReport;
    if (isAnalysisReport(parsed)) {
      return parsed;
    }
    localStorage.removeItem(lastAnalysisReportKey);
    return null;
  } catch {
    localStorage.removeItem(lastAnalysisReportKey);
    return null;
  }
}

function saveLastAnalysisReport(report: AnalysisReport): void {
  localStorage.setItem(lastAnalysisReportKey, JSON.stringify(report));
  initialLastAnalysisReport = report;
}

function isAnalysisReport(value: unknown): value is AnalysisReport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const report = value as Partial<AnalysisReport>;
  return typeof report.targetCount === "number"
    && Array.isArray(report.targets)
    && Boolean(report.games)
    && typeof report.games === "object"
    && Array.isArray(report.games.all)
    && Array.isArray(report.games.new)
    && Array.isArray(report.games.relativeNew)
    && Array.isArray(report.games.overlap)
    && Array.isArray(report.games.currentOwned)
    && Array.isArray(report.games.notCurrentOwned)
    && Array.isArray(report.warnings);
}

function loadAnalysisHistory(): AnalysisHistoryEntry[] {
  const raw = localStorage.getItem(analysisHistoryKey);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as AnalysisHistoryEntry[];
    return Array.isArray(parsed) ? normalizeAnalysisHistory(parsed) : [];
  } catch {
    localStorage.removeItem(analysisHistoryKey);
    return [];
  }
}

function saveAnalysisHistory(history: AnalysisHistoryEntry[]): AnalysisHistoryEntry[] {
  const nextHistory = normalizeAnalysisHistory(history);
  localStorage.setItem(analysisHistoryKey, JSON.stringify(nextHistory));
  return nextHistory;
}

function upsertAnalysisHistory(
  history: AnalysisHistoryEntry[],
  inputValue: string,
  report: AnalysisReport
): AnalysisHistoryEntry[] {
  const normalizedInput = inputValue.trim();
  const accounts = report.targets.map(target => ({
    displayName: target.displayName || target.steamid64 || normalizedInput,
    steamid64: target.steamid64 || "-"
  }));
  const historyKey = buildAnalysisHistoryKey(accounts, normalizedInput);
  const previous = history.find(entry => getAnalysisHistoryKey(entry) === historyKey);
  const entry: AnalysisHistoryEntry = {
    id: previous?.id || `${Date.now()}-${historyKey}`,
    inputValue: buildReportTargetInput(report) || normalizedInput,
    accounts,
    updatedAt: Date.now()
  };
  return [entry, ...history.filter(item => getAnalysisHistoryKey(item) !== historyKey)].slice(0, 30);
}

function normalizeAnalysisHistory(history: AnalysisHistoryEntry[]): AnalysisHistoryEntry[] {
  const deduped = new Map<string, AnalysisHistoryEntry>();
  for (const entry of history) {
    const key = getAnalysisHistoryKey(entry);
    if (!key || deduped.has(key)) {
      continue;
    }
    deduped.set(key, entry);
  }
  return Array.from(deduped.values()).slice(0, 30);
}

function getAnalysisHistoryKey(entry: AnalysisHistoryEntry): string {
  return buildAnalysisHistoryKey(entry.accounts, entry.inputValue);
}

function buildAnalysisHistoryKey(accounts: AnalysisHistoryAccount[], fallbackInput: string): string {
  const accountIds = accounts
    .map(account => account.steamid64.trim())
    .filter(steamid64 => /^\d{17}$/.test(steamid64))
    .sort();
  if (accountIds.length) {
    return accountIds.join("|");
  }
  return fallbackInput.trim().replace(/\s+/g, " ").toLowerCase();
}

function formatHistoryAccountNames(entry: AnalysisHistoryEntry): string {
  const names = entry.accounts.map(account => account.displayName).filter(Boolean);
  return names.length ? names.join("、") : entry.inputValue;
}

function formatHistoryAccountIds(entry: AnalysisHistoryEntry): string {
  const ids = entry.accounts.map(account => account.steamid64).filter(Boolean);
  return ids.length ? ids.join("、") : entry.inputValue;
}

function formatHistoryAnalysisInput(entry: AnalysisHistoryEntry): string {
  const accountIds = entry.accounts
    .map(account => account.steamid64.trim())
    .filter(steamid64 => /^\d{17}$/.test(steamid64));
  return accountIds.length ? accountIds.join("\n") : entry.inputValue.trim();
}

function buildResultGameRows(games: ReportGame[]): ResultGameRow[] {
  return games.map(game => ({
    appid: game.appid,
    name: game.name || `App ${game.appid}`,
    storeLink: game.storeLink || `https://store.steampowered.com/app/${game.appid}/`,
    coverUrl: game.coverUrl,
    ownerNames: game.targetOwnerNames,
    ownerIds: game.targetOwners,
    familyOwners: game.familyOwners,
    familyOwnerNames: game.familyOwnerNames || [],
    price: game.price,
    status: game.status
  })).sort((left, right) => left.name.localeCompare(right.name, "zh-CN", {
    numeric: true,
    sensitivity: "base"
  }));
}

function buildResultMetrics(report: AnalysisReport): ResultMetric[] {
  const targets = report.targets;
  const familyCount = report.familyGameCount;
  const targetLabelById = new Map(targets.map(target => [
    target.steamid64,
    target.displayName || target.steamid64 || "未知账号"
  ]));
  const targetIds = targets.map(target => target.steamid64);
  const totalRows = targets.map(target => ({
    label: targetLabelById.get(target.steamid64) || target.steamid64 || "未知账号",
    value: String(target.gameCount)
  }));
  const familyRows = targets.map(target => ({
    label: targetLabelById.get(target.steamid64) || target.steamid64 || "未知账号",
    value: String(familyCount)
  }));
  const addedRows = targetIds.map(steamid64 => ({
    label: targetLabelById.get(steamid64) || steamid64 || "未知账号",
    value: String(countGamesForTarget(report.games.new, steamid64))
  }));
  const addedValueRows = targetIds.map(steamid64 => ({
    label: targetLabelById.get(steamid64) || steamid64 || "未知账号",
    value: formatMoneyFromMinor(sumGamePricesForTarget(report.games.new, steamid64), getReportCurrency(report.games.new))
  }));
  const overlapRows = targetIds.map(steamid64 => ({
    label: targetLabelById.get(steamid64) || steamid64 || "未知账号",
    value: String(countGamesForTarget(report.games.overlap, steamid64))
  }));
  const overlapRateRows = targetIds.map(steamid64 => ({
    label: targetLabelById.get(steamid64) || steamid64 || "未知账号",
    value: formatPercent(familyCount ? countGamesForTarget(report.games.overlap, steamid64) / familyCount : 0)
  }));

  return [
    {
      label: "家庭库",
      value: String(familyCount),
      tooltipRows: familyRows
    },
    {
      label: "总游戏",
      value: String(report.games.all.length),
      tooltipRows: totalRows
    },
    {
      label: "新增",
      value: String(report.games.new.length),
      tooltipRows: addedRows
    },
    {
      label: "新增价值",
      value: formatMoneyFromMinor(sumGamePrices(report.games.new), getReportCurrency(report.games.new)),
      tooltipRows: addedValueRows
    },
    {
      label: "重复",
      value: String(report.games.overlap.length),
      tooltipRows: overlapRows
    },
    {
      label: "重复率",
      value: formatPercent(familyCount ? report.games.overlap.length / familyCount : 0),
      tooltipRows: overlapRateRows
    }
  ];
}

function countGamesForTarget(games: ReportGame[], steamid64: string): number {
  return games.filter(game => game.targetOwners.includes(steamid64)).length;
}

function sumGamePricesForTarget(games: ReportGame[], steamid64: string): number {
  return sumGamePrices(games.filter(game => game.targetOwners.includes(steamid64)));
}

function sumGamePrices(games: ReportGame[]): number {
  return games.reduce((sum, game) => isCountablePrice(game.price) ? sum + Number(game.price.initial || 0) : sum, 0);
}

function isCountablePrice(price: PriceInfo | null): price is PriceInfo {
  return Boolean(price && !price.unavailable && price.initial != null);
}

function getReportCurrency(games: ReportGame[]): string {
  return games.find(game => isCountablePrice(game.price))?.price?.currency || "CNY";
}

function sortResultGameRows(games: ResultGameRow[], sortKey: ResultGameSortKey): ResultGameRow[] {
  return games.slice().sort((left, right) => {
    if (sortKey === "priceDesc") {
      return comparePriceDesc(left, right) || compareGameName(left, right);
    }
    if (sortKey === "priceAsc") {
      return comparePriceAsc(left, right) || compareGameName(left, right);
    }
    if (sortKey === "ownersDesc") {
      return getOwnerSortValue(right) - getOwnerSortValue(left) || compareGameName(left, right);
    }
    if (sortKey === "ownersAsc") {
      return getOwnerSortValue(left) - getOwnerSortValue(right) || compareGameName(left, right);
    }
    return compareGameName(left, right);
  });
}

function sortTableGameRows(games: ResultGameRow[], sort?: TableSortState): ResultGameRow[] {
  if (!sort?.key) {
    return games;
  }
  const direction = sort.direction === "desc" ? -1 : 1;
  return games.slice().sort((left, right) => compareTableSortValues(left, right, sort.key) * direction);
}

function compareTableSortValues(left: ResultGameRow, right: ResultGameRow, key: string): number {
  const leftValue = getTableSortValue(left, key);
  const rightValue = getTableSortValue(right, key);
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    const diff = leftValue - rightValue;
    return diff === 0 ? compareGameName(left, right) : diff;
  }
  const result = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
  return result === 0 ? compareGameName(left, right) : result;
}

function getTableSortValue(game: ResultGameRow, key: string): string | number {
  if (key === "appid") {
    return Number(game.appid || 0);
  }
  if (key === "name") {
    return game.name;
  }
  if (key === "status") {
    return getReportGameStatusLabel(game.status);
  }
  if (key === "owners") {
    return getFamilyOwnerText(game);
  }
  if (key === "targetOwners") {
    return getTargetOwnerText(game);
  }
  if (key === "price") {
    return getTablePriceSortValue(game.price);
  }
  return "";
}

function getTablePriceSortValue(price: PriceInfo | null): number {
  if (!price) {
    return Number.POSITIVE_INFINITY;
  }
  if (price.unavailable) {
    return Number.NEGATIVE_INFINITY;
  }
  if (price.initial == null) {
    return Number.POSITIVE_INFINITY;
  }
  return Number(price.initial || 0);
}

function comparePriceDesc(left: ResultGameRow, right: ResultGameRow): number {
  const leftPrice = getPriceSortValue(left);
  const rightPrice = getPriceSortValue(right);
  if (leftPrice == null && rightPrice == null) {
    return 0;
  }
  if (leftPrice == null) {
    return 1;
  }
  if (rightPrice == null) {
    return -1;
  }
  return rightPrice - leftPrice;
}

function comparePriceAsc(left: ResultGameRow, right: ResultGameRow): number {
  const leftPrice = getPriceSortValue(left);
  const rightPrice = getPriceSortValue(right);
  if (leftPrice == null && rightPrice == null) {
    return 0;
  }
  if (leftPrice == null) {
    return 1;
  }
  if (rightPrice == null) {
    return -1;
  }
  return leftPrice - rightPrice;
}

function compareGameName(left: ResultGameRow, right: ResultGameRow): number {
  return left.name.localeCompare(right.name, "zh-CN", {
    numeric: true,
    sensitivity: "base"
  }) || left.appid.localeCompare(right.appid, "zh-CN", { numeric: true });
}

function getPriceSortValue(game: ResultGameRow): number | null {
  if (!game.price || game.price.unavailable || game.price.initial == null) {
    return null;
  }
  return Number(game.price.initial || 0);
}

function getOwnerSortValue(game: ResultGameRow): number {
  return game.status === "overlap" ? game.familyOwners.length : game.ownerIds.length;
}

function getReportGameStatusLabel(status: ReportGameStatus): string {
  if (status === "new") {
    return "新增";
  }
  if (status === "overlap") {
    return "重复";
  }
  if (status === "currentOwned") {
    return "不计入新增";
  }
  return "-";
}

function getGameOwnerSummary(game: ResultGameRow): string {
  if (game.status === "overlap" && game.familyOwners.length) {
    return `${game.familyOwners.length} 个家庭成员拥有`;
  }
  return game.ownerNames.length > 1 ? `${game.ownerNames.length} 个目标账号拥有` : game.ownerNames[0] || "-";
}

function getGameOwnerDetail(game: ResultGameRow): string {
  if (game.status === "overlap" && game.familyOwners.length) {
    return getFamilyOwnerText(game);
  }
  return game.ownerNames.length ? game.ownerNames.join("、") : game.ownerIds.join("、");
}

function getTargetOwnerText(game: ResultGameRow): string {
  return game.ownerNames.length ? game.ownerNames.join("、") : game.ownerIds.join("、") || "-";
}

function getFamilyOwnerText(game: ResultGameRow): string {
  return (game.familyOwnerNames.length ? game.familyOwnerNames : game.familyOwners).join("、") || "-";
}

function getTargetOwnerTags(game: ResultGameRow): OwnerTagItem[] {
  return buildOwnerTags(game.ownerIds, game.ownerNames);
}

function getFamilyOwnerTags(game: ResultGameRow): OwnerTagItem[] {
  return buildOwnerTags(game.familyOwners, game.familyOwnerNames);
}

function buildOwnerTags(ids: string[], names: string[]): OwnerTagItem[] {
  const ownerIds = ids.length ? ids : names;
  return ownerIds
    .map((id, index) => {
      const label = names[index] || id;
      return {
        id: id || label,
        label: label || id
      };
    })
    .filter(owner => owner.label);
}

function getOwnerTagHue(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return `${hash}deg`;
}

function formatPrice(price: PriceInfo | null): string {
  if (!price || price.unavailable || price.initial == null) {
    return "-";
  }
  return formatMoneyFromMinor(Number(price.initial || 0), price.currency || "CNY");
}

function formatMoneyFromMinor(amount: number, currency: string): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    minimumFractionDigits: 0
  }).format(amount / 100);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(Number.isFinite(value) ? value : 0);
}

function formatGameListText(games: ResultGameRow[]): string {
  return games.map(game => [
    game.name,
    game.appid,
    getReportGameStatusLabel(game.status),
    formatPrice(game.price),
    getGameOwnerSummary(game),
    game.storeLink
  ].join("\t")).join("\n");
}

function buildReportTargetInput(report: AnalysisReport | null): string {
  if (!report) {
    return "";
  }
  return report.targets
    .map(target => target.steamid64 || target.profileUrl || target.displayName)
    .filter(Boolean)
    .join("\n");
}

function formatReportText(report: AnalysisReport): string {
  const resultMetrics = buildResultMetrics(report);
  const lines = [
    "Steam 家庭库分析报告",
    ...resultMetrics.map(metric => `${metric.label}：${metric.value}`),
    "",
    "目标账号：",
    ...report.targets.map(target => `${target.displayName || target.steamid64}\t${target.steamid64}\t${target.gameCount} 个公开游戏`),
    "",
    "新增候选：",
    ...buildResultGameRows(report.games.new).map(game => `${game.name}\t${game.appid}\t${formatPrice(game.price)}\t${game.storeLink}`)
  ];
  if (report.warnings.length) {
    lines.push("", "警告：", ...report.warnings);
  }
  return lines.join("\n");
}

async function writeClipboard(text: string): Promise<void> {
  if (!text.trim()) {
    throw new Error("没有可复制的内容");
  }
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some WebView contexts expose Clipboard API but reject writes without focus.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) {
    throw new Error("复制失败");
  }
}

function getSteamCoverUrl(game: ResultGameRow, reloadToken = 0): string {
  const url = game.coverUrl || `https://cdn.cloudflare.steamstatic.com/steam/apps/${encodeURIComponent(game.appid)}/library_600x900_2x.jpg`;
  return reloadToken ? `${url}${url.includes("?") ? "&" : "?"}t=${reloadToken}` : url;
}

async function openHelpUrl(url: string): Promise<void> {
  if (!url) {
    return;
  }
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
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
