import "@mantine/core/styles.css";
import "./styles.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ActionIcon,
  Alert,
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
import type { CSSProperties, MouseEvent } from "react";
import type { AnalysisReport, AppSettings, AppStatus, LocaleMode, PriceInfo, PriceMode, ReportGame, ReportGameStatus, TargetProfile } from "./types";
import { analyzeTarget, clearCache, getAppStatus, loadSettings, saveSettings } from "./services/desktop";

const analysisHistoryKey = "sffa.desktop.analysisInputHistory";

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

type AppPage = "analysis" | "settings";
type AnalysisStage = "prepare" | "result";

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
  price: PriceInfo | null;
  status: ReportGameStatus;
};

type ResultGameListKey = "all" | "new" | "overlap" | "currentOwned" | "notCurrentOwned";
type ResultGameSortKey = "nameAsc" | "priceDesc" | "priceAsc" | "ownersDesc" | "ownersAsc";
type ResultGameViewMode = "cover" | "table";

type GameContextMenuState = {
  x: number;
  y: number;
  game: ResultGameRow;
};

const helpLinks = {
  steamApiKey: {
    url: "https://steamcommunity.com/dev/apikey",
    text: "登录 Steam 后打开开发者 API Key 页面；没有 Key 时按页面提示注册域名并复制 Key。"
  },
  itadApiKey: {
    url: "https://isthereanydeal.com/apps/",
    text: "登录 IsThereAnyDeal，进入 Apps / My apps，创建应用后复制 API Key。"
  },
  currentSteamId64: {
    url: "https://steamid.io/",
    text: "打开 SteamID 查询页，粘贴你的 Steam 个人主页地址，复制 steamID64 / SteamID64 字段。"
  },
  familyAccessToken: {
    url: "https://store.steampowered.com/account/familymanagement",
    text: "从已登录 Steam 的网页上下文中获取 access token；桌面端第一阶段先使用手动粘贴。"
  }
} as const;

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
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [targetInput, setTargetInput] = useState("");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("准备就绪");
  const [activePage, setActivePage] = useState<AppPage>("analysis");
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>("prepare");
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
    if (inputOverride !== undefined) {
      setTargetInput(inputOverride);
    }
    setBusy(true);
    setMessage("正在请求 Steam Web API");
    try {
      await saveSettings(settings);
      const nextReport = await analyzeTarget({ targetInput: analysisInput, settings });
      setReport(nextReport);
      if (nextReport.targetCount > 0) {
        setAnalysisHistory(previousHistory => saveAnalysisHistory(upsertAnalysisHistory(previousHistory, analysisInput, nextReport)));
        setAnalysisStage("result");
      } else {
        setAnalysisStage("prepare");
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
            <section className={`editor-body ${activePage === "analysis" && analysisStage === "result" && report ? "is-result-view" : ""}`}>
              {activePage === "analysis" ? (
                analysisStage === "prepare" || !report ? (
                  <AnalysisPreparePage
                    targetInput={targetInput}
                    history={analysisHistory}
                    message={message}
                    busy={busy}
                    onTargetInputChange={setTargetInput}
                    onAnalyze={handleAnalyze}
                    onDeleteHistoryEntry={handleDeleteHistoryEntry}
                  />
                ) : (
                  <AnalysisResultPage
                    report={report}
                    message={message}
                    warningText={warningText}
                    busy={busy}
                    onBack={() => setAnalysisStage("prepare")}
                    onAnalyze={handleAnalyze}
                    onMessage={setMessage}
                  />
                )
              ) : (
                <SettingsPage
                  settings={settings}
                  status={status}
                  onSettingsChange={setSettings}
                />
              )}
            </section>

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

function ActivityIcon({ type }: { type: "logo" | "analysis" | "settings" | "help" }) {
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

  const updateDraft = <K extends keyof AppSettings>(key: K, value: AppSettings[K], commitNow = false) => {
    const nextSettings = { ...latestDraftRef.current, [key]: value };
    latestDraftRef.current = nextSettings;
    setDraftSettings(nextSettings);
    if (commitNow) {
      onSettingsChange(nextSettings);
    }
  };

  return (
    <div className="settings-pane">
      <Stack gap="md">
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
  onDeleteHistoryEntry
}: {
  targetInput: string;
  history: AnalysisHistoryEntry[];
  message: string;
  busy: boolean;
  onTargetInputChange: (value: string) => void;
  onAnalyze: (inputOverride?: string) => Promise<void>;
  onDeleteHistoryEntry: (entryId: string) => void;
}) {
  return (
    <div className="analysis-prepare-layout">
      <aside className="history-pane">
        <Group justify="space-between" align="center" className="history-head">
          <Text fw={700}>历史分析</Text>
        </Group>
        <ScrollArea className="history-scroll">
          <Stack gap={4}>
            {history.length ? history.map(entry => (
              <div key={entry.id} className="history-item">
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
      </aside>

      <section className="analysis-draft-pane">
        <section className="input-pane">
          <Group justify="space-between" mb="xs" align="flex-start">
            <Stack gap={2}>
              <Text component="h1" className="title">账号分析</Text>
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
          <Alert className="status-alert" color={message.includes("失败") || message.includes("错误") ? "red" : "steamGreen"} variant="light">
            {message}
          </Alert>
        </section>

        <section className="analysis-blank-pane" aria-label="预留区域" />
      </section>
    </div>
  );
}

function AnalysisResultPage({
  report,
  message,
  warningText,
  busy,
  onBack,
  onAnalyze,
  onMessage
}: {
  report: AnalysisReport;
  message: string;
  warningText: string;
  busy: boolean;
  onBack: () => void;
  onAnalyze: (inputOverride?: string) => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGameList, setActiveGameList] = useState<ResultGameListKey>("all");
  const [sortKey, setSortKey] = useState<ResultGameSortKey>("nameAsc");
  const [viewMode, setViewMode] = useState<ResultGameViewMode>("cover");
  const [coverReloadTokens, setCoverReloadTokens] = useState<Record<string, number>>({});
  const [gameContextMenu, setGameContextMenu] = useState<GameContextMenuState | null>(null);
  const games = useMemo(() => sortResultGameRows(buildResultGameRows(report.games[activeGameList]), sortKey), [activeGameList, report, sortKey]);
  const visibleGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return games;
    }
    return games.filter(game => game.name.toLowerCase().includes(query) || game.appid.includes(query));
  }, [games, searchQuery]);

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
          </Stack>
          <div className="result-actions">
            <Button size="xs" variant="subtle" color="steamBlue" onClick={onBack}>返回输入</Button>
            <Button size="xs" color="steamBlue" variant="light" loading={busy} onClick={() => void onAnalyze()}>
              重新实时分析
            </Button>
          </div>
        </div>

        <Alert className="status-alert result-status" color={message.includes("失败") || message.includes("错误") ? "red" : "steamGreen"} variant="light">
          {message}
        </Alert>

        <div className="result-metrics">
          <Metric label="目标数" value={String(report.targetCount)} />
          <Metric label="公开游戏" value={String(report.totalPublicGames)} />
          <Metric label="家庭库" value={String(report.familyGameCount)} />
          <Metric label="新增候选" value={String(report.newGameCount)} />
          <Metric label="家庭重复" value={String(report.overlapCount)} />
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
          <Stack gap={8} className="game-list-primary">
            <Text fw={700}>游戏展示</Text>
            <SegmentedControl
              className="game-list-tabs"
              size="xs"
              color="steamBlue"
              value={activeGameList}
              data={[
                { value: "all", label: `全部 ${report.games.all.length}` },
                { value: "new", label: `新增候选 ${report.games.new.length}` },
                { value: "overlap", label: `家庭重复 ${report.games.overlap.length}` },
                { value: "currentOwned", label: `当前已拥有 ${report.games.currentOwned.length}` },
                { value: "notCurrentOwned", label: `未拥有 ${report.games.notCurrentOwned.length}` }
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
            <Button size="xs" variant="subtle" color="steamBlue" onClick={() => void handleCopyCurrentList().catch(error => onMessage(String(error)))}>
              复制列表
            </Button>
            <Button size="xs" variant="subtle" color="steamBlue" onClick={() => void handleCopyReport().catch(error => onMessage(String(error)))}>
              复制报告
            </Button>
            <Button size="xs" variant="subtle" color="red" onClick={() => void handleClearCache().catch(error => onMessage(String(error)))}>
              清缓存
            </Button>
          </div>
        </Group>

        <ScrollArea className="game-scroll">
          {visibleGames.length ? (
            viewMode === "cover" ? (
              <div className="game-card-grid">
                {visibleGames.map(game => (
                  <GameCard
                    key={game.appid}
                    game={game}
                    coverReloadToken={coverReloadTokens[game.appid] || 0}
                    onContextMenu={handleGameContextMenu}
                  />
                ))}
              </div>
            ) : (
              <GameTable
                games={visibleGames}
                coverReloadTokens={coverReloadTokens}
                onContextMenu={handleGameContextMenu}
              />
            )
          ) : (
            <Text c="dimmed" p="md">没有匹配的游戏</Text>
          )}
        </ScrollArea>
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
    </div>
  );
}

function FieldLabel({ label, helpKey }: { label: string; helpKey: keyof typeof helpLinks }) {
  const help = helpLinks[helpKey];
  return (
    <Group gap={6}>
      <span>{label}</span>
      <Tooltip label={help.text} multiline w={280} withArrow>
        <ActionIcon
          size={18}
          radius="xl"
          variant="light"
          color="steamBlue"
          aria-label={help.text}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-cell">
      <Text size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text className="metric-value">{value}</Text>
    </div>
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
  coverReloadToken,
  onContextMenu
}: {
  game: ResultGameRow;
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
        <span className="game-card-chip">AppID {game.appid}</span>
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
  coverReloadTokens,
  onContextMenu
}: {
  games: ResultGameRow[];
  coverReloadTokens: Record<string, number>;
  onContextMenu: (event: MouseEvent<HTMLElement>, game: ResultGameRow) => void;
}) {
  return (
    <div className="game-table-wrap">
      <div className="game-table" role="table" aria-label="游戏列表">
        <div className="game-table-head" role="row">
          <span>游戏</span>
          <span>状态</span>
          <span>拥有者</span>
          <span>价格</span>
          <span>AppID</span>
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
            <span className="game-table-name">
              <span
                className="game-table-cover"
                style={{ "--game-cover": `url("${getSteamCoverUrl(game, coverReloadTokens[game.appid] || 0)}")` } as CSSProperties}
                aria-hidden="true"
              />
              <span className="game-table-title">{game.name}</span>
            </span>
            <span>{getReportGameStatusLabel(game.status)}</span>
            <span title={getGameOwnerDetail(game)}>{getGameOwnerSummary(game)}</span>
            <span className="game-table-price">{formatPrice(game.price)}</span>
            <span className="game-table-appid">{game.appid}</span>
          </a>
        ))}
      </div>
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
      className="game-context-menu"
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

function loadAnalysisHistory(): AnalysisHistoryEntry[] {
  const raw = localStorage.getItem(analysisHistoryKey);
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as AnalysisHistoryEntry[];
  return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
}

function saveAnalysisHistory(history: AnalysisHistoryEntry[]): AnalysisHistoryEntry[] {
  const nextHistory = history.slice(0, 30);
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
  const previous = history.find(entry => entry.inputValue === normalizedInput);
  const entry: AnalysisHistoryEntry = {
    id: previous?.id || `${Date.now()}-${normalizedInput}`,
    inputValue: normalizedInput,
    accounts,
    updatedAt: Date.now()
  };
  return [entry, ...history.filter(item => item.inputValue !== normalizedInput)].slice(0, 30);
}

function formatHistoryAccountNames(entry: AnalysisHistoryEntry): string {
  const names = entry.accounts.map(account => account.displayName).filter(Boolean);
  return names.length ? names.join("、") : entry.inputValue;
}

function formatHistoryAccountIds(entry: AnalysisHistoryEntry): string {
  const ids = entry.accounts.map(account => account.steamid64).filter(Boolean);
  return ids.length ? ids.join("、") : entry.inputValue;
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
    price: game.price,
    status: game.status
  })).sort((left, right) => left.name.localeCompare(right.name, "zh-CN", {
    numeric: true,
    sensitivity: "base"
  }));
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
    return "新增候选";
  }
  if (status === "overlap") {
    return "家庭库重复";
  }
  return status === "currentOwned" ? "当前账号已拥有" : "当前账号未拥有";
}

