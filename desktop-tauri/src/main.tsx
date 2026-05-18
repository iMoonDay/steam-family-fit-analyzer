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
import type { AnalysisReport, AppSettings, AppStatus, LocaleMode, PriceMode, TargetProfile } from "./types";
import { analyzeTarget, getAppStatus, loadSettings, saveSettings } from "./services/desktop";

const analysisHistoryKey = "sffa.desktop.analysisInputHistory";

const defaultSettings: AppSettings = {
  steamApiKey: "",
  itadApiKey: "",
  currentSteamId64: "",
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
  ownerNames: string[];
  ownerIds: string[];
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
                    settings={settings}
                    priceLabel={priceLabel}
                    message={message}
                    warningText={warningText}
                    busy={busy}
                    onBack={() => setAnalysisStage("prepare")}
                    onAnalyze={handleAnalyze}
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
          <Stack gap={1}>
            <Text fw={700}>历史分析</Text>
            <Text size="xs" c="dimmed">点击后实时重新分析</Text>
          </Stack>
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
              <Text size="sm" c="dimmed">输入目标账号后读取公开游戏库；结果不会从历史缓存中恢复。</Text>
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
  settings,
  priceLabel,
  message,
  warningText,
  busy,
  onBack,
  onAnalyze
}: {
  report: AnalysisReport;
  settings: AppSettings;
  priceLabel: string;
  message: string;
  warningText: string;
  busy: boolean;
  onBack: () => void;
  onAnalyze: (inputOverride?: string) => Promise<void>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const games = useMemo(() => buildResultGameRows(report), [report]);
  const visibleGames = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return games;
    }
    return games.filter(game => game.name.toLowerCase().includes(query) || game.appid.includes(query));
  }, [games, searchQuery]);

  return (
    <div className="analysis-result-layout">
      <aside className="result-data-pane">
        <div className="result-data-head">
          <Stack gap={2}>
            <Text component="h1" className="title">分析结果</Text>
            <Text size="xs" c="dimmed">{settings.storeCountry}:{settings.locale} · {priceLabel}</Text>
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
          <Metric label="当前已拥有" value={String(report.currentOwnedOverlapCount)} />
          <Metric label="游戏列表" value={String(games.length)} />
        </div>

        <section className="result-targets">
          <Group justify="space-between" className="result-head">
            <Text fw={700}>目标账号</Text>
            <Text size="xs" c={warningText ? "orange" : "dimmed"}>{warningText || "实时结果"}</Text>
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
          <Stack gap={2}>
            <Text fw={700}>游戏展示</Text>
            <Text size="sm" c="dimmed">参考脚本封面卡片视图，当前展示目标公开游戏。</Text>
          </Stack>
          <TextInput
            className="game-search"
            value={searchQuery}
            onChange={event => setSearchQuery(event.currentTarget.value)}
            placeholder="搜索游戏名或 AppID"
          />
        </Group>

        <ScrollArea className="game-scroll">
          {visibleGames.length ? (
            <div className="game-card-grid">
              {visibleGames.map(game => <GameCard key={game.appid} game={game} />)}
            </div>
          ) : (
            <Text c="dimmed" p="md">没有匹配的游戏</Text>
          )}
        </ScrollArea>
      </section>
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

function GameCard({ game }: { game: ResultGameRow }) {
  return (
    <a
      className="game-card"
      href={game.storeLink}
      onClick={event => {
        event.preventDefault();
        void openHelpUrl(game.storeLink);
      }}
      style={{ "--game-cover": `url("${getSteamCoverUrl(game.appid)}")` } as CSSProperties}
      aria-label={game.name}
      title={game.name}
    >
      <span className="game-card-media">
        <span className="game-card-title">{game.name}</span>
        <span className="game-card-chip">AppID {game.appid}</span>
      </span>
      <span className="game-card-body">
        <span>{game.ownerNames.length > 1 ? `${game.ownerNames.length} 个目标账号拥有` : game.ownerNames[0] || "-"}</span>
        <span>{game.ownerIds.join("、") || "-"}</span>
      </span>
    </a>
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

function buildResultGameRows(report: AnalysisReport): ResultGameRow[] {
  const gameById = new Map<string, ResultGameRow>();

  report.targets.forEach(target => {
    const games = target.games.length ? target.games : target.sampleGames;
    games.forEach(game => {
      const appid = String(game.appid || "");
      if (!appid) {
        return;
      }
      const existing = gameById.get(appid);
      if (existing) {
        existing.ownerNames.push(target.displayName || target.steamid64);
        existing.ownerIds.push(target.steamid64);
        return;
      }
      gameById.set(appid, {
        appid,
        name: game.name || `App ${appid}`,
        storeLink: game.storeLink || `https://store.steampowered.com/app/${appid}/`,
        ownerNames: [target.displayName || target.steamid64],
        ownerIds: [target.steamid64]
      });
    });
  });

  return Array.from(gameById.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN", {
    numeric: true,
    sensitivity: "base"
  }));
}

function getSteamCoverUrl(appid: string): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${encodeURIComponent(appid)}/library_600x900_2x.jpg`;
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
