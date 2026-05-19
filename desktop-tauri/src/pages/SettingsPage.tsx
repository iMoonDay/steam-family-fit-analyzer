import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ActionIcon, Button, Divider, Group, PasswordInput, Select, SimpleGrid, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { AppSettings, AppStatus, LocaleMode, AutoSteamConfigResult } from "../types";
import {
  clearCache,
  openCacheDirectory,
  startBrowserConfigCallback,
  exportSettings,
  importSettings,
  validateFamilyAccessToken,
  validateItadApiKey,
  validateSteamApiKey
} from "../services/desktop";
import { FieldLabel, HelpSteps } from "../components/fields";
import { CacheActionIcon, ValidateCredentialIcon } from "../components/icons";
import { openExternalUrl, writeClipboard } from "../core/external";
import { browserConfigHelpSteps } from "../core/help";

type CredentialKind = "steamApiKey" | "itadApiKey" | "familyAccessToken";

export function SettingsPage({
  settings,
  status,
  message,
  onSettingsChange,
  onMessage
}: {
  settings: AppSettings;
  status: AppStatus | null;
  message: string;
  onSettingsChange: (settings: AppSettings) => void;
  onMessage: (message: string) => void;
}) {
  return (
    <div className="settings-workspace">
      <div className="main-heading settings-heading">
        <Stack gap={1}>
          <Text component="h1" className="title">配置</Text>
          {message ? (
            <Text className={`inline-status ${message.includes("失败") || message.includes("错误") ? "is-error" : ""}`} size="xs">
              {message}
            </Text>
          ) : null}
        </Stack>
      </div>

      <section className="settings-page-panel">
        <SettingsPanel
          settings={settings}
          status={status}
          onSettingsChange={onSettingsChange}
          onMessage={onMessage}
        />
      </section>
    </div>
  );
}

