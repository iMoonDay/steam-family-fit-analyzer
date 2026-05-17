"use strict";

globalThis.SFFA_CREATE_HISTORY_STORE = function createHistoryStore(dependencies) {
  const {
    closeAnalysisHistoryMenu,
    escapeAttr,
    escapeHtml,
    getElements,
    getTargetProfileDisplayName,
    keys,
    sffaExtensionDeleteValue,
    sffaExtensionGetValue,
    sffaExtensionSetValue
  } = dependencies;
  let analysisInputHistoryCache = null;

function loadAnalysisInputHistory() {
  if (analysisInputHistoryCache) {
    return analysisInputHistoryCache;
  }

  try {
    const saved = sffaExtensionGetValue(keys.ANALYSIS_INPUT_HISTORY_KEY);
    analysisInputHistoryCache = normalizeAnalysisInputHistory(saved);
  } catch (error) {
    analysisInputHistoryCache = createEmptyAnalysisInputHistory();
  }
  return analysisInputHistoryCache;
}

function createEmptyAnalysisInputHistory() {
  return {
    version: 1,
    updatedAt: 0,
    lastInputValue: "",
    entries: [],
    accountNameCache: {}
  };
}

function normalizeAnalysisInputHistory(saved) {
  const empty = createEmptyAnalysisInputHistory();
  if (!saved || saved.version !== 1) {
    return empty;
  }

  const accountNameCache = {};
  Object.entries(saved.accountNameCache || {}).forEach(([steamid64, name]) => {
    if (/^\d{17}$/.test(String(steamid64)) && String(name || "").trim()) {
      accountNameCache[String(steamid64)] = String(name).trim();
    }
  });

  const entries = Array.isArray(saved.entries)
    ? saved.entries.map(normalizeAnalysisInputHistoryEntry).filter(Boolean).slice(0, keys.MAX_ANALYSIS_HISTORY_ITEMS)
    : [];
  entries.forEach(entry => {
    entry.targets.forEach(target => {
      if (accountNameCache[target.steamid64]) {
        target.displayName = accountNameCache[target.steamid64];
      }
    });
    if (!entry.displayName && entry.targets.length) {
      entry.displayName = entry.targets.map(target => target.displayName || target.steamid64).join(" + ");
    }
  });

  return {
    ...empty,
    updatedAt: Number(saved.updatedAt || 0),
    lastInputValue: String(saved.lastInputValue || "").trim(),
    entries,
    accountNameCache
  };
}

function normalizeAnalysisInputHistoryEntry(entry) {
  const inputValue = String(entry?.inputValue || "").trim();
  if (!inputValue) {
    return null;
  }

  const targets = Array.isArray(entry.targets)
    ? entry.targets.map(normalizeAnalysisInputHistoryTarget).filter(Boolean)
    : [];

  return {
    inputValue,
    displayName: String(entry.displayName || "").trim(),
    targets,
    updatedAt: Number(entry.updatedAt || 0)
  };
}

function normalizeAnalysisInputHistoryTarget(target) {
  const steamid64 = String(target?.steamid64 || "");
  const displayName = String(target?.displayName || "").trim();
  if (!/^\d{17}$/.test(steamid64)) {
    return null;
  }
  return {
    steamid64,
    displayName: displayName || steamid64
  };
}

function rememberAnalysisInput(inputValue, targetProfile, shouldRender = true) {
  const normalizedInput = String(inputValue || "").trim();
  if (!normalizedInput) {
    return;
  }

  const saved = loadAnalysisInputHistory();
  const targets = extractAnalysisHistoryTargets(targetProfile);
  const displayName = getAnalysisHistoryDisplayName(targetProfile, targets);
  targets.forEach(target => {
    saved.accountNameCache[target.steamid64] = target.displayName;
  });

  const entry = {
    inputValue: normalizedInput,
    displayName,
    targets,
    updatedAt: Date.now()
  };
  saved.entries = [
    entry,
    ...saved.entries.filter(item => item.inputValue !== normalizedInput)
  ].slice(0, keys.MAX_ANALYSIS_HISTORY_ITEMS);
  saved.lastInputValue = normalizedInput;
  saved.updatedAt = entry.updatedAt;
  saveAnalysisInputHistory(saved);

  if (shouldRender) {
    renderAnalysisHistoryMenu(saved);
  }
}

function extractAnalysisHistoryTargets(targetProfile) {
  const targets = Array.isArray(targetProfile?.targets) && targetProfile.targets.length
    ? targetProfile.targets
    : [targetProfile].filter(Boolean);
  return targets
    .map(target => normalizeAnalysisInputHistoryTarget(target))
    .filter(Boolean);
}

function getAnalysisHistoryDisplayName(targetProfile, targets) {
  const displayName = String(targetProfile?.displayName || "").trim();
  if (displayName) {
    return displayName;
  }
  if (targets.length) {
    return targets.map(target => target.displayName || target.steamid64).join(" + ");
  }
  return "";
}

function saveAnalysisInputHistory(history) {
  analysisInputHistoryCache = normalizeAnalysisInputHistory(history);
  sffaExtensionSetValue(keys.ANALYSIS_INPUT_HISTORY_KEY, {
    version: 1,
    updatedAt: Number(analysisInputHistoryCache.updatedAt || Date.now()),
    lastInputValue: String(analysisInputHistoryCache.lastInputValue || "").trim(),
    entries: (analysisInputHistoryCache.entries || []).slice(0, keys.MAX_ANALYSIS_HISTORY_ITEMS),
    accountNameCache: analysisInputHistoryCache.accountNameCache || {}
  });
}

function renderAnalysisHistoryMenu(history = loadAnalysisInputHistory()) {
  if (!getElements().historyMenu) {
    return;
  }

  getElements().historyMenu.innerHTML = history.entries.map(renderAnalysisHistoryOptionHtml).join("");
  if (!history.entries.length) {
    closeAnalysisHistoryMenu();
  }
}

function renderAnalysisHistoryOptionHtml(entry) {
  const label = entry.displayName || entry.targets.map(target => target.displayName).filter(Boolean).join(" + ") || entry.inputValue;
  return `
    <button class="sffa-list-option" type="button" role="option" data-sffa-history-option="${escapeAttr(entry.inputValue)}" title="${escapeAttr(entry.inputValue)}">
      <span class="sffa-history-option-main">${escapeHtml(label)}</span>
      <span class="sffa-history-option-sub">${escapeHtml(entry.inputValue)}</span>
    </button>
  `;
}

function clearAnalysisHistory() {
  sffaExtensionDeleteValue(keys.ANALYSIS_HISTORY_KEY);
  sffaExtensionDeleteValue(keys.ANALYSIS_INPUT_HISTORY_KEY);
  analysisInputHistoryCache = createEmptyAnalysisInputHistory();
  renderAnalysisHistoryMenu(analysisInputHistoryCache);
}


  return {
    clearAnalysisHistory,
    loadAnalysisInputHistory,
    rememberAnalysisInput,
    renderAnalysisHistoryMenu
  };
};
