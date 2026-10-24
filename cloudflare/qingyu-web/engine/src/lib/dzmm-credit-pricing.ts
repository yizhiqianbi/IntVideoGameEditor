export type DzmmCreditCostPolicy = {
  version: 1;
  multiplier: 3;
  usdToCny: number;
  creditsPerCny: 100;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  maxInputUsdPerMillion: number;
  maxOutputUsdPerMillion: number;
};

const RATE_PLACES = 6;
const USD_PLACES = 12;
const RATE_SCALE = 1_000_000n;
const USD_SCALE = 1_000_000_000_000n;

// Parse the canonical decimal representation, including small exponents. Do
// not multiply binary floating point values before taking a billing ceiling.
function decimal(value: unknown, places: number, minimum: number, maximum: number): bigint | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) return undefined;
  const [mantissa, exponent = "0"] = String(value === 0 ? 0 : value).split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  let digits = whole + fraction;
  let remaining = fraction.length - Number(exponent);
  if (remaining < 0) { digits += "0".repeat(-remaining); remaining = 0; }
  while (remaining > 0 && digits.endsWith("0")) { digits = digits.slice(0, -1); remaining--; }
  if (remaining > places || !/^\d+$/.test(digits)) return undefined;
  return BigInt(digits + "0".repeat(places - remaining));
}

export function parseDzmmCreditRate(value: unknown): number | undefined {
  return decimal(value, RATE_PLACES, 1, 1_000_000) === undefined ? undefined : value as number;
}

export function parseDzmmProviderCostUsd(value: unknown): number | undefined {
  return decimal(value, USD_PLACES, 0, 1_000_000) === undefined ? undefined : value === 0 ? 0 : value as number;
}

export function parseDzmmCreditCostPolicy(value: unknown): DzmmCreditCostPolicy | undefined {
  const allowed = ["version", "multiplier", "usdToCny", "creditsPerCny", "inputUsdPerMillion", "outputUsdPerMillion",
    "maxInputUsdPerMillion", "maxOutputUsdPerMillion"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== allowed.length || Object.keys(input).some(key => !allowed.includes(key))
    || input.version !== 1 || input.multiplier !== 3 || input.creditsPerCny !== 100
    || decimal(input.usdToCny, RATE_PLACES, 0.000001, 1_000_000) === undefined) return undefined;
  const prices = [input.inputUsdPerMillion, input.outputUsdPerMillion, input.maxInputUsdPerMillion, input.maxOutputUsdPerMillion];
  if (prices.some(price => parseDzmmProviderCostUsd(price) === undefined || (price as number) <= 0)
    || (input.maxInputUsdPerMillion as number) < (input.inputUsdPerMillion as number)
    || (input.maxOutputUsdPerMillion as number) < (input.outputUsdPerMillion as number)) return undefined;
  return { version: 1, multiplier: 3, usdToCny: input.usdToCny as number, creditsPerCny: 100,
    inputUsdPerMillion: input.inputUsdPerMillion as number, outputUsdPerMillion: input.outputUsdPerMillion as number,
    maxInputUsdPerMillion: input.maxInputUsdPerMillion as number, maxOutputUsdPerMillion: input.maxOutputUsdPerMillion as number };
}

function tokens(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) throw new Error("Invalid pricing token count");
  return BigInt(value);
}
function required(value: bigint | undefined): bigint {
  if (value === undefined) throw new Error("Invalid credit pricing value");
  return value;
}
function ceiling(numerator: bigint, denominator: bigint): number {
  const value = (numerator + denominator - 1n) / denominator;
  if (value < 0 || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsafe credit charge");
  return Number(value);
}
function policyValue(policy: DzmmCreditCostPolicy): DzmmCreditCostPolicy {
  const parsed = parseDzmmCreditCostPolicy(policy);
  if (!parsed) throw new Error("Invalid credit cost policy");
  return parsed;
}

export function chargeDzmmCreditTokens(promptTokens: number, completionTokens: number, inputRate: number, outputRate: number): number {
  return ceiling(tokens(promptTokens) * required(decimal(inputRate, RATE_PLACES, 1, 1_000_000))
    + tokens(completionTokens) * required(decimal(outputRate, RATE_PLACES, 1, 1_000_000)), 1000n * RATE_SCALE);
}

export function chargeDzmmProviderCostUsd(costUsd: number, policy: DzmmCreditCostPolicy): number {
  const value = policyValue(policy);
  return ceiling(required(decimal(costUsd, USD_PLACES, 0, 1_000_000))
    * required(decimal(value.usdToCny, RATE_PLACES, 0.000001, 1_000_000)) * 3n * 100n, USD_SCALE * RATE_SCALE);
}

export function reserveDzmmCreditCost(inputTokens: number, maxOutputTokens: number, policy: DzmmCreditCostPolicy): number {
  const value = policyValue(policy);
  const estimatedUsd = tokens(inputTokens) * required(decimal(value.maxInputUsdPerMillion, USD_PLACES, 0, 1_000_000))
    + tokens(maxOutputTokens) * required(decimal(value.maxOutputUsdPerMillion, USD_PLACES, 0, 1_000_000));
  return ceiling(estimatedUsd * required(decimal(value.usdToCny, RATE_PLACES, 0.000001, 1_000_000)) * 3n * 100n,
    1_000_000n * USD_SCALE * RATE_SCALE);
}
