"use strict";

globalThis.SFFA_CREATE_STORE_ASSETS = function createStoreAssets(dependencies) {
  const {
    getCoverReloadToken,
    getState,
    getStoreCacheContext,
    getStoreItemAssetBaseUrl,
    mergeStoreCacheEntry
  } = dependencies;

function getCompareGameCoverUrl(appid) {
  return withCoverReloadToken(getCachedStoreCoverUrl(appid));
}

function withCoverReloadToken(url) {
  const normalized = String(url || "").trim();
  if (!normalized || !getCoverReloadToken()) {
    return normalized;
  }
  return `${normalized}${normalized.includes("?") ? "&" : "?"}t=${getCoverReloadToken()}`;
}

function getCachedStoreCoverUrl(appid) {
  const entry = getState().storeCache?.[String(appid || "")];
  return String(entry?.coverUrl || "");
}

function extractStorePosterCoverUrlFromStoreItem(item) {
  return extractStoreAssetUrlFromStoreItem(item, ["library_capsule", "library_capsule_2x", "main_capsule", "small_capsule", "header"]);
}

function extractStoreAssetUrlFromStoreItem(item, assetKeys, failedUrl = "") {
  const assets = item?.assets || {};
  const urls = (assetKeys || [])
    .map(key => buildStoreItemAssetUrl(assets.asset_url_format, assets[key]))
    .filter(Boolean);
  const normalizedFailedUrl = String(failedUrl || "").trim();
  return urls.find(url => url !== normalizedFailedUrl) || urls[0] || "";
}

function extractStoreCoverUrlFromStoreItem(item, failedUrl = "") {
  return extractStoreAssetUrlFromStoreItem(item, ["header", "main_capsule", "small_capsule"], failedUrl);
}

function buildStoreItemAssetUrl(assetUrlFormat, filename) {
  const normalizedFormat = String(assetUrlFormat || "").trim();
  const normalizedFilename = String(filename || "").trim();
  if (!normalizedFormat || !normalizedFilename) {
    return "";
  }
  return `${getStoreItemAssetBaseUrl()}${normalizedFormat.replace("${FILENAME}", normalizedFilename)}`;
}

function extractStoreCoverUrlFromAppdetails(item, failedUrl = "") {
  const urls = [item?.data?.header_image, item?.data?.capsule_image]
    .map(value => String(value || "").trim())
    .filter(Boolean);
  const normalizedFailedUrl = String(failedUrl || "").trim();
  return urls.find(url => url !== normalizedFailedUrl) || urls[0] || "";
}

function cacheStoreCoverUrl(appid, coverUrl) {
  const normalized = String(coverUrl || "").trim();
  if (!normalized) {
    return;
  }
  getState().storeCache = getState().storeCache || {};
  getState().storeCache[String(appid)] = mergeStoreCacheEntry(getState().storeCache[String(appid)], {
    context: getStoreCacheContext(),
    coverUrl: normalized,
    coverVerified: true,
    updatedAt: Date.now()
  });
}


  return {
    cacheStoreCoverUrl,
    extractStoreAssetUrlFromStoreItem,
    extractStoreCoverUrlFromAppdetails,
    extractStoreCoverUrlFromStoreItem,
    extractStorePosterCoverUrlFromStoreItem,
    getCachedStoreCoverUrl,
    getCompareGameCoverUrl,
    withCoverReloadToken
  };
};
