"use strict";

globalThis.SFFA_CREATE_POSTER_HELPERS = function createPosterHelpers(dependencies) {
  const {
    COVER_RELOAD_BATCH_SIZE,
    FAMILY_POSTER_CARD_ASPECT_RATIO,
    FAMILY_POSTER_CARD_WIDTH,
    FAMILY_POSTER_GAP,
    FAMILY_POSTER_HEADER_HEIGHT,
    FAMILY_POSTER_IMAGE_CONCURRENCY,
    FAMILY_POSTER_MAX_HEIGHT,
    FAMILY_POSTER_PADDING,
    FAMILY_POSTER_WIDTH,
    cacheStoreCoverUrl,
    closeCopyListMenu,
    closeMenu,
    createFamilyPosterDialogContext,
    createListPosterCanvasContext,
    document,
    extractStoreCoverUrlFromStoreItem,
    extractStorePosterCoverUrlFromStoreItem,
    fetchStoreItemBatch,
    formatDateTime,
    formatOwners,
    formatTargetOwners,
    getCachedLocalizedName,
    getCachedStoreCoverUrl,
    getCoverProbeState,
    getCurrentListRows,
    getCurrentTab,
    getElements,
    getFamilyPosterSettings,
    getGameDisplayName,
    getGameListLabel,
    getListPosterSettings,
    getListViewMode,
    getNumberLocale,
    getState,
    getTabLabel,
    getUiLocale,
    isCompareDialogOpen,
    isFreshStoreItemCacheEntry,
    isRateLimitError,
    normalizeFamilyPosterColumns,
    normalizeFamilyPosterScalePercent,
    normalizeFamilyPosterSettings,
    normalizeListPosterSettings,
    normalizeMainTab,
    normalizeStoreItemOriginalPrice,
    renderCompareDialogIfOpen,
    renderDetailsPreserveScroll,
    renderStoreCacheButton,
    saveState,
    setBusy,
    setRateLimited,
    setRawError,
    setStatus,
    SHAREABILITY_BATCH_SIZE,
    t,
    window
  } = dependencies;

async function generateFamilyPoster(settings = getFamilyPosterSettings()) {
  closeMenu();
  setBusy(true);
  try {
    const appids = (getState().familyLibrary?.appidSet || []).map(String).filter(appid => /^\d+$/.test(appid));
    if (!appids.length) {
      throw new Error(t("familyPosterEmpty"));
    }
    setStatus(t("preparingFamilyPoster"), "warn");
    await ensurePosterStoreItems(appids, {
      statusKey: "fetchingFamilyPoster",
      rawPrefix: "familyPoster"
    });
    const posterItems = buildFamilyPosterItems(appids, settings);
    if (!posterItems.length) {
      throw new Error(t("familyPosterEmpty"));
    }
    setStatus(t("renderingFamilyPoster"), "warn");
    const canvas = await renderFamilyPosterCanvas(posterItems, settings, createFamilyPosterDialogContext());
    await downloadCanvasAsPng(canvas, buildFamilyPosterFilename(settings));
    setStatus(t("familyPosterSaved"), "ok");
  } catch (error) {
    if (isRateLimitError(error)) {
      setRateLimited(error, "cover");
    } else {
      setRawError(error);
      setStatus(error.message || t("networkFailed"), "err");
    }
  } finally {
    setBusy(false);
  }
}

async function generateListPoster(tab, settings = getListPosterSettings(tab)) {
  closeCopyListMenu();
  setBusy(true);
  try {
    const rows = getCurrentListRows(tab);
    const appids = rows.map(game => String(game.appid || "")).filter(appid => /^\d+$/.test(appid));
    if (!appids.length) {
      throw new Error(t("listPosterEmpty"));
    }
    setStatus(t("preparingListPoster"), "warn");
    await ensurePosterStoreItems(appids, {
      statusKey: "fetchingListPoster",
      rawPrefix: "listPoster"
    });
    const posterItems = buildListPosterItems(rows, settings);
    if (!posterItems.length) {
      throw new Error(t("listPosterEmpty"));
    }
    setStatus(t("renderingListPoster"), "warn");
    const canvas = await renderFamilyPosterCanvas(posterItems, settings, createListPosterCanvasContext(tab));
    await downloadCanvasAsPng(canvas, buildListPosterFilename(tab, settings));
    setStatus(t("listPosterSaved"), "ok");
  } catch (error) {
    if (isRateLimitError(error)) {
      setRateLimited(error, "cover");
    } else {
      setRawError(error);
      setStatus(error.message || t("networkFailed"), "err");
    }
  } finally {
    setBusy(false);
  }
}

async function ensurePosterStoreItems(appids, options = {}) {
  const missing = appids.filter(appid => !hasFreshPosterStoreItem(appid));
  if (!missing.length) {
    return;
  }
  const total = Math.ceil(missing.length / SHAREABILITY_BATCH_SIZE);
  for (let index = 0; index < missing.length; index += SHAREABILITY_BATCH_SIZE) {
    setStatus(t(options.statusKey || "fetchingFamilyPoster", { current: Math.floor(index / SHAREABILITY_BATCH_SIZE) + 1, total }), "warn");
    await fetchStoreItemBatch(missing.slice(index, index + SHAREABILITY_BATCH_SIZE), {
      include_basic_info: true,
      include_assets: true,
      include_all_purchase_options: true
    }, `${options.rawPrefix || "poster"}.batch${Date.now()}.${index}`);
  }
  saveState();
}

function hasFreshPosterStoreItem(appid) {
  const entry = getState().storeCache?.[String(appid || "")];
  return Boolean(isFreshStoreItemCacheEntry(entry));
}

function buildFamilyPosterItems(appids, settings = getFamilyPosterSettings()) {
  const items = appids.map((appid, index) => {
    const familyInfo = getState().familyLibrary?.appInfoById?.[String(appid)] || {};
    const storeEntry = getState().storeCache?.[String(appid)] || {};
    const price = normalizeStoreItemOriginalPrice(storeEntry.storeItem) || storeEntry.price || null;
    return {
      appid: String(appid),
      dataIndex: index,
      title: getCachedLocalizedName(appid) || familyInfo.name || `App ${appid}`,
      coverUrl: getFamilyPosterCoverUrl(appid),
      priceValue: Number(price?.initial ?? -1),
      acquiredAt: Number(familyInfo.time || 0),
      ownerCount: Array.isArray(familyInfo.owners) ? familyInfo.owners.length : 0
    };
  });
  return sortFamilyPosterItems(items, settings);
}

function buildListPosterItems(rows, settings = getListPosterSettings(getCurrentTab())) {
  const items = rows.map((game, index) => {
    const appid = String(game.appid || "");
    const storeEntry = getState().storeCache?.[appid] || {};
    const price = normalizeStoreItemOriginalPrice(storeEntry.storeItem) || game.price || storeEntry.price || null;
    return {
      appid,
      dataIndex: index,
      title: getCachedLocalizedName(appid) || getGameDisplayName(game),
      coverUrl: getFamilyPosterCoverUrl(appid),
      priceValue: getPosterPriceSortValue(price),
      acquiredAt: Number(game.time || 0),
      ownerCount: Array.isArray(game.owners) ? game.owners.length : 0,
      ownersText: formatOwners(game.owners || []),
      targetOwnersText: formatTargetOwners(game.targetOwners || []),
      statusText: getGameListLabel(appid)
    };
  });
  return sortFamilyPosterItems(items, settings);
}

function getFamilyPosterCoverUrl(appid) {
  const entry = getState().storeCache?.[String(appid || "")];
  return extractStorePosterCoverUrlFromStoreItem(entry?.storeItem || null) || getCachedStoreCoverUrl(appid);
}

function getPosterPriceSortValue(price) {
  if (!price || price.unavailable || price.initial == null) {
    return Number.NEGATIVE_INFINITY;
  }
  return Number(price.initial || 0);
}

function sortFamilyPosterItems(items, settings = getFamilyPosterSettings()) {
  const sortMode = String(settings.sortMode || "data");
  const output = items.slice();
  if (sortMode === "data" || sortMode === "current") {
    return output;
  }
  const collator = new Intl.Collator(getNumberLocale(), { numeric: true, sensitivity: "base" });
  const compareText = (left, right, key, direction = "asc") => {
    const result = collator.compare(String(left[key] || ""), String(right[key] || ""));
    return direction === "desc" ? -result : result;
  };
  output.sort((left, right) => {
    switch (sortMode) {
      case "titleAsc":
        return collator.compare(left.title, right.title) || left.dataIndex - right.dataIndex;
      case "titleDesc":
        return collator.compare(right.title, left.title) || left.dataIndex - right.dataIndex;
      case "appidAsc":
        return Number(left.appid || 0) - Number(right.appid || 0) || left.dataIndex - right.dataIndex;
      case "appidDesc":
        return Number(right.appid || 0) - Number(left.appid || 0) || left.dataIndex - right.dataIndex;
      case "priceDesc":
        return Number(right.priceValue || -1) - Number(left.priceValue || -1) || left.dataIndex - right.dataIndex;
      case "priceAsc":
        return Number(left.priceValue || -1) - Number(right.priceValue || -1) || left.dataIndex - right.dataIndex;
      case "acquiredDesc":
        return Number(right.acquiredAt || 0) - Number(left.acquiredAt || 0) || left.dataIndex - right.dataIndex;
      case "acquiredAsc":
        return Number(left.acquiredAt || 0) - Number(right.acquiredAt || 0) || left.dataIndex - right.dataIndex;
      case "ownersAsc":
        return compareText(left, right, "ownersText") || left.dataIndex - right.dataIndex;
      case "ownersDesc":
        return compareText(left, right, "ownersText", "desc") || left.dataIndex - right.dataIndex;
      case "targetOwnersAsc":
        return compareText(left, right, "targetOwnersText") || left.dataIndex - right.dataIndex;
      case "targetOwnersDesc":
        return compareText(left, right, "targetOwnersText", "desc") || left.dataIndex - right.dataIndex;
      case "statusAsc":
        return compareText(left, right, "statusText") || left.dataIndex - right.dataIndex;
      case "statusDesc":
        return compareText(left, right, "statusText", "desc") || left.dataIndex - right.dataIndex;
      case "ownerCountDesc":
        return Number(right.ownerCount || 0) - Number(left.ownerCount || 0) || left.dataIndex - right.dataIndex;
      case "ownerCountAsc":
        return Number(left.ownerCount || 0) - Number(right.ownerCount || 0) || left.dataIndex - right.dataIndex;
      case "hasCoverFirst":
        return Number(Boolean(right.coverUrl)) - Number(Boolean(left.coverUrl)) || left.dataIndex - right.dataIndex;
      case "noCoverFirst":
        return Number(Boolean(left.coverUrl)) - Number(Boolean(right.coverUrl)) || left.dataIndex - right.dataIndex;
      default:
        return left.dataIndex - right.dataIndex;
    }
  });
  return output;
}

async function renderFamilyPosterCanvas(items, settings = getFamilyPosterSettings(), posterContext = createFamilyPosterDialogContext()) {
  const loadedItems = await loadFamilyPosterImages(items);
  const metrics = createFamilyPosterMetrics();
  const layout = buildFamilyPosterLayout(loadedItems, metrics, settings);
  if (layout.height > FAMILY_POSTER_MAX_HEIGHT) {
    throw new Error(t(posterContext.kind === "list" ? "listPosterTooLarge" : "familyPosterTooLarge"));
  }
  const canvas = document.createElement("canvas");
  canvas.width = metrics.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(t("networkFailed"));
  }
  drawFamilyPosterBackground(context, canvas.width, canvas.height);
  drawFamilyPosterHeader(context, canvas.width, items.length, metrics, posterContext);
  layout.cards.forEach(card => drawFamilyPosterCard(context, card, metrics));
  return scaleFamilyPosterCanvas(canvas, settings);
}

