import type { AnalysisReport } from "../types";
import type { AnalysisHistoryEntry } from "../appTypes";
import { buildAnalysisHistoryKey, buildReportTargetInput } from "./report";

const analysisHistoryKey = "sffa.desktop.analysisInputHistory";
const lastAnalysisReportKey = "sffa.desktop.lastAnalysisReport";
let initialLastAnalysisReport: AnalysisReport | null | undefined;

export function getInitialLastAnalysisReport(): AnalysisReport | null {
  if (initialLastAnalysisReport === undefined) {
    initialLastAnalysisReport = loadLastAnalysisReport();
  }
  return initialLastAnalysisReport;
}

function loadLastAnalysisReport(): AnalysisReport | null {
  const raw = localStorage.getItem(lastAnalysisReportKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AnalysisReport;
    if (isAnalysisReport(parsed)) {
      return parsed;
    }
    localStorage.removeItem(lastAnalysisReportKey);
    return null;
  } catch {
    localStorage.removeItem(lastAnalysisReportKey);
    return null;
  }
}

export function saveLastAnalysisReport(report: AnalysisReport): void {
  localStorage.setItem(lastAnalysisReportKey, JSON.stringify(report));
  initialLastAnalysisReport = report;
}

function isAnalysisReport(value: unknown): value is AnalysisReport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const report = value as Partial<AnalysisReport>;
  return typeof report.targetCount === "number"
    && Array.isArray(report.targets)
    && Boolean(report.games)
    && typeof report.games === "object"
    && Array.isArray(report.games.all)
    && Array.isArray(report.games.new)
    && Array.isArray(report.games.relativeNew)
    && Array.isArray(report.games.overlap)
    && Array.isArray(report.games.currentOwned)
    && Array.isArray(report.games.notCurrentOwned)
    && Array.isArray(report.warnings);
}

export function loadAnalysisHistory(): AnalysisHistoryEntry[] {
  const raw = localStorage.getItem(analysisHistoryKey);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as AnalysisHistoryEntry[];
    return Array.isArray(parsed) ? normalizeAnalysisHistory(parsed) : [];
  } catch {
    localStorage.removeItem(analysisHistoryKey);
    return [];
  }
}

export function saveAnalysisHistory(history: AnalysisHistoryEntry[]): AnalysisHistoryEntry[] {
  const nextHistory = normalizeAnalysisHistory(history);
  localStorage.setItem(analysisHistoryKey, JSON.stringify(nextHistory));
  return nextHistory;
}

export function upsertAnalysisHistory(
  history: AnalysisHistoryEntry[],
  inputValue: string,
  report: AnalysisReport
): AnalysisHistoryEntry[] {
  const normalizedInput = inputValue.trim();
  const accounts = report.targets.map(target => ({
    displayName: target.displayName || target.steamid64 || normalizedInput,
    steamid64: target.steamid64 || "-"
  }));
  const historyKey = buildAnalysisHistoryKey(accounts, normalizedInput);
  const previous = history.find(entry => getAnalysisHistoryKey(entry) === historyKey);
  const entry: AnalysisHistoryEntry = {
    id: previous?.id || `${Date.now()}-${historyKey}`,
    inputValue: buildReportTargetInput(report) || normalizedInput,
    accounts,
    updatedAt: Date.now()
  };
  return [entry, ...history.filter(item => getAnalysisHistoryKey(item) !== historyKey)].slice(0, 30);
}

function normalizeAnalysisHistory(history: AnalysisHistoryEntry[]): AnalysisHistoryEntry[] {
  const deduped = new Map<string, AnalysisHistoryEntry>();
  for (const entry of history) {
    const key = getAnalysisHistoryKey(entry);
    if (!key || deduped.has(key)) {
      continue;
    }
    deduped.set(key, entry);
  }
  return Array.from(deduped.values()).slice(0, 30);
}

function getAnalysisHistoryKey(entry: AnalysisHistoryEntry): string {
  return buildAnalysisHistoryKey(entry.accounts, entry.inputValue);
}

export function formatHistoryAccountNames(entry: AnalysisHistoryEntry): string {
  const names = entry.accounts.map(account => account.displayName).filter(Boolean);
  return names.length ? names.join("、") : entry.inputValue;
}

export function formatHistoryAccountIds(entry: AnalysisHistoryEntry): string {
  const ids = entry.accounts.map(account => account.steamid64).filter(Boolean);
  return ids.length ? ids.join("、") : entry.inputValue;
}

export function formatHistoryAnalysisInput(entry: AnalysisHistoryEntry): string {
  const accountIds = entry.accounts
    .map(account => account.steamid64.trim())
    .filter(steamid64 => /^\d{17}$/.test(steamid64));
  return accountIds.length ? accountIds.join("\n") : entry.inputValue.trim();
}
