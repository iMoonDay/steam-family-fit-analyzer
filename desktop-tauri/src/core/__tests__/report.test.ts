import { describe, expect, it } from "vitest";
import { filterReportBySelectedTargets, formatPrice, formatPercent, getReportGameStatusLabel, matchesResultGameSearch } from "../report";
import type { AnalysisReport, PriceInfo, ReportGame } from "../../types";
import type { ResultGameRow } from "../../appTypes";

function makePrice(overrides: Partial<PriceInfo> = {}): PriceInfo {
  return {
    initial: 4999,
    currency: "CNY",
    localizedName: "",
    source: "steam",
    isFree: false,
    unavailable: false,
    historyLowAt: "",
    ...overrides,
  };
}

function makeGameRow(overrides: Partial<ResultGameRow> = {}): ResultGameRow {
  return {
    appid: "730",
    name: "Counter-Strike 2",
    originalName: "Counter-Strike 2",
    localizedName: "",
    storeLink: "https://store.steampowered.com/app/730/",
    coverUrl: "",
    ownerIds: ["76561198012345678"],
    ownerNames: ["Player"],
    familyOwners: [],
    familyOwnerNames: [],
    familyAcquiredAt: 0,
    price: null,
    status: "new",
    searchText: "730\ncounter-strike 2\n730\ncounterstrike2",
    ...overrides,
  };
}

describe("formatPrice", () => {
  it('returns "-" for null', () => {
    expect(formatPrice(null)).toBe("-");
  });

  it('returns "-" for unavailable price', () => {
    expect(formatPrice(makePrice({ unavailable: true }))).toBe("-");
  });

  it("formats CNY price", () => {
    const result = formatPrice(makePrice({ initial: 4999, currency: "CNY" }));
    expect(result).toContain("49");
  });

  it("formats free games", () => {
    const result = formatPrice(makePrice({ initial: 0, isFree: true }));
    expect(result).toContain("0");
  });
});

describe("formatPercent", () => {
  it("formats 0.5 as 50%", () => {
    const result = formatPercent(0.5);
    expect(result).toContain("50");
    expect(result).toContain("%");
  });

  it("formats 0 as 0%", () => {
    expect(formatPercent(0)).toContain("0%");
  });

  it("formats 1 as 100%", () => {
    expect(formatPercent(1)).toContain("100%");
  });

  it("handles NaN as 0%", () => {
    expect(formatPercent(NaN)).toContain("0%");
  });

  it("handles Infinity as 0%", () => {
    expect(formatPercent(Infinity)).toContain("0%");
  });
});

describe("getReportGameStatusLabel", () => {
  it("returns labels for valid statuses", () => {
    expect(getReportGameStatusLabel("new")).toBe("新增");
    expect(getReportGameStatusLabel("overlap")).toBe("重复");
    expect(getReportGameStatusLabel("currentOwned")).toBe("不计入新增");
    expect(getReportGameStatusLabel("unsupported")).toBe("不可共享");
    expect(getReportGameStatusLabel("noValue")).toBe("无新增价值");
  });

  it('returns "-" for unknown status', () => {
    expect(getReportGameStatusLabel("unknown" as never)).toBe("-");
  });
});

describe("matchesResultGameSearch", () => {
  const game = makeGameRow({
    name: "Counter-Strike 2",
    appid: "730",
    searchText: "730\ncounter-strike 2\n730\ncounterstrike2\ncc\nfkj\nfkjy"
  });

  it("matches by name", () => {
    expect(matchesResultGameSearch(game, "counter-strike")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesResultGameSearch(game, "COUNTER")).toBe(true);
  });

  it("matches by appid", () => {
    expect(matchesResultGameSearch(game, "730")).toBe(true);
  });

  it("matches partial appid", () => {
    expect(matchesResultGameSearch(game, "73")).toBe(true);
  });

  it("returns true for empty query", () => {
    expect(matchesResultGameSearch(game, "")).toBe(true);
  });

  it("returns false for non-matching query", () => {
    expect(matchesResultGameSearch(game, "Dota")).toBe(false);
  });

  it("returns true for whitespace-only query", () => {
    expect(matchesResultGameSearch(game, "   ")).toBe(true);
  });

  it("matches by localized name", () => {
    const gameWithLocal = makeGameRow({
      name: "CS2",
      localizedName: "反恐精英2",
      searchText: "cs2\n反恐精英2\ncs2\n反恐精英2"
    });
    expect(matchesResultGameSearch(gameWithLocal, "精英")).toBe(true);
  });
});

