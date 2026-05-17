"use strict";

globalThis.SFFA_CREATE_PRICE_UTILS = function createPriceUtils(dependencies) {
  const { getStoreCurrency } = dependencies;

function hasPriceOverview(item) {
  return Boolean(item?.success && item.data && !Array.isArray(item.data) && item.data.price_overview);
}

function isZeroValueOriginalPrice(price) {
  return Boolean(
    price &&
    !price.pending &&
    !price.unavailable &&
    (price.isFree || (price.initial != null && Number(price.initial) <= 0))
  );
}

function normalizeOriginalPrice(item) {
  const now = Date.now();
  const data = item?.success && item.data && !Array.isArray(item.data) ? item.data : null;
  const localizedName = data?.name || "";
  if (hasPriceOverview(item)) {
    const priceOverview = item.data.price_overview;
    const initial = Number(priceOverview.initial ?? priceOverview.final ?? 0);
    return {
      initial,
      currency: priceOverview.currency || getStoreCurrency(),
      localizedName,
      isFree: data?.is_free === true || initial <= 0,
      unavailable: false,
      updatedAt: now
    };
  }

  if (data?.is_free === true) {
    return {
      initial: 0,
      currency: getStoreCurrency(),
      localizedName,
      isFree: true,
      unavailable: false,
      updatedAt: now
    };
  }

  return {
    initial: null,
    currency: getStoreCurrency(),
    localizedName,
    isFree: false,
    unavailable: true,
    updatedAt: now
  };
}

function normalizeStoreItemOriginalPrice(item) {
  const now = Date.now();
  const localizedName = item?.name || "";
  const purchaseOption = item?.best_purchase_option;
  const initial = purchaseOption?.original_price_in_cents ?? purchaseOption?.final_price_in_cents;
  if (initial != null && initial !== "") {
    const cents = Number(initial);
    return {
      initial: cents,
      currency: getStoreCurrency(),
      localizedName,
      isFree: cents <= 0,
      unavailable: false,
      updatedAt: now
    };
  }

  return null;
}


  return {
    hasPriceOverview,
    isZeroValueOriginalPrice,
    normalizeOriginalPrice,
    normalizeStoreItemOriginalPrice
  };
};
