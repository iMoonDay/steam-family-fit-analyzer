"use strict";

globalThis.SFFA_CREATE_RATE_LIMIT_CONTROLLER = function createRateLimitController(dependencies) {
  const {
    STORE_REQUEST_DELAY_MS,
    createRateLimitState,
    createShareabilityFilterState,
    createShareabilityProgressUiState,
    fetchShareabilityBatch,
    getActiveAnalysisId,
    getElements,
    getLastReport,
    getPendingShareabilityGames,
    getPriceLoadState,
    getRateLimitState,
    getShareabilityFilterState,
    getShareabilityProgressUiState,
    getVisibleCoverAppids,
    hasVerifiedStoreCoverUrl,
    isHttp429,
    renderRateLimitControls,
    scheduleBackgroundPriceLoads,
    scheduleVisibleCoverLoads,
    scheduleVisiblePriceLoads,
    setRateLimitState,
    setRawError,
    setShareabilityFilterState,
    setShareabilityProgressUiState,
    setStatus,
    sleep,
    startBackgroundShareabilityFilter,
    t,
    window
  } = dependencies;

  function setRateLimited(error, source) {
    setRateLimitState({
      active: true,
      source: source || "",
      message: error?.message || t("requestTooFast"),
      checkedAt: 0,
      checkPassed: false
    });
    renderRateLimitControls();
    setStatus(t("requestTooFast"), "err");
  }

  function clearRateLimit() {
    setRateLimitState(createRateLimitState());
    renderRateLimitControls();
  }

  function continueAfterRateLimit() {
    if (!getRateLimitState().active) {
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
    const lastReport = getLastReport();
    if (pendingShareabilityGames.length === 0 || !lastReport) {
      return false;
    }

    const analysisId = getActiveAnalysisId();
    setShareabilityFilterState(createShareabilityFilterState(
      analysisId,
      lastReport.filtering?.processed || 0,
      pendingShareabilityGames.length,
      lastReport.filtering?.total || lastReport.metrics.targetCount || 0
    ));
    if (lastReport.filtering) {
      lastReport.filtering.running = true;
      lastReport.filtering.paused = false;
    }
    if (getShareabilityProgressUiState()?.timer) {
      window.clearTimeout(getShareabilityProgressUiState().timer);
    }
    setShareabilityProgressUiState(createShareabilityProgressUiState(analysisId));
    setStatus(t("continueStats"), "warn");
    startBackgroundShareabilityFilter(analysisId, pendingShareabilityGames);
    return true;
  }

  function resumePriceLoadingAfterRateLimit() {
    if (getPriceLoadState().pendingMap.size <= 0) {
      return false;
    }

    setStatus(t("continuePrices"), "warn");
    scheduleVisiblePriceLoads();
    if (!getShareabilityFilterState().running) {
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
    const rateLimitState = getRateLimitState();
    if (!rateLimitState.active) {
      return;
    }

    getElements().rateCheckBtn.disabled = true;
    setStatus(t("checking"), "warn");
    try {
      await sleep(STORE_REQUEST_DELAY_MS);
      await fetchShareabilityBatch(["10"]);
      getRateLimitState().checkedAt = Date.now();
      getRateLimitState().checkPassed = true;
      renderRateLimitControls();
      setStatus(t("rateLimitCleared"), "ok");
    } catch (error) {
      getRateLimitState().checkedAt = Date.now();
      getRateLimitState().checkPassed = false;
      renderRateLimitControls();
      if (isHttp429(error)) {
        setStatus(t("rateLimitedStill"), "err");
        return;
      }
      setRawError(error);
      setStatus(error.message || t("checkFailed"), "err");
    } finally {
      if (getElements().rateCheckBtn) {
        getElements().rateCheckBtn.disabled = false;
      }
    }
  }

  return {
    checkRateLimit,
    continueAfterRateLimit,
    setRateLimited
  };
};
