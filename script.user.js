// ==UserScript==
// @name         Steam Family Library Analyzer
// @name:zh-CN   Steam 家庭库分析器
// @namespace    https://tampermonkey.net/
// @version      0.2.0
// @description  Analyze a public Steam account against your current Steam Family shared library for added games, duplicates, and added original value.
// @description:zh-CN 基于当前 Steam 家庭组共享库，分析指定公开 Steam 账户加入后可带来的新增游戏、重复游戏和新增库价值
// @author       iMoonDay
// @homepageURL  https://github.com/iMoonDay/steam-family-fit-analyzer
// @supportURL   https://github.com/iMoonDay/steam-family-fit-analyzer/issues
// @match        https://store.steampowered.com/*
// @match        https://steamcommunity.com/profiles/*
// @match        https://steamcommunity.com/id/*
// @icon         https://store.steampowered.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @connect      api.steampowered.com
// @connect      api.isthereanydeal.com
// @connect      partner.steam-api.com
// @connect      steamcommunity.com
// @connect      store.steampowered.com
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ===== 可按需修改的脚本参数 =====
  // 改完下面这组常量后保存脚本即可生效；如果不确定含义，优先保持默认值。

  // 无法从 Steam 页面识别商店地区时使用的兜底地区代码，例如 CN / US / JP。
  const FALLBACK_STORE_CC = "CN";
  // 无法从 Steam 页面识别商店语言时使用的兜底语言代码，例如 schinese / english / japanese。
  const FALLBACK_STORE_LANG = "schinese";
  // 脚本界面语言；auto 会根据当前 Steam 页面语言在中文和英文之间自动选择。
  const APP_LOCALE = "auto";
  // 本地存储键名；只有在你想主动清空旧缓存、与旧版本隔离时才需要修改。
  const STORAGE_KEY = "steam_family_fit_analyzer_state_v1";
  // 商店条目缓存有效期，单位毫秒；默认 7 天。
  const STORE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  // 当前价缓存有效期，单位毫秒；默认 1 天。
  const CURRENT_PRICE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const STORE_CACHE_BUCKETS_KEY = "__buckets";
  // 原价读取每批 App 的数量；调大可减少请求轮次，调小可降低单批压力。
  const ORIGINAL_PRICE_BATCH_SIZE = 200;
  const ITAD_PRICE_BATCH_SIZE = 200;
  const ITAD_API_BASE_URL = "https://api.isthereanydeal.com";
  const ITAD_API_PAGE_URL = "https://isthereanydeal.com/apps/";
  const ITAD_STEAM_SHOP_ID = 61;
  const PRICE_MODE_ORIGINAL = "original";
  const PRICE_MODE_CURRENT = "current";
  const PRICE_MODE_HISTORY_LOW = "historyLow";
  const PRICE_SOURCE_ORIGINAL = "original";
  const PRICE_SOURCE_CURRENT = "current";
  const PRICE_SOURCE_ITAD_STORE_LOW = "itadStoreLow";
  // 家庭共享支持性检测每批 App 的数量；调大可更快，调小可更稳。
  const SHAREABILITY_BATCH_SIZE = 150;
  // 家庭封面图导出时每行显示的卡片数量；调大更密，调小更疏。
  const FAMILY_POSTER_COLUMNS = 10;
  const COVER_RELOAD_BATCH_SIZE = 24;
  // 商店请求之间的间隔，单位毫秒；调大更稳，调小更快但更容易撞限流。
  const STORE_REQUEST_DELAY_MS = 15;
  // 搜索输入停止后再刷新表格的延迟，单位毫秒；用于避免大列表逐字重绘卡顿。
  const SEARCH_RENDER_DEBOUNCE_MS = 220;
  // 自动后台刷新家庭库的间隔，单位毫秒；默认 24 小时。
  const AUTO_FAMILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  // 最近一次分析结果缓存键名。
  const ANALYSIS_HISTORY_KEY = `${STORAGE_KEY}_analysis_v1`;
  // 分析输入历史缓存键名；只保存输入值与账号名称缓存，不保存分析结果。
  const ANALYSIS_INPUT_HISTORY_KEY = `${STORAGE_KEY}_analysis_history_v2`;
  const MAX_ANALYSIS_HISTORY_ITEMS = 12;
  // Steam 商店分类中“家庭共享”特性的分类 ID。
  const FAMILY_SHARING_CATEGORY_ID = 62;
  // 普通用户 SteamID64 = 该基数 + Steam 好友码 / 账号 ID（accountid）。
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
  const TAG_TONE_COUNT = 20;
  const REPORT_LIST_TABS = Object.freeze(["all", "new", "relativeNew", "overlap"]);
  const STEAM_LANGUAGE_ALIASES = parseI18nEntries("english=english|en=english|en-us=english|en-gb=english|schinese=schinese|zh-cn=schinese|zh-hans=schinese|tchinese=tchinese|zh-tw=tchinese|zh-hk=tchinese|japanese=japanese|ja=japanese|ja-jp=japanese|koreana=koreana|ko=koreana|ko-kr=koreana|german=german|de=german|de-de=german|french=french|fr=french|fr-fr=french|italian=italian|it=italian|spanish=spanish|es=spanish|es-es=spanish|brazilian=brazilian|pt-br=brazilian|russian=russian|ru=russian");
  const STORE_ITEM_ASSET_BASE_URL = "https://shared.fastly.steamstatic.com/store_item_assets/";
  const FAMILY_POSTER_SORT_MODES = Object.freeze([
    "data",
    "titleAsc",
    "titleDesc",
    "appidAsc",
    "appidDesc",
    "priceDesc",
    "priceAsc",
    "acquiredDesc",
    "acquiredAsc",
    "ownerCountDesc",
    "ownerCountAsc",
    "hasCoverFirst",
    "noCoverFirst"
  ]);
  const LIST_POSTER_BASE_SORT_MODES = Object.freeze([
    "current",
    "titleAsc",
    "titleDesc",
    "appidAsc",
    "appidDesc"
  ]);
  const FAMILY_POSTER_WIDTH = 2000;
  const FAMILY_POSTER_PADDING = 32;
  const FAMILY_POSTER_GAP = 12;
  const FAMILY_POSTER_CARD_WIDTH = 180;
  const FAMILY_POSTER_CARD_ASPECT_RATIO = 1.5;
  const FAMILY_POSTER_HEADER_HEIGHT = 120;
  const FAMILY_POSTER_MAX_HEIGHT = 30000;
  const FAMILY_POSTER_IMAGE_CONCURRENCY = 8;

  const DETECTED_STORE_LANG = getDetectedStoreLanguage();
  const INITIAL_STORE_CC = getDetectedStoreCountryFromPage();
  let STORE_CC = INITIAL_STORE_CC || FALLBACK_STORE_CC;
  let appLocaleMode = getSavedAppLocaleMode();
  let STORE_LANG = getStoreLanguageForAppLocale(appLocaleMode);
  let STORE_CACHE_CONTEXT = getStoreCacheContext();
  let UI_LOCALE = resolveUiLocale(appLocaleMode, STORE_LANG);

  // ===== 本地化与商店上下文 =====

  const I18N = Object.freeze({
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
      analysisHistory: "分析历史",
      deleteHistory: "删除历史记录",
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
      originalName: "原名",
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
      openLinksInClientOn: "调用客户端：开",
      openLinksInClientOff: "调用客户端：关",
      openLinksInClientEnabled: "已启用 Steam 客户端打开链接",
      openLinksInClientDisabled: "已改为浏览器打开链接",
      priceSettings: "价格配置",
      priceSettingsTitle: "价格配置",
      priceSettingsHint: "选择本次统计、排序、复制和展示使用的价格口径。",
      priceMode: "价格口径",
      priceModeOriginal: "原价",
      priceModeCurrent: "当前价",
      priceModeHistoryLow: "史低",
      originalPrice: "原价",
      currentPrice: "当前价",
      historyLowPrice: "史低",
      itadApiKey: "IsThereAnyDeal API Key",
      itadApiKeyPlaceholder: "填入 ITAD API Key 后史低生效",
      itadApiHelp: "获取步骤：1. 打开 IsThereAnyDeal 并登录；2. 进入 Apps / My apps；3. 创建应用；4. 复制 API Key 填入这里。点击打开获取页面。",
      priceSettingsSave: "保存",
      priceSettingsSaved: "价格配置已保存",
      historyLowNeedsApiKey: "史低需要先填写 IsThereAnyDeal API Key",
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
      globalCompare: "全局对比",
      globalCompareTitle: "全局贡献对比",
      globalCompareHint: "统计目标账号和家庭库成员在当前数据中的游戏贡献量。",
      globalCompareAccounts: "{count} 个账号",
      globalCompareGames: "{count} 款游戏",
      globalCompareTotal: "总贡献",
      globalCompareYAxis: "游戏贡献量",
      globalCompareSingle: "单独贡献",
      globalCompareShared: "{count} 人共同贡献",
      globalCompareNoData: "暂无全局对比数据",
      globalCompareFilterAll: "全部",
      globalCompareFilterTargets: "目标账号",
      globalCompareFilterFamily: "家庭成员",
      globalCompareDetailTitle: "{account} · {bucket}",
      globalCompareDetailCount: "{count} 款游戏",
      globalCompareDetailHint: "点击色块查看贡献详情",
      globalCompareDetailEmpty: "该分组暂无游戏",
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
      copyGames: "复制游戏",
      copiedGames: "已复制游戏",
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
      loading: "加载中",
      viewMode: "视图",
      viewTable: "表格",
      viewCover: "网格",
      viewPoster: "海报",
      sort: "排序",
      sortName: "名称",
      sortId: "ID",
      sortAsc: "{label} ↑",
      sortDesc: "{label} ↓",
      reloadCovers: "重载封面",
      coversReloaded: "已重载封面",
      continueCovers: "继续加载封面...",
      saveListPoster: "保存游戏海报",
      saveFamilyPoster: "保存家庭封面图",
      familyPosterTitle: "家庭封面图设置",
      familyPosterHint: "调整列数、排序和缩放后再生成导出图片。",
      listPosterTitle: "游戏海报设置",
      listPosterHint: "导出当前「{tab}」列表的游戏海报；默认排序会沿用当前列表顺序。",
      familyPosterColumns: "每行列数",
      familyPosterSort: "排序方式",
      familyPosterScale: "尺寸缩放",
      familyPosterCancel: "取消",
      familyPosterConfirm: "生成图片",
      familyPosterScaleValue: "{value}%",
      listPosterOrderCurrent: "默认（当前列表排序）",
      familyPosterOrderData: "默认（数据顺序）",
      familyPosterOrderTitleAsc: "名称升序",
      familyPosterOrderTitleDesc: "名称降序",
      familyPosterOrderAppidAsc: "AppID 升序",
      familyPosterOrderAppidDesc: "AppID 降序",
      familyPosterOrderPriceDesc: "价格降序",
      familyPosterOrderPriceAsc: "价格升序",
      familyPosterOrderAcquiredDesc: "入库时间降序",
      familyPosterOrderAcquiredAsc: "入库时间升序",
      familyPosterOrderOwnersAsc: "拥有者升序",
      familyPosterOrderOwnersDesc: "拥有者降序",
      familyPosterOrderTargetOwnersAsc: "目标拥有者升序",
      familyPosterOrderTargetOwnersDesc: "目标拥有者降序",
      familyPosterOrderStatusAsc: "状态升序",
      familyPosterOrderStatusDesc: "状态降序",
      familyPosterOrderOwnerCountDesc: "贡献者数量降序",
      familyPosterOrderOwnerCountAsc: "贡献者数量升序",
      familyPosterOrderHasCoverFirst: "有封面优先",
      familyPosterOrderNoCoverFirst: "无封面优先",
      preparingFamilyPoster: "正在整理家庭封面...",
      fetchingFamilyPoster: "正在获取家庭封面 {current}/{total}...",
      renderingFamilyPoster: "正在生成家庭封面图...",
      familyPosterSaved: "家庭封面图已保存",
      familyPosterEmpty: "没有可导出的家庭封面",
      familyPosterTooLarge: "家庭封面图过高，当前尺寸超出浏览器导出上限",
      preparingListPoster: "正在整理游戏海报...",
      fetchingListPoster: "正在获取游戏海报封面 {current}/{total}...",
      renderingListPoster: "正在生成游戏海报...",
      listPosterSaved: "游戏海报已保存",
      listPosterEmpty: "当前列表没有可导出的游戏海报",
      listPosterTooLarge: "游戏海报过高，当前尺寸超出浏览器导出上限"
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
      analysisHistory: "Analysis history",
      deleteHistory: "Delete history item",
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
      originalName: "Original name",
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
      openLinksInClientOn: "Open in client: on",
      openLinksInClientOff: "Open in client: off",
      openLinksInClientEnabled: "Steam client links enabled",
      openLinksInClientDisabled: "Browser links enabled",
      priceSettings: "Price settings",
      priceSettingsTitle: "Price settings",
      priceSettingsHint: "Choose the price basis used for statistics, sorting, copying, and display.",
      priceMode: "Price basis",
      priceModeOriginal: "Original",
      priceModeCurrent: "Current",
      priceModeHistoryLow: "Historical low",
      originalPrice: "Original price",
      currentPrice: "Current price",
      historyLowPrice: "Historical low",
      itadApiKey: "IsThereAnyDeal API Key",
      itadApiKeyPlaceholder: "Enter an ITAD API key to enable historical lows",
      itadApiHelp: "Steps: 1. Open IsThereAnyDeal and sign in; 2. Go to Apps / My apps; 3. Create an app; 4. Copy the API key here. Click to open the page.",
      priceSettingsSave: "Save",
      priceSettingsSaved: "Price settings saved",
      historyLowNeedsApiKey: "Historical lows require an IsThereAnyDeal API key",
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
      globalCompare: "Global",
      globalCompareTitle: "Global contribution comparison",
      globalCompareHint: "Counts game contributions across target accounts and family members.",
      globalCompareAccounts: "{count} accounts",
      globalCompareGames: "{count} games",
      globalCompareTotal: "Total contributions",
      globalCompareYAxis: "Game contributions",
      globalCompareSingle: "Solo contribution",
      globalCompareShared: "{count}-account shared",
      globalCompareNoData: "No global comparison data",
      globalCompareFilterAll: "All",
      globalCompareFilterTargets: "Targets",
      globalCompareFilterFamily: "Family",
      globalCompareDetailTitle: "{account} · {bucket}",
      globalCompareDetailCount: "{count} games",
      globalCompareDetailHint: "Click a segment to inspect games",
      globalCompareDetailEmpty: "No games in this group",
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
      copyGames: "Copy games",
      copiedGames: "Games copied",
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
      loading: "Loading",
      viewMode: "View",
      viewTable: "Table",
      viewCover: "Grid",
      viewPoster: "Poster",
      sort: "Sort",
      sortName: "Name",
      sortId: "ID",
      sortAsc: "{label} ↑",
      sortDesc: "{label} ↓",
      reloadCovers: "Reload covers",
      coversReloaded: "Cover images reloaded",
      continueCovers: "Continuing cover loading...",
      saveListPoster: "Save game poster",
      saveFamilyPoster: "Save family poster",
      familyPosterTitle: "Family Poster Settings",
      familyPosterHint: "Adjust columns, ordering, and scale before exporting.",
      listPosterTitle: "Game Poster Settings",
      listPosterHint: "Export the current {tab} list as a game poster. Default follows the current list order.",
      familyPosterColumns: "Columns",
      familyPosterSort: "Sort",
      familyPosterScale: "Scale",
      familyPosterCancel: "Cancel",
      familyPosterConfirm: "Generate",
      familyPosterScaleValue: "{value}%",
      listPosterOrderCurrent: "Default (current list order)",
      familyPosterOrderData: "Default (data order)",
      familyPosterOrderTitleAsc: "Title ascending",
      familyPosterOrderTitleDesc: "Title descending",
      familyPosterOrderAppidAsc: "AppID ascending",
      familyPosterOrderAppidDesc: "AppID descending",
      familyPosterOrderPriceDesc: "Price descending",
      familyPosterOrderPriceAsc: "Price ascending",
      familyPosterOrderAcquiredDesc: "Acquired desc",
      familyPosterOrderAcquiredAsc: "Acquired asc",
      familyPosterOrderOwnersAsc: "Owners ascending",
      familyPosterOrderOwnersDesc: "Owners descending",
      familyPosterOrderTargetOwnersAsc: "Target owners ascending",
      familyPosterOrderTargetOwnersDesc: "Target owners descending",
      familyPosterOrderStatusAsc: "Status ascending",
      familyPosterOrderStatusDesc: "Status descending",
      familyPosterOrderOwnerCountDesc: "Owner count desc",
      familyPosterOrderOwnerCountAsc: "Owner count asc",
      familyPosterOrderHasCoverFirst: "Has cover first",
      familyPosterOrderNoCoverFirst: "No cover first",
      preparingFamilyPoster: "Preparing family covers...",
      fetchingFamilyPoster: "Fetching family covers {current}/{total}...",
      renderingFamilyPoster: "Rendering family poster...",
      familyPosterSaved: "Family cover poster saved",
      familyPosterEmpty: "No family covers available to export",
      familyPosterTooLarge: "Family cover poster is too tall to export in one image",
      preparingListPoster: "Preparing game poster...",
      fetchingListPoster: "Fetching game poster covers {current}/{total}...",
      renderingListPoster: "Rendering game poster...",
      listPosterSaved: "Game poster saved",
      listPosterEmpty: "No games in the current poster",
      listPosterTooLarge: "Game poster is too tall to export in one image"
    }
  });

  function parseI18nEntries(rawEntries) {
    const localeMap = {};
    String(rawEntries || "").split("|").filter(Boolean).forEach(entry => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        throw new Error(`本地化条目格式无效：${entry}`);
      }
      assignI18nValue(localeMap, entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1));
    });
    return localeMap;
  }

  function assignI18nValue(target, path, value) {
    const parts = String(path || "").split(".").filter(Boolean);
    if (!parts.length) {
      throw new Error("本地化键不能为空");
    }
    let cursor = target;
    parts.slice(0, -1).forEach(part => {
      cursor[part] = cursor[part] && typeof cursor[part] === "object" ? cursor[part] : {};
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  }

  const STORE_CC_TO_LOCALE = parseI18nEntries("US=en-US|GB=en-GB|AU=en-AU|CA=en-CA|MX=es-MX|JP=ja-JP|KR=ko-KR|CN=zh-CN|TW=zh-TW|HK=zh-HK|SG=en-SG|NZ=en-NZ|DE=de-DE|FR=fr-FR|IT=it-IT|ES=es-ES|NL=nl-NL|BE=nl-BE|AT=de-AT|FI=fi-FI|IE=en-IE|PT=pt-PT|GR=el-GR|BR=pt-BR|RU=ru-RU|TR=tr-TR|IN=en-IN|ZA=en-ZA|PL=pl-PL|NO=nb-NO|SE=sv-SE|DK=da-DK|CH=de-CH|CL=es-CL|CO=es-CO|PE=es-PE|PH=en-PH|ID=id-ID|MY=ms-MY|TH=th-TH|VN=vi-VN|UA=uk-UA|AR=es-AR|SA=ar-SA|AE=ar-AE|IL=he-IL|KZ=kk-KZ|UY=es-UY|CR=es-CR|KW=ar-KW|QA=ar-QA|EU=en-IE");
  const STORE_CC_TO_CURRENCY = parseI18nEntries("US=USD|CA=CAD|MX=MXN|BR=BRL|GB=GBP|EU=EUR|DE=EUR|FR=EUR|IT=EUR|ES=EUR|NL=EUR|BE=EUR|AT=EUR|FI=EUR|IE=EUR|PT=EUR|GR=EUR|JP=JPY|KR=KRW|CN=CNY|TW=TWD|HK=HKD|SG=SGD|AU=AUD|NZ=NZD|RU=RUB|TR=TRY|IN=INR|ZA=ZAR|PL=PLN|NO=NOK|SE=SEK|DK=DKK|CH=CHF|CL=CLP|CO=COP|PE=PEN|PH=PHP|ID=IDR|MY=MYR|TH=THB|VN=VND|UA=UAH|AR=ARS|SA=SAR|AE=AED|IL=ILS|KZ=KZT|UY=UYU|CR=CRC|KW=KWD|QA=QAR");

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

  function getStoreLanguageForAppLocale(mode) {
    const normalizedMode = normalizeAppLocaleMode(mode);
    if (normalizedMode === "zh-CN") {
      return "schinese";
    }
    if (normalizedMode === "en") {
      return "english";
    }
    return DETECTED_STORE_LANG || FALLBACK_STORE_LANG;
  }

  function normalizePriceMode(mode) {
    return [PRICE_MODE_ORIGINAL, PRICE_MODE_CURRENT, PRICE_MODE_HISTORY_LOW].includes(mode) ? mode : PRICE_MODE_ORIGINAL;
  }

  function normalizePriceConfig(config = {}) {
    return {
      mode: normalizePriceMode(config.mode),
      itadApiKey: String(config.itadApiKey || "").trim()
    };
  }

  function getPriceMode() {
    return normalizePriceMode(state.priceConfig?.mode);
  }

  function isHistoryLowPriceMode() {
    return getPriceMode() === PRICE_MODE_HISTORY_LOW;
  }

  function isCurrentPriceMode() {
    return getPriceMode() === PRICE_MODE_CURRENT;
  }

  function getItadApiKey() {
    return String(state.priceConfig?.itadApiKey || "").trim();
  }

  function getPriceLabel() {
    if (isHistoryLowPriceMode()) {
      return t("historyLowPrice");
    }
    return isCurrentPriceMode() ? t("currentPrice") : t("originalPrice");
  }

  function getAddedValueLabel() {
    const priceLabel = getPriceLabel();
    return UI_LOCALE === "en"
      ? `${t("addedValue")} (${priceLabel})`
      : `${t("addedValue")}（${priceLabel}）`;
  }

  function getPriceCacheKeyForMode(mode = getPriceMode()) {
    const normalizedMode = normalizePriceMode(mode);
    return normalizedMode === PRICE_MODE_HISTORY_LOW
      ? PRICE_MODE_HISTORY_LOW
      : normalizedMode === PRICE_MODE_CURRENT
        ? PRICE_MODE_CURRENT
        : PRICE_MODE_ORIGINAL;
  }

  function getPriceCacheKeyForPrice(price) {
    const source = price?.source || PRICE_SOURCE_ORIGINAL;
    if (source === PRICE_SOURCE_ITAD_STORE_LOW) {
      return PRICE_MODE_HISTORY_LOW;
    }
    return source === PRICE_SOURCE_CURRENT ? PRICE_MODE_CURRENT : PRICE_MODE_ORIGINAL;
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
    return STEAM_LANGUAGE_ALIASES[normalized] || "";
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

  function setStoreLanguage(language) {
    const normalized = normalizeSteamLanguage(language) || FALLBACK_STORE_LANG;
    if (!normalized || normalized === STORE_LANG) {
      return false;
    }
    STORE_LANG = normalized;
    STORE_CACHE_CONTEXT = getStoreCacheContext();
    return true;
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
      // 如果无法从商店页面读取账号地区，则保留兜底地区配置。
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

  // ===== 应用状态与启动流程 =====

  const DEFAULT_STATE = Object.freeze({
    version: 1,
    activeSteamId: "",
    launcherVisible: true,
    listViewMode: "table",
    familyPosterSettings: {
      columns: FAMILY_POSTER_COLUMNS,
      sortMode: "data",
      scalePercent: 100
    },
    listPosterSettings: {
      columns: FAMILY_POSTER_COLUMNS,
      scalePercent: 100
    },
    familyInfo: null,
    familyLibrary: {
      appidSet: [],
      appInfoById: {},
      updatedAt: 0
    },
    storeCache: {},
    autoFamilyRefreshEnabled: true,
    openLinksInSteamClient: false,
    lastAutoFamilyRefreshAttemptAt: 0,
    appLocaleMode: APP_LOCALE,
    priceConfig: {
      mode: PRICE_MODE_ORIGINAL,
      itadApiKey: ""
    },
    apiKey: ""
  });

  let state = cloneDefaultState();
  let currentTab = "all";
  let tableSortByTab = {};
  let lastReport = null;
  let lastRawData = createRawDataSnapshot("init");
  let storeRequestQueue = Promise.resolve();
  let priceLoadState = createPriceLoadState();
  let coverLoadState = createCoverLoadState();
  let coverProbeState = createCoverProbeState();
  let activeAnalysisId = 0;
  let shareabilityFilterState = createShareabilityFilterState();
  let shareabilityProgressUiState = createShareabilityProgressUiState();
  let rateLimitState = createRateLimitState();
  let comparePriceRangeByTarget = {};
  let globalCompareFilter = "all";
  let globalCompareDrilldown = null;
  let analysisHistorySaveTimer = 0;
  let analysisInputHistoryCache = null;
  let searchRenderTimer = 0;
  let scriptMenuCommandIds = [];
  let activePosterDialogContext = null;
  let autoFamilyRefreshRunning = false;
  let coverReloadToken = 0;
  let familyOwnerToneCache = { key: "", map: new Map() };
  let targetOwnerToneCache = { key: "", map: new Map() };
  let elements = {};
  let activeTooltipTarget = null;
  let tooltipHideTimer = 0;
  let tooltipMoveFrame = 0;
  let tooltipRestoreTimer = 0;
  let pendingTooltipEvent = null;
  let lastTooltipPointer = null;
  let tooltipSizeCache = { width: 0, height: 0 };
  let panelFrontObserver = null;

  bootstrap();

  async function bootstrap() {
    await resolveStoreCountryFromAccount();
    initializeRuntime();
    const restoredAnalysis = restoreAnalysisHistory();
    autoFillTargetInputFromProfilePage();
    const session = getSteamSession();
    if (!syncBootstrapSession(session, restoredAnalysis)) {
      return;
    }
    finalizeBootstrap(session);
  }

  function initializeRuntime() {
    state = loadState();
    injectStyles();
    mountPanel();
  }

  function syncBootstrapSession(session, restoredAnalysis) {
    if (!session.isLoggedIn) {
      setStatus(t("signInFirst"), "warn");
      setBusy(false);
      return false;
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
    return true;
  }

  function finalizeBootstrap(session) {
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
        z-index: 2147483647 !important;
        isolation: isolate;
        pointer-events: none;
        color: #dbe8f3;
        font-family: Motiva Sans, Arial, Helvetica, sans-serif;
      }
      #sffa-root, #sffa-root * {
        box-sizing: border-box;
      }
      html.sffa-page-scroll-locked,
      body.sffa-page-scroll-locked {
        overflow: hidden !important;
        overscroll-behavior: none !important;
        scrollbar-width: none !important;
      }
      html.sffa-page-scroll-locked::-webkit-scrollbar,
      body.sffa-page-scroll-locked::-webkit-scrollbar {
        width: 0 !important;
        height: 0 !important;
        display: none !important;
      }
      .sffa-tooltip {
        position: fixed;
        left: 0;
        top: 0;
        --sffa-tooltip-arrow-left: 50%;
        max-width: min(340px, calc(100vw - 24px));
        padding: 8px 10px;
        border: 1px solid rgba(102, 192, 244, 0.38);
        border-radius: 4px;
        background: rgba(15, 20, 27, 0.97);
        color: #edf6ff;
        font-size: 12px;
        font-weight: 500;
        line-height: 1.45;
        white-space: pre-line;
        overflow-wrap: anywhere;
        box-shadow: none;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translate3d(0, 2px, 0);
        transition: opacity 0.08s ease, transform 0.08s ease, visibility 0.08s ease;
        z-index: 2147483647;
      }
      .sffa-tooltip::after {
        content: "";
        position: absolute;
        left: var(--sffa-tooltip-arrow-left);
        width: 8px;
        height: 8px;
        background: rgba(15, 20, 27, 0.97);
        border: solid rgba(102, 192, 244, 0.38);
        transform: translateX(-50%) rotate(45deg);
      }
      .sffa-tooltip:not(.is-above):not(.is-below)::after {
        display: none;
      }
      .sffa-tooltip.is-above::after {
        bottom: -5px;
        border-width: 0 1px 1px 0;
      }
      .sffa-tooltip.is-below::after {
        top: -5px;
        border-width: 1px 0 0 1px;
      }
      .sffa-tooltip.is-visible {
        opacity: 1;
        visibility: visible;
        transform: translate3d(0, 0, 0);
      }
      .sffa-tooltip.is-pairs {
        min-width: 168px;
        white-space: normal;
      }
      .sffa-tooltip-pairs {
        display: grid;
        gap: 4px;
      }
      .sffa-tooltip-pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 18px;
        align-items: baseline;
      }
      .sffa-tooltip-pair-key {
        min-width: 0;
        overflow-wrap: anywhere;
        color: #c8d8e5;
        text-align: left;
      }
      .sffa-tooltip-pair-value {
        color: #ffffff;
        font-weight: 600;
        text-align: right;
        white-space: nowrap;
      }
      .sffa-launcher-wrap {
        position: fixed;
        right: 18px;
        bottom: 18px;
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transform: translateY(0) scale(1);
        transition: transform 0.16s ease, opacity 0.16s ease, visibility 0.16s ease;
      }
      .sffa-launcher-wrap:hover {
        transform: translateY(-2px) scale(1.02);
      }
      .sffa-launcher-wrap.is-hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .sffa-launcher-wrap.is-hidden:hover {
        transform: translateY(0) scale(0.92);
      }
      .sffa-launcher {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        min-height: 0;
        padding: 0;
        border: 1px solid rgba(220, 222, 223, 0.28);
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.18);
        color: #dcdedf;
        cursor: pointer;
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
        backdrop-filter: blur(5px);
        font: inherit;
        font-size: 0;
        line-height: 1;
        writing-mode: horizontal-tb;
        letter-spacing: 0;
        position: relative;
        transition: filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
      }
      .sffa-launcher svg {
        display: block;
        width: 16px;
        height: 16px;
        flex: 0 0 auto;
        transform: translateY(1px);
      }
      .sffa-launcher span {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .sffa-launcher-close {
        position: absolute;
        right: -12px;
        top: -12px;
        width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #d7e8f4;
        font: inherit;
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        z-index: 1;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
        transition: color 0.12s ease, opacity 0.12s ease, visibility 0.12s ease;
      }
      .sffa-launcher-wrap:hover .sffa-launcher-close {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .sffa-launcher-close:hover {
        color: #6f7f8c;
      }
      .sffa-launcher-wrap:hover .sffa-launcher,
      .sffa-launcher:hover {
        background: rgba(255, 255, 255, 0.92);
        color: #1b2838;
        filter: none;
        border-color: rgba(255, 255, 255, 0.86);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.34);
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
        inset: 0;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        transform: none;
        opacity: 0;
        visibility: hidden;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 0;
        border-radius: 0;
        background: #171a21;
        box-shadow: none;
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
        transform: none;
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
      .sffa-tab:hover:not(:disabled) {
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
      .sffa-menu-item.is-active {
        background: rgba(102, 192, 244, 0.2);
        color: #ffffff;
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
        grid-template-rows: auto minmax(0, 1fr);
        gap: 8px;
        overflow: hidden;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 4px;
        background: rgba(17, 22, 29, 0.82);
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
      .sffa-control-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
      }
      .sffa-control-primary {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(360px, 1fr) minmax(220px, 0.72fr);
        gap: 8px;
        align-items: center;
      }
      .sffa-control-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
        white-space: nowrap;
      }
      .sffa-control-status {
        min-width: 0;
        display: flex;
        justify-content: stretch;
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
      .sffa-history-wrap {
        flex: 1 1 320px;
        min-width: 0;
      }
      .sffa-row > .sffa-list-wrap.sffa-history-wrap {
        flex: 1 1 320px;
        min-width: 0;
      }
      .sffa-control-row > .sffa-list-wrap.sffa-history-wrap {
        flex: none;
      }
      .sffa-history-wrap .sffa-input {
        width: 100%;
      }
      .sffa-history-wrap .sffa-list-menu {
        top: 42px;
        width: 100%;
        max-height: 260px;
        overflow: auto;
        z-index: 5;
      }
      .sffa-history-wrap .sffa-list-option {
        min-height: 44px;
        padding: 6px 10px;
      }
      .sffa-history-option {
        position: relative;
      }
      .sffa-history-option .sffa-list-option {
        width: 100%;
        min-width: 0;
        padding-right: 40px;
      }
      .sffa-history-option:hover .sffa-list-option {
        background: rgba(102, 192, 244, 0.14);
      }
      .sffa-history-option-main {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #f2f7fb;
      }
      .sffa-history-option-sub {
        display: block;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #8fa6b8;
        font-size: 11px;
      }
      .sffa-history-delete {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        width: 30px;
        min-height: 30px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 3px;
        background: transparent;
        color: #8fa6b8;
        cursor: pointer;
      }
      .sffa-history-delete:hover {
        color: #ffb6c2;
        background: rgba(255, 128, 151, 0.12);
      }
      .sffa-history-delete svg {
        width: 14px;
        height: 14px;
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
      .sffa-close:hover:not(:disabled) {
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
        justify-content: flex-end;
        gap: 6px;
        min-width: 0;
        width: 100%;
      }
      .sffa-status-row .sffa-status {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        background: transparent;
        border: 0;
      }
      .sffa-metric[title],
      .sffa-metric[data-sffa-tooltip] {
        cursor: help;
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
        padding: 0;
        border: 0;
        border-radius: 3px;
        background: transparent;
        overflow: auto;
      }
      .sffa-profile-topbar {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        min-height: 34px;
        padding: 8px 10px;
        min-width: 0;
        border-bottom: 0;
        background: transparent;
      }
      .sffa-profile-topbar span {
        min-width: 0;
        color: #9fb3c2;
        font-size: 12px;
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sffa-profile-topbar-actions {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
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
      .sffa-account-list {
        display: grid;
        gap: 0;
      }
      .sffa-target-row {
        display: grid;
        grid-template-columns: 18px 36px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        padding: 9px 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        font-size: 12px;
      }
      .sffa-account-list .sffa-target-row:first-child {
        border-top: 0;
      }
      .sffa-target-row input {
        margin: 0;
      }
      .sffa-target-row input:disabled {
        opacity: 0.68;
      }
      .sffa-profile-avatar-link,
      .sffa-profile-avatar-static {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border-radius: 3px;
        overflow: hidden;
        background: #223344;
        color: #dbe8f3;
        font-size: 13px;
        font-weight: 700;
        text-decoration: none;
      }
      .sffa-profile-avatar-link:hover {
        filter: brightness(1.12);
      }
      .sffa-profile-avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .sffa-profile-account-text {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .sffa-profile-account-name {
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sffa-profile-account-id {
        color: #d8e4ee;
        font-size: 11px;
        line-height: 1.25;
        opacity: 0.78;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sffa-compare-btn {
        min-width: 42px;
        min-height: 24px;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        padding: 3px 9px;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 3px;
        background: linear-gradient(180deg, #2a475e 0%, #1f3242 100%);
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.2;
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
        z-index: 30;
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
        width: min(calc(var(--sffa-compare-columns, 1) * 328px + 24px), calc(100vw - 28px));
        min-width: min(348px, calc(100vw - 28px));
        max-width: calc(100vw - 28px);
        max-height: calc(100vh - 28px);
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
        grid-template-columns: repeat(var(--sffa-compare-columns, 1), minmax(252px, 320px));
        gap: 8px;
        align-content: start;
        justify-content: start;
        padding: 10px 12px 12px;
        min-height: 0;
        flex: 0 1 auto;
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
      .sffa-compare-price-range:disabled {
        cursor: default;
        opacity: 0.78;
      }
      .sffa-compare-price-range:disabled:hover {
        transform: none;
        background: #1a2230;
        border-color: rgba(255, 255, 255, 0.06);
        box-shadow: none;
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
      .sffa-global-compare-shell {
        width: min(920px, calc(100vw - 28px));
        max-height: calc(100vh - 28px);
        overflow: hidden;
      }
      .sffa-global-compare-body {
        display: grid;
        gap: 12px;
        min-height: 0;
        max-height: calc(100vh - 100px);
        padding: 14px;
        overflow: auto;
      }
      .sffa-global-overview {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #b8c7d3;
        font-size: 12px;
        line-height: 1.3;
      }
      .sffa-global-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .sffa-global-filter {
        display: inline-grid;
        grid-template-columns: repeat(3, minmax(0, auto));
        gap: 4px;
        padding: 4px;
        border: 1px solid rgba(102, 192, 244, 0.22);
        border-radius: 999px;
        background: #0f141b;
      }
      .sffa-global-filter-btn {
        min-height: 28px;
        padding: 0 10px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #b8c7d3;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
      }
      .sffa-global-filter-btn.is-active {
        background: #66c0f4;
        color: #071018;
        font-weight: 700;
      }
      .sffa-global-legend {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px 12px;
      }
      .sffa-global-legend-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      .sffa-global-legend-swatch {
        width: 18px;
        height: 8px;
        border-radius: 999px;
        background: var(--sffa-legend-color);
      }
      .sffa-global-chart {
        min-width: 0;
        flex: 1 1 100%;
        max-width: 100%;
        overflow: auto hidden;
        padding-bottom: 2px;
        transform-origin: left center;
        transition: flex-basis 0.42s cubic-bezier(0.2, 0.82, 0.2, 1), max-width 0.42s cubic-bezier(0.2, 0.82, 0.2, 1), transform 0.42s cubic-bezier(0.2, 0.82, 0.2, 1), opacity 0.22s ease;
      }
      .sffa-global-content {
        min-height: 0;
        display: flex;
        gap: 0;
        align-items: stretch;
        overflow: hidden;
        transition: gap 0.42s cubic-bezier(0.2, 0.82, 0.2, 1);
      }
      .sffa-global-content.has-detail {
        gap: 12px;
      }
      .sffa-global-content.has-detail .sffa-global-chart {
        flex-basis: calc(50% - 6px);
        max-width: calc(50% - 6px);
        transform: scaleX(0.985);
      }
      .sffa-global-chart-grid {
        position: relative;
        min-width: max(100%, calc(var(--sffa-global-account-count, 1) * 78px + 50px));
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr);
        gap: 10px;
        min-height: 330px;
      }
      .sffa-global-content.has-detail .sffa-global-chart-grid {
        min-width: max(100%, calc(var(--sffa-global-account-count, 1) * 56px + 44px));
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 8px;
      }
      .sffa-global-y-axis {
        position: relative;
        height: 260px;
        margin-top: 8px;
        color: #718494;
        font-size: 11px;
      }
      .sffa-global-y-tick {
        position: absolute;
        right: 0;
        transform: translateY(-50%);
        line-height: 1;
      }
      .sffa-global-plot {
        position: relative;
        min-width: 0;
        height: 300px;
        display: grid;
        align-items: end;
        padding: 8px 0 32px;
        background:
          linear-gradient(to top, rgba(255, 255, 255, 0.065) 1px, transparent 1px) 0 8px / 100% 65px repeat-y,
          linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01));
        border-left: 1px solid rgba(255, 255, 255, 0.06);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .sffa-global-bars {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: repeat(var(--sffa-global-account-count, 1), minmax(58px, 1fr));
        gap: 8px;
        align-items: end;
        height: 260px;
        padding: 0 10px;
      }
      .sffa-global-content.has-detail .sffa-global-bars {
        grid-template-columns: repeat(var(--sffa-global-account-count, 1), minmax(44px, 1fr));
        gap: 6px;
        padding: 0 7px;
      }
      .sffa-global-bar-wrap {
        min-width: 0;
        height: 100%;
        display: grid;
        grid-template-rows: minmax(0, 1fr) 28px;
        gap: 8px;
        align-items: end;
      }
      .sffa-global-bar-shell {
        width: min(100%, 48px);
        height: 100%;
        justify-self: center;
        display: flex;
        align-items: end;
      }
      .sffa-global-content.has-detail .sffa-global-bar-shell {
        width: min(100%, 36px);
      }
      .sffa-global-bar {
        width: 100%;
        height: var(--sffa-global-bar-height);
        min-height: 2px;
        display: flex;
        flex-direction: column-reverse;
        overflow: hidden;
        border-radius: 3px 3px 0 0;
        background: rgba(255, 255, 255, 0.04);
      }
      .sffa-global-segment {
        flex: 0 0 var(--sffa-global-segment-height);
        min-height: 0;
        border: 0;
        padding: 0;
        background: var(--sffa-global-segment-color);
        cursor: pointer;
      }
      .sffa-global-segment:hover,
      .sffa-global-segment.is-active {
        filter: brightness(1.18);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
      }
      .sffa-global-segment + .sffa-global-segment {
        border-bottom: 1px solid rgba(12, 18, 24, 0.72);
      }
      .sffa-global-x-label {
        min-width: 0;
        color: #9fb3c2;
        font-size: 11px;
        line-height: 1.2;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sffa-global-empty {
        padding: 24px;
        color: #9fb3c2;
        font-size: 13px;
        text-align: center;
      }
      .sffa-global-detail {
        display: grid;
        flex: 0 0 0;
        max-width: 0;
        height: 330px;
        min-height: 0;
        box-sizing: border-box;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 8px;
        padding: 10px 0;
        border: 1px solid transparent;
        border-radius: 3px;
        background: #11161d;
        opacity: 0;
        transform: translateX(18px) scale(0.985);
        overflow: hidden;
        transition: flex-basis 0.42s cubic-bezier(0.2, 0.82, 0.2, 1), max-width 0.42s cubic-bezier(0.2, 0.82, 0.2, 1), padding 0.42s cubic-bezier(0.2, 0.82, 0.2, 1), border-color 0.22s ease, opacity 0.26s ease 0.1s, transform 0.32s cubic-bezier(0.2, 0.82, 0.2, 1) 0.08s;
      }
      .sffa-global-content.has-detail .sffa-global-detail {
        flex-basis: calc(50% - 6px);
        max-width: calc(50% - 6px);
        padding: 10px;
        border-color: rgba(255, 255, 255, 0.06);
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      .sffa-global-detail-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .sffa-global-detail-head strong {
        min-width: 0;
        color: #ffffff;
        font-size: 13px;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sffa-global-detail-head span {
        color: #9fb3c2;
        font-size: 12px;
        white-space: nowrap;
      }
      .sffa-global-detail-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 6px;
        min-height: 0;
        overflow: auto;
      }
      .sffa-global-detail-game {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-items: center;
        padding: 6px 8px;
        border-radius: 3px;
        background: #1a2230;
        color: inherit;
        text-decoration: none;
      }
      .sffa-global-detail-game:hover {
        background: #223044;
        text-decoration: none;
      }
      .sffa-global-detail-game strong {
        display: block;
        width: 100%;
        min-width: 0;
        color: #ffffff;
        font-size: 12px;
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sffa-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 20;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.16s ease, visibility 0.16s ease;
      }
      .sffa-modal-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(8, 12, 18, 0.72);
        backdrop-filter: blur(2px);
      }
      .sffa-modal-shell {
        position: absolute;
        display: grid;
        gap: 0;
        overflow: visible;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 4px;
        background: #121820;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
      }
      .sffa-modal-shell.is-anchor-top-right {
        right: min(28px, 4vw);
        top: 74px;
        width: min(420px, calc(100vw - 24px));
      }
      .sffa-modal-shell.is-center {
        left: 50%;
        top: 50%;
        width: min(460px, calc(100vw - 24px));
        transform: translate(-50%, -50%) scale(0.985);
      }
      .sffa-modal-shell.sffa-global-compare-shell.is-center {
        width: min(920px, calc(100vw - 28px));
        grid-template-rows: auto minmax(0, 1fr);
        max-height: calc(100vh - 28px);
        overflow: hidden;
      }
      #sffa-root.is-price-settings-open .sffa-price-overlay,
      #sffa-root.is-family-poster-open .sffa-family-poster-overlay,
      #sffa-root.is-global-compare-open .sffa-global-compare-overlay {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .sffa-modal-header,
      .sffa-modal-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .sffa-modal-header {
        padding: 12px 14px;
        background: linear-gradient(180deg, #23384a 0%, #17222e 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .sffa-modal-title {
        min-width: 0;
        display: grid;
        gap: 4px;
      }
      .sffa-modal-title strong {
        color: #ffffff;
        font-size: 15px;
        line-height: 1.2;
      }
      .sffa-modal-title span {
        color: #b8c7d3;
        font-size: 12px;
        line-height: 1.35;
      }
      .sffa-modal-close,
      .sffa-price-help {
        display: grid;
        place-items: center;
        border: 0;
        cursor: pointer;
        font: inherit;
      }
      .sffa-modal-close {
        width: 30px;
        height: 30px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
        color: #ffffff;
        font-size: 18px;
      }
      .sffa-modal-close:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .sffa-modal-actions {
        justify-content: flex-end;
        padding: 0 14px 14px;
      }
      .sffa-price-overlay.sffa-modal-overlay .sffa-modal-backdrop {
        background: rgba(8, 12, 18, 0.58);
      }
      .sffa-price-body {
        display: grid;
        gap: 14px;
        padding: 14px;
      }
      .sffa-price-field {
        display: grid;
        gap: 7px;
      }
      .sffa-price-field-label {
        color: #dbe8f3;
        font-size: 12px;
        line-height: 1.3;
      }
      .sffa-price-mode-toggle {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4px;
        padding: 4px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 999px;
        background: #0f141b;
      }
      .sffa-price-mode-btn {
        min-height: 32px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #b8c7d3;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
      }
      .sffa-price-mode-btn.is-active {
        background: #66c0f4;
        color: #071018;
        font-weight: 700;
      }
      .sffa-price-api-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 30px;
        gap: 8px;
        align-items: center;
      }
      .sffa-price-input {
        height: 34px;
        min-width: 0;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 10px;
        outline: none;
        font: inherit;
      }
      .sffa-price-input:focus {
        border-color: #66c0f4;
        box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.12);
      }
      .sffa-price-help {
        position: relative;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: rgba(102, 192, 244, 0.18);
        color: #d7f0ff;
        font-weight: 700;
      }
      .sffa-price-help-tip {
        display: none !important;
      }
      .sffa-family-poster-body {
        display: grid;
        gap: 12px;
        padding: 14px;
      }
      .sffa-family-poster-field {
        display: grid;
        gap: 6px;
      }
      .sffa-family-poster-field > span {
        color: #dbe8f3;
        font-size: 12px;
        line-height: 1.3;
      }
      .sffa-family-poster-sort-wrap {
        position: relative;
        width: 100%;
      }
      .sffa-family-poster-sort-wrap .sffa-list-select {
        width: 100%;
      }
      .sffa-family-poster-sort-wrap .sffa-list-menu {
        width: 100%;
        min-width: 100%;
        max-height: 240px;
        overflow-y: auto;
      }
      .sffa-family-poster-input {
        height: 34px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 10px;
        outline: none;
        font: inherit;
      }
      .sffa-family-poster-input:focus {
        border-color: #66c0f4;
        box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.12);
      }
      .sffa-family-poster-select {
        height: 34px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background:
          linear-gradient(45deg, transparent 50%, currentColor 50%) calc(100% - 14px) calc(50% - 1px) / 6px 6px no-repeat,
          linear-gradient(135deg, currentColor 50%, transparent 50%) calc(100% - 10px) calc(50% - 1px) / 6px 6px no-repeat,
          #223344;
        color: #c2d4df;
        border-radius: 3px;
        padding: 0 30px 0 10px;
        outline: none;
        font: inherit;
        appearance: none;
        cursor: pointer;
      }
      .sffa-family-poster-select:hover {
        background:
          linear-gradient(45deg, transparent 50%, currentColor 50%) calc(100% - 14px) calc(50% - 1px) / 6px 6px no-repeat,
          linear-gradient(135deg, currentColor 50%, transparent 50%) calc(100% - 10px) calc(50% - 1px) / 6px 6px no-repeat,
          #2c4254;
        border-color: rgba(143, 209, 255, 0.28);
        color: #ffffff;
      }
      .sffa-family-poster-select:focus {
        border-color: #66c0f4;
        box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.12);
        background:
          linear-gradient(45deg, transparent 50%, currentColor 50%) calc(100% - 14px) calc(50% - 1px) / 6px 6px no-repeat,
          linear-gradient(135deg, currentColor 50%, transparent 50%) calc(100% - 10px) calc(50% - 1px) / 6px 6px no-repeat,
          #2c4254;
        color: #ffffff;
      }
      .sffa-family-poster-scale-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
      }
      .sffa-family-poster-range {
        width: 100%;
      }
      .sffa-family-poster-scale-row strong {
        color: #ffffff;
        font-size: 12px;
        min-width: 48px;
        text-align: right;
      }
      .sffa-family-poster-scale-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
      }
      .sffa-family-poster-range {
        width: 100%;
      }
      .sffa-family-poster-scale-row strong {
        color: #ffffff;
        font-size: 12px;
        min-width: 48px;
        text-align: right;
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
      .sffa-sort-wrap .sffa-list-select {
        min-width: 118px;
      }
      .sffa-sort-wrap .sffa-list-menu {
        min-width: 150px;
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
      .sffa-copy-list-btn {
        width: 30px;
        height: 30px;
        min-width: 30px;
        display: grid;
        place-items: center;
        padding: 0;
        font-size: 20px;
        line-height: 1;
      }
      .sffa-copy-list-btn[aria-expanded="true"] {
        background: #2c4254;
        border-color: rgba(143, 209, 255, 0.34);
        color: #ffffff;
      }
      .sffa-search-wrap {
        position: relative;
        flex: 1 1 180px;
        min-width: 140px;
        max-width: 260px;
      }
      .sffa-view-switch {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 3px;
        background: #18222c;
      }
      .sffa-view-btn {
        height: 24px;
        padding: 0 9px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #9fb3c2;
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        white-space: nowrap;
      }
      .sffa-view-btn:hover {
        color: #dbe8f3;
      }
      .sffa-view-btn.is-active {
        background: linear-gradient(180deg, rgba(102, 192, 244, 0.26) 0%, rgba(62, 126, 164, 0.26) 100%);
        color: #ffffff;
        box-shadow: inset 0 0 0 1px rgba(143, 209, 255, 0.24);
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
      .sffa-copy-list-wrap {
        position: relative;
      }
      .sffa-copy-list-menu {
        position: absolute;
        right: 0;
        top: 100%;
        margin-top: 4px;
        min-width: 180px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 3;
      }
      .sffa-copy-list-wrap.is-copy-list-open .sffa-copy-list-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-search-input:focus {
        border-color: #66c0f4;
      }
      .sffa-table-wrap {
        min-height: 0;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 3px;
        background: #11161d;
      }
      .sffa-table-wrap.is-cover-view {
        padding: 10px;
        border: 0;
        background: transparent;
        box-shadow: none;
        overflow: auto;
        scrollbar-color: rgba(102, 192, 244, 0.28) transparent;
      }
      .sffa-table-wrap.is-cover-view::-webkit-scrollbar-track {
        background: transparent;
      }
      .sffa-table-wrap.is-cover-view .sffa-cover-card,
      .sffa-table-wrap.is-cover-view .sffa-poster-card,
      .sffa-table-wrap.is-cover-view .sffa-cover-card:hover,
      .sffa-table-wrap.is-cover-view .sffa-poster-card:hover {
        box-shadow: none;
      }
      .sffa-cover-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
        gap: 10px;
      }
      .sffa-cover-card {
        display: grid;
        grid-template-rows: auto auto;
        min-width: 0;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 4px;
        background: #121820;
        color: inherit;
        text-decoration: none;
        overflow: hidden;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.22);
        transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
      }
      .sffa-cover-card:hover {
        transform: translateY(-2px);
        border-color: rgba(143, 209, 255, 0.28);
        box-shadow: 0 16px 34px rgba(0, 0, 0, 0.3);
        filter: brightness(1.03);
      }
      .sffa-cover-card-media {
        position: relative;
        display: flex;
        align-items: flex-end;
        aspect-ratio: 460 / 215;
        min-width: 0;
        padding: 10px;
        background-color: #16202b;
        background-image: linear-gradient(180deg, rgba(9, 13, 19, 0.08) 0%, rgba(9, 13, 19, 0.74) 100%), var(--sffa-cover, none);
        background-position: center;
        background-repeat: no-repeat;
        background-size: 100% 100%, contain;
        box-shadow: inset 0 -40px 64px rgba(0, 0, 0, 0.4);
      }
      .sffa-cover-card-title {
        min-width: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.25;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.72);
        overflow-wrap: anywhere;
      }
      .sffa-cover-card-chip {
        position: absolute;
        top: 10px;
        left: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 22px;
        max-width: calc(100% - 20px);
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(8, 12, 18, 0.72);
        color: #ffffff;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 18px rgba(0, 0, 0, 0.28);
      }
      .sffa-cover-card-chip.is-new {
        background: rgba(111, 201, 132, 0.22);
        color: #d5ffe0;
      }
      .sffa-cover-card-chip.is-overlap {
        background: rgba(102, 192, 244, 0.2);
        color: #d7f0ff;
      }
      .sffa-cover-card-chip.is-no-value {
        background: rgba(8, 12, 18, 0.68);
        color: #dbe8f3;
      }
      .sffa-cover-card-chip.is-unsupported {
        background: rgba(225, 170, 92, 0.18);
        color: #ffe4b4;
      }
      .sffa-cover-card-chip.is-pending {
        background: rgba(150, 156, 167, 0.2);
        color: #f1f4f7;
      }
      .sffa-cover-card-body {
        display: grid;
        gap: 4px;
        padding: 10px;
        min-width: 0;
      }
      .sffa-cover-card-id-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }
      .sffa-cover-card-appid {
        min-width: 0;
        color: #8fd1ff;
        font-size: 11px;
        line-height: 1.2;
      }
      .sffa-cover-card-price {
        flex: 0 0 auto;
        color: #d8e4ee;
        font-size: 11px;
        line-height: 1.2;
        text-align: right;
        white-space: nowrap;
      }
      .sffa-cover-card-meta {
        min-width: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        color: #c9d6e0;
        font-size: 11px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .sffa-poster-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
        gap: 10px;
      }
      .sffa-poster-card {
        position: relative;
        min-width: 0;
        aspect-ratio: 2 / 3;
        display: block;
        border: 0;
        border-radius: 4px;
        background-color: #121820;
        background-image:
          linear-gradient(180deg, rgba(8, 12, 18, 0.66) 0%, rgba(8, 12, 18, 0.16) 28%, rgba(8, 12, 18, 0.42) 58%, rgba(8, 12, 18, 0.96) 100%),
          var(--sffa-cover, none);
        background-position: center;
        background-repeat: no-repeat;
        background-size: cover;
        color: inherit;
        text-decoration: none;
        overflow: hidden;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
        transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
      }
      .sffa-poster-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 18px 38px rgba(0, 0, 0, 0.34);
        filter: brightness(1.03);
      }
      .sffa-poster-top,
      .sffa-poster-bottom {
        position: absolute;
        left: 10px;
        right: 10px;
        display: flex;
        gap: 6px;
        min-width: 0;
        pointer-events: none;
      }
      .sffa-poster-top {
        top: 10px;
        align-items: flex-start;
        justify-content: space-between;
      }
      .sffa-poster-bottom {
        bottom: 10px;
        flex-direction: column;
        align-items: flex-start;
      }
      .sffa-poster-left-tags,
      .sffa-poster-owner-tags {
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .sffa-poster-price {
        flex: 0 0 auto;
        margin-left: auto;
      }
      .sffa-poster-title {
        max-width: 100%;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
        color: #ffffff;
        font-size: 14px;
        font-weight: 800;
        line-height: 1.18;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.82);
        overflow-wrap: anywhere;
      }
      .sffa-poster-card .sffa-table-tag {
        background-color: rgba(12, 18, 26, 0.24);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px) saturate(1.2);
        -webkit-backdrop-filter: blur(10px) saturate(1.2);
      }
      .sffa-table-shell {
        min-width: 100%;
        height: 100%;
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
      }
      .sffa-table-head-scroll {
        overflow-x: hidden;
        overflow-y: scroll;
        scrollbar-color: transparent transparent;
        background: #0f141b;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .sffa-table-head-scroll::-webkit-scrollbar {
        width: 12px;
        height: 0;
      }
      .sffa-table-head-scroll::-webkit-scrollbar-thumb,
      .sffa-table-head-scroll::-webkit-scrollbar-track {
        background: transparent;
      }
      .sffa-table-body-scroll {
        min-height: 0;
        overflow: auto;
      }
      .sffa-table-head-scroll .sffa-table th {
        border-bottom: 0;
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
        vertical-align: middle;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .sffa-table th {
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
      .sffa-table th:not(:first-child),
      .sffa-table td:not(:first-child) {
        text-align: right;
      }
      .sffa-table a {
        color: #8fd1ff;
        text-decoration: none;
      }
      .sffa-game-name {
        display: grid;
        grid-template-columns: 86px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        min-width: 0;
        color: #d8e4ee;
      }
      .sffa-game-thumb {
        display: block;
        width: 86px;
        aspect-ratio: 460 / 215;
        border-radius: 3px;
        background-color: rgba(255, 255, 255, 0.05);
        background-image: linear-gradient(135deg, rgba(102, 192, 244, 0.12), rgba(22, 32, 43, 0.82)), var(--sffa-cover, none);
        background-position: center;
        background-repeat: no-repeat;
        background-size: cover;
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 8px 18px rgba(0, 0, 0, 0.18);
        transition: filter 0.14s ease, transform 0.14s ease;
      }
      .sffa-game-thumb:hover {
        filter: brightness(1.08);
        transform: translateY(-1px);
      }
      .sffa-game-name-text {
        display: block;
        justify-self: start;
        width: fit-content;
        max-width: 100%;
        min-width: 0;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
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
      .sffa-table-tags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
      }
      .sffa-table-tag {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        min-height: 22px;
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #dbe8f3;
        font-size: 11px;
        line-height: 1.15;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .sffa-table-tag.is-tone-0 { background: rgba(102, 192, 244, 0.18); color: #9cdbff; }
      .sffa-table-tag.is-tone-1 { background: rgba(111, 201, 132, 0.18); color: #a8efb5; }
      .sffa-table-tag.is-tone-2 { background: rgba(225, 170, 92, 0.18); color: #ffd28f; }
      .sffa-table-tag.is-tone-3 { background: rgba(185, 131, 255, 0.18); color: #d5bcff; }
      .sffa-table-tag.is-tone-4 { background: rgba(255, 128, 151, 0.18); color: #ffb6c2; }
      .sffa-table-tag.is-tone-5 { background: rgba(80, 220, 196, 0.16); color: #9ff4e4; }
      .sffa-table-tag.is-tone-6 { background: rgba(255, 216, 102, 0.16); color: #ffe58f; }
      .sffa-table-tag.is-tone-7 { background: rgba(150, 156, 167, 0.18); color: #d7dde2; }
      .sffa-table-tag.is-tone-8 { background: rgba(120, 170, 255, 0.18); color: #b9d3ff; }
      .sffa-table-tag.is-tone-9 { background: rgba(255, 156, 95, 0.18); color: #ffc39b; }
      .sffa-table-tag.is-tone-10 { background: rgba(126, 238, 164, 0.16); color: #b8f8ca; }
      .sffa-table-tag.is-tone-11 { background: rgba(240, 132, 226, 0.16); color: #f6b8ee; }
      .sffa-table-tag.is-tone-12 { background: rgba(114, 229, 255, 0.16); color: #b8f2ff; }
      .sffa-table-tag.is-tone-13 { background: rgba(205, 222, 96, 0.16); color: #edf69a; }
      .sffa-table-tag.is-tone-14 { background: rgba(255, 112, 112, 0.16); color: #ffb0b0; }
      .sffa-table-tag.is-tone-15 { background: rgba(166, 142, 255, 0.18); color: #cec2ff; }
      .sffa-table-tag.is-tone-16 { background: rgba(92, 205, 148, 0.18); color: #a8efc5; }
      .sffa-table-tag.is-tone-17 { background: rgba(255, 191, 120, 0.16); color: #ffd7aa; }
      .sffa-table-tag.is-tone-18 { background: rgba(111, 214, 214, 0.16); color: #aeeeee; }
      .sffa-table-tag.is-tone-19 { background: rgba(214, 154, 118, 0.18); color: #f1c1a7; }
      .sffa-table-tag.is-status-new { background: rgba(111, 201, 132, 0.18); color: #a8efb5; }
      .sffa-table-tag.is-status-overlap { background: rgba(102, 192, 244, 0.16); color: #8fd1ff; }
      .sffa-table-tag.is-status-no-value { background: rgba(125, 132, 141, 0.16); color: #d7dde2; }
      .sffa-table-tag.is-status-unsupported { background: rgba(225, 170, 92, 0.16); color: #ffd28f; }
      .sffa-table-tag.is-status-pending { background: rgba(150, 156, 167, 0.16); color: #d7dde2; }
      .sffa-table-tag.is-price-0 { background: rgba(111, 201, 132, 0.18); color: #a8efb5; }
      .sffa-table-tag.is-price-1 { background: rgba(102, 192, 244, 0.16); color: #8fd1ff; }
      .sffa-table-tag.is-price-2 { background: rgba(225, 170, 92, 0.18); color: #ffd28f; }
      .sffa-table-tag.is-price-3 { background: rgba(255, 128, 151, 0.18); color: #ffb6c2; }
      .sffa-table-tag.is-price-empty { background: rgba(150, 156, 167, 0.14); color: #c7d0d8; }
      .sffa-table-tag.is-muted { background: rgba(150, 156, 167, 0.14); color: #c7d0d8; }
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
          right: 14px;
          bottom: 14px;
          transform: translateY(0) scale(1);
        }
        .sffa-launcher-wrap:hover {
          transform: translateY(-2px) scale(1.02);
        }
        .sffa-launcher {
          width: 32px;
          height: 32px;
        }
        .sffa-shell {
          width: 100vw;
          height: 100vh;
          height: 100dvh;
        }
        .sffa-body {
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sffa-content {
          grid-template-columns: 1fr;
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sffa-control-row {
          grid-template-columns: 1fr;
        }
        .sffa-control-primary {
          grid-template-columns: 1fr;
        }
        .sffa-control-actions {
          justify-content: stretch;
        }
        .sffa-control-actions .sffa-btn {
          flex: 1 1 0;
        }
        .sffa-control-status {
          justify-content: stretch;
        }
        .sffa-status-row .sffa-status {
          text-align: left;
        }
        .sffa-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .sffa-table {
          min-width: 640px;
        }
        .sffa-table-wrap.is-cover-view {
          padding: 8px;
        }
        .sffa-cover-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .sffa-poster-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .sffa-cover-card {
          grid-template-rows: auto auto;
        }
        .sffa-compare-shell {
          width: calc(100vw - 16px);
          min-width: 0;
          max-width: calc(100vw - 16px);
          max-height: calc(100vh - 16px);
          --sffa-compare-columns: 1;
        }
        .sffa-compare-summary {
          grid-template-columns: 1fr;
        }
        .sffa-global-content.has-detail {
          flex-direction: column;
          gap: 10px;
        }
        .sffa-global-content.has-detail .sffa-global-chart,
        .sffa-global-content.has-detail .sffa-global-detail {
          flex-basis: auto;
          max-width: 100%;
        }
        .sffa-global-content.has-detail .sffa-global-detail {
          height: auto;
          transform: translateY(0) scale(1);
        }
        .sffa-global-detail-list {
          max-height: clamp(120px, 26vh, 220px);
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

  // ===== 界面挂载与交互 =====

  function mountPanel() {
    const root = createPanelRoot();
    document.body.appendChild(root);
    elements = collectPanelElements(root);
    bringPanelToFront();
    observePanelFront();
    bindPanelEvents();
    initializePanelView();
  }

  function bringPanelToFront() {
    const root = elements.root || document.getElementById("sffa-root");
    if (!root || !document.body) {
      return;
    }
    root.style.setProperty("z-index", "2147483647", "important");
    if (document.body.lastElementChild !== root) {
      document.body.appendChild(root);
    }
  }

  function observePanelFront() {
    if (panelFrontObserver || !document.body) {
      return;
    }
    panelFrontObserver = new MutationObserver(() => {
      bringPanelToFront();
    });
    panelFrontObserver.observe(document.body, { childList: true });
  }

  function createPanelRoot() {
    const root = document.createElement("div");
    root.id = "sffa-root";
    root.innerHTML = `
      <div class="sffa-launcher-wrap" data-sffa-launcher-wrap>
        <button class="sffa-launcher-close" type="button" data-sffa-launcher-close aria-label="${escapeAttr(t("hideLauncher"))}">×</button>
        <button class="sffa-launcher" type="button" aria-label="${escapeAttr(t("openAnalyzer"))}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M7.81998 15.3333C6.2349 16.4298 5.14521 18.1062 4.78665 20H1.33331V15.3333C1.33331 14.0956 1.82498 12.9086 2.70015 12.0335C3.57532 11.1583 4.7623 10.6666 5.99998 10.6666C6.27492 10.6673 6.54929 10.6918 6.81998 10.74C6.71508 11.163 6.66357 11.5975 6.66665 12.0333C6.66944 13.2316 7.07572 14.3941 7.81998 15.3333ZM5.99998 8.69995C6.59332 8.69995 7.17334 8.52401 7.66669 8.19436C8.16004 7.86472 8.54456 7.39618 8.77162 6.848C8.99868 6.29982 9.05809 5.69662 8.94234 5.11468C8.82658 4.53274 8.54086 3.99819 8.1213 3.57863C7.70174 3.15907 7.16719 2.87335 6.58525 2.7576C6.00331 2.64184 5.40011 2.70125 4.85193 2.92831C4.30375 3.15538 3.83522 3.53989 3.50557 4.03324C3.17593 4.52659 2.99998 5.10661 2.99998 5.69995C2.9991 6.09416 3.0761 6.48467 3.22655 6.84904C3.377 7.21342 3.59795 7.54448 3.8767 7.82323C4.15545 8.10198 4.48652 8.32293 4.85089 8.47338C5.21526 8.62383 5.60577 8.70083 5.99998 8.69995ZM18 8.69995C18.5933 8.69995 19.1733 8.52401 19.6667 8.19436C20.16 7.86472 20.5446 7.39618 20.7716 6.848C20.9987 6.29982 21.0581 5.69662 20.9423 5.11468C20.8266 4.53274 20.5409 3.99819 20.1213 3.57863C19.7017 3.15907 19.1672 2.87335 18.5853 2.7576C18.0033 2.64184 17.4001 2.70125 16.8519 2.92831C16.3038 3.15538 15.8352 3.53989 15.5056 4.03324C15.1759 4.52659 15 5.10661 15 5.69995C14.9991 6.09416 15.0761 6.48467 15.2266 6.84904C15.377 7.21342 15.5979 7.54448 15.8767 7.82323C16.1554 8.10198 16.4865 8.32293 16.8509 8.47338C17.2153 8.62383 17.6058 8.70083 18 8.69995ZM21.3333 12.0666C20.896 11.6293 20.3761 11.2833 19.8038 11.0487C19.2316 10.814 18.6184 10.6955 18 10.7C17.725 10.7006 17.4507 10.7251 17.18 10.7733C17.2822 11.1855 17.3336 11.6086 17.3333 12.0333C17.338 13.243 16.9313 14.4185 16.18 15.3666C17.7651 16.4631 18.8547 18.1396 19.2133 20.0333H22.6666V15.3666C22.6756 14.1337 22.1963 12.9473 21.3333 12.0666Z" fill="currentColor"></path><path d="M12 14.7C12.5274 14.7 13.043 14.5436 13.4815 14.2506C13.92 13.9576 14.2618 13.5411 14.4637 13.0539C14.6655 12.5666 14.7183 12.0304 14.6154 11.5131C14.5125 10.9958 14.2585 10.5207 13.8856 10.1477C13.5127 9.77481 13.0375 9.52083 12.5202 9.41794C12.0029 9.31505 11.4668 9.36785 10.9795 9.56969C10.4922 9.77152 10.0757 10.1133 9.78273 10.5518C9.48971 10.9904 9.33331 11.5059 9.33331 12.0334C9.33331 12.7406 9.61426 13.4189 10.1144 13.919C10.6145 14.4191 11.2927 14.7 12 14.7ZM12 16.7C10.7623 16.7 9.57532 17.1917 8.70015 18.0669C7.82498 18.942 7.33331 20.129 7.33331 21.3667H16.6666C16.6666 20.129 16.175 18.942 15.2998 18.0669C14.4246 17.1917 13.2377 16.7 12 16.7Z" fill="currentColor"></path></svg>
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
            <button class="sffa-icon-btn" type="button" data-sffa-more data-sffa-tooltip="${escapeAttr(t("more"))}" aria-label="${escapeAttr(t("more"))}" aria-expanded="false">⋯</button>
            <div class="sffa-menu" data-sffa-menu>
              <button class="sffa-menu-item" type="button" data-sffa-auto-family-refresh></button>
              <button class="sffa-menu-item" type="button" data-sffa-open-links-client aria-pressed="false"></button>
              <button class="sffa-menu-item" type="button" data-sffa-price-settings>${escapeHtml(t("priceSettings"))}</button>
              <button class="sffa-menu-item danger" type="button" data-sffa-clear-store-cache hidden>${escapeHtml(t("clearStoreCache"))}</button>
              <button class="sffa-menu-item" type="button" data-sffa-raw>${escapeHtml(t("rawData"))}</button>
            </div>
            <button class="sffa-close" type="button" data-sffa-close data-sffa-tooltip="${escapeAttr(t("close"))}">×</button>
          </div>
        </header>
        <div class="sffa-body">
          <div class="sffa-row sffa-control-row">
            <div class="sffa-control-primary">
              <div class="sffa-list-wrap sffa-history-wrap" data-sffa-history-wrap>
                <input class="sffa-input" data-sffa-target placeholder="${escapeAttr(t("targetPlaceholder"))}" autocomplete="off" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeAttr(t("analysisHistory"))}">
                <div class="sffa-list-menu" role="listbox" data-sffa-history-menu></div>
              </div>
              <div class="sffa-control-status">
                <div class="sffa-status-row">
                  <div class="sffa-status" data-sffa-status></div>
                  <button class="sffa-rate-btn" type="button" data-sffa-rate-continue hidden>${escapeHtml(t("continue"))}</button>
                  <button class="sffa-rate-btn" type="button" data-sffa-rate-check hidden>${escapeHtml(t("rateCheck"))}</button>
                </div>
              </div>
            </div>
            <div class="sffa-control-actions">
              <button class="sffa-btn secondary" type="button" data-sffa-refresh>${escapeHtml(t("refreshFamily"))}</button>
              <button class="sffa-btn" type="button" data-sffa-analyze>${escapeHtml(t("analyzeAccount"))}</button>
            </div>
          </div>
          <div class="sffa-content">
            <div class="sffa-side">
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
                <div class="sffa-list-wrap sffa-sort-wrap" data-sffa-sort-wrap>
                  <button class="sffa-list-select" type="button" data-sffa-sort-select aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeAttr(t("sort"))}">${escapeHtml(t("sort"))}</button>
                  <div class="sffa-list-menu" role="listbox" data-sffa-sort-menu></div>
                </div>
                <div class="sffa-search-wrap" data-sffa-search-wrap>
                  <input class="sffa-search-input" data-sffa-search placeholder="${escapeAttr(t("searchPlaceholder"))}" autocomplete="off">
                  <button class="sffa-search-clear" type="button" data-sffa-search-clear data-sffa-tooltip="${escapeAttr(t("clear"))}" aria-label="${escapeAttr(t("clear"))}">
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
                <div class="sffa-view-switch" data-sffa-view-switch aria-label="${escapeAttr(t("viewMode"))}">
                  <button class="sffa-view-btn is-active" type="button" data-sffa-view-mode="table">${escapeHtml(t("viewTable"))}</button>
                  <button class="sffa-view-btn" type="button" data-sffa-view-mode="cover">${escapeHtml(t("viewCover"))}</button>
                  <button class="sffa-view-btn" type="button" data-sffa-view-mode="poster">${escapeHtml(t("viewPoster"))}</button>
                </div>
                <button class="sffa-tab" type="button" data-tab="family">${escapeHtml(t("tabs.family"))}</button>
                <div class="sffa-copy-list-wrap" data-sffa-copy-list-wrap>
                  <button class="sffa-tab sffa-copy-list-btn" type="button" data-sffa-copy-list-btn aria-expanded="false" aria-label="${escapeAttr(t("more"))}">⋯</button>
                  <div class="sffa-menu sffa-copy-list-menu" data-sffa-copy-list-menu>
                    <button class="sffa-menu-item" type="button" data-sffa-copy>${escapeHtml(t("copyReport"))}</button>
                    <button class="sffa-menu-item" type="button" data-sffa-copy-list>${escapeHtml(t("copyList"))}</button>
                    <button class="sffa-menu-item" type="button" data-sffa-copy-games>${escapeHtml(t("copyGames"))}</button>
                    <button class="sffa-menu-item" type="button" data-sffa-save-list-poster>${escapeHtml(t("saveListPoster"))}</button>
                    <button class="sffa-menu-item" type="button" data-sffa-reload-covers>${escapeHtml(t("reloadCovers"))}</button>
                  </div>
                </div>
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
        <section class="sffa-compare-shell" role="dialog" aria-modal="true" aria-label="${escapeAttr(t("compareTitle"))}" data-sffa-compare-shell>
          <header class="sffa-compare-header">
            <div class="sffa-compare-title">
              <strong data-sffa-compare-title>${escapeHtml(t("compareTitle"))}</strong>
              <span data-sffa-compare-hint></span>
            </div>
            <button class="sffa-compare-close" type="button" data-sffa-compare-close data-sffa-tooltip="${escapeAttr(t("close"))}" aria-label="${escapeAttr(t("close"))}">×</button>
          </header>
          <div class="sffa-compare-summary" data-sffa-compare-summary></div>
          <div class="sffa-compare-body" data-sffa-compare-body></div>
        </section>
      </div>
      ${renderModalHtml({
        name: "global-compare",
        overlayAttrs: "data-sffa-global-compare-overlay",
        backdropAttrs: "data-sffa-global-compare-backdrop",
        closeAttrs: "data-sffa-global-compare-close",
        titleAttrs: "data-sffa-global-compare-title",
        hintAttrs: "data-sffa-global-compare-hint",
        title: t("globalCompareTitle"),
        hint: t("globalCompareHint"),
        shellClass: "is-center",
        bodyClass: "sffa-global-compare-body",
        bodyHtml: `<div data-sffa-global-compare-body></div>`
      })}
      ${renderModalHtml({
        name: "price",
        overlayAttrs: "data-sffa-price-overlay",
        backdropAttrs: "data-sffa-price-backdrop",
        closeAttrs: "data-sffa-price-close",
        titleAttrs: "data-sffa-price-title",
        hintAttrs: "data-sffa-price-hint",
        title: t("priceSettingsTitle"),
        hint: t("priceSettingsHint"),
        shellClass: "is-anchor-top-right",
        bodyClass: "sffa-price-body",
        bodyHtml: `
            <label class="sffa-price-field">
              <span class="sffa-price-field-label" data-sffa-price-mode-label>${escapeHtml(t("priceMode"))}</span>
              <span class="sffa-price-mode-toggle" data-sffa-price-mode-toggle>
                <button class="sffa-price-mode-btn" type="button" data-sffa-price-mode-option="${PRICE_MODE_ORIGINAL}">${escapeHtml(t("priceModeOriginal"))}</button>
                <button class="sffa-price-mode-btn" type="button" data-sffa-price-mode-option="${PRICE_MODE_CURRENT}">${escapeHtml(t("priceModeCurrent"))}</button>
                <button class="sffa-price-mode-btn" type="button" data-sffa-price-mode-option="${PRICE_MODE_HISTORY_LOW}">${escapeHtml(t("priceModeHistoryLow"))}</button>
              </span>
            </label>
            <label class="sffa-price-field">
              <span class="sffa-price-field-label" data-sffa-itad-key-label>${escapeHtml(t("itadApiKey"))}</span>
              <span class="sffa-price-api-row">
                <input class="sffa-price-input" type="password" autocomplete="off" spellcheck="false" data-sffa-itad-api-key placeholder="${escapeAttr(t("itadApiKeyPlaceholder"))}">
                <button class="sffa-price-help" type="button" data-sffa-itad-help data-sffa-tooltip="${escapeAttr(t("itadApiHelp"))}" aria-label="${escapeAttr(t("itadApiHelp"))}">
                  ?
                  <span class="sffa-price-help-tip" data-sffa-itad-help-tip>${escapeHtml(t("itadApiHelp"))}</span>
                </button>
              </span>
            </label>
          `,
        actionsHtml: `
            <button class="sffa-btn secondary" type="button" data-sffa-price-cancel>${escapeHtml(t("familyPosterCancel"))}</button>
            <button class="sffa-btn" type="button" data-sffa-price-confirm>${escapeHtml(t("priceSettingsSave"))}</button>
          `
      })}
      ${renderModalHtml({
        name: "family-poster",
        overlayAttrs: "data-sffa-family-poster-overlay",
        backdropAttrs: "data-sffa-family-poster-backdrop",
        closeAttrs: "data-sffa-family-poster-close",
        titleAttrs: "data-sffa-family-poster-title",
        hintAttrs: "data-sffa-family-poster-hint",
        title: t("familyPosterTitle"),
        hint: t("familyPosterHint"),
        shellClass: "is-center",
        bodyClass: "sffa-family-poster-body",
        bodyHtml: `
            <label class="sffa-family-poster-field">
              <span data-sffa-family-poster-columns-label>${escapeHtml(t("familyPosterColumns"))}</span>
              <input class="sffa-family-poster-input" type="number" min="1" max="30" step="1" data-sffa-family-poster-columns>
            </label>
            <label class="sffa-family-poster-field">
              <span data-sffa-family-poster-sort-label>${escapeHtml(t("familyPosterSort"))}</span>
              <div class="sffa-list-wrap sffa-family-poster-sort-wrap" data-sffa-family-poster-sort-wrap>
                <button class="sffa-list-select" type="button" data-sffa-family-poster-sort-select aria-haspopup="listbox" aria-expanded="false"></button>
                <div class="sffa-list-menu" role="listbox" data-sffa-family-poster-sort-menu></div>
              </div>
            </label>
            <label class="sffa-family-poster-field">
              <span data-sffa-family-poster-scale-label>${escapeHtml(t("familyPosterScale"))}</span>
              <div class="sffa-family-poster-scale-row">
                <input class="sffa-family-poster-range" type="range" min="40" max="100" step="5" data-sffa-family-poster-scale>
                <strong data-sffa-family-poster-scale-value>${escapeHtml(t("familyPosterScaleValue", { value: 100 }))}</strong>
              </div>
            </label>
          `,
        actionsHtml: `
            <button class="sffa-btn secondary" type="button" data-sffa-family-poster-cancel>${escapeHtml(t("familyPosterCancel"))}</button>
            <button class="sffa-btn" type="button" data-sffa-family-poster-confirm>${escapeHtml(t("familyPosterConfirm"))}</button>
          `
      })}
      <div class="sffa-tooltip" data-sffa-tooltip-box role="tooltip" hidden></div>
    `;
    return root;
  }

  function renderModalHtml({
    name,
    overlayAttrs = "",
    backdropAttrs = "",
    closeAttrs = "",
    titleAttrs = "",
    hintAttrs = "",
    title,
    hint = "",
    shellClass = "is-center",
    bodyClass = "",
    bodyHtml = "",
    actionsHtml = ""
  }) {
    const normalizedName = String(name || "modal");
    return `
      <div class="sffa-modal-overlay sffa-${escapeAttr(normalizedName)}-overlay" ${overlayAttrs}>
        <div class="sffa-modal-backdrop sffa-${escapeAttr(normalizedName)}-backdrop" ${backdropAttrs}></div>
        <section class="sffa-modal-shell sffa-${escapeAttr(normalizedName)}-shell ${escapeAttr(shellClass)}" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
          <header class="sffa-modal-header">
            <div class="sffa-modal-title">
              <strong ${titleAttrs}>${escapeHtml(title)}</strong>
              ${hint ? `<span ${hintAttrs}>${escapeHtml(hint)}</span>` : ""}
            </div>
            <button class="sffa-modal-close" type="button" ${closeAttrs} data-sffa-tooltip="${escapeAttr(t("close"))}" aria-label="${escapeAttr(t("close"))}">×</button>
          </header>
          <div class="${escapeAttr(bodyClass || "sffa-modal-body")}">
            ${bodyHtml}
          </div>
          ${actionsHtml ? `<footer class="sffa-modal-actions">${actionsHtml}</footer>` : ""}
        </section>
      </div>
    `;
  }

  function collectPanelElements(root) {
    return {
      root,
      tooltipBox: root.querySelector("[data-sffa-tooltip-box]"),
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
      historyWrap: root.querySelector("[data-sffa-history-wrap]"),
      historyMenu: root.querySelector("[data-sffa-history-menu]"),
      targetInput: root.querySelector("[data-sffa-target]"),
      listWrap: root.querySelector("[data-sffa-list-wrap]"),
      listSelect: root.querySelector("[data-sffa-list-select]"),
      listOptions: Array.from(root.querySelectorAll("[data-sffa-list-option]")),
      sortWrap: root.querySelector("[data-sffa-sort-wrap]"),
      sortSelect: root.querySelector("[data-sffa-sort-select]"),
      sortMenu: root.querySelector("[data-sffa-sort-menu]"),
      searchWrap: root.querySelector("[data-sffa-search-wrap]"),
      searchInput: root.querySelector("[data-sffa-search]"),
      searchClearBtn: root.querySelector("[data-sffa-search-clear]"),
      viewSwitch: root.querySelector("[data-sffa-view-switch]"),
      viewModeButtons: Array.from(root.querySelectorAll("[data-sffa-view-mode]")),
      copyListWrap: root.querySelector("[data-sffa-copy-list-wrap]"),
      copyListBtn: root.querySelector("[data-sffa-copy-list-btn]"),
      refreshBtn: root.querySelector("[data-sffa-refresh]"),
      analyzeBtn: root.querySelector("[data-sffa-analyze]"),
      autoFamilyRefreshBtn: root.querySelector("[data-sffa-auto-family-refresh]"),
      openLinksClientBtn: root.querySelector("[data-sffa-open-links-client]"),
      priceSettingsBtn: root.querySelector("[data-sffa-price-settings]"),
      copyBtn: root.querySelector("[data-sffa-copy]"),
      saveFamilyPosterBtn: root.querySelector("[data-sffa-save-family-poster]"),
      saveListPosterBtn: root.querySelector("[data-sffa-save-list-poster]"),
      reloadCoversBtn: root.querySelector("[data-sffa-reload-covers]"),
      clearStoreCacheBtn: root.querySelector("[data-sffa-clear-store-cache]"),
      rawBtn: root.querySelector("[data-sffa-raw]"),
      rateContinueBtn: root.querySelector("[data-sffa-rate-continue]"),
      rateCheckBtn: root.querySelector("[data-sffa-rate-check]"),
      compareOverlay: root.querySelector("[data-sffa-compare-overlay]"),
      compareBackdrop: root.querySelector("[data-sffa-compare-backdrop]"),
      compareShell: root.querySelector("[data-sffa-compare-shell]"),
      compareCloseBtn: root.querySelector("[data-sffa-compare-close]"),
      compareTitle: root.querySelector("[data-sffa-compare-title]"),
      compareHint: root.querySelector("[data-sffa-compare-hint]"),
      compareSummary: root.querySelector("[data-sffa-compare-summary]"),
      compareBody: root.querySelector("[data-sffa-compare-body]"),
      globalCompareOverlay: root.querySelector("[data-sffa-global-compare-overlay]"),
      globalCompareBackdrop: root.querySelector("[data-sffa-global-compare-backdrop]"),
      globalCompareCloseBtn: root.querySelector("[data-sffa-global-compare-close]"),
      globalCompareTitle: root.querySelector("[data-sffa-global-compare-title]"),
      globalCompareHint: root.querySelector("[data-sffa-global-compare-hint]"),
      globalCompareBody: root.querySelector("[data-sffa-global-compare-body]"),
      priceOverlay: root.querySelector("[data-sffa-price-overlay]"),
      priceBackdrop: root.querySelector("[data-sffa-price-backdrop]"),
      priceCloseBtn: root.querySelector("[data-sffa-price-close]"),
      priceTitle: root.querySelector("[data-sffa-price-title]"),
      priceHint: root.querySelector("[data-sffa-price-hint]"),
      priceModeLabel: root.querySelector("[data-sffa-price-mode-label]"),
      priceModeButtons: Array.from(root.querySelectorAll("[data-sffa-price-mode-option]")),
      itadKeyLabel: root.querySelector("[data-sffa-itad-key-label]"),
      itadApiKeyInput: root.querySelector("[data-sffa-itad-api-key]"),
      itadHelpBtn: root.querySelector("[data-sffa-itad-help]"),
      itadHelpTip: root.querySelector("[data-sffa-itad-help-tip]"),
      priceCancelBtn: root.querySelector("[data-sffa-price-cancel]"),
      priceConfirmBtn: root.querySelector("[data-sffa-price-confirm]"),
      familyPosterOverlay: root.querySelector("[data-sffa-family-poster-overlay]"),
      familyPosterBackdrop: root.querySelector("[data-sffa-family-poster-backdrop]"),
      familyPosterCloseBtn: root.querySelector("[data-sffa-family-poster-close]"),
      familyPosterTitle: root.querySelector("[data-sffa-family-poster-title]"),
      familyPosterHint: root.querySelector("[data-sffa-family-poster-hint]"),
      familyPosterColumnsLabel: root.querySelector("[data-sffa-family-poster-columns-label]"),
      familyPosterSortLabel: root.querySelector("[data-sffa-family-poster-sort-label]"),
      familyPosterScaleLabel: root.querySelector("[data-sffa-family-poster-scale-label]"),
      familyPosterColumnsInput: root.querySelector("[data-sffa-family-poster-columns]"),
      familyPosterSortWrap: root.querySelector("[data-sffa-family-poster-sort-wrap]"),
      familyPosterSortSelect: root.querySelector("[data-sffa-family-poster-sort-select]"),
      familyPosterSortMenu: root.querySelector("[data-sffa-family-poster-sort-menu]"),
      familyPosterScaleInput: root.querySelector("[data-sffa-family-poster-scale]"),
      familyPosterScaleValue: root.querySelector("[data-sffa-family-poster-scale-value]"),
      familyPosterCancelBtn: root.querySelector("[data-sffa-family-poster-cancel]"),
      familyPosterConfirmBtn: root.querySelector("[data-sffa-family-poster-confirm]"),
      tabs: Array.from(root.querySelectorAll("[data-tab]"))
    };
  }

  function bindPanelEvents() {
    bindTooltipEvents();
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
    elements.openLinksClientBtn?.addEventListener("click", toggleOpenLinksInSteamClient);
    elements.priceSettingsBtn?.addEventListener("click", openPriceSettingsDialog);
    elements.copyBtn.addEventListener("click", copyReportSummary);
    elements.saveFamilyPosterBtn?.addEventListener("click", openFamilyPosterDialog);
    elements.reloadCoversBtn.addEventListener("click", reloadCovers);
    elements.copyListBtn.addEventListener("click", toggleCopyListMenu);
    elements.clearStoreCacheBtn.addEventListener("click", clearStoreCache);
    const copyListCopyBtn = elements.copyListWrap?.querySelector("[data-sffa-copy-list]");
    copyListCopyBtn?.addEventListener("click", copyCurrentList);
    const copyListCopyGamesBtn = elements.copyListWrap?.querySelector("[data-sffa-copy-games]");
    copyListCopyGamesBtn?.addEventListener("click", copyCurrentGamesOnly);
    elements.saveListPosterBtn?.addEventListener("click", openListPosterDialog);
    elements.rawBtn?.addEventListener("click", showRawDataWindow);
    elements.rateContinueBtn?.addEventListener("click", continueAfterRateLimit);
    elements.rateCheckBtn?.addEventListener("click", checkRateLimit);
    elements.compareBackdrop?.addEventListener("click", closeCompareDialog);
    elements.compareCloseBtn?.addEventListener("click", closeCompareDialog);
    elements.globalCompareBackdrop?.addEventListener("click", closeGlobalCompareDialog);
    elements.globalCompareCloseBtn?.addEventListener("click", closeGlobalCompareDialog);
    elements.priceBackdrop?.addEventListener("click", closePriceSettingsDialog);
    elements.priceCloseBtn?.addEventListener("click", closePriceSettingsDialog);
    elements.priceCancelBtn?.addEventListener("click", closePriceSettingsDialog);
    elements.priceConfirmBtn?.addEventListener("click", confirmPriceSettingsDialog);
    elements.itadHelpBtn?.addEventListener("click", openItadApiPage);
    elements.priceModeButtons.forEach(button => {
      button.addEventListener("click", () => selectPriceSettingsMode(button.dataset.sffaPriceModeOption));
    });
    elements.familyPosterBackdrop?.addEventListener("click", closeFamilyPosterDialog);
    elements.familyPosterCloseBtn?.addEventListener("click", closeFamilyPosterDialog);
    elements.familyPosterCancelBtn?.addEventListener("click", closeFamilyPosterDialog);
    elements.familyPosterConfirmBtn?.addEventListener("click", confirmSaveFamilyPoster);
    elements.familyPosterSortSelect?.addEventListener("click", toggleFamilyPosterSortMenu);
    elements.familyPosterScaleInput?.addEventListener("input", updateFamilyPosterScaleValue);
    elements.compareSummary?.addEventListener("click", handleCompareSummaryClick);
    elements.compareSummary?.addEventListener("scroll", () => scheduleVisibleCoverLoads());
    elements.globalCompareBody?.addEventListener("click", handleGlobalCompareClick);
    elements.tableWrap.addEventListener("scroll", handleDetailsScroll, true);
    elements.tableWrap.addEventListener("click", handleTableHeaderClick);
    elements.profile.addEventListener("change", handleTargetSelectionChange);
    elements.profile.addEventListener("click", handleProfileActionClick);
    elements.historyMenu?.addEventListener("click", handleAnalysisHistoryClick);
    elements.targetInput.addEventListener("click", handleAnalysisHistoryInputClick);
    elements.targetInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        closeAnalysisHistoryMenu();
        analyzeTarget();
      }
    });
    elements.listSelect.addEventListener("click", toggleListMenu);
    elements.listOptions.forEach(option => {
      option.addEventListener("click", () => {
        setReportTab(option.dataset.sffaListOption);
      });
    });
    elements.sortSelect?.addEventListener("click", toggleSortMenu);
    elements.sortMenu?.addEventListener("click", handleSortMenuClick);
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
    elements.viewModeButtons.forEach(button => {
      button.addEventListener("click", () => setListViewMode(button.dataset.sffaViewMode));
    });
    elements.tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        cancelSearchRender();
        closeSortMenu();
        currentTab = tab.dataset.tab;
        renderTabs();
        renderDetails();
        scheduleAnalysisHistorySave();
      });
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (elements.root?.classList.contains("is-price-settings-open")) {
          closePriceSettingsDialog();
          return;
        }
        if (elements.root?.classList.contains("is-family-poster-open")) {
          closeFamilyPosterDialog();
          return;
        }
        if (isCompareDialogOpen()) {
          closeCompareDialog();
          return;
        }
        if (isGlobalCompareDialogOpen()) {
          closeGlobalCompareDialog();
          return;
        }
        closeListMenu();
        closeSortMenu();
        closeAnalysisHistoryMenu();
        closeMenu();
        closeCopyListMenu();
        closeDialog();
      }
    });
    document.addEventListener("click", event => {
      if (!elements.menuWrap.contains(event.target)) {
        closeMenu();
      }
      if (!elements.listWrap?.contains(event.target)) {
        closeListMenu();
      }
      if (!elements.sortWrap?.contains(event.target)) {
        closeSortMenu();
      }
      if (!elements.historyWrap?.contains(event.target)) {
        closeAnalysisHistoryMenu();
      }
      if (!elements.familyPosterSortWrap?.contains(event.target)) {
        closeFamilyPosterSortMenu();
      }
      if (!elements.copyListWrap?.contains(event.target)) {
        closeCopyListMenu();
      }
    });
    window.addEventListener("beforeunload", () => {
      if (lastReport && !lastReport.filtering?.running) {
        saveAnalysisHistoryNow();
      }
    });
  }

  function bindTooltipEvents() {
    normalizeNativeTooltipAttributes(elements.root);
    elements.root.addEventListener("pointerover", handleTooltipPointerOver);
    elements.root.addEventListener("pointerout", handleTooltipPointerOut);
    elements.root.addEventListener("pointermove", handleTooltipPointerMove);
    elements.root.addEventListener("focusin", handleTooltipFocusIn);
    elements.root.addEventListener("focusout", handleTooltipFocusOut);
    elements.root.addEventListener("click", hideTooltip);
    elements.root.addEventListener("scroll", handleTooltipScroll, true);
    window.addEventListener("resize", hideTooltip);
  }

  function handleTooltipPointerOver(event) {
    rememberTooltipPointer(event);
    const target = getTooltipTarget(event.target);
    if (!target) {
      return;
    }
    showTooltip(target, event);
  }

  function handleTooltipPointerOut(event) {
    if (!activeTooltipTarget) {
      return;
    }
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && activeTooltipTarget.contains(relatedTarget)) {
      return;
    }
    hideTooltip();
  }

  function handleTooltipPointerMove(event) {
    rememberTooltipPointer(event);
    if (activeTooltipTarget && activeTooltipTarget.contains(event.target)) {
      scheduleTooltipPosition();
    }
  }

  function rememberTooltipPointer(event) {
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return;
    }
    lastTooltipPointer = {
      x: event.clientX,
      y: event.clientY
    };
  }

  function handleTooltipScroll() {
    hideTooltip();
    scheduleTooltipRestoreFromPointer();
  }

  function scheduleTooltipRestoreFromPointer() {
    if (!lastTooltipPointer) {
      return;
    }
    if (tooltipRestoreTimer) {
      window.clearTimeout(tooltipRestoreTimer);
    }
    tooltipRestoreTimer = window.setTimeout(() => {
      tooltipRestoreTimer = 0;
      const pointer = lastTooltipPointer;
      if (!pointer) {
        return;
      }
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      if (pointer.x < 0 || pointer.y < 0 || pointer.x > viewportWidth || pointer.y > viewportHeight) {
        return;
      }
      const target = getTooltipTarget(document.elementFromPoint(pointer.x, pointer.y));
      if (target) {
        showTooltip(target);
      }
    }, 80);
  }

  function cancelTooltipRestore() {
    if (tooltipRestoreTimer) {
      window.clearTimeout(tooltipRestoreTimer);
      tooltipRestoreTimer = 0;
    }
  }

  function handleTooltipFocusIn(event) {
    const target = getTooltipTarget(event.target);
    if (target) {
      showTooltip(target);
    }
  }

  function handleTooltipFocusOut(event) {
    if (activeTooltipTarget && activeTooltipTarget === event.target) {
      hideTooltip();
    }
  }

  function getTooltipTarget(node) {
    const element = node && node.nodeType === 1 ? node : null;
    const target = element?.closest("[data-sffa-tooltip], [title], .sffa-price-help");
    if (!target || !elements.root?.contains(target) || target === elements.tooltipBox) {
      return null;
    }
    migrateNativeTooltip(target);
    if (!getTooltipText(target)) {
      return null;
    }
    return target;
  }

  function migrateNativeTooltip(element) {
    const title = element.getAttribute("title");
    if (title) {
      element.setAttribute("data-sffa-tooltip", title);
      element.removeAttribute("title");
    }
  }

  function normalizeNativeTooltipAttributes(root = elements.root) {
    root?.querySelectorAll("[title]").forEach(migrateNativeTooltip);
  }

  function getTooltipText(element) {
    const tooltip = element.getAttribute("data-sffa-tooltip");
    if (tooltip) {
      return tooltip;
    }
    if (element.classList.contains("sffa-price-help")) {
      return element.querySelector("[data-sffa-itad-help-tip]")?.textContent?.trim() || "";
    }
    return "";
  }

  function setTooltipText(element, text) {
    if (!element) {
      return;
    }
    const normalized = String(text || "");
    if (normalized) {
      element.setAttribute("data-sffa-tooltip", normalized);
    } else {
      element.removeAttribute("data-sffa-tooltip");
    }
    element.removeAttribute("title");
  }

  function showTooltip(target) {
    const tooltipBox = elements.tooltipBox;
    const text = getTooltipText(target);
    if (!tooltipBox || !text) {
      hideTooltip();
      return;
    }
    if (tooltipHideTimer) {
      window.clearTimeout(tooltipHideTimer);
      tooltipHideTimer = 0;
    }
    activeTooltipTarget = target;
    renderTooltipContent(tooltipBox, text, target);
    tooltipBox.hidden = false;
    tooltipBox.classList.add("is-visible");
    tooltipSizeCache = {
      width: tooltipBox.offsetWidth,
      height: tooltipBox.offsetHeight
    };
    positionTooltip();
  }

  function renderTooltipContent(tooltipBox, text, target) {
    const pairs = isMetricTooltipTarget(target) ? parseTooltipPairs(text) : null;
    tooltipBox.classList.toggle("is-pairs", Boolean(pairs));
    if (!pairs) {
      tooltipBox.textContent = text;
      return;
    }

    tooltipBox.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "sffa-tooltip-pairs";
    pairs.forEach(pair => {
      const row = document.createElement("div");
      row.className = "sffa-tooltip-pair";

      const key = document.createElement("span");
      key.className = "sffa-tooltip-pair-key";
      key.textContent = pair.key;

      const value = document.createElement("span");
      value.className = "sffa-tooltip-pair-value";
      value.textContent = pair.value;

      row.append(key, value);
      wrap.append(row);
    });
    tooltipBox.append(wrap);
  }

  function isMetricTooltipTarget(target) {
    return Boolean(target?.classList?.contains("sffa-metric") || target?.classList?.contains("sffa-compare-stat"));
  }

  function parseTooltipPairs(text) {
    const lines = String(text || "").split("\n").map(line => line.trim()).filter(Boolean);
    if (!lines.length) {
      return null;
    }

    const pairs = lines.map(line => {
      const tabIndex = line.indexOf("\t");
      if (tabIndex <= 0) {
        return null;
      }
      return {
        key: line.slice(0, tabIndex).trim(),
        value: line.slice(tabIndex + 1).trim()
      };
    });

    if (pairs.some(pair => !pair?.key || !pair?.value)) {
      return null;
    }
    return pairs;
  }

  function scheduleTooltipPosition() {
    pendingTooltipEvent = null;
    if (tooltipMoveFrame) {
      return;
    }
    tooltipMoveFrame = window.requestAnimationFrame(() => {
      tooltipMoveFrame = 0;
      positionTooltip();
    });
  }

  function positionTooltip() {
    const tooltipBox = elements.tooltipBox;
    if (!tooltipBox || tooltipBox.hidden || !activeTooltipTarget) {
      return;
    }
    const margin = 8;
    const gap = 10;
    const arrowPadding = 14;
    const rect = activeTooltipTarget.getBoundingClientRect();
    const tooltipWidth = tooltipSizeCache.width || tooltipBox.offsetWidth;
    const tooltipHeight = tooltipSizeCache.height || tooltipBox.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const anchorX = rect.left + rect.width / 2;
    const topSpace = rect.top - margin;
    const placement = topSpace >= tooltipHeight + gap ? "above" : "below";
    const rawLeft = anchorX - tooltipWidth / 2;
    const left = Math.min(
      Math.max(margin, rawLeft),
      Math.max(margin, viewportWidth - tooltipWidth - margin)
    );
    const rawTop = placement === "above"
      ? rect.top - tooltipHeight - gap
      : rect.bottom + gap;
    const top = placement === "above"
      ? Math.max(margin, rawTop)
      : rawTop;
    const arrowLeft = Math.min(
      Math.max(arrowPadding, anchorX - left),
      Math.max(arrowPadding, tooltipWidth - arrowPadding)
    );
    tooltipBox.classList.toggle("is-above", placement === "above");
    tooltipBox.classList.toggle("is-below", placement === "below");
    tooltipBox.style.setProperty("--sffa-tooltip-arrow-left", `${Math.round(arrowLeft)}px`);
    tooltipBox.style.left = `${Math.round(left)}px`;
    tooltipBox.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip() {
    const tooltipBox = elements.tooltipBox;
    cancelTooltipRestore();
    activeTooltipTarget = null;
    pendingTooltipEvent = null;
    if (tooltipMoveFrame) {
      window.cancelAnimationFrame(tooltipMoveFrame);
      tooltipMoveFrame = 0;
    }
    if (!tooltipBox) {
      return;
    }
    tooltipBox.classList.remove("is-visible");
    if (tooltipHideTimer) {
      window.clearTimeout(tooltipHideTimer);
    }
    tooltipHideTimer = window.setTimeout(() => {
      if (!activeTooltipTarget) {
        tooltipBox.hidden = true;
        tooltipBox.classList.remove("is-above", "is-below");
      }
    }, 90);
  }

  function initializePanelView() {
    renderSummary(null);
    renderTargetProfile(null);
    renderAutoFamilyRefreshButton();
    renderOpenLinksClientButton();
    renderStoreCacheButton();
    renderRateLimitControls();
    renderAnalysisHistoryMenu();
    renderPriceSettingsDialog();
  }

  function openDialog() {
    bringPanelToFront();
    const wasOpen = elements.root.classList.contains("is-open");
    elements.root.classList.add("is-open");
    lockPageScroll();
    if (wasOpen) {
      return;
    }
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
    bringPanelToFront();
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
        // 忽略异常。
      }
    });
    scriptMenuCommandIds = [];
  }

  function closeDialog() {
    hideTooltip();
    closeMenu();
    closeListMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    closeSortMenu();
    closePriceSettingsDialog();
    closeFamilyPosterDialog();
    closeCompareDialog();
    closeGlobalCompareDialog();
    elements.root.classList.remove("is-open");
    unlockPageScroll();
  }

  function lockPageScroll() {
    document.documentElement.classList.add("sffa-page-scroll-locked");
    document.body?.classList.add("sffa-page-scroll-locked");
  }

  function unlockPageScroll() {
    document.documentElement.classList.remove("sffa-page-scroll-locked");
    document.body?.classList.remove("sffa-page-scroll-locked");
  }

  function toggleMenu(event) {
    event.stopPropagation();
    closeLocaleMenu();
    closeListMenu();
    closeSortMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    const isOpen = elements.menuWrap.classList.toggle("is-menu-open");
    elements.moreBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function toggleLocaleMenu(event) {
    event.stopPropagation();
    elements.menuWrap?.classList.remove("is-menu-open");
    elements.moreBtn?.setAttribute("aria-expanded", "false");
    closeListMenu();
    closeSortMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    const isOpen = elements.localeWrap.classList.toggle("is-open");
    elements.localeToggleBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function closeMenu() {
    elements.menuWrap?.classList.remove("is-menu-open");
    elements.moreBtn?.setAttribute("aria-expanded", "false");
    closeLocaleMenu();
    closeCopyListMenu();
  }

  function closeLocaleMenu() {
    elements.localeWrap?.classList.remove("is-open");
    elements.localeToggleBtn?.setAttribute("aria-expanded", "false");
  }

  function toggleListMenu(event) {
    event.stopPropagation();
    closeMenu();
    closeSortMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    const isOpen = elements.listWrap.classList.toggle("is-open");
    elements.listSelect.setAttribute("aria-expanded", String(isOpen));
  }

  function closeListMenu() {
    elements.listWrap?.classList.remove("is-open");
    elements.listSelect?.setAttribute("aria-expanded", "false");
  }

  function toggleSortMenu(event) {
    event.stopPropagation();
    closeMenu();
    closeListMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    renderSortControl();
    const isOpen = elements.sortWrap.classList.toggle("is-open");
    elements.sortSelect.setAttribute("aria-expanded", String(isOpen));
  }

  function closeSortMenu() {
    elements.sortWrap?.classList.remove("is-open");
    elements.sortSelect?.setAttribute("aria-expanded", "false");
  }

  function openAnalysisHistoryMenu() {
    if (!elements.historyMenu?.children.length) {
      closeAnalysisHistoryMenu();
      return;
    }
    closeMenu();
    closeListMenu();
    closeSortMenu();
    closeCopyListMenu();
    elements.historyWrap?.classList.add("is-open");
    elements.targetInput?.setAttribute("aria-expanded", "true");
  }

  function handleAnalysisHistoryInputClick(event) {
    if (!event.isTrusted || event.button !== 0 || event.target !== elements.targetInput) {
      return;
    }
    openAnalysisHistoryMenu();
  }

  function closeAnalysisHistoryMenu() {
    elements.historyWrap?.classList.remove("is-open");
    elements.targetInput?.setAttribute("aria-expanded", "false");
  }

  function handleAnalysisHistoryClick(event) {
    const deleteButton = event.target?.closest?.("[data-sffa-history-delete]");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      deleteAnalysisHistoryEntry(deleteButton.dataset.sffaHistoryDelete || "");
      return;
    }

    const option = event.target?.closest?.("[data-sffa-history-option]");
    if (!option) {
      return;
    }

    const inputValue = option.dataset.sffaHistoryOption || "";
    if (!inputValue) {
      return;
    }

    elements.targetInput.value = inputValue;
    closeAnalysisHistoryMenu();
    analyzeTarget();
  }

  function deleteAnalysisHistoryEntry(inputValue) {
    const normalizedInput = String(inputValue || "").trim();
    if (!normalizedInput) {
      return;
    }

    const saved = loadAnalysisInputHistory();
    const nextEntries = saved.entries.filter(entry => entry.inputValue !== normalizedInput);
    if (nextEntries.length === saved.entries.length) {
      return;
    }

    const nextHistory = {
      ...saved,
      entries: nextEntries,
      lastInputValue: saved.lastInputValue === normalizedInput ? "" : saved.lastInputValue,
      updatedAt: Date.now()
    };
    saveAnalysisInputHistory(nextHistory);
    renderAnalysisHistoryMenu(nextHistory);
  }

  function toggleCopyListMenu(event) {
    event.stopPropagation();
    closeMenu();
    closeListMenu();
    closeSortMenu();
    closeAnalysisHistoryMenu();
    closeFamilyPosterSortMenu();
    const isOpen = elements.copyListWrap.classList.toggle("is-copy-list-open");
    elements.copyListBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function closeCopyListMenu() {
    elements.copyListWrap?.classList.remove("is-copy-list-open");
    elements.copyListBtn?.setAttribute("aria-expanded", "false");
  }

  function toggleFamilyPosterSortMenu(event) {
    event.stopPropagation();
    closeSortMenu();
    const isOpen = elements.familyPosterSortWrap.classList.toggle("is-open");
    elements.familyPosterSortSelect.setAttribute("aria-expanded", String(isOpen));
  }

  function closeFamilyPosterSortMenu() {
    elements.familyPosterSortWrap?.classList.remove("is-open");
    elements.familyPosterSortSelect?.setAttribute("aria-expanded", "false");
  }

  function normalizeFamilyPosterColumns(value) {
    const columns = Number(value || FAMILY_POSTER_COLUMNS);
    const fallbackColumns = Number.isFinite(columns) ? columns : FAMILY_POSTER_COLUMNS;
    return Math.round(Math.max(1, Math.min(30, fallbackColumns)));
  }

  function normalizeFamilyPosterSortMode(value) {
    return FAMILY_POSTER_SORT_MODES.includes(value) ? value : "data";
  }

  function normalizePosterSortMode(value, modes, fallback = "data") {
    return (modes || []).includes(value) ? value : fallback;
  }

  function normalizeFamilyPosterScalePercent(value) {
    return Math.max(40, Math.min(100, Number(value || 100) || 100));
  }

  function normalizeFamilyPosterSettings(settings = {}) {
    return {
      columns: normalizeFamilyPosterColumns(settings.columns),
      sortMode: normalizeFamilyPosterSortMode(settings.sortMode),
      scalePercent: normalizeFamilyPosterScalePercent(settings.scalePercent)
    };
  }

  function normalizeListPosterSettings(settings = {}, tab = currentTab) {
    return {
      columns: normalizeFamilyPosterColumns(settings.columns),
      sortMode: normalizePosterSortMode(settings.sortMode, getListPosterSortModesForTab(tab), "current"),
      scalePercent: normalizeFamilyPosterScalePercent(settings.scalePercent)
    };
  }

  function getFamilyPosterSettings() {
    return normalizeFamilyPosterSettings(state.familyPosterSettings || {});
  }

  function getListPosterSettings(tab = currentTab) {
    return normalizeListPosterSettings({
      ...(state.listPosterSettings || {}),
      sortMode: "current"
    }, tab);
  }

  function setAppLocaleMode(mode) {
    const nextMode = normalizeAppLocaleMode(mode);
    if (nextMode === appLocaleMode) {
      closeMenu();
      return;
    }

    const storeLanguageChanged = setStoreLanguage(getStoreLanguageForAppLocale(nextMode));
    appLocaleMode = nextMode;
    UI_LOCALE = resolveUiLocale(appLocaleMode, STORE_LANG);
    state.appLocaleMode = appLocaleMode;
    saveState();
    closeMenu();
    renderLocalizedUi();
    if (storeLanguageChanged) {
      refreshLocalizedGameNamesAfterLanguageChange();
    }
  }

  function renderLocalizedUi() {
    const compareHint = lastReport && isMultiTargetReport(lastReport) ? t("compareHint", { count: lastReport.target.targets.length }) : "";
    [
      [elements.root.querySelector(".sffa-launcher span"), "textContent", t("launcher")], [elements.root.querySelector(".sffa-title strong"), "textContent", t("launcher")], [elements.localeToggleBtn, "textContent", getLocaleModeButtonText()], [elements.moreBtn, "title", t("more")], [elements.closeBtn, "title", t("close")], [elements.targetInput, "placeholder", t("targetPlaceholder")], [elements.refreshBtn, "textContent", t("refreshFamily")], [elements.analyzeBtn, "textContent", t("analyzeAccount")], [elements.searchInput, "placeholder", t("searchPlaceholder")], [elements.searchClearBtn, "title", t("clear")], [elements.copyBtn, "textContent", t("copyReport")], [elements.saveListPosterBtn, "textContent", t("saveListPoster")], [elements.reloadCoversBtn, "textContent", t("reloadCovers")], [elements.rawBtn, "textContent", t("rawData")], [elements.rateContinueBtn, "textContent", t("continue")], [elements.rateCheckBtn, "textContent", t("rateCheck")], [elements.compareTitle, "textContent", t("compareTitle")], [elements.compareHint, "textContent", compareHint], [elements.compareCloseBtn, "title", t("close")], [elements.globalCompareTitle, "textContent", t("globalCompareTitle")], [elements.globalCompareHint, "textContent", t("globalCompareHint")], [elements.globalCompareCloseBtn, "title", t("close")], [elements.familyPosterTitle, "textContent", t("familyPosterTitle")], [elements.familyPosterHint, "textContent", t("familyPosterHint")], [elements.familyPosterColumnsLabel, "textContent", t("familyPosterColumns")], [elements.familyPosterSortLabel, "textContent", t("familyPosterSort")], [elements.familyPosterScaleLabel, "textContent", t("familyPosterScale")], [elements.familyPosterCancelBtn, "textContent", t("familyPosterCancel")], [elements.familyPosterConfirmBtn, "textContent", t("familyPosterConfirm")], [elements.familyPosterCloseBtn, "title", t("close")]
    ].forEach(([element, key, value]) => {
      if (!element) {
        return;
      }
      if (key === "title") {
        setTooltipText(element, value);
        return;
      }
      element[key] = value;
    });
    [
      [elements.priceSettingsBtn, "textContent", t("priceSettings")],
      [elements.priceTitle, "textContent", t("priceSettingsTitle")],
      [elements.priceHint, "textContent", t("priceSettingsHint")],
      [elements.priceModeLabel, "textContent", t("priceMode")],
      [elements.itadKeyLabel, "textContent", t("itadApiKey")],
      [elements.itadApiKeyInput, "placeholder", t("itadApiKeyPlaceholder")],
      [elements.itadHelpTip, "textContent", t("itadApiHelp")],
      [elements.priceCancelBtn, "textContent", t("familyPosterCancel")],
      [elements.priceConfirmBtn, "textContent", t("priceSettingsSave")],
      [elements.priceCloseBtn, "title", t("close")]
    ].forEach(([element, key, value]) => {
      if (!element) {
        return;
      }
      if (key === "title") {
        setTooltipText(element, value);
        return;
      }
      element[key] = value;
    });
    [
      [elements.launcherCloseBtn, "aria-label", t("hideLauncher")], [elements.listSelect, "aria-label", t("list")], [elements.sortSelect, "aria-label", t("sort")], [elements.moreBtn, "aria-label", t("more")], [elements.searchClearBtn, "aria-label", t("clear")], [elements.compareCloseBtn, "aria-label", t("close")], [elements.globalCompareCloseBtn, "aria-label", t("close")], [elements.viewSwitch, "aria-label", t("viewMode")], [elements.familyPosterCloseBtn, "aria-label", t("close")]
    ].forEach(([element, key, value]) => element.setAttribute(key, value));
    [[elements.priceCloseBtn, "aria-label", t("close")], [elements.itadHelpBtn, "aria-label", t("itadApiHelp")]].forEach(([element, key, value]) => { if (element) element.setAttribute(key, value); });
    setTooltipText(elements.itadHelpBtn, t("itadApiHelp"));
    normalizeNativeTooltipAttributes(elements.root);
    elements.listOptions.forEach(option => { option.textContent = getMainTabLabel(option.dataset.sffaListOption); });
    elements.viewModeButtons.forEach(button => {
      const key = button.dataset.sffaViewMode === "poster"
        ? "viewPoster"
        : button.dataset.sffaViewMode === "cover"
          ? "viewCover"
          : "viewTable";
      button.textContent = t(key);
    });
    elements.priceModeButtons.forEach(button => { button.textContent = getPriceModeOptionLabel(button.dataset.sffaPriceModeOption); });
    elements.root.querySelector("[data-tab='family']").textContent = t("tabs.family");
    elements.localeOptions.forEach(option => { option.textContent = getLocaleModeLabel(option.dataset.sffaLocaleOption); option.classList.toggle("is-active", normalizeAppLocaleMode(option.dataset.sffaLocaleOption) === appLocaleMode); });
    renderPriceSettingsDialog();
    renderFamilyPosterDialog();
    renderCompareDialogIfOpen();
    renderGlobalCompareDialogIfOpen();
    [registerScriptMenuCommands, renderFamilyMeta, renderAutoFamilyRefreshButton, renderOpenLinksClientButton, renderStoreCacheButton, renderRateLimitControls].forEach(fn => fn());
    renderSummary(lastReport);
    renderTargetProfile(lastReport);
    [renderTabs, renderDetailsPreserveScroll, renderCurrentStatusText].forEach(fn => fn());
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

  async function refreshLocalizedGameNamesAfterLanguageChange() {
    applyCachedLocalizedGameNamesForCurrentLanguage();
    renderDetailsPreserveScroll();
    renderCompareDialogIfOpen();

    const appids = getLocalizedNameRefreshAppids();
    const missingAppids = appids.filter(appid => !getCachedLocalizedName(appid));
    if (!missingAppids.length) {
      return;
    }

    try {
      for (let index = 0; index < missingAppids.length; index += SHAREABILITY_BATCH_SIZE) {
        const batch = missingAppids.slice(index, index + SHAREABILITY_BATCH_SIZE);
        await fetchStoreItemBatch(batch, {
          include_basic_info: true,
          include_assets: true
        }, `localizedNames.batch${Date.now()}.${index}`);
      }
      saveState();
      renderDetailsPreserveScroll();
      renderCompareDialogIfOpen();
      applyVisibleCoverImages();
      scheduleVisibleCoverLoads();
    } catch (error) {
      setRawError(error);
    }
  }

  function applyCachedLocalizedGameNamesForCurrentLanguage() {
    ["all", "new", "overlap", "unpriced"].forEach(listName => {
      (lastReport?.games?.[listName] || []).forEach(game => {
        game.localizedName = getCachedLocalizedName(game.appid) || "";
      });
    });
    Object.values(state.familyLibrary?.appInfoById || {}).forEach(game => {
      game.localizedName = getCachedLocalizedName(game.appid) || "";
    });
  }

  function getLocalizedNameRefreshAppids() {
    const appids = new Set((state.familyLibrary?.appidSet || []).map(String));
    ["all", "new", "overlap", "unpriced"].forEach(listName => {
      (lastReport?.games?.[listName] || []).forEach(game => {
        if (game?.appid) {
          appids.add(String(game.appid));
        }
      });
    });
    return Array.from(appids).filter(appid => /^\d+$/.test(appid));
  }

  function openPriceSettingsDialog() {
    closeMenu();
    renderPriceSettingsDialog();
    elements.root?.classList.add("is-price-settings-open");
    window.setTimeout(() => elements.itadApiKeyInput?.focus(), 0);
  }

  function closePriceSettingsDialog() {
    elements.root?.classList.remove("is-price-settings-open");
  }

  function renderPriceSettingsDialog() {
    const config = normalizePriceConfig(state.priceConfig || {});
    elements.priceModeButtons?.forEach(button => {
      const active = normalizePriceMode(button.dataset.sffaPriceModeOption) === config.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (elements.itadApiKeyInput) {
      elements.itadApiKeyInput.value = config.itadApiKey;
    }
  }

  function getPriceModeOptionLabel(mode) {
    const normalizedMode = normalizePriceMode(mode);
    if (normalizedMode === PRICE_MODE_HISTORY_LOW) {
      return t("priceModeHistoryLow");
    }
    return normalizedMode === PRICE_MODE_CURRENT ? t("priceModeCurrent") : t("priceModeOriginal");
  }

  function selectPriceSettingsMode(mode) {
    const nextMode = normalizePriceMode(mode);
    elements.priceModeButtons?.forEach(button => {
      const active = normalizePriceMode(button.dataset.sffaPriceModeOption) === nextMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function confirmPriceSettingsDialog() {
    const selectedMode = normalizePriceMode(elements.priceModeButtons.find(button => button.classList.contains("is-active"))?.dataset.sffaPriceModeOption);
    const nextConfig = normalizePriceConfig({
      mode: selectedMode,
      itadApiKey: elements.itadApiKeyInput?.value || ""
    });
    const previousConfig = normalizePriceConfig(state.priceConfig || {});
    const changed = previousConfig.mode !== nextConfig.mode || previousConfig.itadApiKey !== nextConfig.itadApiKey;

    state.priceConfig = nextConfig;
    saveState();
    closePriceSettingsDialog();
    setStatus(nextConfig.mode === PRICE_MODE_HISTORY_LOW && !nextConfig.itadApiKey ? t("historyLowNeedsApiKey") : t("priceSettingsSaved"), nextConfig.mode === PRICE_MODE_HISTORY_LOW && !nextConfig.itadApiKey ? "warn" : "ok");
    if (changed) {
      refreshPricesAfterPriceConfigChange();
    }
  }

  function openItadApiPage(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const win = window.open(ITAD_API_PAGE_URL, "_blank", "noopener");
    if (!win) {
      setStatus(t("popupBlocked"), "warn");
    }
  }

  function refreshPricesAfterPriceConfigChange() {
    priceLoadState = createPriceLoadState();
    if (lastReport?.games?.new) {
      prepareOriginalPrices(lastReport.games.new);
      refreshReportMetrics();
      renderSummary(lastReport);
    }
    renderTabs();
    renderDetailsPreserveScroll();
    scheduleVisiblePriceLoads();
  }

  function openFamilyPosterDialog() {
    closeMenu();
    openPosterDialog(createFamilyPosterDialogContext());
  }

  function openListPosterDialog() {
    closeCopyListMenu();
    if (!lastReport && currentTab !== "family") {
      setStatus(t("noList"), "warn");
      return;
    }
    if (!getCurrentListRows(currentTab).length) {
      setStatus(t("currentListEmpty"), "warn");
      return;
    }
    openPosterDialog(createListPosterDialogContext(currentTab));
  }

  function openPosterDialog(context) {
    activePosterDialogContext = context;
    syncFamilyPosterDialogInputsFromContext(context);
    renderFamilyPosterDialog();
    elements.root.classList.add("is-family-poster-open");
  }

  function closeFamilyPosterDialog() {
    closeFamilyPosterSortMenu();
    elements.root.classList.remove("is-family-poster-open");
    activePosterDialogContext = null;
  }

  function confirmSaveFamilyPoster() {
    const context = getActivePosterDialogContext();
    const settings = readFamilyPosterSettingsFromDialog(context);
    context.saveSettings(settings);
    saveState();
    closeFamilyPosterDialog();
    context.generate(settings);
  }

  function syncFamilyPosterDialogInputsFromContext(context = getActivePosterDialogContext()) {
    const settings = context.settings;
    if (elements.familyPosterSortSelect) {
      elements.familyPosterSortSelect.dataset.selectedSortMode = normalizePosterSortMode(settings.sortMode, context.sortModes, context.defaultSortMode);
    }
    if (elements.familyPosterColumnsInput) {
      elements.familyPosterColumnsInput.value = String(settings.columns);
    }
    if (elements.familyPosterScaleInput) {
      elements.familyPosterScaleInput.value = String(settings.scalePercent);
    }
    updateFamilyPosterScaleValue();
  }

  function readFamilyPosterSettingsFromDialog(context = getActivePosterDialogContext()) {
    return normalizePosterSettingsForContext({
      columns: elements.familyPosterColumnsInput?.value,
      sortMode: elements.familyPosterSortSelect?.dataset.selectedSortMode,
      scalePercent: elements.familyPosterScaleInput?.value
    }, context);
  }

  function renderFamilyPosterDialog() {
    const context = getActivePosterDialogContext();
    if (elements.familyPosterTitle) {
      elements.familyPosterTitle.textContent = context.title;
    }
    if (elements.familyPosterHint) {
      elements.familyPosterHint.textContent = context.hint;
    }
    if (elements.familyPosterSortSelect && elements.familyPosterSortMenu) {
      const currentValue = normalizePosterSortMode(elements.familyPosterSortSelect.dataset.selectedSortMode || context.settings.sortMode, context.sortModes, context.defaultSortMode);
      elements.familyPosterSortSelect.dataset.selectedSortMode = currentValue;
      elements.familyPosterSortSelect.textContent = getFamilyPosterSortModeLabel(currentValue);
      elements.familyPosterSortMenu.innerHTML = context.sortModes.map(mode => {
        const active = mode === currentValue;
        return `<button class="sffa-list-option${active ? " is-active" : ""}" type="button" role="option" data-sffa-family-poster-sort-option="${escapeAttr(mode)}" aria-selected="${active ? "true" : "false"}">${escapeHtml(getFamilyPosterSortModeLabel(mode))}</button>`;
      }).join("");
      Array.from(elements.familyPosterSortMenu.querySelectorAll("[data-sffa-family-poster-sort-option]")).forEach(option => {
        option.addEventListener("click", () => setFamilyPosterSortMode(option.dataset.sffaFamilyPosterSortOption));
      });
    }
    updateFamilyPosterScaleValue();
  }

  function setFamilyPosterSortMode(mode) {
    const context = getActivePosterDialogContext();
    const nextMode = normalizePosterSortMode(mode, context.sortModes, context.defaultSortMode);
    if (elements.familyPosterSortSelect) {
      elements.familyPosterSortSelect.dataset.selectedSortMode = nextMode;
    }
    renderFamilyPosterDialog();
    closeFamilyPosterSortMenu();
  }

  function updateFamilyPosterScaleValue() {
    if (!elements.familyPosterScaleValue || !elements.familyPosterScaleInput) {
      return;
    }
    elements.familyPosterScaleValue.textContent = t("familyPosterScaleValue", { value: normalizeFamilyPosterScalePercent(elements.familyPosterScaleInput.value) });
  }

  function getFamilyPosterSortModeLabel(mode) {
    return {
      current: t("listPosterOrderCurrent"),
      data: t("familyPosterOrderData"),
      titleAsc: t("familyPosterOrderTitleAsc"),
      titleDesc: t("familyPosterOrderTitleDesc"),
      appidAsc: t("familyPosterOrderAppidAsc"),
      appidDesc: t("familyPosterOrderAppidDesc"),
      priceDesc: t("familyPosterOrderPriceDesc"),
      priceAsc: t("familyPosterOrderPriceAsc"),
      acquiredDesc: t("familyPosterOrderAcquiredDesc"),
      acquiredAsc: t("familyPosterOrderAcquiredAsc"),
      ownersAsc: t("familyPosterOrderOwnersAsc"),
      ownersDesc: t("familyPosterOrderOwnersDesc"),
      targetOwnersAsc: t("familyPosterOrderTargetOwnersAsc"),
      targetOwnersDesc: t("familyPosterOrderTargetOwnersDesc"),
      statusAsc: t("familyPosterOrderStatusAsc"),
      statusDesc: t("familyPosterOrderStatusDesc"),
      ownerCountDesc: t("familyPosterOrderOwnerCountDesc"),
      ownerCountAsc: t("familyPosterOrderOwnerCountAsc"),
      hasCoverFirst: t("familyPosterOrderHasCoverFirst"),
      noCoverFirst: t("familyPosterOrderNoCoverFirst")
    }[mode] || t("familyPosterOrderData");
  }

  function getActivePosterDialogContext() {
    return activePosterDialogContext || createFamilyPosterDialogContext();
  }

  function createFamilyPosterDialogContext() {
    return {
      kind: "family",
      title: t("familyPosterTitle"),
      hint: t("familyPosterHint"),
      headerTitle: state.familyInfo?.family_name || t("notRefreshed"),
      sortModes: FAMILY_POSTER_SORT_MODES,
      defaultSortMode: "data",
      settings: getFamilyPosterSettings(),
      saveSettings(settings) {
        state.familyPosterSettings = settings;
      },
      generate(settings) {
        return generateFamilyPoster(settings);
      }
    };
  }

  function createListPosterDialogContext(tab = currentTab) {
    const normalizedTab = normalizeMainTab(tab);
    const tabLabel = getTabLabel(normalizedTab);
    return {
      kind: "list",
      tab: normalizedTab,
      title: t("listPosterTitle"),
      hint: t("listPosterHint", { tab: tabLabel }),
      headerTitle: tabLabel,
      sortModes: getListPosterSortModesForTab(normalizedTab),
      defaultSortMode: "current",
      settings: getListPosterSettings(normalizedTab),
      saveSettings(settings) {
        state.listPosterSettings = {
          columns: settings.columns,
          scalePercent: settings.scalePercent
        };
      },
      generate(settings) {
        return generateListPoster(normalizedTab, settings);
      }
    };
  }

  function createListPosterCanvasContext(tab = currentTab) {
    return {
      kind: "list",
      headerTitle: getTabLabel(normalizeMainTab(tab))
    };
  }

  function getListPosterSortModesForTab(tab = currentTab) {
    const normalizedTab = normalizeMainTab(tab);
    const modes = [...LIST_POSTER_BASE_SORT_MODES];
    if (normalizedTab === "all") {
      if (isMultiTargetReport()) {
        modes.push("targetOwnersAsc", "targetOwnersDesc");
      }
      modes.push("statusAsc", "statusDesc");
    } else if (normalizedTab === "new") {
      if (isMultiTargetReport()) {
        modes.push("targetOwnersAsc", "targetOwnersDesc");
      }
      modes.push("priceDesc", "priceAsc");
    } else if (normalizedTab === "relativeNew") {
      modes.push("ownersAsc", "ownersDesc", "priceDesc", "priceAsc");
    } else if (normalizedTab === "family") {
      modes.push("ownersAsc", "ownersDesc", "acquiredDesc", "acquiredAsc");
    } else if (normalizedTab === "overlap") {
      modes.push("ownersAsc", "ownersDesc");
    }
    return modes;
  }

  function normalizePosterSettingsForContext(settings = {}, context = getActivePosterDialogContext()) {
    return {
      columns: normalizeFamilyPosterColumns(settings.columns),
      sortMode: normalizePosterSortMode(settings.sortMode, context.sortModes, context.defaultSortMode),
      scalePercent: normalizeFamilyPosterScalePercent(settings.scalePercent)
    };
  }

  // ===== 家庭库刷新与分析流程 =====

  async function refreshFamilyLibrary() {
    try {
      openDialog();
      setBusy(true);
      const session = prepareFamilyRefreshSession();
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

  function prepareFamilyRefreshSession() {
    resetRawData("refresh-family-library");
    setStatus(t("refreshing"), "warn");
    const session = getSteamSession();
    if (!session.isLoggedIn || !session.accessToken || !session.steamid) {
      throw new Error(t("notLoggedInOrExpired"));
    }
    return session;
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
      const rawInput = prepareAnalyzeInput();
      const session = prepareAnalyzeSession();
      const targetProfile = await loadAnalyzeTargetProfile(rawInput, session);
      rememberAnalysisInput(rawInput, targetProfile);
      const comparison = await buildAnalyzeComparison(targetProfile, session);
      const analysisId = initializeAnalysisRuntime(targetProfile);
      lastReport = createPendingAnalysisReport(targetProfile, comparison);
      renderInitialAnalysisResult(lastReport);
      startAnalysisBackgroundWork(analysisId, targetProfile, comparison);
    } catch (error) {
      setRawError(error);
      setStatus(error.message, "err");
    } finally {
      setBusy(false);
    }
  }

  function prepareAnalyzeInput() {
    resetRawData("analyze-target");
    const rawInput = elements.targetInput.value.trim();
    if (!rawInput) {
      throw new Error(t("enterAccount"));
    }
    return rawInput;
  }

  function prepareAnalyzeSession() {
    setRawStep("check-family-cache");
    return ensureFamilyReady();
  }

  async function loadAnalyzeTargetProfile(rawInput, session) {
    setStatus(t("readApiKey"), "warn");
    setRawStep("read-steam-web-api-key");
    await autoReadApiKeyFromCommunity({ keepBusy: true });

    setStatus(t("readTargetLibrary"), "warn");
    setRawStep("fetch-target-owned-games");
    const targetProfile = await getTargetProfile(rawInput);
    if (getTargetSteamIds(targetProfile).includes(session.steamid)) {
      throw new Error(t("currentAccountUnsupported"));
    }
    return targetProfile;
  }

  async function buildAnalyzeComparison(targetProfile, session) {
    setRawStep("fetch-current-owned-games");
    const currentOwnedAppids = await fetchCurrentOwnedAppids(session.steamid, state.apiKey);
    setStatus(t("compareLibraries"), "warn");
    setRawStep("compare-libraries");
    return compareLibraries(targetProfile, currentOwnedAppids);
  }

  function initializeAnalysisRuntime(targetProfile) {
    const analysisId = ++activeAnalysisId;
    priceLoadState = createPriceLoadState();
    shareabilityFilterState = createShareabilityFilterState(analysisId, 0, targetProfile.games.length, targetProfile.games.length);
    if (shareabilityProgressUiState?.timer) {
      window.clearTimeout(shareabilityProgressUiState.timer);
    }
    shareabilityProgressUiState = createShareabilityProgressUiState(analysisId);
    return analysisId;
  }

  function createPendingAnalysisReport(targetProfile, comparison) {
    setRawStep("build-report");
    return buildReport(targetProfile, {
      ...comparison,
      allGames: targetProfile.games,
      pendingNewGames: comparison.newGames,
      newGames: []
    });
  }

  function renderInitialAnalysisResult(report) {
    currentTab = "all";
    renderTabs();
    renderSummary(report);
    renderTargetProfile(report);
    renderDetails();
  }

  function startAnalysisBackgroundWork(analysisId, targetProfile, comparison) {
    setStatus(t("shownAllProgress", {
      percent: formatPercent(targetProfile.games.length ? comparison.overlapGames.length / targetProfile.games.length : 0)
    }), "warn");
    setRawStep("background-load-store-items");
    window.setTimeout(() => {
      startBackgroundShareabilityFilter(analysisId, targetProfile.games);
    }, 0);
  }

  async function copyReportSummary() {
    closeMenu();
    closeCopyListMenu();
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
      labelValue(getAddedValueLabel(), formatMoney(lastReport.metrics.initialValue))
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      setStatus(t("copied"), "ok");
    } catch (error) {
      setStatus(t("copyFailed"), "err");
    }
  }

  async function copyCurrentList() {
    closeCopyListMenu();
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

  async function copyCurrentGamesOnly() {
    closeCopyListMenu();
    const rows = getCurrentListRows();
    if (!lastReport && currentTab !== "family") {
      setStatus(t("noList"), "warn");
      return;
    }

    if (rows.length === 0) {
      setStatus(t("currentListEmpty"), "warn");
      return;
    }

    const names = rows.map(game => getGameDisplayName(game));
    try {
      await navigator.clipboard.writeText(names.join("\n"));
      setStatus(t("copiedGames"), "ok");
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

  function toggleOpenLinksInSteamClient() {
    closeMenu();
    state.openLinksInSteamClient = !state.openLinksInSteamClient;
    saveState();
    renderOpenLinksClientButton();
    renderTargetProfile(lastReport);
    renderDetailsPreserveScroll();
    renderCompareDialogIfOpen();
    setStatus(state.openLinksInSteamClient ? t("openLinksInClientEnabled") : t("openLinksInClientDisabled"), "ok");
  }

  function clearStoreCache() {
    closeMenu();
    state.storeCache = { [STORE_CACHE_BUCKETS_KEY]: {} };
    saveState();
    renderStoreCacheButton();
    setStatus(t("storeCacheCleared"), "ok");
  }

  async function reloadCovers() {
    closeCopyListMenu();
    setBusy(true);
    try {
      await refetchVisibleCoverUrls();
      saveState();
      renderStoreCacheButton();
      setStatus(t("coversReloaded"), "ok");
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimited(error, "cover");
      } else {
        setRawError(error);
        setStatus(error.message || t("networkFailed"), "err");
      }
    } finally {
      setBusy(false);
    }
    coverReloadToken = Date.now();
    renderDetailsPreserveScroll();
    renderCompareDialogIfOpen();
  }

  async function generateFamilyPoster(settings = getFamilyPosterSettings()) {
    closeMenu();
    setBusy(true);
    try {
      const appids = (state.familyLibrary?.appidSet || []).map(String).filter(appid => /^\d+$/.test(appid));
      if (!appids.length) {
        throw new Error(t("familyPosterEmpty"));
      }
      setStatus(t("preparingFamilyPoster"), "warn");
      await ensurePosterStoreItems(appids, {
        statusKey: "fetchingFamilyPoster",
        rawPrefix: "familyPoster"
      });
      const posterItems = buildFamilyPosterItems(appids, settings);
      if (!posterItems.length) {
        throw new Error(t("familyPosterEmpty"));
      }
      setStatus(t("renderingFamilyPoster"), "warn");
      const canvas = await renderFamilyPosterCanvas(posterItems, settings, createFamilyPosterDialogContext());
      await downloadCanvasAsPng(canvas, buildFamilyPosterFilename(settings));
      setStatus(t("familyPosterSaved"), "ok");
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimited(error, "cover");
      } else {
        setRawError(error);
        setStatus(error.message || t("networkFailed"), "err");
      }
    } finally {
      setBusy(false);
    }
  }

  async function generateListPoster(tab, settings = getListPosterSettings(tab)) {
    closeCopyListMenu();
    setBusy(true);
    try {
      const rows = getCurrentListRows(tab);
      const appids = rows.map(game => String(game.appid || "")).filter(appid => /^\d+$/.test(appid));
      if (!appids.length) {
        throw new Error(t("listPosterEmpty"));
      }
      setStatus(t("preparingListPoster"), "warn");
      await ensurePosterStoreItems(appids, {
        statusKey: "fetchingListPoster",
        rawPrefix: "listPoster"
      });
      const posterItems = buildListPosterItems(rows, settings);
      if (!posterItems.length) {
        throw new Error(t("listPosterEmpty"));
      }
      setStatus(t("renderingListPoster"), "warn");
      const canvas = await renderFamilyPosterCanvas(posterItems, settings, createListPosterCanvasContext(tab));
      await downloadCanvasAsPng(canvas, buildListPosterFilename(tab, settings));
      setStatus(t("listPosterSaved"), "ok");
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimited(error, "cover");
      } else {
        setRawError(error);
        setStatus(error.message || t("networkFailed"), "err");
      }
    } finally {
      setBusy(false);
    }
  }

  async function ensurePosterStoreItems(appids, options = {}) {
    const missing = appids.filter(appid => !hasFreshPosterStoreItem(appid));
    if (!missing.length) {
      return;
    }
    const total = Math.ceil(missing.length / SHAREABILITY_BATCH_SIZE);
    for (let index = 0; index < missing.length; index += SHAREABILITY_BATCH_SIZE) {
      setStatus(t(options.statusKey || "fetchingFamilyPoster", { current: Math.floor(index / SHAREABILITY_BATCH_SIZE) + 1, total }), "warn");
      await fetchStoreItemBatch(missing.slice(index, index + SHAREABILITY_BATCH_SIZE), {
        include_basic_info: true,
        include_assets: true,
        include_all_purchase_options: true
      }, `${options.rawPrefix || "poster"}.batch${Date.now()}.${index}`);
    }
    saveState();
  }

  function hasFreshPosterStoreItem(appid) {
    const entry = getStoreCacheEntry(appid);
    return Boolean(isFreshStoreItemCacheEntry(entry));
  }

  function buildFamilyPosterItems(appids, settings = getFamilyPosterSettings()) {
    const items = appids.map((appid, index) => {
      const familyInfo = state.familyLibrary?.appInfoById?.[String(appid)] || {};
      const price = resolveGamePrice({ appid });
      return {
        appid: String(appid),
        dataIndex: index,
        title: getCachedLocalizedName(appid) || familyInfo.name || `App ${appid}`,
        coverUrl: getFamilyPosterCoverUrl(appid),
        priceValue: Number(price?.initial ?? -1),
        acquiredAt: Number(familyInfo.time || 0),
        ownerCount: Array.isArray(familyInfo.owners) ? familyInfo.owners.length : 0
      };
    });
    return sortFamilyPosterItems(items, settings);
  }

  function buildListPosterItems(rows, settings = getListPosterSettings(currentTab)) {
    const items = rows.map((game, index) => {
      const appid = String(game.appid || "");
      const price = resolveGamePrice(game);
      return {
        appid,
        dataIndex: index,
        title: getCachedLocalizedName(appid) || getGameDisplayName(game),
        coverUrl: getFamilyPosterCoverUrl(appid),
        priceValue: getPosterPriceSortValue(price),
        acquiredAt: Number(game.time || 0),
        ownerCount: Array.isArray(game.owners) ? game.owners.length : 0,
        ownersText: formatOwners(game.owners || []),
        targetOwnersText: formatTargetOwners(game.targetOwners || []),
        statusText: getGameListLabel(appid)
      };
    });
    return sortFamilyPosterItems(items, settings);
  }

  function getFamilyPosterCoverUrl(appid) {
      const entry = getStoreCacheEntry(appid);
    return extractStorePosterCoverUrlFromStoreItem(entry?.storeItem || null) || getCachedStoreCoverUrl(appid);
  }

  function getPosterPriceSortValue(price) {
    if (!price || price.unavailable || price.initial == null) {
      return Number.NEGATIVE_INFINITY;
    }
    return Number(price.initial || 0);
  }

  function sortFamilyPosterItems(items, settings = getFamilyPosterSettings()) {
    const sortMode = String(settings.sortMode || "data");
    const output = items.slice();
    if (sortMode === "data" || sortMode === "current") {
      return output;
    }
    const collator = new Intl.Collator(getNumberLocale(), { numeric: true, sensitivity: "base" });
    const compareText = (left, right, key, direction = "asc") => {
      const result = collator.compare(String(left[key] || ""), String(right[key] || ""));
      return direction === "desc" ? -result : result;
    };
    output.sort((left, right) => {
      switch (sortMode) {
        case "titleAsc":
          return collator.compare(left.title, right.title) || left.dataIndex - right.dataIndex;
        case "titleDesc":
          return collator.compare(right.title, left.title) || left.dataIndex - right.dataIndex;
        case "appidAsc":
          return Number(left.appid || 0) - Number(right.appid || 0) || left.dataIndex - right.dataIndex;
        case "appidDesc":
          return Number(right.appid || 0) - Number(left.appid || 0) || left.dataIndex - right.dataIndex;
        case "priceDesc":
          return Number(right.priceValue || -1) - Number(left.priceValue || -1) || left.dataIndex - right.dataIndex;
        case "priceAsc":
          return Number(left.priceValue || -1) - Number(right.priceValue || -1) || left.dataIndex - right.dataIndex;
        case "acquiredDesc":
          return Number(right.acquiredAt || 0) - Number(left.acquiredAt || 0) || left.dataIndex - right.dataIndex;
        case "acquiredAsc":
          return Number(left.acquiredAt || 0) - Number(right.acquiredAt || 0) || left.dataIndex - right.dataIndex;
        case "ownersAsc":
          return compareText(left, right, "ownersText") || left.dataIndex - right.dataIndex;
        case "ownersDesc":
          return compareText(left, right, "ownersText", "desc") || left.dataIndex - right.dataIndex;
        case "targetOwnersAsc":
          return compareText(left, right, "targetOwnersText") || left.dataIndex - right.dataIndex;
        case "targetOwnersDesc":
          return compareText(left, right, "targetOwnersText", "desc") || left.dataIndex - right.dataIndex;
        case "statusAsc":
          return compareText(left, right, "statusText") || left.dataIndex - right.dataIndex;
        case "statusDesc":
          return compareText(left, right, "statusText", "desc") || left.dataIndex - right.dataIndex;
        case "ownerCountDesc":
          return Number(right.ownerCount || 0) - Number(left.ownerCount || 0) || left.dataIndex - right.dataIndex;
        case "ownerCountAsc":
          return Number(left.ownerCount || 0) - Number(right.ownerCount || 0) || left.dataIndex - right.dataIndex;
        case "hasCoverFirst":
          return Number(Boolean(right.coverUrl)) - Number(Boolean(left.coverUrl)) || left.dataIndex - right.dataIndex;
        case "noCoverFirst":
          return Number(Boolean(left.coverUrl)) - Number(Boolean(right.coverUrl)) || left.dataIndex - right.dataIndex;
        default:
          return left.dataIndex - right.dataIndex;
      }
    });
    return output;
  }

  async function renderFamilyPosterCanvas(items, settings = getFamilyPosterSettings(), posterContext = createFamilyPosterDialogContext()) {
    const loadedItems = await loadFamilyPosterImages(items);
    const metrics = createFamilyPosterMetrics();
    const layout = buildFamilyPosterLayout(loadedItems, metrics, settings);
    if (layout.height > FAMILY_POSTER_MAX_HEIGHT) {
      throw new Error(t(posterContext.kind === "list" ? "listPosterTooLarge" : "familyPosterTooLarge"));
    }
    const canvas = document.createElement("canvas");
    canvas.width = metrics.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(t("networkFailed"));
    }
    drawFamilyPosterBackground(context, canvas.width, canvas.height);
    drawFamilyPosterHeader(context, canvas.width, items.length, metrics, posterContext);
    layout.cards.forEach(card => drawFamilyPosterCard(context, card, metrics));
    return scaleFamilyPosterCanvas(canvas, settings);
  }

  async function loadFamilyPosterImages(items) {
    const results = new Array(items.length);
    let cursor = 0;
    const workerCount = Math.min(FAMILY_POSTER_IMAGE_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await loadFamilyPosterImage(items[index]);
      }
    }));
    return results.filter(Boolean);
  }

  function loadFamilyPosterImage(item) {
    return new Promise(resolve => {
      if (!item.coverUrl) {
        resolve({
          ...item,
          image: null,
          width: 2,
          height: 3
        });
        return;
      }
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve({
        ...item,
        image,
        width: image.naturalWidth || image.width || 1,
        height: image.naturalHeight || image.height || 1
      });
      image.onerror = () => resolve({
        ...item,
        image: null,
        width: 2,
        height: 3
      });
      image.src = item.coverUrl;
    });
  }

  function createFamilyPosterMetrics() {
    return {
      scale: 1,
      width: FAMILY_POSTER_WIDTH,
      padding: FAMILY_POSTER_PADDING,
      gap: FAMILY_POSTER_GAP,
      cardWidth: FAMILY_POSTER_CARD_WIDTH,
      headerHeight: FAMILY_POSTER_HEADER_HEIGHT,
      radius: 8,
      titleFontSize: 18,
      titleLineHeight: 20,
      emptyTitleTop: 44,
      headerTitleFontSize: 42,
      headerMetaFontSize: 24,
      cardAspectRatio: FAMILY_POSTER_CARD_ASPECT_RATIO
    };
  }

  function scaleFamilyPosterCanvas(canvas, settings = getFamilyPosterSettings()) {
    const scale = normalizeFamilyPosterScalePercent(settings.scalePercent) / 100;
    if (scale >= 1) {
      return canvas;
    }
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(canvas.width * scale));
    output.height = Math.max(1, Math.round(canvas.height * scale));
    const outputContext = output.getContext("2d");
    if (!outputContext) {
      return canvas;
    }
    outputContext.drawImage(canvas, 0, 0, output.width, output.height);
    return output;
  }

  function buildFamilyPosterLayout(items, metrics, settings = getFamilyPosterSettings()) {
    const columns = normalizeFamilyPosterColumns(settings.columns);
    const cardWidth = metrics.cardWidth;
    const cardHeight = Math.max(160, Math.round(cardWidth * metrics.cardAspectRatio));
    metrics.width = metrics.padding * 2 + columns * cardWidth + Math.max(0, columns - 1) * metrics.gap;
    const columnHeights = Array(columns).fill(metrics.headerHeight + metrics.padding);
    const cards = items.map(item => {
      const targetColumn = columnHeights.indexOf(Math.min(...columnHeights));
      const card = {
        ...item,
        x: metrics.padding + targetColumn * (cardWidth + metrics.gap),
        y: columnHeights[targetColumn],
        width: cardWidth,
        height: cardHeight
      };
      columnHeights[targetColumn] += cardHeight + metrics.gap;
      return card;
    });
    return {
      cards,
      height: Math.max(...columnHeights) + metrics.padding
    };
  }

  function drawFamilyPosterBackground(context, width, height) {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#14202b");
    gradient.addColorStop(1, "#0b1016");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(102, 192, 244, 0.08)";
    context.beginPath();
    context.arc(220, 110, 180, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(width - 240, 180, 220, 0, Math.PI * 2);
    context.fill();
  }

  function drawFamilyPosterHeader(context, width, gameCount, metrics, posterContext = createFamilyPosterDialogContext()) {
    const familyName = posterContext.headerTitle || state.familyInfo?.family_name || t("notRefreshed");
    context.fillStyle = "#ffffff";
    context.font = `700 ${metrics.headerTitleFontSize}px 'Motiva Sans', Arial, sans-serif`;
    context.fillText(familyName, metrics.padding, Math.round(56 * metrics.scale));
    context.fillStyle = "#9fb3c2";
    context.font = `${metrics.headerMetaFontSize}px 'Motiva Sans', Arial, sans-serif`;
    const metaY = Math.round(94 * metrics.scale);
    const stamp = formatDateTime(Date.now());
    context.fillText(`${gameCount} ${UI_LOCALE === "en" ? "games" : "款游戏"}`, metrics.padding, metaY);
    context.fillText(stamp, width - metrics.padding - context.measureText(stamp).width, metaY);
  }

  function drawFamilyPosterCard(context, card, metrics) {
    context.save();
    roundRectPath(context, card.x, card.y, card.width, card.height, metrics.radius);
    context.fillStyle = "#0f141b";
    context.fill();
    context.clip();
    if (card.image) {
      const actualFit = getPosterImageFit(card.width, card.height, card.image.naturalWidth || card.width, card.image.naturalHeight || card.height);
      context.drawImage(card.image, card.x + actualFit.x, card.y + actualFit.y, actualFit.width, actualFit.height);
    } else {
      context.fillStyle = "#18222c";
      context.fillRect(card.x, card.y, card.width, card.height);
      context.fillStyle = "rgba(255, 255, 255, 0.06)";
      context.fillRect(card.x, card.y, card.width, 1);
      context.fillStyle = "#ffffff";
      context.font = `600 ${metrics.titleFontSize}px 'Motiva Sans', Arial, sans-serif`;
      const emptyTitleLines = wrapPosterTextLines(context, card.title, card.width - 24);
      fillPosterTextCentered(context, emptyTitleLines, card.x + card.width / 2, card.y + metrics.emptyTitleTop, metrics.titleLineHeight);
      context.restore();
      return;
    }
    const overlay = context.createLinearGradient(0, card.y + card.height * 0.45, 0, card.y + card.height);
    overlay.addColorStop(0, "rgba(8, 12, 18, 0)");
    overlay.addColorStop(1, "rgba(8, 12, 18, 0.9)");
    context.fillStyle = overlay;
    context.fillRect(card.x, card.y, card.width, card.height);
    context.fillStyle = "#ffffff";
    context.font = `600 ${metrics.titleFontSize}px 'Motiva Sans', Arial, sans-serif`;
    const titleLines = wrapPosterTextLines(context, card.title, card.width - 24);
    const startY = card.y + card.height - Math.round(16 * metrics.scale) - Math.max(0, titleLines.length - 1) * metrics.titleLineHeight;
    fillPosterText(context, titleLines, card.x + 12, startY, metrics.titleLineHeight);
    context.restore();
  }

  function getPosterImageFit(cardWidth, cardHeight, imageWidth, imageHeight) {
    const scale = Math.min(cardWidth / Math.max(1, imageWidth), cardHeight / Math.max(1, imageHeight));
    const width = Math.max(1, Math.round(imageWidth * scale));
    const height = Math.max(1, Math.round(imageHeight * scale));
    return {
      width,
      height,
      x: Math.round((cardWidth - width) / 2),
      y: Math.round((cardHeight - height) / 2)
    };
  }

  function roundRectPath(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }

  function wrapPosterTextLines(context, text, maxWidth) {
    const normalized = String(text || "").trim();
    if (!normalized) {
      return [];
    }
    const chars = Array.from(normalized);
    const lines = [];
    let current = "";
    chars.forEach(char => {
      const next = current + char;
      if (context.measureText(next).width <= maxWidth || !current) {
        current = next;
        return;
      }
      lines.push(current);
      current = char;
    });
    if (current) {
      lines.push(current);
    }
    return lines;
  }

  function fillPosterText(context, lines, x, y, lineHeight) {
    (lines || []).forEach((line, index) => {
      context.fillText(String(line || ""), x, y + index * lineHeight);
    });
  }

  function fillPosterTextCentered(context, lines, centerX, y, lineHeight) {
    (lines || []).forEach((line, index) => {
      const text = String(line || "");
      const textWidth = context.measureText(text).width;
      context.fillText(text, centerX - textWidth / 2, y + index * lineHeight);
    });
  }

  async function downloadCanvasAsPng(canvas, filename) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error(t("networkFailed"));
    }
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function buildFamilyPosterFilename(settings = getFamilyPosterSettings()) {
    const familyName = sanitizeFilename(state.familyInfo?.family_name || "steam-family");
    const stamp = new Date().toISOString().slice(0, 10);
    const normalized = normalizeFamilyPosterSettings(settings);
    return `${familyName || "steam-family"}-covers-${normalized.columns}-${normalized.sortMode}-${normalized.scalePercent}%-${stamp}.png`;
  }

  function buildListPosterFilename(tab, settings = getListPosterSettings(tab)) {
    const title = sanitizeFilename(getTabLabel(normalizeMainTab(tab)) || "steam-list");
    const stamp = new Date().toISOString().slice(0, 10);
    const normalized = normalizeListPosterSettings(settings, tab);
    return `${title || "steam-list"}-poster-${normalized.columns}-${normalized.sortMode}-${normalized.scalePercent}%-${stamp}.png`;
  }

  function sanitizeFilename(value) {
    return String(value || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
  }

  async function refetchVisibleCoverUrls() {
    const appids = getCurrentViewVisibleCoverAppids();
    if (!appids.length) {
      return;
    }
    for (const appid of appids) {
      clearCachedStoreCoverUrl(appid);
    }
    for (let index = 0; index < appids.length; index += COVER_RELOAD_BATCH_SIZE) {
      await fetchCoverUrlBatch(appids.slice(index, index + COVER_RELOAD_BATCH_SIZE));
    }
  }

  function getCurrentViewVisibleCoverAppids() {
    if (getListViewMode() === "cover") {
      return getVisibleAppidsFromContainer(elements.tableWrap, ".sffa-cover-card");
    }
    if (getListViewMode() === "poster") {
      return getVisibleAppidsFromContainer(elements.tableWrap, ".sffa-poster-card");
    }
    return getVisibleAppidsFromContainer(elements.tableWrap, ".sffa-game-thumb[data-sffa-cover-appid]");
  }

  function getVisibleCoverAppids() {
    const appids = new Set();
    getCurrentViewVisibleCoverAppids().forEach(appid => appids.add(appid));
    if (isCompareDialogOpen()) {
      getVisibleAppidsFromContainer(elements.compareSummary, ".sffa-compare-card-game-link").forEach(appid => appids.add(appid));
    }
    return Array.from(appids);
  }

  function shouldProcessVisibleCovers() {
    return getListViewMode() === "cover" || getListViewMode() === "poster" || getListViewMode() === "table" || isCompareDialogOpen();
  }

  function getVisibleAppidsFromContainer(container, selector) {
    if (!container) {
      return [];
    }
    const nodes = Array.from(container.querySelectorAll(selector));
    if (!nodes.length) {
      return [];
    }
    const wrapRect = container.getBoundingClientRect();
    const visibleNodes = nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom >= wrapRect.top && rect.top <= wrapRect.bottom;
    });
    return (visibleNodes.length ? visibleNodes : nodes.slice(0, 20))
      .map(extractAppidFromNode)
      .filter(appid => /^\d+$/.test(appid));
  }

  function extractAppidFromNode(node) {
    const directAppid = String(node?.dataset?.sffaCoverAppid || "").trim();
    if (directAppid) {
      return directAppid;
    }
    const directHref = String(node?.getAttribute?.("href") || "");
    if (directHref) {
      const directMatch = directHref.match(/\/app\/(\d+)\//);
      if (directMatch) {
        return directMatch[1];
      }
    }
    const nestedHref = String(node?.querySelector?.("a[href*='/app/']")?.getAttribute?.("href") || "");
    const nestedMatch = nestedHref.match(/\/app\/(\d+)\//);
    return nestedMatch ? nestedMatch[1] : "";
  }

  async function fetchCoverUrlBatch(appids, rawKey = `covers.batch${Date.now()}`, failedUrlByAppid = {}) {
    const itemById = await fetchStoreItemBatch(appids, {
      include_basic_info: true,
      include_assets: true
    }, rawKey);
    Object.entries(itemById).forEach(([appid, item]) => {
      const coverUrl = extractStoreCoverUrlFromStoreItem(item, failedUrlByAppid[String(appid)]);
      if (coverUrl) {
        cacheStoreCoverUrl(appid, coverUrl);
      }
    });
  }

  function clearCachedStoreCoverUrl(appid) {
    const key = String(appid || "");
    const entry = getStoreCacheEntry(key);
    coverProbeState.verifiedUrlByAppid.delete(key);
    coverProbeState.failedUrlByAppid.delete(key);
    if (!entry) {
      return;
    }
    setStoreCacheEntry(key, {
      ...entry,
      coverUrl: "",
      coverVerified: false
    });
  }

  // ===== Steam 会话与接口访问 =====

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
          // 忽略异常。
        }
      }
    }
    return "";
  }

  function isSteamCommunityProfilePage() {
    return location.hostname === "steamcommunity.com" && (
      /^\/profiles\/\d{17}(?:\/|$)/.test(location.pathname) ||
      /^\/id\/[^/?#]+/.test(location.pathname)
    );
  }

  function getSteamCommunityProfileSteamId() {
    if (!isSteamCommunityProfilePage()) {
      return "";
    }
    const profileMatch = location.pathname.match(/^\/profiles\/(\d{17})(?:\/|$)/);
    if (profileMatch) {
      return profileMatch[1];
    }
    const vanityMatch = location.pathname.match(/^\/id\/([^/?#]+)/);
    if (vanityMatch) {
      return location.href;
    }
    return "";
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
      // 纯自定义 ID 字符串会在下方继续处理。
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

  // ===== 共享性与价格补全 =====

  function scheduleShareabilityProgressRender() {
    if (!lastReport || !shareabilityFilterState.running || !shareabilityProgressUiState) {
      return;
    }
    if (shareabilityProgressUiState.analysisId !== shareabilityFilterState.analysisId) {
      return;
    }

    shareabilityProgressUiState.dirty = true;
    flushShareabilityProgressRender();
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
    updateSummaryProgressMetric();
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
      if (shareabilityProgressUiState?.timer) {
        window.clearTimeout(shareabilityProgressUiState.timer);
        shareabilityProgressUiState.timer = 0;
      }
      refreshReportMetrics();
      renderSummary(lastReport);
      renderDetailsPreserveScroll();
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
    const storeCache = getActiveStoreCache();
    const shareabilityById = {};
    const missing = [];

    uniqueAppids.forEach(appid => {
      if (!/^\d+$/.test(appid)) {
        throw new Error(t("invalidAppid", { appid }));
      }
      const cached = storeCache[appid];
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
        setStoreCacheEntry(appid, mergeStoreCacheEntry(getStoreCacheEntry(appid), shareability));
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
      const shareabilityPrice = getCurrentCachedPrice(shareability);
      const newGame = {
        ...game,
        familySharingSupported: true,
        localizedName: shareability.localizedName || shareabilityPrice?.localizedName || game.localizedName || "",
        price: null
      };
      if (shareabilityPrice) {
        applyOriginalPriceToGame(newGame, shareabilityPrice);
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
    scheduleShareabilityProgressRender();
  }

  function getStoreItemContributionStatus(shareability) {
    if (!shareability?.supported) {
      return "unsupported";
    }
    return isZeroValueOriginalPrice(getCurrentCachedPrice(shareability)) ? "noValue" : "new";
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
      const shareability = shareabilityById[String(game.appid)] || getStoreCacheEntry(game.appid);
      game.familySharingSupported = Boolean(shareability?.supported);
      if (shareability?.localizedName) {
        game.localizedName = shareability.localizedName;
      }
    });
  }

  async function fetchShareabilityBatch(appids) {
    const itemById = await fetchStoreItemBatch(appids, {
      include_basic_info: true,
      include_assets: true,
      include_all_purchase_options: true
    }, `shareability.batch${Date.now()}`);

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

  async function fetchStoreItemBatch(appids, dataRequest = {}, rawKey = `storeItems.batch${Date.now()}`) {
    const url = buildStoreItemBatchUrl(appids, dataRequest);
    const data = await requestStoreJson(url, rawKey);
    setRawData(rawKey, data);
    if (!Array.isArray(data?.response?.store_items)) {
      throw new Error(t("storeBatchMalformed"));
    }
    const itemById = {};
    data.response.store_items.forEach(item => {
      if (!item?.appid) {
        return;
      }
      const appid = String(item.appid);
      itemById[appid] = item;
      cacheStoreItem(appid, item);
    });
    return itemById;
  }

  function buildStoreItemBatchUrl(appids, dataRequest = {}) {
    const input = {
      ids: appids.map(appid => ({ appid: Number(appid) })),
      context: {
        language: STORE_LANG,
        country_code: STORE_CC
      },
      data_request: {
        include_basic_info: false,
        include_assets: false,
        include_all_purchase_options: false,
        include_tag_count: 0,
        ...dataRequest
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
    getActiveStoreCache();
    priceLoadState = createPriceLoadState();

    games.forEach(game => {
      prepareOriginalPriceForGame(game);
    });

    renderStoreCacheButton();
  }

  function prepareOriginalPriceForGame(game) {
    const storeCache = getActiveStoreCache();
    const appid = String(game.appid);
    if (isHistoryLowPriceMode() && !getItadApiKey()) {
      game.price = {
        initial: null,
        currency: getStoreCurrency(),
        localizedName: game.localizedName || "",
        source: PRICE_SOURCE_ITAD_STORE_LOW,
        isFree: false,
        unavailable: true,
        missingApiKey: true,
        updatedAt: Date.now()
      };
      return;
    }
    const cached = storeCache[appid];
    const cachedPrice = getCurrentCachedPrice(cached);
    if (isFreshStoreCacheEntry(cached) && cachedPrice) {
      applyOriginalPriceToGame(game, cachedPrice);
    } else {
      game.price = { pending: true, source: isHistoryLowPriceMode() ? PRICE_SOURCE_ITAD_STORE_LOW : isCurrentPriceMode() ? PRICE_SOURCE_CURRENT : PRICE_SOURCE_ORIGINAL };
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

  function createCoverLoadState() {
    return {
      loadingSet: new Set(),
      running: false,
      scheduled: 0
    };
  }

  function createCoverProbeState() {
    return {
      probingUrlByAppid: new Map(),
      verifiedUrlByAppid: new Map(),
      failedUrlByAppid: new Map(),
      retryingSet: new Set()
    };
  }

  function applyOriginalPriceToGame(game, price) {
    game.price = price || (isHistoryLowPriceMode() ? normalizeHistoryLowPrice(null) : normalizeOriginalPrice(null, getPriceMode()));
  }

  async function fetchOriginalPrice(appid) {
    if (isHistoryLowPriceMode()) {
      const prices = await fetchHistoryLowPrices([appid]);
      return prices.get(String(appid)) || normalizeHistoryLowPrice(null);
    }

    const priceUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=basic,price_overview&cc=${STORE_CC}&l=${STORE_LANG}`;
    const priceData = await requestStoreJson(priceUrl, `prices.${appid}`);
    setRawData(`prices.${appid}`, priceData);
    cacheStoreCoverUrl(appid, extractStoreCoverUrlFromAppdetails(priceData?.[appid]));
    return normalizeOriginalPrice(priceData?.[appid], getPriceMode());
  }

  async function fetchOriginalPrices(appids) {
    if (isHistoryLowPriceMode()) {
      return fetchHistoryLowPrices(appids);
    }

    const uniqueAppids = Array.from(new Set(appids.map(String)));
    const priceUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(uniqueAppids.join(","))}&filters=price_overview&cc=${STORE_CC}&l=${STORE_LANG}`;
    const rawKey = `prices.batch${Date.now()}`;
    const priceData = await requestStoreJson(priceUrl, rawKey);
    setRawData(rawKey, priceData);

    const prices = new Map();
    for (const appid of uniqueAppids) {
      const item = priceData?.[appid];
      cacheStoreCoverUrl(appid, extractStoreCoverUrlFromAppdetails(item));
      prices.set(appid, normalizeOriginalPrice(item, getPriceMode()));
    }

    return prices;
  }

  async function fetchHistoryLowPrices(appids) {
    const apiKey = getItadApiKey();
    if (!apiKey) {
      throw new Error(t("historyLowNeedsApiKey"));
    }

    const uniqueAppids = Array.from(new Set(appids.map(String)));
    const lookupInput = uniqueAppids.map(appid => `app/${appid}`);
    const lookupUrl = appendQuery(`${ITAD_API_BASE_URL}/lookup/id/shop/${ITAD_STEAM_SHOP_ID}/v1`, { key: apiKey });
    const lookupRawKey = `prices.itadLookup${Date.now()}`;
    const lookupData = await requestPostJson(lookupUrl, lookupInput);
    setRawData(lookupRawKey, lookupData);

    const appidToItadId = parseItadLookupResponse(lookupData, uniqueAppids);
    const itadIdToAppids = new Map();
    uniqueAppids.forEach(appid => {
      const itadId = appidToItadId.get(appid);
      if (!itadId) {
        return;
      }
      itadIdToAppids.set(itadId, [...(itadIdToAppids.get(itadId) || []), appid]);
    });

    const prices = new Map(uniqueAppids.map(appid => [appid, normalizeHistoryLowPrice(null)]));
    const itadIds = Array.from(itadIdToAppids.keys());
    for (let index = 0; index < itadIds.length; index += ITAD_PRICE_BATCH_SIZE) {
      const batchIds = itadIds.slice(index, index + ITAD_PRICE_BATCH_SIZE);
      const priceUrl = appendQuery(`${ITAD_API_BASE_URL}/games/storelow/v2`, {
        country: STORE_CC,
        shops: String(ITAD_STEAM_SHOP_ID),
        key: apiKey
      });
      const rawKey = `prices.itadStoreLow${Date.now()}_${index}`;
      const priceData = await requestPostJson(priceUrl, batchIds);
      setRawData(rawKey, priceData);
      const lowById = parseItadStoreLowResponse(priceData);
      batchIds.forEach(itadId => {
        const price = normalizeHistoryLowPrice(lowById.get(itadId));
        (itadIdToAppids.get(itadId) || []).forEach(appid => prices.set(appid, price));
      });
    }

    return prices;
  }

  function startLazyOriginalPriceLoading() {
    scheduleVisiblePriceLoads();
    scheduleVisibleCoverLoads();
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

  function scheduleVisibleCoverLoads() {
    if (rateLimitState.active || !shouldProcessVisibleCovers()) {
      return;
    }
    window.clearTimeout(coverLoadState.scheduled);
    coverLoadState.scheduled = window.setTimeout(runVisibleCoverLoads, 80);
  }

  async function runVisibleCoverLoads() {
    coverLoadState.scheduled = 0;
    if (rateLimitState.active || coverLoadState.running) {
      return;
    }
    applyVisibleCoverImages();
    const needsPosterStoreItem = getListViewMode() === "poster";
    const visibleAppids = getVisibleCoverAppids().map(String);
    visibleAppids.forEach(appid => {
      const cachedCoverUrl = needsPosterStoreItem ? getFamilyPosterCoverUrl(appid) : hasVerifiedStoreCoverUrl(appid) ? getCachedStoreCoverUrl(appid) : "";
      if (cachedCoverUrl) {
        ensureCoverUrlHealthy(appid, cachedCoverUrl);
      }
    });
    const appids = visibleAppids.filter(appid => {
      const hasCoverData = needsPosterStoreItem ? hasFreshPosterStoreItem(appid) : hasVerifiedStoreCoverUrl(appid);
      return !hasCoverData && !coverLoadState.loadingSet.has(String(appid));
    });
    if (!appids.length) {
      return;
    }

    const batch = appids.slice(0, COVER_RELOAD_BATCH_SIZE).map(String);
    batch.forEach(appid => coverLoadState.loadingSet.add(appid));
    coverLoadState.running = true;
    try {
      await fetchCoverUrlBatch(batch, `covers.visible${Date.now()}`);
      saveState();
      applyVisibleCoverImages();
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimited(error, "cover");
      } else {
        setRawError(error);
      }
    } finally {
      batch.forEach(appid => coverLoadState.loadingSet.delete(appid));
      coverLoadState.running = false;
      if (!rateLimitState.active) {
        const remaining = getVisibleCoverAppids().some(appid => needsPosterStoreItem ? !hasFreshPosterStoreItem(appid) : !hasVerifiedStoreCoverUrl(appid));
        if (remaining) {
          scheduleVisibleCoverLoads();
        }
      }
    }
  }

  function hasVerifiedStoreCoverUrl(appid) {
    const entry = getStoreCacheEntry(appid);
    return Boolean(entry?.coverVerified === true && entry.coverUrl);
  }

  function applyVisibleCoverImages() {
    if (getListViewMode() === "cover") {
      applyVisibleCoverImagesInContainer(elements.tableWrap, ".sffa-cover-card-media[data-sffa-cover-appid]");
    } else if (getListViewMode() === "poster") {
      applyVisibleCoverImagesInContainer(elements.tableWrap, ".sffa-poster-card[data-sffa-cover-appid]");
    } else {
      applyVisibleCoverImagesInContainer(elements.tableWrap, ".sffa-game-thumb[data-sffa-cover-appid]");
    }
    if (isCompareDialogOpen()) {
      applyVisibleCoverImagesInContainer(elements.compareSummary, ".sffa-compare-card-game[data-sffa-cover-appid]");
    }
  }

  function applyVisibleCoverImagesInContainer(container, selector) {
    if (!container) {
      return;
    }
    const nodes = Array.from(container.querySelectorAll(selector));
    if (!nodes.length) {
      return;
    }
    const wrapRect = container.getBoundingClientRect();
    const visibleNodes = nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom >= wrapRect.top && rect.top <= wrapRect.bottom;
    });
    const targets = visibleNodes.length ? visibleNodes : nodes.slice(0, 20);
    targets.forEach(node => {
      const appid = String(node.dataset.sffaCoverAppid || "").trim();
      const coverUrl = node.dataset.sffaCoverKind === "poster"
        ? withCoverReloadToken(getFamilyPosterCoverUrl(appid))
        : getCompareGameCoverUrl(appid);
      if (!coverUrl) {
        return;
      }
      if (node.dataset.sffaAppliedCoverUrl === coverUrl) {
        return;
      }
      node.style.setProperty("--sffa-cover", `url(${coverUrl})`);
      node.dataset.sffaAppliedCoverUrl = coverUrl;
    });
  }

  function ensureCoverUrlHealthy(appid, url) {
    const normalizedAppid = String(appid || "");
    const normalizedUrl = String(url || "").trim();
    if (!normalizedAppid || !normalizedUrl) {
      return;
    }
    if (coverProbeState.verifiedUrlByAppid.get(normalizedAppid) === normalizedUrl) {
      return;
    }
    if (coverProbeState.failedUrlByAppid.get(normalizedAppid) === normalizedUrl) {
      return;
    }
    if (coverProbeState.probingUrlByAppid.get(normalizedAppid) === normalizedUrl) {
      return;
    }

    coverProbeState.probingUrlByAppid.set(normalizedAppid, normalizedUrl);
    const image = new Image();
    image.onload = () => {
      coverProbeState.probingUrlByAppid.delete(normalizedAppid);
      coverProbeState.verifiedUrlByAppid.set(normalizedAppid, normalizedUrl);
      coverProbeState.failedUrlByAppid.delete(normalizedAppid);
      markCachedCoverUrlVerified(normalizedAppid, normalizedUrl);
    };
    image.onerror = () => {
      coverProbeState.probingUrlByAppid.delete(normalizedAppid);
      if (coverProbeState.failedUrlByAppid.get(normalizedAppid) === normalizedUrl) {
        return;
      }
      coverProbeState.failedUrlByAppid.set(normalizedAppid, normalizedUrl);
      handleBrokenCoverUrl(normalizedAppid);
    };
    image.src = withCoverReloadToken(normalizedUrl);
  }

  function markCachedCoverUrlVerified(appid, url) {
    const key = String(appid || "");
    const entry = getStoreCacheEntry(key);
    if (!entry || String(entry.coverUrl || "") !== String(url || "") || entry.coverVerified === true) {
      return;
    }
    setStoreCacheEntry(key, {
      ...entry,
      coverVerified: true
    });
    saveState();
  }

  async function handleBrokenCoverUrl(appid) {
    const key = String(appid || "");
    if (!key || coverProbeState.retryingSet.has(key)) {
      return;
    }
    coverProbeState.retryingSet.add(key);
    try {
      const failedUrl = String(coverProbeState.failedUrlByAppid.get(key) || "");
      clearCachedStoreCoverUrl(key);
      await fetchCoverUrlBatch([key], `covers.retry.${key}.${Date.now()}`, { [key]: failedUrl });
      saveState();
      renderDetailsPreserveScroll();
      renderCompareDialogIfOpen();
      scheduleVisibleCoverLoads();
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimited(error, "cover");
      } else {
        setRawError(error);
      }
    } finally {
      coverProbeState.retryingSet.delete(key);
    }
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
            const price = prices.get(appid) || (isHistoryLowPriceMode() ? normalizeHistoryLowPrice(null) : normalizeOriginalPrice(null, getPriceMode()));
            cacheOriginalPrice(appid, price);
            applyOriginalPriceToGame(game, price);
            priceLoadState.pendingMap.delete(appid);
          });
          saveState();
          renderStoreCacheButton();
          if (!shareabilityFilterState.running && !lastReport?.filtering?.running) {
            refreshReportMetrics();
            renderSummary(lastReport);
            renderDetailsAfterPriceChange();
          }
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
            game.price = {
              unavailable: true,
              updatedAt: Date.now(),
              source: isHistoryLowPriceMode() ? PRICE_SOURCE_ITAD_STORE_LOW : isCurrentPriceMode() ? PRICE_SOURCE_CURRENT : PRICE_SOURCE_ORIGINAL
            };
            priceLoadState.pendingMap.delete(appid);
          });
          setRawError(error);
          if (!shareabilityFilterState.running && !lastReport?.filtering?.running) {
            refreshReportMetrics();
            renderSummary(lastReport);
            renderDetailsAfterPriceChange();
          }
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
    const scrollElement = getDetailsScrollElement();
    const scrollTop = scrollElement?.scrollTop || 0;
    const scrollLeft = scrollElement?.scrollLeft || 0;
    renderDetails();
    const nextScrollElement = getDetailsScrollElement();
    if (nextScrollElement) {
      nextScrollElement.scrollTop = scrollTop;
      nextScrollElement.scrollLeft = scrollLeft;
      syncTableHeaderScroll(nextScrollElement);
    }
  }

  function getDetailsScrollElement() {
    return elements.tableWrap?.querySelector("[data-sffa-table-body-scroll]") || elements.tableWrap;
  }

  function renderDetailsAfterShareabilityChange(appid) {
    if (currentTab === "all" && getListViewMode() === "table") {
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
    if (getListViewMode() === "table" || currentTab === "new" || currentTab === "relativeNew") {
      renderDetailsPreserveScroll();
    }
    applyVisibleCoverImages();
    scheduleVisibleCoverLoads();
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
    const pricedGames = newGames.filter(game => isCountablePrice(resolveGamePrice(game)));
    const unpricedGames = newGames.filter(game => resolveGamePrice(game)?.unavailable);
    lastReport.metrics.targetCount = allGames.length;
    lastReport.metrics.newCount = newGames.length;
    lastReport.metrics.overlapCount = overlapGames.length;
    lastReport.metrics.overlapRate = lastReport.metrics.familyCount > 0 ? overlapGames.length / lastReport.metrics.familyCount : 0;
    lastReport.metrics.initialValue = pricedGames.reduce((sum, game) => sum + Number(resolveGamePrice(game)?.initial || 0), 0);
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
      if (isZeroValueOriginalPrice(resolveGamePrice(game))) {
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

  function isCountablePrice(price) {
    return Boolean(price && !price.pending && !price.unavailable);
  }

  function normalizeOriginalPrice(item, mode = getPriceMode()) {
    const now = Date.now();
    const normalizedMode = normalizePriceMode(mode);
    const data = item?.success && item.data && !Array.isArray(item.data) ? item.data : null;
    const localizedName = data?.name || "";
    if (hasPriceOverview(item)) {
      const priceOverview = item.data.price_overview;
      const initial = normalizedMode === PRICE_MODE_CURRENT
        ? Number(priceOverview.final ?? priceOverview.initial ?? 0)
        : Number(priceOverview.initial ?? priceOverview.final ?? 0);
      return {
        initial,
        currency: priceOverview.currency || getStoreCurrency(),
        localizedName,
        source: normalizedMode === PRICE_MODE_CURRENT ? PRICE_SOURCE_CURRENT : PRICE_SOURCE_ORIGINAL,
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
        source: normalizedMode === PRICE_MODE_CURRENT ? PRICE_SOURCE_CURRENT : PRICE_SOURCE_ORIGINAL,
        isFree: true,
        unavailable: false,
        updatedAt: now
      };
    }

    return {
      initial: null,
      currency: getStoreCurrency(),
      localizedName,
      source: normalizedMode === PRICE_MODE_CURRENT ? PRICE_SOURCE_CURRENT : PRICE_SOURCE_ORIGINAL,
      isFree: false,
      unavailable: true,
      updatedAt: now
    };
  }

  function normalizeStoreItemOriginalPrice(item, mode = getPriceMode()) {
    const now = Date.now();
    const normalizedMode = normalizePriceMode(mode);
    const localizedName = item?.name || "";
    const purchaseOption = item?.best_purchase_option;
    const initial = normalizedMode === PRICE_MODE_CURRENT
      ? purchaseOption?.final_price_in_cents ?? purchaseOption?.original_price_in_cents
      : purchaseOption?.original_price_in_cents ?? purchaseOption?.final_price_in_cents;
    if (initial != null && initial !== "") {
      const cents = Number(initial);
      return {
        initial: cents,
        currency: getStoreCurrency(),
        localizedName,
        source: normalizedMode === PRICE_MODE_CURRENT ? PRICE_SOURCE_CURRENT : PRICE_SOURCE_ORIGINAL,
        isFree: cents <= 0,
        unavailable: false,
        updatedAt: now
      };
    }

    return null;
  }

  function normalizeHistoryLowPrice(item) {
    const now = Date.now();
    const low = selectItadSteamLow(item);
    const amountInt = low?.price?.amountInt;
    const amount = low?.price?.amount;
    const initial = amountInt != null
      ? Number(amountInt)
      : amount != null
        ? Math.round(Number(amount) * 100)
        : null;

    if (Number.isFinite(initial)) {
      return {
        initial,
        currency: low.price?.currency || getStoreCurrency(),
        localizedName: "",
        source: PRICE_SOURCE_ITAD_STORE_LOW,
        isFree: initial <= 0,
        unavailable: false,
        historyLowAt: low.timestamp || "",
        updatedAt: now
      };
    }

    return {
      initial: null,
      currency: getStoreCurrency(),
      localizedName: "",
      source: PRICE_SOURCE_ITAD_STORE_LOW,
      isFree: false,
      unavailable: true,
      updatedAt: now
    };
  }

  function selectItadSteamLow(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const lows = Array.isArray(item.lows)
      ? item.lows
      : Array.isArray(item.low)
        ? item.low
        : item.low
          ? [item.low]
          : [];
    return lows.find(low => Number(low?.shop?.id || low?.shopId || low?.shop) === ITAD_STEAM_SHOP_ID) || lows[0] || item;
  }

  function parseItadLookupResponse(response, appids) {
    const result = new Map();
    const wanted = new Set(appids.map(String));
    const rows = response?.data != null ? response.data : response;
    if (Array.isArray(rows)) {
      rows.forEach((item, index) => {
        const appid = extractAppidFromItadLookupItem(item) || appids[index];
        const itadId = extractItadGameId(item);
        if (appid && itadId && wanted.has(String(appid))) {
          result.set(String(appid), String(itadId));
        }
      });
      return result;
    }

    Object.entries(rows || {}).forEach(([key, value]) => {
      const appid = String(key).replace(/^app\//, "");
      const itadId = extractItadGameId(value);
      if (appid && itadId && wanted.has(appid)) {
        result.set(appid, String(itadId));
      }
    });
    return result;
  }

  function extractAppidFromItadLookupItem(item) {
    const candidates = [
      item?.shop?.id,
      item?.shopId,
      item?.shop_id,
      item?.id,
      item?.uid,
      item?.input,
      item?.plain,
      item?.shop?.plain
    ];
    for (const candidate of candidates) {
      const match = String(candidate || "").match(/(?:^|\/)(\d+)$/);
      if (match) {
        return match[1];
      }
    }
    return "";
  }

  function extractItadGameId(item) {
    if (typeof item === "string") {
      return isLikelyItadGameId(item) ? item.trim() : "";
    }
    if (!item || typeof item !== "object") {
      return "";
    }
    const candidates = [
      item.game?.id,
      item.game_id,
      item.gameId,
      item.id,
      item.uuid
    ];
    return candidates.find(value => isLikelyItadGameId(value)) || "";
  }

  function isLikelyItadGameId(value) {
    const text = String(value || "").trim();
    return Boolean(text && !/^app\/\d+$/i.test(text) && !/^\d+$/.test(text));
  }

  function parseItadStoreLowResponse(response) {
    const result = new Map();
    const source = response?.data != null ? response.data : response;
    const rows = Array.isArray(source)
      ? source.map(item => ["", item])
      : Object.entries(source || {});
    rows.forEach(([key, item]) => {
      const id = String(item?.id || item?.game?.id || item?.game_id || key || "").trim();
      if (id) {
        result.set(id, item);
      }
    });
    return result;
  }

  // ===== 报告构建与派生指标 =====

  function buildReport(targetProfile, comparison) {
    const newGames = comparison.newGames;
    const allGames = (comparison.allGames || targetProfile.games || []).slice().sort(sortByName);
    const pendingNewGames = comparison.pendingNewGames || [];
    const unpricedGames = newGames.filter(game => resolveGamePrice(game)?.unavailable);
    const pricedGames = newGames.filter(game => isCountablePrice(resolveGamePrice(game)));
    const initialValue = pricedGames.reduce((sum, game) => sum + Number(resolveGamePrice(game)?.initial || 0), 0);
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
      const pricedNewGames = targetNewGames.filter(game => isCountablePrice(resolveGamePrice(game)));
      return {
        label: getTargetProfileDisplayName(target),
        steamid64,
        targetCount: gameIds.length,
        overlapCount: gameIds.filter(appid => familySet.has(appid)).length,
        newCount: targetNewGames.length,
        initialValue: pricedNewGames.reduce((sum, game) => sum + Number(resolveGamePrice(game)?.initial || 0), 0)
      };
    });

    const initialValue = newGames
      .filter(game => isCountablePrice(resolveGamePrice(game)))
      .reduce((sum, game) => sum + Number(resolveGamePrice(game)?.initial || 0), 0);
    return {
      targetCount: buildSplitMetric(targetRows.map(row => ({ label: row.label, value: row.targetCount })), allGameIds.size),
      newCount: buildSplitMetric(targetRows.map(row => ({ label: row.label, value: row.newCount })), newGames.length),
      initialValue: buildSplitMetric(targetRows.map(row => ({ label: row.label, value: row.initialValue })), initialValue),
      overlapCount: buildSplitMetric(targetRows.map(row => ({ label: row.label, value: row.overlapCount })), overlapGameIds.size),
      overlapRate: buildSplitMetric(
        targetRows.map(row => ({
          label: row.label,
          value: state.familyLibrary.appidSet.length > 0 ? row.overlapCount / state.familyLibrary.appidSet.length : 0
        })),
        state.familyLibrary.appidSet.length > 0 ? overlapGameIds.size / state.familyLibrary.appidSet.length : 0,
        targetRows.reduce((sum, row) => sum + row.overlapCount, 0) !== overlapGameIds.size
      )
    };
  }

  // ===== 摘要、明细与对比渲染 =====

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
    const normalizedParts = parts.map((part, index) => {
      if (part && typeof part === "object") {
        return {
          label: String(part.label || `#${index + 1}`),
          value: Number(part.value || 0)
        };
      }
      return {
        label: `#${index + 1}`,
        value: Number(part || 0)
      };
    });
    const numericParts = normalizedParts.map(part => part.value);
    const numericTotal = Number(total || 0);
    const partSum = numericParts.reduce((sum, value) => sum + value, 0);
    return {
      parts: numericParts,
      labels: normalizedParts.map(part => part.label),
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

    const targetMetric = createTargetAccountSummaryMetric(report);
    const breakdown = report?.targetBreakdown || null;
    const filterValue = metrics.filteringTotal
      ? `${metrics.filteringProcessed || 0}/${metrics.filteringTotal}`
      : "0/0";
    const totalGamesMetric = createSummaryMetric(breakdown?.targetCount, value => `${value}`, metrics.targetCount);
    const addedGamesMetric = createSummaryMetric(breakdown?.newCount, value => `${value}`, metrics.newCount);
    const addedValueMetric = createSummaryMetric(breakdown?.initialValue, value => formatMoney(value), metrics.initialValue);
    const duplicatedGamesMetric = createSummaryMetric(breakdown?.overlapCount, value => `${value}`, metrics.overlapCount);
    const overlapRateMetric = createSummaryMetric(breakdown?.overlapRate, value => formatPercent(value), metrics.overlapRate);
    elements.summary.innerHTML = [
      metricHtml(t("targetAccount"), targetMetric.value, targetMetric.title),
      metricHtml(t("progress"), `<b data-sffa-summary-progress>${escapeHtml(filterValue)}</b>`),
      metricHtml(t("tabs.family"), `${metrics.familyCount}`),
      metricHtml(t("totalGames"), totalGamesMetric.value, totalGamesMetric.title),
      metricHtml(t("addedGames"), addedGamesMetric.value, addedGamesMetric.title),
      metricHtml(getAddedValueLabel(), addedValueMetric.value, addedValueMetric.title),
      metricHtml(t("duplicatedGames"), duplicatedGamesMetric.value, duplicatedGamesMetric.title),
      metricHtml(t("overlapRate"), overlapRateMetric.value, overlapRateMetric.title)
    ].join("");
  }

  function createTargetAccountSummaryMetric(report) {
    const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
    if (targets.length > 1) {
      return {
        value: escapeHtml(t("targetAccountCount", { count: targets.length })),
        title: targets.map(getTargetProfileDisplayName).join("\n")
      };
    }
    return {
      value: escapeHtml(report?.target?.displayName || t("noSummary")),
      title: ""
    };
  }

  function createSummaryMetric(splitMetric, formatter, fallbackValue) {
    return {
      value: formatSummaryMetric(splitMetric, formatter, fallbackValue),
      title: formatSummaryMetricTitle(splitMetric, formatter)
    };
  }

  function formatSummaryMetric(splitMetric, formatter, fallbackValue) {
    if (splitMetric && Number.isFinite(Number(splitMetric.total))) {
      return formatter(splitMetric.total);
    }
    return formatter(fallbackValue);
  }

  function formatSummaryMetricTitle(splitMetric, formatter) {
    if (!splitMetric || !Array.isArray(splitMetric.parts) || splitMetric.parts.length <= 1) {
      return "";
    }

    const labels = Array.isArray(splitMetric.labels) ? splitMetric.labels : [];
    const lines = splitMetric.parts.map((value, index) => {
      const label = labels[index] || `#${index + 1}`;
      return `${label}\t${formatter(value)}`;
    });
    if (splitMetric.deduped) {
      lines.push(`${t("deduped")}\t${formatter(splitMetric.total)}`);
    }
    return lines.join("\n");
  }

  function renderTargetProfile(report) {
    if (!report) {
      elements.profile.innerHTML = `<div class="sffa-empty">${escapeHtml(t("noSummary"))}</div>`;
      return;
    }

    const target = report.target || {};
    const targets = Array.isArray(target.targets) ? target.targets : [];
    const accountRows = targets.length > 1
      ? targets.map(profile => renderTargetAccountRow(profile, true)).join("")
      : renderTargetAccountRow(target, false);
    const count = targets.length > 1 ? targets.length : 1;
    const compareHtml = `<button class="sffa-compare-btn" type="button" data-sffa-open-compare aria-label="${escapeAttr(t("compare"))}">${escapeHtml(t("compare"))}</button>`;
    const globalCompareHtml = `<button class="sffa-compare-btn" type="button" data-sffa-open-global-compare aria-label="${escapeAttr(t("globalCompare"))}">${escapeHtml(t("globalCompare"))}</button>`;
    elements.profile.innerHTML = `
      <div class="sffa-profile-topbar">
        <span>${escapeHtml(formatDateTime(report.generatedAt))}</span>
        <div class="sffa-profile-topbar-actions">
          <span>${escapeHtml(t("targetAccountCount", { count }))}</span>
          ${compareHtml}
          ${globalCompareHtml}
        </div>
      </div>
      <div class="sffa-account-list">${accountRows}</div>
    `;
  }

  function renderTargetAccountRow(profile, selectable) {
    const name = getTargetProfileDisplayName(profile);
    const steamid64 = String(profile?.steamid64 || "");
    const checked = profile?.selected === false ? "" : " checked";
    const disabled = selectable ? "" : " disabled";
    return `
      <div class="sffa-target-row">
        <input type="checkbox" data-sffa-target-toggle value="${escapeAttr(steamid64)}"${checked}${disabled}>
        ${renderProfileAvatarLinkHtml(profile, name)}
        <div class="sffa-profile-account-text">
          <div class="sffa-profile-account-name">${escapeHtml(name)}</div>
          <div class="sffa-profile-account-id">${escapeHtml(steamid64 || "-")}</div>
        </div>
      </div>
    `;
  }

  function renderProfileAvatarLinkHtml(profile, label) {
    const avatar = profile?.avatar
      ? `<img class="sffa-profile-avatar" src="${escapeAttr(profile.avatar)}" alt="">`
      : escapeHtml(getAvatarFallbackText(label));
    if (profile?.profileUrl) {
      return `<a class="sffa-profile-avatar-link" ${buildSteamLinkAttrs(profile.profileUrl)} aria-label="${escapeAttr(label)}">${avatar}</a>`;
    }
    return `<span class="sffa-profile-avatar-static">${avatar}</span>`;
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
    const globalButton = event.target.closest("[data-sffa-open-global-compare]");
    if (globalButton) {
      openGlobalCompareDialog();
      return;
    }

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
    if (!lastReport) {
      setStatus(t("noSummary"), "warn");
      return;
    }

    closeMenu();
    closeGlobalCompareDialog();
    comparePriceRangeByTarget = {};
    renderCompareDialog(lastReport);
    elements.root.classList.add("is-compare-open");
    if (elements.compareSummary) {
      elements.compareSummary.scrollTop = 0;
    }
    applyVisibleCoverImages();
    scheduleVisibleCoverLoads();
  }

  function closeCompareDialog() {
    elements.root.classList.remove("is-compare-open");
    comparePriceRangeByTarget = {};
  }

  function isGlobalCompareDialogOpen() {
    return Boolean(elements.root?.classList.contains("is-global-compare-open"));
  }

  function openGlobalCompareDialog() {
    if (!lastReport) {
      setStatus(t("noSummary"), "warn");
      return;
    }

    closeMenu();
    closeCompareDialog();
    globalCompareDrilldown = null;
    renderGlobalCompareDialog(lastReport);
    elements.root.classList.add("is-global-compare-open");
  }

  function closeGlobalCompareDialog() {
    elements.root.classList.remove("is-global-compare-open");
  }

  function renderGlobalCompareDialogIfOpen() {
    if (!isGlobalCompareDialogOpen() || !lastReport) {
      return;
    }
    renderGlobalCompareDialog(lastReport);
  }

  function renderGlobalCompareDialog(report) {
    if (!elements.globalCompareBody || !elements.globalCompareHint) {
      return;
    }

    const view = buildGlobalContributionView(report);
    elements.globalCompareHint.textContent = view.accounts.length
      ? `${t("globalCompareHint")} · ${t("globalCompareAccounts", { count: view.accounts.length })} · ${t("globalCompareGames", { count: view.gameCount })}`
      : t("globalCompareHint");
    elements.globalCompareBody.innerHTML = renderGlobalContributionChartHtml(view);
    activateGlobalCompareDetailLayout(view);
  }

  function activateGlobalCompareDetailLayout(view) {
    if (!view?.drilldown || !elements.globalCompareBody) {
      return;
    }
    const content = elements.globalCompareBody.querySelector("[data-sffa-global-content]");
    if (!content) {
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        content.classList.add("has-detail");
      });
    });
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
    applyVisibleCoverImages();
    scheduleVisibleCoverLoads();
  }

  function renderCompareDialog(report) {
    if (!elements.compareSummary || !elements.compareBody || !elements.compareHint || !elements.compareTitle) {
      return;
    }

    if (!report) {
      elements.compareTitle.textContent = t("compareTitle");
      elements.compareHint.textContent = t("compareHint", { count: Array.isArray(report?.target?.targets) ? report.target.targets.length : 0 });
      updateCompareColumnCount(1);
      elements.compareSummary.innerHTML = "";
      elements.compareBody.innerHTML = `<div class="sffa-compare-empty">${escapeHtml(t("compareNoData"))}</div>`;
      return;
    }

    elements.compareTitle.textContent = t("compareTitle");
    if (report?.filtering?.running) {
      updateCompareColumnCount(Array.isArray(report?.target?.targets) && report.target.targets.length ? report.target.targets.length : 1);
      elements.compareHint.textContent = t("compareLoadingHint");
      elements.compareSummary.innerHTML = renderCompareLoadingHtml(report);
      elements.compareBody.innerHTML = "";
      return;
    }

    const compare = buildCompareView(report);
    updateCompareColumnCount(compare.targets.length);
    elements.compareHint.textContent = t("compareHint", { count: compare.targets.length });
    elements.compareSummary.innerHTML = compare.targets.map(target => renderCompareCardHtml(target, compare)).join("");
    elements.compareBody.innerHTML = "";
  }

  function updateCompareColumnCount(count) {
    const columns = Math.max(1, Math.min(3, Number(count || 1)));
    elements.compareShell?.style.setProperty("--sffa-compare-columns", String(columns));
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
      const owners = getCompareGameOwners(game, activeTargets, activeIdSet);
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

  function buildGlobalContributionView(report) {
    const accountById = new Map();
    const gameOwnersById = new Map();
    const gameById = new Map();
    const targetAccounts = getGlobalCompareTargetAccounts(report);
    const familyNameById = state.familyInfo?.steamIdtoName || {};

    (state.familyInfo?.family_member || []).forEach(member => {
      upsertGlobalCompareAccount(accountById, {
        steamid64: member?.steamid,
        displayName: member?.userName || familyNameById[String(member?.steamid || "")],
        avatar: "",
        source: "family"
      });
    });
    Object.entries(familyNameById).forEach(([steamid64, displayName]) => {
      upsertGlobalCompareAccount(accountById, { steamid64, displayName, avatar: "", source: "family" });
    });
    targetAccounts.forEach(target => {
      upsertGlobalCompareAccount(accountById, {
        steamid64: target?.steamid64,
        displayName: getTargetProfileDisplayName(target),
        avatar: target?.avatar || "",
        source: "target"
      });
    });

    (state.familyLibrary?.appidSet || []).forEach(appid => {
      const familyInfo = state.familyLibrary?.appInfoById?.[String(appid)] || {};
      registerGlobalCompareGame(gameById, {
        appid,
        name: familyInfo.name || `App ${appid}`
      });
      (familyInfo.owners || []).forEach(steamid64 => {
        const normalizedId = String(steamid64 || "");
        if (!accountById.has(normalizedId)) {
          upsertGlobalCompareAccount(accountById, {
            steamid64: normalizedId,
            displayName: familyNameById[normalizedId] || normalizedId,
            avatar: "",
            source: "family"
          });
        }
        addGlobalGameOwner(gameOwnersById, appid, normalizedId);
      });
    });

    targetAccounts.forEach(target => {
      const steamid64 = String(target?.steamid64 || "");
      (target?.gameAppids || []).forEach(appid => addGlobalGameOwner(gameOwnersById, appid, steamid64));
    });
    (report?.games?.all || []).forEach(game => {
      const appid = String(game?.appid || "");
      registerGlobalCompareGame(gameById, game);
      const owners = (game?.targetOwners || []).map(String).filter(Boolean);
      if (owners.length) {
        owners.forEach(steamid64 => addGlobalGameOwner(gameOwnersById, appid, steamid64));
        return;
      }
      if (targetAccounts.length === 1) {
        addGlobalGameOwner(gameOwnersById, appid, targetAccounts[0]?.steamid64);
      }
    });

    const accounts = Array.from(accountById.values());
    const visibleAccountIdSet = new Set(accounts
      .filter(account => isGlobalCompareRowVisible(account))
      .map(account => account.steamid64));
    const rowsById = new Map(accounts.map(account => [account.steamid64, {
      ...account,
      total: 0,
      buckets: {},
      bucketGames: {}
    }]));
    const bucketCounts = new Set();

    gameOwnersById.forEach((ownerSet, appid) => {
      const owners = Array.from(ownerSet).filter(steamid64 => visibleAccountIdSet.has(steamid64));
      if (!owners.length) {
        return;
      }
      const ownerCount = owners.length;
      const bucketKey = String(ownerCount);
      bucketCounts.add(ownerCount);
      const game = gameById.get(String(appid)) || { appid: String(appid), name: `App ${appid}` };
      owners.forEach(steamid64 => {
        const row = rowsById.get(steamid64);
        if (!row) {
          return;
        }
        row.total += 1;
        row.buckets[bucketKey] = Number(row.buckets[bucketKey] || 0) + 1;
        if (!Array.isArray(row.bucketGames[bucketKey])) {
          row.bucketGames[bucketKey] = [];
        }
        row.bucketGames[bucketKey].push(game);
      });
    });

    const rows = Array.from(rowsById.values())
      .filter(row => visibleAccountIdSet.has(row.steamid64))
      .sort(compareGlobalContributionRows);
    const displayedBucketCounts = new Set();
    const displayedGameIds = new Set();
    rows.forEach(row => {
      Object.entries(row.bucketGames || {}).forEach(([bucketKey, games]) => {
        if (!Array.isArray(games) || !games.length) {
          return;
        }
        displayedBucketCounts.add(Number(bucketKey));
        games.forEach(game => displayedGameIds.add(String(game?.appid || "")));
      });
    });
    const buckets = Array.from(displayedBucketCounts.size ? displayedBucketCounts : bucketCounts)
      .sort((left, right) => {
        if (left === 1) {
          return 1;
        }
        if (right === 1) {
          return -1;
        }
        return right - left;
      })
      .map(count => ({
        key: String(count),
        count,
        label: count === 1 ? t("globalCompareSingle") : t("globalCompareShared", { count }),
        color: getGlobalCompareBucketColor(count)
      }));
    const maxTotal = Math.max(...rows.map(row => row.total), 0);
    const chart = getGlobalContributionChartScale(maxTotal);
    const drilldown = getGlobalContributionDrilldown(rows, buckets);

    return {
      accounts: rows,
      buckets,
      gameCount: displayedGameIds.size,
      chartMax: chart.max,
      ticks: chart.ticks,
      drilldown
    };
  }

  function getGlobalCompareTargetAccounts(report) {
    const targets = Array.isArray(report?.target?.targets) && report.target.targets.length
      ? report.target.targets
      : [report?.target].filter(Boolean);
    return targets.filter(target => String(target?.steamid64 || ""));
  }

  function registerGlobalCompareGame(gameById, game) {
    const appid = String(game?.appid || "");
    if (!appid || gameById.has(appid)) {
      return;
    }
    gameById.set(appid, {
      ...game,
      appid,
      name: game?.name || `App ${appid}`
    });
  }

  function upsertGlobalCompareAccount(accountById, account) {
    const steamid64 = String(account?.steamid64 || "");
    if (!steamid64) {
      return;
    }
    const existing = accountById.get(steamid64);
    if (!existing) {
      accountById.set(steamid64, {
        steamid64,
        displayName: String(account?.displayName || steamid64),
        avatar: String(account?.avatar || ""),
        source: account?.source || "",
        isTarget: account?.source === "target",
        isFamily: account?.source === "family"
      });
      return;
    }
    if (!existing.avatar && account?.avatar) {
      existing.avatar = String(account.avatar);
    }
    if ((!existing.displayName || existing.displayName === steamid64) && account?.displayName) {
      existing.displayName = String(account.displayName);
    }
    if (account?.source === "target") {
      existing.source = "target";
      existing.isTarget = true;
    }
    if (account?.source === "family") {
      existing.isFamily = true;
    }
  }

  function isGlobalCompareRowVisible(row) {
    if (globalCompareFilter === "target") {
      return Boolean(row?.isTarget);
    }
    if (globalCompareFilter === "family") {
      return Boolean(row?.isFamily);
    }
    return true;
  }

  function addGlobalGameOwner(gameOwnersById, appid, steamid64) {
    const normalizedAppid = String(appid || "");
    const normalizedSteamId = String(steamid64 || "");
    if (!normalizedAppid || !normalizedSteamId) {
      return;
    }
    if (!gameOwnersById.has(normalizedAppid)) {
      gameOwnersById.set(normalizedAppid, new Set());
    }
    gameOwnersById.get(normalizedAppid).add(normalizedSteamId);
  }

  function compareGlobalContributionRows(left, right) {
    const totalDiff = Number(right.total || 0) - Number(left.total || 0);
    if (totalDiff !== 0) {
      return totalDiff;
    }
    return String(left.displayName || "").localeCompare(String(right.displayName || ""), getNumberLocale(), {
      numeric: true,
      sensitivity: "base"
    });
  }

  function getGlobalContributionChartScale(maxTotal) {
    const maxValue = Math.max(1, Number(maxTotal || 0));
    const step = getNiceChartStep(maxValue / 4);
    const chartMax = Math.max(step, Math.ceil(maxValue / step) * step);
    const ticks = [];
    for (let value = chartMax; value >= 0; value -= step) {
      ticks.push(value);
    }
    if (ticks[ticks.length - 1] !== 0) {
      ticks.push(0);
    }
    return { max: chartMax, ticks };
  }

  function getGlobalContributionDrilldown(rows, buckets) {
    if (!globalCompareDrilldown) {
      return null;
    }
    const steamid64 = String(globalCompareDrilldown.steamid64 || "");
    const bucketKey = String(globalCompareDrilldown.bucketKey || "");
    const row = rows.find(item => item.steamid64 === steamid64);
    const bucket = buckets.find(item => item.key === bucketKey);
    if (!row || !bucket) {
      globalCompareDrilldown = null;
      return null;
    }
    const games = (row.bucketGames?.[bucketKey] || []).slice().sort(sortByName);
    return {
      row,
      bucket,
      games
    };
  }

  function getNiceChartStep(rawStep) {
    const value = Math.max(1, Number(rawStep || 1));
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return niceNormalized * magnitude;
  }

  function getGlobalCompareBucketColor(count) {
    const colors = {
      1: "#b01723",
      2: "#a9661b",
      3: "#a5aa1a",
      4: "#3c9b72",
      5: "#3388c7",
      6: "#7566d8"
    };
    return colors[count] || `hsl(${(Number(count || 0) * 47) % 360} 58% 48%)`;
  }

  function renderGlobalContributionChartHtml(view) {
    const accountCount = Math.max(1, view.accounts.length);
    const chartMax = Math.max(1, Number(view.chartMax || 1));
    const filterHtml = renderGlobalCompareFilterHtml();
    if (!view.accounts.length || !view.gameCount) {
      return `
        <div class="sffa-global-controls">
          ${filterHtml}
          <div class="sffa-global-overview">
            <span>${escapeHtml(`${t("globalCompareYAxis")} · ${t("globalCompareAccounts", { count: view.accounts.length })} · ${t("globalCompareGames", { count: view.gameCount })}`)}</span>
          </div>
        </div>
        <div class="sffa-global-empty">${escapeHtml(t("globalCompareNoData"))}</div>
      `;
    }
    const legendHtml = view.buckets.map(bucket => `
      <span class="sffa-global-legend-item">
        <span class="sffa-global-legend-swatch" style="--sffa-legend-color: ${escapeAttr(bucket.color)}"></span>
        <span>${escapeHtml(bucket.label)}</span>
      </span>
    `).join("");
    const ticksHtml = view.ticks.map(value => {
      const top = (1 - Number(value || 0) / chartMax) * 100;
      return `<span class="sffa-global-y-tick" style="top: ${escapeAttr(top.toFixed(4))}%">${escapeHtml(String(value))}</span>`;
    }).join("");
    const barsHtml = view.accounts.map(row => renderGlobalContributionBarHtml(row, view.buckets, chartMax)).join("");
    const hasDetail = Boolean(view.drilldown);
    const detailHtml = hasDetail ? renderGlobalContributionDetailHtml(view.drilldown) : "";

    return `
      <div class="sffa-global-controls">
        ${filterHtml}
        <div class="sffa-global-overview">
          <span>${escapeHtml(`${t("globalCompareYAxis")} · ${t("globalCompareAccounts", { count: view.accounts.length })} · ${t("globalCompareGames", { count: view.gameCount })}`)}</span>
        </div>
      </div>
      <div class="sffa-global-legend">${legendHtml}</div>
      <div class="sffa-global-content" data-sffa-global-content>
        <div class="sffa-global-chart">
          <div class="sffa-global-chart-grid" style="--sffa-global-account-count: ${escapeAttr(accountCount)}">
            <div class="sffa-global-y-axis">${ticksHtml}</div>
            <div class="sffa-global-plot">
              <div class="sffa-global-bars">
                ${barsHtml}
              </div>
            </div>
          </div>
        </div>
        ${detailHtml}
      </div>
    `;
  }

  function renderGlobalCompareFilterHtml() {
    const options = [
      ["all", t("globalCompareFilterAll")],
      ["target", t("globalCompareFilterTargets")],
      ["family", t("globalCompareFilterFamily")]
    ];
    return `
      <div class="sffa-global-filter" role="group" aria-label="${escapeAttr(t("globalCompare"))}">
        ${options.map(([value, label]) => {
      const active = globalCompareFilter === value;
      return `<button class="sffa-global-filter-btn${active ? " is-active" : ""}" type="button" data-sffa-global-filter="${escapeAttr(value)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(label)}</button>`;
    }).join("")}
      </div>
    `;
  }

  function renderGlobalContributionBarHtml(row, buckets, chartMax) {
    const total = Number(row?.total || 0);
    const height = total > 0 ? Math.max(1, total / chartMax * 100) : 0;
    const segments = buckets.map(bucket => {
      const value = Number(row?.buckets?.[bucket.key] || 0);
      if (!value || total <= 0) {
        return "";
      }
      const segmentHeight = value / total * 100;
      const tooltip = formatGlobalContributionSegmentTooltip(row, bucket, value);
      const active = globalCompareDrilldown?.steamid64 === row.steamid64 && globalCompareDrilldown?.bucketKey === bucket.key;
      return `<button class="sffa-global-segment${active ? " is-active" : ""}" type="button" style="--sffa-global-segment-height: ${escapeAttr(segmentHeight.toFixed(4))}%; --sffa-global-segment-color: ${escapeAttr(bucket.color)}" data-sffa-global-account="${escapeAttr(row.steamid64)}" data-sffa-global-bucket="${escapeAttr(bucket.key)}" data-sffa-tooltip="${escapeAttr(tooltip)}" aria-label="${escapeAttr(tooltip)}"></button>`;
    }).join("");
    const summaryTooltip = formatGlobalContributionTooltip(row, buckets);

    return `
      <div class="sffa-global-bar-wrap">
        <div class="sffa-global-bar-shell">
          <div class="sffa-global-bar" style="--sffa-global-bar-height: ${escapeAttr(height.toFixed(4))}%">
            ${segments}
          </div>
        </div>
        <div class="sffa-global-x-label" data-sffa-tooltip="${escapeAttr(summaryTooltip)}">${escapeHtml(row.displayName || row.steamid64 || "-")}</div>
      </div>
    `;
  }

  function formatGlobalContributionTooltip(row, buckets) {
    const lines = [
      row.displayName || row.steamid64 || "-",
      `${t("globalCompareTotal")}\t${Number(row.total || 0)}`
    ];
    buckets.forEach(bucket => {
      lines.push(`${bucket.label}\t${Number(row.buckets?.[bucket.key] || 0)}`);
    });
    return lines.join("\n");
  }

  function renderGlobalContributionDetailHtml(detail) {
    const title = t("globalCompareDetailTitle", {
      account: detail.row.displayName || detail.row.steamid64 || "-",
      bucket: detail.bucket.label
    });
    const games = Array.isArray(detail.games) ? detail.games : [];
    const gamesHtml = games.length
      ? games.map(renderGlobalContributionDetailGameHtml).join("")
      : `<div class="sffa-global-empty">${escapeHtml(t("globalCompareDetailEmpty"))}</div>`;
    return `
      <section class="sffa-global-detail">
        <div class="sffa-global-detail-head">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(t("globalCompareDetailCount", { count: games.length }))}</span>
        </div>
        <div class="sffa-global-detail-list">
          ${gamesHtml}
        </div>
      </section>
    `;
  }

  function renderGlobalContributionDetailGameHtml(game) {
    const appid = String(game?.appid || "");
    const name = getGameLocalizedDisplayName(game);
    const originalName = getGameOriginalName(game);
    const gameUrl = `https://store.steampowered.com/app/${appid}/`;
    return `
      <a class="sffa-global-detail-game" ${buildSteamLinkAttrs(gameUrl)} data-sffa-tooltip="${escapeAttr(`ID ${appid || "-"}\n${originalName}`)}">
        <strong>${escapeHtml(name)}</strong>
      </a>
    `;
  }

  function formatGlobalContributionSegmentTooltip(row, bucket, value) {
    const lines = [
      row.displayName || row.steamid64 || "-",
      `${bucket.label}\t${Number(value || 0)}`
    ];
    return lines.join("\n");
  }

  function getCompareGameOwners(game, activeTargets, activeIdSet) {
    const owners = Array.from(new Set((game.targetOwners || []).map(String).filter(steamid => activeIdSet.has(steamid))));
    if (owners.length || activeTargets.length !== 1) {
      return owners;
    }
    const onlySteamId = String(activeTargets[0]?.steamid64 || "");
    return onlySteamId ? [onlySteamId] : [];
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
    const showGameList = compare.targets.length > 1;
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
      metricCardHtml(getAddedValueLabel(), formatMoney(Number(stats.addedValue || 0)), addedValueBest && stats.addedValue === compare.statMax.addedValue),
      metricCardHtml(t("compareAverageValue"), formatMoney(Number(stats.qualityValue || 0)), averageValueBest && stats.qualityValue === compare.statMax.averageValue),
      renderComparePriceRangeCards(stats, selectedRange, { disabled: !showGameList })
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
        ${showGameList ? `<div class="sffa-compare-card-games">
          <div class="sffa-compare-card-games-head">
            <strong>${escapeHtml(t("compareUniqueAdded"))}</strong>
            <span>${escapeHtml(gamesCountText)}</span>
          </div>
          <div class="sffa-compare-card-games-list">
            ${uniqueGamesHtml}
          </div>
        </div>` : ""}
      </section>
    `;
  }

  function renderComparePriceRangeCards(stats, selectedRange, options = {}) {
    const disabled = Boolean(options.disabled);
    const counts = getComparePriceRangeCounts(stats.uniqueNewGames || []);
    return `
      <div class="sffa-compare-price-ranges">
        ${COMPARE_PRICE_RANGES.map(range => {
      const active = selectedRange === range.key;
      return `
            <button class="sffa-compare-price-range${active ? " is-active" : ""}" type="button" data-sffa-compare-range="${escapeAttr(range.key)}" data-sffa-compare-target="${escapeAttr(stats.steamid64)}" aria-pressed="${active ? "true" : "false"}"${disabled ? " disabled" : ""}>
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

  function handleGlobalCompareClick(event) {
    const filterButton = event.target.closest("[data-sffa-global-filter]");
    if (filterButton) {
      globalCompareFilter = normalizeGlobalCompareFilter(filterButton.dataset.sffaGlobalFilter);
      globalCompareDrilldown = null;
      renderGlobalCompareDialog(lastReport);
      return;
    }

    const segmentButton = event.target.closest("[data-sffa-global-account][data-sffa-global-bucket]");
    if (!segmentButton || !lastReport) {
      return;
    }

    const steamid64 = String(segmentButton.dataset.sffaGlobalAccount || "");
    const bucketKey = String(segmentButton.dataset.sffaGlobalBucket || "");
    if (!steamid64 || !bucketKey) {
      return;
    }
    const sameSelection = globalCompareDrilldown?.steamid64 === steamid64 && globalCompareDrilldown?.bucketKey === bucketKey;
    globalCompareDrilldown = sameSelection ? null : { steamid64, bucketKey };
    renderGlobalCompareDialog(lastReport);
  }

  function normalizeGlobalCompareFilter(value) {
    return ["all", "target", "family"].includes(value) ? value : "all";
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
    const titleAttr = title ? ` data-sffa-tooltip="${escapeAttr(title)}"` : "";
    return `
      <div class="${classes.join(" ")}"${titleAttr}>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function renderCompareUniqueGameHtml(game) {
    const priceClass = getComparePriceChipClass(game);
    const gameName = getGameDisplayName(game);
    const gameUrl = `https://store.steampowered.com/app/${game.appid}/`;
    return `
      <div class="sffa-compare-card-game" data-sffa-cover-appid="${escapeAttr(game.appid)}">
        <a class="sffa-compare-card-game-link" ${buildSteamLinkAttrs(gameUrl)} aria-label="${escapeAttr(gameName)}" data-sffa-tooltip="${escapeAttr(gameName)}">
          <span class="sffa-compare-card-game-title">${escapeHtml(gameName)}</span>
          <span class="sffa-compare-card-game-price ${escapeAttr(priceClass)}">${escapeHtml(game.priceText)}</span>
        </a>
      </div>
    `;
  }

  function resolveCompareGamePrice(game) {
    return resolveGamePrice(game);
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
    return withCoverReloadToken(getCachedStoreCoverUrl(appid));
  }

  function withCoverReloadToken(url) {
    const normalized = String(url || "").trim();
    if (!normalized || !coverReloadToken) {
      return normalized;
    }
    return `${normalized}${normalized.includes("?") ? "&" : "?"}t=${coverReloadToken}`;
  }

  function getCachedStoreCoverUrl(appid) {
    const entry = getStoreCacheEntry(appid);
    return String(entry?.coverUrl || "");
  }

  function extractStorePosterCoverUrlFromStoreItem(item) {
    return extractStoreAssetUrlFromStoreItem(item, ["library_capsule", "library_capsule_2x", "main_capsule", "small_capsule", "header"]);
  }

  function extractStoreAssetUrlFromStoreItem(item, assetKeys, failedUrl = "") {
    const assets = item?.assets || {};
    const urls = (assetKeys || [])
      .map(key => buildStoreItemAssetUrl(assets.asset_url_format, assets[key]))
      .filter(Boolean);
    const normalizedFailedUrl = String(failedUrl || "").trim();
    return urls.find(url => url !== normalizedFailedUrl) || urls[0] || "";
  }

  function extractStoreCoverUrlFromStoreItem(item, failedUrl = "") {
    return extractStoreAssetUrlFromStoreItem(item, ["header", "main_capsule", "small_capsule"], failedUrl);
  }

  function buildStoreItemAssetUrl(assetUrlFormat, filename) {
    const normalizedFormat = String(assetUrlFormat || "").trim();
    const normalizedFilename = String(filename || "").trim();
    if (!normalizedFormat || !normalizedFilename) {
      return "";
    }
    return `${STORE_ITEM_ASSET_BASE_URL}${normalizedFormat.replace("${FILENAME}", normalizedFilename)}`;
  }

  function extractStoreCoverUrlFromAppdetails(item, failedUrl = "") {
    const urls = [item?.data?.header_image, item?.data?.capsule_image]
      .map(value => String(value || "").trim())
      .filter(Boolean);
    const normalizedFailedUrl = String(failedUrl || "").trim();
    return urls.find(url => url !== normalizedFailedUrl) || urls[0] || "";
  }

  function cacheStoreCoverUrl(appid, coverUrl) {
    const normalized = String(coverUrl || "").trim();
    if (!normalized) {
      return;
    }
    setStoreCacheEntry(appid, mergeStoreCacheEntry(getStoreCacheEntry(appid), {
      context: STORE_CACHE_CONTEXT,
      coverUrl: normalized,
      coverVerified: true,
      updatedAt: Date.now()
    }));
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
      return "-";
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
    setTooltipText(elements.autoFamilyRefreshBtn, t("autoRefreshTitle", { time: lastTime }));
  }

  function renderOpenLinksClientButton() {
    if (!elements.openLinksClientBtn) {
      return;
    }
    const enabled = Boolean(state.openLinksInSteamClient);
    elements.openLinksClientBtn.textContent = enabled ? t("openLinksInClientOn") : t("openLinksInClientOff");
    elements.openLinksClientBtn.classList.toggle("is-active", enabled);
    elements.openLinksClientBtn.setAttribute("aria-pressed", String(enabled));
  }

  function metricHtml(label, value, title = "") {
    const titleAttr = title ? ` data-sffa-tooltip="${escapeAttr(title)}"` : "";
    return `<div class="sffa-metric"${titleAttr}><span>${label}</span><strong>${value}</strong></div>`;
  }

  function updateSummaryProgressMetric() {
    if (!lastReport) {
      return;
    }
    const total = lastReport.filtering?.total || 0;
    const processed = lastReport.filtering?.processed || 0;
    lastReport.metrics.filteringProcessed = processed;
    lastReport.metrics.filteringTotal = total;
    const progressValue = total ? `${processed}/${total}` : "0/0";
    const progressNode = elements.summary?.querySelector("[data-sffa-summary-progress]");
    if (progressNode) {
      progressNode.textContent = progressValue;
    }
  }

  function renderTabs() {
    const listViewMode = getListViewMode();
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
    elements.viewModeButtons.forEach(button => {
      const active = button.dataset.sffaViewMode === listViewMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    renderSortControl();
    renderSearchClearButton();
    if (elements.reloadCoversBtn) {
      elements.reloadCoversBtn.hidden = false;
    }
  }

  function getSortOptionsForTab(tab = currentTab) {
    const normalizedTab = normalizeMainTab(tab);
    const priceOption = col(getPriceLabel(), "price");
    const nameOption = col(t("sortName"), "name");
    const idOption = col(t("sortId"), "appid");
    if (normalizedTab === "family") {
      return [nameOption, idOption, col(t("owners"), "owners"), col(t("acquiredAt"), "time"), priceOption];
    }
    if (normalizedTab === "new") {
      const options = [nameOption, idOption];
      if (isMultiTargetReport()) {
        options.push(col(t("targetOwners"), "targetOwners"));
      }
      options.push(priceOption);
      return options;
    }
    if (normalizedTab === "relativeNew" || normalizedTab === "overlap") {
      return [nameOption, idOption, col(t("owners"), "owners"), priceOption];
    }
    const options = [nameOption, idOption, col(t("status"), "status"), priceOption];
    if (isMultiTargetReport()) {
      options.push(col(t("targetOwners"), "targetOwners"));
    }
    return options;
  }

  function getSortOptionLabel(key, tab = currentTab) {
    return getSortOptionsForTab(tab).find(option => option.key === key)?.label || "";
  }

  function isSortAvailableForTab(sort, tab = currentTab) {
    if (!sort?.key) {
      return false;
    }
    return getSortOptionsForTab(tab).some(option => option.key === sort.key);
  }

  function formatSortControlText(label, direction) {
    return t(direction === "desc" ? "sortDesc" : "sortAsc", { label });
  }

  function renderSortControl() {
    if (!elements.sortSelect || !elements.sortMenu) {
      return;
    }

    const currentSort = tableSortByTab[currentTab];
    const currentLabel = isSortAvailableForTab(currentSort) ? getSortOptionLabel(currentSort.key) : "";
    elements.sortSelect.textContent = currentLabel ? formatSortControlText(currentLabel, currentSort.direction) : t("sort");
    elements.sortSelect.classList.toggle("is-active", Boolean(currentLabel));
    elements.sortMenu.innerHTML = getSortOptionsForTab()
      .flatMap(option => ["asc", "desc"].map(direction => {
        const active = currentSort?.key === option.key && currentSort.direction === direction;
        return `
          <button class="sffa-list-option${active ? " is-active" : ""}" type="button" role="option" data-sffa-sort-key="${escapeAttr(option.key)}" data-sffa-sort-direction="${escapeAttr(direction)}" aria-selected="${String(active)}">
            ${escapeHtml(formatSortControlText(option.label, direction))}
          </button>
        `;
      }))
      .join("");
  }

  function normalizeListViewMode(mode) {
    return mode === "cover" || mode === "poster" ? mode : "table";
  }

  function getListViewMode() {
    return normalizeListViewMode(state.listViewMode);
  }

  function setListViewMode(mode) {
    const nextMode = normalizeListViewMode(mode);
    if (nextMode === getListViewMode()) {
      return;
    }
    state.listViewMode = nextMode;
    saveState();
    renderTabs();
    renderDetailsPreserveScroll();
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
    closeSortMenu();
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
        headers: ["AppID", t("game"), t("owners"), t("acquiredAt"), getPriceLabel()],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOwners(game.owners || []) || "-",
          formatFamilyAcquireTime(game.time),
          formatOriginalPriceText(resolveGamePrice(game) || {})
        ])
      };
    }
    if (currentTab === "new") {
      const includeTargetOwners = isMultiTargetReport();
      return {
        headers: includeTargetOwners ? ["AppID", t("game"), t("targetOwners"), getPriceLabel()] : ["AppID", t("game"), getPriceLabel()],
        rows: rows.map(game => includeTargetOwners
          ? [
            game.appid,
            getGameDisplayName(game),
            formatTargetOwners(game.targetOwners || []),
            formatOriginalPriceText(resolveGamePrice(game) || {})
          ]
          : [
            game.appid,
            getGameDisplayName(game),
            formatOriginalPriceText(resolveGamePrice(game) || {})
          ])
      };
    }
    if (currentTab === "relativeNew") {
      return {
        headers: ["AppID", t("game"), t("owners"), getPriceLabel()],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOwners(game.owners || []) || "-",
          formatOriginalPriceText(resolveGamePrice(game) || {})
        ])
      };
    }
    if (currentTab === "overlap") {
      return {
        headers: ["AppID", t("game"), t("owners"), getPriceLabel()],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOwners(game.owners || []) || "-",
          formatOriginalPriceText(resolveGamePrice(game) || {})
        ])
      };
    }
    const includeTargetOwners = isMultiTargetReport();
    return {
      headers: includeTargetOwners ? ["AppID", t("game"), t("targetOwners"), t("status"), getPriceLabel()] : ["AppID", t("game"), t("status"), getPriceLabel()],
      rows: rows.map(game => includeTargetOwners
        ? [
          game.appid,
          getGameDisplayName(game),
          formatTargetOwners(game.targetOwners || []),
          getGameListLabel(game.appid),
          formatOriginalPriceText(resolveGamePrice(game) || {})
        ]
        : [
          game.appid,
          getGameDisplayName(game),
          getGameListLabel(game.appid),
          formatOriginalPriceText(resolveGamePrice(game) || {})
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
    renderSortControl();
    renderDetailsPreserveScroll();
    scheduleAnalysisHistorySave();
  }

  function handleSortMenuClick(event) {
    const option = event.target.closest("[data-sffa-sort-key]");
    if (!option || !elements.sortMenu?.contains(option)) {
      return;
    }

    const key = option.dataset.sffaSortKey;
    const direction = option.dataset.sffaSortDirection === "desc" ? "desc" : "asc";
    if (!getSortOptionsForTab().some(sortOption => sortOption.key === key)) {
      return;
    }

    tableSortByTab[currentTab] = { key, direction };
    closeSortMenu();
    renderSortControl();
    renderDetailsPreserveScroll();
    scheduleAnalysisHistorySave();
  }

  function handleDetailsScroll(event) {
    if (event.target?.dataset?.sffaTableBodyScroll != null) {
      syncTableHeaderScroll(event.target);
    }
    scheduleVisiblePriceLoads();
    scheduleVisibleCoverLoads();
  }

  function syncTableHeaderScroll(bodyScroll) {
    const headScroll = elements.tableWrap?.querySelector("[data-sffa-table-head-scroll]");
    if (!headScroll || !bodyScroll) {
      return;
    }
    headScroll.scrollLeft = bodyScroll.scrollLeft;
  }

  function renderDetails() {
    elements.tableWrap.classList.toggle("is-cover-view", getListViewMode() !== "table");
    if (currentTab === "family") {
      const sourceRows = getFamilyLibraryRows();
      const rows = getSortedRows("family", filterRowsBySearchQuery(sourceRows));
      if (rows.length === 0) {
        elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(sourceRows.length ? t("noMatches") : t("noFamilyRefresh"))}</div>`;
        return;
      }
      prepareOriginalPricesForMissingRows(rows);
      elements.tableWrap.innerHTML = buildDetailsView("family", rows);
      applyVisibleCoverImages();
      scheduleVisibleCoverLoads();
      scheduleVisiblePriceLoads();
      return;
    }

    if (!lastReport) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(t("initialEmpty"))}</div>`;
      return;
    }

    const sourceRows = getReportRowsForCurrentSelection(currentTab);
    const rows = getSortedRows(currentTab, filterRowsBySearchQuery(sourceRows));
    if (["all", "new", "relativeNew", "overlap"].includes(currentTab) && !lastReport.filtering?.running) {
      prepareOriginalPricesForMissingRows(rows);
    }
    if (rows.length === 0) {
      const emptyText = sourceRows.length ? t("noMatches") : t("tabEmpty", { tab: getTabLabel(currentTab) });
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(emptyText)}</div>`;
      return;
    }

    elements.tableWrap.innerHTML = buildDetailsView(currentTab, rows);
    applyVisibleCoverImages();
    scheduleVisibleCoverLoads();
    scheduleVisiblePriceLoads();
  }

  function buildDetailsView(tab, rows) {
    const viewMode = getListViewMode();
    if (viewMode === "poster") {
      return buildDetailsPosterGrid(tab, rows);
    }
    return viewMode === "cover" ? buildDetailsCoverGrid(tab, rows) : buildDetailsTable(tab, rows);
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

  function buildDetailsCoverGrid(tab, rows) {
    return `<div class="sffa-cover-grid">${rows.map(game => renderDetailsCoverCard(tab, game)).join("")}</div>`;
  }

  function buildDetailsPosterGrid(tab, rows) {
    return `<div class="sffa-poster-grid">${rows.map(game => renderDetailsPosterCard(tab, game)).join("")}</div>`;
  }

  function renderDetailsCoverCard(tab, game) {
    const title = getGameLocalizedDisplayName(game);
    const originalName = getGameOriginalName(game);
    const gameUrl = `https://store.steampowered.com/app/${game.appid}/`;
    const chip = getDetailsCoverChip(tab, game);
    const metaLines = getDetailsCoverMetaLines(tab, game).filter(Boolean);
    const priceText = formatOriginalPriceText(resolveGamePrice(game) || {});
    const priceAttr = needsCoverPriceTracking(tab) ? ` data-price-appid="${escapeAttr(game.appid)}"` : "";
    return `
      <a class="sffa-cover-card" ${buildSteamLinkAttrs(gameUrl)}${priceAttr} aria-label="${escapeAttr(title)}" data-sffa-tooltip="${escapeAttr(originalName)}">
        <span class="sffa-cover-card-media" data-sffa-cover-appid="${escapeAttr(game.appid)}">
          ${chip ? `<span class="sffa-cover-card-chip ${escapeAttr(chip.className)}">${escapeHtml(chip.text)}</span>` : ""}
          <span class="sffa-cover-card-title">${escapeHtml(title)}</span>
        </span>
        <span class="sffa-cover-card-body">
          <span class="sffa-cover-card-id-row">
            <span class="sffa-cover-card-appid">ID ${escapeHtml(String(game.appid || "-"))}</span>
            <span class="sffa-cover-card-price">${escapeHtml(priceText)}</span>
          </span>
          ${metaLines.map(line => `<span class="sffa-cover-card-meta">${escapeHtml(line)}</span>`).join("")}
        </span>
      </a>
    `;
  }

  function needsCoverPriceTracking(tab) {
    return true;
  }

  function renderDetailsPosterCard(tab, game) {
    const appid = String(game.appid || "");
    const title = getGameLocalizedDisplayName(game);
    const originalName = getGameOriginalName(game);
    const gameUrl = `https://store.steampowered.com/app/${appid}/`;
    const price = resolveGamePrice(game) || {};
    const topTag = getDetailsPosterTopTag(tab, game);
    const ownerTags = getDetailsPosterOwnerTagItems(tab, game);
    const priceTag = renderPosterPriceTag(price);
    return `
      <a class="sffa-poster-card" ${buildSteamLinkAttrs(gameUrl)} data-price-appid="${escapeAttr(appid)}" data-sffa-cover-appid="${escapeAttr(appid)}" data-sffa-cover-kind="poster" aria-label="${escapeAttr(title)}" data-sffa-tooltip="${escapeAttr(`ID ${appid || "-"}\n${originalName}`)}">
        <span class="sffa-poster-top">
          <span class="sffa-poster-left-tags">${topTag}</span>
          <span class="sffa-poster-price">${priceTag}</span>
        </span>
        <span class="sffa-poster-bottom">
          <span class="sffa-poster-title">${escapeHtml(title)}</span>
          <span class="sffa-poster-owner-tags">${renderPosterOwnerTags(ownerTags)}</span>
        </span>
      </a>
    `;
  }

  function getDetailsPosterTopTag(tab, game) {
    if (tab === "family") {
      return renderPosterTimeTag(game.time);
    }
    if (tab !== "all") {
      return "";
    }
    const status = lastReport?.classificationById?.[String(game.appid)]?.status || "pending";
    return renderPosterStatusTag(status);
  }

  function getDetailsPosterOwnerTagItems(tab, game) {
    if (tab === "all" || tab === "new") {
      return getTargetOwnerTagItems(game.targetOwners || []);
    }
    return getOwnerTagItems(game.owners || [], state.familyInfo?.steamIdtoName || {});
  }

  function renderPosterStatusTag(status) {
    return `<span class="sffa-table-tag is-status-${escapeAttr(getCompareStatusClass(status))}">${escapeHtml(getGameListLabelByStatus(status))}</span>`;
  }

  function renderPosterTimeTag(timestamp) {
    const text = formatFamilyAcquireDate(timestamp);
    if (text === "-") {
      return "";
    }
    return `<span class="sffa-table-tag" style="${escapeAttr(getMonthTagStyle(timestamp))}">${escapeHtml(text)}</span>`;
  }

  function renderPosterPriceTag(price) {
    if (!price || price.pending || price.unavailable || price.isFree || price.initial == null || Number(price.initial || 0) <= 0) {
      return "";
    }
    return `<span class="sffa-table-tag ${escapeAttr(getTablePriceTagClass(price))}">${escapeHtml(formatOriginalPriceText(price || {}))}</span>`;
  }

  function renderPosterOwnerTags(items) {
    if (!items.length) {
      return "";
    }
    return items.map(item => `<span class="sffa-table-tag is-tone-${getTagTone(item)}">${escapeHtml(item.label)}</span>`).join("");
  }

  function getDetailsCoverChip(tab, game) {
    if (tab === "all") {
      const status = lastReport?.classificationById?.[String(game.appid)]?.status || "pending";
      return { text: getGameListLabel(game.appid), className: `is-${getCompareStatusClass(status)}` };
    }
    if (tab === "new" || tab === "relativeNew") {
      return null;
    }
    return null;
  }

  function getDetailsCoverMetaLines(tab, game) {
    if (tab === "all") {
      return isMultiTargetReport() ? [formatTargetOwners(game.targetOwners || []) || "-"] : [];
    }
    if (tab === "new") {
      return isMultiTargetReport() ? [formatTargetOwners(game.targetOwners || []) || "-"] : [];
    }
    if (tab === "relativeNew") {
      return [formatOwners(game.owners || []) || "-"];
    }
    if (tab === "family") {
      return [formatOwners(game.owners || []) || "-", formatFamilyAcquireTime(game.time)];
    }
    if (tab === "overlap") {
      return [formatOwners(game.owners || []) || "-"];
    }
    return [];
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
      if (game.price && !game.price.pending && isPriceEntryForCurrentMode(game.price)) {
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
    if (!sort?.key || !isSortAvailableForTab(sort, tab)) {
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
        return getGameLocalizedDisplayName(game);
      case "status":
        return getGameListLabel(game.appid);
      case "owners":
        return formatOwners(game.owners || []);
      case "targetOwners":
        return formatTargetOwners(game.targetOwners || []);
      case "time":
        return Number(game.time || 0);
      case "price":
        return getOriginalPriceSortValue(resolveGamePrice(game) || {});
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
      return getOriginalPriceSortValue(resolveGamePrice(game) || {});
    }
    return getGameListLabel(game.appid);
  }

  function getCurrentListRows(tab = currentTab) {
    const normalizedTab = normalizeMainTab(tab);
    if (normalizedTab === "family") {
      return getSortedRows("family", filterRowsBySearchQuery(getFamilyLibraryRows()));
    }
    if (!lastReport) {
      return [];
    }
    return getSortedRows(normalizedTab, filterRowsBySearchQuery(getReportRowsForCurrentSelection(normalizedTab)));
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
    return buildGameTable(rows, applyGameTableColumnWidths([col(t("game"), "name", nameCell), includeTargetOwners && col(t("targetOwners"), "targetOwners", targetOwnersCell), col(t("status"), "status", statusCell), col(getPriceLabel(), "price", priceCell)]), priceRowAttrs);
  }

  function buildFamilyLibraryTable(rows) {
    return buildGameTable(rows, applyGameTableColumnWidths([col(t("game"), "name", nameCell), col(t("owners"), "owners", ownersCell), col(t("acquiredAt"), "time", timeCell), col(getPriceLabel(), "price", priceCell)]), priceRowAttrs);
  }

  function buildRelativeNewTable(rows) {
    return buildGameTable(rows, applyGameTableColumnWidths([col(t("game"), "name", nameCell), col(t("owners"), "owners", ownersCell), col(getPriceLabel(), "price", priceCell)]), priceRowAttrs);
  }

  function buildNewGamesTable(rows) {
    const includeTargetOwners = isMultiTargetReport();
    return buildGameTable(rows, applyGameTableColumnWidths([col(t("game"), "name", nameCell), includeTargetOwners && col(t("targetOwners"), "targetOwners", targetOwnersCell), col(getPriceLabel(), "price", priceCell)]), priceRowAttrs);
  }

  function buildOverlapTable(rows) {
    return buildGameTable(rows, applyGameTableColumnWidths([col(t("game"), "name", nameCell), col(t("owners"), "owners", ownersCell), col(getPriceLabel(), "price", priceCell)]), priceRowAttrs);
  }

  function priceRowAttrs(game) {
    return ` data-price-appid="${escapeAttr(game.appid)}"`;
  }

  function col(label, key, cell, style = "") {
    return { label, key, cell, style };
  }

  function applyGameTableColumnWidths(columns) {
    const activeColumns = columns.filter(Boolean);
    const remainingWidth = activeColumns.length > 1 ? 50 / (activeColumns.length - 1) : 50;
    return activeColumns.map((column, index) => ({
      ...column,
      style: `width: ${index === 0 ? 50 : remainingWidth}%;${index === 0 ? "" : " text-align: right;"}`
    }));
  }

  function buildGameTable(rows, columns, rowAttrs = () => "") {
    const activeColumns = columns.filter(Boolean);
    return tableHtml(
      `<tr>${activeColumns.map(column => sortableTh(column.label, column.key, column.style)).join("")}</tr>`,
      rows.map(game => `<tr${rowAttrs(game)}>${activeColumns.map(column => column.cell(game)).join("")}</tr>`).join(""),
      buildTableColgroup(activeColumns)
    );
  }

  function buildTableColgroup(columns) {
    const cols = columns.map(column => {
      const width = String(column.style || "").match(/width:\s*([^;]+);?/i)?.[1];
      return `<col${width ? ` style="width: ${escapeAttr(width)};"` : ""}>`;
    }).join("");
    return `<colgroup>${cols}</colgroup>`;
  }

  function buildCell(content, attrs = "") {
    return `<td${attrs}>${content}</td>`;
  }

  function nameCell(game) {
    const appid = String(game.appid || "");
    const displayName = getGameLocalizedDisplayName(game);
    const originalName = getGameOriginalName(game);
    const gameUrl = `https://store.steampowered.com/app/${appid}/`;
    return buildCell(`
      <span class="sffa-game-name">
        <a class="sffa-game-thumb" ${buildSteamLinkAttrs(gameUrl)} aria-label="${escapeAttr(displayName)}" data-sffa-cover-appid="${escapeAttr(appid)}" data-sffa-tooltip="${escapeAttr(appid)}"></a>
        <span class="sffa-game-name-text" data-sffa-tooltip="${escapeAttr(originalName)}">${escapeHtml(displayName)}</span>
      </span>
    `);
  }

  function ownersCell(game) {
    return buildCell(renderTableOwnerTags(getOwnerTagItems(game.owners || [], state.familyInfo?.steamIdtoName || {})));
  }

  function targetOwnersCell(game) {
    return buildCell(renderTableOwnerTags(getTargetOwnerTagItems(game.targetOwners || [])));
  }

  function priceCell(game) {
    return buildCell(formatOriginalPriceCell(resolveGamePrice(game) || {}));
  }

  function timeCell(game) {
    return buildCell(renderTableTimeTag(game.time));
  }

  function statusCell(game) {
    return buildCell(getGameListStatusHtml(game.appid), ` data-status-appid="${escapeAttr(game.appid)}"`);
  }

  function renderTableOwnerTags(items) {
    if (!items.length) {
      return "-";
    }
    return `<span class="sffa-table-tags">${items.map(item => `<span class="sffa-table-tag is-tone-${getTagTone(item)}">${escapeHtml(item.label)}</span>`).join("")}</span>`;
  }

  function renderTableStatusTag(status, content) {
    return `<span class="sffa-table-tags"><span class="sffa-table-tag is-status-${escapeAttr(getCompareStatusClass(status))}">${content}</span></span>`;
  }

  function renderTablePriceTag(price, content) {
    const className = getTablePriceTagClass(price);
    return `<span class="sffa-table-tags"><span class="sffa-table-tag ${escapeAttr(className)}">${content}</span></span>`;
  }

  function renderTableTimeTag(timestamp) {
    const text = formatFamilyAcquireTime(timestamp);
    if (text === "-") {
      return "-";
    }
    const style = getMonthTagStyle(timestamp);
    return `<span class="sffa-table-tags"><span class="sffa-table-tag" style="${escapeAttr(style)}">${escapeHtml(text)}</span></span>`;
  }

  function getTablePriceTagClass(price) {
    if (price?.pending) {
      return "is-muted";
    }
    if (!price || price.unavailable || price.isFree || price.initial == null || Number(price.initial || 0) <= 0) {
      return "is-price-empty";
    }
    const cents = Number(price.initial || 0);
    const rangeIndex = COMPARE_PRICE_RANGES.findIndex(range => cents >= range.min && cents < range.max);
    return `is-price-${Math.max(0, rangeIndex)}`;
  }

  function getMonthTagStyle(timestamp) {
    const date = new Date(Number(timestamp || 0) * 1000);
    const monthKey = date.getFullYear() * 12 + date.getMonth();
    const now = new Date();
    const currentMonthKey = now.getFullYear() * 12 + now.getMonth();
    const age = Math.max(0, currentMonthKey - monthKey);
    const hue = ((monthKey * 47) % 360 + 360) % 360;
    const saturation = Math.max(28, 76 - age * 4);
    const lightness = Math.max(58, 76 - age * 2);
    const alpha = Math.max(0.12, 0.24 - age * 0.01);
    return `background: hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha}); color: hsl(${hue}, ${Math.min(92, saturation + 10)}%, ${Math.min(88, lightness + 10)}%);`;
  }

  function getTagTone(item) {
    if (Number.isInteger(item?.tone)) {
      return item.tone % TAG_TONE_COUNT;
    }
    return getStableTagTone(item?.id);
  }

  function getStableTagTone(value) {
    const text = String(value || "");
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) % TAG_TONE_COUNT;
    }
    return hash;
  }

  function getGameListLabel(appid) {
    const status = lastReport?.classificationById?.[String(appid)]?.status;
    return getGameListLabelByStatus(status);
  }

  function getGameListLabelByStatus(status) {
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
      return renderTableStatusTag(status, `<span class="sffa-status-inline"><span class="sffa-spinner" data-sffa-tooltip="${escapeAttr(t("pending"))}"></span>${escapeHtml(t("pending"))}</span>`);
    }
    return renderTableStatusTag(status || "pending", escapeHtml(getGameListLabel(appid)));
  }

  function getGameDisplayName(game) {
    const originalName = getGameOriginalName(game);
    const localizedName = getGameLocalizedName(game);
    if (!localizedName || normalizeGameName(localizedName) === normalizeGameName(originalName)) {
      return originalName;
    }
    return `${localizedName} (${originalName})`;
  }

  function getGameLocalizedDisplayName(game) {
    return getGameLocalizedName(game) || getGameOriginalName(game);
  }

  function getGameLocalizedName(game) {
    return game.localizedName || getCachedLocalizedName(game.appid) || game.price?.localizedName || "";
  }

  function getGameOriginalName(game) {
    return game.name || game.familyName || `App ${game.appid}`;
  }

  function getCachedLocalizedName(appid) {
    const entry = getStoreCacheEntry(appid);
    if (entry?.context !== STORE_CACHE_CONTEXT) {
      return "";
    }
    return getAnyCachedPriceLocalizedName(entry);
  }

  function getCachedOriginalPrice(appid) {
    return getCurrentCachedPrice(getStoreCacheEntry(appid));
  }

  function resolveGamePrice(game) {
    if (game?.price && (typeof game.price.initial === "number" || game.price.pending || game.price.unavailable) && isPriceEntryForCurrentMode(game.price)) {
      return game.price;
    }
    const appid = String(game?.appid || "");
    const entry = getStoreCacheEntry(appid);
    const cachedPrice = getCurrentCachedPrice(entry);
    if (cachedPrice) {
      return cachedPrice;
    }
    if (!isHistoryLowPriceMode() && isFreshStoreItemPriceFallback(entry)) {
      return normalizeStoreItemOriginalPrice(entry?.storeItem, getPriceMode()) || null;
    }
    return null;
  }

  function isFreshStoreItemPriceFallback(entry) {
    return Boolean(
      entry?.storeItem &&
      Date.now() - Number(entry.updatedAt || 0) < getPriceCacheTtl(getPriceMode())
    );
  }

  function normalizeGameName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[\s™®©:：\-–—_'".,，()[\]（）【】]/g, "");
  }

  function tableHtml(header, body, colgroup = "") {
    return `
      <div class="sffa-table-shell">
        <div class="sffa-table-head-scroll" data-sffa-table-head-scroll>
          <table class="sffa-table">
            ${colgroup}
            <thead>${header}</thead>
          </table>
        </div>
        <div class="sffa-table-body-scroll" data-sffa-table-body-scroll>
          <table class="sffa-table">
            ${colgroup}
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>
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

  // ===== 状态、限流与持久化 =====

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
    const cached = getStoreCacheEntry(appid);
    const cachedPrice = getCurrentCachedPrice(cached);
    return Boolean(
      isFreshStoreCacheEntry(cached) &&
      cached.localizedName &&
      (!cached.supported || cachedPrice)
    );
  }

  function continueAfterRateLimit() {
    if (!rateLimitState.active) {
      return;
    }

    clearRateLimit();
    const pendingShareabilityGames = getPendingShareabilityGames();
    if (resumeShareabilityAfterRateLimit(pendingShareabilityGames)) {
      return;
    }

    if (resumePriceLoadingAfterRateLimit()) {
      return;
    }

    if (resumeCoverLoadingAfterRateLimit()) {
      return;
    }

    setStatus(t("nothingToContinue"), "ok");
  }

  function resumeShareabilityAfterRateLimit(pendingShareabilityGames) {
    if (pendingShareabilityGames.length === 0 || !lastReport) {
      return false;
    }

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
    return true;
  }

  function resumePriceLoadingAfterRateLimit() {
    if (priceLoadState.pendingMap.size <= 0) {
      return false;
    }

    setStatus(t("continuePrices"), "warn");
    scheduleVisiblePriceLoads();
    if (!shareabilityFilterState.running) {
      scheduleBackgroundPriceLoads();
    }
    return true;
  }

  function resumeCoverLoadingAfterRateLimit() {
    if (!getVisibleCoverAppids().some(appid => !hasVerifiedStoreCoverUrl(appid))) {
      return false;
    }

    setStatus(t("continueCovers"), "warn");
    scheduleVisibleCoverLoads();
    return true;
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
    [elements.refreshBtn, elements.analyzeBtn, elements.moreBtn, elements.localeToggleBtn, elements.autoFamilyRefreshBtn, elements.openLinksClientBtn, elements.priceSettingsBtn, elements.copyBtn, elements.saveFamilyPosterBtn, elements.saveListPosterBtn, elements.reloadCoversBtn, elements.copyListBtn, elements.clearStoreCacheBtn, elements.rawBtn].forEach(button => {
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
      const priceConfig = normalizePriceConfig(saved.priceConfig || {});
      return {
        ...cloneDefaultState(),
        ...saved,
        familyPosterSettings: {
          ...cloneDefaultState().familyPosterSettings,
          ...normalizeFamilyPosterSettings(saved.familyPosterSettings || {})
        },
        listPosterSettings: {
          ...cloneDefaultState().listPosterSettings,
          ...normalizeListPosterSettings(saved.listPosterSettings || {})
        },
        familyLibrary: {
          ...cloneDefaultState().familyLibrary,
          ...(saved.familyLibrary || {})
        },
        storeCache: normalizeSavedStoreCache(saved.storeCache || {}),
        launcherVisible: saved.launcherVisible !== false,
        listViewMode: normalizeListViewMode(saved.listViewMode),
        autoFamilyRefreshEnabled: saved.autoFamilyRefreshEnabled !== false,
        openLinksInSteamClient: Boolean(saved.openLinksInSteamClient),
        appLocaleMode,
        priceConfig,
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
      restoreLastAnalysisInputFromHistory();
      return false;
    }

    restoreSavedReport(saved);
    restoreSavedInputs(saved);
    renderRestoredAnalysis();
    renderAnalysisHistoryMenu();
    return true;
  }

  function restoreSavedReport(saved) {
    lastReport = saved.report;
    if (lastReport?.filtering) {
      lastReport.filtering.running = false;
      lastReport.filtering.paused = Boolean(lastReport.filtering.paused);
    }
    currentTab = normalizeMainTab(saved.currentTab);
    tableSortByTab = saved.tableSortByTab || {};
    comparePriceRangeByTarget = {};
    if (Array.isArray(lastReport?.games?.new)) {
      prepareOriginalPrices(lastReport.games.new);
    }
  }

  function restoreLastAnalysisInputFromHistory() {
    const saved = loadAnalysisInputHistory();
    if (saved.lastInputValue || saved.entries.length) {
      restoreSavedInputs({ inputValue: saved.lastInputValue || saved.entries[0]?.inputValue || "" });
    }
    renderAnalysisHistoryMenu(saved);
  }

  function restoreSavedInputs(saved) {
    if (elements.targetInput && saved.inputValue != null) {
      elements.targetInput.value = String(saved.inputValue || "");
    }
    if (elements.searchInput && saved.searchValue != null) {
      elements.searchInput.value = String(saved.searchValue || "");
    }
  }

  function renderRestoredAnalysis() {
    refreshReportMetrics();
    renderTabs();
    renderSummary(lastReport);
    renderTargetProfile(lastReport);
    renderDetailsPreserveScroll();
    renderCurrentStatusText();
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

  function loadAnalysisInputHistory() {
    if (analysisInputHistoryCache) {
      return analysisInputHistoryCache;
    }

    try {
      const saved = GM_getValue(ANALYSIS_INPUT_HISTORY_KEY);
      analysisInputHistoryCache = normalizeAnalysisInputHistory(saved);
    } catch (error) {
      analysisInputHistoryCache = createEmptyAnalysisInputHistory();
    }
    return analysisInputHistoryCache;
  }

  function createEmptyAnalysisInputHistory() {
    return {
      version: 1,
      updatedAt: 0,
      lastInputValue: "",
      entries: [],
      accountNameCache: {}
    };
  }

  function normalizeAnalysisInputHistory(saved) {
    const empty = createEmptyAnalysisInputHistory();
    if (!saved || saved.version !== 1) {
      return empty;
    }

    const accountNameCache = {};
    Object.entries(saved.accountNameCache || {}).forEach(([steamid64, name]) => {
      if (/^\d{17}$/.test(String(steamid64)) && String(name || "").trim()) {
        accountNameCache[String(steamid64)] = String(name).trim();
      }
    });

    const entries = Array.isArray(saved.entries)
      ? saved.entries.map(normalizeAnalysisInputHistoryEntry).filter(Boolean).slice(0, MAX_ANALYSIS_HISTORY_ITEMS)
      : [];
    entries.forEach(entry => {
      entry.targets.forEach(target => {
        if (accountNameCache[target.steamid64]) {
          target.displayName = accountNameCache[target.steamid64];
        }
      });
      if (!entry.displayName && entry.targets.length) {
        entry.displayName = entry.targets.map(target => target.displayName || target.steamid64).join(" + ");
      }
    });

    return {
      ...empty,
      updatedAt: Number(saved.updatedAt || 0),
      lastInputValue: String(saved.lastInputValue || "").trim(),
      entries,
      accountNameCache
    };
  }

  function normalizeAnalysisInputHistoryEntry(entry) {
    const inputValue = String(entry?.inputValue || "").trim();
    if (!inputValue) {
      return null;
    }

    const targets = Array.isArray(entry.targets)
      ? entry.targets.map(normalizeAnalysisInputHistoryTarget).filter(Boolean)
      : [];

    return {
      inputValue,
      displayName: String(entry.displayName || "").trim(),
      targets,
      updatedAt: Number(entry.updatedAt || 0)
    };
  }

  function normalizeAnalysisInputHistoryTarget(target) {
    const steamid64 = String(target?.steamid64 || "");
    const displayName = String(target?.displayName || "").trim();
    if (!/^\d{17}$/.test(steamid64)) {
      return null;
    }
    return {
      steamid64,
      displayName: displayName || steamid64
    };
  }

  function rememberAnalysisInput(inputValue, targetProfile, shouldRender = true) {
    const normalizedInput = String(inputValue || "").trim();
    if (!normalizedInput) {
      return;
    }

    const saved = loadAnalysisInputHistory();
    const targets = extractAnalysisHistoryTargets(targetProfile);
    const displayName = getAnalysisHistoryDisplayName(targetProfile, targets);
    targets.forEach(target => {
      saved.accountNameCache[target.steamid64] = target.displayName;
    });

    const entry = {
      inputValue: normalizedInput,
      displayName,
      targets,
      updatedAt: Date.now()
    };
    saved.entries = [
      entry,
      ...saved.entries.filter(item => item.inputValue !== normalizedInput)
    ].slice(0, MAX_ANALYSIS_HISTORY_ITEMS);
    saved.lastInputValue = normalizedInput;
    saved.updatedAt = entry.updatedAt;
    saveAnalysisInputHistory(saved);

    if (shouldRender) {
      renderAnalysisHistoryMenu(saved);
    }
  }

  function extractAnalysisHistoryTargets(targetProfile) {
    const targets = Array.isArray(targetProfile?.targets) && targetProfile.targets.length
      ? targetProfile.targets
      : [targetProfile].filter(Boolean);
    return targets
      .map(target => normalizeAnalysisInputHistoryTarget(target))
      .filter(Boolean);
  }

  function getAnalysisHistoryDisplayName(targetProfile, targets) {
    const displayName = String(targetProfile?.displayName || "").trim();
    if (displayName) {
      return displayName;
    }
    if (targets.length) {
      return targets.map(target => target.displayName || target.steamid64).join(" + ");
    }
    return "";
  }

  function saveAnalysisInputHistory(history) {
    analysisInputHistoryCache = normalizeAnalysisInputHistory(history);
    GM_setValue(ANALYSIS_INPUT_HISTORY_KEY, {
      version: 1,
      updatedAt: Number(analysisInputHistoryCache.updatedAt || Date.now()),
      lastInputValue: String(analysisInputHistoryCache.lastInputValue || "").trim(),
      entries: (analysisInputHistoryCache.entries || []).slice(0, MAX_ANALYSIS_HISTORY_ITEMS),
      accountNameCache: analysisInputHistoryCache.accountNameCache || {}
    });
  }

  function renderAnalysisHistoryMenu(history = loadAnalysisInputHistory()) {
    if (!elements.historyMenu) {
      return;
    }

    elements.historyMenu.innerHTML = history.entries.map(renderAnalysisHistoryOptionHtml).join("");
    if (!history.entries.length) {
      closeAnalysisHistoryMenu();
    }
  }

  function renderAnalysisHistoryOptionHtml(entry) {
    const label = entry.displayName || entry.targets.map(target => target.displayName).filter(Boolean).join(" + ") || entry.inputValue;
    return `
      <div class="sffa-history-option">
        <button class="sffa-list-option" type="button" role="option" data-sffa-history-option="${escapeAttr(entry.inputValue)}" data-sffa-tooltip="${escapeAttr(entry.inputValue)}">
          <span class="sffa-history-option-main">${escapeHtml(label)}</span>
          <span class="sffa-history-option-sub">${escapeHtml(entry.inputValue)}</span>
        </button>
        <button class="sffa-history-delete" type="button" data-sffa-history-delete="${escapeAttr(entry.inputValue)}" data-sffa-tooltip="${escapeAttr(t("deleteHistory"))}" aria-label="${escapeAttr(t("deleteHistory"))}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path d="M9 4h6l1 2h4v2H4V6h4l1-2Z" fill="currentColor"></path>
            <path d="M6 10h12l-1 10H7L6 10Zm4 2v6h2v-6h-2Zm4 0v6h2v-6h-2Z" fill="currentColor"></path>
          </svg>
        </button>
      </div>
    `;
  }

  function clearAnalysisHistory() {
    GM_deleteValue(ANALYSIS_HISTORY_KEY);
    GM_deleteValue(ANALYSIS_INPUT_HISTORY_KEY);
    analysisInputHistoryCache = createEmptyAnalysisInputHistory();
    renderAnalysisHistoryMenu(analysisInputHistoryCache);
  }

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function isFreshStoreCacheEntry(entry, expectedContext = STORE_CACHE_CONTEXT) {
    return Boolean(
      entry &&
      typeof entry.supported === "boolean" &&
      entry.context === expectedContext &&
      Date.now() - Number(entry.updatedAt || 0) < STORE_CACHE_TTL_MS
    );
  }

  function isRestorableStoreCacheEntry(entry, expectedContext = STORE_CACHE_CONTEXT) {
    return Boolean(
      isFreshStoreCacheEntry(entry, expectedContext) ||
      isFreshCoverCacheEntry(entry, expectedContext) ||
      isFreshStoreItemCacheEntry(entry, expectedContext) ||
      (entry &&
        entry.context === expectedContext &&
        hasFreshCachedPrice(entry))
    );
  }

  function isFreshCoverCacheEntry(entry, expectedContext = STORE_CACHE_CONTEXT) {
    return Boolean(
      entry &&
      entry.context === expectedContext &&
      entry.coverVerified === true &&
      typeof entry.coverUrl === "string" &&
      entry.coverUrl &&
      Date.now() - Number(entry.updatedAt || 0) < STORE_CACHE_TTL_MS
    );
  }

  function isFreshStoreItemCacheEntry(entry, expectedContext = STORE_CACHE_CONTEXT) {
    return Boolean(
      entry &&
      entry.context === expectedContext &&
      entry.storeItem &&
      typeof entry.storeItem === "object" &&
      Date.now() - Number(entry.updatedAt || 0) < STORE_CACHE_TTL_MS
    );
  }

  function getStoreCacheCount() {
    return Object.values(getStoreCacheBuckets())
      .reduce((sum, bucket) => sum + Object.keys(bucket || {}).length, 0);
  }

  function getStoreCacheBuckets() {
    state.storeCache = state.storeCache && typeof state.storeCache === "object" && !Array.isArray(state.storeCache)
      ? state.storeCache
      : {};
    state.storeCache[STORE_CACHE_BUCKETS_KEY] = state.storeCache[STORE_CACHE_BUCKETS_KEY] && typeof state.storeCache[STORE_CACHE_BUCKETS_KEY] === "object"
      ? state.storeCache[STORE_CACHE_BUCKETS_KEY]
      : {};
    return state.storeCache[STORE_CACHE_BUCKETS_KEY];
  }

  function getActiveStoreCache() {
    const buckets = getStoreCacheBuckets();
    buckets[STORE_CACHE_CONTEXT] = buckets[STORE_CACHE_CONTEXT] && typeof buckets[STORE_CACHE_CONTEXT] === "object"
      ? buckets[STORE_CACHE_CONTEXT]
      : {};
    return buckets[STORE_CACHE_CONTEXT];
  }

  function getStoreCacheEntry(appid) {
    return getActiveStoreCache()[String(appid || "")] || null;
  }

  function setStoreCacheEntry(appid, entry) {
    const key = String(appid || "");
    if (!key) {
      return;
    }
    getActiveStoreCache()[key] = entry;
  }

  function normalizeCachedPrices(entry) {
    const normalized = {};
    const sourcePrices = entry?.prices && typeof entry.prices === "object" && !Array.isArray(entry.prices)
      ? entry.prices
      : {};
    Object.entries(sourcePrices).forEach(([key, price]) => {
      if (!isFreshAnyPriceCacheEntry(price, key)) {
        return;
      }
      const cacheKey = key === PRICE_MODE_ORIGINAL || key === PRICE_MODE_CURRENT || key === PRICE_MODE_HISTORY_LOW
        ? key
        : getPriceCacheKeyForPrice(price);
      normalized[cacheKey] = price;
    });
    if (isFreshAnyPriceCacheEntry(entry?.price)) {
      normalized[getPriceCacheKeyForPrice(entry.price)] = entry.price;
    }
    return normalized;
  }

  function getCurrentCachedPrice(entry) {
    const price = normalizeCachedPrices(entry)[getPriceCacheKeyForMode()];
    return isFreshOriginalPriceCacheEntry(price) ? price : null;
  }

  function hasFreshCachedPrice(entry) {
    return Object.entries(normalizeCachedPrices(entry)).some(([key, price]) => isFreshAnyPriceCacheEntry(price, key));
  }

  function getAnyCachedPriceLocalizedName(entry) {
    const prices = normalizeCachedPrices(entry);
    return entry?.localizedName ||
      prices.original?.localizedName ||
      prices.current?.localizedName ||
      prices.historyLow?.localizedName ||
      "";
  }

  function isFreshOriginalPriceCacheEntry(entry) {
    return Boolean(
      isFreshAnyPriceCacheEntry(entry) &&
      isPriceEntryForCurrentMode(entry)
    );
  }

  function isFreshAnyPriceCacheEntry(entry, mode = getPriceCacheKeyForPrice(entry)) {
    return Boolean(
      entry &&
      (typeof entry.initial === "number" || entry.unavailable === true) &&
      Object.prototype.hasOwnProperty.call(entry, "localizedName") &&
      Date.now() - Number(entry.updatedAt || 0) < getPriceCacheTtl(mode)
    );
  }

  function getPriceCacheTtl(mode) {
    return normalizePriceMode(mode) === PRICE_MODE_CURRENT ? CURRENT_PRICE_CACHE_TTL_MS : STORE_CACHE_TTL_MS;
  }

  function isPriceEntryForCurrentMode(entry) {
    if (entry?.pending) {
      return true;
    }
    const source = entry?.source || PRICE_SOURCE_ORIGINAL;
    if (isHistoryLowPriceMode()) {
      return source === PRICE_SOURCE_ITAD_STORE_LOW;
    }
    return isCurrentPriceMode() ? source === PRICE_SOURCE_CURRENT : source === PRICE_SOURCE_ORIGINAL;
  }

  function cacheOriginalPrice(appid, price) {
    if (!isFreshOriginalPriceCacheEntry(price)) {
      return;
    }
    const prices = {
      [getPriceCacheKeyForPrice(price)]: price
    };
    setStoreCacheEntry(appid, mergeStoreCacheEntry(getStoreCacheEntry(appid), {
      context: STORE_CACHE_CONTEXT,
      localizedName: price.localizedName || "",
      prices,
      updatedAt: Date.now()
    }));
  }

  function cacheStoreItem(appid, item) {
    if (!item || Number(item.success) !== 1) {
      return;
    }
    const coverUrl = extractStoreCoverUrlFromStoreItem(item);
    const originalPrice = normalizeStoreItemOriginalPrice(item, PRICE_MODE_ORIGINAL);
    const currentPrice = normalizeStoreItemOriginalPrice(item, PRICE_MODE_CURRENT);
    const prices = {
      ...(originalPrice ? { [PRICE_MODE_ORIGINAL]: originalPrice } : {}),
      ...(currentPrice ? { [PRICE_MODE_CURRENT]: currentPrice } : {})
    };
    setStoreCacheEntry(appid, mergeStoreCacheEntry(getStoreCacheEntry(appid), {
      context: STORE_CACHE_CONTEXT,
      localizedName: item.name || originalPrice?.localizedName || currentPrice?.localizedName || "",
      ...(coverUrl ? { coverUrl, coverVerified: true } : {}),
      ...(Object.keys(prices).length ? { prices } : {}),
      storeItem: item,
      updatedAt: Date.now()
    }));
  }

  function mergeStoreCacheEntry(existing, next) {
    const updatedAt = Math.max(Number(existing?.updatedAt || 0), Number(next?.updatedAt || 0));
    const sameContext = !existing?.context || !next?.context || existing.context === next.context;
    const existingPrices = sameContext ? normalizeCachedPrices(existing) : {};
    const nextPrices = normalizeCachedPrices(next);
    const prices = {
      ...existingPrices,
      ...nextPrices
    };
    return {
      ...(existing || {}),
      ...(next || {}),
      localizedName: next?.localizedName || getAnyCachedPriceLocalizedName({ prices: nextPrices }) || (sameContext ? getAnyCachedPriceLocalizedName({ ...existing, prices: existingPrices }) : ""),
      coverUrl: next?.coverUrl || existing?.coverUrl || "",
      coverVerified: next?.coverVerified === true || existing?.coverVerified === true,
      prices,
      price: null,
      storeItem: mergeStoreItem(existing?.storeItem, next?.storeItem),
      updatedAt: updatedAt || Date.now()
    };
  }

  function mergeStoreItem(existing, next) {
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return next || existing || null;
    }
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      return next;
    }
    const merged = { ...existing };
    Object.entries(next).forEach(([key, value]) => {
      merged[key] = value && typeof value === "object" && !Array.isArray(value)
        ? mergeStoreItem(existing[key], value)
        : value;
    });
    return merged;
  }

  function normalizeSavedStoreCache(storeCache) {
    const normalizedBuckets = {};
    const sourceBuckets = storeCache?.[STORE_CACHE_BUCKETS_KEY] && typeof storeCache[STORE_CACHE_BUCKETS_KEY] === "object"
      ? storeCache[STORE_CACHE_BUCKETS_KEY]
      : { [STORE_CACHE_CONTEXT]: storeCache || {} };
    Object.entries(sourceBuckets).forEach(([context, bucket]) => {
      const normalizedBucket = {};
      Object.entries(bucket || {}).forEach(([appid, entry]) => {
        const normalizedEntry = normalizeSavedStoreCacheEntry(entry, context);
        if (normalizedEntry) {
          normalizedBucket[String(appid)] = normalizedEntry;
        }
      });
      if (Object.keys(normalizedBucket).length) {
        normalizedBuckets[context] = normalizedBucket;
      }
    });
    return { [STORE_CACHE_BUCKETS_KEY]: normalizedBuckets };
  }

  function normalizeSavedStoreCacheEntry(entry, context) {
    const normalizedContext = entry?.context || context || STORE_CACHE_CONTEXT;
    if (isRestorableStoreCacheEntry(entry, normalizedContext)) {
      const prices = normalizeCachedPrices(entry);
      return {
        ...(typeof entry.supported === "boolean" ? { supported: entry.supported } : {}),
        context: normalizedContext,
        localizedName: entry.localizedName || getAnyCachedPriceLocalizedName({ prices }) || "",
        coverUrl: entry.coverUrl || "",
        coverVerified: entry.coverVerified === true,
        prices,
        price: null,
        storeItem: isFreshStoreItemCacheEntry(entry, normalizedContext) ? entry.storeItem : null,
        updatedAt: Number(entry.updatedAt || Date.now())
      };
    }
    return null;
  }

  // ===== 网络请求与底层工具 =====

  function requestJson(url) {
    return request(url, "json");
  }

  function requestPostJson(url, data) {
    return request(url, "json", {
      method: "POST",
      data: JSON.stringify(data),
      headers: {
        "Accept": "application/json,text/javascript,*/*;q=0.1",
        "Content-Type": "application/json"
      }
    });
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

  function request(url, responseType, options = {}) {
    return new Promise((resolve, reject) => {
      const endpoint = describeRequestEndpoint(url);
      GM_xmlhttpRequest({
        method: options.method || "GET",
        url,
        anonymous: false,
        withCredentials: true,
        headers: {
          "Accept": responseType === "json" ? "application/json,text/javascript,*/*;q=0.1" : "application/xml,text/xml,text/html,*/*;q=0.1",
          ...(options.headers || {})
        },
        ...(options.data != null ? { data: options.data } : {}),
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

  function appendQuery(url, params) {
    const parsed = new URL(url);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value != null && value !== "") {
        parsed.searchParams.set(key, String(value));
      }
    });
    return parsed.toString();
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
    const items = getOwnerTagItems(owners, state.familyInfo?.steamIdtoName || {});
    if (!items.length) {
      return "";
    }
    return items
      .map(item => item.label)
      .join(UI_LOCALE === "en" ? ", " : "、");
  }

  function formatTargetOwners(owners) {
    const items = getTargetOwnerTagItems(owners);
    if (!items.length) {
      return "";
    }

    return items
      .map(item => item.label)
      .join(UI_LOCALE === "en" ? ", " : "、");
  }

  function getOwnerTagItems(owners, nameById) {
    return Array.from(new Set((owners || []).map(String).filter(Boolean)))
      .map(steamid => ({
        id: steamid,
        label: nameById?.[steamid] || steamid,
        tone: getOwnerTone(steamid)
      }));
  }

  function getTargetOwnerTagItems(owners) {
    const selectedIds = isMultiTargetReport() ? new Set(getSelectedTargetSteamIds()) : null;
    const ownerIds = Array.from(new Set((owners || []).map(String).filter(Boolean)))
      .filter(steamid => !selectedIds || selectedIds.has(steamid));
    if (!ownerIds.length) {
      return [];
    }

    const targetNameById = getTargetNameById();
    return ownerIds
      .map(steamid => ({
        id: steamid,
        label: targetNameById[steamid] || steamid,
        tone: getTargetOwnerTone(steamid)
      }));
  }

  function getOwnerTone(steamid) {
    return getOrderedToneFromMap(steamid, getFamilyOwnerToneMap());
  }

  function getTargetOwnerTone(steamid) {
    return getOrderedToneFromMap(steamid, getTargetOwnerToneMap());
  }

  function getOrderedToneFromMap(steamid, toneById) {
    const id = String(steamid || "");
    return toneById.has(id) ? toneById.get(id) : getStableTagTone(id);
  }

  function getFamilyOwnerToneMap() {
    const key = `${state.familyLibrary?.updatedAt || 0}:${state.familyLibrary?.appidSet?.length || 0}:${Object.keys(state.familyInfo?.steamIdtoName || {}).length}`;
    if (familyOwnerToneCache.key === key) {
      return familyOwnerToneCache.map;
    }
    familyOwnerToneCache = {
      key,
      map: buildToneMap(getFamilyOwnerIds())
    };
    return familyOwnerToneCache.map;
  }

  function getTargetOwnerToneMap() {
    const key = getTargetOwnerIds().join("|");
    if (targetOwnerToneCache.key === key) {
      return targetOwnerToneCache.map;
    }
    targetOwnerToneCache = {
      key,
      map: buildToneMap(getTargetOwnerIds())
    };
    return targetOwnerToneCache.map;
  }

  function buildToneMap(orderedIds) {
    const toneById = new Map();
    orderedIds.forEach((id, index) => {
      toneById.set(String(id), index % TAG_TONE_COUNT);
    });
    return toneById;
  }

  function getFamilyOwnerIds() {
    const ids = new Set();
    (state.familyLibrary?.appidSet || []).forEach(appid => {
      const info = state.familyLibrary?.appInfoById?.[String(appid)];
      (info?.owners || []).map(String).filter(Boolean).forEach(id => ids.add(id));
    });
    Object.keys(state.familyInfo?.steamIdtoName || {}).forEach(id => ids.add(String(id)));
    return Array.from(ids);
  }

  function getTargetOwnerIds() {
    const targets = Array.isArray(lastReport?.target?.targets) && lastReport.target.targets.length
      ? lastReport.target.targets
      : [lastReport?.target].filter(Boolean);
    return targets.map(target => String(target?.steamid64 || "")).filter(Boolean);
  }

  function getTargetNameById() {
    const targets = getTargetOwnerIds().map(steamid64 => ({ steamid64 }));
    const names = {};
    const rawTargets = Array.isArray(lastReport?.target?.targets) && lastReport.target.targets.length
      ? lastReport.target.targets
      : [lastReport?.target].filter(Boolean);
    rawTargets.forEach(target => {
      const steamid64 = String(target?.steamid64 || "");
      if (steamid64) {
        names[steamid64] = getTargetProfileDisplayName(target);
      }
    });
    targets.forEach(target => {
      if (target.steamid64 && !names[target.steamid64]) {
        names[target.steamid64] = target.steamid64;
      }
    });
    return names;
  }

  function isMultiTargetReport(report = lastReport) {
    return Array.isArray(report?.target?.targets) && report.target.targets.length > 1;
  }

  function formatOriginalPriceCell(price) {
    if (price?.pending) {
      return renderTablePriceTag(price, `<span class="sffa-spinner" data-sffa-tooltip="${escapeAttr(t("loading"))}"></span>`);
    }
    if (!price || (price.initial == null && !price.unavailable && !price.isFree)) {
      return renderTablePriceTag(price, "-");
    }
    if (price.unavailable) {
      return renderTablePriceTag(price, "-");
    }
    return renderTablePriceTag(price, escapeHtml(formatMoney(Number(price.initial || 0), price.currency)));
  }

  function formatOriginalPriceText(price) {
    if (price?.pending) {
      return t("loading");
    }
    if (!price || (price.initial == null && !price.unavailable && !price.isFree)) {
      return "-";
    }
    if (price.unavailable) {
      return "-";
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
    return STORE_CC_TO_LOCALE[STORE_CC] || "en-US";
  }

  function getStoreCurrency() {
    return STORE_CC_TO_CURRENCY[STORE_CC] || "USD";
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

  function formatFamilyAcquireDate(timestamp) {
    const seconds = Number(timestamp || 0);
    if (!seconds) {
      return "-";
    }
    return new Date(seconds * 1000).toLocaleDateString(getNumberLocale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
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

  function buildSteamLinkAttrs(url) {
    const href = getSteamOpenUrl(url);
    const targetAttrs = isSteamClientUrl(href) ? "" : ` target="_blank" rel="noopener"`;
    return `href="${escapeAttr(href)}"${targetAttrs}`;
  }

  function getSteamOpenUrl(url) {
    const normalized = String(url || "").trim();
    if (!state.openLinksInSteamClient || !isSteamWebUrl(normalized)) {
      return normalized;
    }
    return `steam://openurl/${encodeURI(normalized)}`;
  }

  function isSteamWebUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      return parsed.protocol === "https:" && (
        parsed.hostname === "store.steampowered.com" ||
        parsed.hostname === "steamcommunity.com"
      );
    } catch (error) {
      return false;
    }
  }

  function isSteamClientUrl(url) {
    return String(url || "").startsWith("steam://");
  }
})();
