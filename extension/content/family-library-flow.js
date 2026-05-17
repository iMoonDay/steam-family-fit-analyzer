"use strict";

globalThis.SFFA_CREATE_FAMILY_LIBRARY_FLOW = function createFamilyLibraryFlow(dependencies) {
  const {
    AUTO_FAMILY_REFRESH_INTERVAL_MS,
    getFamilyGameList,
    getFamilyInfo,
    getState,
    getSteamSession,
    openDialog,
    renderAutoFamilyRefreshButton,
    renderFamilyMeta,
    resetRawData,
    saveState,
    setBusy,
    setRawError,
    setStatus,
    t,
    window
  } = dependencies;
  let autoFamilyRefreshRunning = false;

  async function refreshFamilyLibrary() {
    try {
      openDialog();
      setBusy(true);
      const session = prepareFamilyRefreshSession();
      const familyLibrary = await updateFamilyLibraryCache(session);
      renderFamilyMeta();
      renderAutoFamilyRefreshButton();
      setStatus(t("refreshedCount", { count: familyLibrary.appidSet.length }), "ok");
    } catch (error) {
      setStatus(error.message, "err");
    } finally {
      setBusy(false);
    }
  }

  function prepareFamilyRefreshSession() {
    resetRawData("refresh-family-library");
    setStatus(t("refreshing"), "warn");
    const session = getSteamSession();
    if (!session.isLoggedIn || !session.accessToken || !session.steamid) {
      throw new Error(t("notLoggedInOrExpired"));
    }
    return session;
  }

  async function updateFamilyLibraryCache(session) {
    const familyInfo = await getFamilyInfo(session.accessToken);
    const familyLibrary = await getFamilyGameList(session.accessToken, familyInfo.family_groupid);
    getState().activeSteamId = session.steamid;
    getState().familyInfo = familyInfo;
    getState().familyLibrary = familyLibrary;
    saveState();
    return familyLibrary;
  }

  async function maybeAutoRefreshFamilyLibrary(session) {
    const state = getState();
    if (!state.autoFamilyRefreshEnabled || autoFamilyRefreshRunning) {
      return;
    }
    if (!session?.isLoggedIn || !session.accessToken || !session.steamid) {
      return;
    }
    if (state.activeSteamId && state.activeSteamId !== session.steamid) {
      return;
    }

    const now = Date.now();
    const lastSuccessAt = Number(state.familyLibrary?.updatedAt || 0);
    const lastAttemptAt = Number(state.lastAutoFamilyRefreshAttemptAt || 0);
    if (now - Math.max(lastSuccessAt, lastAttemptAt) < AUTO_FAMILY_REFRESH_INTERVAL_MS) {
      return;
    }

    autoFamilyRefreshRunning = true;
    state.lastAutoFamilyRefreshAttemptAt = now;
    saveState();

    try {
      resetRawData("auto-refresh-family-library");
      const familyLibrary = await updateFamilyLibraryCache(session);
      renderFamilyMeta();
      setStatus(t("autoRefreshedCount", { count: familyLibrary.appidSet.length }), "ok");
    } catch (error) {
      setRawError(error);
      console.warn(t("autoRefreshFailed"), error);
    } finally {
      autoFamilyRefreshRunning = false;
      renderAutoFamilyRefreshButton();
    }
  }

  return {
    maybeAutoRefreshFamilyLibrary,
    refreshFamilyLibrary
  };
};
