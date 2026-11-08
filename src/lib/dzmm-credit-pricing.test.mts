import test from "node:test";
import assert from "node:assert/strict";
import pricingModule from "./dzmm-credit-pricing";
const { parseDzmmCreditRate, parseDzmmProviderCostUsd, parseDzmmCreditCostPolicy,
  chargeDzmmCreditTokens, chargeDzmmProviderCostUsd, reserveDzmmCreditCost } = pricingModule as typeof import("./dzmm-credit-pricing");
const policy = () => ({ version: 1 as const, multiplier: 3 as const, usdToCny: 6.704588, creditsPerCny: 100 as const,
  inputUsdPerMillion: 2, outputUsdPerMillion: 6, maxInputUsdPerMillion: 4.4, maxOutputUsdPerMillion: 13.2 });

test("fixed precision accepts reference rates and canonical small USD exponents only within their supported precision", () => {
  for (const value of [1, 1.09, 4.022753, 12.068258, 1_000_000]) assert.equal(parseDzmmCreditRate(value), value);
  for (const value of [0, -0, 1e-12, 1e-7, 0.000123456789, 1_000_000]) assert.equal(parseDzmmProviderCostUsd(value), value === 0 ? 0 : value);
  for (const value of [0, 0.9, -1, 1.0000001, 1_000_001, NaN, Infinity, "4.022753"]) assert.equal(parseDzmmCreditRate(value), undefined);
  for (const value of [-1, 1e-13, 0.1234567890123, 1_000_001, NaN, Infinity, "0.001", null]) assert.equal(parseDzmmProviderCostUsd(value), undefined);
});

test("cost policies are strict immutable values with bounded exchange and price ceilings", () => {
  const input = policy(); const parsed = parseDzmmCreditCostPolicy(input);
  assert.deepEqual(parsed, input); assert.notEqual(parsed, input);
  for (const fields of [{ extra: true }, { version: 2 }, { multiplier: 4 }, { creditsPerCny: 99 }, { usdToCny: 0 },
    { usdToCny: 6.7045881 }, { usdToCny: Infinity }, { inputUsdPerMillion: 0 }, { outputUsdPerMillion: -1 },
    { maxInputUsdPerMillion: 1.9 }, { maxOutputUsdPerMillion: 5.9 }, { maxOutputUsdPerMillion: 1.0000000000001 }])
    assert.equal(parseDzmmCreditCostPolicy({ ...input, ...fields }), undefined);
  assert.equal(parseDzmmCreditCostPolicy({ ...input, inputUsdPerMillion: undefined }), undefined);
});

test("token ceilings are decimal exact, combine before rounding and preserve integer legacy charges", () => {
  assert.equal(Math.ceil(1.09 * 100000 / 1000), 110);
  assert.equal(chargeDzmmCreditTokens(100000, 0, 1.09, 3), 109);
  assert.equal(chargeDzmmCreditTokens(1, 1, 3, 9), 1);
  assert.equal(chargeDzmmCreditTokens(1000, 8000, 3, 9), 75);
  assert.equal(chargeDzmmCreditTokens(1000, 1000, 4.022753, 12.068258), 17);
  assert.equal(chargeDzmmCreditTokens(0, 0, 3, 9), 0);
  for (const count of [-1, 0.1, 1_000_000_001, Infinity]) assert.throws(() => chargeDzmmCreditTokens(count, 1, 3, 9));
  assert.throws(() => chargeDzmmCreditTokens(1, 1, 1.0000001, 9));
});

test("actual USD costs use the frozen policy and cache discounts rather than reference token rates", () => {
  const input = policy();
  assert.equal(chargeDzmmProviderCostUsd(0, input), 0);
  assert.equal(chargeDzmmProviderCostUsd(1e-12, input), 1);
  assert.equal(chargeDzmmProviderCostUsd(0.002, input), 5);
  assert.equal(chargeDzmmProviderCostUsd(0.0005, input), 2);
  assert.equal(chargeDzmmProviderCostUsd(1, { ...input, usdToCny: 1 }), 300);
  assert.equal(chargeDzmmProviderCostUsd(0.01, { ...input, usdToCny: 1 }), 3);
  assert.throws(() => chargeDzmmProviderCostUsd(1e-13, input));
  assert.throws(() => chargeDzmmProviderCostUsd(1, { ...input, multiplier: 4 } as unknown as typeof input));
  assert.deepEqual(input, policy());
});

test("reserves merge USD price ceilings before conversion and never round intermediate costs", () => {
  assert.equal(reserveDzmmCreditCost(1000, 1000, policy()), 36);
  assert.equal(reserveDzmmCreditCost(1000, 8000, policy()), 222);
  assert.equal(reserveDzmmCreditCost(1, 1, policy()), 1);
  assert.equal(reserveDzmmCreditCost(0, 0, policy()), 0);
  assert.equal(reserveDzmmCreditCost(1000, 1000, { ...policy(), usdToCny: 1, maxInputUsdPerMillion: 2, maxOutputUsdPerMillion: 6 }), 3);
  assert.throws(() => reserveDzmmCreditCost(1, 1, { ...policy(), usdToCny: 0 }));
});
