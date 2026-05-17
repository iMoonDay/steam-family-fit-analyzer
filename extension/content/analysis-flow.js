"use strict";

globalThis.SFFA_CREATE_ANALYSIS_FLOW = function createAnalysisFlow(dependencies) {
  const {
    buildReport,
    compareLibraries,
    fetchCurrentOwnedAppids,
    formatPercent,
    getElements,
    getState,
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
    setLastReport,
    setRawError,
    setRawStep,
    setStatus,
    setCurrentTab,
    ensureFamilyReady,
    autoReadApiKeyFromCommunity,
    startBackgroundShareabilityFilter,
    t,
    window
  } = dependencies;

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
      const report = createPendingAnalysisReport(targetProfile, comparison);
      setLastReport(report);
      renderInitialAnalysisResult(report);
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
    const rawInput = getElements().targetInput.value.trim();
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
    const currentOwnedAppids = await fetchCurrentOwnedAppids(session.steamid, getState().apiKey);
    setStatus(t("compareLibraries"), "warn");
    setRawStep("compare-libraries");
    return compareLibraries(targetProfile, currentOwnedAppids);
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
    setCurrentTab("all");
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

  return {
    analyzeTarget
  };
};
