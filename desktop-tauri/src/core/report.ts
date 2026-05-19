import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import type { AnalysisReport, PriceInfo, PriceMode, ReportGame, ReportGameStatus } from "../types";
import type {
  AnalysisHistoryAccount,
  MetricTooltipRow,
  OwnerTagItem,
  ResultGameListKey,
  ResultGameRow,
  ResultMetric,
  SortSelectOption,
  TableSortDirection,
  TableSortState
} from "../appTypes";

export function buildResultGameRows(games: ReportGame[], priceMode: PriceMode): ResultGameRow[] {
  return games.map(game => {
    const originalName = game.name || `App ${game.appid}`;
    const localizedName = getReportGameLocalizedName(game);
    const displayName = localizedName || originalName;
    return {
      appid: game.appid,
      name: displayName,
      originalName,
      localizedName,
      searchText: buildGameSearchText(game.appid, displayName, originalName, localizedName),
      storeLink: game.storeLink || `https://store.steampowered.com/app/${game.appid}/`,
      coverUrl: game.coverUrl,
      ownerNames: game.targetOwnerNames,
      ownerIds: game.targetOwners,
      familyOwners: game.familyOwners,
      familyOwnerNames: game.familyOwnerNames || [],
      price: getReportGamePrice(game, priceMode),
      status: game.status
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN", {
    numeric: true,
    sensitivity: "base"
  }));
}

function getReportGameLocalizedName(game: ReportGame): string {
  return game.localizedName
    || game.prices?.original?.localizedName
    || game.prices?.historyLow?.localizedName
    || game.price?.localizedName
    || "";
}

export function matchesResultGameSearch(game: ResultGameRow, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }
  return game.searchText.includes(normalizedQuery)
    || game.searchText.includes(compactSearchText(normalizedQuery));
}

function buildGameSearchText(
  appid: string,
  displayName: string,
  originalName: string,
  localizedName: string
): string {
  const terms = new Set<string>();
  for (const value of [appid, displayName, originalName, localizedName]) {
    addSearchTerm(terms, value);
    addSearchTerm(terms, compactSearchText(value));
    addSearchTerm(terms, buildWordInitials(value));
    addSearchTerm(terms, buildPinyinInitials(value));
  }
  return Array.from(terms).join("\n");
}

