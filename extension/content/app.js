(async function runSteamFamilyGroupHelperApp() {
  "use strict";

  const {
    sffaExtensionDeleteValue,
    sffaExtensionGetValue,
    sffaExtensionPageState,
    sffaExtensionRequest,
    sffaExtensionSetValue
  } = await globalThis.sffaExtensionReady;

(function () {
  "use strict";

  const {
    FALLBACK_STORE_CC,
    FALLBACK_STORE_LANG,
    APP_LOCALE,
    STORAGE_KEY,
    STORE_CACHE_TTL_MS,
    ORIGINAL_PRICE_BATCH_SIZE,
    SHAREABILITY_BATCH_SIZE,
    FAMILY_POSTER_COLUMNS,
    COVER_RELOAD_BATCH_SIZE,
    STORE_REQUEST_DELAY_MS,
    SEARCH_RENDER_DEBOUNCE_MS,
    AUTO_FAMILY_REFRESH_INTERVAL_MS,
    ANALYSIS_HISTORY_KEY,
    ANALYSIS_INPUT_HISTORY_KEY,
    MAX_ANALYSIS_HISTORY_ITEMS,
    FAMILY_SHARING_CATEGORY_ID,
    STEAMID64_INDIVIDUAL_BASE,
    MAX_STEAM_ACCOUNT_ID,
    MAX_STEAM_ACCOUNT_ID_LENGTH,
    COMPARE_PRICE_RANGES,
    COMPARE_QUALITY_LEVELS,
    REPORT_LIST_TABS,
    STEAM_LANGUAGE_ALIASES,
    STORE_ITEM_ASSET_BASE_URL,
    FAMILY_POSTER_SORT_MODES,
    LIST_POSTER_BASE_SORT_MODES,
    FAMILY_POSTER_WIDTH,
    FAMILY_POSTER_PADDING,
    FAMILY_POSTER_GAP,
    FAMILY_POSTER_CARD_WIDTH,
    FAMILY_POSTER_CARD_ASPECT_RATIO,
    FAMILY_POSTER_HEADER_HEIGHT,
    FAMILY_POSTER_MAX_HEIGHT,
    FAMILY_POSTER_IMAGE_CONCURRENCY,
    STORE_CC_TO_LOCALE,
    STORE_CC_TO_CURRENCY
  } = globalThis.SFFA_CONFIG;

  const {
    createStoreCacheContext,
    getDetectedStoreCountryFromPage,
    getDetectedStoreLanguage,
    normalizeStoreCountry,
    resolveStoreCountryFromAccount
  } = globalThis.SFFA_CREATE_STORE_CONTEXT({
    document,
    fallbackStoreLang: FALLBACK_STORE_LANG,
    location,
    pageState: sffaExtensionPageState,
    steamLanguageAliases: STEAM_LANGUAGE_ALIASES,
    window
  });

  const STORE_LANG = getDetectedStoreLanguage();
  const INITIAL_STORE_CC = getDetectedStoreCountryFromPage();
  let STORE_CC = INITIAL_STORE_CC || FALLBACK_STORE_CC;
  let STORE_CACHE_CONTEXT = getStoreCacheContext();
  let appLocaleMode = getSavedAppLocaleMode();
  let UI_LOCALE = resolveUiLocale(appLocaleMode, STORE_LANG);

  // ===== 本地化与商店上下文 =====

  const I18N = globalThis.SFFA_I18N;
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
      return normalizeAppLocaleMode(sffaExtensionGetValue(STORAGE_KEY)?.appLocaleMode);
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

  function getStoreCacheContext() {
    return createStoreCacheContext(STORE_CC, STORE_LANG);
  }

  function setStoreCountry(country) {
    const normalized = normalizeStoreCountry(country);
    if (!normalized || normalized === STORE_CC) {
      return;
    }
    STORE_CC = normalized;
    STORE_CACHE_CONTEXT = getStoreCacheContext();
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
    lastAutoFamilyRefreshAttemptAt: 0,
    appLocaleMode: APP_LOCALE,
    apiKey: ""
  });

  const {
    createCoverLoadState,
    createCoverProbeState,
    createPriceLoadState,
    createRateLimitState,
    createShareabilityFilterState,
    createShareabilityProgressUiState
  } = globalThis.SFFA_CREATE_LOAD_STATES();
  let rateLimitController = null;

  let state = null;
  let currentTab = "all";
  let tableSortByTab = {};
  let lastReport = null;
  let lastRawData = null;
  let storeRequestQueue = Promise.resolve();
  let activeAnalysisId = 0;
  let shareabilityFilterState = createShareabilityFilterState();
  let shareabilityProgressUiState = createShareabilityProgressUiState();
  let rateLimitState = createRateLimitState();
  let analysisSessionStore = null;
  let steamApi = null;
  let compareDialog = null;
  let posterHelpers = null;
  let searchRenderTimer = 0;
  let coverReloadToken = 0;
  let elements = {};

  const {
    closeAnalysisHistoryMenu,
    closeCopyListMenu,
    closeFamilyPosterSortMenu,
    closeListMenu,
    closeMenu,
    openAnalysisHistoryMenu,
    toggleCopyListMenu,
    toggleFamilyPosterSortMenu,
    toggleListMenu,
    toggleLocaleMenu,
    toggleMenu
  } = globalThis.SFFA_CREATE_MENU_STATE({
    getElements: () => elements
  });

  const {
    createRawDataSnapshot,
    resetRawData,
    setRawData,
    setRawError,
    setRawStep,
    showRawDataWindow
  } = globalThis.SFFA_CREATE_RAW_DATA_STORE({
    closeMenu,
    getLastRawData: () => lastRawData,
    setLastRawData: value => { lastRawData = value; },
    setStatus,
    t,
    window
  });
  lastRawData = createRawDataSnapshot("init");

  const {
    createHttpError,
    createRateLimitError,
    isHttp429,
    isRateLimitError,
    requestJson,
    requestStoreJson,
    requestText,
    sleep
  } = globalThis.SFFA_CREATE_HTTP_HELPERS({
    getRateLimitState: () => rateLimitState,
    getStoreRequestDelayMs: () => STORE_REQUEST_DELAY_MS,
    getStoreRequestQueue: () => storeRequestQueue,
    setRawData,
    setStoreRequestQueue: nextQueue => { storeRequestQueue = nextQueue; },
    sffaExtensionRequest,
    t,
    window
  });

  const {
    decodeHtml,
    escapeAttr,
    escapeHtml,
    formatDateTime,
    formatFamilyAcquireTime,
    formatMoney,
    formatOriginalPriceCell,
    formatOriginalPriceText,
    formatOwners,
    formatPercent,
    formatTargetOwners,
    getNumberLocale,
    getStoreCurrency,
    getTabLabel,
    isMultiTargetReport,
    normalizeCopyCell,
    readJsonAttribute,
    sortByName,
    sortFamilyLibraryRows
  } = globalThis.SFFA_CREATE_FORMAT_HELPERS({
    document,
    getLastReport: () => lastReport,
    getSelectedTargetSteamIds,
    getState: () => state,
    getStoreCountry: () => STORE_CC,
    getStoreCurrencyMap: () => STORE_CC_TO_CURRENCY,
    getStoreLocaleMap: () => STORE_CC_TO_LOCALE,
    getTargetProfileDisplayName,
    getUiLocale: () => UI_LOCALE,
    t
  });

  const {
    hasPriceOverview,
    isZeroValueOriginalPrice,
    normalizeOriginalPrice,
    normalizeStoreItemOriginalPrice
  } = globalThis.SFFA_CREATE_PRICE_UTILS({
    getStoreCurrency
  });

  const {
    collectPanelElements,
    createPanelRoot
  } = globalThis.SFFA_CREATE_PANEL_SHELL({
    buildLocaleOptionHtml,
    document,
    escapeAttr,
    escapeHtml,
    getLocaleModeButtonText,
    t
  });

  const {
    cacheStoreCoverUrl,
    extractStoreAssetUrlFromStoreItem,
    extractStoreCoverUrlFromAppdetails,
    extractStoreCoverUrlFromStoreItem,
    extractStorePosterCoverUrlFromStoreItem,
    getCachedStoreCoverUrl,
    getCompareGameCoverUrl,
    withCoverReloadToken
  } = globalThis.SFFA_CREATE_STORE_ASSETS({
    getCoverReloadToken: () => coverReloadToken,
    getState: () => state,
    getStoreCacheContext: () => STORE_CACHE_CONTEXT,
    getStoreItemAssetBaseUrl: () => STORE_ITEM_ASSET_BASE_URL,
    mergeStoreCacheEntry: (...args) => mergeStoreCacheEntry(...args)
  });

  const {
    applyVisibleCoverImages,
    getCoverProbeState,
    hasVerifiedStoreCoverUrl,
    scheduleVisibleCoverLoads
  } = globalThis.SFFA_CREATE_COVER_LOAD_FLOW({
    COVER_RELOAD_BATCH_SIZE,
    clearCachedStoreCoverUrl: appid => clearCachedStoreCoverUrl(appid),
    createCoverLoadState,
    createCoverProbeState,
    fetchCoverUrlBatch: (...args) => fetchCoverUrlBatch(...args),
    getCachedStoreCoverUrl,
    getCompareGameCoverUrl,
    getElements: () => elements,
    getListViewMode: () => getListViewMode(),
    getRateLimitState: () => rateLimitState,
    getState: () => state,
    getVisibleCoverAppids: () => getVisibleCoverAppids(),
    isCompareDialogOpen,
    isRateLimitError,
    renderCompareDialogIfOpen,
    renderDetailsPreserveScroll,
    saveState,
    setRateLimited,
    setRawError,
    shouldProcessVisibleCovers: () => shouldProcessVisibleCovers(),
    withCoverReloadToken,
    window
  });

  const {
    cacheOriginalPrice,
    cacheStoreItem,
    cloneDefaultState,
    getStoreCacheCount,
    isFreshCoverCacheEntry,
    isFreshOriginalPriceCacheEntry,
    isFreshStoreCacheEntry,
    isFreshStoreItemCacheEntry,
    isRestorableStoreCacheEntry,
    mergeStoreCacheEntry,
    mergeStoreItem,
    normalizeSavedStoreCache
  } = globalThis.SFFA_CREATE_STATE_STORE({
    extractStoreCoverUrlFromStoreItem,
    getDefaultState: () => DEFAULT_STATE,
    getState: () => state,
    getStoreCacheContextValue: () => STORE_CACHE_CONTEXT,
    getStoreCacheTtlMs: () => STORE_CACHE_TTL_MS,
    normalizeStoreItemOriginalPrice
  });
  state = cloneDefaultState();

  const {
    applyOriginalPriceToGame,
    getPriceLoadState,
    prepareOriginalPriceForGame,
    resetPriceLoadState,
    scheduleBackgroundPriceLoads,
    scheduleVisiblePriceLoads,
    startLazyOriginalPriceLoading
  } = globalThis.SFFA_CREATE_PRICE_LOAD_FLOW({
    ORIGINAL_PRICE_BATCH_SIZE,
    cacheOriginalPrice,
    createPriceLoadState,
    fetchOriginalPrices: (...args) => fetchOriginalPrices(...args),
    getElements: () => elements,
    getLastReport: () => lastReport,
    getRateLimitState: () => rateLimitState,
    getShareabilityFilterState: () => shareabilityFilterState,
    getState: () => state,
    isFreshOriginalPriceCacheEntry,
    isFreshStoreCacheEntry,
    isRateLimitError,
    normalizeOriginalPrice,
    refreshReportMetrics,
    renderDetailsAfterPriceChange,
    renderStoreCacheButton: (...args) => renderStoreCacheButton(...args),
    renderSummary: (...args) => renderSummary(...args),
    saveState,
    scheduleVisibleCoverLoads,
    setRateLimited,
    setRawError,
    window
  });

  const {
    fetchStoreItemBatch
  } = globalThis.SFFA_CREATE_STORE_ITEM_BATCH({
    cacheStoreItem,
    getStoreCountry: () => STORE_CC,
    getStoreLang: () => STORE_LANG,
    requestStoreJson,
    setRawData,
    t
  });

  const {
    buildCurrentListCopyTable,
    cancelSearchRender,
    getCachedLocalizedName,
    getCachedOriginalPrice,
    getCurrentListRows,
    getFamilyLibraryRows,
    getGameDisplayName,
    getGameListLabel,
    getGameListStatusHtml,
    getMainTabLabel,
    getListViewMode,
    getOriginalPriceSortValue,
    handleTableHeaderClick,
    isReportListTab,
    normalizeListViewMode,
    normalizeMainTab,
    renderDetails,
    renderSearchClearButton,
    renderStoreCacheButton,
    renderTabs,
    scheduleSearchRender,
    setListViewMode,
    setReportTab
  } = globalThis.SFFA_CREATE_DETAILS_RENDERER({
    applyVisibleCoverImages,
    closeListMenu,
    escapeAttr,
    escapeHtml,
    formatFamilyAcquireTime,
    formatOriginalPriceCell,
    formatOriginalPriceText,
    formatOwners,
    formatTargetOwners,
    getComparePriceChipClass,
    getCompareStatusClass,
    getCurrentTab: () => currentTab,
    getElements: () => elements,
    getLastReport: () => lastReport,
    getNumberLocale,
    getSelectedTargetSteamIds,
    getState: () => state,
    getStoreCacheCount,
    getTabLabel,
    getTableSortByTab: () => tableSortByTab,
    isFreshOriginalPriceCacheEntry,
    isGameIncludedBySelectedTargets,
    isMultiTargetReport,
    prepareOriginalPriceForGame,
    renderCompareDialogIfOpen,
    renderDetailsPreserveScroll,
    REPORT_LIST_TABS,
    saveState,
    scheduleAnalysisHistorySave,
    scheduleVisibleCoverLoads,
    scheduleVisiblePriceLoads,
    SEARCH_RENDER_DEBOUNCE_MS,
    setCurrentTab: value => { currentTab = value; },
    sortByName,
    sortFamilyLibraryRows,
    t,
    window
  });

  compareDialog = globalThis.SFFA_CREATE_COMPARE_DIALOG({
    COMPARE_PRICE_RANGES,
    COMPARE_QUALITY_LEVELS,
    applyVisibleCoverImages,
    closeMenu,
    escapeAttr,
    escapeHtml,
    formatMoney,
    formatOriginalPriceText,
    formatPercent,
    getElements: () => elements,
    getGameDisplayName,
    getLastReport: () => lastReport,
    getNumberLocale,
    getOriginalPriceSortValue,
    getState: () => state,
    getTargetProfileDisplayName,
    isMultiTargetReport,
    scheduleVisibleCoverLoads,
    setStatus,
    t
  });

  const {
    renderAutoFamilyRefreshButton,
    renderFamilyMeta,
    renderSummary,
    renderTargetProfile
  } = globalThis.SFFA_CREATE_SUMMARY_RENDERER({
    escapeAttr,
    escapeHtml,
    formatDateTime,
    formatMoney,
    formatPercent,
    getElements: () => elements,
    getState: () => state,
    getTargetProfileDisplayName,
    t
  });

  const {
    copyCurrentGamesOnly,
    copyCurrentList,
    copyReportSummary
  } = globalThis.SFFA_CREATE_COPY_ACTIONS({
    buildCurrentListCopyTable,
    closeCopyListMenu,
    closeMenu,
    formatMoney,
    formatPercent,
    getCurrentListRows,
    getCurrentTab: () => currentTab,
    getGameDisplayName,
    getLastReport: () => lastReport,
    labelValue,
    navigator,
    normalizeCopyCell,
    setStatus,
    t
  });

  const {
    createFamilyPosterDialogContext,
    createListPosterCanvasContext,
    createListPosterDialogContext,
    getFamilyPosterSettings,
    getFamilyPosterSortModeLabel,
    getListPosterSettings,
    normalizeFamilyPosterColumns,
    normalizeFamilyPosterScalePercent,
    normalizeFamilyPosterSettings,
    normalizeListPosterSettings,
    normalizePosterSettingsForContext,
    normalizePosterSortMode
  } = globalThis.SFFA_CREATE_POSTER_SETTINGS({
    FAMILY_POSTER_COLUMNS,
    FAMILY_POSTER_SORT_MODES,
    LIST_POSTER_BASE_SORT_MODES,
    getCurrentTab: () => currentTab,
    getGenerateFamilyPoster: () => posterHelpers.generateFamilyPoster,
    getGenerateListPoster: () => posterHelpers.generateListPoster,
    getState: () => state,
    getTabLabel,
    isMultiTargetReport,
    normalizeMainTab,
    t
  });

  const {
    fetchOriginalPrice,
    fetchOriginalPrices,
    fetchShareabilityBatch,
    fetchShareabilityFallback
  } = globalThis.SFFA_CREATE_STORE_API({
    cacheStoreCoverUrl,
    extractStoreCoverUrlFromAppdetails,
    FAMILY_SHARING_CATEGORY_ID,
    fetchStoreItemBatch,
    getStoreCacheContext: () => STORE_CACHE_CONTEXT,
    getStoreCountry: () => STORE_CC,
    getStoreLang: () => STORE_LANG,
    hasPriceOverview,
    isRateLimitError,
    normalizeOriginalPrice,
    normalizeStoreItemOriginalPrice,
    requestStoreJson,
    setRawData,
    setRawError,
    t
  });

  const {
    clearCachedStoreCoverUrl,
    fetchCoverUrlBatch,
    generateFamilyPoster,
    generateListPoster,
    getVisibleCoverAppids,
    refetchVisibleCoverUrls,
    shouldProcessVisibleCovers
  } = posterHelpers = globalThis.SFFA_CREATE_POSTER_HELPERS({
    COVER_RELOAD_BATCH_SIZE,
    FAMILY_POSTER_CARD_ASPECT_RATIO,
    FAMILY_POSTER_CARD_WIDTH,
    FAMILY_POSTER_GAP,
    FAMILY_POSTER_HEADER_HEIGHT,
    FAMILY_POSTER_IMAGE_CONCURRENCY,
    FAMILY_POSTER_MAX_HEIGHT,
    FAMILY_POSTER_PADDING,
    FAMILY_POSTER_WIDTH,
    cacheStoreCoverUrl,
    closeCopyListMenu,
    closeMenu,
    createFamilyPosterDialogContext,
    createListPosterCanvasContext,
    document,
    extractStoreCoverUrlFromStoreItem,
    extractStorePosterCoverUrlFromStoreItem,
    fetchStoreItemBatch,
    formatDateTime,
    formatOwners,
    formatTargetOwners,
    getCachedLocalizedName,
    getCachedStoreCoverUrl,
    getCoverProbeState,
    getCurrentListRows,
    getCurrentTab: () => currentTab,
    getElements: () => elements,
    getFamilyPosterSettings,
    getGameDisplayName,
    getGameListLabel,
    getListPosterSettings,
    getListViewMode,
    getNumberLocale,
    getState: () => state,
    getTabLabel,
    getUiLocale: () => UI_LOCALE,
    isCompareDialogOpen,
    isFreshStoreItemCacheEntry,
    isRateLimitError,
    normalizeFamilyPosterColumns,
    normalizeFamilyPosterScalePercent,
    normalizeFamilyPosterSettings,
    normalizeListPosterSettings,
    normalizeMainTab,
    normalizeStoreItemOriginalPrice,
    renderCompareDialogIfOpen,
    renderDetailsPreserveScroll,
    renderStoreCacheButton,
    saveState,
    setBusy,
    setRateLimited,
    setRawError,
    setStatus,
    SHAREABILITY_BATCH_SIZE,
    t,
    window
  });

  const {
    closeFamilyPosterDialog,
    confirmSaveFamilyPoster,
    openFamilyPosterDialog,
    openListPosterDialog,
    renderFamilyPosterDialog,
    updateFamilyPosterScaleValue
  } = globalThis.SFFA_CREATE_POSTER_DIALOG({
    closeCopyListMenu,
    closeMenu,
    closeSortMenu: closeFamilyPosterSortMenu,
    createFamilyPosterDialogContext,
    createListPosterDialogContext,
    escapeAttr,
    escapeHtml,
    getCurrentTab: () => currentTab,
    getCurrentListRows,
    getElements: () => elements,
    getLastReport: () => lastReport,
    getFamilyPosterSortModeLabel,
    normalizeFamilyPosterScalePercent,
    normalizePosterSettingsForContext,
    normalizePosterSortMode,
    saveState,
    setStatus,
    t
  });

  steamApi = globalThis.SFFA_CREATE_STEAM_API({
    config: globalThis.SFFA_CONFIG,
    decodeHtml,
    document,
    getApplicationLocation: () => location,
    getLastRawData: () => lastRawData,
    getPageState: () => sffaExtensionPageState,
    getState: () => state,
    getStoreLang: () => STORE_LANG,
    isMultiTargetReport,
    readJsonAttribute,
    requestJson,
    requestText,
    setRawData,
    t,
    window
  });
  const {
    fetchCurrentOwnedAppids,
    fetchExistingSteamApiKey,
    getApplicationConfigNode,
    getFamilyGameList,
    getFamilyInfo,
    getSteamCommunityProfileSteamId,
    getSteamSession,
    getTargetProfile,
    getTargetSteamIds,
    isSteamCommunityProfilePage
  } = steamApi;

  const {
    maybeAutoRefreshFamilyLibrary,
    refreshFamilyLibrary
  } = globalThis.SFFA_CREATE_FAMILY_LIBRARY_FLOW({
    AUTO_FAMILY_REFRESH_INTERVAL_MS,
    getFamilyGameList,
    getFamilyInfo,
    getState: () => state,
    getSteamSession,
    openDialog,
    renderAutoFamilyRefreshButton,
    renderFamilyMeta,
    resetRawData,
    saveState,
    setBusy,
    setRawError,
    setStatus,
    t,
    window
  });

  const {
    clearStoreCache,
    reloadCovers,
    toggleAutoFamilyRefresh
  } = globalThis.SFFA_CREATE_CACHE_ACTIONS({
    closeCopyListMenu,
    closeMenu,
    getState: () => state,
    getSteamSession,
    isRateLimitError,
    maybeAutoRefreshFamilyLibrary,
    refetchVisibleCoverUrls,
    renderAutoFamilyRefreshButton,
    renderCompareDialogIfOpen,
    renderDetailsPreserveScroll,
    renderStoreCacheButton,
    saveState,
    setBusy,
    setCoverReloadToken: value => { coverReloadToken = value; },
    setRateLimited,
    setRawError,
    setStatus,
    t
  });

  const {
    startBackgroundShareabilityFilter
  } = globalThis.SFFA_CREATE_SHAREABILITY_FLOW({
    SHAREABILITY_BATCH_SIZE,
    applyOriginalPriceToGame,
    fetchShareabilityBatch,
    formatPercent,
    getActiveAnalysisId: () => activeAnalysisId,
    getLastReport: () => lastReport,
    getShareabilityFilterState: () => shareabilityFilterState,
    getShareabilityProgressUiState: () => shareabilityProgressUiState,
    getState: () => state,
    hasCompleteStoreCache,
    isFreshOriginalPriceCacheEntry,
    isRateLimitError,
    isZeroValueOriginalPrice,
    mergeStoreCacheEntry,
    prepareOriginalPriceForGame,
    refreshReportMetrics,
    renderDetailsPreserveScroll,
    renderStoreCacheButton,
    renderSummary,
    saveState,
    scheduleVisiblePriceLoads,
    setRateLimited,
    setRawError,
    setRawStep,
    setStatus,
    sleep,
    sortByName,
    startLazyOriginalPriceLoading,
    t,
    window
  });

  rateLimitController = globalThis.SFFA_CREATE_RATE_LIMIT_CONTROLLER({
    STORE_REQUEST_DELAY_MS,
    createRateLimitState,
    createShareabilityFilterState,
    createShareabilityProgressUiState,
    fetchShareabilityBatch,
    getActiveAnalysisId: () => activeAnalysisId,
    getElements: () => elements,
    getLastReport: () => lastReport,
    getPendingShareabilityGames,
    getPriceLoadState,
    getRateLimitState: () => rateLimitState,
    getShareabilityFilterState: () => shareabilityFilterState,
    getShareabilityProgressUiState: () => shareabilityProgressUiState,
    getVisibleCoverAppids,
    hasVerifiedStoreCoverUrl,
    isHttp429,
    renderRateLimitControls,
    scheduleBackgroundPriceLoads,
    scheduleVisibleCoverLoads,
    scheduleVisiblePriceLoads,
    setRateLimitState: value => { rateLimitState = value; },
    setRawError,
    setShareabilityFilterState: value => { shareabilityFilterState = value; },
    setShareabilityProgressUiState: value => { shareabilityProgressUiState = value; },
    setStatus,
    sleep,
    startBackgroundShareabilityFilter,
    t,
    window
  });

  const {
    buildReport,
    buildTargetBreakdown,
    buildTargetBreakdownFromReport,
    buildSplitMetric
  } = globalThis.SFFA_CREATE_REPORT_MODEL({
    getState: () => state,
    sortByName
  });

  const {
    compareLibraries
  } = globalThis.SFFA_CREATE_LIBRARY_COMPARE({
    getCachedLocalizedName,
    getState: () => state,
    getTargetSteamIds,
    sortByName
  });

  const {
    clearAnalysisHistory,
    loadAnalysisInputHistory,
    rememberAnalysisInput,
    renderAnalysisHistoryMenu
  } = globalThis.SFFA_CREATE_HISTORY_STORE({
    closeAnalysisHistoryMenu,
    escapeAttr,
    escapeHtml,
    getElements: () => elements,
    getTargetProfileDisplayName,
    keys: {
      ANALYSIS_HISTORY_KEY,
      ANALYSIS_INPUT_HISTORY_KEY,
      MAX_ANALYSIS_HISTORY_ITEMS
    },
    sffaExtensionDeleteValue,
    sffaExtensionGetValue,
    sffaExtensionSetValue
  });

  const {
    analyzeTarget
  } = globalThis.SFFA_CREATE_ANALYSIS_FLOW({
    autoReadApiKeyFromCommunity,
    buildReport,
    compareLibraries,
    ensureFamilyReady,
    fetchCurrentOwnedAppids,
    formatPercent,
    getElements: () => elements,
    getState: () => state,
    getTargetProfile,
    getTargetSteamIds,
    initializeAnalysisRuntime,
    openDialog,
    rememberAnalysisInput,
    renderDetails,
    renderSummary,
    renderTabs,
    renderTargetProfile,
    resetRawData,
    setBusy,
    setCurrentTab: value => { currentTab = value; },
    setLastReport: value => { lastReport = value; },
    setRawError,
    setRawStep,
    setStatus,
    startBackgroundShareabilityFilter,
    t,
    window
  });

  analysisSessionStore = globalThis.SFFA_CREATE_ANALYSIS_SESSION_STORE({
    getCurrentTab: () => currentTab,
    getElements: () => elements,
    getLastReport: () => lastReport,
    getTableSortByTab: () => tableSortByTab,
    key: ANALYSIS_HISTORY_KEY,
    loadAnalysisInputHistory,
    normalizeMainTab,
    refreshReportMetrics,
    renderAnalysisHistoryMenu,
    renderCurrentStatusText,
    renderDetailsPreserveScroll,
    renderSummary,
    renderTabs,
    renderTargetProfile,
    restoreLastInput: saved => {
      if (elements.targetInput && saved.inputValue != null) {
        elements.targetInput.value = String(saved.inputValue || "");
      }
      if (elements.searchInput && saved.searchValue != null) {
        elements.searchInput.value = String(saved.searchValue || "");
      }
    },
    setCurrentTab: value => { currentTab = value; },
    setLastReport: value => { lastReport = value; },
    setTableSortByTab: value => { tableSortByTab = value; },
    sffaExtensionGetValue,
    sffaExtensionSetValue,
    window
  });

  const {
    bindPanelEvents
  } = globalThis.SFFA_CREATE_PANEL_EVENTS({
    analyzeTarget,
    checkRateLimit,
    clearAnalysisHistory,
    clearStoreCache,
    closeAnalysisHistoryMenu,
    closeCompareDialog,
    closeCopyListMenu,
    closeDialog,
    closeFamilyPosterDialog,
    closeFamilyPosterSortMenu,
    closeListMenu,
    closeMenu,
    confirmSaveFamilyPoster,
    continueAfterRateLimit,
    copyCurrentGamesOnly,
    copyCurrentList,
    copyReportSummary,
    getElements: () => elements,
    getListViewMode,
    handleAnalysisHistoryClick,
    handleCompareSummaryClick,
    handleProfileActionClick,
    handleTableHeaderClick,
    handleTargetSelectionChange,
    hideLauncherButton,
    isCompareDialogOpen,
    openAnalysisHistoryMenu,
    openDialog,
    openFamilyPosterDialog,
    openListPosterDialog,
    refreshFamilyLibrary,
    reloadCovers,
    renderDetailsPreserveScroll,
    renderSearchClearButton,
    saveAnalysisHistoryNow,
    scheduleAnalysisHistorySave,
    scheduleSearchRender,
    scheduleVisibleCoverLoads,
    scheduleVisiblePriceLoads,
    setAppLocaleMode,
    setListViewMode,
    setReportTab,
    showRawDataWindow,
    toggleAutoFamilyRefresh,
    toggleCopyListMenu,
    toggleFamilyPosterSortMenu,
    toggleListMenu,
    toggleLocaleMenu,
    toggleMenu,
    updateFamilyPosterScaleValue,
    window
  });

  bootstrap();
  document.addEventListener("sffa-extension-open", () => {
    if (elements?.root) {
      openDialog();
    }
  });

  async function bootstrap() {
    await resolveStoreCountryFromAccount({
      initialStoreCountry: INITIAL_STORE_CC,
      requestText,
      setStoreCountry,
      sleep,
      storeLanguage: STORE_LANG
    });
    initializeRuntime();
    const shouldOpenFromToolbar = consumeToolbarOpenHash();
    const restoredAnalysis = restoreAnalysisHistory();
    autoFillTargetInputFromProfilePage();
    const session = getSteamSession();
    if (!syncBootstrapSession(session, restoredAnalysis)) {
      if (shouldOpenFromToolbar) {
        openDialog();
      }
      return;
    }
    finalizeBootstrap(session, shouldOpenFromToolbar);
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

  function finalizeBootstrap(session, shouldOpenFromToolbar) {
    renderLauncherVisibility();
    renderFamilyMeta();
    if (shouldOpenFromToolbar) {
      openDialog();
    }
    window.setTimeout(() => maybeAutoRefreshFamilyLibrary(session), 0);
  }

  function consumeToolbarOpenHash() {
    if (location.hash !== "#sffa-open-helper") {
      return false;
    }
    try {
      const url = new URL(location.href);
      url.hash = "";
      window.history.replaceState(window.history.state, document.title, url.href);
    } catch (error) {
      // The panel can still open even if the browser refuses URL cleanup.
    }
    return true;
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = globalThis.SFFA_STYLES;
    document.head.appendChild(style);
  }

  // ===== 界面挂载与交互 =====

  function mountPanel() {
    const root = createPanelRoot();
    document.body.appendChild(root);
    elements = collectPanelElements(root);
    bindPanelEvents();
    initializePanelView();
  }

  function initializePanelView() {
    renderSummary(null);
    renderTargetProfile(null);
    renderAutoFamilyRefreshButton();
    renderStoreCacheButton();
    renderRateLimitControls();
    renderAnalysisHistoryMenu();
  }

  function openDialog() {
    const wasOpen = elements.root.classList.contains("is-open");
    elements.root.classList.add("is-open");
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
    setStatus(t("launcherHidden"), "ok");
  }

  function toggleLauncherButtonVisibility() {
    state.launcherVisible = state.launcherVisible === false;
    saveState();
    renderLauncherVisibility();
    setStatus(state.launcherVisible ? t("launcherVisible") : t("launcherHidden"), "ok");
  }

  function closeDialog() {
    closeMenu();
    closeListMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    closeFamilyPosterDialog();
    closeCompareDialog();
    elements.root.classList.remove("is-open");
  }

  function handleAnalysisHistoryClick(event) {
    const option = event.target?.closest?.("[data-sffa-history-option]");
    if (!option) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const inputValue = option.dataset.sffaHistoryOption || "";
    if (!inputValue) {
      return;
    }

    elements.targetInput.value = inputValue;
    closeAnalysisHistoryMenu();
    analyzeTarget();
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
    const compareHint = lastReport && isMultiTargetReport(lastReport) ? t("compareHint", { count: lastReport.target.targets.length }) : "";
    [
      [elements.root.querySelector(".sffa-launcher span"), "textContent", t("launcher")], [elements.launcher, "title", t("openAnalyzer")], [elements.launcherCloseBtn, "title", t("hideLauncher")], [elements.root.querySelector(".sffa-title strong"), "textContent", t("launcher")], [elements.localeToggleBtn, "textContent", getLocaleModeButtonText()], [elements.moreBtn, "title", t("more")], [elements.closeBtn, "title", t("close")], [elements.targetInput, "placeholder", t("targetPlaceholder")], [elements.refreshBtn, "textContent", t("refreshFamily")], [elements.analyzeBtn, "textContent", t("analyzeAccount")], [elements.searchInput, "placeholder", t("searchPlaceholder")], [elements.searchClearBtn, "title", t("clear")], [elements.copyBtn, "textContent", t("copyReport")], [elements.saveFamilyPosterBtn, "textContent", t("saveFamilyPoster")], [elements.saveListPosterBtn, "textContent", t("saveListPoster")], [elements.reloadCoversBtn, "textContent", t("reloadCovers")], [elements.rawBtn, "textContent", t("rawData")], [elements.rateContinueBtn, "textContent", t("continue")], [elements.rateCheckBtn, "textContent", t("rateCheck")], [elements.compareTitle, "textContent", t("compareTitle")], [elements.compareHint, "textContent", compareHint], [elements.compareCloseBtn, "title", t("close")], [elements.familyPosterTitle, "textContent", t("familyPosterTitle")], [elements.familyPosterHint, "textContent", t("familyPosterHint")], [elements.familyPosterColumnsLabel, "textContent", t("familyPosterColumns")], [elements.familyPosterSortLabel, "textContent", t("familyPosterSort")], [elements.familyPosterScaleLabel, "textContent", t("familyPosterScale")], [elements.familyPosterCancelBtn, "textContent", t("familyPosterCancel")], [elements.familyPosterConfirmBtn, "textContent", t("familyPosterConfirm")], [elements.familyPosterCloseBtn, "title", t("close")]
    ].forEach(([element, key, value]) => { element[key] = value; });
    [
      [elements.launcherCloseBtn, "aria-label", t("hideLauncher")], [elements.listSelect, "aria-label", t("list")], [elements.moreBtn, "aria-label", t("more")], [elements.searchClearBtn, "aria-label", t("clear")], [elements.compareCloseBtn, "aria-label", t("close")], [elements.viewSwitch, "aria-label", t("viewMode")], [elements.familyPosterCloseBtn, "aria-label", t("close")]
    ].forEach(([element, key, value]) => element.setAttribute(key, value));
    elements.listOptions.forEach(option => { option.textContent = getMainTabLabel(option.dataset.sffaListOption); });
    elements.viewModeButtons.forEach(button => { button.textContent = t(button.dataset.sffaViewMode === "cover" ? "viewCover" : "viewTable"); });
    elements.root.querySelector("[data-tab='family']").textContent = t("tabs.family");
    elements.localeOptions.forEach(option => { option.textContent = getLocaleModeLabel(option.dataset.sffaLocaleOption); option.classList.toggle("is-active", normalizeAppLocaleMode(option.dataset.sffaLocaleOption) === appLocaleMode); });
    renderFamilyPosterDialog();
    renderCompareDialogIfOpen();
    [renderFamilyMeta, renderAutoFamilyRefreshButton, renderStoreCacheButton, renderRateLimitControls].forEach(fn => fn());
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

  // ===== 家庭库刷新与分析流程 =====

  function initializeAnalysisRuntime(targetProfile) {
    const analysisId = ++activeAnalysisId;
    resetPriceLoadState();
    shareabilityFilterState = createShareabilityFilterState(analysisId, 0, targetProfile.games.length, targetProfile.games.length);
    if (shareabilityProgressUiState?.timer) {
      window.clearTimeout(shareabilityProgressUiState.timer);
    }
    shareabilityProgressUiState = createShareabilityProgressUiState(analysisId);
    return analysisId;
  }

  function renderDetailsPreserveScroll() {
    const scrollTop = elements.tableWrap.scrollTop;
    renderDetails();
    elements.tableWrap.scrollTop = scrollTop;
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
    if (currentTab === "all" || currentTab === "new" || currentTab === "relativeNew") {
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

  // ===== 摘要、明细与对比渲染 =====

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
    return compareDialog.isCompareDialogOpen();
  }

  function openCompareDialog() {
    compareDialog.openCompareDialog();
  }

  function closeCompareDialog() {
    compareDialog.closeCompareDialog();
  }

  function renderCompareDialogIfOpen() {
    compareDialog.renderCompareDialogIfOpen();
  }

  function handleCompareSummaryClick(event) {
    compareDialog.handleCompareSummaryClick(event);
  }

  function getComparePriceChipClass(game) {
    return compareDialog.getComparePriceChipClass(game);
  }

  function getCompareStatusClass(status) {
    return compareDialog.getCompareStatusClass(status);
  }

  // ===== 状态、限流与持久化 =====

  function setStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `sffa-status ${type || ""}`.trim();
  }

  function setRateLimited(error, source) {
    rateLimitController.setRateLimited(error, source);
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
    rateLimitController.continueAfterRateLimit();
  }

  async function checkRateLimit() {
    return rateLimitController.checkRateLimit();
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

  function setBusy(isBusy) {
    if (isBusy) {
      closeMenu();
    }
    [elements.refreshBtn, elements.analyzeBtn, elements.moreBtn, elements.localeToggleBtn, elements.autoFamilyRefreshBtn, elements.copyBtn, elements.saveFamilyPosterBtn, elements.saveListPosterBtn, elements.reloadCoversBtn, elements.copyListBtn, elements.clearStoreCacheBtn, elements.rawBtn].forEach(button => {
      if (!button) {
        return;
      }
      button.disabled = Boolean(isBusy);
    });
  }

  function loadState() {
    try {
      const saved = sffaExtensionGetValue(STORAGE_KEY);
      if (!saved || saved.version !== DEFAULT_STATE.version) {
        return cloneDefaultState();
      }
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
        appLocaleMode,
        lastAutoFamilyRefreshAttemptAt: Number(saved.lastAutoFamilyRefreshAttemptAt || 0)
      };
    } catch (error) {
      return cloneDefaultState();
    }
  }

  function saveState() {
    sffaExtensionSetValue(STORAGE_KEY, state);
  }

  function getTargetProfileDisplayName(profile) {
    return steamApi.getTargetProfileDisplayName(profile);
  }

  function getSelectedTargetSteamIds(report = lastReport) {
    return steamApi.getSelectedTargetSteamIds(report);
  }

  function isGameIncludedBySelectedTargets(game, report = lastReport) {
    return steamApi.isGameIncludedBySelectedTargets(game, report);
  }

  function restoreAnalysisHistory() {
    return analysisSessionStore.restoreAnalysisHistory();
  }

  function scheduleAnalysisHistorySave(force = false) {
    analysisSessionStore.scheduleAnalysisHistorySave(force);
  }

  function saveAnalysisHistoryNow() {
    analysisSessionStore.saveAnalysisHistoryNow();
  }

  // ===== 网络请求与底层工具 =====


})();
}()).catch(error => {
  console.error("Steam Family Group Helper app failed to initialize", error);
});