async function loadFamilyPosterImages(items) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(FAMILY_POSTER_IMAGE_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await loadFamilyPosterImage(items[index]);
    }
  }));
  return results.filter(Boolean);
}

function loadFamilyPosterImage(item) {
  return new Promise(resolve => {
    if (!item.coverUrl) {
      resolve({
        ...item,
        image: null,
        width: 2,
        height: 3
      });
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve({
      ...item,
      image,
      width: image.naturalWidth || image.width || 1,
      height: image.naturalHeight || image.height || 1
    });
    image.onerror = () => resolve({
      ...item,
      image: null,
      width: 2,
      height: 3
    });
    image.src = item.coverUrl;
  });
}

function createFamilyPosterMetrics() {
  return {
    scale: 1,
    width: FAMILY_POSTER_WIDTH,
    padding: FAMILY_POSTER_PADDING,
    gap: FAMILY_POSTER_GAP,
    cardWidth: FAMILY_POSTER_CARD_WIDTH,
    headerHeight: FAMILY_POSTER_HEADER_HEIGHT,
    radius: 8,
    titleFontSize: 18,
    titleLineHeight: 20,
    emptyTitleTop: 44,
    headerTitleFontSize: 42,
    headerMetaFontSize: 24,
    cardAspectRatio: FAMILY_POSTER_CARD_ASPECT_RATIO
  };
}

function scaleFamilyPosterCanvas(canvas, settings = getFamilyPosterSettings()) {
  const scale = normalizeFamilyPosterScalePercent(settings.scalePercent) / 100;
  if (scale >= 1) {
    return canvas;
  }
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(canvas.width * scale));
  output.height = Math.max(1, Math.round(canvas.height * scale));
  const outputContext = output.getContext("2d");
  if (!outputContext) {
    return canvas;
  }
  outputContext.drawImage(canvas, 0, 0, output.width, output.height);
  return output;
}

