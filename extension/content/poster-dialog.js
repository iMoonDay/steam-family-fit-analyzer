"use strict";

globalThis.SFFA_CREATE_POSTER_DIALOG = function createPosterDialog(dependencies) {
  const {
    closeCopyListMenu,
    closeMenu,
    closeSortMenu,
    createFamilyPosterDialogContext,
    createListPosterDialogContext,
    escapeAttr,
    escapeHtml,
    getCurrentTab,
    getCurrentListRows,
    getElements,
    getLastReport,
    getFamilyPosterSortModeLabel,
    normalizeFamilyPosterScalePercent,
    normalizePosterSettingsForContext,
    normalizePosterSortMode,
    saveState,
    setStatus,
    t
  } = dependencies;
  let activePosterDialogContext = null;

  function openFamilyPosterDialog() {
    closeMenu();
    openPosterDialog(createFamilyPosterDialogContext());
  }

  function openListPosterDialog() {
    closeCopyListMenu();
    const currentTab = getCurrentTab();
    if (!getLastReport() && currentTab !== "family") {
      setStatus(t("noList"), "warn");
      return;
    }
    if (!getCurrentListRows(currentTab).length) {
      setStatus(t("currentListEmpty"), "warn");
      return;
    }
    if (currentTab === "all" || currentTab === "family" || currentTab === "new" || currentTab === "relativeNew" || currentTab === "overlap") {
      openPosterDialog(createListPosterDialogContext(currentTab));
    }
  }

  function openPosterDialog(context) {
    activePosterDialogContext = context;
    syncFamilyPosterDialogInputsFromContext(context);
    renderFamilyPosterDialog();
    getElements().root?.classList.add("is-family-poster-open");
  }

  function closeFamilyPosterDialog() {
    closeSortMenu();
    getElements().root?.classList.remove("is-family-poster-open");
    activePosterDialogContext = null;
  }

  function confirmSaveFamilyPoster() {
    const context = getActivePosterDialogContext();
    const settings = readFamilyPosterSettingsFromDialog(context);
    context.saveSettings(settings);
    saveState();
    closeFamilyPosterDialog();
    context.generate(settings);
  }

  function syncFamilyPosterDialogInputsFromContext(context = getActivePosterDialogContext()) {
    const elements = getElements();
    const settings = context.settings;
    if (elements.familyPosterSortSelect) {
      elements.familyPosterSortSelect.dataset.selectedSortMode = normalizePosterSortMode(settings.sortMode, context.sortModes, context.defaultSortMode);
    }
    if (elements.familyPosterColumnsInput) {
      elements.familyPosterColumnsInput.value = String(settings.columns);
    }
    if (elements.familyPosterScaleInput) {
      elements.familyPosterScaleInput.value = String(settings.scalePercent);
    }
    updateFamilyPosterScaleValue();
  }

  function readFamilyPosterSettingsFromDialog(context = getActivePosterDialogContext()) {
    const elements = getElements();
    return normalizePosterSettingsForContext({
      columns: elements.familyPosterColumnsInput?.value,
      sortMode: elements.familyPosterSortSelect?.dataset.selectedSortMode,
      scalePercent: elements.familyPosterScaleInput?.value
    }, context);
  }

  function renderFamilyPosterDialog() {
    const elements = getElements();
    const context = getActivePosterDialogContext();
    if (elements.familyPosterTitle) {
      elements.familyPosterTitle.textContent = context.title;
    }
    if (elements.familyPosterHint) {
      elements.familyPosterHint.textContent = context.hint;
    }
    if (elements.familyPosterSortSelect && elements.familyPosterSortMenu) {
      const currentValue = normalizePosterSortMode(elements.familyPosterSortSelect.dataset.selectedSortMode || context.settings.sortMode, context.sortModes, context.defaultSortMode);
      elements.familyPosterSortSelect.dataset.selectedSortMode = currentValue;
      elements.familyPosterSortSelect.textContent = getFamilyPosterSortModeLabel(currentValue);
      elements.familyPosterSortMenu.innerHTML = context.sortModes.map(mode => {
        const active = mode === currentValue;
        return `<button class="sffa-list-option${active ? " is-active" : ""}" type="button" role="option" data-sffa-family-poster-sort-option="${escapeAttr(mode)}" aria-selected="${active ? "true" : "false"}">${escapeHtml(getFamilyPosterSortModeLabel(mode))}</button>`;
      }).join("");
      Array.from(elements.familyPosterSortMenu.querySelectorAll("[data-sffa-family-poster-sort-option]")).forEach(option => {
        option.addEventListener("click", () => setFamilyPosterSortMode(option.dataset.sffaFamilyPosterSortOption));
      });
    }
    updateFamilyPosterScaleValue();
  }

  function setFamilyPosterSortMode(mode) {
    const elements = getElements();
    const context = getActivePosterDialogContext();
    const nextMode = normalizePosterSortMode(mode, context.sortModes, context.defaultSortMode);
    if (elements.familyPosterSortSelect) {
      elements.familyPosterSortSelect.dataset.selectedSortMode = nextMode;
    }
    renderFamilyPosterDialog();
    closeSortMenu();
  }

  function updateFamilyPosterScaleValue() {
    const elements = getElements();
    if (!elements.familyPosterScaleValue || !elements.familyPosterScaleInput) {
      return;
    }
    elements.familyPosterScaleValue.textContent = t("familyPosterScaleValue", { value: normalizeFamilyPosterScalePercent(elements.familyPosterScaleInput.value) });
  }

  function getActivePosterDialogContext() {
    return activePosterDialogContext || createFamilyPosterDialogContext();
  }

  return {
    closeFamilyPosterDialog,
    confirmSaveFamilyPoster,
    getActivePosterDialogContext,
    openFamilyPosterDialog,
    openListPosterDialog,
    renderFamilyPosterDialog,
    updateFamilyPosterScaleValue
  };
};
