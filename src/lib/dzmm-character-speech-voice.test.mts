import assert from "node:assert/strict";
import test from "node:test";
import characterModule from "./dzmm-characters";
import performanceModule from "./xumeng-performance-character";

const { exportCharacterJson, parseCharacterImport } = characterModule as typeof import("./dzmm-characters");
const { xumengPerformanceFromCard } = performanceModule as typeof import("./xumeng-performance-character");

test("character voice survives import, export and performance handoff", () => {
  const card = parseCharacterImport({ name: "测试", firstMessage: "你好", speechVoice: "female-yujie" }, "voice-card");
  assert.equal(card.speechVoice, "female-yujie");
  assert.equal(JSON.parse(exportCharacterJson(card)).speechVoice, "female-yujie");
  assert.equal(xumengPerformanceFromCard(card).speechVoice, "female-yujie");
  assert.equal(xumengPerformanceFromCard(card).liveVoice, "Katerina");
  assert.equal(parseCharacterImport({ name: "测试" }).speechVoice, undefined);
});

test("unknown character voices are rejected", () => {
  assert.throws(() => parseCharacterImport({ name: "测试", speechVoice: "cloned-voice" }), /声优/);
});