function addSearchTerm(terms: Set<string>, value: string): void {
  const normalized = normalizeSearchText(value);
  if (normalized) {
    terms.add(normalized);
  }
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function buildWordInitials(value: string): string {
  return value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(word => word[0])
    .join("");
}

function buildPinyinInitials(value: string): string {
  return Array.from(value)
    .map(char => getPinyinInitial(char))
    .join("");
}

function getPinyinInitial(char: string): string {
  if (/^[a-z0-9]$/i.test(char)) {
    return char.toLowerCase();
  }
  if (!/[\u4e00-\u9fff]/.test(char)) {
    return "";
  }

  let initial = "a";
  for (const [letter, boundary] of pinyinInitialBoundaries) {
    if (pinyinCollator.compare(char, boundary) < 0) {
      return initial;
    }
    initial = letter;
  }
  return initial;
}

const pinyinCollator = new Intl.Collator("zh-Hans-u-co-pinyin", {
  sensitivity: "base"
});

const pinyinInitialBoundaries: Array<[string, string]> = [
  ["a", "阿"],
  ["b", "八"],
  ["c", "嚓"],
  ["d", "咑"],
  ["e", "妸"],
  ["f", "发"],
  ["g", "旮"],
  ["h", "铪"],
  ["j", "讥"],
  ["k", "咔"],
  ["l", "垃"],
  ["m", "妈"],
  ["n", "拏"],
  ["o", "噢"],
  ["p", "妑"],
  ["q", "七"],
  ["r", "呥"],
  ["s", "仨"],
  ["t", "他"],
  ["w", "屲"],
  ["x", "夕"],
  ["y", "丫"],
  ["z", "帀"]
];

export function getReportGamePrice(game: ReportGame, priceMode: PriceMode): PriceInfo | null {
  if (priceMode === "historyLow") {
    return game.prices?.historyLow || (game.price?.source === "itadStoreLow" ? game.price : null);
  }
  return game.prices?.original || (game.price?.source !== "itadStoreLow" ? game.price : null);
}

export function reportHasPriceModeData(report: AnalysisReport, priceMode: PriceMode): boolean {
  return report.games.all
    .concat(report.games.relativeNew)
    .some(game => Boolean(getReportGamePrice(game, priceMode)));
}

export function buildResultMetrics(report: AnalysisReport, priceMode: PriceMode): ResultMetric[] {
  const targets = report.targets;
  const familyCount = report.familyGameCount;
  const targetLabelById = new Map(targets.map(target => [
    target.steamid64,
    target.displayName || target.steamid64 || "未知账号"
  ]));
  const targetIds = targets.map(target => target.steamid64);
  const totalRows: MetricTooltipRow[] = targets.map(target => ({
    label: targetLabelById.get(target.steamid64) || target.steamid64 || "未知账号",
    value: String(target.gameCount)
  }));
  const familyRows: MetricTooltipRow[] = targets.map(target => ({
    label: targetLabelById.get(target.steamid64) || target.steamid64 || "未知账号",
    value: String(familyCount)
  }));
  const addedRows: MetricTooltipRow[] = targetIds.map(steamid64 => ({
    label: targetLabelById.get(steamid64) || steamid64 || "未知账号",
    value: String(countGamesForTarget(report.games.new, steamid64))
  }));
  const addedValueRows: MetricTooltipRow[] = targetIds.map(steamid64 => ({
    label: targetLabelById.get(steamid64) || steamid64 || "未知账号",
    value: formatMoneyFromMinor(sumGamePricesForTarget(report.games.new, steamid64, priceMode), getReportCurrency(report.games.new, priceMode))
  }));
  const overlapRows: MetricTooltipRow[] = targetIds.map(steamid64 => ({
    label: targetLabelById.get(steamid64) || steamid64 || "未知账号",
    value: String(countGamesForTarget(report.games.overlap, steamid64))
  }));
  const overlapRateRows: MetricTooltipRow[] = targetIds.map(steamid64 => ({
    label: targetLabelById.get(steamid64) || steamid64 || "未知账号",
    value: formatPercent(familyCount ? countGamesForTarget(report.games.overlap, steamid64) / familyCount : 0)
  }));

  return [
    { label: "家庭库", value: String(familyCount), tooltipRows: familyRows },
    { label: "总游戏", value: String(report.games.all.length), tooltipRows: totalRows },
    { label: "新增", value: String(report.games.new.length), tooltipRows: addedRows },
    {
      label: "新增价值",
      value: formatMoneyFromMinor(sumGamePrices(report.games.new, priceMode), getReportCurrency(report.games.new, priceMode)),
      tooltipRows: addedValueRows
    },
    { label: "重复", value: String(report.games.overlap.length), tooltipRows: overlapRows },
    {
      label: "重复率",
      value: formatPercent(familyCount ? report.games.overlap.length / familyCount : 0),
      tooltipRows: overlapRateRows
    }
  ];
}

function countGamesForTarget(games: ReportGame[], steamid64: string): number {
  return games.filter(game => game.targetOwners.includes(steamid64)).length;
}

function sumGamePricesForTarget(games: ReportGame[], steamid64: string, priceMode: PriceMode): number {
  return sumGamePrices(games.filter(game => game.targetOwners.includes(steamid64)), priceMode);
}

function sumGamePrices(games: ReportGame[], priceMode: PriceMode): number {
  return games.reduce((sum, game) => {
    const price = getReportGamePrice(game, priceMode);
    return isCountablePrice(price) ? sum + Number(price.initial || 0) : sum;
  }, 0);
}

function isCountablePrice(price: PriceInfo | null): price is PriceInfo {
  return Boolean(price && !price.unavailable && price.initial != null);
}

function getReportCurrency(games: ReportGame[], priceMode: PriceMode): string {
  return games
    .map(game => getReportGamePrice(game, priceMode))
    .find(price => isCountablePrice(price))?.currency || "CNY";
}

export function sortTableGameRows(games: ResultGameRow[], sort?: TableSortState): ResultGameRow[] {
  if (!sort?.key) {
    return games;
  }
  const direction = sort.direction === "desc" ? -1 : 1;
  return games.slice().sort((left, right) => compareTableSortValues(left, right, sort.key) * direction);
}

function compareTableSortValues(left: ResultGameRow, right: ResultGameRow, key: string): number {
  const leftValue = getTableSortValue(left, key);
  const rightValue = getTableSortValue(right, key);
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    const diff = leftValue - rightValue;
    return diff === 0 ? compareGameName(left, right) : diff;
  }
  const result = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
  return result === 0 ? compareGameName(left, right) : result;
}

