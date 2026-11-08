import assert from "node:assert/strict";
import test from "node:test";
import characterModule from "./dzmm-characters";
import performanceModule from "./xumeng-performance-character";
import voicesModule from "./xumeng-voices";

const { exportCharacterJson, parseCharacterImport } = characterModule as typeof import("./dzmm-characters");
const { xumengPerformanceFromCard } = performanceModule as typeof import("./xumeng-performance-character");
const { XUMENG_DEFAULT_SPEECH_VOICE } = voicesModule as typeof import("./xumeng-voices");

test("character voice survives import, export and performance handoff", () => {
  const card = parseCharacterImport({ name: "测试", firstMessage: "你好", speechVoice: "female-yujie" }, "voice-card");
  assert.equal(card.speechVoice, "female-yujie");
  assert.equal(JSON.parse(exportCharacterJson(card)).speechVoice, "female-yujie");
  assert.equal(xumengPerformanceFromCard(card).speechVoice, "female-yujie");
  assert.equal(xumengPerformanceFromCard(card).liveVoice, "Katerina");
});

test("a card without a voice uploads with the tavern default", () => {
  assert.equal(parseCharacterImport({ name: "测试" }).speechVoice, XUMENG_DEFAULT_SPEECH_VOICE);
  assert.equal(parseCharacterImport({ name: "测试", speechVoice: "" }).speechVoice, XUMENG_DEFAULT_SPEECH_VOICE);
  assert.equal(parseCharacterImport({ name: "测试", speechVoice: "   " }).speechVoice, XUMENG_DEFAULT_SPEECH_VOICE);
  assert.equal(parseCharacterImport({ name: "测试", speechVoice: null }).speechVoice, XUMENG_DEFAULT_SPEECH_VOICE);
  assert.equal(JSON.parse(exportCharacterJson(parseCharacterImport({ name: "测试" }))).speechVoice, XUMENG_DEFAULT_SPEECH_VOICE);
  assert.equal(xumengPerformanceFromCard(parseCharacterImport({ name: "测试" })).speechVoice, XUMENG_DEFAULT_SPEECH_VOICE);
});

test("a voice id from another catalog falls back to the tavern default", () => {
  assert.equal(parseCharacterImport({ name: "测试", speechVoice: "cloned-voice" }).speechVoice, XUMENG_DEFAULT_SPEECH_VOICE);
  assert.equal(parseCharacterImport({ name: "测试", speechVoice: { id: "x" } }).speechVoice, XUMENG_DEFAULT_SPEECH_VOICE);
});
