import type { PosterSettings, PosterSortMode, ResultGameListKey, ResultGameRow } from "../appTypes";
import { formatPrice, getFamilyOwnerText, getReportGameStatusLabel, getTargetOwnerText } from "./report";

const POSTER_COLUMNS = 10;
const POSTER_PADDING = 32;
const POSTER_GAP = 12;
const POSTER_CARD_WIDTH = 180;
const POSTER_CARD_ASPECT_RATIO = 1.5;
const POSTER_HEADER_HEIGHT = 120;
const POSTER_MAX_HEIGHT = 30000;
const POSTER_IMAGE_CONCURRENCY = 8;

type PosterItem = {
  appid: string;
  title: string;
  coverUrl: string;
  dataIndex: number;
  priceValue: number;
  ownersText: string;
  targetOwnersText: string;
  statusText: string;
  image: HTMLImageElement | null;
};

export const defaultPosterSettings: PosterSettings = {
  columns: POSTER_COLUMNS,
  sortMode: "current",
  scalePercent: 100
};

export async function renderGameCoverPoster({
  games,
  listLabel,
  coverUrlsByAppid,
  settings
}: {
  games: ResultGameRow[];
  listLabel: string;
  coverUrlsByAppid: Record<string, string>;
  settings: PosterSettings;
}): Promise<string> {
  const posterItems = sortPosterItems(games.map((game, index) => ({
    appid: game.appid,
    title: game.name || `App ${game.appid}`,
    coverUrl: coverUrlsByAppid[game.appid] || "",
    dataIndex: index,
    priceValue: getPosterPriceSortValue(game),
    ownersText: getFamilyOwnerText(game),
    targetOwnersText: getTargetOwnerText(game),
    statusText: getReportGameStatusLabel(game.status)
  })), settings.sortMode);
  const items = await loadPosterItems(posterItems);
  const metrics = createPosterMetrics(settings);
  const layout = buildPosterLayout(items, metrics, settings);
  if (layout.height > POSTER_MAX_HEIGHT) {
    throw new Error("封面图过高，当前尺寸超出导出上限");
  }

  const canvas = document.createElement("canvas");
  canvas.width = metrics.width;
  canvas.height = layout.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("无法创建封面图画布");
  }

  drawPosterBackground(context, canvas.width, canvas.height);
  drawPosterHeader(context, canvas.width, games.length, listLabel, metrics);
  layout.cards.forEach(card => drawPosterCard(context, card, metrics));
  return scalePosterCanvas(canvas, settings).toDataURL("image/png");
}

export function buildGameCoverPosterFilename(listLabel: string, settings: PosterSettings = defaultPosterSettings): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const title = sanitizeFilename(listLabel) || "steam-list";
  return `${title}-covers-${settings.columns}-${settings.sortMode}-${settings.scalePercent}%-${stamp}.png`;
}

export function normalizePosterSettings(settings: Partial<PosterSettings>, allowedSortModes: readonly PosterSortMode[]): PosterSettings {
  return {
    columns: normalizePosterColumns(settings.columns),
    sortMode: allowedSortModes.includes(settings.sortMode || "current") ? settings.sortMode || "current" : "current",
    scalePercent: normalizePosterScalePercent(settings.scalePercent)
  };
}

export function buildListPosterSortModes(listKey: ResultGameListKey, includeTargetOwners: boolean): PosterSortMode[] {
  const modes: PosterSortMode[] = ["current", "titleAsc", "titleDesc", "appidAsc", "appidDesc"];
  if (listKey === "all") {
    if (includeTargetOwners) {
      modes.push("targetOwnersAsc", "targetOwnersDesc");
    }
    modes.push("statusAsc", "statusDesc");
  } else if (listKey === "new") {
    if (includeTargetOwners) {
      modes.push("targetOwnersAsc", "targetOwnersDesc");
    }
    modes.push("priceDesc", "priceAsc");
  } else if (listKey === "relativeNew") {
    modes.push("ownersAsc", "ownersDesc", "priceDesc", "priceAsc");
  } else if (listKey === "overlap") {
    modes.push("ownersAsc", "ownersDesc");
  }
  return modes;
}

