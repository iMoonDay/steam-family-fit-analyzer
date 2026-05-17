"use strict";

globalThis.SFFA_CREATE_PRICE_LOAD_FLOW = function createPriceLoadFlow(dependencies) {
  const {
    ORIGINAL_PRICE_BATCH_SIZE,
    cacheOriginalPrice,
    createPriceLoadState,
    fetchOriginalPrices,
    getElements,
    getLastReport,
    getRateLimitState,
    getShareabilityFilterState,
    getState,
    isFreshOriginalPriceCacheEntry,
    isFreshStoreCacheEntry,
    isRateLimitError,
    normalizeOriginalPrice,
    refreshReportMetrics,
    renderDetailsAfterPriceChange,
    renderStoreCacheButton,
    renderSummary,
    saveState,
    scheduleVisibleCoverLoads,
    setRateLimited,
    setRawError,
    window
  } = dependencies;

  let priceLoadState = createPriceLoadState();

  function getPriceLoadState() {
    return priceLoadState;
  }

  function resetPriceLoadState() {
    priceLoadState = createPriceLoadState();
  }

  function prepareOriginalPrices(games) {
    getState().storeCache = getState().storeCache || {};
    resetPriceLoadState();

    games.forEach(game => {
      prepareOriginalPriceForGame(game);
    });

    renderStoreCacheButton();
  }

  function prepareOriginalPriceForGame(game) {
    const state = getState();
    state.storeCache = state.storeCache || {};
    const appid = String(game.appid);
    const cached = state.storeCache[appid];
    if (isFreshStoreCacheEntry(cached) && isFreshOriginalPriceCacheEntry(cached.price)) {
      applyOriginalPriceToGame(game, cached.price);
    } else {
      game.price = { pending: true };
      priceLoadState.pendingMap.set(appid, game);
    }
    renderStoreCacheButton();
  }

  function applyOriginalPriceToGame(game, price) {
    game.price = price || normalizeOriginalPrice(null);
  }

  function startLazyOriginalPriceLoading() {
    scheduleVisiblePriceLoads();
    scheduleVisibleCoverLoads();
    if (!getShareabilityFilterState().running) {
      scheduleBackgroundPriceLoads();
    }
  }

  function scheduleVisiblePriceLoads() {
    if (getRateLimitState().active || !getLastReport() || priceLoadState.pendingMap.size === 0) {
      return;
    }
    window.clearTimeout(priceLoadState.scheduled);
    priceLoadState.scheduled = window.setTimeout(() => {
      const visibleAppids = getVisiblePriceAppids();
      if (visibleAppids.length > 0) {
        enqueueOriginalPriceLoads(visibleAppids, true);
      }
      if (!getShareabilityFilterState().running) {
        scheduleBackgroundPriceLoads();
      }
    }, 80);
  }

  function getVisiblePriceAppids() {
    const rows = Array.from(getElements().tableWrap.querySelectorAll("[data-price-appid]"));
    if (!rows.length) {
      return [];
    }

    const wrapRect = getElements().tableWrap.getBoundingClientRect();
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
    if (getRateLimitState().active || !getLastReport() || priceLoadState.pendingMap.size === 0) {
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
    if (getRateLimitState().active || priceLoadState.running) {
      return;
    }
    priceLoadState.running = true;
    try {
      while (priceLoadState.queue.length > 0) {
        const appids = takeOriginalPriceQueueBatch();
        if (!appids.length) {
          continue;
        }

        try {
          const prices = await fetchOriginalPrices(appids);
          appids.forEach(appid => {
            const game = priceLoadState.pendingMap.get(appid);
            if (!game) {
              return;
            }
            const price = prices.get(appid) || normalizeOriginalPrice(null);
            cacheOriginalPrice(appid, price);
            applyOriginalPriceToGame(game, price);
            priceLoadState.pendingMap.delete(appid);
          });
          saveState();
          refreshReportMetrics();
          renderSummary(getLastReport());
          renderDetailsAfterPriceChange();
          renderStoreCacheButton();
        } catch (error) {
          if (isRateLimitError(error)) {
            restoreOriginalPriceQueueBatch(appids);
            setRawError(error);
            setRateLimited(error, "price");
            break;
          }
          appids.forEach(appid => {
            const game = priceLoadState.pendingMap.get(appid);
            if (!game) {
              return;
            }
            game.price = { unavailable: true, updatedAt: Date.now() };
            priceLoadState.pendingMap.delete(appid);
          });
          setRawError(error);
          refreshReportMetrics();
          renderSummary(getLastReport());
          renderDetailsAfterPriceChange();
        } finally {
          appids.forEach(appid => priceLoadState.loadingSet.delete(appid));
        }
      }
    } finally {
      priceLoadState.running = false;
      if (!getRateLimitState().active && priceLoadState.pendingMap.size > 0 && !getShareabilityFilterState().running) {
        scheduleBackgroundPriceLoads();
      }
    }
  }

  function takeOriginalPriceQueueBatch() {
    const appids = [];
    while (priceLoadState.queue.length > 0 && appids.length < ORIGINAL_PRICE_BATCH_SIZE) {
      const appid = priceLoadState.queue.shift();
      priceLoadState.queuedSet.delete(appid);
      if (!priceLoadState.pendingMap.has(appid) || priceLoadState.loadingSet.has(appid)) {
        continue;
      }
      priceLoadState.loadingSet.add(appid);
      appids.push(appid);
    }
    return appids;
  }

  function restoreOriginalPriceQueueBatch(appids) {
    const restored = [];
    appids.forEach(appid => {
      if (!priceLoadState.pendingMap.has(appid)) {
        return;
      }
      restored.push(appid);
      priceLoadState.queuedSet.add(appid);
    });
    priceLoadState.queue = [...restored, ...priceLoadState.queue.filter(item => !restored.includes(item))];
  }

  return {
    applyOriginalPriceToGame,
    getPriceLoadState,
    prepareOriginalPriceForGame,
    prepareOriginalPrices,
    resetPriceLoadState,
    scheduleBackgroundPriceLoads,
    scheduleVisiblePriceLoads,
    startLazyOriginalPriceLoading
  };
};
