"use strict";

globalThis.SFFA_CREATE_ANALYSIS_SESSION_STORE = function createAnalysisSessionStore(dependencies) {
  const {
    getCurrentTab,
    getElements,
    getLastReport,
    getTableSortByTab,
    key,
    loadAnalysisInputHistory,
    normalizeMainTab,
    refreshReportMetrics,
    renderAnalysisHistoryMenu,
    renderCurrentStatusText,
    renderDetailsPreserveScroll,
    renderSummary,
    renderTabs,
    renderTargetProfile,
    restoreLastInput,
    setCurrentTab,
    setLastReport,
    setTableSortByTab,
    sffaExtensionGetValue,
    sffaExtensionSetValue,
    window
  } = dependencies;
  let analysisHistorySaveTimer = 0;

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

  function loadAnalysisHistory() {
    try {
      const saved = sffaExtensionGetValue(key);
      if (!saved || saved.version !== 1 || !saved.report) {
        return null;
      }
      return saved;
    } catch (error) {
      return null;
    }
  }

  function restoreSavedReport(saved) {
    const report = saved.report;
    if (report?.filtering) {
      report.filtering.running = false;
      report.filtering.paused = Boolean(report.filtering.paused);
    }
    setLastReport(report);
    setCurrentTab(normalizeMainTab(saved.currentTab));
    setTableSortByTab(saved.tableSortByTab || {});
  }

  function restoreLastAnalysisInputFromHistory() {
    const saved = loadAnalysisInputHistory();
    if (saved.lastInputValue || saved.entries.length) {
      restoreSavedInputs({ inputValue: saved.lastInputValue || saved.entries[0]?.inputValue || "" });
    }
    renderAnalysisHistoryMenu(saved);
  }

  function restoreSavedInputs(saved) {
    restoreLastInput({
      inputValue: saved.inputValue,
      searchValue: saved.searchValue
    });
  }

  function renderRestoredAnalysis() {
    const report = getLastReport();
    refreshReportMetrics();
    renderTabs();
    renderSummary(report);
    renderTargetProfile(report);
    renderDetailsPreserveScroll();
    renderCurrentStatusText();
  }

  function scheduleAnalysisHistorySave(force = false) {
    const report = getLastReport();
    if (!report || report.filtering?.running) {
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
    const report = getLastReport();
    if (!report || report.filtering?.running) {
      return;
    }

    const elements = getElements();
    sffaExtensionSetValue(key, {
      version: 1,
      savedAt: Date.now(),
      inputValue: String(elements.targetInput?.value || "").trim(),
      searchValue: String(elements.searchInput?.value || ""),
      currentTab: getCurrentTab(),
      tableSortByTab: getTableSortByTab(),
      report
    });
  }

  return {
    restoreAnalysisHistory,
    saveAnalysisHistoryNow,
    scheduleAnalysisHistorySave
  };
};
