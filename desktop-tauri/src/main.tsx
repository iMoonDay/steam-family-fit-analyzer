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
import type { MouseEvent } from "react";
import type { AnalysisReport, AppSettings, AppStatus, LocaleMode, PriceMode, TargetProfile } from "./types";
import { analyzeTarget, getAppStatus, loadSettings, saveSettings } from "./services/desktop";

const defaultSettings: AppSettings = {
  steamApiKey: "",
  itadApiKey: "",
  currentSteamId64: "",
  storeCountry: "CN",
  locale: "auto",
  priceMode: "original"
};

type AppPage = "analysis" | "settings";

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

  async function handleAnalyze() {
    setBusy(true);
    setMessage("正在请求 Steam Web API");
    try {
      await saveSettings(settings);
      const nextReport = await analyzeTarget({ targetInput, settings });
      setReport(nextReport);
      setMessage(nextReport.targetCount ? "目标公开游戏库读取完成" : "请输入至少一个目标账号");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
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
            <section className="editor-body">
              {activePage === "analysis" ? (
                <>
                  <Group justify="space-between" align="center" className="main-heading analysis-heading">
                    <Stack gap={1}>
                      <Text component="h1" className="title">账号分析</Text>
                      <Text size="sm" c="dimmed">读取目标公开游戏库，后续接入家庭库比对。</Text>
                    </Stack>
                    <Button color="steamBlue" loading={busy} onClick={() => void handleAnalyze()}>开始分析</Button>
                  </Group>

                  <AnalysisPanel
                    targetInput={targetInput}
                    settings={settings}
                    report={report}
                    priceLabel={priceLabel}
                    message={message}
                    warningText={warningText}
                    busy={busy}
                    onTargetInputChange={setTargetInput}
                    onAnalyze={handleAnalyze}
                  />
                </>
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

function AnalysisPanel({
  targetInput,
  settings,
  report,
  priceLabel,
  message,
  warningText,
  busy,
  onTargetInputChange,
  onAnalyze
}: {
  targetInput: string;
  settings: AppSettings;
  report: AnalysisReport | null;
  priceLabel: string;
  message: string;
  warningText: string;
  busy: boolean;
  onTargetInputChange: (value: string) => void;
  onAnalyze: () => Promise<void>;
}) {
  return (
    <div className="analysis-workspace">
      <section className="input-pane">
        <Group justify="space-between" mb="xs">
          <Text fw={700}>目标账号</Text>
          <Button size="xs" variant="subtle" color="steamBlue" loading={busy} onClick={() => void onAnalyze()}>运行</Button>
        </Group>
        <Textarea
          minRows={6}
          autosize
          value={targetInput}
          onChange={event => onTargetInputChange(event.currentTarget.value)}
          placeholder="SteamID64、好友码、个人主页 URL 或自定义 ID；多个账号用空格或换行分隔"
        />
      </section>

      <Alert className="status-alert" color={message.includes("失败") || message.includes("错误") ? "red" : "steamGreen"} variant="light">
        {message}
      </Alert>

      <SimpleGrid cols={4} spacing={0} className="metric-strip">
        <Metric label="目标数" value={report ? String(report.targetCount) : "-"} />
        <Metric label="公开游戏" value={report ? String(report.totalPublicGames) : "-"} />
        <Metric label="当前已拥有" value={report ? String(report.currentOwnedOverlapCount) : "-"} />
        <Metric label="价格口径" value={priceLabel} />
      </SimpleGrid>

      <section className="result-pane">
        <Group justify="space-between" className="result-head">
          <Text fw={700}>目标账号</Text>
          <Text size="xs" c={warningText ? "orange" : "dimmed"}>
            {warningText || `${settings.storeCountry}:${settings.locale}`}
          </Text>
        </Group>
        <ScrollArea.Autosize mah={360}>
          <Stack gap={0}>
            {report?.targets.length
              ? report.targets.map(target => <TargetRow key={target.steamid64 || target.displayName} target={target} />)
              : <Text p="md" c="dimmed">暂无目标</Text>}
          </Stack>
        </ScrollArea.Autosize>
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
  const sample = target.sampleGames.slice(0, 6).map(game => game.name).join("、");
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
      <Text mt="xs" size="sm" c="dimmed" truncate>
        {sample || "暂无可展示样例游戏"}
      </Text>
    </div>
  );
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
