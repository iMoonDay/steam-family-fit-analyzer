import { open, save } from "@tauri-apps/plugin-dialog";
import { ActionIcon, Button, Divider, Group, PasswordInput, Select, SimpleGrid, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { AppSettings, AppStatus, LocaleMode } from "../types";
import {
  clearCache,
  openCacheDirectory,
  openConfigDirectory,
  exportSettings,
  importSettings,
  migrateCacheDirectory,
  migrateConfigDirectory,
  validateItadApiKey
} from "../services/desktop";
import { FieldLabel } from "../components/fields";
import { CacheActionIcon, ValidateCredentialIcon } from "../components/icons";
import { openExternalUrl } from "../core/external";

type CredentialKind = "itadApiKey";

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
  const [validatingCredential, setValidatingCredential] = useState<CredentialKind | null>(null);
  const latestSettingsRef = useRef(settings);
  const configuredCacheDirectory = safeTrim(settings.cacheDirectory);
  const configuredConfigDirectory = safeTrim(settings.configDirectory);
  const displayedCacheDirectory = configuredCacheDirectory || status?.cacheDirectory || "-";
  const displayedConfigDirectory = configuredConfigDirectory || status?.configDirectory || "-";
  const defaultCacheDirectory = safeTrim(status?.cacheDirectory);
  const defaultConfigDirectory = safeTrim(status?.configDirectory);

  useEffect(() => {
    latestSettingsRef.current = settings;
  }, [settings]);

  const updateSettings = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const nextSettings = { ...latestSettingsRef.current, [key]: value };
    latestSettingsRef.current = nextSettings;
    onSettingsChange(nextSettings);
  };

  async function handleOpenCacheDirectory() {
    try {
      await openCacheDirectory(settings);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenConfigDirectory() {
    try {
      await openConfigDirectory(settings);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleClearCache() {
    try {
      await clearCache(settings);
      onMessage("已清理");
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
        defaultPath: configuredCacheDirectory || status?.cacheDirectory || undefined
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      const oldDirectory = displayedCacheDirectory;
      if (shouldMigrateDirectory(oldDirectory, selected)) {
        await migrateCacheDirectory(oldDirectory, selected);
      }
      updateSettings("cacheDirectory", selected);
      onMessage("路径已更新");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSelectConfigDirectory() {
    try {
      const selected = await open({
        title: "选择配置目录",
        directory: true,
        multiple: false,
        defaultPath: configuredConfigDirectory || status?.configDirectory || undefined
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      const oldDirectory = displayedConfigDirectory;
      if (shouldMigrateDirectory(oldDirectory, selected)) {
        await migrateConfigDirectory(oldDirectory, selected);
      }
      updateSettings("configDirectory", selected);
      onMessage("路径已更新");
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
      onMessage("已导出");
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
      onMessage("已导入");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function handleUseDefaultCacheDirectory() {
    if (!configuredCacheDirectory) {
      return;
    }
    void restoreDirectory("缓存", configuredCacheDirectory, defaultCacheDirectory, migrateCacheDirectory, "cacheDirectory");
  }

  function handleUseDefaultConfigDirectory() {
    if (!configuredConfigDirectory) {
      return;
    }
    void restoreDirectory("配置", configuredConfigDirectory, defaultConfigDirectory, migrateConfigDirectory, "configDirectory");
  }

  function handleResetCurrentConfig() {
    const currentSettings = latestSettingsRef.current;
    const nextSettings: AppSettings = {
      steamApiKey: "",
      itadApiKey: "",
      currentSteamId64: "",
      familyAccessToken: "",
      familyGroupId: "",
      storeCountry: "CN",
      locale: "auto",
      priceMode: "original",
      cacheDirectory: safeTrim(currentSettings.cacheDirectory),
      configDirectory: safeTrim(currentSettings.configDirectory)
    };
    latestSettingsRef.current = nextSettings;
    onSettingsChange(nextSettings);
    onMessage("配置已重置");
  }

  async function handleValidateCredential(kind: CredentialKind) {
    setValidatingCredential(kind);
    try {
      await validateItadApiKey(latestSettingsRef.current);
      onMessage("Key 有效");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setValidatingCredential(null);
    }
  }

  async function restoreDirectory(
    label: "配置" | "缓存",
    oldDirectory: string,
    defaultDirectory: string,
    migrate: (oldPath: string, newPath: string) => Promise<void>,
    key: "cacheDirectory" | "configDirectory"
  ) {
    if (!defaultDirectory || normalizeDirectoryForCompare(oldDirectory) === normalizeDirectoryForCompare(defaultDirectory)) {
      updateSettings(key, "");
      onMessage("已恢复默认");
      return;
    }
    await migrate(oldDirectory, defaultDirectory);
    updateSettings(key, "");
    onMessage("已迁移并恢复默认");
  }

  return (
    <div className="settings-pane">
      <Stack gap="md">
        <SettingsSectionTitle label="价格数据" />
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

        <Divider />
        <SettingsSectionTitle label="通用设置" />
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
          <Text size="xs" c="dimmed" fw={700}>配置目录</Text>
          <Group gap="xs" wrap="nowrap" className="settings-cache-row">
            <Text size="xs" className="path-text">{displayedConfigDirectory}</Text>
            <Group gap={6} wrap="nowrap" className="settings-cache-actions">
              <CacheActionButton
                label="前往目录"
                icon="open"
                disabled={!displayedConfigDirectory || displayedConfigDirectory === "-"}
                onClick={() => void handleOpenConfigDirectory()}
              />
              <CacheActionButton
                label="修改路径"
                icon="change"
                onClick={() => void handleSelectConfigDirectory()}
              />
              <CacheActionButton
                label="恢复默认"
                icon="reset"
                disabled={!configuredConfigDirectory}
                onClick={handleUseDefaultConfigDirectory}
              />
              <CacheActionButton
                label="重置当前配置"
                icon="configReset"
                onClick={handleResetCurrentConfig}
              />
            </Group>
          </Group>
        </Stack>
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
                disabled={!configuredCacheDirectory}
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
  icon: "open" | "change" | "reset" | "configReset" | "clear";
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

function SettingsSectionTitle({ label }: { label: string }) {
  return (
    <Text size="xs" c="dimmed" fw={700}>{label}</Text>
  );
}

function shouldMigrateDirectory(oldDirectory: string, newDirectory: string) {
  if (!oldDirectory || oldDirectory === "-") {
    return false;
  }
  return normalizeDirectoryForCompare(oldDirectory) !== normalizeDirectoryForCompare(newDirectory);
}

function normalizeDirectoryForCompare(value: string) {
  return value.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function safeTrim(value: string | null | undefined) {
  return value?.trim() || "";
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
