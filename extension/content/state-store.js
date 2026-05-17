"use strict";

globalThis.SFFA_CREATE_STATE_STORE = function createStateStore(dependencies) {
  const {
    extractStoreCoverUrlFromStoreItem,
    getDefaultState,
    getState,
    getStoreCacheContextValue,
    getStoreCacheTtlMs,
    normalizeStoreItemOriginalPrice
  } = dependencies;

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(getDefaultState()));
}

function isFreshStoreCacheEntry(entry) {
  return Boolean(
    entry &&
    typeof entry.supported === "boolean" &&
    entry.context === getStoreCacheContextValue() &&
    Date.now() - Number(entry.updatedAt || 0) < getStoreCacheTtlMs()
  );
}

function isRestorableStoreCacheEntry(entry) {
  return Boolean(
    isFreshStoreCacheEntry(entry) ||
    isFreshCoverCacheEntry(entry) ||
    isFreshStoreItemCacheEntry(entry) ||
    (entry &&
      entry.context === getStoreCacheContextValue() &&
      isFreshOriginalPriceCacheEntry(entry.price))
  );
}

function isFreshCoverCacheEntry(entry) {
  return Boolean(
    entry &&
    entry.context === getStoreCacheContextValue() &&
    entry.coverVerified === true &&
    typeof entry.coverUrl === "string" &&
    entry.coverUrl &&
    Date.now() - Number(entry.updatedAt || 0) < getStoreCacheTtlMs()
  );
}

function isFreshStoreItemCacheEntry(entry) {
  return Boolean(
    entry &&
    entry.context === getStoreCacheContextValue() &&
    entry.storeItem &&
    typeof entry.storeItem === "object" &&
    Date.now() - Number(entry.updatedAt || 0) < getStoreCacheTtlMs()
  );
}

function getStoreCacheCount() {
  return Object.keys(getState().storeCache || {}).length;
}

function isFreshOriginalPriceCacheEntry(entry) {
  return Boolean(
    entry &&
    (typeof entry.initial === "number" || entry.unavailable === true) &&
    Object.prototype.hasOwnProperty.call(entry, "localizedName") &&
    Date.now() - Number(entry.updatedAt || 0) < getStoreCacheTtlMs()
  );
}

function cacheOriginalPrice(appid, price) {
  getState().storeCache = getState().storeCache || {};
  if (!isFreshOriginalPriceCacheEntry(price)) {
    return;
  }
  getState().storeCache[String(appid)] = mergeStoreCacheEntry(getState().storeCache[String(appid)], {
    context: getStoreCacheContextValue(),
    localizedName: price.localizedName || "",
    price,
    updatedAt: Date.now()
  });
}

function cacheStoreItem(appid, item) {
  if (!item || Number(item.success) !== 1) {
    return;
  }
  const coverUrl = extractStoreCoverUrlFromStoreItem(item);
  const price = normalizeStoreItemOriginalPrice(item);
  getState().storeCache = getState().storeCache || {};
  getState().storeCache[String(appid)] = mergeStoreCacheEntry(getState().storeCache[String(appid)], {
    context: getStoreCacheContextValue(),
    localizedName: item.name || price?.localizedName || "",
    ...(coverUrl ? { coverUrl, coverVerified: true } : {}),
    ...(price ? { price } : {}),
    storeItem: item,
    updatedAt: Date.now()
  });
}

function mergeStoreCacheEntry(existing, next) {
  const updatedAt = Math.max(Number(existing?.updatedAt || 0), Number(next?.updatedAt || 0));
  return {
    ...(existing || {}),
    ...(next || {}),
    localizedName: next?.localizedName || existing?.localizedName || next?.price?.localizedName || existing?.price?.localizedName || "",
    coverUrl: next?.coverUrl || existing?.coverUrl || "",
    coverVerified: next?.coverVerified === true || existing?.coverVerified === true,
    price: next?.price || existing?.price || null,
    storeItem: mergeStoreItem(existing?.storeItem, next?.storeItem),
    updatedAt: updatedAt || Date.now()
  };
}

function mergeStoreItem(existing, next) {
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    return next || existing || null;
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return next;
  }
  const merged = { ...existing };
  Object.entries(next).forEach(([key, value]) => {
    merged[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeStoreItem(existing[key], value)
      : value;
  });
  return merged;
}

function normalizeSavedStoreCache(storeCache) {
  const normalized = {};
  Object.entries(storeCache || {}).forEach(([appid, entry]) => {
    if (isRestorableStoreCacheEntry(entry)) {
      normalized[String(appid)] = {
        ...(typeof entry.supported === "boolean" ? { supported: entry.supported } : {}),
        context: entry.context || getStoreCacheContextValue(),
        localizedName: entry.localizedName || entry.price?.localizedName || "",
        coverUrl: entry.coverUrl || "",
        coverVerified: entry.coverVerified === true,
        price: isFreshOriginalPriceCacheEntry(entry.price) ? entry.price : null,
        storeItem: isFreshStoreItemCacheEntry(entry) ? entry.storeItem : null,
        updatedAt: Number(entry.updatedAt || Date.now())
      };
    }
  });
  return normalized;
}


  return {
    cacheOriginalPrice,
    cacheStoreItem,
    cloneDefaultState,
    getStoreCacheCount,
    isFreshCoverCacheEntry,
    isFreshOriginalPriceCacheEntry,
    isFreshStoreCacheEntry,
    isFreshStoreItemCacheEntry,
    isRestorableStoreCacheEntry,
    mergeStoreCacheEntry,
    mergeStoreItem,
    normalizeSavedStoreCache
  };
};
