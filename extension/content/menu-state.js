"use strict";

globalThis.SFFA_CREATE_MENU_STATE = function createMenuState(dependencies) {
  const {
    getElements
  } = dependencies;

  function toggleMenu(event) {
    event.stopPropagation();
    closeLocaleMenu();
    closeListMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    const elements = getElements();
    const isOpen = elements.menuWrap.classList.toggle("is-menu-open");
    elements.moreBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function toggleLocaleMenu(event) {
    event.stopPropagation();
    const elements = getElements();
    elements.menuWrap?.classList.remove("is-menu-open");
    elements.moreBtn?.setAttribute("aria-expanded", "false");
    closeListMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    const isOpen = elements.localeWrap.classList.toggle("is-open");
    elements.localeToggleBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function closeMenu() {
    const elements = getElements();
    elements.menuWrap?.classList.remove("is-menu-open");
    elements.moreBtn?.setAttribute("aria-expanded", "false");
    closeLocaleMenu();
    closeCopyListMenu();
  }

  function closeLocaleMenu() {
    const elements = getElements();
    elements.localeWrap?.classList.remove("is-open");
    elements.localeToggleBtn?.setAttribute("aria-expanded", "false");
  }

  function toggleListMenu(event) {
    event.stopPropagation();
    closeMenu();
    closeAnalysisHistoryMenu();
    closeCopyListMenu();
    const elements = getElements();
    const isOpen = elements.listWrap.classList.toggle("is-open");
    elements.listSelect.setAttribute("aria-expanded", String(isOpen));
  }

  function closeListMenu() {
    const elements = getElements();
    elements.listWrap?.classList.remove("is-open");
    elements.listSelect?.setAttribute("aria-expanded", "false");
  }

  function openAnalysisHistoryMenu() {
    const elements = getElements();
    if (!elements.historyMenu?.children.length) {
      closeAnalysisHistoryMenu();
      return;
    }
    closeMenu();
    closeListMenu();
    closeCopyListMenu();
    elements.historyWrap?.classList.add("is-open");
    elements.targetInput?.setAttribute("aria-expanded", "true");
  }

  function closeAnalysisHistoryMenu() {
    const elements = getElements();
    elements.historyWrap?.classList.remove("is-open");
    elements.targetInput?.setAttribute("aria-expanded", "false");
  }

  function toggleCopyListMenu(event) {
    event.stopPropagation();
    const elements = getElements();
    const isOpen = elements.copyListWrap.classList.toggle("is-copy-list-open");
    elements.copyListBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function closeCopyListMenu() {
    const elements = getElements();
    elements.copyListWrap?.classList.remove("is-copy-list-open");
    elements.copyListBtn?.setAttribute("aria-expanded", "false");
  }

  function toggleFamilyPosterSortMenu(event) {
    event.stopPropagation();
    const elements = getElements();
    const isOpen = elements.familyPosterSortWrap.classList.toggle("is-open");
    elements.familyPosterSortSelect.setAttribute("aria-expanded", String(isOpen));
  }

  function closeFamilyPosterSortMenu() {
    const elements = getElements();
    elements.familyPosterSortWrap?.classList.remove("is-open");
    elements.familyPosterSortSelect?.setAttribute("aria-expanded", "false");
  }

  return {
    closeAnalysisHistoryMenu,
    closeCopyListMenu,
    closeFamilyPosterSortMenu,
    closeListMenu,
    closeLocaleMenu,
    closeMenu,
    openAnalysisHistoryMenu,
    toggleCopyListMenu,
    toggleFamilyPosterSortMenu,
    toggleListMenu,
    toggleLocaleMenu,
    toggleMenu
  };
};
