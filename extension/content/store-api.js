"use strict";

globalThis.SFFA_CREATE_STORE_API = function createStoreApi(dependencies) {
  const {
    cacheStoreCoverUrl,
    extractStoreCoverUrlFromAppdetails,
    fetchStoreItemBatch,
    getStoreCacheContext,
    getStoreCountry,
    getStoreLang,
    hasPriceOverview,
    isRateLimitError,
    normalizeOriginalPrice,
    normalizeStoreItemOriginalPrice,
    requestStoreJson,
    setRawData,
    setRawError,
    t
  } = dependencies;
  const FAMILY_SHARING_CATEGORY_ID = dependencies.FAMILY_SHARING_CATEGORY_ID;

async function fetchShareabilityBatch(appids) {
  const itemById = await fetchStoreItemBatch(appids, {
    include_basic_info: true,
    include_assets: true,
    include_all_purchase_options: true
  }, `shareability.batch${Date.now()}`);

  const results = {};
  for (const appid of appids) {
    const item = itemById[String(appid)];
    if (Number(item?.success) !== 1 || !Array.isArray(item?.categories?.feature_categoryids)) {
      const fallback = await fetchShareabilityFallback(appid);
      results[String(appid)] = {
        ...fallback,
        context: getStoreCacheContext(),
        localizedName: item?.name || fallback.localizedName || ""
      };
      continue;
    }

    const featureCategoryIds = item.categories.feature_categoryids;
    const price = normalizeStoreItemOriginalPrice(item);
    results[String(appid)] = {
      supported: Array.isArray(featureCategoryIds) && featureCategoryIds.some(id => Number(id) === FAMILY_SHARING_CATEGORY_ID),
      context: getStoreCacheContext(),
      localizedName: item.name || price?.localizedName || "",
      price,
      updatedAt: Date.now()
    };
  }

  return results;
}

async function fetchShareabilityFallback(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=categories&l=${getStoreLang()}`;
  const data = await requestStoreJson(url, `shareability.fallback.${appid}`);
  setRawData(`shareability.fallback.${appid}`, data);
  const item = data?.[appid];
  const categories = item?.success && item.data && !Array.isArray(item.data)
    ? item.data.categories
    : [];

  return {
    supported: Array.isArray(categories) && categories.some(category => Number(category.id) === FAMILY_SHARING_CATEGORY_ID),
    context: getStoreCacheContext(),
    updatedAt: Date.now()
  };
}


async function fetchOriginalPrice(appid) {
  const priceUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&filters=basic,price_overview&cc=${getStoreCountry()}&l=${getStoreLang()}`;
  const priceData = await requestStoreJson(priceUrl, `prices.${appid}`);
  setRawData(`prices.${appid}`, priceData);
  cacheStoreCoverUrl(appid, extractStoreCoverUrlFromAppdetails(priceData?.[appid]));
  return normalizeOriginalPrice(priceData?.[appid]);
}

async function fetchOriginalPrices(appids) {
  const uniqueAppids = Array.from(new Set(appids.map(String)));
  const priceUrl = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(uniqueAppids.join(","))}&filters=price_overview&cc=${getStoreCountry()}&l=${getStoreLang()}`;
  const rawKey = `prices.batch${Date.now()}`;
  const priceData = await requestStoreJson(priceUrl, rawKey);
  setRawData(rawKey, priceData);

  const prices = new Map();
  for (const appid of uniqueAppids) {
    const item = priceData?.[appid];
    cacheStoreCoverUrl(appid, extractStoreCoverUrlFromAppdetails(item));
    if (hasPriceOverview(item)) {
      prices.set(appid, normalizeOriginalPrice(item));
      continue;
    }

    try {
      const fallbackPrice = await fetchOriginalPrice(appid);
      prices.set(appid, {
        ...fallbackPrice,
        localizedName: ""
      });
    } catch (error) {
      if (isRateLimitError(error)) {
        throw error;
      }
      setRawError(error);
      prices.set(appid, normalizeOriginalPrice(null));
    }
  }

  return prices;
}


  return {
    fetchOriginalPrice,
    fetchOriginalPrices,
    fetchShareabilityBatch,
    fetchShareabilityFallback
  };
};
