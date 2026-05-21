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
  cacheDirectory: string;
  configDirectory: string;
};

export type AnalyzeInput = {
  targetInput: string;
  settings: AppSettings;
};

export type CoverCacheRequest = {
  appid: string;
  url: string;
  force?: boolean;
};

export type CoverCacheItem = CoverCacheRequest & {
  filePath: string;
};

export type CacheCoversOutput = {
  covers: CoverCacheItem[];
  warnings: string[];
};

export type AutoSteamConfigResult = {
  accessToken: string;
  currentSteamId64: string;
  familyGroupId: string;
  messages: string[];
};

export type BrowserCallbackSession = {
  callbackUrl: string;
  bookmarklet: string;
  steamStoreUrl: string;
  expiresInSeconds: number;
};

export type SteamQrLoginSession = {
  clientId: string;
  requestId: string;
  challengeUrl: string;
  intervalSeconds: number;
};

export type SteamQrLoginPollResult = {
  status: "waiting_scan" | "waiting_confirmation" | "confirmed" | string;
  steamid64: string;
  accountName: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number | null;
  message: string;
};

export type SteamGuardConfirmation = {
  confirmationType: "email_code" | "device_code" | "device_confirmation" | "email_confirmation" | "machine_token" | "legacy_machine_auth" | string;
  message: string;
};

export type SteamPasswordLoginResult = {
  status: "guard_required" | "waiting_confirmation" | "confirmed" | string;
  steamid64: string;
  accountName: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number | null;
  clientId: string;
  requestId: string;
  intervalSeconds: number;
  allowedConfirmations: SteamGuardConfirmation[];
  message: string;
};

export type SteamLoginRefreshResult = {
  steamid64: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number | null;
};

export type SteamLoginProfile = {
  steamid64: string;
  displayName: string;
  profileUrl: string;
  avatar: string;
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

export type ReportGameStatus = "new" | "relativeNew" | "overlap" | "currentOwned" | "notCurrentOwned" | "unsupported" | "noValue";

export type PriceInfo = {
  initial: number | null;
  currency: string;
  localizedName: string;
  source: "original" | string;
  isFree: boolean;
  unavailable: boolean;
  historyLowAt: string;
};

export type ReportGamePrices = {
  original?: PriceInfo | null;
  historyLow?: PriceInfo | null;
};

export type ReportGame = TargetGame & {
  localizedName?: string;
  coverUrl: string;
  targetOwners: string[];
  targetOwnerNames: string[];
  familyOwners: string[];
  familyOwnerNames: string[];
  familyAcquiredAt: number;
  prices?: ReportGamePrices;
  price: PriceInfo | null;
  status: ReportGameStatus;
};

export type ReportGameLists = {
  all: ReportGame[];
  new: ReportGame[];
  relativeNew: ReportGame[];
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
  configDirectory: string;
};
