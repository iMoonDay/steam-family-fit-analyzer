import { Button, Checkbox, Group, PasswordInput, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { AutoSteamConfigResult, SteamQrLoginPollResult, SteamQrLoginSession } from "../types";
import {
  beginSteamQrLogin,
  fetchFamilyConfigFromSteamLogin,
  fetchSteamApiKeyFromSteamLogin,
  fetchSteamLoginProfile,
  pollSteamQrLogin
} from "../services/desktop";
import { writeClipboard } from "../core/external";
import {
  clearSteamLoginCache,
  clearSteamLoginNotice,
  readSteamLoginCache,
  writeSteamLoginCache
} from "../core/steamLoginCache";
import type { SteamLoginCache } from "../core/steamLoginCache";

type LoginMode = "qr" | "password" | "cookie";

type LoginSuccessState = {
  familyConfigSynced: boolean;
  steamApiKeySynced: boolean;
  steamApiKeyMissing: boolean;
  syncFailed: boolean;
};

export function LoginPage({
  isActive,
  message,
  persistentMessage,
  onLoginAccountChange,
  onMessage,
  onLogout
}: {
  isActive: boolean;
  message: string;
  persistentMessage: string;
  onLoginAccountChange: (account: SteamLoginCache | null) => void;
  onMessage: (message: string) => void;
  onLogout: () => void;
}) {
  const [loginMode, setLoginMode] = useState<LoginMode>("qr");
  const [rememberLogin, setRememberLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SteamQrLoginSession | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [accountNameInput, setAccountNameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [steamLoginSecureInput, setSteamLoginSecureInput] = useState("");
  const [loginAccount, setLoginAccount] = useState<SteamLoginCache | null>(null);
  const pollingRef = useRef(false);
  const profileFetchAttemptRef = useRef("");
  const cachePersistReadyRef = useRef(false);

  useEffect(() => {
    void readSteamLoginCache().then(cached => {
      if (!cached) {
        return;
      }
      setRememberLogin(true);
      setLoginAccount(current => mergeLoginCache(current, cached));
    });
  }, []);

  useEffect(() => {
    if (!session) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void pollQrLogin(session, false);
    }, Math.max(session.intervalSeconds, 3) * 1000);

    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    onLoginAccountChange(loginAccount);
  }, [loginAccount, onLoginAccountChange]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void readSteamLoginCache().then(cached => {
      if (!cached) {
        return;
      }
      setRememberLogin(true);
      setLoginAccount(current => mergeLoginCache(current, cached));
    });
  }, [isActive]);

  useEffect(() => {
    if (!cachePersistReadyRef.current) {
      cachePersistReadyRef.current = true;
      return;
    }
    if (!rememberLogin) {
      void clearSteamLoginCache();
    } else if (loginAccount) {
      void writeSteamLoginCache(loginAccount);
    }
  }, [rememberLogin, loginAccount]);

  useEffect(() => {
    if (!isActive || (loginAccount && hasCachedProfile(loginAccount))) {
      return;
    }
    const steamid64 = loginAccount?.steamid64 || "";
    if (!steamid64 || !loginAccount?.refreshToken) {
      return;
    }
    const steamApiKey = safeTrim(loginAccount.steamApiKey);
    const requestKey = `${steamid64}:${steamApiKey}`;
    if (profileFetchAttemptRef.current === requestKey) {
      return;
    }
    profileFetchAttemptRef.current = requestKey;
    void syncCachedLoginProfile(steamid64, steamApiKey).catch(() => undefined);
  }, [isActive, loginAccount]);

  const savedSteamid64 = loginAccount?.steamid64 || "";
  const isLoggedIn = Boolean(loginAccount?.refreshToken);

  async function handleBeginQrLogin() {
    setBusy(true);
    try {
      const nextSession = await beginSteamQrLogin();
      const nextQrCode = await QRCode.toDataURL(nextSession.challengeUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        scale: 8,
        color: {
          dark: "#111827",
          light: "#ffffff"
        }
      });
      setSession(nextSession);
      setQrCode(nextQrCode);
      await writeClipboard(nextSession.challengeUrl);
      onMessage("请扫码确认");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function pollQrLogin(currentSession: SteamQrLoginSession, showBusy: boolean) {
    if (pollingRef.current) {
      return;
    }
    pollingRef.current = true;
    if (showBusy) {
      setBusy(true);
    }

    try {
      const result = await pollSteamQrLogin(currentSession);
      if (result.status !== "confirmed") {
        onMessage(result.message);
        return;
      }

      setSession(null);
      setQrCode("");
      await clearSteamLoginNotice();
      let nextAccount: SteamLoginCache = {
        steamid64: result.steamid64,
        accountName: result.accountName,
        displayName: "",
        profileUrl: "",
        avatar: "",
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        steamApiKey: "",
        familyGroupId: "",
        savedAt: Date.now()
      };
      setLoginAccount(nextAccount);

      let familyConfigSynced = false;
      let steamApiKeySynced = false;
      let steamApiKeyMissing = false;
      let syncFailed = false;
      onMessage("同步中");
      try {
        const detected = await fetchFamilyConfigFromSteamLogin(result);
        nextAccount = mergeDetectedSteamConfig(nextAccount, detected);
        setLoginAccount(nextAccount);
        familyConfigSynced = true;
      } catch {
        syncFailed = true;
      }

      try {
        const steamApiKey = await fetchSteamApiKeyFromSteamLogin(result);
        if (steamApiKey) {
          nextAccount = { ...nextAccount, steamApiKey, savedAt: Date.now() };
          setLoginAccount(nextAccount);
          steamApiKeySynced = true;
        } else {
          steamApiKeyMissing = true;
        }
        const profileApiKey = steamApiKey || nextAccount.steamApiKey;
        if (profileApiKey) {
          await syncLoginProfile(result, profileApiKey);
        }
      } catch {
        syncFailed = true;
      }
      onMessage(formatLoginSuccessMessage({
        familyConfigSynced,
        steamApiKeySynced,
        steamApiKeyMissing,
        syncFailed
      }));
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      pollingRef.current = false;
      if (showBusy) {
        setBusy(false);
      }
    }
  }

  async function syncLoginProfile(result: SteamQrLoginPollResult, steamApiKey: string) {
    const profile = await fetchSteamLoginProfile(result.steamid64, steamApiKey);
    setLoginAccount(current => ({
      steamid64: result.steamid64,
      accountName: current?.accountName || result.accountName,
      displayName: profile.displayName,
      profileUrl: profile.profileUrl,
      avatar: profile.avatar,
      accessToken: current?.accessToken || result.accessToken,
      refreshToken: current?.refreshToken || result.refreshToken,
      accessTokenExpiresAt: current?.accessTokenExpiresAt ?? result.accessTokenExpiresAt,
      steamApiKey: current?.steamApiKey || steamApiKey,
      familyGroupId: current?.familyGroupId || "",
      savedAt: Date.now()
    }));
  }

  async function syncCachedLoginProfile(steamid64: string, steamApiKey: string) {
    const profile = await fetchSteamLoginProfile(steamid64, steamApiKey);
    setLoginAccount(current => {
      if (!current) {
        return {
          steamid64,
          accountName: "",
          displayName: profile.displayName,
          profileUrl: profile.profileUrl,
          avatar: profile.avatar,
          accessToken: "",
          refreshToken: "",
          accessTokenExpiresAt: null,
          steamApiKey,
          familyGroupId: "",
          savedAt: Date.now()
        };
      }
      if (current.steamid64 !== steamid64) {
        return current;
      }
      return {
        ...current,
        displayName: profile.displayName,
        profileUrl: profile.profileUrl,
        avatar: profile.avatar,
        steamApiKey: current.steamApiKey || steamApiKey,
        savedAt: Date.now()
      };
    });
  }

  function handlePasswordLogin() {
    onMessage("请使用二维码登录");
  }

  function handleCookieLogin() {
    onMessage("Cookie 登录暂未实现");
  }

  function handleLogout() {
    setRememberLogin(false);
    setLoginAccount(null);
    void clearSteamLoginCache();
    void clearSteamLoginNotice();
    onLogout();
    onMessage("已退出");
  }

  const statusMessage = persistentMessage || message;
  const statusMessageIsError = Boolean(persistentMessage || message.includes("失败") || message.includes("错误"));

  return (
    <div className="login-workspace">
      <section className="login-stage" aria-label="Steam 登录">
        <div className="login-primary">
          {isLoggedIn ? (
            <LoggedInPanel
              steamid64={savedSteamid64}
              accountName={loginAccount?.accountName}
              displayName={loginAccount?.displayName}
              avatar={loginAccount?.avatar}
              expiresAt={loginAccount?.accessTokenExpiresAt || null}
              remembered={rememberLogin && Boolean(loginAccount?.refreshToken)}
              onLogout={handleLogout}
            />
          ) : loginMode === "qr" ? (
            <QrLoginPanel
              busy={busy}
              qrCode={qrCode}
              session={session}
              onBegin={() => void handleBeginQrLogin()}
              onPoll={() => session ? void pollQrLogin(session, true) : undefined}
            />
          ) : loginMode === "password" ? (
            <PasswordLoginPanel
              busy={busy}
              accountName={accountNameInput}
              password={passwordInput}
              onAccountNameChange={setAccountNameInput}
              onPasswordChange={setPasswordInput}
              onSubmit={handlePasswordLogin}
            />
          ) : (
            <CookieLoginPanel
              busy={busy}
              sessionId={sessionIdInput}
              steamLoginSecure={steamLoginSecureInput}
              onSessionIdChange={setSessionIdInput}
              onSteamLoginSecureChange={setSteamLoginSecureInput}
              onSubmit={handleCookieLogin}
            />
          )}
        </div>

        {!isLoggedIn ? (
          <>
            <div className="login-mode-switch" role="tablist" aria-label="登录方式">
              <button
                type="button"
                className={loginMode === "qr" ? "is-active" : ""}
                aria-selected={loginMode === "qr"}
                onClick={() => setLoginMode("qr")}
              >
                二维码
              </button>
              <button
                type="button"
                className={loginMode === "password" ? "is-active" : ""}
                aria-selected={loginMode === "password"}
                onClick={() => setLoginMode("password")}
              >
                账号密码
              </button>
              <button
                type="button"
                className={loginMode === "cookie" ? "is-active" : ""}
                aria-selected={loginMode === "cookie"}
                onClick={() => setLoginMode("cookie")}
              >
                Cookie
              </button>
            </div>

            <Checkbox
              className="login-remember"
              checked={rememberLogin}
              onChange={event => setRememberLogin(event.currentTarget.checked)}
              label="记住登录状态"
            />
          </>
        ) : null}

        {statusMessage ? (
          <Text className={`inline-status login-status ${statusMessageIsError ? "is-error" : ""}`} size="xs">
            {statusMessage}
          </Text>
        ) : null}
      </section>
    </div>
  );
}

function formatLoginSuccessMessage(state: LoginSuccessState) {
  if (state.familyConfigSynced && state.steamApiKeySynced) {
    return "已登录";
  }
  if (state.syncFailed) {
    return "配置不完整";
  }
  if (state.steamApiKeyMissing) {
    return "未找到 API Key";
  }
  return "已登录";
}

function hasCachedProfile(cache: SteamLoginCache) {
  return Boolean(safeTrim(cache.displayName) || safeTrim(cache.avatar));
}

function mergeLoginCache(current: SteamLoginCache | null, cached: SteamLoginCache) {
  if (!current || current.steamid64 !== cached.steamid64) {
    return cached;
  }
  return {
    ...cached,
    accountName: current.accountName || cached.accountName,
    displayName: current.displayName || cached.displayName,
    profileUrl: current.profileUrl || cached.profileUrl,
    avatar: current.avatar || cached.avatar,
    steamApiKey: current.steamApiKey || cached.steamApiKey,
    accessToken: current.accessToken || cached.accessToken,
    familyGroupId: current.familyGroupId || cached.familyGroupId,
    savedAt: Math.max(current.savedAt, cached.savedAt)
  };
}

function safeTrim(value: string | null | undefined) {
  return value?.trim() || "";
}

function mergeDetectedSteamConfig(cache: SteamLoginCache, detected: AutoSteamConfigResult): SteamLoginCache {
  return {
    ...cache,
    steamid64: detected.currentSteamId64 || cache.steamid64,
    accessToken: detected.accessToken || cache.accessToken,
    familyGroupId: detected.familyGroupId || cache.familyGroupId,
    savedAt: Date.now()
  };
}

function QrLoginPanel({
  busy,
  qrCode,
  session,
  onBegin,
  onPoll
}: {
  busy: boolean;
  qrCode: string;
  session: SteamQrLoginSession | null;
  onBegin: () => void;
  onPoll: () => void;
}) {
  if (qrCode && session) {
    return (
      <Stack gap="sm" align="center" className="login-qr-active">
        <img src={qrCode} alt="Steam 登录二维码" />
        <Text size="xs" fw={700}>手机 Steam 扫码后保持此页打开</Text>
        <Text size="xs" className="path-text">{session.challengeUrl}</Text>
        <Button size="xs" color="steamBlue" loading={busy} onClick={onPoll}>
          检查登录
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="md" align="center">
      <div className="login-qr-placeholder">
        <span />
      </div>
      <Button color="steamBlue" loading={busy} onClick={onBegin}>
        生成二维码
      </Button>
    </Stack>
  );
}

function PasswordLoginPanel({
  busy,
  accountName,
  password,
  onAccountNameChange,
  onPasswordChange,
  onSubmit
}: {
  busy: boolean;
  accountName: string;
  password: string;
  onAccountNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Stack gap="sm" className="login-password-panel">
      <TextInput
        label="Steam 账号"
        value={accountName}
        onChange={event => onAccountNameChange(event.currentTarget.value)}
        autoComplete="username"
      />
      <PasswordInput
        label="密码"
        value={password}
        onChange={event => onPasswordChange(event.currentTarget.value)}
        autoComplete="current-password"
      />
      <Button color="steamBlue" loading={busy} onClick={onSubmit}>
        登录
      </Button>
    </Stack>
  );
}

function CookieLoginPanel({
  busy,
  sessionId,
  steamLoginSecure,
  onSessionIdChange,
  onSteamLoginSecureChange,
  onSubmit
}: {
  busy: boolean;
  sessionId: string;
  steamLoginSecure: string;
  onSessionIdChange: (value: string) => void;
  onSteamLoginSecureChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Stack gap="sm" className="login-password-panel">
      <TextInput
        label="sessionid"
        value={sessionId}
        onChange={event => onSessionIdChange(event.currentTarget.value)}
        autoComplete="off"
      />
      <Textarea
        label="steamLoginSecure"
        value={steamLoginSecure}
        onChange={event => onSteamLoginSecureChange(event.currentTarget.value)}
        autosize
        minRows={5}
        maxRows={7}
        autoComplete="off"
      />
      <Button color="steamBlue" loading={busy} onClick={onSubmit}>
        登录
      </Button>
    </Stack>
  );
}

function LoggedInPanel({
  steamid64,
  accountName,
  displayName,
  avatar,
  expiresAt,
  remembered,
  onLogout
}: {
  steamid64: string;
  accountName?: string;
  displayName?: string;
  avatar?: string;
  expiresAt: number | null;
  remembered: boolean;
  onLogout: () => void;
}) {
  const accountLabel = displayName || accountName || "Steam 账号";
  return (
    <Stack gap="sm" align="center" className="login-account-panel">
      <div className="login-account-avatar">
        {avatar ? (
          <img src={avatar} alt={accountLabel} />
        ) : (
          (accountLabel || steamid64).slice(0, 1).toUpperCase()
        )}
      </div>
      <Stack gap={4} align="center">
        <Text fw={700}>{accountLabel}</Text>
        <Text size="xs" className="path-text">{steamid64}</Text>
        <Group gap="xs" justify="center">
          <span className="login-account-chip">家庭配置已保存</span>
          {remembered ? (
            <span className="login-account-chip">登录状态已记住</span>
          ) : null}
          {expiresAt ? (
            <span className="login-account-chip">Access Token 至 {new Date(expiresAt * 1000).toLocaleString()}</span>
          ) : null}
        </Group>
      </Stack>
      <Button size="xs" variant="light" color="red" onClick={onLogout}>
        退出登录
      </Button>
    </Stack>
  );
}
