"use strict";

globalThis.SFFA_CREATE_LOAD_STATES = function createLoadStates() {
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

  function createRateLimitState() {
    return {
      active: false,
      source: "",
      message: "",
      checkedAt: 0,
      checkPassed: false
    };
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

  function createCoverLoadState() {
    return {
      loadingSet: new Set(),
      running: false,
      scheduled: 0
    };
  }

  function createCoverProbeState() {
    return {
      probingUrlByAppid: new Map(),
      verifiedUrlByAppid: new Map(),
      failedUrlByAppid: new Map(),
      retryingSet: new Set()
    };
  }

  return {
    createCoverLoadState,
    createCoverProbeState,
    createPriceLoadState,
    createRateLimitState,
    createShareabilityFilterState,
    createShareabilityProgressUiState
  };
};
