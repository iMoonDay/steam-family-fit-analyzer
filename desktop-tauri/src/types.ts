export type PriceMode = "original" | "historyLow";
export type LocaleMode = "auto" | "zh-CN" | "en";

export type AppSettings = {
  steamApiKey: string;
  itadApiKey: string;
  currentSteamId64: string;
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
  sampleGames: TargetGame[];
};

export type AnalysisReport = {
  targetCount: number;
  totalPublicGames: number;
  currentOwnedOverlapCount: number;
  targets: TargetProfile[];
  warnings: string[];
};

export type AppStatus = {
  appName: string;
  storageReady: boolean;
  cacheDirectory: string;
};
