import { describe, expect, it } from "vitest";
import { splitTargetInput, normalizeTargetToken } from "../input";

describe("splitTargetInput", () => {
  it("splits on whitespace", () => {
    expect(splitTargetInput("aaa bbb")).toEqual(["aaa", "bbb"]);
  });

  it("splits on newlines", () => {
    expect(splitTargetInput("aaa\nbbb\nccc")).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("ignores empty lines", () => {
    expect(splitTargetInput("aaa\n\nbbb\n   \nccc")).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("trims surrounding whitespace", () => {
    expect(splitTargetInput("  aaa  \n  bbb  ")).toEqual(["aaa", "bbb"]);
  });

  it("returns empty when input is blank", () => {
    expect(splitTargetInput("")).toEqual([]);
    expect(splitTargetInput("   ")).toEqual([]);
    expect(splitTargetInput("\n\n")).toEqual([]);
  });

  it("handles tabs as whitespace", () => {
    expect(splitTargetInput("aaa\tbbb")).toEqual(["aaa", "bbb"]);
  });
});

describe("normalizeTargetToken", () => {
  it("returns 17-digit SteamID64 unchanged", () => {
    expect(normalizeTargetToken("76561198012345678")).toBe("76561198012345678");
  });

  it("returns numeric string (friend code) unchanged", () => {
    expect(normalizeTargetToken("123456789")).toBe("123456789");
  });

  it("extracts SteamID64 from profile URL", () => {
    expect(normalizeTargetToken("https://steamcommunity.com/profiles/76561198012345678/")).toBe(
      "76561198012345678"
    );
    expect(normalizeTargetToken("https://steamcommunity.com/profiles/76561198012345678")).toBe(
      "76561198012345678"
    );
    expect(normalizeTargetToken("http://steamcommunity.com/profiles/76561198012345678/")).toBe(
      "76561198012345678"
    );
  });

  it("extracts vanity ID from /id/ URL", () => {
    expect(normalizeTargetToken("https://steamcommunity.com/id/gaben")).toBe("gaben");
    expect(normalizeTargetToken("https://steamcommunity.com/id/gaben/")).toBe("gaben");
  });

  it("decodes URL-encoded vanity IDs", () => {
    expect(normalizeTargetToken("https://steamcommunity.com/id/my%20name")).toBe("my name");
  });

  it("strips leading @ from plain text", () => {
    expect(normalizeTargetToken("@username")).toBe("username");
  });

  it("returns plain text vanity ID unchanged", () => {
    expect(normalizeTargetToken("gaben")).toBe("gaben");
  });

  it("trims whitespace", () => {
    expect(normalizeTargetToken("  76561198012345678  ")).toBe("76561198012345678");
  });
});
