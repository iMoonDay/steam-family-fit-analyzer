"use strict";

globalThis.SFFA_CREATE_POSTER_SETTINGS = function createPosterSettings(dependencies) {
  const {
    FAMILY_POSTER_COLUMNS,
    FAMILY_POSTER_SORT_MODES,
    LIST_POSTER_BASE_SORT_MODES,
    getCurrentTab,
    getGenerateFamilyPoster,
    getGenerateListPoster,
    getState,
    getTabLabel,
    isMultiTargetReport,
    normalizeMainTab,
    t
  } = dependencies;

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

  function normalizeListPosterSettings(settings = {}, tab = getCurrentTab()) {
    return {
      columns: normalizeFamilyPosterColumns(settings.columns),
      sortMode: normalizePosterSortMode(settings.sortMode, getListPosterSortModesForTab(tab), "current"),
      scalePercent: normalizeFamilyPosterScalePercent(settings.scalePercent)
    };
  }

  function getFamilyPosterSettings() {
    return normalizeFamilyPosterSettings(getState().familyPosterSettings || {});
  }

  function getListPosterSettings(tab = getCurrentTab()) {
    return normalizeListPosterSettings({
      ...(getState().listPosterSettings || {}),
      sortMode: "current"
    }, tab);
  }

  function createFamilyPosterDialogContext() {
    return {
      kind: "family",
      title: t("familyPosterTitle"),
      hint: t("familyPosterHint"),
      headerTitle: getState().familyInfo?.family_name || t("notRefreshed"),
      sortModes: FAMILY_POSTER_SORT_MODES,
      defaultSortMode: "data",
      settings: getFamilyPosterSettings(),
      saveSettings(settings) {
        getState().familyPosterSettings = settings;
      },
      generate(settings) {
        return getGenerateFamilyPoster()(settings);
      }
    };
  }

  function createListPosterDialogContext(tab = getCurrentTab()) {
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
        getState().listPosterSettings = {
          columns: settings.columns,
          scalePercent: settings.scalePercent
        };
      },
      generate(settings) {
        return getGenerateListPoster()(normalizedTab, settings);
      }
    };
  }

  function createListPosterCanvasContext(tab = getCurrentTab()) {
    return {
      kind: "list",
      headerTitle: getTabLabel(normalizeMainTab(tab))
    };
  }

  function getListPosterSortModesForTab(tab = getCurrentTab()) {
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

  function normalizePosterSettingsForContext(settings = {}, context = createFamilyPosterDialogContext()) {
    return {
      columns: normalizeFamilyPosterColumns(settings.columns),
      sortMode: normalizePosterSortMode(settings.sortMode, context.sortModes, context.defaultSortMode),
      scalePercent: normalizeFamilyPosterScalePercent(settings.scalePercent)
    };
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

  return {
    createFamilyPosterDialogContext,
    createListPosterCanvasContext,
    createListPosterDialogContext,
    getFamilyPosterSettings,
    getFamilyPosterSortModeLabel,
    getListPosterSettings,
    getListPosterSortModesForTab,
    normalizeFamilyPosterColumns,
    normalizeFamilyPosterScalePercent,
    normalizeFamilyPosterSettings,
    normalizeListPosterSettings,
    normalizePosterSettingsForContext,
    normalizePosterSortMode
  };
};