function buildFamilyPosterLayout(items, metrics, settings = getFamilyPosterSettings()) {
  const columns = normalizeFamilyPosterColumns(settings.columns);
  const cardWidth = metrics.cardWidth;
  const cardHeight = Math.max(160, Math.round(cardWidth * metrics.cardAspectRatio));
  metrics.width = metrics.padding * 2 + columns * cardWidth + Math.max(0, columns - 1) * metrics.gap;
  const columnHeights = Array(columns).fill(metrics.headerHeight + metrics.padding);
  const cards = items.map(item => {
    const targetColumn = columnHeights.indexOf(Math.min(...columnHeights));
    const card = {
      ...item,
      x: metrics.padding + targetColumn * (cardWidth + metrics.gap),
      y: columnHeights[targetColumn],
      width: cardWidth,
      height: cardHeight
    };
    columnHeights[targetColumn] += cardHeight + metrics.gap;
    return card;
  });
  return {
    cards,
    height: Math.max(...columnHeights) + metrics.padding
  };
}

function drawFamilyPosterBackground(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#14202b");
  gradient.addColorStop(1, "#0b1016");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(102, 192, 244, 0.08)";
  context.beginPath();
  context.arc(220, 110, 180, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(width - 240, 180, 220, 0, Math.PI * 2);
  context.fill();
}

function drawFamilyPosterHeader(context, width, gameCount, metrics, posterContext = createFamilyPosterDialogContext()) {
  const familyName = posterContext.headerTitle || getState().familyInfo?.family_name || t("notRefreshed");
  context.fillStyle = "#ffffff";
  context.font = `700 ${metrics.headerTitleFontSize}px 'Motiva Sans', Arial, sans-serif`;
  context.fillText(familyName, metrics.padding, Math.round(56 * metrics.scale));
  context.fillStyle = "#9fb3c2";
  context.font = `${metrics.headerMetaFontSize}px 'Motiva Sans', Arial, sans-serif`;
  const metaY = Math.round(94 * metrics.scale);
  const stamp = formatDateTime(Date.now());
  context.fillText(`${gameCount} ${getUiLocale() === "en" ? "games" : "款游戏"}`, metrics.padding, metaY);
  context.fillText(stamp, width - metrics.padding - context.measureText(stamp).width, metaY);
}

function drawFamilyPosterCard(context, card, metrics) {
  context.save();
  roundRectPath(context, card.x, card.y, card.width, card.height, metrics.radius);
  context.fillStyle = "#0f141b";
  context.fill();
  context.clip();
  if (card.image) {
    const actualFit = getPosterImageFit(card.width, card.height, card.image.naturalWidth || card.width, card.image.naturalHeight || card.height);
    context.drawImage(card.image, card.x + actualFit.x, card.y + actualFit.y, actualFit.width, actualFit.height);
  } else {
    context.fillStyle = "#18222c";
    context.fillRect(card.x, card.y, card.width, card.height);
    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    context.fillRect(card.x, card.y, card.width, 1);
    context.fillStyle = "#ffffff";
    context.font = `600 ${metrics.titleFontSize}px 'Motiva Sans', Arial, sans-serif`;
    const emptyTitleLines = wrapPosterTextLines(context, card.title, card.width - 24);
    fillPosterTextCentered(context, emptyTitleLines, card.x + card.width / 2, card.y + metrics.emptyTitleTop, metrics.titleLineHeight);
    context.restore();
    return;
  }
  const overlay = context.createLinearGradient(0, card.y + card.height * 0.45, 0, card.y + card.height);
  overlay.addColorStop(0, "rgba(8, 12, 18, 0)");
  overlay.addColorStop(1, "rgba(8, 12, 18, 0.9)");
  context.fillStyle = overlay;
  context.fillRect(card.x, card.y, card.width, card.height);
  context.fillStyle = "#ffffff";
  context.font = `600 ${metrics.titleFontSize}px 'Motiva Sans', Arial, sans-serif`;
  const titleLines = wrapPosterTextLines(context, card.title, card.width - 24);
  const startY = card.y + card.height - Math.round(16 * metrics.scale) - Math.max(0, titleLines.length - 1) * metrics.titleLineHeight;
  fillPosterText(context, titleLines, card.x + 12, startY, metrics.titleLineHeight);
  context.restore();
}

function getPosterImageFit(cardWidth, cardHeight, imageWidth, imageHeight) {
  const scale = Math.min(cardWidth / Math.max(1, imageWidth), cardHeight / Math.max(1, imageHeight));
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  return {
    width,
    height,
    x: Math.round((cardWidth - width) / 2),
    y: Math.round((cardHeight - height) / 2)
  };
}

function roundRectPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function wrapPosterTextLines(context, text, maxWidth) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return [];
  }
  const chars = Array.from(normalized);
  const lines = [];
  let current = "";
  chars.forEach(char => {
    const next = current + char;
    if (context.measureText(next).width <= maxWidth || !current) {
      current = next;
      return;
    }
    lines.push(current);
    current = char;
  });
  if (current) {
    lines.push(current);
  }
  return lines;
}