export function getPosterSortModeLabel(mode: PosterSortMode): string {
  return {
    current: "默认（当前列表排序）",
    titleAsc: "名称升序",
    titleDesc: "名称降序",
    appidAsc: "AppID 升序",
    appidDesc: "AppID 降序",
    priceDesc: "价格降序",
    priceAsc: "价格升序",
    ownersAsc: "贡献者升序",
    ownersDesc: "贡献者降序",
    targetOwnersAsc: "目标拥有者升序",
    targetOwnersDesc: "目标拥有者降序",
    statusAsc: "状态升序",
    statusDesc: "状态降序"
  }[mode];
}

export function normalizePosterColumns(value: number | undefined): number {
  const columns = Number(value || POSTER_COLUMNS);
  const fallbackColumns = Number.isFinite(columns) ? columns : POSTER_COLUMNS;
  return Math.round(Math.max(1, Math.min(50, fallbackColumns)));
}

export function normalizePosterScalePercent(value: number | undefined): number {
  const scale = Number(value || 100);
  return Math.round(Math.max(40, Math.min(100, Number.isFinite(scale) ? scale : 100)) / 5) * 5;
}

async function loadPosterItems(items: Array<Omit<PosterItem, "image">>): Promise<PosterItem[]> {
  const results = new Array<PosterItem>(items.length);
  let cursor = 0;
  const workerCount = Math.min(POSTER_IMAGE_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await loadPosterImage(items[index]);
    }
  }));
  return results.filter(Boolean);
}

function loadPosterImage(item: Omit<PosterItem, "image">): Promise<PosterItem> {
  return new Promise(resolve => {
    if (!item.coverUrl) {
      resolve({ ...item, image: null });
      return;
    }
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve({ ...item, image });
    image.onerror = () => resolve({ ...item, image: null });
    image.src = item.coverUrl;
  });
}

function createPosterMetrics(settings: PosterSettings) {
  const columns = normalizePosterColumns(settings.columns);
  return {
    width: POSTER_PADDING * 2 + columns * POSTER_CARD_WIDTH + (columns - 1) * POSTER_GAP,
    padding: POSTER_PADDING,
    gap: POSTER_GAP,
    cardWidth: POSTER_CARD_WIDTH,
    headerHeight: POSTER_HEADER_HEIGHT,
    radius: 8,
    titleFontSize: 18,
    titleLineHeight: 20,
    emptyTitleTop: 44,
    headerTitleFontSize: 42,
    headerMetaFontSize: 24,
    cardAspectRatio: POSTER_CARD_ASPECT_RATIO
  };
}

