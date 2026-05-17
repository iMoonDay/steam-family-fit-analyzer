"use strict";

globalThis.SFFA_CREATE_FORMAT_HELPERS = function createFormatHelpers(dependencies) {
  const {
    document,
    getLastReport,
    getSelectedTargetSteamIds,
    getState,
    getStoreCountry,
    getStoreCurrencyMap,
    getStoreLocaleMap,
    getTargetProfileDisplayName,
    getUiLocale,
    t
  } = dependencies;

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
  return String(left.name || "").localeCompare(String(right.name || ""), getNumberLocale());
}

function formatOwners(owners) {
  if (!owners.length) {
    return "";
  }
  return owners
    .map(steamid => getState().familyInfo?.steamIdtoName?.[steamid] || steamid)
    .join(getUiLocale() === "en" ? ", " : "、");
}

function formatTargetOwners(owners) {
  const selectedIds = isMultiTargetReport() ? new Set(getSelectedTargetSteamIds()) : null;
  const ownerIds = Array.from(new Set((owners || []).map(String).filter(Boolean)))
    .filter(steamid => !selectedIds || selectedIds.has(steamid));
  if (!ownerIds.length) {
    return "";
  }

  const targetNameById = getTargetNameById();
  return ownerIds
    .map(steamid => targetNameById[steamid] || steamid)
    .join(getUiLocale() === "en" ? ", " : "、");
}

function getTargetNameById() {
  const report = getLastReport();
  const targets = Array.isArray(report?.target?.targets) && report.target.targets.length
    ? report.target.targets
    : [report?.target].filter(Boolean);
  const names = {};
  targets.forEach(target => {
    const steamid64 = String(target?.steamid64 || "");
    if (steamid64) {
      names[steamid64] = getTargetProfileDisplayName(target);
    }
  });
  return names;
}

function isMultiTargetReport(report = getLastReport()) {
  return Array.isArray(report?.target?.targets) && report.target.targets.length > 1;
}

function formatOriginalPriceCell(price) {
  if (price?.pending) {
    return `<span class="sffa-spinner" title="${escapeAttr(t("loading"))}"></span>`;
  }
  if (!price || (price.initial == null && !price.unavailable && !price.isFree)) {
    return "-";
  }
  if (price.unavailable) {
    return "N/A";
  }
  return formatMoney(Number(price.initial || 0), price.currency);
}

function formatOriginalPriceText(price) {
  if (price?.pending) {
    return t("loading");
  }
  if (!price || (price.initial == null && !price.unavailable && !price.isFree)) {
    return "-";
  }
  if (price.unavailable) {
    return "N/A";
  }
  return formatMoney(Number(price.initial || 0), price.currency);
}

function normalizeCopyCell(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function formatMoney(cents, currency = getStoreCurrency()) {
  return new Intl.NumberFormat(localeForStoreCountry(), {
    style: "currency",
    currency
  }).format(Number(cents || 0) / 100);
}

function getNumberLocale() {
  return getUiLocale() === "en" ? localeForStoreCountry() : "zh-CN";
}

function localeForStoreCountry() {
  return getStoreLocaleMap()[getStoreCountry()] || "en-US";
}

function getStoreCurrency() {
  return getStoreCurrencyMap()[getStoreCountry()] || "USD";
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString(getNumberLocale(), {
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
  return new Date(seconds * 1000).toLocaleString(getNumberLocale(), {
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
    all: t("tabs.all"),
    family: t("tabs.family"),
    new: t("tabs.new"),
    relativeNew: t("tabs.relativeNew"),
    overlap: t("tabs.overlap"),
    search: t("tabs.search")
  }[tab] || t("list");
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
  return {
    decodeHtml,
    escapeAttr,
    escapeHtml,
    formatDateTime,
    formatFamilyAcquireTime,
    formatMoney,
    formatOriginalPriceCell,
    formatOriginalPriceText,
    formatOwners,
    formatPercent,
    formatTargetOwners,
    getNumberLocale,
    getStoreCurrency,
    getTabLabel,
    isMultiTargetReport,
    normalizeCopyCell,
    readJsonAttribute,
    sortByName,
    sortFamilyLibraryRows
  };
};
