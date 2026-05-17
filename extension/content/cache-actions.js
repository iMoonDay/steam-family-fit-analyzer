"use strict";

globalThis.SFFA_CREATE_CACHE_ACTIONS = function createCacheActions(dependencies) {
  const {
    closeCopyListMenu,
    closeMenu,
    getState,
    getSteamSession,
    isRateLimitError,
    maybeAutoRefreshFamilyLibrary,
    refetchVisibleCoverUrls,
    renderAutoFamilyRefreshButton,
    renderCompareDialogIfOpen,
    renderDetailsPreserveScroll,
    renderStoreCacheButton,
    saveState,
    setBusy,
    setCoverReloadToken,
    setRateLimited,
    setRawError,
    setStatus,
    t
  } = dependencies;

  function toggleAutoFamilyRefresh() {
    closeMenu();
    getState().autoFamilyRefreshEnabled = !getState().autoFamilyRefreshEnabled;
    saveState();
    renderAutoFamilyRefreshButton();
    setStatus(getState().autoFamilyRefreshEnabled ? t("autoRefreshOn") : t("autoRefreshOff"), "ok");
    if (getState().autoFamilyRefreshEnabled) {
      maybeAutoRefreshFamilyLibrary(getSteamSession());
    }
  }

  function clearStoreCache() {
    closeMenu();
    getState().storeCache = {};
    saveState();
    renderStoreCacheButton();
    setStatus(t("storeCacheCleared"), "ok");
  }

  async function reloadCovers() {
    closeCopyListMenu();
    setBusy(true);
    try {
      await refetchVisibleCoverUrls();
      saveState();
      renderStoreCacheButton();
      setStatus(t("coversReloaded"), "ok");
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimited(error, "cover");
      } else {
        setRawError(error);
        setStatus(error.message || t("networkFailed"), "err");
      }
    } finally {
      setBusy(false);
    }
    setCoverReloadToken(Date.now());
    renderDetailsPreserveScroll();
    renderCompareDialogIfOpen();
  }

  return {
    clearStoreCache,
    reloadCovers,
    toggleAutoFamilyRefresh
  };
};
