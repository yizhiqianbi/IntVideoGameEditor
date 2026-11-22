import test from "node:test";
import assert from "node:assert/strict";
import samplerModule from "./sampler";
const { TAVERN_SAMPLER_DEFAULTS, mergeTavernSampler, parseTavernSampler, resolveTavernSampler, serializeTavernSampler } = samplerModule as typeof import("./sampler");

const capability = { id: "grok", supportsTemperature: true, contextLength: 500_000, maxOutputTokens: 4096 };

test("defaults match the current server behaviour", () => {
  const parsed = parseTavernSampler({});
  assert.equal(parsed.settings.temperature, 0.75);
  assert.equal(parsed.settings.maxTokens, TAVERN_SAMPLER_DEFAULTS.maxTokens);
  assert.deepEqual(parsed.clamped, []);
});

test("snake_case keys and clamping are handled", () => {
  const parsed = parseTavernSampler({ top_p: 3, temperature: -1, max_tokens: 999_999, stop: ["\n", "", 5] });
  assert.equal(parsed.settings.topP, 1);
  assert.equal(parsed.settings.temperature, 0);
  assert.equal(parsed.settings.maxTokens, 16_384);
  assert.deepEqual(parsed.settings.stop, ["\n"]);
  assert.ok(parsed.clamped.includes("topP"));
  assert.ok(parsed.clamped.includes("temperature"));
});

test("merging layers lets later layers win and keeps stop sequences", () => {
  const merged = mergeTavernSampler(
    { temperature: 0.6, topP: 0.9 },
    { temperature: 0.9 },
    { stop: ["END"] },
  );
  assert.equal(merged.settings.temperature, 0.9);
  assert.equal(merged.settings.topP, 0.9);
  assert.deepEqual(merged.settings.stop, ["END"]);
});

test("resolving drops unsupported parameters instead of sending them", () => {
  const resolved = resolveTavernSampler(
    { ...TAVERN_SAMPLER_DEFAULTS, temperature: 1.2, topK: 40, repeatPenalty: 1.1, topP: 0.9 },
    { id: "claude", supportsTemperature: false, contextLength: 1_000_000, maxOutputTokens: 4096 },
  );
  assert.equal(resolved.providerParams.temperature, undefined);
  assert.equal(resolved.providerParams.top_k, undefined);
  assert.equal(resolved.providerParams.repetition_penalty, undefined);
  assert.equal(resolved.providerParams.top_p, 0.9);
  assert.ok(resolved.ignored.includes("temperature"));
  assert.ok(resolved.ignored.includes("topK"));
});

test("resolving forwards top_k only for capable providers", () => {
  const resolved = resolveTavernSampler(
    { ...TAVERN_SAMPLER_DEFAULTS, topK: 40, repeatPenalty: 1.2 },
    { ...capability, supportsTopK: true },
  );
  assert.equal(resolved.providerParams.top_k, 40);
  assert.equal(resolved.providerParams.repetition_penalty, 1.2);
});

test("maxTokens is clamped to output and context limits", () => {
  const resolved = resolveTavernSampler(
    { ...TAVERN_SAMPLER_DEFAULTS, maxTokens: 4096, contextTokens: 2048 },
    { supportsTemperature: true, contextLength: 8192, maxOutputTokens: 1024 },
  );
  assert.equal(resolved.settings.maxTokens, 1024);
  assert.equal(resolved.settings.contextTokens, 2048);
  assert.ok(resolved.clamped.includes("maxTokens"));
});

test("serializeTavernSampler omits defaults that were never set", () => {
  assert.deepEqual(serializeTavernSampler({ temperature: 0.9 }), { temperature: 0.9 });
  assert.deepEqual(serializeTavernSampler({ stop: ["END"] }), { stop: ["END"] });
});
