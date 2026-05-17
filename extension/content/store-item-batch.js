"use strict";

globalThis.SFFA_CREATE_STORE_ITEM_BATCH = function createStoreItemBatch(dependencies) {
  const {
    cacheStoreItem,
    getStoreCountry,
    getStoreLang,
    requestStoreJson,
    setRawData,
    t
  } = dependencies;

  async function fetchStoreItemBatch(appids, dataRequest = {}, rawKey = `storeItems.batch${Date.now()}`) {
    const url = buildStoreItemBatchUrl(appids, dataRequest);
    const data = await requestStoreJson(url, rawKey);
    setRawData(rawKey, data);
    if (!Array.isArray(data?.response?.store_items)) {
      throw new Error(t("storeBatchMalformed"));
    }
    const itemById = {};
    data.response.store_items.forEach(item => {
      if (!item?.appid) {
        return;
      }
      const appid = String(item.appid);
      itemById[appid] = item;
      cacheStoreItem(appid, item);
    });
    return itemById;
  }

  function buildStoreItemBatchUrl(appids, dataRequest = {}) {
    const input = {
      ids: appids.map(appid => ({ appid: Number(appid) })),
      context: {
        language: getStoreLang(),
        country_code: getStoreCountry()
      },
      data_request: {
        include_basic_info: false,
        include_assets: false,
        include_all_purchase_options: false,
        include_tag_count: 0,
        ...dataRequest
      }
    };
    return `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
  }

  return {
    fetchStoreItemBatch
  };
};
