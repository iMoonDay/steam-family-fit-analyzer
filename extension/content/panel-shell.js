"use strict";

globalThis.SFFA_CREATE_PANEL_SHELL = function createPanelShell(dependencies) {
  const {
    buildLocaleOptionHtml,
    document,
    escapeAttr,
    escapeHtml,
    getLocaleModeButtonText,
    t
  } = dependencies;

  function createPanelRoot() {
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
              <button class="sffa-menu-item" type="button" data-sffa-save-family-poster>${escapeHtml(t("saveFamilyPoster"))}</button>
              <button class="sffa-menu-item danger" type="button" data-sffa-clear-store-cache hidden>${escapeHtml(t("clearStoreCache"))}</button>
              <button class="sffa-menu-item" type="button" data-sffa-raw>${escapeHtml(t("rawData"))}</button>
            </div>
            <button class="sffa-close" type="button" data-sffa-close title="${escapeAttr(t("close"))}">×</button>
          </div>
        </header>
        <div class="sffa-body">
          <div class="sffa-row">
            <div class="sffa-list-wrap sffa-history-wrap" data-sffa-history-wrap>
              <input class="sffa-input" data-sffa-target placeholder="${escapeAttr(t("targetPlaceholder"))}" autocomplete="off" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeAttr(t("analysisHistory"))}">
              <div class="sffa-list-menu" role="listbox" data-sffa-history-menu></div>
            </div>
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
                <div class="sffa-view-switch" data-sffa-view-switch aria-label="${escapeAttr(t("viewMode"))}">
                  <button class="sffa-view-btn is-active" type="button" data-sffa-view-mode="table">${escapeHtml(t("viewTable"))}</button>
                  <button class="sffa-view-btn" type="button" data-sffa-view-mode="cover">${escapeHtml(t("viewCover"))}</button>
                </div>
                <button class="sffa-tab" type="button" data-tab="family">${escapeHtml(t("tabs.family"))}</button>
                <div class="sffa-copy-list-wrap" data-sffa-copy-list-wrap>
                  <button class="sffa-tab sffa-copy-list-btn" type="button" data-sffa-copy-list-btn aria-expanded="false">⋯</button>
                  <div class="sffa-menu sffa-copy-list-menu" data-sffa-copy-list-menu>
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
      <div class="sffa-family-poster-overlay" data-sffa-family-poster-overlay>
        <div class="sffa-family-poster-backdrop" data-sffa-family-poster-backdrop></div>
        <section class="sffa-family-poster-shell" role="dialog" aria-modal="true" aria-label="${escapeAttr(t("familyPosterTitle"))}">
          <header class="sffa-family-poster-header">
            <div class="sffa-family-poster-title">
              <strong data-sffa-family-poster-title>${escapeHtml(t("familyPosterTitle"))}</strong>
              <span data-sffa-family-poster-hint>${escapeHtml(t("familyPosterHint"))}</span>
            </div>
            <button class="sffa-family-poster-close" type="button" data-sffa-family-poster-close title="${escapeAttr(t("close"))}" aria-label="${escapeAttr(t("close"))}">×</button>
          </header>
          <div class="sffa-family-poster-body">
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
          </div>
          <footer class="sffa-family-poster-actions">
            <button class="sffa-btn secondary" type="button" data-sffa-family-poster-cancel>${escapeHtml(t("familyPosterCancel"))}</button>
            <button class="sffa-btn" type="button" data-sffa-family-poster-confirm>${escapeHtml(t("familyPosterConfirm"))}</button>
          </footer>
        </section>
      </div>
    `;
    return root;
  }

  function collectPanelElements(root) {
    return {
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
      historyWrap: root.querySelector("[data-sffa-history-wrap]"),
      historyMenu: root.querySelector("[data-sffa-history-menu]"),
      targetInput: root.querySelector("[data-sffa-target]"),
      listWrap: root.querySelector("[data-sffa-list-wrap]"),
      listSelect: root.querySelector("[data-sffa-list-select]"),
      listOptions: Array.from(root.querySelectorAll("[data-sffa-list-option]")),
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
      compareCloseBtn: root.querySelector("[data-sffa-compare-close]"),
      compareTitle: root.querySelector("[data-sffa-compare-title]"),
      compareHint: root.querySelector("[data-sffa-compare-hint]"),
      compareSummary: root.querySelector("[data-sffa-compare-summary]"),
      compareBody: root.querySelector("[data-sffa-compare-body]"),
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

  return {
    collectPanelElements,
    createPanelRoot
  };
};