function getGameOwnerSummary(game: ResultGameRow): string {
  if (game.status === "overlap" && game.familyOwners.length) {
    return `${game.familyOwners.length} 个家庭成员拥有`;
  }
  return game.ownerNames.length > 1 ? `${game.ownerNames.length} 个目标账号拥有` : game.ownerNames[0] || "-";
}

function getGameOwnerDetail(game: ResultGameRow): string {
  if (game.status === "overlap" && game.familyOwners.length) {
    return game.familyOwners.join("、");
  }
  return game.ownerNames.length ? game.ownerNames.join("、") : game.ownerIds.join("、");
}

function formatPrice(price: PriceInfo | null): string {
  if (!price || price.unavailable || price.initial == null) {
    return "-";
  }
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: price.currency || "CNY",
    minimumFractionDigits: 0
  }).format(Number(price.initial || 0) / 100);
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

function formatReportText(report: AnalysisReport): string {
  const lines = [
    "Steam 家庭库分析报告",
    `目标数：${report.targetCount}`,
    `公开游戏：${report.totalPublicGames}`,
    `家庭库：${report.familyGameCount}`,
    `新增候选：${report.newGameCount}`,
    `家庭重复：${report.overlapCount}`,
    `当前账号已拥有：${report.currentOwnedOverlapCount}`,
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
