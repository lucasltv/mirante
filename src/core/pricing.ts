export interface RawUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** USD per 1M tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Per-model pricing (USD per 1M tokens). These are constants that need periodic
 * maintenance; unknown models yield a null cost rather than a wrong one. Verify
 * against current Anthropic pricing before release.
 */
export const PRICING: Record<string, ModelPrice> = {
  "claude-opus-4-8": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Look up a model's price row, or undefined if unknown. */
export function priceFor(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  return PRICING[model];
}

/** Estimate USD cost from raw token totals and a price row. Null if unknown. */
export function estimateCost(totals: RawUsageTotals, price: ModelPrice | undefined): number | null {
  if (!price) return null;
  const per = (tokens: number, usdPerMillion: number) => (tokens / 1_000_000) * usdPerMillion;
  return (
    per(totals.inputTokens, price.input) +
    per(totals.outputTokens, price.output) +
    per(totals.cacheReadTokens, price.cacheRead) +
    per(totals.cacheCreationTokens, price.cacheWrite)
  );
}
