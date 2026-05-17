"use strict";

globalThis.SFFA_CREATE_COPY_ACTIONS = function createCopyActions(dependencies) {
  const {
    buildCurrentListCopyTable,
    closeCopyListMenu,
    closeMenu,
    formatMoney,
    formatPercent,
    getCurrentListRows,
    getCurrentTab,
    getGameDisplayName,
    getLastReport,
    labelValue,
    navigator,
    normalizeCopyCell,
    setStatus,
    t
  } = dependencies;

  async function copyReportSummary() {
    closeMenu();
    const lastReport = getLastReport();
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
    closeCopyListMenu();
    const lastReport = getLastReport();
    const currentTab = getCurrentTab();
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
    const lastReport = getLastReport();
    const currentTab = getCurrentTab();
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

  return {
    copyCurrentGamesOnly,
    copyCurrentList,
    copyReportSummary
  };
};
