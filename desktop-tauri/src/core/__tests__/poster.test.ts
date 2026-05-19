import { describe, expect, it } from "vitest";
import { normalizePosterColumns, normalizePosterScalePercent, getPosterSortModeLabel, buildGameCoverPosterFilename, defaultPosterSettings } from "../poster";

describe("normalizePosterColumns", () => {
  it("returns default for undefined", () => {
    expect(normalizePosterColumns(undefined)).toBe(10);
  });

  it("treats 0 as default", () => {
    expect(normalizePosterColumns(0)).toBe(10);
  });

  it("clamps above maximum to 50", () => {
    expect(normalizePosterColumns(51)).toBe(50);
    expect(normalizePosterColumns(100)).toBe(50);
  });

  it("returns valid value unchanged", () => {
    expect(normalizePosterColumns(1)).toBe(1);
    expect(normalizePosterColumns(10)).toBe(10);
    expect(normalizePosterColumns(50)).toBe(50);
  });

  it("handles NaN as default", () => {
    expect(normalizePosterColumns(NaN)).toBe(10);
  });

  it("clamps negative to 1", () => {
    expect(normalizePosterColumns(-5)).toBe(1);
  });
});

describe("normalizePosterScalePercent", () => {
  it("returns default for undefined", () => {
    expect(normalizePosterScalePercent(undefined)).toBe(100);
  });

  it("treats 0 as default", () => {
    expect(normalizePosterScalePercent(0)).toBe(100);
  });

  it("clamps above 100 to 100", () => {
    expect(normalizePosterScalePercent(101)).toBe(100);
    expect(normalizePosterScalePercent(200)).toBe(100);
  });

  it("returns valid value unchanged if multiple of 5", () => {
    expect(normalizePosterScalePercent(40)).toBe(40);
    expect(normalizePosterScalePercent(70)).toBe(70);
    expect(normalizePosterScalePercent(100)).toBe(100);
  });

  it("rounds to nearest multiple of 5", () => {
    expect(normalizePosterScalePercent(39)).toBe(40);
    expect(normalizePosterScalePercent(42)).toBe(40);
    expect(normalizePosterScalePercent(43)).toBe(45);
  });

  it("handles NaN as default", () => {
    expect(normalizePosterScalePercent(NaN)).toBe(100);
  });
});

describe("getPosterSortModeLabel", () => {
  it("returns Chinese labels for known modes", () => {
    expect(getPosterSortModeLabel("current")).toBe("默认（当前列表排序）");
    expect(getPosterSortModeLabel("titleAsc")).toBe("名称升序");
    expect(getPosterSortModeLabel("titleDesc")).toBe("名称降序");
    expect(getPosterSortModeLabel("priceDesc")).toBe("价格降序");
  });

  it("returns undefined for unknown modes", () => {
    expect(getPosterSortModeLabel("unknown" as never)).toBeUndefined();
  });
});

describe("buildGameCoverPosterFilename", () => {
  it("includes list label", () => {
    const name = buildGameCoverPosterFilename("新增", defaultPosterSettings);
    expect(name).toContain("新增");
    expect(name).toContain(".png");
  });

  it("uses default settings when not provided", () => {
    const name = buildGameCoverPosterFilename("Test");
    expect(name).toContain("Test");
  });

  it("sanitizes special characters in label", () => {
    const name = buildGameCoverPosterFilename("a/b:c*d?e<f>g");
    expect(name).not.toContain("/");
    expect(name).not.toContain(":");
  });
});
