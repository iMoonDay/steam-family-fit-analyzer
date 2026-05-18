export type PriceMode = "original" | "historyLow";
export type LocaleMode = "auto" | "zh-CN" | "en";

export type AppSettings = {
  steamApiKey: string;
  itadApiKey: string;
  currentSteamId64: string;
  familyAccessToken: string;
  familyGroupId: string;
  storeCountry: string;
  locale: LocaleMode;
  priceMode: PriceMode;
};

export type AnalyzeInput = {
  targetInput: string;
  settings: AppSettings;
};

export type AnalysisPreview = {
  targetCount: number;
  normalizedTargets: string[];
  priceMode: PriceMode;
  storeContext: string;
  warnings: string[];
};

export type TargetGame = {
  appid: string;
  name: string;
  storeLink: string;
};

export type TargetProfile = {
  steamid64: string;
  displayName: string;
  profileUrl: string;
  avatar: string;
  gameCount: number;
  rawGameCount: number;
  games: TargetGame[];
  sampleGames: TargetGame[];
};

export type ReportGameStatus = "new" | "overlap" | "currentOwned" | "notCurrentOwned";

export type PriceInfo = {
  initial: number | null;
  currency: string;
  localizedName: string;
  source: "original" | string;
  isFree: boolean;
  unavailable: boolean;
  historyLowAt: string;
};

export type ReportGame = TargetGame & {
  coverUrl: string;
  targetOwners: string[];
  targetOwnerNames: string[];
  familyOwners: string[];
  familyAcquiredAt: number;
  price: PriceInfo | null;
  status: ReportGameStatus;
};

export type ReportGameLists = {
  all: ReportGame[];
  new: ReportGame[];
  overlap: ReportGame[];
  currentOwned: ReportGame[];
  notCurrentOwned: ReportGame[];
};

export type AnalysisReport = {
  targetCount: number;
  totalPublicGames: number;
  familyGameCount: number;
  newGameCount: number;
  overlapCount: number;
  currentOwnedOverlapCount: number;
  targets: TargetProfile[];
  games: ReportGameLists;
  warnings: string[];
};

export type AppStatus = {
  appName: string;
  storageReady: boolean;
  cacheDirectory: string;
};
