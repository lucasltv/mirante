import { describe, expect, it } from "vitest";
import { estimateCost, priceFor, type RawUsageTotals } from "./pricing.js";

const totals: RawUsageTotals = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

describe("estimateCost", () => {
  it("computes cost from a known pricing row", () => {
    const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
    // 1M input * $3 + 1M output * $15 = $18
    expect(estimateCost(totals, price)).toBeCloseTo(18, 5);
  });

  it("returns null when the model has no pricing row", () => {
    expect(estimateCost(totals, undefined)).toBeNull();
  });

  it("prices cache-read and cache-creation buckets distinctly", () => {
    const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
    const withCache: RawUsageTotals = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 2_000_000, // x 0.30 = 0.60
      cacheCreationTokens: 1_000_000, // x 3.75 (cacheWrite) = 3.75
    };
    // 3 + 15 + 0.60 + 3.75 = 22.35
    expect(estimateCost(withCache, price)).toBeCloseTo(22.35, 5);
  });
});

describe("priceFor", () => {
  it("returns the row for a known model and undefined otherwise", () => {
    expect(priceFor("claude-sonnet-5")).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    });
    expect(priceFor("nonexistent-model")).toBeUndefined();
    expect(priceFor(undefined)).toBeUndefined();
  });
});
