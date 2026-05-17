"use strict";

(function () {
  const ATTRIBUTE_NAME = "data-sffa-extension-page-state";
  const EVENT_NAME = "sffa-extension-page-state";
  const REQUEST_EVENT_NAME = "sffa-extension-request-page-state";
  const startedAt = Date.now();
  let lastSerialized = "";
  let timer = 0;

  publishPageState();
  window.addEventListener("DOMContentLoaded", publishPageState, { once: true });
  window.addEventListener("load", publishPageState, { once: true });
  window.addEventListener(REQUEST_EVENT_NAME, publishPageState);

  timer = window.setInterval(() => {
    publishPageState();
    if (Date.now() - startedAt > 5000) {
      window.clearInterval(timer);
    }
  }, 250);

  function publishPageState() {
    const state = collectPageState();
    const serialized = JSON.stringify(state);
    if (serialized === lastSerialized) {
      return;
    }

    lastSerialized = serialized;
    document.documentElement.setAttribute(ATTRIBUTE_NAME, serialized);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: state }));
  }

  function collectPageState() {
    return {
      g_AccountID: serializeValue(window.g_AccountID),
      g_rgWalletInfo: serializeValue(window.g_rgWalletInfo),
      g_steamID: serializeValue(window.g_steamID),
      g_steamID64: serializeValue(window.g_steamID64),
      g_strCountryCode: serializeValue(window.g_strCountryCode),
      g_strLanguage: serializeValue(window.g_strLanguage),
      g_strUserCountry: serializeValue(window.g_strUserCountry)
    };
  }

  function serializeValue(value) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value.GetSteamID64 === "function") {
      try {
        return { steamid: String(value.GetSteamID64()) };
      } catch (error) {
        return null;
      }
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return null;
    }
  }
}());
