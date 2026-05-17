"use strict";

globalThis.SFFA_CREATE_SHAREABILITY_FLOW = function createShareabilityFlow(dependencies) {
  const {
    SHAREABILITY_BATCH_SIZE,
    applyOriginalPriceToGame,
    fetchShareabilityBatch,
    formatPercent,
    getActiveAnalysisId,
    getLastReport,
    getShareabilityFilterState,
    getShareabilityProgressUiState,
    getState,
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
  } = dependencies;

  function scheduleShareabilityProgressRender() {
    const lastReport = getLastReport();
    const shareabilityFilterState = getShareabilityFilterState();
    const shareabilityProgressUiState = getShareabilityProgressUiState();
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
    const lastReport = getLastReport();
    const shareabilityFilterState = getShareabilityFilterState();
    const shareabilityProgressUiState = getShareabilityProgressUiState();
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
    setStatus(t("backgroundProgress", { percent: formatPercent(shareabilityFilterState.total ? shareabilityFilterState.processed / shareabilityFilterState.total : 0) }), "warn");
  }

  async function startBackgroundShareabilityFilter(analysisId, games) {
    let lastReport = getLastReport();
    if (!lastReport || analysisId !== getActiveAnalysisId()) {
      return;
    }
    const shareabilityFilterState = getShareabilityFilterState();
    if (!games.length) {
      shareabilityFilterState.running = false;
      setRawStep("done");
      setStatus(t("done"), "ok");
      return;
    }

    try {
      for (let index = 0; index < games.length; index += SHAREABILITY_BATCH_SIZE) {
        if (analysisId !== getActiveAnalysisId() || !getLastReport()) {
          return;
        }

        const batchGames = games.slice(index, index + SHAREABILITY_BATCH_SIZE);
        const shareabilityById = await getShareabilityForAppids(batchGames.map(game => game.appid));
        if (analysisId !== getActiveAnalysisId() || !getLastReport()) {
          return;
        }

        let addedNewGame = false;
        for (const game of batchGames) {
          addedNewGame = applyStoreItemResult(game, shareabilityById[String(game.appid)]) || addedNewGame;
        }
        flushShareabilityBatchRender(addedNewGame);
        await sleep(0);
      }

      lastReport = getLastReport();
      shareabilityFilterState.running = false;
      lastReport.filtering.running = false;
      setRawStep("done");
      getShareabilityProgressUiState().dirty = true;
      flushShareabilityProgressRender();
      renderDetailsPreserveScroll();
      startLazyOriginalPriceLoading();
      setStatus(t("completedAdded", { count: lastReport.metrics.newCount }), "ok");
    } catch (error) {
      shareabilityFilterState.running = false;
      lastReport = getLastReport();
      if (lastReport?.filtering) {
        lastReport.filtering.running = false;
      }
      const shareabilityProgressUiState = getShareabilityProgressUiState();
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

  async function getShareabilityForAppids(appids) {
    const state = getState();
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
    const lastReport = getLastReport();
    const shareabilityFilterState = getShareabilityFilterState();
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
    const lastReport = getLastReport();
    if (!lastReport) {
      return;
    }
    if (sortNewGames) {
      lastReport.games.new.sort(sortByName);
    }
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
    const lastReport = getLastReport();
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
    const state = getState();
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

  return {
    enrichShareability,
    startBackgroundShareabilityFilter
  };
};