function fillPosterText(context, lines, x, y, lineHeight) {
  (lines || []).forEach((line, index) => {
    context.fillText(String(line || ""), x, y + index * lineHeight);
  });
}

function fillPosterTextCentered(context, lines, centerX, y, lineHeight) {
  (lines || []).forEach((line, index) => {
    const text = String(line || "");
    const textWidth = context.measureText(text).width;
    context.fillText(text, centerX - textWidth / 2, y + index * lineHeight);
  });
}

async function downloadCanvasAsPng(canvas, filename) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error(t("networkFailed"));
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function buildFamilyPosterFilename(settings = getFamilyPosterSettings()) {
  const familyName = sanitizeFilename(getState().familyInfo?.family_name || "steam-family");
  const stamp = new Date().toISOString().slice(0, 10);
  const normalized = normalizeFamilyPosterSettings(settings);
  return `${familyName || "steam-family"}-covers-${normalized.columns}-${normalized.sortMode}-${normalized.scalePercent}%-${stamp}.png`;
}

function buildListPosterFilename(tab, settings = getListPosterSettings(tab)) {
  const title = sanitizeFilename(getTabLabel(normalizeMainTab(tab)) || "steam-list");
  const stamp = new Date().toISOString().slice(0, 10);
  const normalized = normalizeListPosterSettings(settings, tab);
  return `${title || "steam-list"}-covers-${normalized.columns}-${normalized.sortMode}-${normalized.scalePercent}%-${stamp}.png`;
}