function getTableSortValue(game: ResultGameRow, key: string): string | number {
  if (key === "appid") {
    return Number(game.appid || 0);
  }
  if (key === "name") {
    return game.name;
  }
  if (key === "status") {
    return getReportGameStatusLabel(game.status);
  }
  if (key === "owners") {
    return getFamilyOwnerText(game);
  }
  if (key === "targetOwners") {
    return getTargetOwnerText(game);
  }
  if (key === "price") {
    return getTablePriceSortValue(game.price);
  }
  return "";
}

function getTablePriceSortValue(price: PriceInfo | null): number {
  if (!price) {
    return Number.POSITIVE_INFINITY;
  }
  if (price.unavailable) {
    return Number.NEGATIVE_INFINITY;
  }
  if (price.initial == null) {
    return Number.POSITIVE_INFINITY;
  }
  return Number(price.initial || 0);
}

function compareGameName(left: ResultGameRow, right: ResultGameRow): number {
  return left.name.localeCompare(right.name, "zh-CN", {
    numeric: true,
    sensitivity: "base"
  }) || left.appid.localeCompare(right.appid, "zh-CN", { numeric: true });
}

export function getReportGameStatusLabel(status: ReportGameStatus): string {
  if (status === "new") {
    return "新增";
  }
  if (status === "overlap") {
    return "重复";
  }
  if (status === "currentOwned") {
    return "不计入新增";
  }
  if (status === "unsupported") {
    return "不可共享";
  }
  if (status === "noValue") {
    return "无新增价值";
  }
  return "-";
}

export function getGameOwnerSummary(game: ResultGameRow): string {
  if (game.status === "overlap" && game.familyOwners.length) {
    return `${game.familyOwners.length} 个家庭成员拥有`;
  }
  return game.ownerNames.length > 1 ? `${game.ownerNames.length} 个目标账号拥有` : game.ownerNames[0] || "-";
}

export function getGameOwnerDetail(game: ResultGameRow): string {
  if (game.status === "overlap" && game.familyOwners.length) {
    return getFamilyOwnerText(game);
  }
  return game.ownerNames.length ? game.ownerNames.join("、") : game.ownerIds.join("、");
}

export function getGameCardOwnerText(game: ResultGameRow, listKey: ResultGameListKey): string {
  if (listKey === "all" || listKey === "new") {
    return getTargetOwnerText(game);
  }
  return getFamilyOwnerText(game);
}

export function getGameCardOwnerTags(game: ResultGameRow, listKey: ResultGameListKey): OwnerTagItem[] {
  if (listKey === "all" || listKey === "new") {
    return getTargetOwnerTags(game);
  }
  return getFamilyOwnerTags(game);
}

export function getTargetOwnerText(game: ResultGameRow): string {
  return game.ownerNames.length ? game.ownerNames.join("、") : game.ownerIds.join("、") || "-";
}

export function getFamilyOwnerText(game: ResultGameRow): string {
  return (game.familyOwnerNames.length ? game.familyOwnerNames : game.familyOwners).join("、") || "-";
}

export function getTargetOwnerTags(game: ResultGameRow): OwnerTagItem[] {
  return buildOwnerTags(game.ownerIds, game.ownerNames);
}

export function getFamilyOwnerTags(game: ResultGameRow): OwnerTagItem[] {
  return buildOwnerTags(game.familyOwners, game.familyOwnerNames);
}

function buildOwnerTags(ids: string[], names: string[]): OwnerTagItem[] {
  const ownerIds = ids.length ? ids : names;
  return ownerIds
    .map((id, index) => {
      const label = names[index] || id;
      return {
        id: id || label,
        label: label || id
      };
    })
    .filter(owner => owner.label);
}

export function getOwnerTagHue(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return `${hash}deg`;
}