function buildPosterLayout(items: PosterItem[], metrics: ReturnType<typeof createPosterMetrics>, settings: PosterSettings) {
  const columns = normalizePosterColumns(settings.columns);
  const cardHeight = Math.max(160, Math.round(metrics.cardWidth * metrics.cardAspectRatio));
  const columnHeights = Array(columns).fill(metrics.headerHeight + metrics.padding);
  const cards = items.map(item => {
    const targetColumn = columnHeights.indexOf(Math.min(...columnHeights));
    const card = {
      ...item,
      x: metrics.padding + targetColumn * (metrics.cardWidth + metrics.gap),
      y: columnHeights[targetColumn],
      width: metrics.cardWidth,
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

function scalePosterCanvas(canvas: HTMLCanvasElement, settings: PosterSettings): HTMLCanvasElement {
  const scale = normalizePosterScalePercent(settings.scalePercent) / 100;
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

function sortPosterItems(items: Array<Omit<PosterItem, "image">>, sortMode: PosterSortMode): Array<Omit<PosterItem, "image">> {
  if (sortMode === "current") {
    return items;
  }
  const output = items.slice();
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  const compareText = (left: Omit<PosterItem, "image">, right: Omit<PosterItem, "image">, key: "ownersText" | "targetOwnersText" | "statusText", direction: "asc" | "desc" = "asc") => {
    const result = collator.compare(left[key], right[key]);
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
        return right.priceValue - left.priceValue || left.dataIndex - right.dataIndex;
      case "priceAsc":
        return left.priceValue - right.priceValue || left.dataIndex - right.dataIndex;
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
      default:
        return left.dataIndex - right.dataIndex;
    }
  });
  return output;
}

function getPosterPriceSortValue(game: ResultGameRow): number {
  const formatted = formatPrice(game.price);
  if (!game.price || game.price.unavailable || game.price.initial == null || formatted === "-") {
    return Number.NEGATIVE_INFINITY;
  }
  return Number(game.price.initial || 0);
}

function drawPosterBackground(context: CanvasRenderingContext2D, width: number, height: number): void {
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

function drawPosterHeader(
  context: CanvasRenderingContext2D,
  width: number,
  gameCount: number,
  listLabel: string,
  metrics: ReturnType<typeof createPosterMetrics>
): void {
  context.fillStyle = "#ffffff";
  context.font = `700 ${metrics.headerTitleFontSize}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  context.fillText(listLabel || "游戏封面", metrics.padding, 56);
  context.fillStyle = "#9fb3c2";
  context.font = `${metrics.headerMetaFontSize}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
  context.fillText(`${gameCount} 款游戏`, metrics.padding, 94);
  context.fillText(stamp, width - metrics.padding - context.measureText(stamp).width, 94);
}

function drawPosterCard(
  context: CanvasRenderingContext2D,
  card: PosterItem & { x: number; y: number; width: number; height: number },
  metrics: ReturnType<typeof createPosterMetrics>
): void {
  context.save();
  roundRectPath(context, card.x, card.y, card.width, card.height, metrics.radius);
  context.fillStyle = "#0f141b";
  context.fill();
  context.clip();
  if (card.image) {
    const fit = getPosterImageFit(
      card.width,
      card.height,
      card.image.naturalWidth || card.width,
      card.image.naturalHeight || card.height
    );
    context.drawImage(card.image, card.x + fit.x, card.y + fit.y, fit.width, fit.height);
  } else {
    context.fillStyle = "#18222c";
    context.fillRect(card.x, card.y, card.width, card.height);
    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    context.fillRect(card.x, card.y, card.width, 1);
    context.fillStyle = "#ffffff";
    context.font = `600 ${metrics.titleFontSize}px "Microsoft YaHei", "Segoe UI", sans-serif`;
    fillPosterTextCentered(context, wrapPosterTextLines(context, card.title, card.width - 24), card.x + card.width / 2, card.y + metrics.emptyTitleTop, metrics.titleLineHeight);
    context.restore();
    return;
  }

  const overlay = context.createLinearGradient(0, card.y + card.height * 0.45, 0, card.y + card.height);
  overlay.addColorStop(0, "rgba(8, 12, 18, 0)");
  overlay.addColorStop(1, "rgba(8, 12, 18, 0.9)");
  context.fillStyle = overlay;
  context.fillRect(card.x, card.y, card.width, card.height);
  context.fillStyle = "#ffffff";
  context.font = `600 ${metrics.titleFontSize}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  const titleLines = wrapPosterTextLines(context, card.title, card.width - 24).slice(0, 2);
  const startY = card.y + card.height - 16 - Math.max(0, titleLines.length - 1) * metrics.titleLineHeight;
  fillPosterText(context, titleLines, card.x + 12, startY, metrics.titleLineHeight);
  context.restore();
}

function getPosterImageFit(cardWidth: number, cardHeight: number, imageWidth: number, imageHeight: number) {
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

function roundRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function wrapPosterTextLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const chars = Array.from(String(text || "").trim());
  const lines: string[] = [];
  let current = "";
  for (const char of chars) {
    const next = current + char;
    if (context.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = char;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function fillPosterText(context: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number): void {
  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
}

function fillPosterTextCentered(context: CanvasRenderingContext2D, lines: string[], centerX: number, y: number, lineHeight: number): void {
  lines.forEach((line, index) => {
    context.fillText(line, centerX - context.measureText(line).width / 2, y + index * lineHeight);
  });
}

function sanitizeFilename(value: string): string {
  return String(value || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
}
