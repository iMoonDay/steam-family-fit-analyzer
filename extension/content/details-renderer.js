"use strict";

globalThis.SFFA_CREATE_DETAILS_RENDERER = function createDetailsRenderer(dependencies) {
  const {
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
    getElements,
    getLastReport,
    getNumberLocale,
    getSelectedTargetSteamIds,
    getState,
    getStoreCacheCount,
    getTabLabel,
    getTableSortByTab,
    isFreshOriginalPriceCacheEntry,
    isGameIncludedBySelectedTargets,
    isMultiTargetReport,
    prepareOriginalPriceForGame,
    REPORT_LIST_TABS,
    renderCompareDialogIfOpen,
    renderDetailsPreserveScroll,
    saveState,
    scheduleAnalysisHistorySave,
    scheduleVisibleCoverLoads,
    scheduleVisiblePriceLoads,
    setCurrentTab,
    sortByName,
    sortFamilyLibraryRows,
    t,
    window
  } = dependencies;
  const getCurrentTab = dependencies.getCurrentTab;
  const SEARCH_RENDER_DEBOUNCE_MS = dependencies.SEARCH_RENDER_DEBOUNCE_MS;
  let searchRenderTimer = 0;

function renderTabs() {
  const listViewMode = getListViewMode();
  const isReportTab = isReportListTab(getCurrentTab());
  const selectedReportTab = isReportTab ? getCurrentTab() : getElements().listSelect.dataset.selectedTab || "all";
  getElements().listSelect.dataset.selectedTab = selectedReportTab;
  getElements().listSelect.textContent = getMainTabDisplayLabel(selectedReportTab);
  getElements().listSelect.classList.toggle("is-active", isReportTab);
  getElements().listOptions.forEach(option => {
    const isActive = option.dataset.sffaListOption === selectedReportTab;
    option.textContent = getMainTabDisplayLabel(option.dataset.sffaListOption);
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });
  getElements().tabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === getCurrentTab());
  });
  getElements().viewModeButtons.forEach(button => {
    const active = button.dataset.sffaViewMode === listViewMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderSearchClearButton();
  if (getElements().reloadCoversBtn) {
    getElements().reloadCoversBtn.hidden = listViewMode !== "cover";
  }
}

function normalizeListViewMode(mode) {
  return mode === "cover" ? "cover" : "table";
}

function getListViewMode() {
  return normalizeListViewMode(getState().listViewMode);
}

function setListViewMode(mode) {
  const nextMode = normalizeListViewMode(mode);
  if (nextMode === getListViewMode()) {
    return;
  }
  getState().listViewMode = nextMode;
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
  if (getCurrentTab() === nextTab) {
    return;
  }
  cancelSearchRender();
  setCurrentTab(nextTab);
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
  if (!getLastReport()) {
    return 0;
  }
  if (tab === "relativeNew") {
    return getRelativeNewRowsForCurrentSelection(getLastReport()).length;
  }
  if (tab === "all" || tab === "new" || tab === "overlap") {
    return getReportRowsForCurrentSelection(tab).length;
  }
  return 0;
}

function renderSearchClearButton() {
  getElements().searchWrap.classList.toggle("has-value", Boolean(getElements().searchInput.value));
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
  if (getCurrentTab() === "family") {
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
  if (getCurrentTab() === "new") {
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
  if (getCurrentTab() === "relativeNew") {
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
  if (getCurrentTab() === "overlap") {
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
  if (!header || !getElements().tableWrap.contains(header)) {
    return;
  }

  const key = header.dataset.sortKey;
  const current = getTableSortByTab()[getCurrentTab()];
  getTableSortByTab()[getCurrentTab()] = {
    key,
    direction: current?.key === key && current.direction === "asc" ? "desc" : "asc"
  };
  renderDetailsPreserveScroll();
}

function renderDetails() {
  getElements().tableWrap.classList.toggle("is-cover-view", getListViewMode() === "cover");
  if (getCurrentTab() === "family") {
    const sourceRows = getFamilyLibraryRows();
    const rows = getSortedRows("family", filterRowsBySearchQuery(sourceRows));
    if (rows.length === 0) {
      getElements().tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(sourceRows.length ? t("noMatches") : t("noFamilyRefresh"))}</div>`;
      return;
    }
    getElements().tableWrap.innerHTML = buildDetailsView("family", rows);
    applyVisibleCoverImages();
    scheduleVisibleCoverLoads();
    scheduleVisiblePriceLoads();
    return;
  }

  if (!getLastReport()) {
    getElements().tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(t("initialEmpty"))}</div>`;
    return;
  }

  const sourceRows = getReportRowsForCurrentSelection(getCurrentTab());
  const rows = getSortedRows(getCurrentTab(), filterRowsBySearchQuery(sourceRows));
  if (getCurrentTab() === "relativeNew") {
    prepareOriginalPricesForMissingRows(rows);
  }
  if (rows.length === 0) {
    const emptyText = sourceRows.length ? t("noMatches") : t("tabEmpty", { tab: getTabLabel(getCurrentTab()) });
    getElements().tableWrap.innerHTML = `<div class="sffa-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }

  getElements().tableWrap.innerHTML = buildDetailsView(getCurrentTab(), rows);
  applyVisibleCoverImages();
  scheduleVisibleCoverLoads();
  scheduleVisiblePriceLoads();
}

function buildDetailsView(tab, rows) {
  return getListViewMode() === "cover" ? buildDetailsCoverGrid(tab, rows) : buildDetailsTable(tab, rows);
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

function renderDetailsCoverCard(tab, game) {
  const title = getGameDisplayName(game);
  const chip = getDetailsCoverChip(tab, game);
  const metaLines = getDetailsCoverMetaLines(tab, game).filter(Boolean);
  const priceAttr = needsCoverPriceTracking(tab) ? ` data-price-appid="${escapeAttr(game.appid)}"` : "";
  return `
    <a class="sffa-cover-card" href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener"${priceAttr} aria-label="${escapeAttr(title)}" title="${escapeAttr(title)}">
      <span class="sffa-cover-card-media" data-sffa-cover-appid="${escapeAttr(game.appid)}">
        ${chip ? `<span class="sffa-cover-card-chip ${escapeAttr(chip.className)}">${escapeHtml(chip.text)}</span>` : ""}
        <span class="sffa-cover-card-title">${escapeHtml(title)}</span>
      </span>
      <span class="sffa-cover-card-body">
        <span class="sffa-cover-card-appid">AppID ${escapeHtml(String(game.appid || "-"))}</span>
        ${metaLines.map(line => `<span class="sffa-cover-card-meta">${escapeHtml(line)}</span>`).join("")}
      </span>
    </a>
  `;
}

function needsCoverPriceTracking(tab) {
  return tab === "new" || tab === "relativeNew";
}

function getDetailsCoverChip(tab, game) {
  if (tab === "all") {
    const status = getLastReport()?.classificationById?.[String(game.appid)]?.status || "pending";
    return { text: getGameListLabel(game.appid), className: `is-${getCompareStatusClass(status)}` };
  }
  if (tab === "new" || tab === "relativeNew") {
    return { text: formatOriginalPriceText(game.price || {}), className: `is-${getComparePriceChipClass({ price: game.price, status: "new" })}` };
  }
  if (tab === "overlap") {
    return { text: t("duplicatedGames"), className: "is-overlap" };
  }
  return null;
}

function getDetailsCoverMetaLines(tab, game) {
  if (tab === "all") {
    return isMultiTargetReport() ? [`${t("targetOwners")} · ${formatTargetOwners(game.targetOwners || []) || "-"}`] : [];
  }
  if (tab === "new") {
    return isMultiTargetReport() ? [`${t("targetOwners")} · ${formatTargetOwners(game.targetOwners || []) || "-"}`] : [];
  }
  if (tab === "relativeNew") {
    return [`${t("owners")} · ${formatOwners(game.owners || []) || "-"}`];
  }
  if (tab === "family") {
    return [`${t("owners")} · ${formatOwners(game.owners || []) || "-"}`, `${t("acquiredAt")} · ${formatFamilyAcquireTime(game.time)}`];
  }
  if (tab === "overlap") {
    return [`${t("owners")} · ${formatOwners(game.owners || []) || "-"}`];
  }
  return [];
}

function getReportRowsForCurrentSelection(tab) {
  if (tab === "relativeNew") {
    return getRelativeNewRowsForCurrentSelection(getLastReport());
  }
  return (getLastReport().games[tab] || []).filter(game => isGameIncludedBySelectedTargets(game, getLastReport()));
}

function getRelativeNewRowsForCurrentSelection(report = getLastReport()) {
  if (!report) {
    return [];
  }
  return getFamilyRowsMissingFromAppids(getSelectedTargetOwnedAppids(report));
}

function getSelectedTargetOwnedAppids(report = getLastReport()) {
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
  return String(getElements().searchInput?.value || "").trim().toLowerCase();
}

function getSortedRows(tab, rows) {
  const sort = getTableSortByTab()[tab];
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

function getCurrentListRows(tab = getCurrentTab()) {
  const normalizedTab = normalizeMainTab(tab);
  if (normalizedTab === "family") {
    return getSortedRows("family", filterRowsBySearchQuery(getFamilyLibraryRows()));
  }
  if (!getLastReport()) {
    return [];
  }
  return getSortedRows(normalizedTab, filterRowsBySearchQuery(getReportRowsForCurrentSelection(normalizedTab)));
}

function getFamilyLibraryRows() {
  return (getState().familyLibrary?.appidSet || [])
    .map(appid => getState().familyLibrary?.appInfoById?.[String(appid)])
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
  return buildGameTable(rows, [col("AppID", "appid", appLinkCell, "width: 82px;"), col(t("game"), "name", nameCell), includeTargetOwners && col(t("targetOwners"), "targetOwners", targetOwnersCell, "width: 150px;"), col(t("status"), "status", statusCell, "width: 110px;")]);
}

function buildFamilyLibraryTable(rows) {
  return buildGameTable(rows, [col("AppID", "appid", appLinkCell, "width: 82px;"), col(t("game"), "name", nameCell), col(t("owners"), "owners", ownersCell, "width: 160px;"), col(t("acquiredAt"), "time", timeCell, "width: 130px;")]);
}

function buildRelativeNewTable(rows) {
  return buildGameTable(rows, [col("AppID", "appid", appLinkCell, "width: 82px;"), col(t("game"), "name", nameCell), col(t("owners"), "owners", ownersCell, "width: 160px;"), col(t("price"), "price", priceCell, "width: 110px;")], game => ` data-price-appid="${escapeAttr(game.appid)}"`);
}

function buildNewGamesTable(rows) {
  const includeTargetOwners = isMultiTargetReport();
  return buildGameTable(rows, [col("AppID", "appid", appLinkCell, "width: 82px;"), col(t("game"), "name", nameCell), includeTargetOwners && col(t("targetOwners"), "targetOwners", targetOwnersCell, "width: 150px;"), col(t("price"), "price", priceCell, "width: 110px;")], game => ` data-price-appid="${escapeAttr(game.appid)}"`);
}

function buildOverlapTable(rows) {
  return buildGameTable(rows, [col("AppID", "appid", appLinkCell, "width: 82px;"), col(t("game"), "name", nameCell, "width: calc((100% - 82px) / 2);"), col(t("owners"), "owners", ownersCell, "width: calc((100% - 82px) / 2);")]);
}

function col(label, key, cell, style = "") {
  return { label, key, cell, style };
}

function buildGameTable(rows, columns, rowAttrs = () => "") {
  const activeColumns = columns.filter(Boolean);
  return tableHtml(`<tr>${activeColumns.map(column => sortableTh(column.label, column.key, column.style)).join("")}</tr>`, rows.map(game => `<tr${rowAttrs(game)}>${activeColumns.map(column => column.cell(game)).join("")}</tr>`).join(""));
}

function buildCell(content, attrs = "") {
  return `<td${attrs}>${content}</td>`;
}

function appLinkCell(game) {
  return buildCell(`<a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a>`);
}

function nameCell(game) {
  return buildCell(escapeHtml(getGameDisplayName(game)));
}

function ownersCell(game) {
  return buildCell(escapeHtml(formatOwners(game.owners || []) || "-"));
}

function targetOwnersCell(game) {
  return buildCell(escapeHtml(formatTargetOwners(game.targetOwners || [])));
}

function priceCell(game) {
  return buildCell(formatOriginalPriceCell(game.price || {}));
}

function timeCell(game) {
  return buildCell(escapeHtml(formatFamilyAcquireTime(game.time)));
}

function statusCell(game) {
  return buildCell(getGameListStatusHtml(game.appid), ` data-status-appid="${escapeAttr(game.appid)}"`);
}

function getGameListLabel(appid) {
  const status = getLastReport()?.classificationById?.[String(appid)]?.status;
  return {
    new: t("addedGames"),
    overlap: t("duplicatedGames"),
    unsupported: t("unsupported"),
    noValue: t("noAddedValue"),
    pending: t("pending")
  }[status] || "-";
}

function getGameListStatusHtml(appid) {
  const status = getLastReport()?.classificationById?.[String(appid)]?.status;
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
  const entry = getState().storeCache?.[String(appid)];
  return entry?.localizedName || entry?.price?.localizedName || "";
}

function getCachedOriginalPrice(appid) {
  const price = getState().storeCache?.[String(appid)]?.price;
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
  const sort = getTableSortByTab()[getCurrentTab()];
  const indicator = sort?.key === key ? (sort.direction === "desc" ? "▼" : "▲") : "";
  return `<th data-sort-key="${escapeAttr(key)}"${style ? ` style="${escapeAttr(style)}"` : ""}>${escapeHtml(label)}<span class="sffa-sort-indicator">${indicator}</span></th>`;
}

function renderStoreCacheButton() {
  if (!getElements().clearStoreCacheBtn) {
    return;
  }
  const count = getStoreCacheCount();
  getElements().clearStoreCacheBtn.hidden = count === 0;
  getElements().clearStoreCacheBtn.textContent = `${t("clearStoreCache")} (${count})`;
}


  return {
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
  };
};
