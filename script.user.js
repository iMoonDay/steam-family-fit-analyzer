// ==UserScript==
// @name         Steam Family Library Analyzer
// @name:zh-CN   Steam 家庭库分析器
// @namespace    https://tampermonkey.net/
// @version      0.1.7
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
  // 搜索输入停止后再刷新表格，避免大列表逐字重绘卡顿。
  const SEARCH_RENDER_DEBOUNCE_MS = 220;
  // 自动后台刷新家庭库的间隔，默认 24 小时。
  const AUTO_FAMILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  // 最近一次分析结果缓存键名。
  const ANALYSIS_HISTORY_KEY = `${STORAGE_KEY}_analysis_v1`;
  // Steam 商店分类中“家庭共享”特性的 category id。
  const FAMILY_SHARING_CATEGORY_ID = 62;
  // 普通用户 SteamID64 = 该基数 + Steam 好友码 / accountid。
  const STEAMID64_INDIVIDUAL_BASE = 76561197960265728n;
  const MAX_STEAM_ACCOUNT_ID = 4294967295n;
  const MAX_STEAM_ACCOUNT_ID_LENGTH = String(MAX_STEAM_ACCOUNT_ID).length;
  const COMPARE_PRICE_RANGES = Object.freeze([
    { key: "0-48", label: "¥0-¥48", min: 0, max: 4800 },
    { key: "48-98", label: "¥48-¥98", min: 4800, max: 9800 },
    { key: "98-198", label: "¥98-¥198", min: 9800, max: 19800 },
    { key: "198+", label: "¥198+", min: 19800, max: Infinity }
  ]);
  const COMPARE_QUALITY_LEVELS = Object.freeze([
    { key: "veryLow", max: 4800 },
    { key: "low", max: 9800 },
    { key: "medium", max: 19800 },
    { key: "high", max: 29800 },
    { key: "veryHigh", max: Infinity }
  ]);
  const REPORT_LIST_TABS = Object.freeze(["all", "new", "relativeNew", "overlap"]);

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
      clear: "清空",
      languageTitle: "语言",
      languageAuto: "自动",
      languageChinese: "中文",
      languageEnglish: "English",
      targetPlaceholder: "SteamID64、好友码、主页链接或自定义 ID，多个用空格分隔",
      refreshFamily: "刷新家庭库",
      analyzeAccount: "分析账号",
      continue: "继续",
      rateCheck: "限流检测",
      tabs: {
        all: "全部",
        family: "家庭库",
        new: "新增",
        relativeNew: "相对新增",
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
      compare: "对比",
      compareTitle: "账号游戏对比",
      compareHint: "按当前输入的 {count} 个账号对比，聚焦游戏差异。",
      compareLoadingHint: "统计进行中，完成后会显示完整对比。",
      compareExcluded: "已排除",
      compareSectionExclusive: "仅 1 个账号拥有",
      compareSectionPartial: "部分账号共有",
      compareSectionAll: "全部账号共有",
      compareNoData: "暂无可对比游戏",
      compareNoUniqueAdded: "暂无独有新增游戏",
      compareNoRangeGames: "该价格区间暂无游戏",
      compareGames: "游戏",
      compareOwners: "拥有者",
      compareStatus: "状态",
      comparePrice: "原价",
      compareUnique: "独占",
      compareShared: "共有",
      compareAdded: "新增",
      compareUniqueAdded: "独有新增",
      compareQuality: "游戏质量",
      compareQualitySummary: "游戏质量：{quality}",
      compareQualityNone: "游戏质量：无新增游戏",
      compareAverageValue: "平均价值",
      compareQualityVeryLow: "超低",
      compareQualityLow: "低",
      compareQualityMedium: "中",
      compareQualityHigh: "高",
      compareQualityVeryHigh: "超高",
      compareUniqueTip: "独占/总游戏：该账号单独拥有的游戏数 / 该账号总游戏数。",
      compareUniqueAddedTip: "独有新增/新增：该账号单独拥有且对家庭库有新增价值的游戏数 / 该账号带来的新增游戏数。",
      comparePriceDistribution: "价格分布：¥0-¥48 {low} 款，¥48-¥98 {mid} 款，¥98-¥198 {high} 款，¥198+ {top} 款",
      compareStructure: "结构：独占 {unique} 款，共享 {shared} 款",
      compareTotal: "总游戏",
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
      invalidFriendCode: "Steam 好友码无效",
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
      targetAccountCount: "{count} 个账号",
      targetOwners: "拥有者",
      deduped: "去重",
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
      clear: "Clear",
      languageTitle: "Language",
      languageAuto: "Auto",
      languageChinese: "中文",
      languageEnglish: "English",
      targetPlaceholder: "SteamID64, friend code, profile URL, or custom ID. Separate multiple with spaces",
      refreshFamily: "Refresh family library",
      analyzeAccount: "Analyze account",
      continue: "Continue",
      rateCheck: "Check rate limit",
      tabs: {
        all: "All",
        family: "Family library",
        new: "Added",
        relativeNew: "Relative added",
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
      compare: "Compare",
      compareTitle: "Account game comparison",
      compareHint: "Compare the {count} entered accounts with a focus on game differences.",
      compareLoadingHint: "Statistics are still running. The full comparison will appear when they finish.",
      compareExcluded: "Excluded",
      compareSectionExclusive: "Owned by 1 account",
      compareSectionPartial: "Shared by some accounts",
      compareSectionAll: "Owned by all accounts",
      compareNoData: "No games to compare",
      compareNoUniqueAdded: "No exclusive added games",
      compareNoRangeGames: "No games in this price range",
      compareGames: "Games",
      compareOwners: "Owners",
      compareStatus: "Status",
      comparePrice: "Price",
      compareUnique: "Exclusive",
      compareShared: "Shared",
      compareAdded: "Added",
      compareUniqueAdded: "Exclusive added",
      compareQuality: "Game quality",
      compareQualitySummary: "Game quality: {quality}",
      compareQualityNone: "Game quality: no added games",
      compareAverageValue: "Average value",
      compareQualityVeryLow: "Very low",
      compareQualityLow: "Low",
      compareQualityMedium: "Medium",
      compareQualityHigh: "High",
      compareQualityVeryHigh: "Very high",
      compareUniqueTip: "Exclusive/total: games owned only by this account / total games on this account.",
      compareUniqueAddedTip: "Exclusive added/added: games owned only by this account that add value to the family library / all added games from this account.",
      comparePriceDistribution: "Price distribution: ¥0-¥48 {low} games, ¥48-¥98 {mid} games, ¥98-¥198 {high} games, ¥198+ {top} games",
      compareStructure: "Structure: {unique} exclusive games, {shared} shared games",
      compareTotal: "Total",
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
      invalidFriendCode: "Invalid Steam friend code",
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
      targetAccountCount: "{count} accounts",
      targetOwners: "Owners",
      deduped: "deduped",
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
  let comparePriceRangeByTarget = {};
  let analysisHistorySaveTimer = 0;
  let searchRenderTimer = 0;
  let scriptMenuCommandIds = [];
  let autoFamilyRefreshRunning = false;
  let elements = {};

  bootstrap();

  async function bootstrap() {
    await resolveStoreCountryFromAccount();
    state = loadState();
    injectStyles();
    mountPanel();
    const restoredAnalysis = restoreAnalysisHistory();
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
    } else if (!restoredAnalysis && state.familyLibrary.appidSet.length > 0) {
      setStatus(t("loadedCount", { count: state.familyLibrary.appidSet.length }), "ok");
    } else if (!restoredAnalysis) {
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
        display: grid;
        place-items: center;
        border-radius: 3px;
        background: #223344;
        color: #dbe8f3;
        font-size: 15px;
        font-weight: 700;
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
      .sffa-target-row {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
        padding: 6px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 12px;
      }
      .sffa-target-row input {
        margin: 2px 0 0;
      }
      .sffa-target-row span {
        color: #d8e4ee;
        overflow-wrap: anywhere;
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
      .sffa-compare-btn {
        width: 48px;
        height: 48px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        padding: 0;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 3px;
        background: linear-gradient(180deg, #2a475e 0%, #1f3242 100%);
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: 0;
        text-align: center;
        transition: filter 0.12s ease, background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .sffa-compare-btn:hover:not(:disabled) {
        background: linear-gradient(180deg, #315169 0%, #264050 100%);
        border-color: rgba(143, 209, 255, 0.6);
        filter: brightness(1.05);
      }
      .sffa-compare-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .sffa-compare-overlay {
        position: fixed;
        inset: 0;
        z-index: 999998;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.16s ease, visibility 0.16s ease;
      }
      .sffa-compare-overlay-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(8, 12, 18, 0.76);
        backdrop-filter: blur(2px);
      }
      .sffa-compare-shell {
        position: absolute;
        left: 50%;
        top: 50%;
        width: min(1120px, calc(100vw - 28px));
        height: min(840px, calc(100vh - 28px));
        transform: translate(-50%, -50%) scale(0.985);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 4px;
        background: #121820;
        box-shadow: 0 28px 72px rgba(0, 0, 0, 0.58);
      }
      #sffa-root.is-compare-open .sffa-compare-overlay {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .sffa-compare-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        background: linear-gradient(180deg, #23384a 0%, #17222e 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .sffa-compare-title {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .sffa-compare-title strong {
        color: #ffffff;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.2;
      }
      .sffa-compare-title span {
        color: #b8c7d3;
        font-size: 12px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .sffa-compare-close {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 18px;
        line-height: 1;
      }
      .sffa-compare-close:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .sffa-compare-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(252px, 1fr));
        gap: 8px;
        padding: 10px 12px 12px;
        min-height: 0;
        flex: 1 1 auto;
        overflow: auto;
      }
      .sffa-compare-card {
        position: relative;
        min-width: 0;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 3px;
        background: #11161d;
      }
      .sffa-compare-card.is-muted {
        opacity: 0.72;
      }
      .sffa-compare-card-head {
        display: flex;
        gap: 10px;
        align-items: center;
        min-width: 0;
        margin-bottom: 10px;
        padding-right: 0;
      }
      .sffa-compare-card-head.has-status {
        padding-right: 84px;
      }
      .sffa-compare-card-title {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sffa-compare-card-title strong {
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .sffa-compare-card-title span {
        color: #9fb3c2;
        font-size: 12px;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      .sffa-compare-card-summary {
        color: #dbe8f3;
        font-size: 12px;
        line-height: 1.35;
        display: block;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .sffa-compare-card-status {
        position: absolute;
        top: 10px;
        right: 10px;
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        background: rgba(225, 92, 92, 0.18);
        color: #ffd0d0;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
      }
      .sffa-compare-card-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
      }
      .sffa-compare-stat {
        min-width: 0;
        min-height: 42px;
        padding: 7px 8px;
        border-radius: 3px;
        background: #1a2230;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .sffa-compare-stat.is-wide {
        grid-column: 1 / -1;
      }
      .sffa-compare-stat span {
        display: block;
        margin-bottom: 3px;
        color: #9fb3c2;
        font-size: 11px;
        line-height: 1.2;
      }
      .sffa-compare-stat strong {
        display: block;
        color: #ffffff;
        font-size: 14px;
        line-height: 1.1;
        overflow-wrap: anywhere;
      }
      .sffa-compare-stat.is-highlight {
        background: linear-gradient(180deg, rgba(102, 192, 244, 0.22) 0%, rgba(31, 43, 54, 0.92) 100%);
        border-color: rgba(143, 209, 255, 0.34);
      }
      .sffa-compare-price-ranges {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }
      .sffa-compare-price-range {
        min-width: 0;
        min-height: 46px;
        padding: 7px 8px;
        border-radius: 3px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: #1a2230;
        color: inherit;
        cursor: pointer;
        font: inherit;
        text-align: left;
        transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .sffa-compare-price-range:hover {
        transform: translateY(-1px);
        background: #223044;
        border-color: rgba(143, 209, 255, 0.34);
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
      }
      .sffa-compare-price-range.is-active {
        background: linear-gradient(180deg, rgba(111, 201, 132, 0.24) 0%, rgba(31, 43, 54, 0.94) 100%);
        border-color: rgba(111, 201, 132, 0.58);
        box-shadow: inset 0 0 0 1px rgba(111, 201, 132, 0.18);
      }
      .sffa-compare-price-range.is-active:hover {
        border-color: rgba(163, 238, 181, 0.72);
        box-shadow: inset 0 0 0 1px rgba(111, 201, 132, 0.24), 0 8px 18px rgba(0, 0, 0, 0.22);
      }
      .sffa-compare-price-range span {
        display: block;
        margin-bottom: 3px;
        color: #9fb3c2;
        font-size: 11px;
        line-height: 1.2;
        white-space: nowrap;
      }
      .sffa-compare-price-range strong {
        display: block;
        color: #ffffff;
        font-size: 14px;
        line-height: 1.1;
      }
      .sffa-compare-card-games {
        display: grid;
        gap: 6px;
        margin-top: 10px;
        min-height: 0;
      }
      .sffa-compare-card-games-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .sffa-compare-card-games-head strong {
        color: #ffffff;
        font-size: 12px;
        line-height: 1.2;
      }
      .sffa-compare-card-games-head span {
        color: #9fb3c2;
        font-size: 11px;
      }
      .sffa-compare-card-games-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(172px, 1fr));
        gap: 8px;
      }
      .sffa-compare-card-game {
        position: relative;
        min-width: 0;
        min-height: 148px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 4px;
        background-color: #121820;
        background-image: linear-gradient(180deg, rgba(9, 13, 19, 0.12) 0%, rgba(9, 13, 19, 0.68) 100%), var(--sffa-cover, none);
        background-position: center;
        background-repeat: no-repeat;
        background-size: cover;
        box-shadow: inset 0 -44px 72px rgba(0, 0, 0, 0.42);
        overflow: hidden;
      }
      .sffa-compare-card-game-link {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 10px;
        color: inherit;
        text-decoration: none;
      }
      .sffa-compare-card-game-link:hover {
        text-decoration: none;
      }
      .sffa-compare-card-game-title {
        min-width: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        align-self: flex-start;
        max-width: calc(100% - 4px);
        color: #ffffff;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.25;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.72);
        overflow-wrap: anywhere;
      }
      .sffa-compare-card-game-price {
        display: flex;
        position: absolute;
        left: 10px;
        bottom: 10px;
        align-items: center;
        justify-content: center;
        min-height: 23px;
        padding: 0 9px;
        border-radius: 999px;
        background: rgba(8, 12, 18, 0.72);
        color: #ffffff;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.65);
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 18px rgba(0, 0, 0, 0.28);
      }
      .sffa-compare-card-game-price.is-new {
        background: rgba(111, 201, 132, 0.22);
        color: #d5ffe0;
      }
      .sffa-compare-card-game-price.is-overlap {
        background: rgba(102, 192, 244, 0.2);
        color: #d7f0ff;
      }
      .sffa-compare-card-game-price.is-no-value {
        background: rgba(8, 12, 18, 0.68);
        color: #dbe8f3;
      }
      .sffa-compare-card-game-price.is-unsupported {
        background: rgba(225, 170, 92, 0.18);
        color: #ffe4b4;
      }
      .sffa-compare-card-game-price.is-pending {
        background: rgba(150, 156, 167, 0.2);
        color: #f1f4f7;
      }
      .sffa-compare-card-empty {
        padding: 8px 0 2px;
        color: #9fb3c2;
        font-size: 12px;
      }
      .sffa-compare-body {
        display: none;
      }
      .sffa-compare-group {
        margin-top: 10px;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 3px;
        background: #11161d;
      }
      .sffa-compare-group:first-child {
        margin-top: 0;
      }
      .sffa-compare-group-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .sffa-compare-group-head strong {
        color: #ffffff;
        font-size: 13px;
        line-height: 1.2;
      }
      .sffa-compare-group-head span {
        color: #9fb3c2;
        font-size: 12px;
      }
      .sffa-compare-list {
        display: grid;
        gap: 6px;
      }
      .sffa-compare-item {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(0, 0.9fr) 120px 110px;
        gap: 8px;
        align-items: center;
        min-width: 0;
        padding: 8px 9px;
        border-radius: 3px;
        background: #151d27;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      .sffa-compare-item.is-exclusive {
        border-color: rgba(143, 209, 255, 0.16);
      }
      .sffa-compare-item.is-new {
        background: linear-gradient(180deg, rgba(71, 129, 85, 0.24) 0%, rgba(21, 29, 39, 0.96) 100%);
        border-color: rgba(111, 201, 132, 0.28);
      }
      .sffa-compare-item.is-overlap {
        background: linear-gradient(180deg, rgba(55, 96, 145, 0.2) 0%, rgba(21, 29, 39, 0.96) 100%);
        border-color: rgba(102, 192, 244, 0.24);
      }
      .sffa-compare-item.is-unsupported {
        background: linear-gradient(180deg, rgba(127, 94, 36, 0.18) 0%, rgba(21, 29, 39, 0.96) 100%);
        border-color: rgba(225, 170, 92, 0.24);
      }
      .sffa-compare-item.is-no-value {
        background: linear-gradient(180deg, rgba(97, 104, 112, 0.16) 0%, rgba(21, 29, 39, 0.96) 100%);
      }
      .sffa-compare-item.is-pending {
        background: linear-gradient(180deg, rgba(80, 80, 86, 0.18) 0%, rgba(21, 29, 39, 0.96) 100%);
      }
      .sffa-compare-game {
        min-width: 0;
      }
      .sffa-compare-game a {
        color: #8fd1ff;
        text-decoration: none;
        font-weight: 700;
      }
      .sffa-compare-game a:hover {
        text-decoration: underline;
      }
      .sffa-compare-game-meta {
        margin-top: 3px;
        color: #9fb3c2;
        font-size: 11px;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }
      .sffa-compare-owner-tags {
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .sffa-compare-tag {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #dbe8f3;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
      }
      .sffa-compare-tag.is-active {
        background: rgba(102, 192, 244, 0.18);
        color: #8fd1ff;
      }
      .sffa-compare-tag.is-muted {
        background: rgba(255, 255, 255, 0.05);
        color: #9fb3c2;
      }
      .sffa-compare-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
      }
      .sffa-compare-chip.is-new {
        background: rgba(111, 201, 132, 0.18);
        color: #a8efb5;
      }
      .sffa-compare-chip.is-muted {
        background: rgba(255, 255, 255, 0.08);
        color: #dbe8f3;
      }
      .sffa-compare-chip.is-overlap {
        background: rgba(102, 192, 244, 0.16);
        color: #8fd1ff;
      }
      .sffa-compare-chip.is-no-value {
        background: rgba(125, 132, 141, 0.16);
        color: #d7dde2;
      }
      .sffa-compare-chip.is-unsupported {
        background: rgba(225, 170, 92, 0.16);
        color: #ffd28f;
      }
      .sffa-compare-chip.is-pending {
        background: rgba(150, 156, 167, 0.16);
        color: #d7dde2;
      }
      .sffa-compare-empty {
        padding: 18px 0;
        color: #9fb3c2;
        text-align: center;
      }
      .sffa-tabs {
        display: flex;
        gap: 6px;
        min-height: 30px;
        align-items: center;
      }
      .sffa-list-wrap {
        position: relative;
        flex: 0 0 auto;
      }
      .sffa-list-select {
        flex: 0 0 auto;
        height: 30px;
        min-width: 92px;
        padding: 0 24px 0 10px;
        border-radius: 3px;
        background: #223344;
        color: #c2d4df;
        border: 1px solid rgba(255, 255, 255, 0.08);
        font: inherit;
        text-align: left;
        outline: none;
        cursor: pointer;
        position: relative;
      }
      .sffa-list-select::after {
        content: "";
        position: absolute;
        right: 9px;
        top: 50%;
        width: 0;
        height: 0;
        margin-top: -2px;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 5px solid currentColor;
        opacity: 0.78;
      }
      .sffa-list-select:hover,
      .sffa-list-select[aria-expanded="true"],
      .sffa-list-select.is-active {
        background: #2c4254;
        border-color: rgba(143, 209, 255, 0.34);
        color: #ffffff;
      }
      .sffa-list-menu {
        position: absolute;
        left: 0;
        top: 36px;
        min-width: 112px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 3;
      }
      .sffa-list-wrap.is-open .sffa-list-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-list-option {
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
      .sffa-list-option:hover {
        background: rgba(102, 192, 244, 0.14);
      }
      .sffa-list-option.is-active {
        background: rgba(102, 192, 244, 0.22);
        color: #ffffff;
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
      .sffa-search-wrap {
        position: relative;
        flex: 1 1 180px;
        min-width: 140px;
        max-width: 260px;
      }
      .sffa-search-input {
        display: block;
        width: 100%;
        height: 30px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 30px 0 9px;
        outline: none;
      }
      .sffa-search-clear {
        position: absolute;
        top: 50%;
        right: 4px;
        width: 24px;
        height: 24px;
        padding: 0;
        transform: translateY(-50%);
        display: grid;
        place-items: center;
        border: 0;
        background: transparent;
        color: #9fb3c2;
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
      }
      .sffa-search-wrap.has-value .sffa-search-clear {
        opacity: 1;
        pointer-events: auto;
      }
      .sffa-search-clear:hover {
        color: #ffffff;
      }
      .sffa-search-clear svg {
        width: 14px;
        height: 14px;
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
        .sffa-compare-shell {
          width: calc(100vw - 16px);
          height: calc(100vh - 16px);
        }
        .sffa-compare-summary {
          grid-template-columns: 1fr;
        }
        .sffa-compare-price-ranges {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .sffa-compare-item {
          grid-template-columns: 1fr;
        }
        .sffa-compare-item > * {
          min-width: 0;
        }
        .sffa-compare-item .sffa-compare-chip {
          width: fit-content;
        }
        .sffa-compare-item .sffa-compare-price {
          justify-self: start;
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
                <div class="sffa-list-wrap" data-sffa-list-wrap>
                  <button class="sffa-list-select is-active" type="button" data-sffa-list-select aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeAttr(t("list"))}">${escapeHtml(t("tabs.all"))}</button>
                  <div class="sffa-list-menu" role="listbox" data-sffa-list-menu>
                    <button class="sffa-list-option is-active" type="button" role="option" data-sffa-list-option="all" aria-selected="true">${escapeHtml(t("tabs.all"))}</button>
                    <button class="sffa-list-option" type="button" role="option" data-sffa-list-option="new" aria-selected="false">${escapeHtml(t("tabs.new"))}</button>
                    <button class="sffa-list-option" type="button" role="option" data-sffa-list-option="relativeNew" aria-selected="false">${escapeHtml(t("tabs.relativeNew"))}</button>
                    <button class="sffa-list-option" type="button" role="option" data-sffa-list-option="overlap" aria-selected="false">${escapeHtml(t("tabs.overlap"))}</button>
                  </div>
                </div>
                <div class="sffa-search-wrap" data-sffa-search-wrap>
                  <input class="sffa-search-input" data-sffa-search placeholder="${escapeAttr(t("searchPlaceholder"))}" autocomplete="off">
                  <button class="sffa-search-clear" type="button" data-sffa-search-clear title="${escapeAttr(t("clear"))}" aria-label="${escapeAttr(t("clear"))}">
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
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
      <div class="sffa-compare-overlay" data-sffa-compare-overlay>
        <div class="sffa-compare-overlay-backdrop" data-sffa-compare-backdrop></div>
        <section class="sffa-compare-shell" role="dialog" aria-modal="true" aria-label="${escapeAttr(t("compareTitle"))}">
          <header class="sffa-compare-header">
            <div class="sffa-compare-title">
              <strong data-sffa-compare-title>${escapeHtml(t("compareTitle"))}</strong>
              <span data-sffa-compare-hint></span>
            </div>
            <button class="sffa-compare-close" type="button" data-sffa-compare-close title="${escapeAttr(t("close"))}" aria-label="${escapeAttr(t("close"))}">×</button>
          </header>
          <div class="sffa-compare-summary" data-sffa-compare-summary></div>
          <div class="sffa-compare-body" data-sffa-compare-body></div>
        </section>
      </div>
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
      listWrap: root.querySelector("[data-sffa-list-wrap]"),
      listSelect: root.querySelector("[data-sffa-list-select]"),
      listOptions: Array.from(root.querySelectorAll("[data-sffa-list-option]")),
      searchWrap: root.querySelector("[data-sffa-search-wrap]"),
      searchInput: root.querySelector("[data-sffa-search]"),
      searchClearBtn: root.querySelector("[data-sffa-search-clear]"),
      copyCurrentBtn: root.querySelector("[data-sffa-copy-current]"),
      refreshBtn: root.querySelector("[data-sffa-refresh]"),
      analyzeBtn: root.querySelector("[data-sffa-analyze]"),
      autoFamilyRefreshBtn: root.querySelector("[data-sffa-auto-family-refresh]"),
      copyBtn: root.querySelector("[data-sffa-copy]"),
      clearStoreCacheBtn: root.querySelector("[data-sffa-clear-store-cache]"),
      rawBtn: root.querySelector("[data-sffa-raw]"),
      rateContinueBtn: root.querySelector("[data-sffa-rate-continue]"),
      rateCheckBtn: root.querySelector("[data-sffa-rate-check]"),
      compareOverlay: root.querySelector("[data-sffa-compare-overlay]"),
      compareBackdrop: root.querySelector("[data-sffa-compare-backdrop]"),
      compareCloseBtn: root.querySelector("[data-sffa-compare-close]"),
      compareTitle: root.querySelector("[data-sffa-compare-title]"),
      compareHint: root.querySelector("[data-sffa-compare-hint]"),
      compareSummary: root.querySelector("[data-sffa-compare-summary]"),
      compareBody: root.querySelector("[data-sffa-compare-body]"),
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
    elements.compareBackdrop?.addEventListener("click", closeCompareDialog);
    elements.compareCloseBtn?.addEventListener("click", closeCompareDialog);
    elements.compareSummary?.addEventListener("click", handleCompareSummaryClick);
    elements.tableWrap.addEventListener("scroll", () => scheduleVisiblePriceLoads());
    elements.tableWrap.addEventListener("click", handleTableHeaderClick);
    elements.profile.addEventListener("change", handleTargetSelectionChange);
    elements.profile.addEventListener("click", handleProfileActionClick);
    elements.targetInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        analyzeTarget();
      }
    });
    elements.listSelect.addEventListener("click", toggleListMenu);
    elements.listOptions.forEach(option => {
      option.addEventListener("click", () => {
        setReportTab(option.dataset.sffaListOption);
      });
    });
    elements.searchInput.addEventListener("input", () => {
      renderSearchClearButton();
      scheduleSearchRender();
    });
    elements.searchClearBtn.addEventListener("click", () => {
      if (!elements.searchInput.value) {
        return;
      }
      elements.searchInput.value = "";
      cancelSearchRender();
      renderSearchClearButton();
      renderDetails();
      scheduleAnalysisHistorySave();
      elements.searchInput.focus();
    });
    elements.tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        cancelSearchRender();
        currentTab = tab.dataset.tab;
        renderTabs();
        renderDetails();
        scheduleAnalysisHistorySave();
      });
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (isCompareDialogOpen()) {
          closeCompareDialog();
          return;
        }
        closeListMenu();
        closeMenu();
        closeDialog();
      }
    });
    document.addEventListener("click", event => {
      if (!elements.menuWrap.contains(event.target)) {
        closeMenu();
      }
      if (!elements.listWrap.contains(event.target)) {
        closeListMenu();
      }
    });
    window.addEventListener("beforeunload", () => {
      if (lastReport && !lastReport.filtering?.running) {
        saveAnalysisHistoryNow();
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
    closeListMenu();
    closeCompareDialog();
    elements.root.classList.remove("is-open");
  }

  function toggleMenu(event) {
    event.stopPropagation();
    closeLocaleMenu();
    closeListMenu();
    const isOpen = elements.menuWrap.classList.toggle("is-menu-open");
    elements.moreBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function toggleLocaleMenu(event) {
    event.stopPropagation();
    elements.menuWrap?.classList.remove("is-menu-open");
    elements.moreBtn?.setAttribute("aria-expanded", "false");
    closeListMenu();
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

  function toggleListMenu(event) {
    event.stopPropagation();
    closeMenu();
    const isOpen = elements.listWrap.classList.toggle("is-open");
    elements.listSelect.setAttribute("aria-expanded", String(isOpen));
  }

  function closeListMenu() {
    elements.listWrap?.classList.remove("is-open");
    elements.listSelect?.setAttribute("aria-expanded", "false");
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
    elements.listSelect.setAttribute("aria-label", t("list"));
    elements.listOptions.forEach(option => {
      option.textContent = getMainTabLabel(option.dataset.sffaListOption);
    });
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
    elements.searchClearBtn.title = t("clear");
    elements.searchClearBtn.setAttribute("aria-label", t("clear"));
    elements.copyCurrentBtn.textContent = t("copyList");
    elements.copyBtn.textContent = t("copyReport");
    elements.rawBtn.textContent = t("rawData");
    elements.rateContinueBtn.textContent = t("continue");
    elements.rateCheckBtn.textContent = t("rateCheck");
    elements.compareTitle.textContent = t("compareTitle");
    elements.compareHint.textContent = lastReport && isMultiTargetReport(lastReport)
      ? t("compareHint", { count: lastReport.target.targets.length })
      : "";
    elements.compareCloseBtn.title = t("close");
    elements.compareCloseBtn.setAttribute("aria-label", t("close"));
    renderCompareDialogIfOpen();

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
      if (getTargetSteamIds(targetProfile).includes(session.steamid)) {
        throw new Error(t("currentAccountUnsupported"));
      }
      setRawStep("fetch-current-owned-games");
      const currentOwnedAppids = await fetchCurrentOwnedAppids(session.steamid, state.apiKey);
      setStatus(t("compareLibraries"), "warn");
      setRawStep("compare-libraries");
      const comparison = compareLibraries(targetProfile, currentOwnedAppids);
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
      setStatus(t("currentListEmpty"), "warn");
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
    const targetInputs = splitTargetInputs(rawInput);
    const rawDataPrefixByIndex = targetInputs.length > 1
      ? targetInputs.map((_, index) => `targets.${index}`)
      : targetInputs.map(() => "");
    const profiles = await Promise.all(targetInputs.map((targetInput, index) => fetchSingleTargetProfile(targetInput, rawDataPrefixByIndex[index])));
    const uniqueProfiles = dedupeTargetProfiles(profiles);
    return uniqueProfiles.length === 1 ? uniqueProfiles[0] : mergeTargetProfiles(uniqueProfiles);
  }

  async function fetchSingleTargetProfile(rawInput, rawDataPrefix = "") {
    const parsed = parseTargetInput(rawInput);
    const identity = parsed.steamid64
      ? {
          steamid64: parsed.steamid64,
          profileUrl: `https://steamcommunity.com/profiles/${parsed.steamid64}`,
          source: parsed.source || "steamid64"
        }
      : await resolveVanity(parsed.vanity, state.apiKey, rawDataPrefix);

    return fetchPublicGames(identity, state.apiKey, rawDataPrefix);
  }

  function splitTargetInputs(rawInput) {
    const inputs = String(rawInput || "").trim().split(/\s+/).filter(Boolean);
    if (!inputs.length) {
      throw new Error(t("enterAccount"));
    }
    return inputs;
  }

  function parseTargetInput(rawInput) {
    const input = rawInput.trim();
    if (/^\d{17}$/.test(input)) {
      return { steamid64: input };
    }
    if (/^\d+$/.test(input)) {
      return { steamid64: steamFriendCodeToSteamId64(input), source: "friendCode" };
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

  function steamFriendCodeToSteamId64(friendCode) {
    if (friendCode.length > MAX_STEAM_ACCOUNT_ID_LENGTH) {
      throw new Error(t("invalidFriendCode"));
    }

    const accountId = BigInt(friendCode);
    if (accountId <= 0n || accountId > MAX_STEAM_ACCOUNT_ID) {
      throw new Error(t("invalidFriendCode"));
    }

    return String(STEAMID64_INDIVIDUAL_BASE + accountId);
  }

  function dedupeTargetProfiles(profiles) {
    const profileBySteamId = new Map();
    profiles.forEach(profile => {
      const steamid64 = String(profile.steamid64 || "");
      if (steamid64 && !profileBySteamId.has(steamid64)) {
        profileBySteamId.set(steamid64, profile);
      }
    });
    return Array.from(profileBySteamId.values());
  }

  function mergeTargetProfiles(profiles) {
    const gameById = new Map();
    profiles.forEach(profile => {
      profile.games.forEach(game => {
        const appid = String(game.appid);
        const existing = gameById.get(appid);
        if (!existing) {
          gameById.set(appid, {
            ...game,
            targetOwners: [profile.steamid64]
          });
          return;
        }

        existing.targetOwners = Array.from(new Set([...(existing.targetOwners || []), profile.steamid64]));
        if (!existing.localizedName && game.localizedName) {
          existing.localizedName = game.localizedName;
        }
      });
    });

    const displayNames = profiles.map(getTargetProfileDisplayName);
    return {
      steamid64: profiles.map(profile => profile.steamid64).join(", "),
      displayName: displayNames.join(" + "),
      profileUrl: "",
      avatar: "",
      targets: profiles.map(profile => ({
        steamid64: profile.steamid64,
        displayName: profile.displayName,
        profileUrl: profile.profileUrl,
        avatar: profile.avatar || "",
        selected: true,
        gameAppids: profile.games.map(game => String(game.appid))
      })),
      games: Array.from(gameById.values()),
      rawGameCount: profiles.reduce((sum, profile) => sum + Number(profile.rawGameCount || profile.games.length || 0), 0)
    };
  }

  function getTargetSteamIds(targetProfile) {
    const targets = Array.isArray(targetProfile?.targets) && targetProfile.targets.length
      ? targetProfile.targets
      : [targetProfile];
    return targets.map(target => String(target?.steamid64 || "")).filter(Boolean);
  }

  function getSelectedTargetSteamIds(report = lastReport) {
    const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
    if (!targets.length) {
      return getTargetSteamIds(report?.target || {});
    }
    return targets
      .filter(target => target.selected !== false)
      .map(target => String(target.steamid64 || ""))
      .filter(Boolean);
  }

  function isGameIncludedBySelectedTargets(game, report = lastReport) {
    if (!isMultiTargetReport(report)) {
      return true;
    }
    const selectedIds = new Set(getSelectedTargetSteamIds(report));
    if (selectedIds.size === 0) {
      return false;
    }
    return (game.targetOwners || []).map(String).some(steamid => selectedIds.has(steamid));
  }

  function getTargetProfileDisplayName(profile) {
    return profile?.displayName || profile?.steamid64 || t("unknownAccount");
  }

  function getRawDataPath(prefix, leaf) {
    return prefix ? `${prefix}.${leaf}` : leaf;
  }

  async function resolveVanity(vanity, apiKey, rawDataPrefix = "") {
    if (!vanity) {
        throw new Error(t("missingVanity"));
    }

    if (!apiKey) {
        throw new Error(t("missingApiKey"));
    }

    return resolveVanityWithApiKey(vanity, apiKey, rawDataPrefix);
  }

  async function resolveVanityWithApiKey(vanity, apiKey, rawDataPrefix = "") {
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}&format=json`;
    const data = await requestJson(url);
    setRawData(getRawDataPath(rawDataPrefix, "resolveVanityUrl"), data);
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

  async function fetchPublicGames(identity, apiKey, rawDataPrefix = "") {
    if (!apiKey) {
      throw new Error(t("missingApiKey"));
    }

    return fetchPublicGamesFromOwnedGames(identity, apiKey, rawDataPrefix);
  }

  async function fetchPublicGamesFromOwnedGames(identity, apiKey, rawDataPrefix = "") {
    const steamid64 = identity.steamid64;
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid64)}&include_appinfo=1&include_played_free_games=1&format=json`;
    const [data, playerSummary] = await Promise.all([
      requestJson(url),
      fetchTargetPlayerSummary(steamid64, apiKey, rawDataPrefix)
    ]);
    setRawData(getRawDataPath(rawDataPrefix, "ownedGames"), data);
    if (identity.source === "friendCode" && !playerSummary.exists) {
      throw new Error(t("invalidFriendCode"));
    }
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
      rawGameCount: rawGames.length,
      source: "webapi-ownedgames"
    };
  }

  async function fetchTargetPlayerSummary(steamid64, apiKey, rawDataPrefix = "") {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(steamid64)}&format=json`;
    const data = await requestJson(url);
    setRawData(getRawDataPath(rawDataPrefix, "targetPlayerSummaries"), data);
    const player = data.response?.players?.[0];
    return {
      exists: String(player?.steamid || "") === String(steamid64),
      personaName: player?.personaname || "",
      avatar: player?.avatarfull || player?.avatarmedium || player?.avatar || "",
      profileUrl: player?.profileurl || ""
    };
  }

  async function fetchCurrentOwnedAppids(steamid64, apiKey) {
    if (!steamid64 || !apiKey) {
      throw new Error(t("missingApiKey"));
    }

    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid64)}&include_appinfo=0&include_played_free_games=1&format=json`;
    const data = await requestJson(url);
    setRawData("currentOwnedGames", data);
    const games = Array.isArray(data.response?.games) ? data.response.games : [];
    return new Set(games.map(game => String(game.appid)).filter(appid => /^\d+$/.test(appid)));
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

        let addedNewGame = false;
        for (const game of batchGames) {
          addedNewGame = applyStoreItemResult(game, shareabilityById[String(game.appid)]) || addedNewGame;
        }
        flushShareabilityBatchRender(addedNewGame);
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
    if (currentStatus === "overlap" || currentStatus === "noValue") {
      return false;
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
      return true;
    } else {
      lastReport.metrics.filteredUnsupportedCount += 1;
    }
    return false;
  }

  function flushShareabilityBatchRender(sortNewGames) {
    if (!lastReport) {
      return;
    }
    if (sortNewGames) {
      lastReport.games.new.sort(sortByName);
    }
    scheduleShareabilityProgressRender(true);
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
        coverUrl: getStoreCoverUrl(appid),
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
      coverUrl: getStoreCoverUrl(appid),
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

  function compareLibraries(targetProfile, currentOwnedAppids = new Set()) {
    const familySet = new Set(state.familyLibrary.appidSet.map(String));
    const currentOwnedSet = new Set(Array.from(currentOwnedAppids || []).map(String));
    const targetMap = new Map();
    targetProfile.games.forEach(game => {
      targetMap.set(String(game.appid), game);
    });

    const newGames = [];
    const overlapGames = [];
    const alreadyOwnedGames = [];
    let familyOverlapCount = 0;
    targetMap.forEach((game, appid) => {
      if (familySet.has(appid)) {
        familyOverlapCount += 1;
        const familyInfo = state.familyLibrary.appInfoById[appid] || {};
        overlapGames.push({
          ...game,
          familyName: familyInfo.name || game.name,
          localizedName: getCachedLocalizedName(appid) || game.localizedName || "",
          owners: familyInfo.owners || [],
          targetOwners: game.targetOwners || getTargetSteamIds(targetProfile)
        });
      } else if (currentOwnedSet.has(appid)) {
        alreadyOwnedGames.push({
          ...game,
          targetOwners: game.targetOwners || getTargetSteamIds(targetProfile),
          price: null
        });
      } else {
        newGames.push({
          ...game,
          targetOwners: game.targetOwners || getTargetSteamIds(targetProfile),
          price: null
        });
      }
    });

    return {
      newGames: newGames.sort(sortByName),
      overlapGames: overlapGames.sort(sortByName),
      alreadyOwnedGames: alreadyOwnedGames.sort(sortByName),
      familyOnlyCount: Math.max(0, familySet.size - familyOverlapCount)
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
    cacheStoreCoverUrl(appid, extractStoreCoverUrlFromAppdetails(priceData?.[appid]));
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
      cacheStoreCoverUrl(appid, extractStoreCoverUrlFromAppdetails(item));
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
      renderCompareDialogIfOpen();
      return;
    }
    renderDetailsPreserveScroll();
    renderCompareDialogIfOpen();
  }

  function renderDetailsAfterPriceChange() {
    if (currentTab === "all" || currentTab === "new" || currentTab === "relativeNew") {
      renderDetailsPreserveScroll();
    }
    renderCompareDialogIfOpen();
  }

  function refreshReportMetrics() {
    if (!lastReport) {
      return;
    }
    pruneZeroValueAddedGames();
    const allGames = (lastReport.games.all || []).filter(game => isGameIncludedBySelectedTargets(game, lastReport));
    const newGames = (lastReport.games.new || []).filter(game => isGameIncludedBySelectedTargets(game, lastReport));
    const overlapGames = (lastReport.games.overlap || []).filter(game => isGameIncludedBySelectedTargets(game, lastReport));
    const pricedGames = newGames.filter(game => game.price && !game.price.pending && !game.price.unavailable);
    const unpricedGames = newGames.filter(game => game.price?.unavailable);
    lastReport.metrics.targetCount = allGames.length;
    lastReport.metrics.newCount = newGames.length;
    lastReport.metrics.overlapCount = overlapGames.length;
    lastReport.metrics.overlapRate = lastReport.metrics.familyCount > 0 ? overlapGames.length / lastReport.metrics.familyCount : 0;
    lastReport.metrics.initialValue = pricedGames.reduce((sum, game) => sum + Number(game.price?.initial || 0), 0);
    lastReport.metrics.unpricedCount = unpricedGames.length;
    lastReport.metrics.filteringProcessed = lastReport.filtering?.processed || 0;
    lastReport.metrics.filteringTotal = lastReport.filtering?.total || 0;
    lastReport.games.unpriced = unpricedGames;
    lastReport.targetBreakdown = buildTargetBreakdownFromReport(lastReport);
    renderTabs();
    renderCompareDialogIfOpen();
    scheduleAnalysisHistorySave();
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
    (comparison.alreadyOwnedGames || []).forEach(game => {
      classificationById[String(game.appid)] = { status: "noValue" };
    });
    newGames.forEach(game => {
      classificationById[String(game.appid)] = { status: "new" };
    });

    return {
      target: {
        steamid64: targetProfile.steamid64,
        displayName: targetProfile.displayName,
        profileUrl: targetProfile.profileUrl,
        avatar: targetProfile.avatar || "",
        targets: targetProfile.targets || []
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
      targetBreakdown: buildTargetBreakdown(targetProfile, comparison, newGames),
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

  function buildTargetBreakdown(targetProfile, comparison, currentNewGames = []) {
    const targets = Array.isArray(targetProfile.targets) ? targetProfile.targets : [];
    const selectedTargets = targets.filter(target => target.selected !== false);
    if (selectedTargets.length <= 1) {
      return null;
    }

    const familySet = new Set(state.familyLibrary.appidSet.map(String));
    const selectedIds = new Set(selectedTargets.map(target => String(target.steamid64 || "")));
    const allGames = (comparison.allGames || targetProfile.games || [])
      .filter(game => (game.targetOwners || []).map(String).some(steamid => selectedIds.has(steamid)));
    const overlapGames = (comparison.overlapGames || [])
      .filter(game => (game.targetOwners || []).map(String).some(steamid => selectedIds.has(steamid)));
    const allGameIds = new Set(allGames.map(game => String(game.appid)));
    const overlapGameIds = new Set(overlapGames.map(game => String(game.appid)));
    const newGames = (currentNewGames || [])
      .filter(game => (game.targetOwners || []).map(String).some(steamid => selectedIds.has(steamid)));
    const targetRows = selectedTargets.map(target => {
      const gameIds = Array.from(new Set((target.gameAppids || []).map(String)));
      const steamid64 = String(target.steamid64 || "");
      const targetNewGames = newGames.filter(game => (game.targetOwners || []).map(String).includes(steamid64));
      const pricedNewGames = targetNewGames.filter(game => game.price && !game.price.pending && !game.price.unavailable);
      return {
        steamid64,
        targetCount: gameIds.length,
        overlapCount: gameIds.filter(appid => familySet.has(appid)).length,
        newCount: targetNewGames.length,
        initialValue: pricedNewGames.reduce((sum, game) => sum + Number(game.price?.initial || 0), 0)
      };
    });

    const initialValue = newGames
      .filter(game => game.price && !game.price.pending && !game.price.unavailable)
      .reduce((sum, game) => sum + Number(game.price?.initial || 0), 0);
    return {
      targetCount: buildSplitMetric(targetRows.map(row => row.targetCount), allGameIds.size),
      newCount: buildSplitMetric(targetRows.map(row => row.newCount), newGames.length),
      initialValue: buildSplitMetric(targetRows.map(row => row.initialValue), initialValue),
      overlapCount: buildSplitMetric(targetRows.map(row => row.overlapCount), overlapGameIds.size),
      overlapRate: buildSplitMetric(
        targetRows.map(row => state.familyLibrary.appidSet.length > 0 ? row.overlapCount / state.familyLibrary.appidSet.length : 0),
        state.familyLibrary.appidSet.length > 0 ? overlapGameIds.size / state.familyLibrary.appidSet.length : 0,
        targetRows.reduce((sum, row) => sum + row.overlapCount, 0) !== overlapGameIds.size
      )
    };
  }

  function buildTargetBreakdownFromReport(report) {
    const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
    if (targets.length <= 1) {
      return null;
    }

    return buildTargetBreakdown(
      {
        targets,
        games: report.games?.all || []
      },
      {
        allGames: report.games?.all || [],
        overlapGames: report.games?.overlap || []
      },
      report.games?.new || []
    );
  }

  function buildSplitMetric(parts, total, forceDeduped = false) {
    const numericParts = parts.map(value => Number(value || 0));
    const numericTotal = Number(total || 0);
    const partSum = numericParts.reduce((sum, value) => sum + value, 0);
    return {
      parts: numericParts,
      total: numericTotal,
      deduped: forceDeduped || Math.abs(partSum - numericTotal) > 1e-9
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
    const breakdown = report?.targetBreakdown || null;
    const filterValue = metrics.filteringTotal
      ? `${metrics.filteringProcessed || 0}/${metrics.filteringTotal}`
      : "0/0";
    elements.summary.innerHTML = [
      metricHtml(t("targetAccount"), escapeHtml(targetLabel)),
      metricHtml(t("progress"), filterValue),
      metricHtml(t("tabs.family"), `${metrics.familyCount}`),
      metricHtml(t("totalGames"), formatSummaryMetric(breakdown?.targetCount, value => `${value}`, metrics.targetCount)),
      metricHtml(t("addedGames"), formatSummaryMetric(breakdown?.newCount, value => `${value}`, metrics.newCount)),
      metricHtml(t("addedValue"), formatSummaryMetric(breakdown?.initialValue, value => formatMoney(value), metrics.initialValue)),
      metricHtml(t("duplicatedGames"), formatSummaryMetric(breakdown?.overlapCount, value => `${value}`, metrics.overlapCount)),
      metricHtml(t("overlapRate"), formatSummaryMetric(breakdown?.overlapRate, value => formatPercent(value), metrics.overlapRate))
    ].join("");
  }

  function formatSummaryMetric(splitMetric, formatter, fallbackValue) {
    if (!splitMetric || !Array.isArray(splitMetric.parts) || splitMetric.parts.length <= 1) {
      return formatter(fallbackValue);
    }

    const parts = splitMetric.parts.map(value => formatter(value));
    const suffix = splitMetric.deduped ? ` (${escapeHtml(t("deduped"))})` : "";
    return `${parts.join(" + ")} = ${formatter(splitMetric.total)}${suffix}`;
  }

  function renderTargetProfile(report) {
    if (!report) {
      elements.profile.innerHTML = `<div class="sffa-empty">${escapeHtml(t("noSummary"))}</div>`;
      return;
    }

    const target = report.target || {};
    const targets = Array.isArray(target.targets) ? target.targets : [];
    if (targets.length > 1) {
      const rows = targets.map((profile, index) => {
        const name = getTargetProfileDisplayName(profile);
        const checked = profile.selected === false ? "" : " checked";
        const nameHtml = profile.profileUrl
          ? `<a class="sffa-profile-link" href="${escapeAttr(profile.profileUrl)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`
          : escapeHtml(name);
        return `
          <div class="sffa-target-row">
            <input type="checkbox" data-sffa-target-toggle value="${escapeAttr(profile.steamid64 || "")}"${checked}>
            <span>${nameHtml} · ${escapeHtml(profile.steamid64 || "-")}</span>
          </div>
        `;
      }).join("");
      elements.profile.innerHTML = `
        <div class="sffa-profile-head">
          <button class="sffa-compare-btn" type="button" data-sffa-open-compare title="${escapeAttr(t("compare"))}" aria-label="${escapeAttr(t("compare"))}">${escapeHtml(t("compare"))}</button>
          <div>
            <div class="sffa-profile-name">${escapeHtml(target.displayName || t("targetAccountCount", { count: targets.length }))}</div>
          </div>
        </div>
        <div class="sffa-profile-row"><span>${escapeHtml(t("targetAccount"))}</span><span>${escapeHtml(t("targetAccountCount", { count: targets.length }))}</span></div>
        ${rows}
        <div class="sffa-profile-row"><span>${escapeHtml(t("time"))}</span><span>${formatDateTime(report.generatedAt)}</span></div>
      `;
      return;
    }

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

  function handleTargetSelectionChange(event) {
    const checkbox = event.target.closest("[data-sffa-target-toggle]");
    if (!checkbox || !lastReport) {
      return;
    }

    const steamid64 = String(checkbox.value || "");
    const targets = Array.isArray(lastReport.target?.targets) ? lastReport.target.targets : [];
    const target = targets.find(item => String(item.steamid64 || "") === steamid64);
    if (!target) {
      return;
    }

    target.selected = checkbox.checked;
    refreshReportMetrics();
    renderTabs();
    renderSummary(lastReport);
    renderTargetProfile(lastReport);
    renderDetails();
    renderCompareDialogIfOpen();
    scheduleAnalysisHistorySave();
  }

  function handleProfileActionClick(event) {
    const button = event.target.closest("[data-sffa-open-compare]");
    if (!button) {
      return;
    }
    openCompareDialog();
  }

  function isCompareDialogOpen() {
    return Boolean(elements.root?.classList.contains("is-compare-open"));
  }

  function openCompareDialog() {
    if (!lastReport || !isMultiTargetReport(lastReport)) {
      setStatus(t("noSummary"), "warn");
      return;
    }

    closeMenu();
    comparePriceRangeByTarget = {};
    renderCompareDialog(lastReport);
    elements.root.classList.add("is-compare-open");
    if (elements.compareSummary) {
      elements.compareSummary.scrollTop = 0;
    }
  }

  function closeCompareDialog() {
    elements.root.classList.remove("is-compare-open");
    comparePriceRangeByTarget = {};
  }

  function renderCompareDialogIfOpen() {
    if (!isCompareDialogOpen() || !lastReport) {
      return;
    }
    if (lastReport.filtering?.running) {
      return;
    }

    const scrollTop = elements.compareSummary?.scrollTop || 0;
    renderCompareDialog(lastReport);
    if (elements.compareSummary) {
      elements.compareSummary.scrollTop = scrollTop;
    }
  }

  function renderCompareDialog(report) {
    if (!elements.compareSummary || !elements.compareBody || !elements.compareHint || !elements.compareTitle) {
      return;
    }

    if (!report || !isMultiTargetReport(report)) {
      elements.compareTitle.textContent = t("compareTitle");
      elements.compareHint.textContent = t("compareHint", { count: Array.isArray(report?.target?.targets) ? report.target.targets.length : 0 });
      elements.compareSummary.innerHTML = "";
      elements.compareBody.innerHTML = `<div class="sffa-compare-empty">${escapeHtml(t("compareNoData"))}</div>`;
      return;
    }

    elements.compareTitle.textContent = t("compareTitle");
    if (report?.filtering?.running) {
      elements.compareHint.textContent = t("compareLoadingHint");
      elements.compareSummary.innerHTML = renderCompareLoadingHtml(report);
      elements.compareBody.innerHTML = "";
      return;
    }

    const compare = buildCompareView(report);
    elements.compareHint.textContent = t("compareHint", { count: compare.targets.length });
    elements.compareSummary.innerHTML = compare.targets.map(target => renderCompareCardHtml(target, compare)).join("");
    elements.compareBody.innerHTML = "";
  }

  function renderCompareLoadingHtml(report) {
    const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
    const percent = report?.filtering?.total
      ? formatPercent((report.filtering.processed || 0) / report.filtering.total)
      : formatPercent(0);
    const cards = targets.map(target => {
      const name = getTargetProfileDisplayName(target);
      const steamid64 = String(target?.steamid64 || "");
      const totalCount = Array.isArray(target?.gameAppids) ? target.gameAppids.length : 0;
      const statusText = target.selected === false ? t("compareExcluded") : "";
      return `
        <section class="sffa-compare-card">
          <div class="sffa-compare-card-head${statusText ? " has-status" : ""}">
            ${renderAvatarHtml(target?.avatar || "", name)}
            <div class="sffa-compare-card-title">
              <strong>${escapeHtml(name)}</strong>
              <span>${escapeHtml(steamid64 || "-")}</span>
              <span class="sffa-compare-card-summary">${escapeHtml(t("compareLoadingHint"))}</span>
            </div>
            ${statusText ? `<span class="sffa-compare-card-status">${escapeHtml(statusText)}</span>` : ""}
          </div>
          <div class="sffa-compare-card-stats">
            ${metricCardHtml(t("compareTotal"), totalCount, false)}
            ${metricCardHtml(t("progress"), percent, false, true)}
          </div>
          <div class="sffa-compare-card-empty">${escapeHtml(t("compareLoadingHint"))}</div>
        </section>
      `;
    }).join("");

    if (!cards) {
      return `<div class="sffa-compare-empty">${escapeHtml(t("compareLoadingHint"))}</div>`;
    }

    return cards;
  }

  function buildCompareView(report) {
    const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
    const activeTargets = targets.length ? targets : [report?.target].filter(Boolean);
    const activeIdSet = new Set(activeTargets.map(target => String(target?.steamid64 || "")).filter(Boolean));
    const allGames = Array.isArray(report?.games?.all) ? report.games.all : [];
    const familySet = new Set(state.familyLibrary.appidSet.map(String));
    const newIdSet = new Set((report?.games?.new || []).map(game => String(game.appid)));
    const overlapIdSet = new Set((report?.games?.overlap || []).map(game => String(game.appid)));
    const gameById = new Map();

    allGames.forEach(game => {
      const appid = String(game?.appid || "");
      if (!appid) {
        return;
      }
      const owners = Array.from(new Set((game.targetOwners || []).map(String).filter(steamid => activeIdSet.has(steamid))));
      if (!owners.length) {
        return;
      }
      gameById.set(appid, {
        ...game,
        appid,
        owners,
        ownerCount: owners.length
      });
    });

    const games = Array.from(gameById.values()).map(game => {
      const status = getCompareGameStatus(report, game.appid, familySet, newIdSet, overlapIdSet);
      const price = resolveCompareGamePrice(game);
      const groupKey = game.ownerCount === 1
        ? "exclusive"
        : game.ownerCount === activeTargets.length
          ? "all"
          : "partial";
      return {
        ...game,
        price,
        status,
        groupKey,
        statusLabel: getCompareStatusLabel(status),
        priceText: getCompareGamePriceText(price, status),
        statusClass: getCompareStatusClass(status)
      };
    }).sort(compareGameRows);

    const targetStats = activeTargets.map(target => buildCompareTargetStats(target, games, activeTargets.length));
    const statMax = {
      unique: Math.max(...targetStats.map(item => item.uniqueCount), 0),
      added: Math.max(...targetStats.map(item => item.uniqueAddedCount), 0),
      addedValue: Math.max(...targetStats.map(item => item.addedValue), 0),
      averageValue: Math.max(...targetStats.map(item => item.qualityValue), 0)
    };

    return {
      targets: activeTargets,
      targetStats,
      statMax
    };
  }

  function buildCompareTargetStats(target, games, targetTotal) {
    const steamid64 = String(target?.steamid64 || "");
    const ownedGames = games.filter(game => game.owners.includes(steamid64));
    const uniqueGames = ownedGames.filter(game => game.ownerCount === 1);
    const sharedGames = ownedGames.filter(game => game.ownerCount > 1);
    const newGames = ownedGames.filter(game => game.status === "new");
    const uniqueNewGames = newGames.filter(game => game.ownerCount === 1).sort(compareUniqueNewGames);
    const addedValue = newGames
      .map(game => resolveCompareGamePrice(game))
      .filter(price => price && !price.pending && !price.unavailable)
      .reduce((sum, price) => sum + Number(price?.initial || 0), 0);
    const qualityValue = newGames.length ? addedValue / newGames.length : 0;

    return {
      steamid64,
      displayName: getTargetProfileDisplayName(target),
      profileUrl: target?.profileUrl || "",
      avatar: target?.avatar || "",
      selected: target?.selected !== false,
      totalCount: Array.isArray(target?.gameAppids) ? target.gameAppids.length : ownedGames.length,
      uniqueCount: uniqueGames.length,
      sharedCount: sharedGames.length,
      addedCount: newGames.length,
      uniqueAddedCount: uniqueNewGames.length,
      addedValue,
      qualityValue,
      newGames,
      uniqueNewGames,
      ownedGames,
      targetTotal
    };
  }

  function renderCompareCardHtml(target, compare) {
    const stats = compare.targetStats.find(item => item.steamid64 === target.steamid64) || buildCompareTargetStats(target, [], compare.targets.length);
    const uniqueBest = compare.statMax.unique > 0;
    const addedBest = compare.statMax.added > 0;
    const addedValueBest = compare.statMax.addedValue > 0;
    const averageValueBest = compare.statMax.averageValue > 0;
    const selectedRange = getCompareSelectedPriceRange(stats.steamid64);
    const uniqueGames = Array.isArray(stats.uniqueNewGames) ? stats.uniqueNewGames : [];
    const filteredUniqueGames = selectedRange
      ? uniqueGames.filter(game => isCompareGameInPriceRange(game, selectedRange))
      : uniqueGames;
    const summaryText = getCompareTargetSummaryText(stats);
    const html = [
      metricCardHtml(`${t("compareUnique")}/${t("compareTotal")}`, `${stats.uniqueCount}/${stats.totalCount}`, uniqueBest && stats.uniqueCount === compare.statMax.unique, false, t("compareUniqueTip")),
      metricCardHtml(`${t("compareUniqueAdded")}/${t("compareAdded")}`, `${stats.uniqueAddedCount}/${stats.addedCount}`, addedBest && stats.uniqueAddedCount === compare.statMax.added, false, t("compareUniqueAddedTip")),
      metricCardHtml(t("addedValue"), formatMoney(Number(stats.addedValue || 0)), addedValueBest && stats.addedValue === compare.statMax.addedValue),
      metricCardHtml(t("compareAverageValue"), formatMoney(Number(stats.qualityValue || 0)), averageValueBest && stats.qualityValue === compare.statMax.averageValue),
      renderComparePriceRangeCards(stats, selectedRange)
    ].join("");

    const statusHtml = stats.selected ? "" : `<span class="sffa-compare-card-status">${escapeHtml(t("compareExcluded"))}</span>`;
    const emptyText = selectedRange ? t("compareNoRangeGames") : t("compareNoUniqueAdded");
    const uniqueGamesHtml = filteredUniqueGames.length
      ? filteredUniqueGames.map(game => renderCompareUniqueGameHtml(game)).join("")
      : `<div class="sffa-compare-card-empty">${escapeHtml(emptyText)}</div>`;
    const gamesCountText = selectedRange
      ? `${filteredUniqueGames.length}/${uniqueGames.length}`
      : String(uniqueGames.length);
    return `
      <section class="sffa-compare-card${stats.selected ? "" : " is-muted"}">
        <div class="sffa-compare-card-head${statusHtml ? " has-status" : ""}">
          ${renderAvatarHtml(stats.avatar, stats.displayName)}
          <div class="sffa-compare-card-title">
            <strong>${escapeHtml(stats.displayName)}</strong>
            <span>${escapeHtml(stats.steamid64 || "-")}</span>
            <span class="sffa-compare-card-summary">${escapeHtml(summaryText)}</span>
          </div>
          ${statusHtml}
        </div>
        <div class="sffa-compare-card-stats">
          ${html}
        </div>
        <div class="sffa-compare-card-games">
          <div class="sffa-compare-card-games-head">
            <strong>${escapeHtml(t("compareUniqueAdded"))}</strong>
            <span>${escapeHtml(gamesCountText)}</span>
          </div>
          <div class="sffa-compare-card-games-list">
            ${uniqueGamesHtml}
          </div>
        </div>
      </section>
    `;
  }

  function renderComparePriceRangeCards(stats, selectedRange) {
    const counts = getComparePriceRangeCounts(stats.uniqueNewGames || []);
    return `
      <div class="sffa-compare-price-ranges">
        ${COMPARE_PRICE_RANGES.map(range => {
          const active = selectedRange === range.key;
          return `
            <button class="sffa-compare-price-range${active ? " is-active" : ""}" type="button" data-sffa-compare-range="${escapeAttr(range.key)}" data-sffa-compare-target="${escapeAttr(stats.steamid64)}" aria-pressed="${active ? "true" : "false"}">
              <span>${escapeHtml(range.label)}</span>
              <strong>${escapeHtml(String(counts[range.key] || 0))}</strong>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function getComparePriceRangeCounts(games) {
    const counts = {};
    COMPARE_PRICE_RANGES.forEach(range => {
      counts[range.key] = 0;
    });
    (games || []).forEach(game => {
      const key = getCompareGamePriceRangeKey(game);
      if (key && Object.prototype.hasOwnProperty.call(counts, key)) {
        counts[key] += 1;
      }
    });
    return counts;
  }

  function getCompareGamePriceRangeKey(game) {
    const price = resolveCompareGamePrice(game);
    if (!price || price.pending || price.unavailable || price.initial == null) {
      return "";
    }
    const cents = Number(price.initial || 0);
    const range = COMPARE_PRICE_RANGES.find(item => cents >= item.min && cents < item.max);
    return range?.key || "";
  }

  function isCompareGameInPriceRange(game, rangeKey) {
    return getCompareGamePriceRangeKey(game) === rangeKey;
  }

  function getCompareSelectedPriceRange(steamid64) {
    return String(comparePriceRangeByTarget[String(steamid64 || "")] || "");
  }

  function handleCompareSummaryClick(event) {
    const button = event.target.closest("[data-sffa-compare-range]");
    if (!button || !lastReport) {
      return;
    }

    const steamid64 = String(button.dataset.sffaCompareTarget || "");
    const range = String(button.dataset.sffaCompareRange || "");
    if (!steamid64 || !range) {
      return;
    }

    if (comparePriceRangeByTarget[steamid64] === range) {
      delete comparePriceRangeByTarget[steamid64];
    } else {
      comparePriceRangeByTarget[steamid64] = range;
    }
    renderCompareDialog(lastReport);
  }

  function getCompareTargetSummaryText(stats) {
    const qualitySummary = getCompareTargetQualitySummaryText(stats);
    return qualitySummary;
  }

  function getCompareTargetQualitySummaryText(stats) {
    const count = Number(stats?.addedCount || 0);
    if (!count) {
      return t("compareQualityNone");
    }
    const qualityScore = getCompareTargetQualityScore(stats);
    const quality = getCompareTargetQualityLabel(qualityScore);
    return t("compareQualitySummary", { quality });
  }

  function getCompareTargetQualityScore(stats) {
    const count = Number(stats?.addedCount || 0);
    if (!count) {
      return 0;
    }
    const average = Number(stats?.addedValue || 0) / count;
    const multiplier = 1 + Math.log2(count + 1) * 0.2;
    return average * multiplier;
  }

  function getCompareTargetQualityLabel(scoreCents) {
    const value = Number(scoreCents || 0);
    const level = COMPARE_QUALITY_LEVELS.find(item => value < item.max) || COMPARE_QUALITY_LEVELS[COMPARE_QUALITY_LEVELS.length - 1];
    return {
      veryLow: t("compareQualityVeryLow"),
      low: t("compareQualityLow"),
      medium: t("compareQualityMedium"),
      high: t("compareQualityHigh"),
      veryHigh: t("compareQualityVeryHigh")
    }[level.key] || "-";
  }

  function metricCardHtml(label, value, highlight = false, wide = false, title = "") {
    const classes = ["sffa-compare-stat"];
    if (highlight) {
      classes.push("is-highlight");
    }
    if (wide) {
      classes.push("is-wide");
    }
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
    return `
      <div class="${classes.join(" ")}"${titleAttr}>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function renderCompareUniqueGameHtml(game) {
    const priceClass = getComparePriceChipClass(game);
    const coverUrl = getCompareGameCoverUrl(game.appid);
    const coverStyle = coverUrl ? ` style="--sffa-cover: url(${escapeAttr(coverUrl)});"` : "";
    const gameName = getGameDisplayName(game);
    return `
      <div class="sffa-compare-card-game"${coverStyle}>
        <a class="sffa-compare-card-game-link" href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener" aria-label="${escapeAttr(gameName)}" title="${escapeAttr(gameName)}">
          <span class="sffa-compare-card-game-title">${escapeHtml(gameName)}</span>
          <span class="sffa-compare-card-game-price ${escapeAttr(priceClass)}">${escapeHtml(game.priceText)}</span>
        </a>
      </div>
    `;
  }

  function resolveCompareGamePrice(game) {
    if (game?.price && (typeof game.price.initial === "number" || game.price.pending || game.price.unavailable)) {
      return game.price;
    }
    return state.storeCache?.[String(game?.appid || "")]?.price || null;
  }

  function getComparePriceChipClass(game) {
    if (game?.price?.pending) {
      return "is-pending";
    }
    if (game?.price?.unavailable) {
      return game?.status === "unsupported" ? "is-unsupported" : "is-no-value";
    }
    if (typeof game?.price?.initial === "number") {
      return game?.status === "new" ? "is-new" : "is-overlap";
    }
    return "is-no-value";
  }

  function getCompareGameCoverUrl(appid) {
    return getCachedStoreCoverUrl(appid) || getStoreCoverUrl(appid);
  }

  function getCachedStoreCoverUrl(appid) {
    const entry = state.storeCache?.[String(appid || "")];
    return String(entry?.coverUrl || "");
  }

  function getStoreCoverUrl(appid) {
    const value = String(appid || "");
    if (!/^\d+$/.test(value)) {
      return "";
    }
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${value}/header.jpg`;
  }

  function extractStoreCoverUrlFromAppdetails(item) {
    return String(item?.data?.header_image || item?.data?.capsule_image || "");
  }

  function cacheStoreCoverUrl(appid, coverUrl) {
    const normalized = String(coverUrl || "").trim();
    if (!normalized) {
      return;
    }
    state.storeCache = state.storeCache || {};
    state.storeCache[String(appid)] = mergeStoreCacheEntry(state.storeCache[String(appid)], {
      context: STORE_CACHE_CONTEXT,
      coverUrl: normalized,
      updatedAt: Date.now()
    });
  }

  function renderAvatarHtml(avatarUrl, label) {
    if (avatarUrl) {
      return `<img class="sffa-avatar" src="${escapeAttr(avatarUrl)}" alt="">`;
    }
    return `<div class="sffa-avatar">${escapeHtml(getAvatarFallbackText(label))}</div>`;
  }

  function getAvatarFallbackText(label) {
    const text = String(label || "").trim();
    if (!text) {
      return "?";
    }
    return text.slice(0, 1).toUpperCase();
  }

  function getCompareGameStatus(report, appid, familySet, newIdSet, overlapIdSet) {
    const status = report?.classificationById?.[String(appid)]?.status;
    if (status) {
      return status;
    }
    if (newIdSet.has(String(appid))) {
      return "new";
    }
    if (overlapIdSet.has(String(appid)) || familySet.has(String(appid))) {
      return "overlap";
    }
    return "pending";
  }

  function getCompareStatusLabel(status) {
    return {
      new: t("compareAdded"),
      overlap: t("duplicatedGames"),
      noValue: t("noAddedValue"),
      unsupported: t("unsupported"),
      pending: t("pending")
    }[status] || t("compareStatus");
  }

  function getCompareStatusClass(status) {
    return {
      new: "new",
      overlap: "overlap",
      noValue: "no-value",
      unsupported: "unsupported",
      pending: "pending"
    }[status] || "pending";
  }

  function getCompareGamePriceText(price, status) {
    if (price?.pending || status === "pending") {
      return t("pending");
    }
    if (price?.unavailable || status === "unsupported") {
      return "N/A";
    }
    if (price && (typeof price.initial === "number" || price.isFree === true)) {
      return formatOriginalPriceText(price);
    }
    return t("loading");
  }

  function compareUniqueNewGames(left, right) {
    const leftPrice = getOriginalPriceSortValue(resolveCompareGamePrice(left));
    const rightPrice = getOriginalPriceSortValue(resolveCompareGamePrice(right));
    if (leftPrice !== rightPrice) {
      return rightPrice - leftPrice;
    }
    return String(getGameDisplayName(left) || "").localeCompare(String(getGameDisplayName(right) || ""), getNumberLocale(), { numeric: true, sensitivity: "base" });
  }

  function compareGameRows(left, right) {
    const groupOrder = {
      exclusive: 0,
      partial: 1,
      all: 2
    };
    const statusOrder = {
      new: 0,
      pending: 1,
      unsupported: 2,
      noValue: 3,
      overlap: 4
    };
    const leftGroup = groupOrder[left.groupKey] ?? 9;
    const rightGroup = groupOrder[right.groupKey] ?? 9;
    if (leftGroup !== rightGroup) {
      return leftGroup - rightGroup;
    }
    const leftStatus = statusOrder[left.status] ?? 9;
    const rightStatus = statusOrder[right.status] ?? 9;
    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus;
    }
    const leftPrice = Number(left.price?.initial || 0);
    const rightPrice = Number(right.price?.initial || 0);
    if (leftPrice !== rightPrice) {
      return rightPrice - leftPrice;
    }
    return String(getGameDisplayName(left) || "").localeCompare(String(getGameDisplayName(right) || ""), getNumberLocale(), { numeric: true, sensitivity: "base" });
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
    const isReportTab = isReportListTab(currentTab);
    const selectedReportTab = isReportTab ? currentTab : elements.listSelect.dataset.selectedTab || "all";
    elements.listSelect.dataset.selectedTab = selectedReportTab;
    elements.listSelect.textContent = getMainTabDisplayLabel(selectedReportTab);
    elements.listSelect.classList.toggle("is-active", isReportTab);
    elements.listOptions.forEach(option => {
      const isActive = option.dataset.sffaListOption === selectedReportTab;
      option.textContent = getMainTabDisplayLabel(option.dataset.sffaListOption);
      option.classList.toggle("is-active", isActive);
      option.setAttribute("aria-selected", String(isActive));
    });
    elements.tabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.tab === currentTab);
    });
    renderSearchClearButton();
  }

  function normalizeMainTab(tab) {
    return [...REPORT_LIST_TABS, "family"].includes(tab) ? tab : "all";
  }

  function isReportListTab(tab) {
    return REPORT_LIST_TABS.includes(tab);
  }

  function setReportTab(tab) {
    const nextTab = isReportListTab(tab) ? tab : "all";
    closeListMenu();
    if (currentTab === nextTab) {
      return;
    }
    cancelSearchRender();
    currentTab = nextTab;
    renderTabs();
    renderDetails();
    scheduleAnalysisHistorySave();
  }

  function getMainTabLabel(tab) {
    return {
      all: t("tabs.all"),
      new: t("tabs.new"),
      relativeNew: t("tabs.relativeNew"),
      overlap: t("tabs.overlap")
    }[tab] || t("tabs.all");
  }

  function getMainTabDisplayLabel(tab) {
    return `${getMainTabLabel(tab)} (${getReportListCount(tab)})`;
  }

  function getReportListCount(tab) {
    if (!lastReport) {
      return 0;
    }
    if (tab === "relativeNew") {
      return getRelativeNewRowsForCurrentSelection(lastReport).length;
    }
    if (tab === "all" || tab === "new" || tab === "overlap") {
      return getReportRowsForCurrentSelection(tab).length;
    }
    return 0;
  }

  function renderSearchClearButton() {
    elements.searchWrap.classList.toggle("has-value", Boolean(elements.searchInput.value));
  }

  function scheduleSearchRender() {
    if (searchRenderTimer) {
      window.clearTimeout(searchRenderTimer);
    }
    searchRenderTimer = window.setTimeout(() => {
      searchRenderTimer = 0;
      renderDetails();
      scheduleAnalysisHistorySave();
    }, SEARCH_RENDER_DEBOUNCE_MS);
  }

  function cancelSearchRender() {
    if (!searchRenderTimer) {
      return;
    }
    window.clearTimeout(searchRenderTimer);
    searchRenderTimer = 0;
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
      const includeTargetOwners = isMultiTargetReport();
      return {
        headers: includeTargetOwners ? ["AppID", t("game"), t("targetOwners"), t("price")] : ["AppID", t("game"), t("price")],
        rows: rows.map(game => includeTargetOwners
          ? [
              game.appid,
              getGameDisplayName(game),
              formatTargetOwners(game.targetOwners || []),
              formatOriginalPriceText(game.price || {})
            ]
          : [
              game.appid,
              getGameDisplayName(game),
              formatOriginalPriceText(game.price || {})
            ])
      };
    }
    if (currentTab === "relativeNew") {
      return {
        headers: ["AppID", t("game"), t("owners"), t("price")],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOwners(game.owners || []) || "-",
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
    const includeTargetOwners = isMultiTargetReport();
    return {
      headers: includeTargetOwners ? ["AppID", t("game"), t("targetOwners"), t("status")] : ["AppID", t("game"), t("status")],
      rows: rows.map(game => includeTargetOwners
        ? [
            game.appid,
            getGameDisplayName(game),
            formatTargetOwners(game.targetOwners || []),
            getGameListLabel(game.appid)
          ]
        : [
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
      const sourceRows = getFamilyLibraryRows();
      const rows = getSortedRows("family", filterRowsBySearchQuery(sourceRows));
      if (rows.length === 0) {
        elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(sourceRows.length ? t("noMatches") : t("noFamilyRefresh"))}</div>`;
        return;
      }
      elements.tableWrap.innerHTML = buildFamilyLibraryTable(rows);
      return;
    }

    if (!lastReport) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(t("initialEmpty"))}</div>`;
      return;
    }

    const sourceRows = getReportRowsForCurrentSelection(currentTab);
    const rows = getSortedRows(currentTab, filterRowsBySearchQuery(sourceRows));
    if (currentTab === "relativeNew") {
      prepareOriginalPricesForMissingRows(rows);
    }
    if (rows.length === 0) {
      const emptyText = sourceRows.length ? t("noMatches") : t("tabEmpty", { tab: getTabLabel(currentTab) });
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(emptyText)}</div>`;
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
    if (tab === "relativeNew") {
      return buildRelativeNewTable(rows);
    }
    if (tab === "overlap") {
      return buildOverlapTable(rows);
    }
    return buildNewGamesTable(rows);
  }

  function getReportRowsForCurrentSelection(tab) {
    if (tab === "relativeNew") {
      return getRelativeNewRowsForCurrentSelection(lastReport);
    }
    return (lastReport.games[tab] || []).filter(game => isGameIncludedBySelectedTargets(game, lastReport));
  }

  function getRelativeNewRowsForCurrentSelection(report = lastReport) {
    if (!report) {
      return [];
    }
    return getFamilyRowsMissingFromAppids(getSelectedTargetOwnedAppids(report));
  }

  function getSelectedTargetOwnedAppids(report = lastReport) {
    if (!report) {
      return new Set();
    }
    if (!isMultiTargetReport(report)) {
      return new Set((report.games?.all || []).map(game => String(game.appid)));
    }

    const selectedIds = new Set(getSelectedTargetSteamIds(report));
    const ownedAppids = new Set();
    (report.games?.all || []).forEach(game => {
      const owners = (game.targetOwners || []).map(String);
      if (owners.some(steamid => selectedIds.has(steamid))) {
        ownedAppids.add(String(game.appid));
      }
    });
    return ownedAppids;
  }

  function getFamilyRowsMissingFromAppids(ownedAppids) {
    return getFamilyLibraryRows()
      .filter(game => !ownedAppids.has(String(game.appid)));
  }

  function prepareOriginalPricesForMissingRows(rows) {
    rows.forEach(game => {
      if (game.price && !game.price.pending) {
        return;
      }
      prepareOriginalPriceForGame(game);
    });
  }

  function filterRowsBySearchQuery(rows) {
    const query = getCurrentSearchQuery();
    if (!query) {
      return rows;
    }
    return rows.filter(game => {
      const name = String(getGameDisplayName(game)).toLowerCase();
      const appid = String(game.appid || "");
      return name.includes(query) || appid.includes(query);
    });
  }

  function getCurrentSearchQuery() {
    return String(elements.searchInput?.value || "").trim().toLowerCase();
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
      case "targetOwners":
        return formatTargetOwners(game.targetOwners || []);
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

  function getCurrentListRows() {
    if (currentTab === "family") {
      return getSortedRows("family", filterRowsBySearchQuery(getFamilyLibraryRows()));
    }
    if (!lastReport) {
      return [];
    }
    return getSortedRows(currentTab, filterRowsBySearchQuery(getReportRowsForCurrentSelection(currentTab)));
  }

  function getFamilyLibraryRows() {
    return (state.familyLibrary?.appidSet || [])
      .map(appid => state.familyLibrary?.appInfoById?.[String(appid)])
      .filter(Boolean)
      .map(game => ({
        ...game,
        localizedName: getCachedLocalizedName(game.appid) || game.localizedName || "",
        price: getCachedOriginalPrice(game.appid)
      }))
      .sort(sortFamilyLibraryRows);
  }

  function buildAllGamesTable(rows) {
    const includeTargetOwners = isMultiTargetReport();
    const body = rows.map(game => `
      <tr>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        ${includeTargetOwners ? `<td>${escapeHtml(formatTargetOwners(game.targetOwners || []))}</td>` : ""}
        <td data-status-appid="${escapeAttr(game.appid)}">${getGameListStatusHtml(game.appid)}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh(t("game"), "name")}
        ${includeTargetOwners ? sortableTh(t("targetOwners"), "targetOwners", "width: 150px;") : ""}
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

  function buildRelativeNewTable(rows) {
    const body = rows.map(game => `
      <tr data-price-appid="${escapeAttr(game.appid)}">
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${escapeHtml(formatOwners(game.owners || []) || "-")}</td>
        <td>${formatOriginalPriceCell(game.price || {})}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh(t("game"), "name")}
        ${sortableTh(t("owners"), "owners", "width: 160px;")}
        ${sortableTh(t("price"), "price", "width: 110px;")}
      </tr>
    `, body);
  }

  function buildNewGamesTable(rows) {
    const includeTargetOwners = isMultiTargetReport();
    const body = rows.map(game => `
      <tr data-price-appid="${escapeAttr(game.appid)}">
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        ${includeTargetOwners ? `<td>${escapeHtml(formatTargetOwners(game.targetOwners || []))}</td>` : ""}
        <td>${formatOriginalPriceCell(game.price || {})}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh(t("game"), "name")}
        ${includeTargetOwners ? sortableTh(t("targetOwners"), "targetOwners", "width: 150px;") : ""}
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

  function getCachedOriginalPrice(appid) {
    const price = state.storeCache?.[String(appid)]?.price;
    return isFreshOriginalPriceCacheEntry(price) ? price : null;
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

  function loadAnalysisHistory() {
    try {
      const saved = GM_getValue(ANALYSIS_HISTORY_KEY);
      if (!saved || saved.version !== 1 || !saved.report) {
        return null;
      }
      return saved;
    } catch (error) {
      return null;
    }
  }

  function restoreAnalysisHistory() {
    const saved = loadAnalysisHistory();
    if (!saved) {
      return false;
    }

    lastReport = saved.report;
    if (lastReport?.filtering) {
      lastReport.filtering.running = false;
      lastReport.filtering.paused = Boolean(lastReport.filtering.paused);
    }
    currentTab = normalizeMainTab(saved.currentTab);
    tableSortByTab = saved.tableSortByTab || {};
    comparePriceRangeByTarget = {};
    if (elements.targetInput && saved.inputValue != null) {
      elements.targetInput.value = String(saved.inputValue || "");
    }
    if (elements.searchInput && saved.searchValue != null) {
      elements.searchInput.value = String(saved.searchValue || "");
    }

    refreshReportMetrics();
    renderTabs();
    renderSummary(lastReport);
    renderTargetProfile(lastReport);
    renderDetailsPreserveScroll();
    renderCurrentStatusText();
    return true;
  }

  function scheduleAnalysisHistorySave(force = false) {
    if (!lastReport || lastReport.filtering?.running) {
      return;
    }

    if (analysisHistorySaveTimer) {
      window.clearTimeout(analysisHistorySaveTimer);
      analysisHistorySaveTimer = 0;
    }

    if (force) {
      saveAnalysisHistoryNow();
      return;
    }

    analysisHistorySaveTimer = window.setTimeout(saveAnalysisHistoryNow, 600);
  }

  function saveAnalysisHistoryNow() {
    analysisHistorySaveTimer = 0;
    if (!lastReport || lastReport.filtering?.running) {
      return;
    }
    GM_setValue(ANALYSIS_HISTORY_KEY, {
      version: 1,
      savedAt: Date.now(),
      inputValue: String(elements.targetInput?.value || "").trim(),
      searchValue: String(elements.searchInput?.value || ""),
      currentTab,
      tableSortByTab,
      report: lastReport
    });
  }

  function clearAnalysisHistory() {
    GM_deleteValue(ANALYSIS_HISTORY_KEY);
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
          coverUrl: entry.coverUrl || "",
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

  function formatTargetOwners(owners) {
    const selectedIds = isMultiTargetReport() ? new Set(getSelectedTargetSteamIds()) : null;
    const ownerIds = Array.from(new Set((owners || []).map(String).filter(Boolean)))
      .filter(steamid => !selectedIds || selectedIds.has(steamid));
    if (!ownerIds.length) {
      return "";
    }

    const targetNameById = getTargetNameById();
    return ownerIds
      .map(steamid => targetNameById[steamid] || steamid)
      .join(UI_LOCALE === "en" ? ", " : "、");
  }

  function getTargetNameById() {
    const targets = Array.isArray(lastReport?.target?.targets) && lastReport.target.targets.length
      ? lastReport.target.targets
      : [lastReport?.target].filter(Boolean);
    const names = {};
    targets.forEach(target => {
      const steamid64 = String(target?.steamid64 || "");
      if (steamid64) {
        names[steamid64] = getTargetProfileDisplayName(target);
      }
    });
    return names;
  }

  function isMultiTargetReport(report = lastReport) {
    return Array.isArray(report?.target?.targets) && report.target.targets.length > 1;
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
      relativeNew: t("tabs.relativeNew"),
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
