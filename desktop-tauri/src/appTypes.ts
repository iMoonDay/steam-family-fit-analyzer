import type { ReactNode } from "react";
import type { PriceInfo, ReportGameStatus } from "./types";

export type AppPage = "analysis" | "result" | "family" | "login" | "settings";

export type AnalysisHistoryEntry = {
  id: string;
  inputValue: string;
  accounts: AnalysisHistoryAccount[];
  updatedAt: number;
};

export type AnalysisHistoryAccount = {
  displayName: string;
  steamid64: string;
};

export type ResultGameRow = {
  appid: string;
  name: string;
  originalName: string;
  localizedName: string;
  searchText: string;
  storeLink: string;
  coverUrl: string;
  ownerNames: string[];
  ownerIds: string[];
  familyOwners: string[];
  familyOwnerNames: string[];
  familyAcquiredAt: number;
  price: PriceInfo | null;
  status: ReportGameStatus;
};

export type ResultGameListKey = "all" | "new" | "relativeNew" | "overlap";
export type ResultGameViewMode = "cover" | "table";
export type TableSortDirection = "asc" | "desc";

export type TableSortState = {
  key: string;
  direction: TableSortDirection;
};

export type ResultViewState = {
  searchQuery: string;
  activeGameList: ResultGameListKey;
  viewMode: ResultGameViewMode;
  showAppId: boolean;
  selectedTargetIds: string[];
  tableSortByList: Partial<Record<ResultGameListKey, TableSortState>>;
};

export type PosterSortMode =
  | "current"
  | "titleAsc"
  | "titleDesc"
  | "appidAsc"
  | "appidDesc"
  | "priceDesc"
  | "priceAsc"
  | "ownersAsc"
  | "ownersDesc"
  | "targetOwnersAsc"
  | "targetOwnersDesc"
  | "acquiredAtAsc"
  | "acquiredAtDesc"
  | "statusAsc"
  | "statusDesc";

export type PosterSettings = {
  columns: number;
  sortMode: PosterSortMode;
  scalePercent: number;
};

export type PosterSortOption = {
  value: PosterSortMode;
  label: string;
};

export type SortSelectOption = {
  value: string;
  label: string;
};

export type GameContextMenuState = {
  x: number;
  y: number;
  game: ResultGameRow;
};

export type HistoryContextMenuState = {
  x: number;
  y: number;
  entry: AnalysisHistoryEntry;
};

export type MoreMenuState = {
  x: number;
  y: number;
};

export type MetricTooltipRow = {
  label: string;
  value: string;
};

export type ResultMetric = {
  label: string;
  value: string;
  tooltipRows: MetricTooltipRow[];
};

export type OwnerTagItem = {
  id: string;
  label: string;
};

export type GameTableColumn = {
  key: string;
  label: string;
  className?: string;
  sortable?: boolean;
  render: (game: ResultGameRow) => ReactNode;
};
