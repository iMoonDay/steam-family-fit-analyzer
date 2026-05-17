"use strict";

globalThis.SFFA_CREATE_COVER_LOAD_FLOW = function createCoverLoadFlow(dependencies) {
  const {
    COVER_RELOAD_BATCH_SIZE,
    clearCachedStoreCoverUrl,
    createCoverLoadState,
    createCoverProbeState,
    fetchCoverUrlBatch,
    getCachedStoreCoverUrl,
    getCompareGameCoverUrl,
    getElements,
    getListViewMode,
    getRateLimitState,
    getState,
    getVisibleCoverAppids,
    isCompareDialogOpen,
    isRateLimitError,
    renderCompareDialogIfOpen,
    renderDetailsPreserveScroll,
    saveState,
    setRateLimited,
    setRawError,
    shouldProcessVisibleCovers,
    withCoverReloadToken,
    window
  } = dependencies;

  const coverLoadState = createCoverLoadState();
  const coverProbeState = createCoverProbeState();

  function getCoverProbeState() {
    return coverProbeState;
  }

  function scheduleVisibleCoverLoads() {
    if (getRateLimitState().active || !shouldProcessVisibleCovers()) {
      return;
    }
    window.clearTimeout(coverLoadState.scheduled);
    coverLoadState.scheduled = window.setTimeout(runVisibleCoverLoads, 80);
  }

  async function runVisibleCoverLoads() {
    coverLoadState.scheduled = 0;
    if (getRateLimitState().active || coverLoadState.running) {
      return;
    }
    applyVisibleCoverImages();
    const visibleAppids = getVisibleCoverAppids().map(String);
    visibleAppids.forEach(appid => {
      const cachedCoverUrl = hasVerifiedStoreCoverUrl(appid) ? getCachedStoreCoverUrl(appid) : "";
      if (cachedCoverUrl) {
        ensureCoverUrlHealthy(appid, cachedCoverUrl);
      }
    });
    const appids = visibleAppids.filter(appid => !hasVerifiedStoreCoverUrl(appid) && !coverLoadState.loadingSet.has(String(appid)));
    if (!appids.length) {
      return;
    }

    const batch = appids.slice(0, COVER_RELOAD_BATCH_SIZE).map(String);
    batch.forEach(appid => coverLoadState.loadingSet.add(appid));
    coverLoadState.running = true;
    try {
      await fetchCoverUrlBatch(batch, `covers.visible${Date.now()}`);
      saveState();
      applyVisibleCoverImages();
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimited(error, "cover");
      } else {
        setRawError(error);
      }
    } finally {
      batch.forEach(appid => coverLoadState.loadingSet.delete(appid));
      coverLoadState.running = false;
      if (!getRateLimitState().active) {
        const remaining = getVisibleCoverAppids().some(appid => !hasVerifiedStoreCoverUrl(appid));
        if (remaining) {
          scheduleVisibleCoverLoads();
        }
      }
    }
  }

  function hasVerifiedStoreCoverUrl(appid) {
    const entry = getState().storeCache?.[String(appid || "")];
    return Boolean(entry?.coverVerified === true && entry.coverUrl);
  }

  function applyVisibleCoverImages() {
    const elements = getElements();
    if (getListViewMode() === "cover") {
      applyVisibleCoverImagesInContainer(elements.tableWrap, ".sffa-cover-card-media[data-sffa-cover-appid]");
    }
    if (isCompareDialogOpen()) {
      applyVisibleCoverImagesInContainer(elements.compareSummary, ".sffa-compare-card-game[data-sffa-cover-appid]");
    }
  }

  function applyVisibleCoverImagesInContainer(container, selector) {
    if (!container) {
      return;
    }
    const nodes = Array.from(container.querySelectorAll(selector));
    if (!nodes.length) {
      return;
    }
    const wrapRect = container.getBoundingClientRect();
    const visibleNodes = nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom >= wrapRect.top && rect.top <= wrapRect.bottom;
    });
    const targets = visibleNodes.length ? visibleNodes : nodes.slice(0, 20);
    targets.forEach(node => {
      const appid = String(node.dataset.sffaCoverAppid || "").trim();
      const coverUrl = getCompareGameCoverUrl(appid);
      if (!coverUrl) {
        return;
      }
      if (node.dataset.sffaAppliedCoverUrl === coverUrl) {
        return;
      }
      node.style.setProperty("--sffa-cover", `url(${coverUrl})`);
      node.dataset.sffaAppliedCoverUrl = coverUrl;
    });
  }

  function ensureCoverUrlHealthy(appid, url) {
    const normalizedAppid = String(appid || "");
    const normalizedUrl = String(url || "").trim();
    if (!normalizedAppid || !normalizedUrl) {
      return;
    }
    if (coverProbeState.verifiedUrlByAppid.get(normalizedAppid) === normalizedUrl) {
      return;
    }
    if (coverProbeState.failedUrlByAppid.get(normalizedAppid) === normalizedUrl) {
      return;
    }
    if (coverProbeState.probingUrlByAppid.get(normalizedAppid) === normalizedUrl) {
      return;
    }

    coverProbeState.probingUrlByAppid.set(normalizedAppid, normalizedUrl);
    const image = new Image();
    image.onload = () => {
      coverProbeState.probingUrlByAppid.delete(normalizedAppid);
      coverProbeState.verifiedUrlByAppid.set(normalizedAppid, normalizedUrl);
      coverProbeState.failedUrlByAppid.delete(normalizedAppid);
      markCachedCoverUrlVerified(normalizedAppid, normalizedUrl);
    };
    image.onerror = () => {
      coverProbeState.probingUrlByAppid.delete(normalizedAppid);
      if (coverProbeState.failedUrlByAppid.get(normalizedAppid) === normalizedUrl) {
        return;
      }
      coverProbeState.failedUrlByAppid.set(normalizedAppid, normalizedUrl);
      handleBrokenCoverUrl(normalizedAppid);
    };
    image.src = withCoverReloadToken(normalizedUrl);
  }

  function markCachedCoverUrlVerified(appid, url) {
    const key = String(appid || "");
    const entry = getState().storeCache?.[key];
    if (!entry || String(entry.coverUrl || "") !== String(url || "") || entry.coverVerified === true) {
      return;
    }
    getState().storeCache[key] = {
      ...entry,
      coverVerified: true
    };
    saveState();
  }

  async function handleBrokenCoverUrl(appid) {
    const key = String(appid || "");
    if (!key || coverProbeState.retryingSet.has(key)) {
      return;
    }
    coverProbeState.retryingSet.add(key);
    try {
      const failedUrl = String(coverProbeState.failedUrlByAppid.get(key) || "");
      clearCachedStoreCoverUrl(key);
      await fetchCoverUrlBatch([key], `covers.retry.${key}.${Date.now()}`, { [key]: failedUrl });
      saveState();
      renderDetailsPreserveScroll();
      renderCompareDialogIfOpen();
      scheduleVisibleCoverLoads();
    } catch (error) {
      if (isRateLimitError(error)) {
        setRateLimited(error, "cover");
      } else {
        setRawError(error);
      }
    } finally {
      coverProbeState.retryingSet.delete(key);
    }
  }

  return {
    applyVisibleCoverImages,
    getCoverProbeState,
    hasVerifiedStoreCoverUrl,
    scheduleVisibleCoverLoads
  };
};
