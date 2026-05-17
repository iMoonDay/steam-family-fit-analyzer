"use strict";

globalThis.SFFA_CREATE_PANEL_EVENTS = function createPanelEvents(dependencies) {
  const {
    analyzeTarget,
    checkRateLimit,
    clearAnalysisHistory,
    clearStoreCache,
    closeCompareDialog,
    closeDialog,
    closeFamilyPosterDialog,
    closeMenu,
    confirmSaveFamilyPoster,
    continueAfterRateLimit,
    copyCurrentGamesOnly,
    copyCurrentList,
    copyReportSummary,
    getElements,
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
    toggleAutoFamilyRefresh,
    toggleCopyListMenu,
    toggleFamilyPosterSortMenu,
    toggleListMenu,
    toggleLocaleMenu,
    toggleMenu,
    updateFamilyPosterScaleValue,
    window
  } = dependencies;

  function bindPanelEvents() {
    const elements = getElements();
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
    elements.saveFamilyPosterBtn.addEventListener("click", openFamilyPosterDialog);
    elements.reloadCoversBtn.addEventListener("click", reloadCovers);
    elements.copyListBtn.addEventListener("click", toggleCopyListMenu);
    elements.clearStoreCacheBtn.addEventListener("click", clearStoreCache);
    elements.rawBtn.addEventListener("click", showRawDataWindow);
    elements.rateContinueBtn?.addEventListener("click", continueAfterRateLimit);
    elements.rateCheckBtn?.addEventListener("click", checkRateLimit);
    elements.listSelect.addEventListener("click", toggleListMenu);
    elements.listOptions.forEach(option => {
      option.addEventListener("click", () => setReportTab(option.dataset.sffaListOption));
    });
    elements.searchInput.addEventListener("input", () => {
      renderSearchClearButton();
      scheduleSearchRender();
      scheduleAnalysisHistorySave();
    });
    elements.searchClearBtn.addEventListener("click", () => {
      elements.searchInput.value = "";
      renderSearchClearButton();
      renderDetailsPreserveScroll();
      scheduleAnalysisHistorySave();
    });
    elements.viewModeButtons.forEach(button => {
      button.addEventListener("click", () => setListViewMode(button.dataset.sffaViewMode));
    });
    elements.tabs.forEach(tab => {
      tab.addEventListener("click", () => setReportTab(tab.dataset.tab));
    });
    elements.tableWrap.addEventListener("click", handleTableHeaderClick);
    elements.tableWrap.addEventListener("scroll", () => {
      scheduleVisiblePriceLoads();
      scheduleVisibleCoverLoads();
    });
    elements.tableWrap.addEventListener("scroll", scheduleSearchRender);
    elements.profile.addEventListener("change", handleTargetSelectionChange);
    elements.profile.addEventListener("click", handleProfileActionClick);
    elements.compareBackdrop?.addEventListener("click", closeCompareDialog);
    elements.compareCloseBtn?.addEventListener("click", closeCompareDialog);
    elements.compareSummary?.addEventListener("click", handleCompareSummaryClick);
    elements.compareSummary?.addEventListener("scroll", () => scheduleVisibleCoverLoads());
    elements.saveListPosterBtn?.addEventListener("click", openListPosterDialog);
    elements.copyListMenu?.addEventListener("click", event => {
      const listButton = event.target.closest("[data-sffa-copy-list]");
      const gamesButton = event.target.closest("[data-sffa-copy-games]");
      const posterButton = event.target.closest("[data-sffa-save-list-poster]");
      const reloadButton = event.target.closest("[data-sffa-reload-covers]");
      if (listButton) {
        copyCurrentList();
      } else if (gamesButton) {
        copyCurrentGamesOnly();
      } else if (posterButton) {
        openListPosterDialog();
      } else if (reloadButton) {
        reloadCovers();
      }
    });
    elements.familyPosterBackdrop?.addEventListener("click", closeFamilyPosterDialog);
    elements.familyPosterCloseBtn?.addEventListener("click", closeFamilyPosterDialog);
    elements.familyPosterCancelBtn?.addEventListener("click", closeFamilyPosterDialog);
    elements.familyPosterConfirmBtn?.addEventListener("click", confirmSaveFamilyPoster);
    elements.familyPosterSortSelect?.addEventListener("click", toggleFamilyPosterSortMenu);
    elements.familyPosterScaleInput?.addEventListener("input", updateFamilyPosterScaleValue);
    elements.historyMenu?.addEventListener("click", handleAnalysisHistoryClick);
    elements.targetInput?.addEventListener("focus", openAnalysisHistoryMenu);
    elements.targetInput?.addEventListener("input", () => {
      if (elements.targetInput.value.trim()) {
        openAnalysisHistoryMenu();
      }
    });
    elements.targetInput?.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeMenu();
      }
    });
    elements.targetInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        analyzeTarget();
      }
    });
    window.addEventListener("beforeunload", () => {
      saveAnalysisHistoryNow();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        if (isCompareDialogOpen()) {
          closeCompareDialog();
          return;
        }
        closeFamilyPosterDialog();
        closeDialog();
      }
    });
    document.addEventListener("click", event => {
      const target = event.target;
      if (!target.closest("#sffa-root")) {
        closeMenu();
        return;
      }
      if (!target.closest("[data-sffa-menu-wrap]")) {
        closeMenu();
      }
      if (!target.closest("[data-sffa-list-wrap]")) {
        toggleListMenuCloseOnly();
      }
      if (!target.closest("[data-sffa-copy-list-wrap]")) {
        closeCopyListMenu();
      }
      if (!target.closest("[data-sffa-history-wrap]")) {
        closeAnalysisHistoryMenu();
      }
      if (!target.closest("[data-sffa-family-poster-sort-wrap]")) {
        closeFamilyPosterSortMenu();
      }
    });
  }

  function showRawDataWindow() {
    dependencies.showRawDataWindow();
  }

  function closeCopyListMenu() {
    dependencies.closeCopyListMenu();
  }

  function closeAnalysisHistoryMenu() {
    dependencies.closeAnalysisHistoryMenu();
  }

  function closeFamilyPosterSortMenu() {
    dependencies.closeFamilyPosterSortMenu();
  }

  function toggleListMenuCloseOnly() {
    dependencies.closeListMenu();
  }

  return {
    bindPanelEvents
  };
};
