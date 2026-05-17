const SUPPORTED_PAGE_HOSTS = new Set([
  "store.steampowered.com",
  "steamcommunity.com"
]);
const FALLBACK_HELPER_URL = "https://store.steampowered.com/#sffa-open-helper";

export function openHelperPanel(tab) {
  if (!isSupportedSteamTab(tab?.url)) {
    chrome.tabs.create({ url: FALLBACK_HELPER_URL });
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "sffaOpenPanel" }, () => {
    void chrome.runtime.lastError;
    // The content script may not be available yet on pages Chrome has not injected into.
  });
}

function isSupportedSteamTab(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    if (!SUPPORTED_PAGE_HOSTS.has(url.hostname)) {
      return false;
    }
    if (url.hostname === "store.steampowered.com") {
      return true;
    }
    return /^\/profiles\/[^/]+/.test(url.pathname) || /^\/id\/[^/]+/.test(url.pathname);
  } catch (error) {
    return false;
  }
}
