import { describe, expect, it } from "vitest";
import { formatPrice, formatPercent, getReportGameStatusLabel, matchesResultGameSearch } from "../report";
import type { PriceInfo } from "../../types";
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
    localizedName: "",
    storeLink: "https://store.steampowered.com/app/730/",
    coverUrl: "",
    targetOwners: ["76561198012345678"],
    targetOwnerNames: ["Player"],
    familyOwners: [],
    familyOwnerNames: [],
    familyAcquiredAt: 0,
    prices: { original: null, historyLow: null },
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