function sanitizeFilename(value) {
  return String(value || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
}

async function refetchVisibleCoverUrls() {
  const appids = getVisibleCoverAppids();
  if (!appids.length) {
    return;
  }
  for (const appid of appids) {
    clearCachedStoreCoverUrl(appid);
  }
  for (let index = 0; index < appids.length; index += COVER_RELOAD_BATCH_SIZE) {
    await fetchCoverUrlBatch(appids.slice(index, index + COVER_RELOAD_BATCH_SIZE));
  }
}

function getVisibleCoverAppids() {
  const appids = new Set();
  if (getListViewMode() === "cover") {
    getVisibleAppidsFromContainer(getElements().tableWrap, ".sffa-cover-card").forEach(appid => appids.add(appid));
  }
  if (isCompareDialogOpen()) {
    getVisibleAppidsFromContainer(getElements().compareSummary, ".sffa-compare-card-game-link").forEach(appid => appids.add(appid));
  }
  return Array.from(appids);
}

function shouldProcessVisibleCovers() {
  return getListViewMode() === "cover" || isCompareDialogOpen();
}

function getVisibleAppidsFromContainer(container, selector) {
  if (!container) {
    return [];
  }
  const nodes = Array.from(container.querySelectorAll(selector));
  if (!nodes.length) {
    return [];
  }
  const wrapRect = container.getBoundingClientRect();
  const visibleNodes = nodes.filter(node => {
    const rect = node.getBoundingClientRect();
    return rect.bottom >= wrapRect.top && rect.top <= wrapRect.bottom;
  });
  return (visibleNodes.length ? visibleNodes : nodes.slice(0, 20))
    .map(extractAppidFromNode)
    .filter(appid => /^\d+$/.test(appid));
}

function extractAppidFromNode(node) {
  const directHref = String(node?.getAttribute?.("href") || "");
  if (directHref) {
    const directMatch = directHref.match(/\/app\/(\d+)\//);
    if (directMatch) {
      return directMatch[1];
    }
  }
  const nestedHref = String(node?.querySelector?.("a[href*='/app/']")?.getAttribute?.("href") || "");
  const nestedMatch = nestedHref.match(/\/app\/(\d+)\//);
  return nestedMatch ? nestedMatch[1] : "";
}

async function fetchCoverUrlBatch(appids, rawKey = `covers.batch${Date.now()}`, failedUrlByAppid = {}) {
  const itemById = await fetchStoreItemBatch(appids, {
    include_basic_info: true,
    include_assets: true
  }, rawKey);
  Object.entries(itemById).forEach(([appid, item]) => {
    const coverUrl = extractStoreCoverUrlFromStoreItem(item, failedUrlByAppid[String(appid)]);
    if (coverUrl) {
      cacheStoreCoverUrl(appid, coverUrl);
    }
  });
}

function clearCachedStoreCoverUrl(appid) {
  const key = String(appid || "");
  const entry = getState().storeCache?.[key];
  getCoverProbeState().verifiedUrlByAppid.delete(key);
  getCoverProbeState().failedUrlByAppid.delete(key);
  if (!entry) {
    return;
  }
  getState().storeCache[key] = {
    ...entry,
    coverUrl: "",
    coverVerified: false
  };
}


  return {
    clearCachedStoreCoverUrl,
    fetchCoverUrlBatch,
    generateFamilyPoster,
    generateListPoster,
    getVisibleCoverAppids,
    refetchVisibleCoverUrls,
    shouldProcessVisibleCovers
  };
};
