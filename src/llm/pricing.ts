/** Narxlar: $ / 1M token. Manba: Anthropic API narx jadvali. */
export interface ModelPrice {
  input: number;
  output: number;
}

export const PRICING: Record<string, ModelPrice> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

export interface UsageCounts {
  tokensIn: number;
  tokensOut: number;
  cacheReadIn: number;
  cacheWriteIn: number;
}

/** Kesh o'qish ~0.1x, kesh yozish ~1.25x kirish narxi. */
export function costUsd(model: string, usage: UsageCounts): number {
  const price = PRICING[model];
  if (!price) return 0; // noma'lum model — narx 0, lekin token baribir yoziladi
  const input =
    usage.tokensIn * price.input +
    usage.cacheWriteIn * price.input * 1.25 +
    usage.cacheReadIn * price.input * 0.1;
  return (input + usage.tokensOut * price.output) / 1_000_000;
}
