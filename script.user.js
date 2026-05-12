// ==UserScript==
// @name         Steam 家庭库分析器
// @namespace    https://tampermonkey.net/
// @version      0.1.0
// @description  基于当前 Steam 家庭组共享库，分析指定公开 Steam 账户加入后可带来的新增游戏、重复游戏和新增库价值
// @author       iMoonDay
// @match        https://store.steampowered.com/*
// @match        https://steamcommunity.com/profiles/*
// @icon         https://store.steampowered.com/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        unsafeWindow
// @connect      api.steampowered.com
// @connect      partner.steam-api.com
// @connect      steamcommunity.com
// @connect      store.steampowered.com
// @license      MIT
// ==/UserScript==

(function() {
  "use strict";

  // 价格使用的 Steam 国区代码，例如 CN / US / JP。
  const STORE_CC = "CN";
  // 商店接口返回语言，schinese 表示简体中文。
  const STORE_LANG = "schinese";
  // 本地存储键名；改动后会读不到旧缓存。
  const STORAGE_KEY = "steam_family_fit_analyzer_state_v1";
  // 家庭共享支持性缓存有效期，默认 7 天。
  const SHAREABILITY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  // 原价缓存有效期，默认 7 天。
  const ORIGINAL_PRICE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  // 家庭共享支持性检测并发批量；过大更容易 HTTP 429。
  const SHAREABILITY_BATCH_SIZE = 5;
  // 商店请求之间的基础间隔，单位毫秒。
  const STORE_REQUEST_DELAY_MS = 50;
  // 商店请求失败后的重试次数。
  const STORE_REQUEST_RETRY_COUNT = 4;
  // 商店请求失败后首次重试等待时间，后续会递增。
  const STORE_REQUEST_RETRY_BASE_DELAY_MS = 1800;
  // 自动后台刷新家庭库的间隔，默认 24 小时。
  const AUTO_FAMILY_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  // Steam 商店分类中“家庭共享”特性的 category id。
  const FAMILY_SHARING_CATEGORY_ID = 62;

  const DEFAULT_STATE = Object.freeze({
    version: 1,
    activeSteamId: "",
    launcherVisible: true,
    familyInfo: null,
    familyLibrary: {
      appidSet: [],
      appInfoById: {},
      updatedAt: 0
    },
    shareabilityCache: {},
    originalPriceCache: {},
    autoFamilyRefreshEnabled: true,
    lastAutoFamilyRefreshAttemptAt: 0,
    apiKey: ""
  });

  let state = loadState();
  let currentTab = "all";
  let tableSortByTab = {};
  let lastReport = null;
  let lastRawData = createRawDataSnapshot("init");
  let storeRequestQueue = Promise.resolve();
  let priceLoadState = createPriceLoadState();
  let activeAnalysisId = 0;
  let shareabilityFilterState = createShareabilityFilterState();
  let shareabilityProgressUiState = createShareabilityProgressUiState();
  let scriptMenuCommandIds = [];
  let autoFamilyRefreshRunning = false;
  let elements = {};

  bootstrap();

  function bootstrap() {
    injectStyles();
    mountPanel();
    autoFillTargetInputFromProfilePage();
    const session = getSteamSession();
    if (!session.isLoggedIn) {
      setStatus("请先登录", "warn");
      setBusy(false);
      return;
    }

    if (!state.activeSteamId) {
      state.activeSteamId = session.steamid;
      saveState();
    } else if (state.activeSteamId !== session.steamid) {
      setStatus("账号已切换，请刷新", "warn");
    } else if (state.familyLibrary.appidSet.length > 0) {
      setStatus(`已加载：${state.familyLibrary.appidSet.length} 款`, "ok");
    } else {
      setStatus("请先刷新", "warn");
    }
    renderLauncherVisibility();
    registerScriptMenuCommands();
    renderFamilyMeta();
    window.setTimeout(() => maybeAutoRefreshFamilyLibrary(session), 0);
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #sffa-root {
        position: fixed;
        inset: 0;
        z-index: 999999;
        pointer-events: none;
        color: #dbe8f3;
        font-family: Motiva Sans, Arial, Helvetica, sans-serif;
      }
      #sffa-root, #sffa-root * {
        box-sizing: border-box;
      }
      .sffa-launcher-wrap {
        position: fixed;
        right: 0;
        top: 58%;
        pointer-events: auto;
        display: inline-flex;
        align-items: stretch;
        transform: translateY(-50%) translateX(22px);
        transition: transform 0.16s ease, opacity 0.16s ease, visibility 0.16s ease;
      }
      .sffa-launcher-wrap:hover {
        transform: translateY(-50%) translateX(0);
      }
      .sffa-launcher-wrap.is-hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .sffa-launcher-wrap.is-hidden:hover {
        transform: translateY(-50%) translateX(22px);
      }
      .sffa-launcher {
        pointer-events: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        min-height: 88px;
        padding: 10px 6px;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-right: 0;
        border-radius: 4px 0 0 4px;
        background: linear-gradient(180deg, #1f3c4f 0%, #183245 100%);
        color: #ffffff;
        cursor: pointer;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
        font: inherit;
        font-size: 12px;
        line-height: 1.15;
        writing-mode: vertical-rl;
        letter-spacing: 0;
        position: relative;
        transition: filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-launcher-close {
        position: absolute;
        left: -14px;
        top: -8px;
        width: 16px;
        height: 16px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: #dbe8f3;
        font: inherit;
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        z-index: 1;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: color 0.12s ease, opacity 0.12s ease, visibility 0.12s ease;
      }
      .sffa-launcher-wrap:hover .sffa-launcher-close {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .sffa-launcher-close:hover {
        color: #ffffff;
      }
      .sffa-launcher:hover {
        background: linear-gradient(180deg, #27556f 0%, #20465c 100%);
        filter: brightness(1.07);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(143, 209, 255, 0.22) inset;
      }
      .sffa-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(11, 16, 22, 0.72);
        backdrop-filter: blur(2px);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.16s ease, visibility 0.16s ease;
        pointer-events: none;
      }
      .sffa-shell {
        position: fixed;
        left: 50%;
        top: 50%;
        width: min(1120px, calc(100vw - 28px));
        height: min(860px, calc(100vh - 28px));
        transform: translate(-50%, -50%) scale(0.98);
        opacity: 0;
        visibility: hidden;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(102, 192, 244, 0.34);
        border-radius: 4px;
        background: #171a21;
        box-shadow: 0 28px 72px rgba(0, 0, 0, 0.58);
        transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s ease;
      }
      #sffa-root.is-open .sffa-backdrop {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      #sffa-root.is-open .sffa-shell {
        opacity: 1;
        visibility: visible;
        transform: translate(-50%, -50%) scale(1);
      }
      #sffa-root.is-open .sffa-launcher {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      #sffa-root.is-open .sffa-launcher-wrap {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .sffa-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        background: linear-gradient(180deg, #2a475e 0%, #1b2838 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      }
      .sffa-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .sffa-title strong {
        font-size: 15px;
        font-weight: 700;
        color: #ffffff;
        line-height: 1.2;
      }
      .sffa-title span {
        font-size: 12px;
        color: #b8c7d3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sffa-header-actions {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      .sffa-icon-btn,
      .sffa-close {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 2px;
        cursor: pointer;
        color: #ffffff;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
      }
      .sffa-icon-btn {
        font-size: 20px;
        line-height: 1;
      }
      .sffa-icon-btn:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-icon-btn[aria-expanded="true"] {
        background: rgba(102, 192, 244, 0.2);
      }
      .sffa-icon-btn:hover,
      .sffa-close:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .sffa-launcher:hover,
      .sffa-icon-btn:hover:not(:disabled),
      .sffa-close:hover:not(:disabled),
      .sffa-menu-item:hover:not(:disabled),
      .sffa-btn:hover:not(:disabled),
      .sffa-tab:hover:not(:disabled),
      .sffa-copy-current:hover:not(:disabled) {
        filter: brightness(1.08);
        box-shadow: 0 0 0 1px rgba(143, 209, 255, 0.2) inset;
      }
      .sffa-menu {
        position: absolute;
        right: 36px;
        top: 36px;
        min-width: 190px;
        display: none;
        padding: 6px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        border-radius: 3px;
        background: #0f141b;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
        z-index: 2;
      }
      .sffa-header-actions.is-menu-open .sffa-menu {
        display: grid;
        gap: 4px;
      }
      .sffa-menu-item {
        width: 100%;
        min-height: 32px;
        padding: 0 10px;
        border: 0;
        border-radius: 2px;
        background: transparent;
        color: #dbe8f3;
        text-align: left;
        cursor: pointer;
        font: inherit;
      }
      .sffa-menu-item:hover {
        background: rgba(102, 192, 244, 0.14);
      }
      .sffa-menu-item.danger {
        color: #ffd0d0;
      }
      .sffa-menu-item:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-body {
        min-height: 0;
        flex: 1 1 auto;
        padding: 10px 12px 12px;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
        overflow: hidden;
      }
      .sffa-content {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-columns: 360px minmax(0, 1fr);
        gap: 12px;
        overflow: hidden;
      }
      .sffa-side {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 8px;
        overflow: hidden;
      }
      .sffa-main {
        min-width: 0;
        min-height: 0;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 8px;
        overflow: hidden;
      }
      .sffa-row {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .sffa-input {
        flex: 1 1 320px;
        min-width: 0;
        height: 36px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 10px;
        outline: none;
      }
      .sffa-input:focus {
        border-color: #66c0f4;
        box-shadow: 0 0 0 2px rgba(102, 192, 244, 0.12);
      }
      .sffa-btn {
        height: 36px;
        padding: 0 12px;
        border-radius: 3px;
        color: #ffffff;
        background: linear-gradient(180deg, #2a475e 0%, #1b2838 100%);
        border: 1px solid rgba(102, 192, 244, 0.26);
        white-space: nowrap;
        transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-btn:hover:not(:disabled),
      .sffa-tab:hover:not(:disabled),
      .sffa-menu-item:hover:not(:disabled),
      .sffa-icon-btn:hover:not(:disabled),
      .sffa-close:hover:not(:disabled),
      .sffa-copy-current:hover:not(:disabled) {
      }
      .sffa-btn.secondary {
        background: linear-gradient(180deg, #3d5568 0%, #2d4355 100%);
        color: #e2edf4;
      }
      .sffa-btn.danger {
        background: linear-gradient(180deg, #6a4448 0%, #4f3135 100%);
        color: #ffe8e8;
      }
      .sffa-btn:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-status {
        min-height: 18px;
        font-size: 12px;
        color: #b8c7d3;
      }
      .sffa-status.ok {
        color: #9be0ad;
      }
      .sffa-status.warn {
        color: #ffd28c;
      }
      .sffa-status.err {
        color: #ffaaa2;
      }
      .sffa-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-content: start;
        gap: 6px;
      }
      .sffa-metric {
        min-height: 44px;
        padding: 7px 8px;
        border-radius: 3px;
        background: #1f2b36;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .sffa-metric span {
        display: block;
        font-size: 11px;
        line-height: 1.25;
        color: #9fb3c2;
        margin-bottom: 4px;
      }
      .sffa-metric strong {
        display: block;
        font-size: 15px;
        line-height: 1.05;
        color: #ffffff;
        overflow-wrap: anywhere;
      }
      .sffa-profile {
        min-height: 0;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 3px;
        background: #11161d;
        overflow: auto;
      }
      .sffa-profile-head {
        display: flex;
        gap: 10px;
        align-items: center;
        min-width: 0;
        margin-bottom: 10px;
      }
      .sffa-avatar {
        width: 48px;
        height: 48px;
        flex: 0 0 auto;
        border-radius: 3px;
        background: #223344;
        object-fit: cover;
      }
      .sffa-profile-name {
        min-width: 0;
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .sffa-profile-link {
        display: inline-block;
        margin-top: 4px;
        color: #8fd1ff;
        font-size: 12px;
        text-decoration: none;
      }
      .sffa-profile-row {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 8px;
        padding: 5px 0;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 12px;
      }
      .sffa-profile-row span:first-child {
        color: #9fb3c2;
      }
      .sffa-profile-row span:last-child {
        color: #d8e4ee;
        overflow-wrap: anywhere;
      }
      .sffa-tabs {
        display: flex;
        gap: 6px;
        min-height: 30px;
        align-items: center;
      }
      .sffa-tab {
        height: 30px;
        padding: 0 10px;
        border-radius: 3px;
        background: #223344;
        color: #c2d4df;
        border: 1px solid rgba(255, 255, 255, 0.08);
        transition: transform 0.12s ease, filter 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
      }
      .sffa-tab:hover:not(:disabled) {
        background: #2c4254;
        border-color: rgba(143, 209, 255, 0.28);
      }
      .sffa-tab.active:hover:not(:disabled) {
        background: linear-gradient(180deg, #66c0f4 0%, #4ea5d8 100%);
        border-color: rgba(143, 209, 255, 0.45);
        filter: brightness(1.05);
      }
      .sffa-tab.active {
        background: linear-gradient(180deg, #66c0f4 0%, #4ea5d8 100%);
        color: #0a1118;
        font-weight: 700;
      }
      .sffa-tab[data-tab="family"] {
        margin-left: auto;
      }
      .sffa-search-input {
        display: none;
        margin-left: 6px;
        width: min(260px, 40%);
        min-width: 160px;
        height: 30px;
        border: 1px solid rgba(102, 192, 244, 0.26);
        background: #0f141b;
        color: #f2f7fb;
        border-radius: 3px;
        padding: 0 9px;
        outline: none;
      }
      .sffa-search-input.is-visible {
        display: block;
      }
      .sffa-copy-current {
        margin-left: 0;
      }
      .sffa-copy-current:hover:not(:disabled) {
        background: #2c4254;
        border-color: rgba(143, 209, 255, 0.28);
      }
      .sffa-copy-current:disabled {
        cursor: wait;
        opacity: 0.58;
      }
      .sffa-search-input:focus {
        border-color: #66c0f4;
      }
      .sffa-table-wrap {
        min-height: 0;
        overflow: auto;
        border: 1px solid rgba(255, 255, 255, 0.07);
        border-radius: 3px;
        background: #11161d;
      }
      .sffa-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 12px;
      }
      .sffa-table th,
      .sffa-table td {
        padding: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        text-align: left;
        vertical-align: top;
      }
      .sffa-table th {
        position: sticky;
        top: 0;
        background: #0f141b;
        color: #9fb3c2;
        z-index: 1;
      }
      .sffa-table th[data-sort-key] {
        cursor: pointer;
        user-select: none;
      }
      .sffa-table th[data-sort-key]:hover {
        color: #d8e4ee;
        background: #17212b;
      }
      .sffa-sort-indicator {
        display: inline-block;
        min-width: 12px;
        margin-left: 4px;
        color: #8fd1ff;
      }
      .sffa-table td {
        color: #d8e4ee;
      }
      .sffa-table a {
        color: #8fd1ff;
        text-decoration: none;
      }
      .sffa-spinner {
        width: 14px;
        height: 14px;
        display: inline-block;
        vertical-align: -2px;
        border: 2px solid rgba(143, 209, 255, 0.25);
        border-top-color: #8fd1ff;
        border-radius: 50%;
        animation: sffa-spin 0.8s linear infinite;
      }
      .sffa-status-inline {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      @keyframes sffa-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .sffa-empty {
        padding: 18px;
        color: #9fb3c2;
        text-align: center;
      }
      @media (max-width: 680px) {
        .sffa-launcher-wrap {
          right: 0;
          top: 62%;
          transform: translateY(-50%) translateX(22px);
        }
        .sffa-launcher-wrap:hover {
          transform: translateY(-50%) translateX(0);
        }
        .sffa-launcher {
          min-height: 82px;
        }
        .sffa-shell {
          width: calc(100vw - 20px);
          height: calc(100vh - 20px);
        }
        .sffa-body {
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sffa-content {
          grid-template-columns: 1fr;
          grid-template-rows: auto minmax(0, 1fr);
        }
        .sffa-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .sffa-table {
          min-width: 640px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function mountPanel() {
    const root = document.createElement("div");
    root.id = "sffa-root";
    root.innerHTML = `
      <div class="sffa-launcher-wrap" data-sffa-launcher-wrap>
        <button class="sffa-launcher-close" type="button" data-sffa-launcher-close title="隐藏侧边按钮" aria-label="隐藏侧边按钮">×</button>
        <button class="sffa-launcher" type="button" title="打开 Steam 家庭库分析器">
          <span>家庭库分析</span>
        </button>
      </div>
      <div class="sffa-backdrop" data-sffa-backdrop></div>
      <section class="sffa-shell" aria-label="Steam 家庭库分析器">
        <header class="sffa-header">
          <div class="sffa-title">
            <strong>家庭库分析</strong>
            <span data-sffa-family-meta>等待家庭库扫描</span>
          </div>
          <div class="sffa-header-actions" data-sffa-menu-wrap>
            <button class="sffa-icon-btn" type="button" data-sffa-more title="更多" aria-label="更多" aria-expanded="false">⋯</button>
            <div class="sffa-menu" data-sffa-menu>
              <button class="sffa-menu-item" type="button" data-sffa-auto-family-refresh></button>
              <button class="sffa-menu-item" type="button" data-sffa-copy>复制报告</button>
              <button class="sffa-menu-item danger" type="button" data-sffa-clear-shareability hidden>清除共享缓存</button>
              <button class="sffa-menu-item danger" type="button" data-sffa-clear-price hidden>清除价格缓存</button>
              <button class="sffa-menu-item" type="button" data-sffa-raw>查看原始数据</button>
            </div>
            <button class="sffa-close" type="button" data-sffa-close title="关闭">×</button>
          </div>
        </header>
        <div class="sffa-body">
          <div class="sffa-row">
            <input class="sffa-input" data-sffa-target placeholder="SteamID64、主页链接或自定义 ID" autocomplete="off">
            <button class="sffa-btn secondary" type="button" data-sffa-refresh>刷新家庭库</button>
            <button class="sffa-btn" type="button" data-sffa-analyze>分析账号</button>
          </div>
          <div class="sffa-content">
            <div class="sffa-side">
            <div class="sffa-status" data-sffa-status></div>
            <div class="sffa-summary" data-sffa-summary></div>
            <div class="sffa-profile" data-sffa-profile></div>
            </div>
            <div class="sffa-main">
              <div class="sffa-tabs" data-sffa-tabs>
                <button class="sffa-tab active" type="button" data-tab="all">全部</button>
              <button class="sffa-tab" type="button" data-tab="new">新增</button>
              <button class="sffa-tab" type="button" data-tab="overlap">重复</button>
              <button class="sffa-tab" type="button" data-tab="search">搜索</button>
                <input class="sffa-search-input" data-sffa-search placeholder="搜索游戏名或 AppID" autocomplete="off">
                <button class="sffa-tab" type="button" data-tab="family">家庭库</button>
                <button class="sffa-tab sffa-copy-current" type="button" data-sffa-copy-current>复制列表</button>
              </div>
              <div class="sffa-table-wrap" data-sffa-table-wrap>
                <div class="sffa-empty">输入账号后分析</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(root);

    elements = {
      root,
      familyMeta: root.querySelector("[data-sffa-family-meta]"),
      status: root.querySelector("[data-sffa-status]"),
      summary: root.querySelector("[data-sffa-summary]"),
      profile: root.querySelector("[data-sffa-profile]"),
      tableWrap: root.querySelector("[data-sffa-table-wrap]"),
      backdrop: root.querySelector("[data-sffa-backdrop]"),
      closeBtn: root.querySelector("[data-sffa-close]"),
      launcherWrap: root.querySelector("[data-sffa-launcher-wrap]"),
      launcherCloseBtn: root.querySelector("[data-sffa-launcher-close]"),
      menuWrap: root.querySelector("[data-sffa-menu-wrap]"),
      moreBtn: root.querySelector("[data-sffa-more]"),
      launcher: root.querySelector(".sffa-launcher"),
      targetInput: root.querySelector("[data-sffa-target]"),
      searchInput: root.querySelector("[data-sffa-search]"),
      copyCurrentBtn: root.querySelector("[data-sffa-copy-current]"),
      refreshBtn: root.querySelector("[data-sffa-refresh]"),
      analyzeBtn: root.querySelector("[data-sffa-analyze]"),
      autoFamilyRefreshBtn: root.querySelector("[data-sffa-auto-family-refresh]"),
      copyBtn: root.querySelector("[data-sffa-copy]"),
      clearShareabilityBtn: root.querySelector("[data-sffa-clear-shareability]"),
      clearPriceBtn: root.querySelector("[data-sffa-clear-price]"),
      rawBtn: root.querySelector("[data-sffa-raw]"),
      tabs: Array.from(root.querySelectorAll("[data-tab]"))
    };

    elements.launcher.addEventListener("click", openDialog);
    elements.launcherCloseBtn.addEventListener("click", hideLauncherButton);
    elements.closeBtn.addEventListener("click", closeDialog);
    elements.backdrop.addEventListener("click", closeDialog);
    elements.moreBtn.addEventListener("click", toggleMenu);
    elements.refreshBtn.addEventListener("click", refreshFamilyLibrary);
    elements.analyzeBtn.addEventListener("click", analyzeTarget);
    elements.autoFamilyRefreshBtn.addEventListener("click", toggleAutoFamilyRefresh);
    elements.copyBtn.addEventListener("click", copyReportSummary);
    elements.copyCurrentBtn.addEventListener("click", copyCurrentList);
    elements.clearShareabilityBtn.addEventListener("click", clearShareabilityCache);
    elements.clearPriceBtn.addEventListener("click", clearOriginalPriceCache);
    elements.rawBtn?.addEventListener("click", showRawDataWindow);
    elements.tableWrap.addEventListener("scroll", () => scheduleVisiblePriceLoads());
    elements.tableWrap.addEventListener("click", handleTableHeaderClick);
    elements.targetInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        analyzeTarget();
      }
    });
    elements.searchInput.addEventListener("input", renderDetails);
    elements.tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        currentTab = tab.dataset.tab;
        renderTabs();
        renderDetails();
      });
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeMenu();
        closeDialog();
      }
    });
    document.addEventListener("click", event => {
      if (!elements.menuWrap.contains(event.target)) {
        closeMenu();
      }
    });

    renderSummary(null);
    renderTargetProfile(null);
    renderAutoFamilyRefreshButton();
    renderShareabilityCacheButton();
    renderOriginalPriceCacheButton();
  }

  function openDialog() {
    elements.root.classList.add("is-open");
    window.setTimeout(() => {
      elements.targetInput.focus();
      elements.targetInput.select();
    }, 0);
  }

  function autoFillTargetInputFromProfilePage() {
    if (!isSteamCommunityProfilePage()) {
      return;
    }
    if (elements.targetInput.value.trim()) {
      return;
    }
    const steamid = getSteamCommunityProfileSteamId();
    if (steamid) {
      elements.targetInput.value = steamid;
    }
  }

  function renderLauncherVisibility() {
    if (!elements.launcherWrap) {
      return;
    }
    const visible = state.launcherVisible !== false;
    elements.launcherWrap.classList.toggle("is-hidden", !visible);
  }

  function hideLauncherButton() {
    state.launcherVisible = false;
    saveState();
    renderLauncherVisibility();
    registerScriptMenuCommands();
    setStatus("侧边按钮已隐藏", "ok");
  }

  function toggleLauncherButtonVisibility() {
    state.launcherVisible = state.launcherVisible === false;
    saveState();
    renderLauncherVisibility();
    registerScriptMenuCommands();
    setStatus(state.launcherVisible ? "侧边按钮已显示" : "侧边按钮已隐藏", "ok");
  }

  function registerScriptMenuCommands() {
    unregisterScriptMenuCommands();
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }
    scriptMenuCommandIds.push(
      GM_registerMenuCommand(state.launcherVisible === false ? "显示侧边按钮" : "隐藏侧边按钮", toggleLauncherButtonVisibility)
    );
    scriptMenuCommandIds.push(
      GM_registerMenuCommand("打开分析弹窗", openDialog)
    );
  }

  function unregisterScriptMenuCommands() {
    if (typeof GM_unregisterMenuCommand !== "function") {
      scriptMenuCommandIds = [];
      return;
    }
    scriptMenuCommandIds.forEach(id => {
      try {
        GM_unregisterMenuCommand(id);
      } catch (error) {
        // Ignore.
      }
    });
    scriptMenuCommandIds = [];
  }

  function closeDialog() {
    closeMenu();
    elements.root.classList.remove("is-open");
  }

  function toggleMenu(event) {
    event.stopPropagation();
    const isOpen = elements.menuWrap.classList.toggle("is-menu-open");
    elements.moreBtn.setAttribute("aria-expanded", String(isOpen));
  }

  function closeMenu() {
    elements.menuWrap?.classList.remove("is-menu-open");
    elements.moreBtn?.setAttribute("aria-expanded", "false");
  }

  async function refreshFamilyLibrary() {
    try {
      openDialog();
      setBusy(true);
      resetRawData("refresh-family-library");
      setStatus("刷新中...", "warn");
      const session = getSteamSession();
      if (!session.isLoggedIn || !session.accessToken || !session.steamid) {
        throw new Error("未登录或页面过期");
      }

      const familyLibrary = await updateFamilyLibraryCache(session);

      renderFamilyMeta();
      renderAutoFamilyRefreshButton();
      setStatus(`已刷新：${familyLibrary.appidSet.length} 款`, "ok");
    } catch (error) {
      setStatus(error.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function updateFamilyLibraryCache(session) {
    const familyInfo = await getFamilyInfo(session.accessToken);
    const familyLibrary = await getFamilyGameList(session.accessToken, familyInfo.family_groupid);
    state.activeSteamId = session.steamid;
    state.familyInfo = familyInfo;
    state.familyLibrary = familyLibrary;
    saveState();
    return familyLibrary;
  }

  async function maybeAutoRefreshFamilyLibrary(session) {
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
      setStatus(`已自动刷新：${familyLibrary.appidSet.length} 款`, "ok");
    } catch (error) {
      setRawError(error);
      console.warn("自动刷新失败：", error);
    } finally {
      autoFamilyRefreshRunning = false;
      renderAutoFamilyRefreshButton();
    }
  }

  async function analyzeTarget() {
    try {
      openDialog();
      setBusy(true);
      resetRawData("analyze-target");
      const rawInput = elements.targetInput.value.trim();
      if (!rawInput) {
        throw new Error("请输入账号");
      }
      setRawStep("check-family-cache");
      ensureFamilyReady();
      setStatus("读取 API Key...", "warn");
      setRawStep("read-steam-web-api-key");
      await autoReadApiKeyFromCommunity({ keepBusy: true });

      setStatus("读取目标库...", "warn");
      setRawStep("fetch-target-owned-games");
      const targetProfile = await getTargetProfile(rawInput);
      setStatus("比较游戏库...", "warn");
      setRawStep("compare-libraries");
      const comparison = compareLibraries(targetProfile);
      const analysisId = ++activeAnalysisId;
      priceLoadState = createPriceLoadState();
      shareabilityFilterState = createShareabilityFilterState(analysisId, comparison.overlapGames.length, comparison.newGames.length, targetProfile.games.length);
      if (shareabilityProgressUiState?.timer) {
        window.clearTimeout(shareabilityProgressUiState.timer);
      }
      shareabilityProgressUiState = createShareabilityProgressUiState(analysisId);
      setRawStep("build-report");
      lastReport = buildReport(targetProfile, {
        ...comparison,
        allGames: targetProfile.games,
        pendingNewGames: comparison.newGames,
        newGames: []
      });

      currentTab = "all";
      renderTabs();
      renderSummary(lastReport);
      renderTargetProfile(lastReport);
      renderDetails();
      setStatus(`已显示全部，后台统计 ${formatPercent(targetProfile.games.length ? comparison.overlapGames.length / targetProfile.games.length : 0)}`, "warn");
      setRawStep("background-filter-new-family-sharing-games");
      window.setTimeout(() => {
        startBackgroundShareabilityFilter(analysisId, comparison.newGames);
      }, 0);
    } catch (error) {
      setRawError(error);
      setStatus(error.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function copyReportSummary() {
    closeMenu();
    if (!lastReport) {
      setStatus("暂无摘要", "warn");
      return;
    }

    const summary = [
      `Steam 家庭库分析：${lastReport.target.displayName || lastReport.target.steamid64}`,
      `总游戏：${lastReport.metrics.targetCount} 款`,
      `家庭库：${lastReport.metrics.familyCount} 款`,
      `新增：${lastReport.metrics.newCount} 款`,
      `重复：${lastReport.metrics.overlapCount} 款`,
      `重复率：${formatPercent(lastReport.metrics.overlapRate)}`,
      `新增价值：${formatCny(lastReport.metrics.initialValue)}`
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      setStatus("已复制", "ok");
    } catch (error) {
      setStatus("复制失败", "err");
    }
  }

  async function copyCurrentList() {
    const rows = getCurrentListRows();
    if (!lastReport && currentTab !== "family") {
      setStatus("暂无列表", "warn");
      return;
    }

    if (rows.length === 0) {
      setStatus(currentTab === "search" ? "请先输入关键词" : "当前列表为空", "warn");
      return;
    }

    const table = buildCurrentListCopyTable(rows);
    const text = [table.headers, ...table.rows]
      .map(row => row.map(normalizeCopyCell).join("\t"))
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setStatus("已复制列表", "ok");
    } catch (error) {
      setStatus("复制失败", "err");
    }
  }

  function showRawDataWindow() {
    closeMenu();
    const popup = window.open("", "_blank", "width=980,height=720");
    if (!popup) {
      setStatus("弹窗被拦截", "err");
      return;
    }

    popup.document.title = "返回原始数据";
    popup.document.body.style.margin = "0";
    popup.document.body.style.background = "#0f141b";
    popup.document.body.style.color = "#dbe8f3";
    popup.document.body.style.font = "12px Consolas, monospace";
    const pre = popup.document.createElement("pre");
    pre.style.margin = "0";
    pre.style.padding = "16px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-word";
    pre.textContent = JSON.stringify(lastRawData, null, 2);
    popup.document.body.appendChild(pre);
  }

  function toggleAutoFamilyRefresh() {
    closeMenu();
    state.autoFamilyRefreshEnabled = !state.autoFamilyRefreshEnabled;
    saveState();
    renderAutoFamilyRefreshButton();
    setStatus(state.autoFamilyRefreshEnabled ? "自动刷新已开" : "自动刷新已关", "ok");
    if (state.autoFamilyRefreshEnabled) {
      maybeAutoRefreshFamilyLibrary(getSteamSession());
    }
  }

  function clearShareabilityCache() {
    closeMenu();
    state.shareabilityCache = {};
    saveState();
    renderShareabilityCacheButton();
    setStatus("已清除共享缓存", "ok");
  }

  function clearOriginalPriceCache() {
    closeMenu();
    state.originalPriceCache = {};
    saveState();
    renderOriginalPriceCacheButton();
    setStatus("已清除价格缓存", "ok");
  }

  async function fetchExistingSteamApiKey() {
    const html = await requestText("https://steamcommunity.com/dev/apikey");
    setRawData("steamApiKeyPage", {
      signedIn: !isSteamSignInPage(html),
      hasExtractableKey: Boolean(extractSteamApiKeyFromDevPage(html)),
      htmlLength: html.length
    });
    if (isSteamSignInPage(html)) {
      throw new Error("Community 未登录");
    }

    const apiKey = extractSteamApiKeyFromDevPage(html);
    if (apiKey) {
      return apiKey;
    }

    if (/\/dev\/registerkey|Registering\s+for\s+a\s+Steam\s+Web\s+API\s+Key|Domain\s+Name/i.test(html)) {
      throw new Error("未注册 API Key");
    }

    throw new Error("找不到 API Key");
  }

  function extractSteamApiKeyFromDevPage(html) {
    const text = htmlToPlainText(html);
    const labelMatch = text.match(/(?:Key|密钥)\s*[:：]\s*([0-9A-F]{32})\b/i);
    if (labelMatch) {
      return labelMatch[1].toUpperCase();
    }

    const nearbyMatch = text.match(/Steam\s+Web\s+API\s+Key[\s\S]{0,260}?([0-9A-F]{32})\b/i);
    return nearbyMatch ? nearbyMatch[1].toUpperCase() : "";
  }

  function htmlToPlainText(html) {
    return decodeHtml(String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim());
  }

  function isSteamSignInPage(html) {
    return /<title>\s*Sign In\s*<\/title>/i.test(html) || /g_steamID\s*=\s*false/i.test(html);
  }

  function getSteamSession() {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const accountId = Number(pageWindow.g_AccountID || window.g_AccountID || 0);
    const configNode = getApplicationConfigNode(pageWindow);
    let accessToken = "";
    let steamid = "";

    steamid = readSteamGlobalSteamId(pageWindow);
    if (configNode) {
      accessToken = readJsonAttribute(configNode, "data-store_user_config")?.webapi_token || "";
      steamid = readJsonAttribute(configNode, "data-userinfo")?.steamid || steamid;
    }

    return {
      isLoggedIn: accountId !== 0 || Boolean(accessToken && steamid) || Boolean(steamid),
      accessToken,
      steamid: steamid || getSteamCommunityProfileSteamId()
    };
  }

  function readSteamGlobalSteamId(pageWindow) {
    const candidates = [pageWindow?.g_steamID, window.g_steamID, pageWindow?.g_steamID64, window.g_steamID64];
    for (const candidate of candidates) {
      const steamid = normalizeSteamId(candidate);
      if (steamid) {
        return steamid;
      }
    }
    return "";
  }

  function normalizeSteamId(value) {
    if (typeof value === "string" && /^\d{17}$/.test(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      const direct = String(value.steamid || value.steamId || value.accountid || value.accountId || "");
      if (/^\d{17}$/.test(direct)) {
        return direct;
      }
      if (typeof value.GetSteamID64 === "function") {
        try {
          const result = String(value.GetSteamID64());
          if (/^\d{17}$/.test(result)) {
            return result;
          }
        } catch (error) {
          // Ignore.
        }
      }
    }
    return "";
  }

  function isSteamCommunityProfilePage() {
    return location.hostname === "steamcommunity.com" && /^\/profiles\/\d{17}(?:\/|$)/.test(location.pathname);
  }

  function getSteamCommunityProfileSteamId() {
    if (!isSteamCommunityProfilePage()) {
      return "";
    }
    const match = location.pathname.match(/^\/profiles\/(\d{17})(?:\/|$)/);
    return match ? match[1] : "";
  }

  function getApplicationConfigNode(pageWindow) {
    const candidates = [
      document.getElementById("application_config"),
      document.querySelector("#application_config"),
      document.querySelector("[data-store_user_config][data-userinfo]"),
      pageWindow?.application_config,
      window.application_config
    ];

    return candidates.find(node => node && typeof node.getAttribute === "function") || null;
  }

  async function getFamilyInfo(accessToken) {
    const url = `https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/?access_token=${encodeURIComponent(accessToken)}&include_family_group_response=true`;
    const data = await requestJson(url);
    setRawData("familyGroupForUser", data);
    const response = data.response;
    if (!response?.family_groupid || !response?.family_group?.members) {
      throw new Error("没有家庭组");
    }

    const members = response.family_group.members;
    const names = await getUserNames(accessToken, members);
    return {
      family_groupid: response.family_groupid,
      family_name: response.family_group.name || "未命名",
      family_member: members.map(member => ({
        ...member,
        userName: names[member.steamid] || member.steamid
      })),
      steamIdtoName: names
    };
  }

  async function getFamilyGameList(accessToken, familyGroupId) {
    const url = `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?access_token=${encodeURIComponent(accessToken)}&family_groupid=${encodeURIComponent(familyGroupId)}&include_own=true&include_excluded=false&include_non_games=false`;
    const data = await requestJson(url);
    setRawData("sharedLibraryApps", data);
    const apps = data.response?.apps;
    if (!Array.isArray(apps)) {
      throw new Error("家庭库为空");
    }

    const appidSet = [];
    const appInfoById = {};
    apps.forEach(app => {
      if (app.exclude_reason !== 0) {
        return;
      }
      const appid = String(app.appid);
      appidSet.push(appid);
      appInfoById[appid] = {
        appid,
        name: app.name || `App ${appid}`,
        owners: Array.isArray(app.owner_steamids) ? app.owner_steamids.map(String) : [],
        time: Number(app.rt_time_acquired || 0),
        icon_hash: app.img_icon_hash || ""
      };
    });

    return {
      appidSet,
      appInfoById,
      updatedAt: Date.now()
    };
  }

  async function getUserNames(accessToken, members) {
    if (!members.length) {
      return {};
    }

    const params = members
      .map((member, index) => `steamids[${index}]=${encodeURIComponent(member.steamid)}`)
      .join("&");
    const url = `https://api.steampowered.com/IPlayerService/GetPlayerLinkDetails/v1/?access_token=${encodeURIComponent(accessToken)}&${params}`;
    const data = await requestJson(url);
    setRawData("playerLinkDetails", data);
    const names = {};
    const accounts = data.response?.accounts || [];
    accounts.forEach(account => {
      const publicData = account.public_data || {};
      if (publicData.steamid) {
        names[String(publicData.steamid)] = publicData.persona_name || String(publicData.steamid);
      }
    });
    return names;
  }

  async function getTargetProfile(rawInput) {
    const parsed = parseTargetInput(rawInput);
    const identity = parsed.steamid64
      ? { steamid64: parsed.steamid64, profileUrl: `https://steamcommunity.com/profiles/${parsed.steamid64}` }
      : await resolveVanity(parsed.vanity, state.apiKey);

    return fetchPublicGames(identity, state.apiKey);
  }

  function parseTargetInput(rawInput) {
    const input = rawInput.trim();
    if (/^\d{17}$/.test(input)) {
      return { steamid64: input };
    }

    try {
      const url = new URL(input);
      const profileMatch = url.pathname.match(/^\/profiles\/(\d{17})(?:\/|$)/);
      if (profileMatch) {
        return { steamid64: profileMatch[1] };
      }
      const vanityMatch = url.pathname.match(/^\/id\/([^/?#]+)(?:\/|$)/);
      if (vanityMatch) {
        return { vanity: decodeURIComponent(vanityMatch[1]) };
      }
    } catch (error) {
      // Plain vanity strings are handled below.
    }

    const vanity = input.replace(/^@/, "");
    if (/^[A-Za-z0-9_-]{2,64}$/.test(vanity)) {
      return { vanity };
    }

    throw new Error("账号格式不对");
  }

  async function resolveVanity(vanity, apiKey) {
    if (!vanity) {
      throw new Error("缺少自定义 ID");
    }

    if (!apiKey) {
      throw new Error("缺少 API Key");
    }

    return resolveVanityWithApiKey(vanity, apiKey);
  }

  async function resolveVanityWithApiKey(vanity, apiKey) {
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}&format=json`;
    const data = await requestJson(url);
    setRawData("resolveVanityUrl", data);
    const response = data.response || {};
    if (Number(response.success) !== 1 || !/^\d{17}$/.test(String(response.steamid || ""))) {
      const message = response.message ? `：${response.message}` : "";
      throw new Error(`无法解析自定义 ID${message}`);
    }

    return {
      steamid64: String(response.steamid),
      profileUrl: `https://steamcommunity.com/id/${encodeURIComponent(vanity)}`,
      displayName: vanity
    };
  }

  async function fetchPublicGames(identity, apiKey) {
    if (!apiKey) {
      throw new Error("缺少 API Key");
    }

    return fetchPublicGamesFromOwnedGames(identity, apiKey);
  }

  async function fetchPublicGamesFromOwnedGames(identity, apiKey) {
    const steamid64 = identity.steamid64;
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamid64)}&include_appinfo=1&include_played_free_games=1&format=json`;
    const [data, playerSummary] = await Promise.all([
      requestJson(url),
      fetchTargetPlayerSummary(steamid64, apiKey)
    ]);
    setRawData("ownedGames", data);
    const response = data.response || {};
    const rawGames = Array.isArray(response.games) ? response.games : [];
    if (rawGames.length === 0) {
      throw new Error("目标库不可见");
    }

    return {
      steamid64,
      profileUrl: playerSummary.profileUrl || identity.profileUrl || `https://steamcommunity.com/profiles/${steamid64}`,
      displayName: playerSummary.personaName || identity.displayName || steamid64,
      avatar: playerSummary.avatar || "",
      games: rawGames.map(game => ({
        appid: String(game.appid),
        name: game.name || `App ${game.appid}`,
        logo: game.img_icon_url || "",
        storeLink: `https://store.steampowered.com/app/${game.appid}/`
      })).filter(game => /^\d+$/.test(game.appid)),
      source: "webapi-ownedgames"
    };
  }

  async function fetchTargetPlayerSummary(steamid64, apiKey) {
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(steamid64)}&format=json`;
    const data = await requestJson(url);
    setRawData("targetPlayerSummaries", data);
    const player = data.response?.players?.[0];
    return {
      personaName: player?.personaname || "",
      avatar: player?.avatarfull || player?.avatarmedium || player?.avatar || "",
      profileUrl: player?.profileurl || ""
    };
  }

  async function filterShareableNewGames(games) {
    await enrichShareability(games);
    return games.filter(game => game.familySharingSupported);
  }

  function createShareabilityFilterState(analysisId = 0, processed = 0, pending = 0, total = 0) {
    return {
      analysisId,
      processed,
      pending,
      total,
      running: pending > 0
    };
  }

  function createShareabilityProgressUiState(analysisId = 0) {
    return {
      analysisId,
      timer: 0,
      dirty: false,
      lastRenderAt: Date.now()
    };
  }

  function scheduleShareabilityProgressRender(force = false) {
    if (!lastReport || !shareabilityFilterState.running || !shareabilityProgressUiState) {
      return;
    }
    if (shareabilityProgressUiState.analysisId !== shareabilityFilterState.analysisId) {
      return;
    }

    shareabilityProgressUiState.dirty = true;
    if (force) {
      flushShareabilityProgressRender();
      return;
    }

    if (shareabilityProgressUiState.timer) {
      return;
    }

    const elapsed = Date.now() - Number(shareabilityProgressUiState.lastRenderAt || 0);
    const delay = Math.max(0, 1000 - elapsed);
    shareabilityProgressUiState.timer = window.setTimeout(flushShareabilityProgressRender, delay);
  }

  function flushShareabilityProgressRender() {
    if (!shareabilityProgressUiState) {
      return;
    }
    if (shareabilityProgressUiState.analysisId !== shareabilityFilterState.analysisId) {
      return;
    }

    if (shareabilityProgressUiState.timer) {
      window.clearTimeout(shareabilityProgressUiState.timer);
      shareabilityProgressUiState.timer = 0;
    }

    if (!lastReport || !shareabilityProgressUiState.dirty) {
      return;
    }

    shareabilityProgressUiState.dirty = false;
    shareabilityProgressUiState.lastRenderAt = Date.now();
    refreshReportMetrics();
    renderSummary(lastReport);
    renderDetailsPreserveScroll();
    setStatus(`后台统计：${formatPercent(shareabilityFilterState.total ? shareabilityFilterState.processed / shareabilityFilterState.total : 0)}`, "warn");
  }

  async function startBackgroundShareabilityFilter(analysisId, games) {
    if (!lastReport || analysisId !== activeAnalysisId) {
      return;
    }
    if (!games.length) {
      shareabilityFilterState.running = false;
      setRawStep("done");
      setStatus("完成", "ok");
      return;
    }

    try {
      for (const game of games) {
        if (analysisId !== activeAnalysisId || !lastReport) {
          return;
        }

        const shareability = await getShareabilityForAppid(game.appid);
        if (analysisId !== activeAnalysisId || !lastReport) {
          return;
        }

        applyShareabilityResult(game, shareability);
        await sleep(0);
      }

      shareabilityFilterState.running = false;
      lastReport.filtering.running = false;
      setRawStep("done");
      shareabilityProgressUiState.dirty = true;
      flushShareabilityProgressRender();
      startLazyOriginalPriceLoading();
      setStatus(`统计完成：新增 ${lastReport.metrics.newCount} 款`, "ok");
    } catch (error) {
      shareabilityFilterState.running = false;
      if (lastReport?.filtering) {
        lastReport.filtering.running = false;
      }
      if (shareabilityProgressUiState?.timer) {
        window.clearTimeout(shareabilityProgressUiState.timer);
        shareabilityProgressUiState.timer = 0;
      }
      setRawError(error);
      setStatus(error.message, "err");
    }
  }

  async function getShareabilityForAppid(appid) {
    const key = String(appid);
    state.shareabilityCache = state.shareabilityCache || {};
    const cached = state.shareabilityCache[key];
    if (isFreshShareabilityCacheEntry(cached)) {
      return cached;
    }

    const shareability = await fetchShareability(key);
    state.shareabilityCache[key] = shareability;
    saveState();
    renderShareabilityCacheButton();
    return shareability;
  }

  function applyShareabilityResult(game, shareability) {
    const appid = String(game.appid);
    shareabilityFilterState.processed += 1;
    lastReport.filtering.processed = shareabilityFilterState.processed;
    lastReport.classificationById[appid] = {
      status: shareability?.supported ? "new" : "unsupported"
    };

    if (shareability?.supported) {
      const newGame = {
        ...game,
        familySharingSupported: true,
        price: null
      };
      prepareOriginalPriceForGame(newGame);
      lastReport.games.new.push(newGame);
      lastReport.games.new.sort(sortByName);
    } else {
      lastReport.metrics.filteredUnsupportedCount += 1;
    }

    refreshReportMetrics();
    scheduleShareabilityProgressRender();
    scheduleVisiblePriceLoads();
  }

  async function enrichShareability(games) {
    state.shareabilityCache = state.shareabilityCache || {};
    const appids = games.map(game => game.appid);
    const shareabilityById = {};
    const missing = [];
    let processed = 0;

    appids.forEach(appid => {
      const cached = state.shareabilityCache[String(appid)];
      if (isFreshShareabilityCacheEntry(cached)) {
        shareabilityById[String(appid)] = cached;
      } else {
        missing.push(String(appid));
      }
    });

    for (let index = 0; index < missing.length; index += SHAREABILITY_BATCH_SIZE) {
      const batch = missing.slice(index, index + SHAREABILITY_BATCH_SIZE);
      const entries = await Promise.all(batch.map(async appid => {
        return [appid, await fetchShareability(appid)];
      }));
      entries.forEach(([appid, shareability]) => {
        const key = String(appid);
        shareabilityById[key] = shareability;
        state.shareabilityCache[key] = shareability;
        processed += 1;
        setStatus(`统计：${processed}/${missing.length}`, "warn");
      });
      saveState();
      renderShareabilityCacheButton();
    }

    games.forEach(game => {
      const shareability = shareabilityById[String(game.appid)] || state.shareabilityCache[String(game.appid)];
      game.familySharingSupported = Boolean(shareability?.supported);
    });
  }

  async function fetchShareability(appid) {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=categories&l=${STORE_LANG}`;
    const data = await requestStoreJson(url, `shareability.${appid}`);
    setRawData(`shareability.${appid}`, data);
    const item = data?.[appid];
    const categories = item?.success && item.data && !Array.isArray(item.data)
      ? item.data.categories
      : [];

    return {
      supported: Array.isArray(categories) && categories.some(category => Number(category.id) === FAMILY_SHARING_CATEGORY_ID),
      updatedAt: Date.now()
    };
  }

  function compareLibraries(targetProfile) {
    const familySet = new Set(state.familyLibrary.appidSet.map(String));
    const targetMap = new Map();
    targetProfile.games.forEach(game => {
      targetMap.set(String(game.appid), game);
    });

    const newGames = [];
    const overlapGames = [];
    targetMap.forEach((game, appid) => {
      if (familySet.has(appid)) {
        const familyInfo = state.familyLibrary.appInfoById[appid] || {};
        overlapGames.push({
          ...game,
          familyName: familyInfo.name || game.name,
          owners: familyInfo.owners || []
        });
      } else {
        newGames.push({ ...game, price: null });
      }
    });

    return {
      newGames: newGames.sort(sortByName),
      overlapGames: overlapGames.sort(sortByName),
      familyOnlyCount: Math.max(0, familySet.size - overlapGames.length)
    };
  }

  function prepareOriginalPrices(games) {
    state.originalPriceCache = state.originalPriceCache || {};
    priceLoadState = createPriceLoadState();

    games.forEach(game => {
      prepareOriginalPriceForGame(game);
    });

    renderOriginalPriceCacheButton();
  }

  function prepareOriginalPriceForGame(game) {
    state.originalPriceCache = state.originalPriceCache || {};
    const appid = String(game.appid);
    const key = originalPriceCacheKey(appid);
    const cached = state.originalPriceCache[key];
    if (isFreshOriginalPriceCacheEntry(cached)) {
      applyOriginalPriceToGame(game, cached);
    } else {
      game.price = { pending: true };
      priceLoadState.pendingMap.set(appid, game);
    }
    renderOriginalPriceCacheButton();
  }

  function createPriceLoadState() {
    return {
      pendingMap: new Map(),
      loadingSet: new Set(),
      queuedSet: new Set(),
      queue: [],
      running: false,
      scheduled: 0
    };
  }

  function applyOriginalPriceToGame(game, price) {
    game.price = price || normalizeOriginalPrice(null);
    if (game.price.localizedName) {
      game.localizedName = game.price.localizedName;
    }
  }

  async function fetchOriginalPrice(appid) {
    const priceUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=basic,price_overview&cc=${STORE_CC}&l=${STORE_LANG}`;
    const priceData = await requestStoreJson(priceUrl, `prices.${appid}`);
    setRawData(`prices.${appid}`, priceData);
    return normalizeOriginalPrice(priceData?.[appid]);
  }

  function startLazyOriginalPriceLoading() {
    scheduleVisiblePriceLoads();
    if (!shareabilityFilterState.running) {
      scheduleBackgroundPriceLoads();
    }
  }

  function scheduleVisiblePriceLoads() {
    if (!lastReport || priceLoadState.pendingMap.size === 0) {
      return;
    }
    window.clearTimeout(priceLoadState.scheduled);
    priceLoadState.scheduled = window.setTimeout(() => {
      const visibleAppids = getVisiblePriceAppids();
      if (visibleAppids.length > 0) {
        enqueueOriginalPriceLoads(visibleAppids, true);
      }
      if (!shareabilityFilterState.running) {
        scheduleBackgroundPriceLoads();
      }
    }, 80);
  }

  function getVisiblePriceAppids() {
    const rows = Array.from(elements.tableWrap.querySelectorAll("[data-price-appid]"));
    if (!rows.length) {
      return [];
    }

    const wrapRect = elements.tableWrap.getBoundingClientRect();
    const visible = rows
      .filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.bottom >= wrapRect.top && rect.top <= wrapRect.bottom;
      })
      .map(row => row.dataset.priceAppid)
      .filter(appid => priceLoadState.pendingMap.has(String(appid)));

    return visible.length ? visible : rows.slice(0, 20).map(row => row.dataset.priceAppid);
  }

  function scheduleBackgroundPriceLoads() {
    if (!lastReport || priceLoadState.pendingMap.size === 0) {
      return;
    }
    enqueueOriginalPriceLoads(Array.from(priceLoadState.pendingMap.keys()), false);
  }

  function enqueueOriginalPriceLoads(appids, priority) {
    const ordered = [];
    appids.map(String).forEach(appid => {
      if (!priceLoadState.pendingMap.has(appid) || priceLoadState.loadingSet.has(appid)) {
        return;
      }
      ordered.push(appid);
    });

    if (priority) {
      const prioritySet = new Set(ordered);
      priceLoadState.queue = priceLoadState.queue.filter(item => !prioritySet.has(item));
      priceLoadState.queue = [...ordered, ...priceLoadState.queue];
      ordered.forEach(appid => priceLoadState.queuedSet.add(appid));
    } else {
      ordered.forEach(appid => {
        if (priceLoadState.queuedSet.has(appid)) {
          return;
        }
        priceLoadState.queue.push(appid);
        priceLoadState.queuedSet.add(appid);
      });
    }
    runOriginalPriceQueue();
  }

  async function runOriginalPriceQueue() {
    if (priceLoadState.running) {
      return;
    }
    priceLoadState.running = true;
    try {
      while (priceLoadState.queue.length > 0) {
        const appid = priceLoadState.queue.shift();
        priceLoadState.queuedSet.delete(appid);
        const game = priceLoadState.pendingMap.get(appid);
        if (!game) {
          continue;
        }

        priceLoadState.loadingSet.add(appid);
        try {
          const price = await fetchOriginalPrice(appid);
          state.originalPriceCache[originalPriceCacheKey(appid)] = price;
          applyOriginalPriceToGame(game, price);
          priceLoadState.pendingMap.delete(appid);
          saveState();
          refreshReportMetrics();
          renderSummary(lastReport);
          renderDetailsAfterPriceChange();
          renderOriginalPriceCacheButton();
        } catch (error) {
          game.price = { unavailable: true, updatedAt: Date.now() };
          priceLoadState.pendingMap.delete(appid);
          setRawError(error);
          refreshReportMetrics();
          renderSummary(lastReport);
          renderDetailsAfterPriceChange();
        } finally {
          priceLoadState.loadingSet.delete(appid);
        }
      }
    } finally {
      priceLoadState.running = false;
      if (priceLoadState.pendingMap.size > 0 && !shareabilityFilterState.running) {
        scheduleBackgroundPriceLoads();
      }
    }
  }

  function renderDetailsPreserveScroll() {
    const scrollTop = elements.tableWrap.scrollTop;
    renderDetails();
    elements.tableWrap.scrollTop = scrollTop;
  }

  function renderDetailsAfterShareabilityChange(appid) {
    if (currentTab === "all") {
      const cell = elements.tableWrap.querySelector(`[data-status-appid="${String(appid)}"]`);
      if (cell) {
        cell.innerHTML = getGameListStatusHtml(appid);
      }
      return;
    }
    renderDetailsPreserveScroll();
  }

  function renderDetailsAfterPriceChange() {
    if (currentTab === "new" || currentTab === "search") {
      renderDetailsPreserveScroll();
    }
  }

  function refreshReportMetrics() {
    if (!lastReport) {
      return;
    }
    const newGames = lastReport.games.new || [];
    const pricedGames = newGames.filter(game => game.price && !game.price.pending && !game.price.unavailable);
    const unpricedGames = newGames.filter(game => game.price?.unavailable);
    lastReport.metrics.newCount = newGames.length;
    lastReport.metrics.initialValue = pricedGames.reduce((sum, game) => sum + Number(game.price?.initial || 0), 0);
    lastReport.metrics.unpricedCount = unpricedGames.length;
    lastReport.metrics.filteringProcessed = lastReport.filtering?.processed || 0;
    lastReport.metrics.filteringTotal = lastReport.filtering?.total || 0;
    lastReport.games.unpriced = unpricedGames;
  }

  function hasPriceOverview(item) {
    return Boolean(item?.success && item.data && !Array.isArray(item.data) && item.data.price_overview);
  }

  function normalizeOriginalPrice(item) {
    const now = Date.now();
    const data = item?.success && item.data && !Array.isArray(item.data) ? item.data : null;
    const localizedName = data?.name || "";
    if (hasPriceOverview(item)) {
      const priceOverview = item.data.price_overview;
      return {
        initial: Number(priceOverview.initial ?? priceOverview.final ?? 0),
        currency: priceOverview.currency || "CNY",
        localizedName,
        isFree: false,
        unavailable: false,
        updatedAt: now
      };
    }

    if (data?.is_free === true) {
      return {
        initial: 0,
        currency: "CNY",
        localizedName,
        isFree: true,
        unavailable: false,
        updatedAt: now
      };
    }

    return {
      initial: null,
      currency: "CNY",
      localizedName,
      isFree: false,
      unavailable: true,
      updatedAt: now
    };
  }

  function buildReport(targetProfile, comparison) {
    const newGames = comparison.newGames;
    const allGames = (comparison.allGames || targetProfile.games || []).slice().sort(sortByName);
    const pendingNewGames = comparison.pendingNewGames || [];
    const unpricedGames = newGames.filter(game => game.price?.unavailable);
    const pricedGames = newGames.filter(game => game.price && !game.price.pending && !game.price.unavailable);
    const initialValue = pricedGames.reduce((sum, game) => sum + Number(game.price?.initial || 0), 0);
    const targetCount = allGames.length;
    const rawTargetCount = targetProfile.rawGameCount || targetCount;
    const familyCount = state.familyLibrary.appidSet.length;
    const overlapCount = comparison.overlapGames.length;
    const classificationById = {};

    pendingNewGames.forEach(game => {
      classificationById[String(game.appid)] = { status: "pending" };
    });
    comparison.overlapGames.forEach(game => {
      classificationById[String(game.appid)] = { status: "overlap" };
    });
    newGames.forEach(game => {
      classificationById[String(game.appid)] = { status: "new" };
    });

    return {
      target: {
        steamid64: targetProfile.steamid64,
        displayName: targetProfile.displayName,
        profileUrl: targetProfile.profileUrl,
        avatar: targetProfile.avatar || ""
      },
      metrics: {
        targetCount,
        rawTargetCount,
        filteredUnsupportedCount: targetProfile.filteredUnsupportedCount || 0,
        familyCount,
        newCount: newGames.length,
        overlapCount,
        overlapRate: familyCount > 0 ? overlapCount / familyCount : 0,
        familyOnlyCount: comparison.familyOnlyCount,
        initialValue,
        unpricedCount: unpricedGames.length,
        filteringProcessed: overlapCount,
        filteringTotal: targetCount
      },
      games: {
        all: allGames,
        new: newGames,
        overlap: comparison.overlapGames,
        unpriced: unpricedGames
      },
      classificationById,
      filtering: {
        processed: overlapCount,
        total: targetCount,
        running: pendingNewGames.length > 0
      },
      generatedAt: Date.now()
    };
  }

  function ensureFamilyReady() {
    const session = getSteamSession();
    if (!session.isLoggedIn) {
      throw new Error("请先登录");
    }
    if (state.activeSteamId && session.steamid && state.activeSteamId !== session.steamid) {
      throw new Error("账号已切换，请刷新");
    }
    if (!state.familyInfo?.family_groupid || state.familyLibrary.appidSet.length === 0) {
      throw new Error("请先刷新");
    }
    return session;
  }

  function renderFamilyMeta() {
    const count = state.familyLibrary.appidSet.length;
    const name = state.familyInfo?.family_name || "未刷新";
    const time = state.familyLibrary.updatedAt ? formatDateTime(state.familyLibrary.updatedAt) : "无缓存";
    elements.familyMeta.textContent = `${name} · ${count} 款 · ${time}`;
  }

  function renderSummary(report) {
    const metrics = report?.metrics || {
      targetCount: 0,
      rawTargetCount: 0,
      filteredUnsupportedCount: 0,
      familyCount: state.familyLibrary.appidSet.length,
      newCount: 0,
      overlapCount: 0,
      overlapRate: 0,
      initialValue: 0,
      unpricedCount: 0,
      filteringProcessed: 0,
      filteringTotal: 0
    };

    const targetLabel = report?.target?.displayName || "未分析";
    const filterValue = metrics.filteringTotal
      ? `${metrics.filteringProcessed || 0}/${metrics.filteringTotal}`
      : "0/0";
    elements.summary.innerHTML = [
      metricHtml("目标账号", escapeHtml(targetLabel)),
      metricHtml("统计进度", filterValue),
      metricHtml("家庭库", `${metrics.familyCount}`),
      metricHtml("总游戏", `${metrics.targetCount}`),
      metricHtml("新增", `${metrics.newCount}`),
      metricHtml("新增价值", formatCny(metrics.initialValue)),
      metricHtml("重复", `${metrics.overlapCount}`),
      metricHtml("重复率", formatPercent(metrics.overlapRate))
    ].join("");
  }

  function renderTargetProfile(report) {
    if (!report) {
      elements.profile.innerHTML = `<div class="sffa-empty">暂无账号</div>`;
      return;
    }

    const target = report.target || {};
    const avatar = target.avatar
      ? `<img class="sffa-avatar" src="${escapeAttr(target.avatar)}" alt="">`
      : `<div class="sffa-avatar"></div>`;
    elements.profile.innerHTML = `
      <div class="sffa-profile-head">
        ${avatar}
        <div>
          <div class="sffa-profile-name">${escapeHtml(target.displayName || target.steamid64 || "未知账号")}</div>
          <a class="sffa-profile-link" href="${escapeAttr(target.profileUrl || "#")}" target="_blank" rel="noopener">打开主页</a>
        </div>
      </div>
      <div class="sffa-profile-row"><span>SteamID</span><span>${escapeHtml(target.steamid64 || "-")}</span></div>
      <div class="sffa-profile-row"><span>时间</span><span>${formatDateTime(report.generatedAt)}</span></div>
      <div class="sffa-profile-row"><span>链接</span><span>${escapeHtml(target.profileUrl || "-")}</span></div>
    `;
  }

  function renderAutoFamilyRefreshButton() {
    if (!elements.autoFamilyRefreshBtn) {
      return;
    }
    const enabled = Boolean(state.autoFamilyRefreshEnabled);
    const lastTime = state.familyLibrary?.updatedAt ? formatDateTime(state.familyLibrary.updatedAt) : "无缓存";
    elements.autoFamilyRefreshBtn.textContent = `${enabled ? "关闭" : "开启"}自动刷新`;
    elements.autoFamilyRefreshBtn.title = `每 24 小时刷新上次：${lastTime}`;
  }

  function metricHtml(label, value) {
    return `<div class="sffa-metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function renderTabs() {
    elements.tabs.forEach(tab => {
      tab.classList.toggle("active", tab.dataset.tab === currentTab);
    });
    elements.searchInput.classList.toggle("is-visible", currentTab === "search");
    if (currentTab === "search") {
      window.setTimeout(() => elements.searchInput.focus(), 0);
    }
  }

  function buildCurrentListCopyTable(rows) {
    if (currentTab === "family") {
      return {
        headers: ["AppID", "游戏", "贡献者", "入库时间"],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOwners(game.owners || []) || "-",
          formatFamilyAcquireTime(game.time)
        ])
      };
    }
    if (currentTab === "new") {
      return {
        headers: ["AppID", "游戏", "原价"],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOriginalPriceText(game.price || {})
        ])
      };
    }
    if (currentTab === "overlap") {
      return {
        headers: ["AppID", "游戏", "贡献者"],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          formatOwners(game.owners || []) || "-"
        ])
      };
    }
    if (currentTab === "search") {
      return {
        headers: ["AppID", "游戏", "列表", "信息"],
        rows: rows.map(game => [
          game.appid,
          getGameDisplayName(game),
          game.listType || "",
          getSearchInfoText(game)
        ])
      };
    }
    return {
      headers: ["AppID", "游戏", "状态"],
      rows: rows.map(game => [
        game.appid,
        getGameDisplayName(game),
        getGameListLabel(game.appid)
      ])
    };
  }

  function handleTableHeaderClick(event) {
    const header = event.target.closest("[data-sort-key]");
    if (!header || !elements.tableWrap.contains(header)) {
      return;
    }

    const key = header.dataset.sortKey;
    const current = tableSortByTab[currentTab];
    tableSortByTab[currentTab] = {
      key,
      direction: current?.key === key && current.direction === "asc" ? "desc" : "asc"
    };
    renderDetailsPreserveScroll();
  }

  function renderDetails() {
    if (currentTab === "family") {
      const rows = getSortedRows("family", getFamilyLibraryRows());
      if (rows.length === 0) {
        elements.tableWrap.innerHTML = `<div class="sffa-empty">请先刷新家庭库</div>`;
        return;
      }
      elements.tableWrap.innerHTML = buildFamilyLibraryTable(rows);
      return;
    }

    if (!lastReport) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">输入账号后分析</div>`;
      return;
    }

    if (currentTab === "search") {
      renderSearchDetails();
      return;
    }

    const rows = getSortedRows(currentTab, lastReport.games[currentTab] || []);
    if (rows.length === 0) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">${getTabLabel(currentTab)}为空</div>`;
      return;
    }

    elements.tableWrap.innerHTML = buildDetailsTable(currentTab, rows);
    scheduleVisiblePriceLoads();
  }

  function buildDetailsTable(tab, rows) {
    if (tab === "all") {
      return buildAllGamesTable(rows);
    }
    if (tab === "family") {
      return buildFamilyLibraryTable(rows);
    }
    if (tab === "overlap") {
      return buildOverlapTable(rows);
    }
    return buildNewGamesTable(rows);
  }

  function getSortedRows(tab, rows) {
    const sort = tableSortByTab[tab];
    const output = rows.slice();
    if (!sort?.key) {
      return output;
    }

    const direction = sort.direction === "desc" ? -1 : 1;
    output.sort((left, right) => compareSortValues(left, right, sort.key) * direction);
    return output;
  }

  function compareSortValues(left, right, key) {
    const leftValue = getSortValue(left, key);
    const rightValue = getSortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      const diff = leftValue - rightValue;
      return diff === 0 ? sortByName(left, right) : diff;
    }
    const result = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base"
    });
    return result === 0 ? sortByName(left, right) : result;
  }

  function getSortValue(game, key) {
    switch (key) {
      case "appid":
        return Number(game.appid || 0);
      case "name":
        return getGameDisplayName(game);
      case "status":
        return getGameListLabel(game.appid);
      case "owners":
        return formatOwners(game.owners || []);
      case "time":
        return Number(game.time || 0);
      case "price":
        return getOriginalPriceSortValue(game.price || {});
      case "listType":
        return game.listType || "";
      case "info":
        return getSearchSortInfo(game);
      default:
        return "";
    }
  }

  function getOriginalPriceSortValue(price) {
    if (price?.pending) {
      return Number.POSITIVE_INFINITY;
    }
    if (price?.unavailable) {
      return Number.NEGATIVE_INFINITY;
    }
    if (price?.initial == null) {
      return Number.POSITIVE_INFINITY;
    }
    return Number(price.initial || 0);
  }

  function getSearchSortInfo(game) {
    if (game.listType === "重复") {
      return formatOwners(game.owners || []);
    }
    if (game.listType === "新增") {
      return getOriginalPriceSortValue(game.price || {});
    }
    return getGameListLabel(game.appid);
  }

  function renderSearchDetails() {
    const rows = getSearchFilteredRows();
    if (!rows) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">输入关键词搜索</div>`;
      return;
    }

    if (rows.length === 0) {
      elements.tableWrap.innerHTML = `<div class="sffa-empty">没有匹配游戏</div>`;
      return;
    }

    elements.tableWrap.innerHTML = buildSearchTable(getSortedRows("search", rows));
  }

  function getSearchRows() {
    const rowsById = new Map();
    (lastReport.games.all || []).forEach(game => {
      rowsById.set(String(game.appid), {
        ...game,
        listType: getGameListLabel(game.appid)
      });
    });
    (lastReport.games.new || []).forEach(game => {
      rowsById.set(String(game.appid), {
        ...game,
        listType: "新增"
      });
    });
    (lastReport.games.overlap || []).forEach(game => {
      const appid = String(game.appid);
      rowsById.set(appid, {
        ...game,
        listType: "重复"
      });
    });
    return Array.from(rowsById.values()).sort(sortByName);
  }

  function getSearchFilteredRows() {
    const query = elements.searchInput.value.trim().toLowerCase();
    if (!query) {
      return null;
    }

    return getSearchRows().filter(game => {
      const name = String(getGameDisplayName(game)).toLowerCase();
      const appid = String(game.appid || "");
      return name.includes(query) || appid.includes(query);
    });
  }

  function getCurrentListRows() {
    if (currentTab === "family") {
      return getSortedRows("family", getFamilyLibraryRows());
    }
    if (!lastReport) {
      return [];
    }
    if (currentTab === "search") {
      return getSortedRows("search", getSearchFilteredRows() || []);
    }
    return getSortedRows(currentTab, lastReport.games[currentTab] || []);
  }

  function getFamilyLibraryRows() {
    return (state.familyLibrary?.appidSet || [])
      .map(appid => state.familyLibrary?.appInfoById?.[String(appid)])
      .filter(Boolean)
      .sort(sortFamilyLibraryRows);
  }

  function buildAllGamesTable(rows) {
    const body = rows.map(game => `
      <tr>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td data-status-appid="${escapeAttr(game.appid)}">${getGameListStatusHtml(game.appid)}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh("游戏", "name")}
        ${sortableTh("状态", "status", "width: 110px;")}
      </tr>
    `, body);
  }

  function buildFamilyLibraryTable(rows) {
    const body = rows.map(game => `
      <tr>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${escapeHtml(formatOwners(game.owners || []) || "-")}</td>
        <td>${escapeHtml(formatFamilyAcquireTime(game.time))}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh("游戏", "name")}
        ${sortableTh("贡献者", "owners", "width: 160px;")}
        ${sortableTh("入库时间", "time", "width: 130px;")}
      </tr>
    `, body);
  }

  function buildNewGamesTable(rows) {
    const body = rows.map(game => `
      <tr data-price-appid="${escapeAttr(game.appid)}">
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${formatOriginalPriceCell(game.price || {})}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh("游戏", "name")}
        ${sortableTh("原价", "price", "width: 110px;")}
      </tr>
    `, body);
  }

  function buildOverlapTable(rows) {
    const body = rows.map(game => `
      <tr>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${escapeHtml(formatOwners(game.owners || []))}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh("游戏", "name", "width: calc((100% - 82px) / 2);")}
        ${sortableTh("贡献者", "owners", "width: calc((100% - 82px) / 2);")}
      </tr>
    `, body);
  }

  function buildSearchTable(rows) {
    const body = rows.map(game => `
      <tr ${game.listType === "新增" ? `data-price-appid="${escapeAttr(game.appid)}"` : ""}>
        <td><a href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener">${escapeHtml(game.appid)}</a></td>
        <td>${escapeHtml(getGameDisplayName(game))}</td>
        <td>${escapeHtml(game.listType || "")}</td>
        <td>${getSearchInfoHtml(game)}</td>
      </tr>
    `).join("");

    return tableHtml(`
      <tr>
        ${sortableTh("AppID", "appid", "width: 82px;")}
        ${sortableTh("游戏", "name")}
        ${sortableTh("列表", "listType", "width: 120px;")}
        ${sortableTh("信息", "info", "width: 170px;")}
      </tr>
    `, body);
  }

  function getSearchInfoHtml(game) {
    if (game.listType === "重复") {
      return escapeHtml(formatOwners(game.owners || []) || "-");
    }
    if (game.listType !== "新增") {
      return getGameListStatusHtml(game.appid);
    }
    return formatOriginalPriceCell(game.price || {});
  }

  function getSearchInfoText(game) {
    if (game.listType === "重复") {
      return formatOwners(game.owners || []) || "-";
    }
    if (game.listType !== "新增") {
      return getGameListLabel(game.appid);
    }
    return formatOriginalPriceText(game.price || {});
  }

  function getGameListLabel(appid) {
    const status = lastReport?.classificationById?.[String(appid)]?.status;
    return {
      new: "新增",
      overlap: "重复",
      unsupported: "不可共享",
      pending: "统计中"
    }[status] || "-";
  }

  function getGameListStatusHtml(appid) {
    const status = lastReport?.classificationById?.[String(appid)]?.status;
    if (status === "pending") {
      return `<span class="sffa-status-inline"><span class="sffa-spinner" title="统计中"></span>统计中</span>`;
    }
    return escapeHtml(getGameListLabel(appid));
  }

  function getGameDisplayName(game) {
    const originalName = game.name || game.familyName || `App ${game.appid}`;
    const localizedName = game.localizedName || game.price?.localizedName || "";
    if (!localizedName || normalizeGameName(localizedName) === normalizeGameName(originalName)) {
      return originalName;
    }
    return `${localizedName} (${originalName})`;
  }

  function normalizeGameName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[\s™®©:：\-–—_'".,，()[\]（）【】]/g, "");
  }

  function tableHtml(header, body) {
    return `
      <table class="sffa-table">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  function sortableTh(label, key, style = "") {
    const sort = tableSortByTab[currentTab];
    const indicator = sort?.key === key ? (sort.direction === "desc" ? "▼" : "▲") : "";
    return `<th data-sort-key="${escapeAttr(key)}"${style ? ` style="${escapeAttr(style)}"` : ""}>${escapeHtml(label)}<span class="sffa-sort-indicator">${indicator}</span></th>`;
  }

  function renderShareabilityCacheButton() {
    if (!elements.clearShareabilityBtn) {
      return;
    }
    const count = getShareabilityCacheCount();
    elements.clearShareabilityBtn.hidden = count === 0;
    elements.clearShareabilityBtn.textContent = `清除共享缓存（${count}）`;
  }

  function renderOriginalPriceCacheButton() {
    if (!elements.clearPriceBtn) {
      return;
    }
    const count = getOriginalPriceCacheCount();
    elements.clearPriceBtn.hidden = count === 0;
    elements.clearPriceBtn.textContent = `清除价格缓存（${count}）`;
  }

  function setStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `sffa-status ${type || ""}`.trim();
  }

  async function autoReadApiKeyFromCommunity(options = {}) {
    const keepBusy = Boolean(options.keepBusy);
    try {
      if (!keepBusy) {
        setBusy(true);
      }
      const apiKey = await fetchExistingSteamApiKey();
      state.apiKey = apiKey;
      saveState();
      return apiKey;
    } catch (error) {
      state.apiKey = "";
      saveState();
      throw error;
    } finally {
      if (!keepBusy) {
        setBusy(false);
      }
    }
  }

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
    lastRawData = createRawDataSnapshot(action);
  }

  function setRawData(path, value) {
    const parts = String(path || "").split(".").filter(Boolean);
    if (!parts.length) {
      return;
    }

    let cursor = lastRawData;
    parts.slice(0, -1).forEach(part => {
      if (!cursor[part] || typeof cursor[part] !== "object") {
        cursor[part] = {};
      }
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  }

  function setRawStep(step) {
    lastRawData.meta.currentStep = step;
    lastRawData.meta.updatedAt = new Date().toISOString();
  }

  function setRawError(error) {
    lastRawData.meta.error = {
      message: error?.message || String(error || "未知错误")
    };
    lastRawData.meta.updatedAt = new Date().toISOString();
  }

  function setBusy(isBusy) {
    if (isBusy) {
      closeMenu();
    }
    [elements.refreshBtn, elements.analyzeBtn, elements.moreBtn, elements.autoFamilyRefreshBtn, elements.copyBtn, elements.copyCurrentBtn, elements.clearShareabilityBtn, elements.clearPriceBtn, elements.rawBtn].forEach(button => {
      if (!button) {
        return;
      }
      button.disabled = Boolean(isBusy);
    });
  }

  function loadState() {
    try {
      const saved = GM_getValue(STORAGE_KEY);
      if (!saved || saved.version !== DEFAULT_STATE.version) {
        return cloneDefaultState();
      }
      return {
        ...cloneDefaultState(),
        ...saved,
        familyLibrary: {
          ...cloneDefaultState().familyLibrary,
          ...(saved.familyLibrary || {})
        },
        shareabilityCache: saved.shareabilityCache || {},
        originalPriceCache: saved.originalPriceCache || {},
        launcherVisible: saved.launcherVisible !== false,
        autoFamilyRefreshEnabled: saved.autoFamilyRefreshEnabled !== false,
        lastAutoFamilyRefreshAttemptAt: Number(saved.lastAutoFamilyRefreshAttemptAt || 0)
      };
    } catch (error) {
      return cloneDefaultState();
    }
  }

  function saveState() {
    GM_setValue(STORAGE_KEY, state);
  }

  function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function isFreshShareabilityCacheEntry(entry) {
    return Boolean(
      entry &&
      typeof entry.supported === "boolean" &&
      Date.now() - Number(entry.updatedAt || 0) < SHAREABILITY_CACHE_TTL_MS
    );
  }

  function getShareabilityCacheCount() {
    return Object.keys(state.shareabilityCache || {}).length;
  }

  function originalPriceCacheKey(appid) {
    return `${STORE_CC}:${appid}`;
  }

  function isFreshOriginalPriceCacheEntry(entry) {
    return Boolean(
      entry &&
      (typeof entry.initial === "number" || entry.unavailable === true) &&
      Object.prototype.hasOwnProperty.call(entry, "localizedName") &&
      Date.now() - Number(entry.updatedAt || 0) < ORIGINAL_PRICE_CACHE_TTL_MS
    );
  }

  function getOriginalPriceCacheCount() {
    return Object.keys(state.originalPriceCache || {}).length;
  }

  function requestJson(url) {
    return request(url, "json");
  }

  function requestStoreJson(url, rawDataPath) {
    const run = () => requestStoreJsonWithRetry(url, rawDataPath);
    storeRequestQueue = storeRequestQueue.then(run, run);
    return storeRequestQueue;
  }

  async function requestStoreJsonWithRetry(url, rawDataPath) {
    let lastError = null;
    for (let attempt = 0; attempt <= STORE_REQUEST_RETRY_COUNT; attempt++) {
      if (attempt > 0) {
        const delay = STORE_REQUEST_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        setRawData(`${rawDataPath}.retry${attempt}`, {
          reason: "HTTP 429",
          delayMs: delay
        });
        await sleep(delay);
      } else {
        await sleep(STORE_REQUEST_DELAY_MS);
      }

      try {
        return await requestJson(url);
      } catch (error) {
        lastError = error;
        if (!isHttp429(error)) {
          throw error;
        }
      }
    }

    throw new Error(`请求过快，请稍后再试`);
  }

  function requestText(url) {
    return request(url, "text");
  }

  function request(url, responseType) {
    return new Promise((resolve, reject) => {
      const endpoint = describeRequestEndpoint(url);
      GM_xmlhttpRequest({
        method: "GET",
        url,
        anonymous: false,
        withCredentials: true,
        headers: {
          "Accept": responseType === "json" ? "application/json,text/javascript,*/*;q=0.1" : "application/xml,text/xml,text/html,*/*;q=0.1"
        },
        responseType: responseType === "json" ? "json" : "text",
        timeout: 30000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            setRawData(`requestFailures.${endpoint}`, {
              status: response.status,
              responseText: String(response.responseText || "").slice(0, 1000)
            });
            reject(createHttpError(response.status, `HTTP ${response.status}`));
            return;
          }
          if (responseType === "json") {
            if (response.response && typeof response.response === "object") {
              resolve(response.response);
              return;
            }
            try {
              resolve(JSON.parse(response.responseText));
            } catch (error) {
              setRawData(`requestFailures.${endpoint}`, {
                status: response.status,
                message: "JSON 无法解析",
                responseText: String(response.responseText || "").slice(0, 1000)
              });
              reject(new Error("JSON 无法解析"));
            }
          } else {
            resolve(response.responseText || String(response.response || ""));
          }
        },
        onerror() {
          setRawData(`requestFailures.${endpoint}`, {
            message: "网络失败"
          });
          reject(new Error("网络失败"));
        },
        ontimeout() {
          setRawData(`requestFailures.${endpoint}`, {
            message: "请求超时"
          });
          reject(new Error("请求超时"));
        }
      });
    });
  }

  function describeRequestEndpoint(url) {
    try {
      const parsed = new URL(url);
      const interfaceName = parsed.pathname.split("/").filter(Boolean)[0] || parsed.hostname;
      const methodName = parsed.pathname.split("/").filter(Boolean)[1] || "request";
      return `${parsed.hostname}.${interfaceName}.${methodName}`.replace(/[^\w.-]/g, "_");
    } catch (error) {
      return "unknown";
    }
  }

  function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function isHttp429(error) {
    return Number(error?.status) === 429 || /HTTP\s*429/i.test(String(error?.message || ""));
  }

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }


  function decodeHtml(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(value || "");
    return textarea.value;
  }

  function readJsonAttribute(node, attrName) {
    try {
      const value = node.getAttribute(attrName);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function sortByName(left, right) {
    return String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN");
  }

  function formatOwners(owners) {
    if (!owners.length) {
      return "";
    }
    return owners
      .map(steamid => state.familyInfo?.steamIdtoName?.[steamid] || steamid)
      .join("、");
  }

  function formatOriginalPriceCell(price) {
    if (price?.pending) {
      return `<span class="sffa-spinner" title="加载中"></span>`;
    }
    if (!price || (price.initial == null && !price.unavailable && !price.isFree)) {
      return "-";
    }
    if (price.unavailable) {
      return "N/A";
    }
    return formatCny(Number(price.initial || 0));
  }

  function formatOriginalPriceText(price) {
    if (price?.pending) {
      return "加载中";
    }
    if (!price || (price.initial == null && !price.unavailable && !price.isFree)) {
      return "-";
    }
    if (price.unavailable) {
      return "N/A";
    }
    return formatCny(Number(price.initial || 0));
  }

  function normalizeCopyCell(value) {
    return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
  }

  function formatCny(cents) {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY"
    }).format(Number(cents || 0) / 100);
  }

  function formatPercent(value) {
    return `${Math.round(Number(value || 0) * 1000) / 10}%`;
  }

  function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString("zh-CN", {
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatFamilyAcquireTime(timestamp) {
    const seconds = Number(timestamp || 0);
    if (!seconds) {
      return "-";
    }
    return new Date(seconds * 1000).toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function sortFamilyLibraryRows(left, right) {
    const timeDiff = Number(right.time || 0) - Number(left.time || 0);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return sortByName(left, right);
  }

  function getTabLabel(tab) {
    return {
      all: "全部",
      family: "家庭库",
      new: "新增",
      overlap: "重复",
      search: "搜索"
    }[tab] || "明细";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();