function SettingsPanel({
  settings,
  status,
  onSettingsChange,
  onMessage
}: {
  settings: AppSettings;
  status: AppStatus | null;
  onSettingsChange: (settings: AppSettings) => void;
  onMessage: (message: string) => void;
}) {
  const [autoDetectBusy, setAutoDetectBusy] = useState(false);
  const [validatingCredential, setValidatingCredential] = useState<CredentialKind | null>(null);
  const [autoDetectMessage, setAutoDetectMessage] = useState("");
  const latestSettingsRef = useRef(settings);
  const displayedCacheDirectory = settings.cacheDirectory.trim() || status?.cacheDirectory || "-";

  useEffect(() => {
    latestSettingsRef.current = settings;
  }, [settings]);

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

  const updateSettings = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const nextSettings = { ...latestSettingsRef.current, [key]: value };
    latestSettingsRef.current = nextSettings;
    onSettingsChange(nextSettings);
  };

  function applyDetectedSteamConfig(detected: AutoSteamConfigResult): boolean {
    const nextSettings = {
      ...latestSettingsRef.current,
      familyAccessToken: detected.familyAccessToken || latestSettingsRef.current.familyAccessToken,
      currentSteamId64: detected.currentSteamId64 || latestSettingsRef.current.currentSteamId64,
      familyGroupId: detected.familyGroupId || latestSettingsRef.current.familyGroupId
    };
    const changed = JSON.stringify(nextSettings) !== JSON.stringify(latestSettingsRef.current);
    if (changed) {
      latestSettingsRef.current = nextSettings;
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
      await openExternalUrl(session.steamStoreUrl);
      setAutoDetectMessage(`已复制一次性书签脚本，并打开 Steam 家庭管理页。本地回调将在 ${Math.floor(session.expiresInSeconds / 60)} 分钟后过期：请在已登录页面把脚本粘贴到地址栏或控制台执行；Steam Web API Key 请点击字段旁帮助自行复制。`);
    } catch (error) {
      setAutoDetectMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAutoDetectBusy(false);
    }
  }

  async function handleOpenCacheDirectory() {
    try {
      await openCacheDirectory(settings);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClearCache() {
    try {
      await clearCache(settings);
      onMessage("缓存已清理");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSelectCacheDirectory() {
    try {
      const selected = await open({
        title: "选择缓存目录",
        directory: true,
        multiple: false,
        defaultPath: settings.cacheDirectory.trim() || status?.cacheDirectory || undefined
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      updateSettings("cacheDirectory", selected);
      onMessage("缓存目录已更新");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleExportSettings() {
    try {
      const path = await save({
        title: "导出设置",
        defaultPath: "steam-family-fit-analyzer-settings.json",
        filters: [{ name: "JSON 文件", extensions: ["json"] }]
      });
      if (!path) {
        return;
      }
      await exportSettings(path, latestSettingsRef.current);
      onMessage("设置已导出");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleImportSettings() {
    try {
      const selected = await open({
        title: "导入设置",
        multiple: false,
        filters: [{ name: "JSON 文件", extensions: ["json"] }]
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      const imported = await importSettings(selected);
      onSettingsChange(imported);
      onMessage("设置已导入");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function handleUseDefaultCacheDirectory() {
    if (!settings.cacheDirectory.trim()) {
      return;
    }
    updateSettings("cacheDirectory", "");
    onMessage("已恢复默认缓存目录");
  }

  async function handleValidateCredential(kind: CredentialKind) {
    setValidatingCredential(kind);
    try {
      const message = await ({
        steamApiKey: validateSteamApiKey,
        itadApiKey: validateItadApiKey,
        familyAccessToken: validateFamilyAccessToken
      }[kind])(latestSettingsRef.current);
      onMessage(message);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setValidatingCredential(null);
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
        <div className="settings-credential-row">
          <PasswordInput
            label={<FieldLabel label="Steam Web API Key" helpKey="steamApiKey" onOpenHelp={url => void openExternalUrl(url)} />}
            value={settings.steamApiKey}
            onChange={event => updateSettings("steamApiKey", event.currentTarget.value)}
            autoComplete="off"
          />
          <CredentialValidateButton
            label="校验 Steam Web API Key"
            loading={validatingCredential === "steamApiKey"}
            disabled={Boolean(validatingCredential)}
            onClick={() => void handleValidateCredential("steamApiKey")}
          />
        </div>
        <div className="settings-credential-row">
          <PasswordInput
            label={<FieldLabel label="IsThereAnyDeal API Key" helpKey="itadApiKey" onOpenHelp={url => void openExternalUrl(url)} />}
            value={settings.itadApiKey}
            onChange={event => updateSettings("itadApiKey", event.currentTarget.value)}
            autoComplete="off"
          />
          <CredentialValidateButton
            label="校验 IsThereAnyDeal API Key"
            loading={validatingCredential === "itadApiKey"}
            disabled={Boolean(validatingCredential)}
            onClick={() => void handleValidateCredential("itadApiKey")}
          />
        </div>
        <TextInput
          label={<FieldLabel label="当前 SteamID64" helpKey="currentSteamId64" onOpenHelp={url => void openExternalUrl(url)} />}
          value={settings.currentSteamId64}
          onChange={event => updateSettings("currentSteamId64", event.currentTarget.value.trim())}
        />
        <div className="settings-credential-row">
          <PasswordInput
            label={<FieldLabel label="家庭库 Access Token" helpKey="familyAccessToken" onOpenHelp={url => void openExternalUrl(url)} />}
            value={settings.familyAccessToken}
            onChange={event => updateSettings("familyAccessToken", event.currentTarget.value.trim())}
            autoComplete="off"
          />
          <CredentialValidateButton
            label="校验家庭库 Access Token"
            loading={validatingCredential === "familyAccessToken"}
            disabled={Boolean(validatingCredential)}
            onClick={() => void handleValidateCredential("familyAccessToken")}
          />
        </div>
        <TextInput
          label="家庭组 ID（可留空自动获取）"
          value={settings.familyGroupId}
          onChange={event => updateSettings("familyGroupId", event.currentTarget.value.trim())}
        />

        <SimpleGrid cols={2} spacing="xs">
          <TextInput
            label="地区"
            value={settings.storeCountry}
            maxLength={2}
            onChange={event => updateSettings("storeCountry", event.currentTarget.value.trim().toUpperCase())}
          />
          <Select
            label="语言"
            value={settings.locale}
            data={[
              { value: "auto", label: "自动" },
              { value: "zh-CN", label: "中文" },
              { value: "en", label: "English" }
            ]}
            onChange={value => updateSettings("locale", (value || "auto") as LocaleMode)}
          />
        </SimpleGrid>

        <Divider />
        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed" fw={700}>配置备份</Text>
          <Group gap="xs">
            <Button size="xs" variant="light" color="steamBlue" onClick={() => void handleImportSettings()}>
              导入设置
            </Button>
            <Button size="xs" variant="light" color="steamBlue" onClick={() => void handleExportSettings()}>
              导出设置
            </Button>
          </Group>
        </Group>
        <Divider />
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={700}>缓存目录</Text>
          <Group gap="xs" wrap="nowrap" className="settings-cache-row">
            <Text size="xs" className="path-text">{displayedCacheDirectory}</Text>
            <Group gap={6} wrap="nowrap" className="settings-cache-actions">
              <CacheActionButton
                label="前往目录"
                icon="open"
                disabled={!displayedCacheDirectory || displayedCacheDirectory === "-"}
                onClick={() => void handleOpenCacheDirectory()}
              />
              <CacheActionButton
                label="修改路径"
                icon="change"
                onClick={() => void handleSelectCacheDirectory()}
              />
              <CacheActionButton
                label="恢复默认"
                icon="reset"
                disabled={!settings.cacheDirectory.trim()}
                onClick={handleUseDefaultCacheDirectory}
              />
              <CacheActionButton
                label="清除缓存"
                icon="clear"
                onClick={() => void handleClearCache()}
              />
            </Group>
          </Group>
        </Stack>
      </Stack>
    </div>
  );
}

function CacheActionButton({
  label,
  icon,
  disabled,
  onClick
}: {
  label: string;
  icon: "open" | "change" | "reset" | "clear";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} withArrow openDelay={250}>
      <span className="settings-cache-action-wrap">
        <ActionIcon
          className="settings-cache-action"
          size={28}
          radius="md"
          variant="light"
          color="steamBlue"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <CacheActionIcon type={icon} />
        </ActionIcon>
      </span>
    </Tooltip>
  );
}

function CredentialValidateButton({
  label,
  loading,
  disabled,
  onClick
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} withArrow openDelay={250}>
      <span className="settings-credential-action-wrap">
        <ActionIcon
          className="settings-credential-action"
          size={28}
          radius="md"
          variant="light"
          color="steamBlue"
          aria-label={label}
          loading={loading}
          disabled={disabled}
          onClick={onClick}
        >
          <ValidateCredentialIcon />
        </ActionIcon>
      </span>
    </Tooltip>
  );
}