describe("filterReportBySelectedTargets", () => {
  it("filters metrics lists to selected target owners", () => {
    const report = makeAnalysisReport();

    const filtered = filterReportBySelectedTargets(report, ["76561198000000001"]);

    expect(filtered.targets.map(target => target.steamid64)).toEqual(["76561198000000001"]);
    expect(filtered.games.all.map(game => game.appid)).toEqual(["10", "20"]);
    expect(filtered.games.new.map(game => game.appid)).toEqual(["10"]);
    expect(filtered.games.overlap.map(game => game.appid)).toEqual(["20"]);
    expect(filtered.games.all.find(game => game.appid === "20")?.targetOwners).toEqual(["76561198000000001"]);
    expect(filtered.newGameCount).toBe(1);
    expect(filtered.overlapCount).toBe(1);
  });

  it("turns overlaps owned only by excluded targets into relative new rows", () => {
    const report = makeAnalysisReport();

    const filtered = filterReportBySelectedTargets(report, ["76561198000000001"]);

    const relativeNewAppids = filtered.games.relativeNew.map(game => game.appid);
    expect(relativeNewAppids).toContain("30");
    expect(relativeNewAppids).toContain("40");
    expect(filtered.games.relativeNew.find(game => game.appid === "30")?.status).toBe("relativeNew");
  });
});

function makeAnalysisReport(): AnalysisReport {
  const alice = "76561198000000001";
  const bob = "76561198000000002";
  const newGame = makeReportGame({ appid: "10", name: "Alpha", status: "new", targetOwners: [alice], targetOwnerNames: ["Alice"] });
  const sharedOverlap = makeReportGame({ appid: "20", name: "Beta", status: "overlap", targetOwners: [alice, bob], targetOwnerNames: ["Alice", "Bob"] });
  const bobOverlap = makeReportGame({ appid: "30", name: "Gamma", status: "overlap", targetOwners: [bob], targetOwnerNames: ["Bob"] });
  const familyOnly = makeReportGame({ appid: "40", name: "Delta", status: "relativeNew", targetOwners: [], targetOwnerNames: [] });

  return {
    targetCount: 2,
    totalPublicGames: 4,
    familyGameCount: 3,
    newGameCount: 1,
    overlapCount: 2,
    currentOwnedOverlapCount: 0,
    targets: [
      { steamid64: alice, displayName: "Alice", profileUrl: "", avatar: "", gameCount: 2, rawGameCount: 2, games: [], sampleGames: [] },
      { steamid64: bob, displayName: "Bob", profileUrl: "", avatar: "", gameCount: 2, rawGameCount: 2, games: [], sampleGames: [] }
    ],
    games: {
      all: [newGame, sharedOverlap, bobOverlap],
      new: [newGame],
      relativeNew: [familyOnly],
      overlap: [sharedOverlap, bobOverlap],
      currentOwned: [],
      notCurrentOwned: [newGame, sharedOverlap, bobOverlap]
    },
    warnings: []
  };
}

function makeReportGame(overrides: Partial<ReportGame>): ReportGame {
  return {
    appid: "0",
    name: "Game",
    localizedName: "",
    storeLink: "",
    coverUrl: "",
    targetOwners: [],
    targetOwnerNames: [],
    familyOwners: ["76561198000000099"],
    familyOwnerNames: ["Family"],
    familyAcquiredAt: 0,
    prices: { original: null, historyLow: null },
    price: null,
    status: "new",
    ...overrides
  };
}
