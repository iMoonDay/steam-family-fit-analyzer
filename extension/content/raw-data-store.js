"use strict";

globalThis.SFFA_CREATE_RAW_DATA_STORE = function createRawDataStore(dependencies) {
  const {
    closeMenu,
    getLastRawData,
    setLastRawData,
    setStatus,
    t,
    window
  } = dependencies;

  function createRawDataSnapshot(action) {
    return {
      meta: {
        action,
        createdAt: new Date().toISOString(),
        currentStep: "started",
        error: null
      },
      familyGroupForUser: null,
      sharedLibraryApps: null,
      playerLinkDetails: null,
      steamApiKeyPage: null,
      resolveVanityUrl: null,
      targetPlayerSummaries: null,
      ownedGames: null,
      shareability: {},
      prices: {},
      requestFailures: {}
    };
  }

  function resetRawData(action) {
    setLastRawData(createRawDataSnapshot(action));
  }

  function setRawData(path, value) {
    const parts = String(path || "").split(".").filter(Boolean);
    if (!parts.length) {
      return;
    }

    const rawData = getLastRawData();
    let cursor = rawData;
    parts.slice(0, -1).forEach(part => {
      if (!cursor[part] || typeof cursor[part] !== "object") {
        cursor[part] = {};
      }
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  }

  function setRawStep(step) {
    const rawData = getLastRawData();
    rawData.meta.currentStep = step;
    rawData.meta.updatedAt = new Date().toISOString();
  }

  function setRawError(error) {
    const rawData = getLastRawData();
    rawData.meta.error = {
      message: error?.message || String(error || "未知错误")
    };
    rawData.meta.updatedAt = new Date().toISOString();
  }

  function showRawDataWindow() {
    closeMenu();
    const popup = window.open("", "_blank", "width=980,height=720");
    if (!popup) {
      setStatus(t("popupBlocked"), "err");
      return;
    }

    popup.document.title = t("rawDataTitle");
    popup.document.body.style.margin = "0";
    popup.document.body.style.background = "#0f141b";
    popup.document.body.style.color = "#dbe8f3";
    popup.document.body.style.font = "12px Consolas, monospace";
    const pre = popup.document.createElement("pre");
    pre.style.margin = "0";
    pre.style.padding = "16px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-word";
    pre.textContent = JSON.stringify(getLastRawData(), null, 2);
    popup.document.body.appendChild(pre);
  }

  return {
    createRawDataSnapshot,
    resetRawData,
    setRawData,
    setRawError,
    setRawStep,
    showRawDataWindow
  };
};