export function buildTableSortSelectOptions(
  listKey: ResultGameListKey,
  includeTargetOwners: boolean,
  showAppId: boolean,
  priceLabel: string
): SortSelectOption[] {
  const columns: Array<{ key: string; label: string }> = [{ key: "name", label: "游戏" }];

  if ((listKey === "all" || listKey === "new") && includeTargetOwners) {
    columns.push({ key: "targetOwners", label: "拥有者" });
  }
  if (listKey === "relativeNew" || listKey === "overlap") {
    columns.push({ key: "owners", label: "贡献者" });
  }
  if (listKey === "all") {
    columns.push({ key: "status", label: "状态" });
  }
  if (listKey === "new" || listKey === "relativeNew") {
    columns.push({ key: "price", label: priceLabel });
  }
  if (showAppId) {
    columns.push({ key: "appid", label: "AppID" });
  }

  return columns.flatMap(column => [
    {
      value: serializeTableSortState({ key: column.key, direction: "asc" }),
      label: getTableSortOptionLabel(column.label, column.key, "asc")
    },
    {
      value: serializeTableSortState({ key: column.key, direction: "desc" }),
      label: getTableSortOptionLabel(column.label, column.key, "desc")
    }
  ]);
}

function getTableSortOptionLabel(label: string, key: string, direction: TableSortDirection): string {
  if (key === "name") {
    return direction === "asc" ? `${label} A-Z` : `${label} Z-A`;
  }
  if (key === "price") {
    return direction === "asc" ? `${label}从低到高` : `${label}从高到低`;
  }
  return `${label}${direction === "asc" ? "升序" : "降序"}`;
}

export function normalizeTableSortState(sort: TableSortState | undefined, options: SortSelectOption[]): TableSortState {
  if (sort && options.some(option => option.value === serializeTableSortState(sort))) {
    return sort;
  }
  return parseTableSortSelectValue(options[0]?.value);
}

export function serializeTableSortState(sort: TableSortState): string {
  return `table:${sort.key}:${sort.direction}`;
}

export function parseTableSortSelectValue(value: string | null | undefined): TableSortState {
  const [, key, direction] = String(value || "").split(":");
  return {
    key: key || "name",
    direction: direction === "desc" ? "desc" : "asc"
  };
}

export function formatPrice(price: PriceInfo | null): string {
  if (!price || price.unavailable || price.initial == null) {
    return "-";
  }
  return formatMoneyFromMinor(Number(price.initial || 0), price.currency || "CNY");
}

export function formatMoneyFromMinor(amount: number, currency: string): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    minimumFractionDigits: 0
  }).format(amount / 100);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatGameListText(games: ResultGameRow[]): string {
  if (!games.length) {
    return "";
  }
  return games.map(game => [
    game.name,
    game.appid,
    getReportGameStatusLabel(game.status),
    getGameOwnerDetail(game),
    formatPrice(game.price),
    game.storeLink
  ].join("\t")).join("\n");
}

export function formatGameNamesText(games: ResultGameRow[]): string {
  return games.map(game => game.name).join("\n");
}

export function buildReportTargetInput(report: AnalysisReport | null): string {
  if (!report) {
    return "";
  }
  return report.targets
    .map(target => target.steamid64 || target.profileUrl || target.displayName)
    .filter(Boolean)
    .join("\n");
}

export function formatReportText(report: AnalysisReport, priceMode: PriceMode): string {
  const resultMetrics = buildResultMetrics(report, priceMode);
  const lines = [
    "Steam 家庭库分析报告",
    ...resultMetrics.map(metric => `${metric.label}：${metric.value}`),
    "",
    "目标账号：",
    ...report.targets.map(target => `${target.displayName || target.steamid64}\t${target.steamid64}\t${target.gameCount} 个公开游戏`),
    "",
    "新增候选：",
    ...buildResultGameRows(report.games.new, priceMode).map(game => `${game.name}\t${game.appid}\t${formatPrice(game.price)}\t${game.storeLink}`)
  ];
  if (report.warnings.length) {
    lines.push("", "警告：", ...report.warnings);
  }
  return lines.join("\n");
}

export function getSteamCoverUrl(game: ResultGameRow, reloadToken = 0, coverCachePath = ""): string {
  const url = toAssetUrl(coverCachePath) || game.coverUrl || `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900_2x.jpg`;
  return reloadToken ? `${url}${url.includes("?") ? "&" : "?"}t=${reloadToken}` : url;
}

function toAssetUrl(filePath: string): string {
  if (!filePath || !isTauri()) {
    return "";
  }
  return convertFileSrc(filePath);
}

export function buildAnalysisHistoryKey(accounts: AnalysisHistoryAccount[], fallbackInput: string): string {
  const accountIds = accounts
    .map(account => account.steamid64.trim())
    .filter(steamid64 => /^\d{17}$/.test(steamid64))
    .sort();
  if (accountIds.length) {
    return accountIds.join("|");
  }
  return fallbackInput.trim().replace(/\s+/g, " ").toLowerCase();
}
