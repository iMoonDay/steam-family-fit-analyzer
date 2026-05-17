"use strict";

globalThis.SFFA_CREATE_STORE_CONTEXT = function createStoreContext(dependencies) {
  const {
    document,
    fallbackStoreLang,
    location,
    pageState,
    steamLanguageAliases,
    window
  } = dependencies;

  function getDetectedStoreLanguage() {
    const pageWindow = typeof pageState !== "undefined" ? pageState : window;
    const candidates = [
      new URLSearchParams(location.search).get("l"),
      pageWindow?.g_strLanguage,
      window.g_strLanguage,
      readCookieValue("Steam_Language"),
      document.documentElement.lang
    ];

    for (const candidate of candidates) {
      const language = normalizeSteamLanguage(candidate);
      if (language) {
        return language;
      }
    }
    return fallbackStoreLang;
  }

  function normalizeSteamLanguage(value) {
    const normalized = String(value || "").trim().toLowerCase().replace("_", "-");
    return steamLanguageAliases[normalized] || "";
  }

  function getDetectedStoreCountryFromPage(doc = document, pageWindow = typeof pageState !== "undefined" ? pageState : window) {
    const configNode = getApplicationConfigNode(pageWindow, doc);
    const storeUserConfig = configNode ? readJsonAttribute(configNode, "data-store_user_config") : null;
    const userInfo = configNode ? readJsonAttribute(configNode, "data-userinfo") : null;
    const walletInfo = pageWindow?.g_rgWalletInfo || (doc === document ? window.g_rgWalletInfo : {}) || {};
    const candidates = [
      doc === document ? new URLSearchParams(location.search).get("cc") : "",
      pageWindow?.g_strCountryCode,
      doc === document ? window.g_strCountryCode : "",
      pageWindow?.g_strUserCountry,
      doc === document ? window.g_strUserCountry : "",
      storeUserConfig?.country_code,
      storeUserConfig?.web_country_code,
      storeUserConfig?.user_country,
      userInfo?.country_code,
      walletInfo?.wallet_country,
      walletInfo?.country_code,
      doc === document ? readCookieValue("steamCountry") : ""
    ];

    for (const candidate of candidates) {
      const country = normalizeStoreCountry(candidate);
      if (country) {
        return country;
      }
    }
    return "";
  }

  function getApplicationConfigNode(pageWindow = pageState, doc = document) {
    return pageWindow?.g_application_config || doc.querySelector("#application_config");
  }

  function readJsonAttribute(node, attributeName) {
    const value = node?.getAttribute?.(attributeName);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  async function resolveStoreCountryFromAccount(options) {
    const {
      initialStoreCountry,
      requestText,
      setStoreCountry,
      sleep,
      storeLanguage
    } = options;

    if (initialStoreCountry || location.hostname === "store.steampowered.com") {
      return;
    }

    const html = await Promise.race([
      requestText(`https://store.steampowered.com/?l=${encodeURIComponent(storeLanguage)}`).catch(() => ""),
      sleep(3000).then(() => "")
    ]);
    if (!html) {
      return;
    }

    const doc = new DOMParser().parseFromString(html, "text/html");
    setStoreCountry(getDetectedStoreCountryFromPage(doc, {}));
  }

  function createStoreCacheContext(country, language) {
    return `${country}:${language}`;
  }

  function normalizeStoreCountry(value) {
    const match = String(value || "").toUpperCase().match(/[A-Z]{2}/);
    return match ? match[0] : "";
  }

  function readCookieValue(name) {
    const pattern = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`);
    const match = document.cookie.match(pattern);
    return match ? decodeURIComponent(match[1]) : "";
  }

  return {
    createStoreCacheContext,
    getDetectedStoreCountryFromPage,
    getDetectedStoreLanguage,
    normalizeStoreCountry,
    normalizeSteamLanguage,
    readCookieValue,
    resolveStoreCountryFromAccount
  };
};
