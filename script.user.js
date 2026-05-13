// ==UserScript==
// @name         Steam Family Library Analyzer
// @name:zh-CN   Steam 家庭库分析器
// @namespace    https://tampermonkey.net/
// @version      0.1.4
// @description  Analyze a public Steam account against your current Steam Family shared library for added games, duplicates, and added original value.
// @description:zh-CN 基于当前 Steam 家庭组共享库，分析指定公开 Steam 账户加入后可带来的新增游戏、重复游戏和新增库价值
// @author       iMoonDay
// @homepageURL  https://github.com/iMoonDay/steam-family-fit-analyzer
// @supportURL   https://github.com/iMoonDay/steam-family-fit-analyzer/issues
// @match        https://store.steampowered.com/*
// @match        https://steamcommunity.com/profiles/*
// @icon         https://store.steampowered.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @connect      api.steampowered.com
// @connect      partner.steam-api.com
// @connect      steamcommunity.com
// @connect      store.steampowered.com
// @license      MIT
// ==/UserScript==

(function() {
  "use strict";

  // 无法从 Steam 页面识别时使用的商店地区代码，例如 CN / US / JP。
  const FALLBACK_STORE_CC = "CN";
  // 无法从 Steam 页面识别时使用的商店语言代码，例如 schinese / english / japanese。
  const FALLBACK_STORE_LANG = "schinese";
  // 界面语言；auto 会根据当前 Steam 页面语言在中文和英文之间选择。
  const APP_LOCALE = "auto";
  // 本地存储键名。
  const STORAGE_KEY = "steam_family_fit_analyzer_state_v1";
  // 商店条目缓存有效期，默认 7 天。
  const STORE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  // 原价读取每批 app 数量。
  const ORIGINAL_PRICE_BATCH_SIZE = 50;
  // 共享支持性检测每批 app 数量。
  const SHAREABILITY_BATCH_SIZE = 50;
  // 商店请求之间的间隔，单位毫秒。
  const STORE_REQUEST_DELAY_MS = 50;
  // 自动后台刷新家庭库的间隔，默认 24 小时。
  const AUTO_FAMILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  // Steam 商店分类中“家庭共享”特性的 category id。
  const FAMILY_SHARING_CATEGORY_ID = 62;

  const STORE_LANG = getDetectedStoreLanguage();
  const INITIAL_STORE_CC = getDetectedStoreCountryFromPage();
  let STORE_CC = INITIAL_STORE_CC || FALLBACK_STORE_CC;
  let STORE_CACHE_CONTEXT = getStoreCacheContext();
  let appLocaleMode = getSavedAppLocaleMode();
  let UI_LOCALE = resolveUiLocale(appLocaleMode, STORE_LANG);

  const I18N = {
    "zh-CN": {
      appName: "Steam 家庭库分析器",
      launcher: "家庭库分析",
      waitFamilyScan: "等待家庭库扫描",
      hideLauncher: "隐藏侧边按钮",
      openAnalyzer: "打开 Steam 家庭库分析器",
      more: "更多",
      copyReport: "复制报告",
      clearStoreCache: "清除商店缓存",
      rawData: "查看原始数据",
      close: "关闭",
      languageTitle: "语言",
      languageAuto: "自动",
      languageChinese: "中文",
      languageEnglish: "English",
      targetPlaceholder: "SteamID64、主页链接或自定义 ID",
      refreshFamily: "刷新家庭库",
      analyzeAccount: "分析账号",
      continue: "继续",
      rateCheck: "限流检测",
      tabs: {
        all: "全部",
        family: "家庭库",
        new: "新增",
        overlap: "重复",
        search: "搜索"
      },
      searchPlaceholder: "搜索游戏名或 AppID",
      copyList: "复制列表",
      initialEmpty: "输入账号后分析",
      signInFirst: "请先登录",
      accountSwitched: "账号已切换，请刷新",
      loadedCount: "已加载：{count} 款",
      refreshFirst: "请先刷新",
      launcherHidden: "侧边按钮已隐藏",
      launcherVisible: "侧边按钮已显示",
      showLauncherMenu: "显示侧边按钮",
      hideLauncherMenu: "隐藏侧边按钮",
      openDialogMenu: "打开分析弹窗",
      refreshing: "刷新中...",
      notLoggedInOrExpired: "未登录或页面过期",
      refreshedCount: "已刷新：{count} 款",
      autoRefreshedCount: "已自动刷新：{count} 款",
      autoRefreshFailed: "自动刷新失败：",
      enterAccount: "请输入账号",
      readApiKey: "读取 API Key...",
      readTargetLibrary: "读取目标库...",
      compareLibraries: "比较游戏库...",
      shownAllProgress: "已显示全部，后台统计 {percent}",
      noSummary: "暂无摘要",
      reportTitle: "Steam 家庭库分析：{target}",
      totalGames: "总游戏",
      addedGames: "新增",
      duplicatedGames: "重复",
      overlapRate: "重复率",
      addedValue: "新增价值",
      copied: "已复制",
      copyFailed: "复制失败",
      noList: "暂无列表",
      enterSearch: "请先输入关键词",
      currentListEmpty: "当前列表为空",
      copiedList: "已复制列表",
      popupBlocked: "弹窗被拦截",
      rawDataTitle: "返回原始数据",
      autoRefreshOn: "自动刷新已开",
      autoRefreshOff: "自动刷新已关",
      storeCacheCleared: "已清除商店缓存",
      communityNotSignedIn: "Community 未登录",
      apiKeyNotRegistered: "未注册 API Key",
      apiKeyNotFound: "找不到 API Key",
      noFamilyGroup: "没有家庭组",
      unnamed: "未命名",
      emptyFamilyLibrary: "家庭库为空",
      invalidAccount: "账号格式不对",
      currentAccountUnsupported: "不能分析当前登录账号，请输入另一个公开 Steam 账号",
      missingVanity: "缺少自定义 ID",
      missingApiKey: "缺少 API Key",
      resolveVanityFailed: "无法解析自定义 ID{message}",
      privateTargetLibrary: "目标库不可见",
      backgroundProgress: "后台统计：{percent}",
      done: "完成",
      completedAdded: "统计完成：新增 {count} 款",
      invalidAppid: "AppID 无效：{appid}",
      storeBatchMalformed: "共享支持性批量响应格式异常",
      notRefreshed: "未刷新",
      noCache: "无缓存",
      targetAccount: "目标账号",
      progress: "统计进度",
      unknownAccount: "未知账号",
      time: "时间",
      link: "链接",
      openProfile: "打开主页",
      autoRefreshClose: "关闭自动刷新",
      autoRefreshOpen: "开启自动刷新",
      autoRefreshTitle: "每 24 小时刷新上次：{time}",
      game: "游戏",
      owners: "贡献者",
      acquiredAt: "入库时间",
      price: "原价",
      list: "列表",
      info: "信息",
      status: "状态",
      noFamilyRefresh: "请先刷新家庭库",
      tabEmpty: "{tab}为空",
      searchEmpty: "输入关键词搜索",
      noMatches: "没有匹配游戏",
      unsupported: "不可共享",
      noAddedValue: "不计入新增",
      pending: "统计中",
      requestTooFast: "请求过快，请稍后再试",
      continueStats: "继续统计...",
      continuePrices: "继续加载价格...",
      nothingToContinue: "没有待继续任务",
      checking: "检测中...",
      rateLimitCleared: "限流已解除，可继续",
      rateLimitedStill: "仍被限流，请稍后再试",
      checkFailed: "检测失败",
      jsonParseFailed: "JSON 无法解析",
      networkFailed: "网络失败",
      requestTimeout: "请求超时",
      loading: "加载中"
    },
    en: {
      appName: "Steam Family Library Analyzer",
      launcher: "Family Analyzer",
      waitFamilyScan: "Waiting for family library",
      hideLauncher: "Hide side button",
      openAnalyzer: "Open Steam Family Library Analyzer",
      more: "More",
      copyReport: "Copy report",
      clearStoreCache: "Clear store cache",
      rawData: "View raw data",
      close: "Close",
      languageTitle: "Language",
      languageAuto: "Auto",
      languageChinese: "中文",
      languageEnglish: "English",
      targetPlaceholder: "SteamID64, profile URL, or custom ID",
      refreshFamily: "Refresh family library",
      analyzeAccount: "Analyze account",
      continue: "Continue",
      rateCheck: "Check rate limit",
      tabs: {
        all: "All",
        family: "Family library",
        new: "Added",
        overlap: "Duplicates",
        search: "Search"
      },
      searchPlaceholder: "Search game name or AppID",
      copyList: "Copy list",
      initialEmpty: "Enter an account to analyze",
      signInFirst: "Please sign in first",
      accountSwitched: "Account changed, please refresh",
      loadedCount: "Loaded: {count}",
      refreshFirst: "Please refresh first",
      launcherHidden: "Side button hidden",
      launcherVisible: "Side button shown",
      showLauncherMenu: "Show side button",
      hideLauncherMenu: "Hide side button",
      openDialogMenu: "Open analyzer",
      refreshing: "Refreshing...",
      notLoggedInOrExpired: "Not signed in or page expired",
      refreshedCount: "Refreshed: {count}",
      autoRefreshedCount: "Auto-refreshed: {count}",
      autoRefreshFailed: "Auto refresh failed:",
      enterAccount: "Enter an account",
      readApiKey: "Reading API key...",
      readTargetLibrary: "Reading target library...",
      compareLibraries: "Comparing libraries...",
      shownAllProgress: "Showing all, background progress {percent}",
      noSummary: "No summary yet",
      reportTitle: "Steam family library analysis: {target}",
      totalGames: "Total games",
      addedGames: "Added",
      duplicatedGames: "Duplicates",
      overlapRate: "Duplicate rate",
      addedValue: "Added value",
      copied: "Copied",
      copyFailed: "Copy failed",
      noList: "No list yet",
      enterSearch: "Enter a search term first",
      currentListEmpty: "Current list is empty",
      copiedList: "List copied",
      popupBlocked: "Popup blocked",
      rawDataTitle: "Raw data",
      autoRefreshOn: "Auto refresh on",
      autoRefreshOff: "Auto refresh off",
      storeCacheCleared: "Store cache cleared",
      communityNotSignedIn: "Community not signed in",
      apiKeyNotRegistered: "API key is not registered",
      apiKeyNotFound: "API key not found",
      noFamilyGroup: "No family group",
      unnamed: "Unnamed",
      emptyFamilyLibrary: "Family library is empty",
      invalidAccount: "Invalid account format",
      currentAccountUnsupported: "The current signed-in account cannot be analyzed. Enter another public Steam account.",
      missingVanity: "Missing custom ID",
      missingApiKey: "Missing API key",
      resolveVanityFailed: "Unable to resolve custom ID{message}",
      privateTargetLibrary: "Target library is private",
      backgroundProgress: "Background progress: {percent}",
      done: "Done",
      completedAdded: "Completed: {count} added",
      invalidAppid: "Invalid AppID: {appid}",
      storeBatchMalformed: "Unexpected store batch response",
      notRefreshed: "Not refreshed",
      noCache: "No cache",
      targetAccount: "Target account",
      progress: "Progress",
      unknownAccount: "Unknown account",
      time: "Time",
      link: "Link",
      openProfile: "Open profile",
      autoRefreshClose: "Disable auto refresh",
      autoRefreshOpen: "Enable auto refresh",
      autoRefreshTitle: "Refreshes every 24 hours. Last: {time}",
      game: "Game",
      owners: "Owners",
      acquiredAt: "Acquired",
      price: "Original price",
      list: "List",
      info: "Info",
      status: "Status",
      noFamilyRefresh: "Refresh family library first",
      tabEmpty: "{tab} is empty",
      searchEmpty: "Enter keywords to search",
      noMatches: "No matching games",
      unsupported: "Not shareable",
      noAddedValue: "Not counted",
      pending: "Processing",
      requestTooFast: "Too many requests, please try again later",
      continueStats: "Continuing...",
      continuePrices: "Continuing price loading...",
      nothingToContinue: "Nothing to continue",
      checking: "Checking...",
      rateLimitCleared: "Rate limit cleared, you can continue",
      rateLimitedStill: "Still rate limited, please try later",
      checkFailed: "Check failed",
      jsonParseFailed: "Unable to parse JSON",
      networkFailed: "Network failed",
      requestTimeout: "Request timed out",
      loading: "Loading"
    }
  };

  function t(key, vars = {}) {
    const value = key.split(".").reduce((cursor, part) => cursor?.[part], I18N[UI_LOCALE])
      ?? key.split(".").reduce((cursor, part) => cursor?.[part], I18N["zh-CN"])
      ?? key;
    return String(value).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
  }

  function labelValue(label, value) {
    return `${label}${UI_LOCALE === "en" ? ": " : "："}${value}`;
  }

  function getAutoUiLocale(storeLanguage) {
    return storeLanguage === "schinese" || storeLanguage === "tchinese" ? "zh-CN" : "en";
  }

  function resolveUiLocale(mode, storeLanguage = STORE_LANG) {
    const normalizedMode = normalizeAppLocaleMode(mode);
    return normalizedMode === "auto" ? getAutoUiLocale(storeLanguage) : normalizedMode;
  }

  function normalizeAppLocaleMode(mode) {
    return ["auto", "zh-CN", "en"].includes(mode) ? mode : APP_LOCALE;
  }

  function getSavedAppLocaleMode() {
    try {
      return normalizeAppLocaleMode(GM_getValue(STORAGE_KEY)?.appLocaleMode);
    } catch (error) {
      return APP_LOCALE;
    }
  }

  function getLocaleModeLabel(mode = appLocaleMode) {
    const normalizedMode = normalizeAppLocaleMode(mode);
    if (normalizedMode === "auto") {
      const locale = getLocaleName(resolveUiLocale("auto"));
      return UI_LOCALE === "en" ? `${t("languageAuto")} (${locale})` : `${t("languageAuto")}（${locale}）`;
    }
    return getLocaleName(normalizedMode);
  }

  function getLocaleName(locale) {
    return {
      "zh-CN": t("languageChinese"),
      en: t("languageEnglish")
    }[locale] || t("languageEnglish");
  }

  function getLocaleModeButtonText() {
    return labelValue(t("languageTitle"), getLocaleModeLabel());
  }

  function getDetectedStoreLanguage() {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const candidates = [
      new URLSearchParams(location.search).get("l"),
      pageWindow?.g_strLanguage,
      window.g_strLanguage,
      readCookieValue("Steam_Language"),
      document.documentElement.lang
    ];

    for (const candidate of candidates) {
      const language = normalizeSteamLanguage(candidate);
      if (language) {
        return language;
      }
    }
    return FALLBACK_STORE_LANG;
  }

  function normalizeSteamLanguage(value) {
    const normalized = String(value || "").trim().toLowerCase().replace("_", "-");
    return {
      english: "english",
      en: "english",
      "en-us": "english",
      "en-gb": "english",
      schinese: "schinese",
      "zh-cn": "schinese",
      "zh-hans": "schinese",
      tchinese: "tchinese",
      "zh-tw": "tchinese",
      "zh-hk": "tchinese",
      japanese: "japanese",
      ja: "japanese",
      "ja-jp": "japanese",
      koreana: "koreana",
      ko: "koreana",
      "ko-kr": "koreana",
      german: "german",
      de: "german",
      "de-de": "german",
      french: "french",
      fr: "french",
      "fr-fr": "french",
      italian: "italian",
      it: "italian",
      spanish: "spanish",
      es: "spanish",
      "es-es": "spanish",
      "brazilian": "brazilian",
      "pt-br": "brazilian",
      russian: "russian",
      ru: "russian"
    }[normalized] || "";
  }

  function getStoreCacheContext() {
    return `${STORE_CC}:${STORE_LANG}`;
  }

  function setStoreCountry(country) {
    const normalized = normalizeStoreCountry(country);
    if (!normalized || normalized === STORE_CC) {
      return;
    }
    STORE_CC = normalized;
    STORE_CACHE_CONTEXT = getStoreCacheContext();
  }

  function getDetectedStoreCountryFromPage(doc = document, pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window) {
    const configNode = getApplicationConfigNode(pageWindow, doc);
    const storeUserConfig = configNode ? readJsonAttribute(configNode, "data-store_user_config") : null;
    const userInfo = configNode ? readJsonAttribute(configNode, "data-userinfo") : null;
    const walletInfo = pageWindow?.g_rgWalletInfo || (doc === document ? window.g_rgWalletInfo : {}) || {};
    const candidates = [
      doc === document ? new URLSearchParams(location.search).get("cc") : "",
      pageWindow?.g_strCountryCode,
      doc === document ? window.g_strCountryCode : "",
      pageWindow?.g_strUserCountry,
      doc === document ? window.g_strUserCountry : "",
      storeUserConfig?.country_code,
      storeUserConfig?.web_country_code,
      storeUserConfig?.user_country,
      userInfo?.country_code,
      walletInfo?.wallet_country,
      walletInfo?.country_code,
      doc === document ? readCookieValue("steamCountry") : ""
    ];

    for (const candidate of candidates) {
      const country = normalizeStoreCountry(candidate);
      if (country) {
        return country;
      }
    }
    return "";
  }

  async function resolveStoreCountryFromAccount() {
    if (INITIAL_STORE_CC || location.hostname === "store.steampowered.com") {
      return;
    }

    try {
      const html = await Promise.race([
        requestText(`https://store.steampowered.com/?l=${encodeURIComponent(STORE_LANG)}`).catch(() => ""),
        sleep(3000).then(() => "")
      ]);
      if (!html) {
        return;
      }
      const doc = new DOMParser().parseFromString(html, "text/html");
      setStoreCountry(getDetectedStoreCountryFromPage(doc, {}));
    } catch (error) {
      // Keep the fallback country if the account region cannot be read from the store page.
    }
  }

  function normalizeStoreCountry(value) {
    const match = String(value || "").toUpperCase().match(/[A-Z]{2}/);
    return match ? match[0] : "";
  }

  function readCookieValue(name) {
    const pattern = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`);
    const match = document.cookie.match(pattern);
    return match ? decodeURIComponent(match[1]) : "";
  }

  const DEFAULT_STATE = Object.freeze({
    version: 1,
    activeSteamId: "",
    launcherVisible: true,
    familyInfo: null,
    familyLibrary: {
      appidSet: [],
      appInfoById: {},
      updatedAt: 0
    },
    storeCache: {},
    autoFamilyRefreshEnabled: true,
    lastAutoFamilyRefreshAttemptAt: 0,
    appLocaleMode: APP_LOCALE,
    apiKey: ""
  });

  let state = cloneDefaultState();
  let currentTab = "all";
  let tableSortByTab = {};
  let lastReport = null;
  let lastRawData = createRawDataSnapshot("init");
  let storeRequestQueue = Promise.resolve();
  let priceLoadState = createPriceLoadState();
  let activeAnalysisId = 0;
  let shareabilityFilterState = createShareabilityFilterState();
  let shareabilityProgressUiState = createShareabilityProgressUiState();
  let rateLimitState = createRateLimitState();
  let scriptMenuCommandIds = [];
  let autoFamilyRefreshRunning = false;
  let elements = {};

  bootstrap();

  async function bootstrap() {
    await resolveStoreCountryFromAccount();
    state = loadState();
    injectStyles();
    mountPanel();
    autoFillTargetInputFromProfilePage();
    const session = getSteamSession();
    if (!session.isLoggedIn) {
      setStatus(t("signInFirst"), "warn");
      setBusy(false);
      return;
    }

    if (!state.activeSteamId) {
      state.activeSteamId = session.steamid;
      saveState();
    } else if (state.activeSteamId !== session.steamid) {
      setStatus(t("accountSwitched"), "warn");
    } else if (state.familyLibrary.appidSet.length > 0) {
      setStatus(t("loadedCount", { count: state.familyLibrary.appidSet.length }), "ok");
    } else {
      setStatus(t("refreshFirst"), "warn");
    }
    renderLauncherVisibility();
    registerScriptMenuCommands();
    renderFamilyMeta();
    window.setTimeout(() => maybeAutoRefreshFamilyLibrary(session), 0);
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #sffa-root {
        position: fixed;
        inset: 0;
        z-index: 999999;
        pointer-events: none;
        color: #dbe8f3;
        font-family: Motiva Sans, Arial, Helvetica, sans-serif;
      }
      #sffa-root, #sffa-root * {
        box-sizing: border-box;
      }
      .sffa-launcher-wrap {
        position: fixed;
        right: 0;
        top: 58%;
        pointer-events: auto;
        display: inline-flex;
        align-items: stretch;
        transform: translateY(-50%) translateX(22px);
        transition: transform 0.16s ease, opacity 0.16s ease, visibility 0.16s ease;
      }
      .sffa-launcher-wrap:hover {
        transform: translateY(-50%) translateX(0);
      }
      .sffa-launcher-wrap.is-hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .sffa-launcher-wrap.is-hidden:hover {
        transform: translateY(-50%) translateX(22px);
      }
      .sffa-launcher {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        min-height: 88px;
        padding: 10px 6px;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-right: 0;
        border-radius: 4px 0 0 4px;
        background: linear-gradient(180deg, #1f3c4f 0%, #183245 100%);
        color: #ffffff;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
        font: inherit;
        font-size: 12px;
        line-height: 1.15;
        writing-mode: vertical-rl;
        letter-spacing: 0;
        position: relative;
        transition: filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-launcher-close {
        position: absolute;
        left: -14px;
        top: -8px;
        width: 16px;
        height: 16px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: #dbe8f3;
        font: inherit;
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        z-index: 1;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: color 0.12s ease, opacity 0.12s ease, visibility 0.12s ease;
      }
      .sffa-launcher-wrap:hover .sffa-launcher-close {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .sffa-launcher-close:hover {
        color: #ffffff;
      }
      .sffa-launcher:hover {
        background: linear-gradient(180deg, #27556f 0%, #20465c 100%);
        filter: brightness(1.07);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(143, 209, 255, 0.22) inset;
      }
      .sffa-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(11, 16, 22, 0.72);
        backdrop-filter: blur(2px);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.16s ease, visibility 0.16s ease;
        pointer-events: none;
      }
      .sffa-shell {
        position: fixed;
        left: 50%;
        top: 50%;
        width: min(1120px, calc(100vw - 28px));
        height: min(860px, calc(100vh - 28px));
        transform: translate(-50%, -50%) scale(0.98);
        opacity: 0;
        visibility: hidden;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 4px;
        background: #171a21;
        box-shadow: 0 28px 72px rgba(0, 0, 0, 0.58);
        transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s ease;
      }
      #sffa-root.is-open .sffa-backdrop {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      #sffa-root.is-open .sffa-shell {
        opacity: 1;
        visibility: visible;
        transform: translate(-50%, -50%) scale(1);
      }
      #sffa-root.is-open .sffa-launcher {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      #sffa-root.is-open .sffa-launcher-wrap {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .sffa-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        background: linear-gradient(180deg, #2a475e 0%, #1b2838 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .sffa-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .sffa-title strong {
        font-size: 15px;
        font-weight: 700;
        color: #ffffff;
        line-height: 1.2;
      }
      .sffa-title span {
        font-size: 12px;
        color: #b8c7d3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sffa-header-actions {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      .sffa-icon-btn,
      .sffa-close {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 2px;
        cursor: pointer;
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
      }
      .sffa-icon-btn {
        font-size: 20px;
        line-height: 1;
      }
      .sffa-icon-btn:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-icon-btn[aria-expanded="true"] {
        background: rgba(102, 192, 244, 0.2);
      }
      .sffa-locale-wrap {
        position: relative;
      }
      .sffa-locale-btn {
        height: 30px;
        max-width: 180px;
        padding: 0 9px;
        border: 1px solid rgba(102, 192, 244, 0.24);
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
        color: #dbe8f3;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sffa-locale-btn:hover,
      .sffa-locale-btn[aria-expanded="true"] {
        background: rgba(102, 192, 244, 0.18);
        border-color: rgba(143, 209, 255, 0.42);
      }
      .sffa-locale-menu {
        position: absolute;
        right: 0;
        top: 36px;
        min-width: 138px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 3;
      }
      .sffa-locale-wrap.is-open .sffa-locale-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-locale-option {
        width: 100%;
        min-height: 30px;
        padding: 0 10px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #dbe8f3;
        text-align: left;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
      }
      .sffa-locale-option:hover {
        background: rgba(102, 192, 244, 0.14);
      }
      .sffa-locale-option.is-active {
        background: rgba(102, 192, 244, 0.22);
        color: #ffffff;
      }
      .sffa-icon-btn:hover,
      .sffa-close:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .sffa-launcher:hover,
      .sffa-icon-btn:hover:not(:disabled),
      .sffa-close:hover:not(:disabled),
      .sffa-menu-item:hover:not(:disabled),
      .sffa-btn:hover:not(:disabled),
      .sffa-tab:hover:not(:disabled),
      .sffa-copy-current:hover:not(:disabled) {
        filter: brightness(1.08);
        box-shadow: 0 0 0 1px rgba(143, 209, 255, 0.2) inset;
      }
      .sffa-menu {
        position: absolute;
        right: 36px;
        top: 36px;
        min-width: 190px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 2;
      }
      .sffa-header-actions.is-menu-open .sffa-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-menu-item {
        width: 100%;
        min-height: 32px;
        padding: 0 10px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #dbe8f3;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .sffa-menu-item:hover {
        background: rgba(102, 192, 244, 0.14);
      }
      .sffa-menu-item.danger {
        color: #ffd0d0;
      }
      .sffa-menu-item:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-body {
        min-height: 0;
        flex: 1 1 auto;
        padding: 10px 12px 12px;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
        overflow: hidden;
      }
      .sffa-content {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: 360px minmax(0, 1fr);
        gap: 12px;
        overflow: hidden;
      }
      .sffa-side {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 8px;
        overflow: hidden;
      }
      .sffa-main {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 8px;
        overflow: hidden;
      }
      .sffa-row {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .sffa-input {
        flex: 1 1 320px;
        min-width: 0;
        height: 36px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 10px;
        outline: none;
      }
      .sffa-input:focus {
        border-color: #66c0f4;
        box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.12);
      }
      .sffa-btn {
        height: 36px;
        padding: 0 12px;
        border-radius: 3px;
        color: #ffffff;
        background: linear-gradient(180deg, #2a475e 0%, #1b2838 100%);
        border: 1px solid rgba(102, 192, 244, 0.26);
        white-space: nowrap;
        transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-btn:hover:not(:disabled),
      .sffa-tab:hover:not(:disabled),
      .sffa-menu-item:hover:not(:disabled),
      .sffa-icon-btn:hover:not(:disabled),
      .sffa-close:hover:not(:disabled),
      .sffa-copy-current:hover:not(:disabled) {
      }
      .sffa-btn.secondary {
        background: linear-gradient(180deg, #3d5568 0%, #2d4355 100%);
        color: #e2edf4;
      }
      .sffa-btn.danger {
        background: linear-gradient(180deg, #6a4448 0%, #4f3135 100%);
        color: #ffe8e8;
      }
      .sffa-btn:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-status {
        min-height: 18px;
        font-size: 12px;
        color: #b8c7d3;
      }
      .sffa-status-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .sffa-status-row .sffa-status {
        flex: 1 1 auto;
        min-width: 0;
      }
      .sffa-status.ok {
        color: #9be0ad;
      }
      .sffa-status.warn {
        color: #ffd28c;
      }
      .sffa-status.err {
        color: #ffaaa2;
      }
      .sffa-rate-btn {
        flex: 0 0 auto;
        min-height: 22px;
        padding: 3px 8px;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 3px;
        background: #2d4355;
        color: #e2edf4;
        font: inherit;
        font-size: 12px;
        line-height: 1.2;
        cursor: pointer;
        transition: filter 0.12s ease, border-color 0.12s ease, background 0.12s ease;
      }
      .sffa-rate-btn:hover:not(:disabled) {
        filter: brightness(1.16);
        border-color: rgba(143, 209, 255, 0.66);
      }
      .sffa-rate-btn:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-content: start;
        gap: 6px;
      }
      .sffa-metric {
        min-height: 44px;
        padding: 7px 8px;
        border-radius: 3px;
        background: #1f2b36;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .sffa-metric span {
        display: block;
        font-size: 11px;
        line-height: 1.25;
        color: #9fb3c2;
        margin-bottom: 4px;
      }
      .sffa-metric strong {
        display: block;
        font-size: 15px;
        line-height: 1.05;
        color: #ffffff;
        overflow-wrap: anywhere;
      }
      .sffa-profile {
        min-height: 0;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 3px;
        background: #11161d;
        overflow: auto;
      }
      .sffa-profile-head {
        display: flex;
        gap: 10px;
        align-items: center;
        min-width: 0;
        margin-bottom: 10px;
      }
      .sffa-avatar {
        width: 48px;
        height: 48px;
        flex: 0 0 auto;
        border-radius: 3px;
        background: #223344;
        object-fit: cover;
      }
      .sffa-profile-name {
        min-width: 0;
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .sffa-profile-link {
        display: inline-block;
        margin-top: 4px;
        color: #8fd1ff;
        font-size: 12px;
        text-decoration: none;
      }
      .sffa-profile-row {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 8px;
        padding: 5px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 12px;
      }
      .sffa-profile-row span:first-child {
        color: #9fb3c2;
      }
      .sffa-profile-row span:last-child {
        color: #d8e4ee;
        overflow-wrap: anywhere;
      }
      .sffa-tabs {
        display: flex;
        gap: 6px;
        min-height: 30px;
        align-items: center;
      }
      .sffa-tab {
        flex: 0 0 auto;
        height: 30px;
        padding: 0 10px;
        border-radius: 3px;
        background: #223344;
        color: #c2d4df;
        border: 1px solid rgba(255, 255, 255, 0.08);
        white-space: nowrap;
        transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-tab:hover:not(:disabled) {
        background: #2c4254;
        border-color: rgba(143, 209, 255, 0.28);
      }
      .sffa-tab.active:hover:not(:disabled) {
        background: linear-gradient(180deg, #66c0f4 0%, #4ea5d8 100%);
        border-color: rgba(143, 209, 255, 0.45);
        filter: brightness(1.05);
      }
      .sffa-tab.active {
        background: linear-gradient(180deg, #66c0f4 0%, #4ea5d8 100%);
        color: #0a1118;
        font-weight: 700;
      }
      .sffa-tab[data-tab="family"] {
        margin-left: auto;
      }
      .sffa-search-input {
        display: none;
        flex: 1 1 130px;
        margin-left: 6px;
        width: min(220px, 34%);
        min-width: 120px;
        height: 30px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 9px;
        outline: none;
      }
      .sffa-search-input.is-visible {
        display: block;
      }
      .sffa-copy-current {
        margin-left: 0;
      }
      .sffa-copy-current:hover:not(:disabled) {
        background: #2c4254;
        border-color: rgba(143, 209, 255, 0.28);
      }
      .sffa-copy-current:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-search-input:focus {
        border-color: #66c0f4;
      }
      .sffa-table-wrap {
        min-height: 0;
        overflow: auto;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 3px;
        background: #11161d;
      }
      .sffa-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 12px;
      }
      .sffa-table th,
      .sffa-table td {
        padding: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        text-align: left;
        vertical-align: top;
      }
      .sffa-table th {
        position: sticky;
        top: 0;
        background: #0f141b;
        color: #9fb3c2;
        z-index: 1;
      }
      .sffa-table th[data-sort-key] {
        cursor: pointer;
        user-select: none;
      }
      .sffa-table th[data-sort-key]:hover {
        color: #d8e4ee;
        background: #17212b;
      }
      .sffa-sort-indicator {
        display: inline-block;
        min-width: 12px;
        margin-left: 4px;
        color: #8fd1ff;
      }
      .sffa-table td {
        color: #d8e4ee;
      }
      .sffa-table a {
        color: #8fd1ff;
        text-decoration: none;
      }
      .sffa-spinner {
        width: 14px;
        height: 14px;
        display: inline-block;
        vertical-align: -2px;
        border: 2px solid rgba(143, 209, 255, 0.25);
        border-top-color: #8fd1ff;
        border-radius: 50%;
        animation: sffa-spin 0.8s linear infinite;
      }
      .sffa-status-inline {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      @keyframes sffa-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .sffa-empty {
        padding: 18px;
        color: #9fb3c2;
        text-align: center;
      }
      @media (max-width: 680px) {
        .sffa-launcher-wrap {
          right: 0;
          top: 62%;
          transform: translateY(-50%) translateX(22px);
        }
        .sffa-launcher-wrap:hover {
          transform: translateY(-50%) translateX(0);
        }
        .sffa-launcher {
          min-height: 82px;
        }
        .sffa-shell {
          width: calc(100vw - 20px);
          height: calc(100vh - 20px);
        }
        .sffa-body {
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sffa-content {
          grid-template-columns: 1fr;
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sffa-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .sffa-table {
          min-width: 640px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function mountPanel() {
    const root = document.createElement("div");
    root.id = "sffa-root";
    root.innerHTML = `
      <div class="sffa-launcher-wrap" data-sffa-launcher-wrap>
        <button class="sffa-launcher-close" type="button" data-sffa-launcher-close title="${escapeAttr(t("hideLauncher"))}" aria-label="${escapeAttr(t("hideLauncher"))}">×</button>
        <button class="sffa-launcher" type="button" title="${escapeAttr(t("openAnalyzer"))}">
          <span>${escapeHtml(t("launcher"))}</span>
        </button>
      </div>
      <div class="sffa-backdrop" data-sffa-backdrop></div>
      <section class="sffa-shell" aria-label="${escapeAttr(t("appName"))}">
        <header class="sffa-header">
          <div class="sffa-title">
            <strong>${escapeHtml(t("launcher"))}</strong>
            <span data-sffa-family-meta>${escapeHtml(t("waitFamilyScan"))}</span>
          </div>
          <div class="sffa-header-actions" data-sffa-menu-wrap>
            <div class="sffa-locale-wrap" data-sffa-locale-wrap>
              <button class="sffa-locale-btn" type="button" data-sffa-locale-toggle aria-expanded="false">${escapeHtml(getLocaleModeButtonText())}</button>
              <div class="sffa-locale-menu" data-sffa-locale-menu>
                ${buildLocaleOptionHtml("auto")}
                ${buildLocaleOptionHtml("zh-CN")}
                ${buildLocaleOptionHtml("en")}
              </div>
            </div>
            <button class="sffa-icon-btn" type="button" data-sffa-more title="${escapeAttr(t("more"))}" aria-label="${escapeAttr(t("more"))}" aria-expanded="false">⋯</button>
            <div class="sffa-menu" data-sffa-menu>
              <button class="sffa-menu-item" type="button" data-sffa-auto-family-refresh></button>
              <button class="sffa-menu-item" type="button" data-sffa-copy>${escapeHtml(t("copyReport"))}</button>
              <button class="sffa-menu-item danger" type="button" data-sffa-clear-store-cache hidden>${escapeHtml(t("clearStoreCache"))}</button>
              <button class="sffa-menu-item" type="button" data-sffa-raw>${escapeHtml(t("rawData"))}</button>
            </div>
            <button class="sffa-close" type="button" data-sffa-close title="${escapeAttr(t("close"))}">×</button>
          </div>
        </header>
        <div class="sffa-body">
          <div class="sffa-row">
            <input class="sffa-input" data-sffa-target placeholder="${escapeAttr(t("targetPlaceholder"))}" autocomplete="off">
            <button class="sffa-btn secondary" type="button" data-sffa-refresh>${escapeHtml(t("refreshFamily"))}</button>
            <button class="sffa-btn" type="button" data-sffa-analyze>${escapeHtml(t("analyzeAccount"))}</button>
          </div>
          <div class="sffa-content">
            <div class="sffa-side">
            <div class="sffa-status-row">
              <div class="sffa-status" data-sffa-status></div>
              <button class="sffa-rate-btn" type="button" data-sffa-rate-continue hidden>${escapeHtml(t("continue"))}</button>
              <button class="sffa-rate-btn" type="button" data-sffa-rate-check hidden>${escapeHtml(t("rateCheck"))}</button>
            </div>
            <div class="sffa-summary" data-sffa-summary></div>
            <div class="sffa-profile" data-sffa-profile></div>
            </div>
            <div class="sffa-main">
              <div class="sffa-tabs" data-sffa-tabs>
                <button class="sffa-tab active" type="button" data-tab="all">${escapeHtml(t("tabs.all"))}</button>
              <button class="sffa-tab" type="button" data-tab="new">${escapeHtml(t("tabs.new"))}</button>
              <button class="sffa-tab" type="button" data-tab="overlap">${escapeHtml(t("tabs.overlap"))}</button>
              <button class="sffa-tab" type="button" data-tab="search">${escapeHtml(t("tabs.search"))}</button>
                <input class="sffa-search-input" data-sffa-search placeholder="${escapeAttr(t("searchPlaceholder"))}" autocomplete="off">
                <button class="sffa-tab" type="button" data-tab="family">${escapeHtml(t("tabs.family"))}</button>
                <button class="sffa-tab sffa-copy-current" type="button" data-sffa-copy-current>${escapeHtml(t("copyList"))}</button>
              </div>
              <div class="sffa-table-wrap" data-sffa-table-wrap>
                <div class="sffa-empty">${escapeHtml(t("initialEmpty"))}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(root);

    elements = {
      root,
      familyMeta: root.querySelector("[data-sffa-family-meta]"),
      status: root.querySelector("[data-sffa-status]"),
      summary: root.querySelector("[data-sffa-summary]"),
      profile: root.querySelector("[data-sffa-profile]"),
      tableWrap: root.querySelector("[data-sffa-table-wrap]"),
      backdrop: root.querySelector("[data-sffa-backdrop]"),
      closeBtn: root.querySelector("[data-sffa-close]"),
      launcherWrap: root.querySelector("[data-sffa-launcher-wrap]"),
      launcherCloseBtn: root.querySelector("[data-sffa-launcher-close]"),
      menuWrap: root.querySelector("[data-sffa-menu-wrap]"),
      localeWrap: root.querySelector("[data-sffa-locale-wrap]"),
      localeToggleBtn: root.querySelector("[data-sffa-locale-toggle]"),
      localeOptions: Array.from(root.querySelectorAll("[data-sffa-locale-option]")),
      moreBtn: root.querySelector("[data-sffa-more]"),
      launcher: root.querySelector(".sffa-launcher"),
      targetInput: root.querySelector("[data-sffa-target]"),
      searchInput: root.querySelector("[data-sffa-search]"),
      copyCurrentBtn: root.querySelector("[data-sffa-copy-current]"),
      refreshBtn: root.querySelector("[data-sffa-refresh]"),
      analyzeBtn: root.querySelector("[data-sffa-analyze]"),
      autoFamilyRefreshBtn: root.querySelector("[data-sffa-auto-family-refresh]"),
      copyBtn: root.querySelector("[data-sffa-copy]"),
      clearStoreCacheBtn: root.querySelector("[data-sffa-clear-store-cache]"),
      rawBtn: root.querySelector("[data-sffa-raw]"),
      rateContinueBtn: root.querySelector("[data-sffa-rate-continue]"),
      rateCheckBtn: root.querySelector("[data-sffa-rate-check]"),
      tabs: Array.from(root.querySelectorAll("[data-tab]"))
    };

    elements.launcher.addEventListener("click", openDialog);
    elements.launcherCloseBtn.addEventListener("click", hideLauncherButton);
    elements.closeBtn.addEventListener("click", closeDialog);
    elements.backdrop.addEventListener("click", closeDialog);
    elements.localeToggleBtn.addEventListener("click", toggleLocaleMenu);
    elements.localeOptions.forEach(option => {
      option.addEventListener("click", () => setAppLocaleMode(option.dataset.sffaLocaleOption));
    });
    elements.moreBtn.addEventListener("click", toggleMenu);
    elements.refreshBtn.addEventListener("click", refreshFamilyLibrary);
    elements.analyzeBtn.addEventListener("click", analyzeTarget);
    elements.autoFamilyRefreshBtn.addEventListener("click", toggleAutoFamilyRefresh);
    elements.copyBtn.addEventListener("click", copyReportSummary);
    elements.copyCurrentBtn.addEventListener("click", copyCurrentList);
    elements.clearStoreCacheBtn.addEventListener("click", clearStoreCache);
    elements.rawBtn?.addEventListener("click", showRawDataWindow);
    elements.rateContinueBtn?.addEventListener("click", continueAfterRateLimit);
    elements.rateCheckBtn?.addEventListener("click", checkRateLimit);
    elements.tableWrap.addEventListener("scroll", () => scheduleVisiblePriceLoads());
    elements.tableWrap.addEventListener("click", handleTableHeaderClick);
    elements.targetInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        analyzeTarget();
      }
    });
    elements.searchInput.addEventListener("input", renderDetails);
    elements.tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        currentTab = tab.dataset.tab;
        renderTabs();
        renderDetails();
      });
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeMenu();
        closeDialog();
      }
    });
    document.addEventListener("click", event => {
      if (!elements.menuWrap.contains(event.target)) {
        closeMenu();
      }
    });

    renderSummary(null);
    renderTargetProfile(null);
    renderAutoFamilyRefreshButton();
    renderStoreCacheButton();
    renderRateLimitControls();
  }

  function openDialog() {
    elements.root.classList.add("is-open");
    window.setTimeout(() => {
      elements.targetInput.focus();
      elements.targetInput.select();
    }, 0);
  }

  function autoFillTargetInputFromProfilePage() {
    if (!isSteamCommunityProfilePage()) {
      return;
    }
    if (elements.targetInput.value.trim()) {
      return;
    }
    const steamid = getSteamCommunityProfileSteamId();
    if (steamid) {
      elements.targetInput.value = steamid;
    }
  }

  function renderLauncherVisibility() {
    if (!elements.launcherWrap) {
      return;
    }
    const visible = state.launcherVisible !== false;
    elements.launcherWrap.classList.toggle("is-hidden", !visible);
  }

  function hideLauncherButton() {
    state.launcherVisible = false;
    saveState();
    renderLauncherVisibility();
    registerScriptMenuCommands();
    setStatus(t("launcherHidden"), "ok");
  }

  function toggleLauncherButtonVisibility() {
    state.launcherVisible = state.launcherVisible === false;
    saveState();
    renderLauncherVisibility();
    registerScriptMenuCommands();
    setStatus(state.launcherVisible ? t("launcherVisible") : t("launcherHidden"), "ok");
  }

  function registerScriptMenuCommands() {
    unregisterScriptMenuCommands();
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }
    scriptMenuCommandIds.push(
      GM_registerMenuCommand(state.launcherVisible === false ? t("showLauncherMenu") : t("hideLauncherMenu"), toggleLauncherButtonVisibility)
    );
    scriptMenuCommandIds.push(
      GM_registerMenuCommand(t("openDialogMenu"), openDialog)
    );
  }

  function unregisterScriptMenuCommands() {
    if (typeof GM_unregisterMenuCommand !== "function") {
      scriptMenuCommandIds = [];
      return;
    }
    scriptMenuCommandIds.forEach(id => {
      try {
        GM_unregisterMenuCommand(id);
      } catch (error) {
        // Ignore.
      }
    });
    scriptMenuCommandIds = [];
  }

  function closeDialog() {
    closeMenu();
    elements.root.classList.remove("is-open");
  }

  function toggleMenu(event) {
    event.stopPropagation();
    closeLocaleMenu();
    const isOpen = elements.menuWrap.classList.toggle("is-menu-open");
    elements.moreBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function toggleLocaleMenu(event) {
    event.stopPropagation();
    elements.menuWrap?.classList.remove("is-menu-open");
    elements.moreBtn?.setAttribute("aria-expanded", "false");
    const isOpen = elements.localeWrap.classList.toggle("is-open");
    elements.localeToggleBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function closeMenu() {
    elements.menuWrap?.classList.remove("is-menu-open");
    elements.moreBtn?.setAttribute("aria-expanded", "false");
    closeLocaleMenu();
  }

  function closeLocaleMenu() {
    elements.localeWrap?.classList.remove("is-open");
    elements.localeToggleBtn?.setAttribute("aria-expanded", "false");
  }

  function setAppLocaleMode(mode) {
    const nextMode = normalizeAppLocaleMode(mode);
    if (nextMode === appLocaleMode) {
      closeMenu();
      return;
    }

    appLocaleMode = nextMode;
    UI_LOCALE = resolveUiLocale(appLocaleMode);
    state.appLocaleMode = appLocaleMode;
    saveState();
    closeMenu();
    renderLocalizedUi();
  }

  function renderLocalizedUi() {
    elements.root.querySelector(".sffa-launcher span").textContent = t("launcher");
    elements.launcher.title = t("openAnalyzer");
    elements.launcherCloseBtn.title = t("hideLauncher");
    elements.launcherCloseBtn.setAttribute("aria-label", t("hideLauncher"));
    elements.root.querySelector(".sffa-title strong").textContent = t("launcher");
    elements.root.querySelector("[data-tab='all']").textContent = t("tabs.all");
    elements.root.querySelector("[data-tab='new']").textContent = t("tabs.new");
    elements.root.querySelector("[data-tab='overlap']").textContent = t("tabs.overlap");
    elements.root.querySelector("[data-tab='search']").textContent = t("tabs.search");
    elements.root.querySelector("[data-tab='family']").textContent = t("tabs.family");
    elements.localeToggleBtn.textContent = getLocaleModeButtonText();
    elements.localeOptions.forEach(option => {
      option.textContent = getLocaleModeLabel(option.dataset.sffaLocaleOption);
      option.classList.toggle("is-active", normalizeAppLocaleMode(option.dataset.sffaLocaleOption) === appLocaleMode);
    });
    elements.moreBtn.title = t("more");
    elements.moreBtn.setAttribute("aria-label", t("more"));
    elements.closeBtn.title = t("close");
    elements.targetInput.placeholder = t("targetPlaceholder");
    elements.refreshBtn.textContent = t("refreshFamily");
    elements.analyzeBtn.textContent = t("analyzeAccount");
    elements.searchInput.placeholder = t("searchPlaceholder");
    elements.copyCurrentBtn.textContent = t("copyList");
    elements.copyBtn.textContent = t("copyReport");
    elements.rawBtn.textContent = t("rawData");
    elements.rateContinueBtn.textContent = t("continue");
    elements.rateCheckBtn.textContent = t("rateCheck");

    registerScriptMenuCommands();
    renderFamilyMeta();
    renderAutoFamilyRefreshButton();
    renderStoreCacheButton();
    renderRateLimitControls();
    renderSummary(lastReport);
    renderTargetProfile(lastReport);
    renderTabs();
    renderDetailsPreserveScroll();
    renderCurrentStatusText();
  }

  function renderCurrentStatusText() {
    if (rateLimitState.active) {
      setStatus(t("requestTooFast"), "err");
      return;
    }
    if (lastReport) {
      const filtering = lastReport.filtering || {};
      if (filtering.running && filtering.total) {
        setStatus(t("backgroundProgress", { percent: formatPercent((filtering.processed || 0) / filtering.total) }), "warn");
        return;
      }
      setStatus(t("completedAdded", { count: lastReport.games.new?.length || 0 }), "ok");
      return;
    }

    const session = getSteamSession();
    if (!session.isLoggedIn) {
      setStatus(t("signInFirst"), "warn");
    } else if (state.activeSteamId && state.activeSteamId !== session.steamid) {
      setStatus(t("accountSwitched"), "warn");
    } else if (state.familyLibrary.appidSet.length > 0) {
      setStatus(t("loadedCount", { count: state.familyLibrary.appidSet.length }), "ok");
    } else {
      setStatus(t("refreshFirst"), "warn");
    }
  }

  async function refreshFamilyLibrary() {
    try {
      openDialog();
      setBusy(true);
      resetRawData("refresh-family-library");
      setStatus(t("refreshing"), "warn");
      const session = getSteamSession();
      if (!session.isLoggedIn || !session.accessToken || !session.steamid) {
        throw new Error(t("notLoggedInOrExpired"));
      }

      const familyLibrary = await updateFamilyLibraryCache(session);

      renderFamilyMeta();
      renderAutoFamilyRefreshButton();
      setStatus(t("refreshedCount", { count: familyLibrary.appidSet.length }), "ok");
    } catch (error) {
      setStatus(error.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function updateFamilyLibraryCache(session) {
    const familyInfo = await getFamilyInfo(session.accessToken);
    const familyLibrary = await getFamilyGameList(session.accessToken, familyInfo.family_groupid);
    state.activeSteamId = session.steamid;
    state.familyInfo = familyInfo;
    state.familyLibrary = familyLibrary;
    saveState();
    return familyLibrary;
  }

  async function maybeAutoRefreshFamilyLibrary(session) {
    if (!state.autoFamilyRefreshEnabled || autoFamilyRefreshRunning) {
      return;
    }
    if (!session?.isLoggedIn || !session.accessToken || !session.steamid) {
      return;
    }
    if (state.activeSteamId && state.activeSteamId !== session.steamid) {
      return;
    }

    const now = Date.now();
    const lastSuccessAt = Number(state.familyLibrary?.updatedAt || 0);
    const lastAttemptAt = Number(state.lastAutoFamilyRefreshAttemptAt || 0);
    if (now - Math.max(lastSuccessAt, lastAttemptAt) < AUTO_FAMILY_REFRESH_INTERVAL_MS) {
      return;
    }

    autoFamilyRefreshRunning = true;
    state.lastAutoFamilyRefreshAttemptAt = now;
    saveState();

    try {
      resetRawData("auto-refresh-family-library");
      const familyLibrary = await updateFamilyLibraryCache(session);
      renderFamilyMeta();
      setStatus(t("autoRefreshedCount", { count: familyLibrary.appidSet.length }), "ok");
    } catch (error) {
      setRawError(error);
      console.warn(t("autoRefreshFailed"), error);
    } finally {
      autoFamilyRefreshRunning = false;
      renderAutoFamilyRefreshButton();
    }
  }

  async function analyzeTarget() {
    try {
      openDialog();
      setBusy(true);
      resetRawData("analyze-target");
      const rawInput = elements.targetInput.value.trim();
      if (!rawInput) {
        throw new Error(t("enterAccount"));
      }
      setRawStep("check-family-cache");
      const session = ensureFamilyReady();
      setStatus(t("readApiKey"), "warn");
      setRawStep("read-steam-web-api-key");
      await autoReadApiKeyFromCommunity({ keepBusy: true });

      setStatus(t("readTargetLibrary"), "warn");
      setRawStep("fetch-target-owned-games");
      const targetProfile = await getTargetProfile(rawInput);
      if (targetProfile.steamid64 === session.steamid) {
        throw new Error(t("currentAccountUnsupported"));
      }
      setStatus(t("compareLibraries"), "warn");
      setRawStep("compare-libraries");
      const comparison = compareLibraries(targetProfile);
      const analysisId = ++activeAnalysisId;
      priceLoadState = createPriceLoadState();
      shareabilityFilterState = createShareabilityFilterState(analysisId, 0, targetProfile.games.length, targetProfile.games.length);
      if (shareabilityProgressUiState?.timer) {
        window.clearTimeout(shareabilityProgressUiState.timer);
      }
      shareabilityProgressUiState = createShareabilityProgressUiState(analysisId);
      setRawStep("build-report");
      lastReport = buildReport(targetProfile, {
        ...comparison,
        allGames: targetProfile.games,
        pendingNewGames: comparison.newGames,
        newGames: []
      });

      currentTab = "all";
      renderTabs();
      renderSummary(lastReport);
      renderTargetProfile(lastReport);
      renderDetails();
      setStatus(t("shownAllProgress", { percent: formatPercent(targetProfile.games.length ? comparison.overlapGames.length / targetProfile.games.length : 0) }), "warn");
      setRawStep("background-load-store-items");
      window.setTimeout(() => {
        startBackgroundShareabilityFilter(analysisId, targetProfile.games);
      }, 0);
    } catch (error) {
      setRawError(error);
      setStatus(error.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function copyReportSummary() {
    closeMenu();
    if (!lastReport) {
      setStatus(t("noSummary"), "warn");
      return;
    }

    const summary = [
      t("reportTitle", { target: lastReport.target.displayName || lastReport.target.steamid64 }),
      labelValue(t("totalGames"), lastReport.metrics.targetCount),
      labelValue(t("tabs.family"), lastReport.metrics.familyCount),
      labelValue(t("addedGames"), lastReport.metrics.newCount),
      labelValue(t("duplicatedGames"), lastReport.metrics.overlapCount),
      labelValue(t("overlapRate"), formatPercent(lastReport.metrics.overlapRate)),
      labelValue(t("addedValue"), formatMoney(lastReport.metrics.initialValue))
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      setStatus(t("copied"), "ok");
    } catch (error) {
      setStatus(t("copyFailed"), "err");
    }
  }

  async function copyCurrentList() {
    const rows = getCurrentListRows();
    if (!lastReport && currentTab !== "family") {
      setStatus(t("noList"), "warn");
      return;
    }

    if (rows.length === 0) {
      setStatus(currentTab === "search" ? t("enterSearch") : t("currentListEmpty"), "warn");
      return;
    }

    const table = buildCurrentListCopyTable(rows);
    const text = [table.headers, ...table.rows]
      .map(row => row.map(normalizeCopyCell).join("\t"))
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setStatus(t("copiedList"), "ok");
    } catch (error) {
      setStatus(t("copyFailed"), "err");
    }
  }

  function showRawDataWindow() {
    closeMenu();
    const popup = window.open("", "_blank", "width=980,height=720");
    if (!popup) {
      setStatus(t("popupBlocked"), "err");
      return;
    }

    popup.document.title = t("rawDataTitle");
    popup.document.body.style.margin = "0";
    popup.document.body.style.background = "#0f141b";
    popup.document.body.style.color = "#dbe8f3";
    popup.document.body.style.font = "12px Consolas, monospace";
    const pre = popup.document.createElement("pre");
    pre.style.margin = "0";
    pre.style.padding = "16px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-word";
    pre.textContent = JSON.stringify(lastRawData, null, 2);
    popup.document.body.appendChild(pre);
  }

  function toggleAutoFamilyRefresh() {
    closeMenu();
    state.autoFamilyRefreshEnabled = !state.autoFamilyRefreshEnabled;
    saveState();
    renderAutoFamilyRefreshButton();
    setStatus(state.autoFamilyRefreshEnabled ? t("autoRefreshOn") : t("autoRefreshOff"), "ok");
    if (state.autoFamilyRefreshEnabled) {
      maybeAutoRefreshFamilyLibrary(getSteamSession());
    }
  }

  function clearStoreCache() {
    closeMenu();
    state.storeCache = {};
    saveState();
    renderStoreCacheButton();
    setStatus(t("storeCacheCleared"), "ok");
  }

  async function fetchExistingSteamApiKey() {
    const html = await requestText("https://steamcommunity.com/dev/apikey");
    setRawData("steamApiKeyPage", {
      signedIn: !isSteamSignInPage(html),
      hasExtractableKey: Boolean(extractSteamApiKeyFromDevPage(html)),
      htmlLength: html.length
    });
    if (isSteamSignInPage(html)) {
      throw new Error(t("communityNotSignedIn"));
    }

    const apiKey = extractSteamApiKeyFromDevPage(html);
    if (apiKey) {
      return apiKey;
    }

    if (/\/dev\/registerkey|Registering\s+for\s+a\s+Steam\s+Web\s+API\s+Key|Domain\s+Name/i.test(html)) {
      throw new Error(t("apiKeyNotRegistered"));
    }

    throw new Error(t("apiKeyNotFound"));
  }

  function extractSteamApiKeyFromDevPage(html) {
    const text = htmlToPlainText(html);
    const labelMatch = text.match(/(?:Key|密钥)\s*[:：]\s*([0-9A-F]{32})\b/i);
    if (labelMatch) {
      return labelMatch[1].toUpperCase();
    }

    const nearbyMatch = text.match(/Steam\s+Web\s+API\s+Key[\s\S]{0,260}?([0-9A-F]{32})\b/i);
    return nearbyMatch ? nearbyMatch[1].toUpperCase() : "";
  }

  function htmlToPlainText(html) {
    return decodeHtml(String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim());
  }

  function isSteamSignInPage(html) {
    return /<title>\s*Sign In\s*<\/title>/i.test(html) || /g_steamID\s*=\s*false/i.test(html);
  }

  function getSteamSession() {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const accountId = Number(pageWindow.g_AccountID || window.g_AccountID || 0);
    const configNode = getApplicationConfigNode(pageWindow);
    let accessToken = "";
    let steamid = "";

    steamid = readSteamGlobalSteamId(pageWindow);
    if (configNode) {
      accessToken = readJsonAttribute(configNode, "data-store_user_config")?.webapi_token || "";
      steamid = readJsonAttribute(configNode, "data-userinfo")?.steamid || steamid;
    }

    return {
      isLoggedIn: accountId !== 0 || Boolean(accessToken && steamid) || Boolean(steamid),
      accessToken,
      steamid: steamid || getSteamCommunityProfileSteamId()
    };
  }

  function readSteamGlobalSteamId(pageWindow) {
    const candidates = [pageWindow?.g_steamID, window.g_steamID, pageWindow?.g_steamID64, window.g_steamID64];
    for (const candidate of candidates) {
      const steamid = normalizeSteamId(candidate);
      if (steamid) {
        return steamid;
      }
    }
    return "";
  }

  function normalizeSteamId(value) {
    if (typeof value === "string" && /^\d{17}$/.test(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      const direct = String(value.steamid || value.steamId || value.accountid || value.accountId || "");
      if (/^\d{17}$/.test(direct)) {
        return direct;
      }
      if (typeof value.GetSteamID64 === "function") {
        try {
          const result = String(value.GetSteamID64());
          if (/^\d{17}$/.test(result)) {
            return result;
          }
        } catch (error) {
          // Ignore.
        }
      }
    }
    return "";
  }

  function isSteamCommunityProfilePage() {
    return location.hostname === "steamcommunity.com" && /^\/profiles\/\d{17}(?:\/|$)/.test(location.pathname);
  }

  function getSteamCommunityProfileSteamId() {
    if (!isSteamCommunityProfilePage()) {
      return "";
    }
    const match = location.pathname.match(/^\/profiles\/(\d{17})(?:\/|$)/);
    return match ? match[1] : "";
  }

  function getApplicationConfigNode(pageWindow, doc = document) {
    const candidates = [
      doc.getElementById("application_config"),
      doc.querySelector("#application_config"),
      doc.querySelector("[data-store_user_config][data-userinfo]"),
      pageWindow?.application_config,
      doc === document ? window.application_config : null
    ];

    return candidates.find(node => node && typeof node.getAttribute === "function") || null;
  }

  async function getFamilyInfo(accessToken) {
    const url = `https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/?access_token=${encodeURIComponent(accessToken)}&include_family_group_response=true`;
    const data = await requestJson(url);
    setRawData("familyGroupForUser", data);
    const response = data.response;
    if (!response?.family_groupid || !response?.family_group?.members) {
      throw new Error(t("noFamilyGroup"));
    }

    const members = response.family_group.members;
    const names = await getUserNames(accessToken, members);
    return {
      family_groupid: response.family_groupid,
      family_name: response.family_group.name || t("unnamed"),
      family_member: members.map(member => ({
        ...member,
        userName: names[member.steamid] || member.steamid
      })),
      steamIdtoName: names
    };
  }

  async function getFamilyGameList(accessToken, familyGroupId) {
    const url = `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?access_token=${encodeURIComponent(accessToken)}&family_groupid=${encodeURIComponent(familyGroupId)}&include_own=true&include_excluded=false&include_non_games=false`;
    const data = await requestJson(url);
    setRawData("sharedLibraryApps", data);
    const apps = data.response?.apps;
    if (!Array.isArray(apps)) {
      throw new Error(t("emptyFamilyLibrary"));
    }

    const appidSet = [];
    const appInfoById = {};
    apps.forEach(app => {
      if (app.exclude_reason !== 0) {
        return;
      }
      const appid = String(app.appid);
      appidSet.push(appid);
      appInfoById[appid] = {
        appid,
        name: app.name || `App ${appid}`,
        owners: Array.isArray(app.owner_steamids) ? app.owner_steamids.map(String) : [],
        time: Number(app.rt_time_acquired || 0),
        icon_hash: app.img_icon_hash || ""
      };
    });

    return {
      appidSet,
      appInfoById,
      updatedAt: Date.now()
    };
  }

  async function getUserNames(accessToken, members) {
    if (!members.length) {
      return {};
    }

    const params = members
      .map((member, index) => `steamids[${index}]=${encodeURIComponent(member.steamid)}`)
      .join("&");
    const url = `https://api.steampowered.com/IPlayerService/GetPlayerLinkDetails/v1/?access_token=${encodeURIComponent(accessToken)}&${params}`;
    const data = await requestJson(url);
    setRawData("playerLinkDetails", data);
    const names = {};
    const accounts = data.response?.accounts || [];
    accounts.forEach(account => {
      const publicData = account.public_data || {};
      if (publicData.steamid) {
        names[String(publicData.steamid)] = publicData.persona_name || String(publicData.steamid);
      }
    });
    return names;
  }

  async function getTargetProfile(rawInput) {
    const parsed = parseTargetInput(rawInput);
    const identity = parsed.steamid64
      ? { steamid64: parsed.steamid64, profileUrl: `https://steamcommunity.com/profiles/${parsed.steamid64}` }
      : await resolveVanity(parsed.vanity, state.apiKey);

    return fetchPublicGames(identity, state.apiKey);
  }

  function parseTargetInput(rawInput) {
    const input = rawInput.trim();
    if (/^\d{17}$/.test(input)) {
      return { steamid64: input };
    }

    try {
      const url = new URL(input);
      const profileMatch = url.pathname.match(/^\/profiles\/(\d{17})(?:\/|$)/);
      if (profileMatch) {
        return { steamid64: profileMatch[1] };
      }
      const vanityMatch = url.pathname.match(/^\/id\/([^/?#]+)(?:\/|$)/);
      if (vanityMatch) {
        return { vanity: decodeURIComponent(vanityMatch[1]) };
      }
    } catch (error) {
      // Plain vanity strings are handled below.
    }

    const vanity = input.replace(/^@/, "");
    if (/^[A-Za-z0-9_-]{2,64}$/.test(vanity)) {
      return { vanity };
    }

    throw new Error(t("invalidAccount"));
  }

  async function resolveVanity(vanity, apiKey) {
    if (!vanity) {
        throw new Error(t("missingVanity"));
    }

    if (!apiKey) {
        throw new Error(t("missingApiKey"));
    }

    return resolveVanityWithApiKey(vanity, apiKey);
  }

  async function resolveVanityWithApiKey(vanity, apiKey) {
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}&format=json`;
    const data = await requestJson(url);
    setRawData("resolveVanityUrl", data);
    const response = data.response || {};
    if (Number(response.success) !== 1 || !/^\d{17}$/.test(String(response.steamid || ""))) {
      const message = response.message ? `：${response.message}` : "";
      throw new Error(t("resolveVanityFailed", { message }));
    }

    return {
      steamid64: String(response.steamid),
      profileUrl: `https://steamcommunity.com/id/${encodeURIComponent(vanity)}`,
      displayName: vanity
    };
  }

  async function fetchPublicGames(identity, apiKey) {
    if (!apiKey) {
      throw new Error(t("missingApiKey"));
    }

    return fetchPublicGamesFromOwnedGames(identity, apiKey);
  }

  async function fetchPublicGamesFromOwnedGames(identity, apiKey) {
    const steamid64 = identity.steamid64;
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid64)}&include_appinfo=1&include_played_free_games=1&format=json`;
    const [data, playerSummary] = await Promise.all([
      requestJson(url),
      fetchTargetPlayerSummary(steamid64, apiKey)
    ]);
    setRawData("ownedGames", data);
    const response = data.response || {};
    const rawGames = Array.isArray(response.games) ? response.games : [];
    if (rawGames.length === 0) {
      throw new Error(t("privateTargetLibrary"));
    }

    return {
      steamid64,
      profileUrl: playerSummary.profileUrl || identity.profileUrl || `https://steamcommunity.com/profiles/${steamid64}`,
      displayName: playerSummary.personaName || identity.displayName || steamid64,
      avatar: playerSummary.avatar || "",
      games: rawGames.map(game => ({
        appid: String(game.appid),
        name: game.name || `App ${game.appid}`,
        logo: game.img_icon_url || "",
        storeLink: `https://store.steampowered.com/app/${game.appid}/`
      })).filter(game => /^\d+$/.test(game.appid)),
      source: "webapi-ownedgames"
    };
  }

  async function fetchTargetPlayerSummary(steamid64, apiKey) {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(steamid64)}&format=json`;
    const data = await requestJson(url);
    setRawData("targetPlayerSummaries", data);
    const player = data.response?.players?.[0];
    return {
      personaName: player?.personaname || "",
      avatar: player?.avatarfull || player?.avatarmedium || player?.avatar || "",
      profileUrl: player?.profileurl || ""
    };
  }

  async function filterShareableNewGames(games) {
    await enrichShareability(games);
    return games.filter(game => game.familySharingSupported);
  }

  function createShareabilityFilterState(analysisId = 0, processed = 0, pending = 0, total = 0) {
    return {
      analysisId,
      processed,
      pending,
      total,
      running: pending > 0
    };
  }

  function createShareabilityProgressUiState(analysisId = 0) {
    return {
      analysisId,
      timer: 0,
      dirty: false,
      lastRenderAt: Date.now()
    };
  }

  function createRateLimitState() {
    return {
      active: false,
      source: "",
      message: "",
      checkedAt: 0,
      checkPassed: false
    };
  }

  function scheduleShareabilityProgressRender(force = false) {
    if (!lastReport || !shareabilityFilterState.running || !shareabilityProgressUiState) {
      return;
    }
    if (shareabilityProgressUiState.analysisId !== shareabilityFilterState.analysisId) {
      return;
    }

    shareabilityProgressUiState.dirty = true;
    if (force) {
      flushShareabilityProgressRender();
      return;
    }

    if (shareabilityProgressUiState.timer) {
      return;
    }

    const elapsed = Date.now() - Number(shareabilityProgressUiState.lastRenderAt || 0);
    const delay = Math.max(0, 1000 - elapsed);
    shareabilityProgressUiState.timer = window.setTimeout(flushShareabilityProgressRender, delay);
  }

  function flushShareabilityProgressRender() {
    if (!shareabilityProgressUiState) {
      return;
    }
    if (shareabilityProgressUiState.analysisId !== shareabilityFilterState.analysisId) {
      return;
    }

    if (shareabilityProgressUiState.timer) {
      window.clearTimeout(shareabilityProgressUiState.timer);
      shareabilityProgressUiState.timer = 0;
    }

    if (!lastReport || !shareabilityProgressUiState.dirty) {
      return;
    }

    shareabilityProgressUiState.dirty = false;
    shareabilityProgressUiState.lastRenderAt = Date.now();
    refreshReportMetrics();
    renderSummary(lastReport);
    renderDetailsPreserveScroll();
    setStatus(t("backgroundProgress", { percent: formatPercent(shareabilityFilterState.total ? shareabilityFilterState.processed / shareabilityFilterState.total : 0) }), "warn");
  }

  async function startBackgroundShareabilityFilter(analysisId, games) {
    if (!lastReport || analysisId !== activeAnalysisId) {
      return;
    }
    if (!games.length) {
      shareabilityFilterState.running = false;
      setRawStep("done");
      setStatus(t("done"), "ok");
      return;
    }

    try {
      for (let index = 0; index < games.length; index += SHAREABILITY_BATCH_SIZE) {
        if (analysisId !== activeAnalysisId || !lastReport) {
          return;
        }

        const batchGames = games.slice(index, index + SHAREABILITY_BATCH_SIZE);
        const shareabilityById = await getShareabilityForAppids(batchGames.map(game => game.appid));
        if (analysisId !== activeAnalysisId || !lastReport) {
          return;
        }

        for (const game of batchGames) {
          applyStoreItemResult(game, shareabilityById[String(game.appid)]);
        }
        await sleep(0);
      }

      shareabilityFilterState.running = false;
      lastReport.filtering.running = false;
      setRawStep("done");
      shareabilityProgressUiState.dirty = true;
      flushShareabilityProgressRender();
      startLazyOriginalPriceLoading();
      setStatus(t("completedAdded", { count: lastReport.metrics.newCount }), "ok");
    } catch (error) {
      shareabilityFilterState.running = false;
      if (lastReport?.filtering) {
        lastReport.filtering.running = false;
      }
      if (shareabilityProgressUiState?.timer) {
        window.clearTimeout(shareabilityProgressUiState.timer);
        shareabilityProgressUiState.timer = 0;
      }
      setRawError(error);
      if (isRateLimitError(error)) {
        if (lastReport?.filtering) {
          lastReport.filtering.paused = true;
        }
        setRateLimited(error, "shareability");
        return;
      }
      setStatus(error.message, "err");
    }
  }

  async function getShareabilityForAppid(appid) {
    const key = String(appid);
    const shareabilityById = await getShareabilityForAppids([key]);
    return shareabilityById[key];
  }

  async function getShareabilityForAppids(appids) {
    const uniqueAppids = Array.from(new Set(appids.map(appid => String(appid))));
    state.storeCache = state.storeCache || {};
    const shareabilityById = {};
    const missing = [];

    uniqueAppids.forEach(appid => {
      if (!/^\d+$/.test(appid)) {
        throw new Error(t("invalidAppid", { appid }));
      }
      const cached = state.storeCache[appid];
      if (hasCompleteStoreCache(appid)) {
        shareabilityById[appid] = cached;
      } else {
        missing.push(appid);
      }
    });

    for (let index = 0; index < missing.length; index += SHAREABILITY_BATCH_SIZE) {
      const batch = missing.slice(index, index + SHAREABILITY_BATCH_SIZE);
      const batchShareability = await fetchShareabilityBatch(batch);
      batch.forEach(appid => {
        const shareability = batchShareability[appid];
        shareabilityById[appid] = shareability;
        state.storeCache[appid] = mergeStoreCacheEntry(state.storeCache[appid], shareability);
      });
    }

    saveState();
    renderStoreCacheButton();
    return shareabilityById;
  }

  function applyStoreItemResult(game, shareability) {
    const appid = String(game.appid);
    shareabilityFilterState.processed += 1;
    lastReport.filtering.processed = shareabilityFilterState.processed;
    if (shareability?.localizedName) {
      game.localizedName = shareability.localizedName;
      updateReportGameLocalizedName(appid, shareability.localizedName);
    }

    const currentStatus = lastReport.classificationById[appid]?.status;
    if (currentStatus === "overlap") {
      refreshReportMetrics();
      scheduleShareabilityProgressRender();
      return;
    }

    const status = getStoreItemContributionStatus(shareability);
    lastReport.classificationById[appid] = { status };

    if (status === "new") {
      const newGame = {
        ...game,
        familySharingSupported: true,
        localizedName: shareability.localizedName || shareability.price?.localizedName || game.localizedName || "",
        price: null
      };
      if (isFreshOriginalPriceCacheEntry(shareability.price)) {
        applyOriginalPriceToGame(newGame, shareability.price);
      } else {
        prepareOriginalPriceForGame(newGame);
      }
      lastReport.games.new.push(newGame);
      lastReport.games.new.sort(sortByName);
    } else {
      lastReport.metrics.filteredUnsupportedCount += 1;
    }

    refreshReportMetrics();
    scheduleShareabilityProgressRender();
    scheduleVisiblePriceLoads();
  }

  function getStoreItemContributionStatus(shareability) {
    if (!shareability?.supported) {
      return "unsupported";
    }
    return isZeroValueOriginalPrice(shareability.price) ? "noValue" : "new";
  }

  function updateReportGameLocalizedName(appid, localizedName) {
    if (!lastReport || !localizedName) {
      return;
    }

    ["all", "new", "overlap"].forEach(listName => {
      (lastReport.games[listName] || []).forEach(game => {
        if (String(game.appid) === String(appid)) {
          game.localizedName = localizedName;
        }
      });
    });
  }

  async function enrichShareability(games) {
    const appids = games.map(game => game.appid);
    const shareabilityById = await getShareabilityForAppids(appids);

    games.forEach(game => {
      const shareability = shareabilityById[String(game.appid)] || state.storeCache[String(game.appid)];
      game.familySharingSupported = Boolean(shareability?.supported);
      if (shareability?.localizedName) {
        game.localizedName = shareability.localizedName;
      }
    });
  }

  async function fetchShareabilityBatch(appids) {
    const url = buildShareabilityBatchUrl(appids);
    const rawKey = `shareability.batch${Date.now()}`;
    const data = await requestStoreJson(url, rawKey);
    setRawData(rawKey, data);
    if (!Array.isArray(data?.response?.store_items)) {
      throw new Error(t("storeBatchMalformed"));
    }
    const items = data.response.store_items;
    const itemById = {};
    items.forEach(item => {
      if (item?.appid) {
        itemById[String(item.appid)] = item;
      }
    });

    const results = {};
    for (const appid of appids) {
      const item = itemById[String(appid)];
      if (Number(item?.success) !== 1 || !Array.isArray(item?.categories?.feature_categoryids)) {
        const fallback = await fetchShareabilityFallback(appid);
        results[String(appid)] = {
          ...fallback,
          context: STORE_CACHE_CONTEXT,
          localizedName: item?.name || fallback.localizedName || ""
        };
        continue;
      }

      const featureCategoryIds = item.categories.feature_categoryids;
      const price = normalizeStoreItemOriginalPrice(item);
      results[String(appid)] = {
        supported: Array.isArray(featureCategoryIds) && featureCategoryIds.some(id => Number(id) === FAMILY_SHARING_CATEGORY_ID),
        context: STORE_CACHE_CONTEXT,
        localizedName: item.name || price?.localizedName || "",
        price,
        updatedAt: Date.now()
      };
    }

    return results;
  }

  async function fetchShareabilityFallback(appid) {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=categories&l=${STORE_LANG}`;
    const data = await requestStoreJson(url, `shareability.fallback.${appid}`);
    setRawData(`shareability.fallback.${appid}`, data);
    const item = data?.[appid];
    const categories = item?.success && item.data && !Array.isArray(item.data)
      ? item.data.categories
      : [];

    return {
      supported: Array.isArray(categories) && categories.some(category => Number(category.id) === FAMILY_SHARING_CATEGORY_ID),
      context: STORE_CACHE_CONTEXT,
      updatedAt: Date.now()
    };
  }

  function buildShareabilityBatchUrl(appids) {
    const input = {
      ids: appids.map(appid => ({ appid: Number(appid) })),
      context: {
        language: STORE_LANG,
        country_code: STORE_CC
      },
      data_request: {
        include_basic_info: false,
        include_all_purchase_options: true,
        include_tag_count: 0
      }
    };
    return `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
  }

  function compareLibraries(targetProfile) {
    const familySet = new Set(state.familyLibrary.appidSet.map(String));
    const targetMap = new Map();
    targetProfile.games.forEach(game => {
      targetMap.set(String(game.appid), game);
    });

    const newGames = [];
    const overlapGames = [];
    targetMap.forEach((game, appid) => {
      if (familySet.has(appid)) {
        const familyInfo = state.familyLibrary.appInfoById[appid] || {};
        overlapGames.push({
          ...game,
          familyName: familyInfo.name || game.name,
          localizedName: getCachedLocalizedName(appid) || game.localizedName || "",
          owners: familyInfo.owners || []
        });
      } else {
        newGames.push({ ...game, price: null });
      }
    });

    return {
      newGames: newGames.sort(sortByName),
      overlapGames: overlapGames.sort(sortByName),
      familyOnlyCount: Math.max(0, familySet.size - overlapGames.length)
    };
  }

  function prepareOriginalPrices(games) {
    state.storeCache = state.storeCache || {};
    priceLoadState = createPriceLoadState();

    games.forEach(game => {
      prepareOriginalPriceForGame(game);
    });

    renderStoreCacheButton();
  }

  function prepareOriginalPriceForGame(game) {
    state.storeCache = state.storeCache || {};
    const appid = String(game.appid);
    const cached = state.storeCache[appid];
    if (isFreshStoreCacheEntry(cached) && isFreshOriginalPriceCacheEntry(cached.price)) {
      applyOriginalPriceToGame(game, cached.price);
    } else {
      game.price = { pending: true };
      priceLoadState.pendingMap.set(appid, game);
    }
    renderStoreCacheButton();
  }

  function createPriceLoadState() {
    return {
      pendingMap: new Map(),
      loadingSet: new Set(),
      queuedSet: new Set(),
      queue: [],
      running: false,
      scheduled: 0
    };
  }

  function applyOriginalPriceToGame(game, price) {
    game.price = price || normalizeOriginalPrice(null);
  }

  async function fetchOriginalPrice(appid) {
    const priceUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=basic,price_overview&cc=${STORE_CC}&l=${STORE_LANG}`;
    const priceData = await requestStoreJson(priceUrl, `prices.${appid}`);
    setRawData(`prices.${appid}`, priceData);
    return normalizeOriginalPrice(priceData?.[appid]);
  }

  async function fetchOriginalPrices(appids) {
    const uniqueAppids = Array.from(new Set(appids.map(String)));
    const priceUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(uniqueAppids.join(","))}&filters=price_overview&cc=${STORE_CC}&l=${STORE_LANG}`;
    const rawKey = `prices.batch${Date.now()}`;
    const priceData = await requestStoreJson(priceUrl, rawKey);
    setRawData(rawKey, priceData);

    const prices = new Map();
    for (const appid of uniqueAppids) {
      const item = priceData?.[appid];
      if (hasPriceOverview(item)) {
        prices.set(appid, normalizeOriginalPrice(item));
        continue;
      }

      try {
        const fallbackPrice = await fetchOriginalPrice(appid);
        prices.set(appid, {
          ...fallbackPrice,
          localizedName: ""
        });
      } catch (error) {
        if (isRateLimitError(error)) {
          throw error;
        }
        setRawError(error);
        prices.set(appid, normalizeOriginalPrice(null));
      }
    }

    return prices;
  }

  function startLazyOriginalPriceLoading() {
    scheduleVisiblePriceLoads();
    if (!shareabilityFilterState.running) {
      scheduleBackgroundPriceLoads();
    }
  }

  function scheduleVisiblePriceLoads() {
    if (rateLimitState.active || !lastReport || priceLoadState.pendingMap.size === 0) {
      return;
    }
    window.clearTimeout(priceLoadState.scheduled);
    priceLoadState.scheduled = window.setTimeout(() => {
      const visibleAppids = getVisiblePriceAppids();
      if (visibleAppids.length > 0) {
        enqueueOriginalPriceLoads(visibleAppids, true);
      }
      if (!shareabilityFilterState.running) {
        scheduleBackgroundPriceLoads();
      }
    }, 80);
  }

  function getVisiblePriceAppids() {
    const rows = Array.from(elements.tableWrap.querySelectorAll("[data-price-appid]"));
    if (!rows.length) {
      return [];
    }

    const wrapRect = elements.tableWrap.getBoundingClientRect();
    const visible = rows
      .filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom >= wrapRect.top && rect.top <= wrapRect.bottom;
      })
      .map(row => row.dataset.priceAppid)
      .filter(appid => priceLoadState.pendingMap.has(String(appid)));

    return visible.length ? visible : rows.slice(0, 20).map(row => row.dataset.priceAppid);
  }

  function scheduleBackgroundPriceLoads() {
    if (rateLimitState.active || !lastReport || priceLoadState.pendingMap.size === 0) {
      return;
    }
    enqueueOriginalPriceLoads(Array.from(priceLoadState.pendingMap.keys()), false);
  }

  function enqueueOriginalPriceLoads(appids, priority) {
    const ordered = [];
    appids.map(String).forEach(appid => {
      if (!priceLoadState.pendingMap.has(appid) || priceLoadState.loadingSet.has(appid)) {
        return;
      }
      ordered.push(appid);
    });

    if (priority) {
      const prioritySet = new Set(ordered);
      priceLoadState.queue = priceLoadState.queue.filter(item => !prioritySet.has(item));
      priceLoadState.queue = [...ordered, ...priceLoadState.queue];
      ordered.forEach(appid => priceLoadState.queuedSet.add(appid));
    } else {
      ordered.forEach(appid => {
        if (priceLoadState.queuedSet.has(appid)) {
          return;
        }
        priceLoadState.queue.push(appid);
        priceLoadState.queuedSet.add(appid);
      });
    }
    runOriginalPriceQueue();
  }

  async function runOriginalPriceQueue() {
    if (rateLimitState.active || priceLoadState.running) {
      return;
    }
    priceLoadState.running = true;
    try {
      while (priceLoadState.queue.length > 0) {
        const appids = takeOriginalPriceQueueBatch();
        if (!appids.length) {
          continue;
        }

        try {
          const prices = await fetchOriginalPrices(appids);
          appids.forEach(appid => {
            const game = priceLoadState.pendingMap.get(appid);
            if (!game) {
              return;
            }
            const price = prices.get(appid) || normalizeOriginalPrice(null);
            cacheOriginalPrice(appid, price);
            applyOriginalPriceToGame(game, price);
            priceLoadState.pendingMap.delete(appid);
          });
          saveState();
          refreshReportMetrics();
          renderSummary(lastReport);
          renderDetailsAfterPriceChange();
          renderStoreCacheButton();
        } catch (error) {
          if (isRateLimitError(error)) {
            restoreOriginalPriceQueueBatch(appids);
            setRawError(error);
            setRateLimited(error, "price");
            break;
          }
          appids.forEach(appid => {
            const game = priceLoadState.pendingMap.get(appid);
            if (!game) {
              return;
            }
            game.price = { unavailable: true, updatedAt: Date.now() };
            priceLoadState.pendingMap.delete(appid);
          });
          setRawError(error);
          refreshReportMetrics();
          renderSummary(lastReport);
          renderDetailsAfterPriceChange();
        } finally {
          appids.forEach(appid => priceLoadState.loadingSet.delete(appid));
        }
      }
    } finally {
      priceLoadState.running = false;
      if (!rateLimitState.active && priceLoadState.pendingMap.size > 0 && !shareabilityFilterState.running) {
        scheduleBackgroundPriceLoads();
      }
    }
  }

  function takeOriginalPriceQueueBatch() {
    const appids = [];
    while (priceLoadState.queue.length > 0 && appids.length < ORIGINAL_PRICE_BATCH_SIZE) {
      const appid = priceLoadState.queue.shift();
      priceLoadState.queuedSet.delete(appid);
      if (!priceLoadState.pendingMap.has(appid) || priceLoadState.loadingSet.has(appid)) {
        continue;
      }
      priceLoadState.loadingSet.add(appid);
      appids.push(appid);
    }
    return appids;
  }

  function restoreOriginalPriceQueueBatch(appids) {
    const restored = [];
    appids.forEach(appid => {
      if (!priceLoadState.pendingMap.has(appid)) {
        return;
      }
      restored.push(appid);
      priceLoadState.queuedSet.add(appid);
    });
    priceLoadState.queue = [...restored, ...priceLoadState.queue.filter(item => !restored.includes(item))];
  }

  function renderDetailsPreserveScroll() {
    const scrollTop = elements.tableWrap.scrollTop;
    renderDetails();
    elements.tableWrap.scrollTop = scrollTop;
  }

  function renderDetailsAfterShareabilityChange(appid) {
    if (currentTab === "all") {
      const cell = elements.tableWrap.querySelector(`[data-status-appid="${String(appid)}"]`);
      if (cell) {
        cell.innerHTML = getGameListStatusHtml(appid);
      }
      return;
    }
    renderDetailsPreserveScroll();
  }

  function renderDetailsAfterPriceChange() {
    if (currentTab === "all" || currentTab === "new" || currentTab === "search") {
      renderDetailsPreserveScroll();
    }
  }

  function refreshReportMetrics() {
    if (!lastReport) {
      return;
    }
    pruneZeroValueAddedGames();
    const newGames = lastReport.games.new || [];
    const pricedGames = newGames.filter(game => game.price && !game.price.pending && !game.price.unavailable);
    const unpricedGames = newGames.filter(game => game.price?.unavailable);
    lastReport.metrics.newCount = newGames.length;
    lastReport.metrics.initialValue = pricedGames.reduce((sum, game) => sum + Number(game.price?.initial || 0), 0);
    lastReport.metrics.unpricedCount = unpricedGames.length;
    lastReport.metrics.filteringProcessed = lastReport.filtering?.processed || 0;
    lastReport.metrics.filteringTotal = lastReport.filtering?.total || 0;
    lastReport.games.unpriced = unpricedGames;
  }

  function pruneZeroValueAddedGames() {
    const newGames = lastReport.games.new || [];
    const keptGames = [];
    newGames.forEach(game => {
      if (isZeroValueOriginalPrice(game.price)) {
        lastReport.classificationById[String(game.appid)] = { status: "noValue" };
        return;
      }
      keptGames.push(game);
    });
    lastReport.games.new = keptGames;
  }

  function hasPriceOverview(item) {
    return Boolean(item?.success && item.data && !Array.isArray(item.data) && item.data.price_overview);
  }

  function isZeroValueOriginalPrice(price) {
    return Boolean(
      price &&
      !price.pending &&
      !price.unavailable &&
      (price.isFree || (price.initial != null && Number(price.initial) <= 0))
    );
  }

  function normalizeOriginalPrice(item) {
    const now = Date.now();
    const data = item?.success && item.data && !Array.isArray(item.data) ? item.data : null;
    const localizedName = data?.name || "";
    if (hasPriceOverview(item)) {
      const priceOverview = item.data.price_overview;
      const initial = Number(priceOverview.initial ?? priceOverview.final ?? 0);
      return {
        initial,
        currency: priceOverview.currency || getStoreCurrency(),
        localizedName,
        isFree: data?.is_free === true || initial <= 0,
        unavailable: false,
        updatedAt: now
      };
    }

    if (data?.is_free === true) {
      return {
        initial: 0,
        currency: getStoreCurrency(),
        localizedName,
        isFree: true,
        unavailable: false,
        updatedAt: now
      };
    }

    return {
      initial: null,
      currency: getStoreCurrency(),
      localizedName,
      isFree: false,
      unavailable: true,
      updatedAt: now
    };
  }

  function normalizeStoreItemOriginalPrice(item) {
    const now = Date.now();
    const localizedName = item?.name || "";
    const purchaseOption = item?.best_purchase_option;
    const initial = purchaseOption?.original_price_in_cents ?? purchaseOption?.final_price_in_cents;
    if (initial != null && initial !== "") {
      const cents = Number(initial);
      return {
        initial: cents,
        currency: getStoreCurrency(),
        localizedName,
        isFree: cents <= 0,
        unavailable: false,
        updatedAt: now
      };
    }

    return null;
  }

  function buildReport(targetProfile, comparison) {
    const newGames = comparison.newGames;
    const allGames = (comparison.allGames || targetProfile.games || []).slice().sort(sortByName);
    const pendingNewGames = comparison.pendingNewGames || [];
    const unpricedGames = newGames.filter(game => game.price?.unavailable);
    const pricedGames = newGames.filter(game => game.price && !game.price.pending && !game.price.unavailable);
    const initialValue = pricedGames.reduce((sum, game) => sum + Number(game.price?.initial || 0), 0);
    const targetCount = allGames.length;
    const rawTargetCount = targetProfile.rawGameCount || targetCount;
    const familyCount = state.familyLibrary.appidSet.length;
    const overlapCount = comparison.overlapGames.length;
    const classificationById = {};

    pendingNewGames.forEach(game => {
      classificationById[String(game.appid)] = { status: "pending" };
    });
    comparison.overlapGames.forEach(game => {
      classificationById[String(game.appid)] = { status: "overlap" };
    });
    newGames.forEach(game => {
      classificationById[String(game.appid)] = { status: "new" };
    });

    return {
      target: {
        steamid64: targetProfile.steamid64,
        displayName: targetProfile.displayName,
        profileUrl: targetProfile.profileUrl,
        avatar: targetProfile.avatar || ""
      },
      metrics: {
        targetCount,
        rawTargetCount,
        filteredUnsupportedCount: targetProfile.filteredUnsupportedCount || 0,
        familyCount,
        newCount: newGames.length,
        overlapCount,
        overlapRate: familyCount > 0 ? overlapCount / familyCount : 0,
        familyOnlyCount: comparison.familyOnlyCount,
        initialValue,
        unpricedCount: unpricedGames.length,
        filteringProcessed: 0,
        filteringTotal: targetCount
      },
      games: {
        all: allGames,
        new: newGames,
        overlap: comparison.overlapGames,
        unpriced: unpricedGames
      },
      classificationById,
      filtering: {
        processed: 0,
        total: targetCount,
        running: targetCount > 0
      },
      generatedAt: Date.now()
    };
  }

  function ensureFamilyReady() {
    const session = getSteamSession();
    if (!session.isLoggedIn) {
      throw new Error(t("signInFirst"));
    }
    if (state.activeSteamId && session.steamid && state.activeSteamId !== session.steamid) {
      throw new Error(t("accountSwitched"));
    }
    if (!state.familyInfo?.family_groupid || state.familyLibrary.appidSet.length === 0) {
      throw new Error(t("refreshFirst"));
    }
    return session;
  }

  function renderFamilyMeta() {
    const count = state.familyLibrary.appidSet.length;
    const name = state.familyInfo?.family_name || t("notRefreshed");
    const time = state.familyLibrary.updatedAt ? formatDateTime(state.familyLibrary.updatedAt) : t("noCache");
    elements.familyMeta.textContent = `${name} · ${count} · ${time}`;
  }

  function renderSummary(report) {
    const metrics = report?.metrics || {
      targetCount: 0,
      rawTargetCount: 0,
      filteredUnsupportedCount: 0,
      familyCount: state.familyLibrary.appidSet.length,
      newCount: 0,
      overlapCount: 0,
      overlapRate: 0,
      initialValue: 0,
      unpricedCount: 0,
      filteringProcessed: 0,
      filteringTotal: 0
    };

    const targetLabel = report?.target?.displayName || t("noSummary");
    const filterValue = metrics.filteringTotal
      ? `${metrics.filteringProcessed || 0}/${metrics.filteringTotal}`
      : "0/0";
    elements.summary.innerHTML = [
      metricHtml(t("targetAccount"), escapeHtml(targetLabel)),
      metricHtml(t("progress"), filterValue),
      metricHtml(t("tabs.family"), `${metrics.familyCount}`),
      metricHtml(t("totalGames"), `${metrics.targetCount}`),
      metricHtml(t("addedGames"), `${metrics.newCount}`),
      metricHtml(t("addedValue"), formatMoney(metrics.initialValue)),
      metricHtml(t("duplicatedGames"), `${metrics.overlapCount}`),
      metricHtml(t("overlapRate"), formatPercent(metrics.overlapRate))
    ].join("");
  }

  function renderTargetProfile(report) {
    if (!report) {
      elements.profile.innerHTML = `<div class="sffa-empty">${escapeHtml(t("noSummary"))}</div>`;
      return;
    }

    const target = report.target || {};
    const avatar = target.avatar
      ? `<img class="sffa-avatar" src="${escapeAttr(target.avatar)}" alt="">`
      : `<div class="sffa-avatar"></div>`;
    elements.profile.innerHTML = `
      <div class="sffa-profile-head">
        ${avatar}
        <div>
          <div class="sffa-profile-name">${escapeHtml(target.displayName || target.steamid64 || t("unknownAccount"))}</div>
          <a class="sffa-profile-link" href="${escapeAttr(target.profileUrl || "#")}" target="_blank" rel="noopener">${escapeHtml(t("openProfile"))}</a>
        </div>
      </div>
      <div class="sffa-profile-row"><span>SteamID</span><span>${escapeHtml(target.steamid64 || "-")}</span></div>
      <div class="sffa-profile-row"><span>${escapeHtml(t("time"))}</span><span>${formatDateTime(report.generatedAt)}</span></div>
      <div class="sffa-profile-row"><span>${escapeHtml(t("link"))}</span><span>${escapeHtml(target.profileUrl || "-")}</span></div>
    `;
  }

  function renderAutoFamilyRefreshButton() {
    if (!elements.autoFamilyRefreshBtn) {
      return;
    }
    const enabled = Boolean(state.autoFamilyRefreshEnabled);
    const lastTime = state.familyLibrary?.updatedAt ? formatDateTime(state.familyLibrary.updatedAt) : t("noCache");
    elements.autoFamilyRefreshBtn.textContent = enabled ? t("autoRefreshClose") : t("autoRefreshOpen");
    elements.autoFamilyRefreshBtn.title = t("autoRefreshTitle", { time: lastTime });
  }

  function metricHtml(label, value) {
    return `<div class="sffa-metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function renderTabs() {
    elements.tabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.tab === currentTab);
    });
    elements.searchInput.classList.toggle("is-visible", currentTab === "search");
    if (currentTab === "search") {
      window.setTimeout(() => elements.searchInput.focus(), 0);
    }
  }

  function buildCurrentListCopyTable(rows) {
    if (currentTab === "family") {
      return {
        headers: ["AppID", t("game"), t("owners"), t("acquiredAt")],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOwners(game.owners || []) || "-",
          formatFamilyAcquireTime(game.time)
        ])
      };
    }
    if (currentTab === "new") {
      return {
        headers: ["AppID", t("game"), t("price")],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOriginalPriceText(game.price || {})
        ])
      };
    }
    if (currentTab === "overlap") {
      return {
        headers: ["AppID", t("game"), t("owners")],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOwners(game.owners || []) || "-"
        ])
      };
    }
    if (currentTab === "search") {
      return {
        headers: ["AppID", t("game"), t("list"), t("info")],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          game.listType || "",
          getSearchInfoText(game)
        ])
      };
    }
    return {
      headers: ["AppID", t("game"), t("status")],
      rows: rows.map(game => [
        game.appid,
        getGameDisplayName(game),
        getGameListLabel(game.appid)
      ])
    };
  }

  function handleTableHeaderClick(event) {
    const header = event.target.closest("[data-sort-key]");
    if (!header || !elements.tableWrap.contains(header)) {
      return;
    }

    const key = header.dataset.sortKey;
    const current = tableSortByTab[currentTab];
    tableSortByTab[currentTab] = {
      key,
      direction: current?.key === key && current.direction === "asc" ? "desc" : "asc"
    };
    renderDetailsPreserveScroll();
  }

  function renderDetails() {
    if (currentTab === "family") {
      const rows = getSortedRows("family", getFamilyLibraryRows());
      if (rows.length === 0) {
        elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(t("noFamilyRefresh"))}</div>`;
        return;
      }
      elements.tableWrap.innerHTML = buildFamilyLibraryTable(rows);
      return;
    }

    if (!lastReport) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(t("initialEmpty"))}</div>`;
      return;
    }

    if (currentTab === "search") {
      renderSearchDetails();
      return;
    }

    const rows = getSortedRows(currentTab, lastReport.games[currentTab] || []);
    if (rows.length === 0) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(t("tabEmpty", { tab: getTabLabel(currentTab) }))}</div>`;
      return;
    }

    elements.tableWrap.innerHTML = buildDetailsTable(currentTab, rows);
    scheduleVisiblePriceLoads();
  }

  function buildDetailsTable(tab, rows) {
    if (tab === "all") {
      return buildAllGamesTable(rows);
    }
    if (tab === "family") {
      return buildFamilyLibraryTable(rows);
    }
    if (tab === "overlap") {
      return buildOverlapTable(rows);
    }
    return buildNewGamesTable(rows);
  }

  function getSortedRows(tab, rows) {
    const sort = tableSortByTab[tab];
    const output = rows.slice();
    if (!sort?.key) {
      return output;
    }

    const direction = sort.direction === "desc" ? -1 : 1;
    output.sort((left, right) => compareSortValues(left, right, sort.key) * direction);
    return output;
  }

  function compareSortValues(left, right, key) {
    const leftValue = getSortValue(left, key);
    const rightValue = getSortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      const diff = leftValue - rightValue;
      return diff === 0 ? sortByName(left, right) : diff;
    }
    const result = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), getNumberLocale(), {
      numeric: true,
      sensitivity: "base"
    });
    return result === 0 ? sortByName(left, right) : result;
  }

  function getSortValue(game, key) {
    switch (key) {
      case "appid":
        return Number(game.appid || 0);
      case "name":
        return getGameDisplayName(game);
      case "status":
        return getGameListLabel(game.appid);
      case "owners":
        return formatOwners(game.owners || []);
      case "time":
        return Number(game.time || 0);
      case "price":
        return getOriginalPriceSortValue(game.price || {});
      case "listType":
        return game.listType || "";
      case "info":
        return getSearchSortInfo(game);
      default:
        return "";
    }
  }

  function getOriginalPriceSortValue(price) {
    if (price?.pending) {
      return Number.POSITIVE_INFINITY;
    }
    if (price?.unavailable) {
      return Number.NEGATIVE_INFINITY;
    }
    if (price?.initial == null) {
      return Number.POSITIVE_INFINITY;
    }
    return Number(price.initial || 0);
  }

  function getSearchSortInfo(game) {
    if (game.listType === t("duplicatedGames")) {
      return formatOwners(game.owners || []);
    }
    if (game.listType === t("addedGames")) {
      return getOriginalPriceSortValue(game.price || {});
    }
    return getGameListLabel(game.appid);
  }

  function renderSearchDetails() {
    const rows = getSearchFilteredRows();
    if (!rows) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(t("searchEmpty"))}</div>`;
      return;
    }

    if (rows.length === 0) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(t("noMatches"))}</div>`;
      return;
    }

    elements.tableWrap.innerHTML = buildSearchTable(getSortedRows("search", rows));
  }

  function getSearchRows() {
    const rowsById = new Map();
    (lastReport.games.all || []).forEach(game => {
      rowsById.set(String(game.appid), {
        ...game,
        listType: getGameListLabel(game.appid)
      });
    });
    (lastReport.games.new || []).forEach(game => {
      rowsById.set(String(game.appid), {
        ...game,
        listType: t("addedGames")
      });
    });
    (lastReport.games.overlap || []).forEach(game => {
      const appid = String(game.appid);
      rowsById.set(appid, {
        ...game,
        listType: t("duplicatedGames")
      });
    });
    return Array.from(rowsById.values()).sort(sortByName);
  }

  function getSearchFilteredRows() {
    const query = elements.searchInput.value.trim().toLowerCase();
    if (!query) {
      return null;
    }

    return getSearchRows().filter(game => {
      const name = String(getGameDisplayName(game)).toLowerCase();
      const appid = String(game.appid || "");
      return name.includes(query) || appid.includes(query);
    });
  }

  function getCurrentListRows() {
    if (currentTab === "family") {
      return getSortedRows("family", getFamilyLibraryRows());
    }
    if (!lastReport) {
      return [];
    }
    if (currentTab === "search") {
      return getSortedRows("search", getSearchFilteredRows() || []);
    }
    return getSortedRows(currentTab, lastReport.games[currentTab] || []);
  }

  function getFamilyLibraryRows() {
    return (state.familyLibrary?.appidSet || [])
      .map(appid => state.familyLibrary?.appInfoById?.[String(appid)])
      .filter(Boolean)
      .map(game => ({
        ...game,
        localizedName: getCachedLocalizedName(game.appid) || game.localizedName || ""
      }))
      .sort(sortFamilyLibraryRows);
  }

  function buildAllGamesTable(rows) {
    const body = rows.map(game => `
      <tr>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td data-status-appid="${escapeAttr(game.appid)}">${getGameListStatusHtml(game.appid)}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh(t("game"), "name")}
        ${sortableTh(t("status"), "status", "width: 110px;")}
      </tr>
    `, body);
  }

  function buildFamilyLibraryTable(rows) {
    const body = rows.map(game => `
      <tr>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${escapeHtml(formatOwners(game.owners || []) || "-")}</td>
        <td>${escapeHtml(formatFamilyAcquireTime(game.time))}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh(t("game"), "name")}
        ${sortableTh(t("owners"), "owners", "width: 160px;")}
        ${sortableTh(t("acquiredAt"), "time", "width: 130px;")}
      </tr>
    `, body);
  }

  function buildNewGamesTable(rows) {
    const body = rows.map(game => `
      <tr data-price-appid="${escapeAttr(game.appid)}">
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${formatOriginalPriceCell(game.price || {})}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh(t("game"), "name")}
        ${sortableTh(t("price"), "price", "width: 110px;")}
      </tr>
    `, body);
  }

  function buildOverlapTable(rows) {
    const body = rows.map(game => `
      <tr>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${escapeHtml(formatOwners(game.owners || []))}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh(t("game"), "name", "width: calc((100% - 82px) / 2);")}
        ${sortableTh(t("owners"), "owners", "width: calc((100% - 82px) / 2);")}
      </tr>
    `, body);
  }

  function buildSearchTable(rows) {
    const body = rows.map(game => `
      <tr ${game.listType === t("addedGames") ? `data-price-appid="${escapeAttr(game.appid)}"` : ""}>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${escapeHtml(game.listType || "")}</td>
        <td>${getSearchInfoHtml(game)}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh(t("game"), "name")}
        ${sortableTh(t("list"), "listType", "width: 120px;")}
        ${sortableTh(t("info"), "info", "width: 170px;")}
      </tr>
    `, body);
  }

  function getSearchInfoHtml(game) {
    if (game.listType === t("duplicatedGames")) {
      return escapeHtml(formatOwners(game.owners || []) || "-");
    }
    if (game.listType !== t("addedGames")) {
      return getGameListStatusHtml(game.appid);
    }
    return formatOriginalPriceCell(game.price || {});
  }

  function getSearchInfoText(game) {
    if (game.listType === t("duplicatedGames")) {
      return formatOwners(game.owners || []) || "-";
    }
    if (game.listType !== t("addedGames")) {
      return getGameListLabel(game.appid);
    }
    return formatOriginalPriceText(game.price || {});
  }

  function getGameListLabel(appid) {
    const status = lastReport?.classificationById?.[String(appid)]?.status;
    return {
      new: t("addedGames"),
      overlap: t("duplicatedGames"),
      unsupported: t("unsupported"),
      noValue: t("noAddedValue"),
      pending: t("pending")
    }[status] || "-";
  }

  function getGameListStatusHtml(appid) {
    const status = lastReport?.classificationById?.[String(appid)]?.status;
    if (status === "pending") {
      return `<span class="sffa-status-inline"><span class="sffa-spinner" title="${escapeAttr(t("pending"))}"></span>${escapeHtml(t("pending"))}</span>`;
    }
    return escapeHtml(getGameListLabel(appid));
  }

  function getGameDisplayName(game) {
    const originalName = game.name || game.familyName || `App ${game.appid}`;
    const localizedName = game.localizedName || getCachedLocalizedName(game.appid) || game.price?.localizedName || "";
    if (!localizedName || normalizeGameName(localizedName) === normalizeGameName(originalName)) {
      return originalName;
    }
    return `${localizedName} (${originalName})`;
  }

  function getCachedLocalizedName(appid) {
    const entry = state.storeCache?.[String(appid)];
    return entry?.localizedName || entry?.price?.localizedName || "";
  }

  function normalizeGameName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[\s™®©:：\-–—_'".,，()[\]（）【】]/g, "");
  }

  function tableHtml(header, body) {
    return `
      <table class="sffa-table">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function sortableTh(label, key, style = "") {
    const sort = tableSortByTab[currentTab];
    const indicator = sort?.key === key ? (sort.direction === "desc" ? "▼" : "▲") : "";
    return `<th data-sort-key="${escapeAttr(key)}"${style ? ` style="${escapeAttr(style)}"` : ""}>${escapeHtml(label)}<span class="sffa-sort-indicator">${indicator}</span></th>`;
  }

  function renderStoreCacheButton() {
    if (!elements.clearStoreCacheBtn) {
      return;
    }
    const count = getStoreCacheCount();
    elements.clearStoreCacheBtn.hidden = count === 0;
    elements.clearStoreCacheBtn.textContent = `${t("clearStoreCache")} (${count})`;
  }

  function setStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `sffa-status ${type || ""}`.trim();
  }

  function setRateLimited(error, source) {
    rateLimitState = {
      active: true,
      source: source || "",
      message: error?.message || t("requestTooFast"),
      checkedAt: 0,
      checkPassed: false
    };
    renderRateLimitControls();
    setStatus(t("requestTooFast"), "err");
  }

  function clearRateLimit() {
    rateLimitState = createRateLimitState();
    renderRateLimitControls();
  }

  function buildLocaleOptionHtml(mode) {
    const isActive = normalizeAppLocaleMode(mode) === appLocaleMode;
    return `
      <button class="sffa-locale-option${isActive ? " is-active" : ""}" type="button" data-sffa-locale-option="${escapeAttr(mode)}">
        ${escapeHtml(getLocaleModeLabel(mode))}
      </button>
    `;
  }

  function renderRateLimitControls() {
    const visible = Boolean(rateLimitState.active);
    if (elements.rateContinueBtn) {
      elements.rateContinueBtn.hidden = !visible;
      elements.rateContinueBtn.disabled = false;
    }
    if (elements.rateCheckBtn) {
      elements.rateCheckBtn.hidden = !visible;
      elements.rateCheckBtn.disabled = false;
    }
  }

  function getPendingShareabilityGames() {
    if (!lastReport) {
      return [];
    }
    return (lastReport.games.all || []).filter(game => !hasCompleteStoreCache(game.appid));
  }

  function hasCompleteStoreCache(appid) {
    const cached = state.storeCache?.[String(appid)];
    return Boolean(
      isFreshStoreCacheEntry(cached) &&
      cached.localizedName &&
      (!cached.supported || isFreshOriginalPriceCacheEntry(cached.price))
    );
  }

  function continueAfterRateLimit() {
    if (!rateLimitState.active) {
      return;
    }

    clearRateLimit();
    const pendingShareabilityGames = getPendingShareabilityGames();
    if (pendingShareabilityGames.length > 0 && lastReport) {
      const analysisId = activeAnalysisId;
      shareabilityFilterState = createShareabilityFilterState(
        analysisId,
        lastReport.filtering?.processed || 0,
        pendingShareabilityGames.length,
        lastReport.filtering?.total || lastReport.metrics.targetCount || 0
      );
      if (lastReport.filtering) {
        lastReport.filtering.running = true;
        lastReport.filtering.paused = false;
      }
      if (shareabilityProgressUiState?.timer) {
        window.clearTimeout(shareabilityProgressUiState.timer);
      }
      shareabilityProgressUiState = createShareabilityProgressUiState(analysisId);
      setStatus(t("continueStats"), "warn");
      startBackgroundShareabilityFilter(analysisId, pendingShareabilityGames);
      return;
    }

    if (priceLoadState.pendingMap.size > 0) {
      setStatus(t("continuePrices"), "warn");
      scheduleVisiblePriceLoads();
      if (!shareabilityFilterState.running) {
        scheduleBackgroundPriceLoads();
      }
      return;
    }

    setStatus(t("nothingToContinue"), "ok");
  }

  async function checkRateLimit() {
    if (!rateLimitState.active) {
      return;
    }

    elements.rateCheckBtn.disabled = true;
    setStatus(t("checking"), "warn");
    try {
      const url = buildShareabilityBatchUrl(["10"]);
      await sleep(STORE_REQUEST_DELAY_MS);
      await requestJson(url);
      rateLimitState.checkedAt = Date.now();
      rateLimitState.checkPassed = true;
      renderRateLimitControls();
      setStatus(t("rateLimitCleared"), "ok");
    } catch (error) {
      rateLimitState.checkedAt = Date.now();
      rateLimitState.checkPassed = false;
      renderRateLimitControls();
      if (isHttp429(error)) {
        setStatus(t("rateLimitedStill"), "err");
        return;
      }
      setRawError(error);
      setStatus(error.message || t("checkFailed"), "err");
    } finally {
      if (elements.rateCheckBtn) {
        elements.rateCheckBtn.disabled = false;
      }
    }
  }

  async function autoReadApiKeyFromCommunity(options = {}) {
    const keepBusy = Boolean(options.keepBusy);
    try {
      if (!keepBusy) {
        setBusy(true);
      }
      const apiKey = await fetchExistingSteamApiKey();
      state.apiKey = apiKey;
      saveState();
      return apiKey;
    } catch (error) {
      state.apiKey = "";
      saveState();
      throw error;
    } finally {
      if (!keepBusy) {
        setBusy(false);
      }
    }
  }

  function createRawDataSnapshot(action) {
    return {
      meta: {
        action,
        createdAt: new Date().toISOString(),
        currentStep: "started",
        error: null
      },
      familyGroupForUser: null,
      sharedLibraryApps: null,
      playerLinkDetails: null,
      steamApiKeyPage: null,
      resolveVanityUrl: null,
      targetPlayerSummaries: null,
      ownedGames: null,
      shareability: {},
      prices: {},
      requestFailures: {}
    };
  }

  function resetRawData(action) {
    lastRawData = createRawDataSnapshot(action);
  }

  function setRawData(path, value) {
    const parts = String(path || "").split(".").filter(Boolean);
    if (!parts.length) {
      return;
    }

    let cursor = lastRawData;
    parts.slice(0, -1).forEach(part => {
      if (!cursor[part] || typeof cursor[part] !== "object") {
        cursor[part] = {};
      }
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  }

  function setRawStep(step) {
    lastRawData.meta.currentStep = step;
    lastRawData.meta.updatedAt = new Date().toISOString();
  }

  function setRawError(error) {
    lastRawData.meta.error = {
      message: error?.message || String(error || "未知错误")
    };
    lastRawData.meta.updatedAt = new Date().toISOString();
  }

  function setBusy(isBusy) {
    if (isBusy) {
      closeMenu();
    }
    [elements.refreshBtn, elements.analyzeBtn, elements.moreBtn, elements.localeToggleBtn, elements.autoFamilyRefreshBtn, elements.copyBtn, elements.copyCurrentBtn, elements.clearStoreCacheBtn, elements.rawBtn].forEach(button => {
      if (!button) {
        return;
      }
      button.disabled = Boolean(isBusy);
    });
  }

  function loadState() {
    try {
      const saved = GM_getValue(STORAGE_KEY);
      if (!saved || saved.version !== DEFAULT_STATE.version) {
        return cloneDefaultState();
      }
      return {
        ...cloneDefaultState(),
        ...saved,
        familyLibrary: {
          ...cloneDefaultState().familyLibrary,
          ...(saved.familyLibrary || {})
        },
        storeCache: normalizeSavedStoreCache(saved.storeCache || {}),
        launcherVisible: saved.launcherVisible !== false,
        autoFamilyRefreshEnabled: saved.autoFamilyRefreshEnabled !== false,
        appLocaleMode,
        lastAutoFamilyRefreshAttemptAt: Number(saved.lastAutoFamilyRefreshAttemptAt || 0)
      };
    } catch (error) {
      return cloneDefaultState();
    }
  }

  function saveState() {
    GM_setValue(STORAGE_KEY, state);
  }

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function isFreshStoreCacheEntry(entry) {
    return Boolean(
      entry &&
      typeof entry.supported === "boolean" &&
      entry.context === STORE_CACHE_CONTEXT &&
      Date.now() - Number(entry.updatedAt || 0) < STORE_CACHE_TTL_MS
    );
  }

  function getStoreCacheCount() {
    return Object.keys(state.storeCache || {}).length;
  }

  function isFreshOriginalPriceCacheEntry(entry) {
    return Boolean(
      entry &&
      (typeof entry.initial === "number" || entry.unavailable === true) &&
      Object.prototype.hasOwnProperty.call(entry, "localizedName") &&
      Date.now() - Number(entry.updatedAt || 0) < STORE_CACHE_TTL_MS
    );
  }

  function cacheOriginalPrice(appid, price) {
    state.storeCache = state.storeCache || {};
    if (!isFreshOriginalPriceCacheEntry(price)) {
      return;
    }
    state.storeCache[String(appid)] = mergeStoreCacheEntry(state.storeCache[String(appid)], {
      context: STORE_CACHE_CONTEXT,
      localizedName: price.localizedName || "",
      price,
      updatedAt: Date.now()
    });
  }

  function mergeStoreCacheEntry(existing, next) {
    const updatedAt = Math.max(Number(existing?.updatedAt || 0), Number(next?.updatedAt || 0));
    return {
      ...(existing || {}),
      ...(next || {}),
      localizedName: next?.localizedName || existing?.localizedName || next?.price?.localizedName || existing?.price?.localizedName || "",
      price: next?.price || existing?.price || null,
      updatedAt: updatedAt || Date.now()
    };
  }

  function normalizeSavedStoreCache(storeCache) {
    const normalized = {};
    Object.entries(storeCache || {}).forEach(([appid, entry]) => {
      if (isFreshStoreCacheEntry(entry)) {
        normalized[String(appid)] = {
          ...(typeof entry.supported === "boolean" ? { supported: entry.supported } : {}),
          context: entry.context,
          localizedName: entry.localizedName || entry.price?.localizedName || "",
          price: isFreshOriginalPriceCacheEntry(entry.price) ? entry.price : null,
          updatedAt: Number(entry.updatedAt || Date.now())
        };
      }
    });
    return normalized;
  }

  function requestJson(url) {
    return request(url, "json");
  }

  function requestStoreJson(url, rawDataPath) {
    const run = () => requestStoreJsonWithRetry(url, rawDataPath);
    storeRequestQueue = storeRequestQueue.then(run, run);
    return storeRequestQueue;
  }

  async function requestStoreJsonWithRetry(url, rawDataPath) {
    if (rateLimitState.active) {
      throw createRateLimitError();
    }

    await sleep(STORE_REQUEST_DELAY_MS);
    try {
      return await requestJson(url);
    } catch (error) {
      if (isHttp429(error)) {
        setRawData(`${rawDataPath}.rateLimited`, {
          reason: "HTTP 429",
          pausedAt: new Date().toISOString()
        });
        throw createRateLimitError();
      }
      throw error;
    }
  }

  function requestText(url) {
    return request(url, "text");
  }

  function request(url, responseType) {
    return new Promise((resolve, reject) => {
      const endpoint = describeRequestEndpoint(url);
      GM_xmlhttpRequest({
        method: "GET",
        url,
        anonymous: false,
        withCredentials: true,
        headers: {
          "Accept": responseType === "json" ? "application/json,text/javascript,*/*;q=0.1" : "application/xml,text/xml,text/html,*/*;q=0.1"
        },
        responseType: responseType === "json" ? "json" : "text",
        timeout: 30000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            setRawData(`requestFailures.${endpoint}`, {
              status: response.status,
              responseText: String(response.responseText || "").slice(0, 1000)
            });
            reject(createHttpError(response.status, `HTTP ${response.status}`));
            return;
          }
          if (responseType === "json") {
            if (response.response && typeof response.response === "object") {
              resolve(response.response);
              return;
            }
            try {
              resolve(JSON.parse(response.responseText));
            } catch (error) {
              setRawData(`requestFailures.${endpoint}`, {
                status: response.status,
                message: t("jsonParseFailed"),
                responseText: String(response.responseText || "").slice(0, 1000)
              });
              reject(new Error(t("jsonParseFailed")));
            }
          } else {
            resolve(response.responseText || String(response.response || ""));
          }
        },
        onerror() {
          setRawData(`requestFailures.${endpoint}`, {
            message: t("networkFailed")
          });
          reject(new Error(t("networkFailed")));
        },
        ontimeout() {
          setRawData(`requestFailures.${endpoint}`, {
            message: t("requestTimeout")
          });
          reject(new Error(t("requestTimeout")));
        }
      });
    });
  }

  function describeRequestEndpoint(url) {
    try {
      const parsed = new URL(url);
      const interfaceName = parsed.pathname.split("/").filter(Boolean)[0] || parsed.hostname;
      const methodName = parsed.pathname.split("/").filter(Boolean)[1] || "request";
      return `${parsed.hostname}.${interfaceName}.${methodName}`.replace(/[^\w.-]/g, "_");
    } catch (error) {
      return "unknown";
    }
  }

  function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function createRateLimitError() {
    const error = new Error(t("requestTooFast"));
    error.name = "SteamRateLimitError";
    error.isSteamRateLimit = true;
    return error;
  }

  function isRateLimitError(error) {
    return Boolean(error?.isSteamRateLimit) || isHttp429(error);
  }

  function isHttp429(error) {
    return Number(error?.status) === 429 || /HTTP\s*429/i.test(String(error?.message || ""));
  }

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }


  function decodeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(value || "");
    return textarea.value;
  }

  function readJsonAttribute(node, attrName) {
    try {
      const value = node.getAttribute(attrName);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function sortByName(left, right) {
    return String(left.name || "").localeCompare(String(right.name || ""), getNumberLocale());
  }

  function formatOwners(owners) {
    if (!owners.length) {
      return "";
    }
    return owners
      .map(steamid => state.familyInfo?.steamIdtoName?.[steamid] || steamid)
      .join(UI_LOCALE === "en" ? ", " : "、");
  }

  function formatOriginalPriceCell(price) {
    if (price?.pending) {
      return `<span class="sffa-spinner" title="${escapeAttr(t("loading"))}"></span>`;
    }
    if (!price || (price.initial == null && !price.unavailable && !price.isFree)) {
      return "-";
    }
    if (price.unavailable) {
      return "N/A";
    }
    return formatMoney(Number(price.initial || 0), price.currency);
  }

  function formatOriginalPriceText(price) {
    if (price?.pending) {
      return t("loading");
    }
    if (!price || (price.initial == null && !price.unavailable && !price.isFree)) {
      return "-";
    }
    if (price.unavailable) {
      return "N/A";
    }
    return formatMoney(Number(price.initial || 0), price.currency);
  }

  function normalizeCopyCell(value) {
    return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
  }

  function formatMoney(cents, currency = getStoreCurrency()) {
    return new Intl.NumberFormat(localeForStoreCountry(), {
      style: "currency",
      currency
    }).format(Number(cents || 0) / 100);
  }

  function getNumberLocale() {
    return UI_LOCALE === "en" ? localeForStoreCountry() : "zh-CN";
  }

  function localeForStoreCountry() {
    return {
      US: "en-US",
      GB: "en-GB",
      AU: "en-AU",
      CA: "en-CA",
      MX: "es-MX",
      JP: "ja-JP",
      KR: "ko-KR",
      CN: "zh-CN",
      TW: "zh-TW",
      HK: "zh-HK",
      SG: "en-SG",
      NZ: "en-NZ",
      DE: "de-DE",
      FR: "fr-FR",
      IT: "it-IT",
      ES: "es-ES",
      NL: "nl-NL",
      BE: "nl-BE",
      AT: "de-AT",
      FI: "fi-FI",
      IE: "en-IE",
      PT: "pt-PT",
      GR: "el-GR",
      BR: "pt-BR",
      RU: "ru-RU",
      TR: "tr-TR",
      IN: "en-IN",
      ZA: "en-ZA",
      PL: "pl-PL",
      NO: "nb-NO",
      SE: "sv-SE",
      DK: "da-DK",
      CH: "de-CH",
      CL: "es-CL",
      CO: "es-CO",
      PE: "es-PE",
      PH: "en-PH",
      ID: "id-ID",
      MY: "ms-MY",
      TH: "th-TH",
      VN: "vi-VN",
      UA: "uk-UA",
      AR: "es-AR",
      SA: "ar-SA",
      AE: "ar-AE",
      IL: "he-IL",
      KZ: "kk-KZ",
      UY: "es-UY",
      CR: "es-CR",
      KW: "ar-KW",
      QA: "ar-QA",
      EU: "en-IE"
    }[STORE_CC] || "en-US";
  }

  function getStoreCurrency() {
    return {
      US: "USD",
      CA: "CAD",
      MX: "MXN",
      BR: "BRL",
      GB: "GBP",
      EU: "EUR",
      DE: "EUR",
      FR: "EUR",
      IT: "EUR",
      ES: "EUR",
      NL: "EUR",
      BE: "EUR",
      AT: "EUR",
      FI: "EUR",
      IE: "EUR",
      PT: "EUR",
      GR: "EUR",
      JP: "JPY",
      KR: "KRW",
      CN: "CNY",
      TW: "TWD",
      HK: "HKD",
      SG: "SGD",
      AU: "AUD",
      NZ: "NZD",
      RU: "RUB",
      TR: "TRY",
      IN: "INR",
      ZA: "ZAR",
      PL: "PLN",
      NO: "NOK",
      SE: "SEK",
      DK: "DKK",
      CH: "CHF",
      CL: "CLP",
      CO: "COP",
      PE: "PEN",
      PH: "PHP",
      ID: "IDR",
      MY: "MYR",
      TH: "THB",
      VN: "VND",
      UA: "UAH",
      AR: "ARS",
      SA: "SAR",
      AE: "AED",
      IL: "ILS",
      KZ: "KZT",
      UY: "UYU",
      CR: "CRC",
      KW: "KWD",
      QA: "QAR"
    }[STORE_CC] || "USD";
  }

  function formatPercent(value) {
    return `${Math.round(Number(value || 0) * 1000) / 10}%`;
  }

  function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString(getNumberLocale(), {
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatFamilyAcquireTime(timestamp) {
    const seconds = Number(timestamp || 0);
    if (!seconds) {
      return "-";
    }
    return new Date(seconds * 1000).toLocaleString(getNumberLocale(), {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function sortFamilyLibraryRows(left, right) {
    const timeDiff = Number(right.time || 0) - Number(left.time || 0);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return sortByName(left, right);
  }

  function getTabLabel(tab) {
    return {
      all: t("tabs.all"),
      family: t("tabs.family"),
      new: t("tabs.new"),
      overlap: t("tabs.overlap"),
      search: t("tabs.search")
    }[tab] || t("list");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
