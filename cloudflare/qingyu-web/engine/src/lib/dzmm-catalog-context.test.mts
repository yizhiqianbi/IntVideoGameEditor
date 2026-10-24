import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as characterModule from "./dzmm-characters";
import * as presentationModule from "./dzmm-character-presentation";
import * as openingModule from "./dzmm-conversation-opening";
import * as catalogModule from "./dzmm-catalog";
const { DZMM_AI_CHARACTERS, exportCharacterJson, parseCharacterImport } = ("default" in characterModule ? characterModule.default : characterModule) as typeof import("./dzmm-characters");
const { getDzmmCharacterPreviewText } = ("default" in presentationModule ? presentationModule.default : presentationModule) as typeof import("./dzmm-character-presentation");
const { getDzmmConversationOpening } = ("default" in openingModule ? openingModule.default : openingModule) as typeof import("./dzmm-conversation-opening");
const { getDzmmNewConversationBlockReason } = ("default" in catalogModule ? catalogModule.default : catalogModule) as typeof import("./dzmm-catalog");

const evidence = JSON.parse(readFileSync(new URL("./dzmm-public-context-2026-10-15.json", import.meta.url), "utf8"));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

test("every current catalog entry is backed by explicit context evidence or marked incomplete", () => {
  assert.equal(DZMM_AI_CHARACTERS.length, 60);
  for (const card of DZMM_AI_CHARACTERS) {
    const recorded = evidence.characters.find((entry: {id: string}) => entry.id === card.id);
    assert.doesNotMatch(card.tags.join(" "), /外站采集/);
    assert.doesNotMatch(card.description, /来自 dzmm|完整介绍与玩法请查看原站/);
    assert.equal(card.personality, "");
    assert.equal(card.scenario, "");
    if (!recorded) {
      assert.equal(card.catalogReadiness, "metadata-only");
      assert.equal(card.promptOrigin, "unavailable");
      assert.equal(card.description, "");
      assert.equal(card.firstMessage, "");
      assert.ok(getDzmmNewConversationBlockReason(card));
      assert.equal(getDzmmCharacterPreviewText(card), "人物背景与开场待补充");
    } else {
      assert.equal(card.catalogReadiness, "public-context");
      assert.equal(card.description, recorded.description);
      assert.equal(hash(card.description), recorded.descriptionSha256);
      assert.equal(card.firstMessage, recorded.firstMessage);
      if (card.firstMessage) assert.equal(hash(card.firstMessage), recorded.firstMessageSha256);
      assert.equal(getDzmmNewConversationBlockReason(card), null);
      assert.equal(recorded.fullCardAvailable, false);
      assert.doesNotMatch(card.firstMessage, /Pencil Galileo/);
    }
  }
});

test("restored context and available openings survive export and private import", () => {
  for (const card of DZMM_AI_CHARACTERS.filter(card => card.catalogReadiness === "public-context")) {
    const imported = parseCharacterImport(exportCharacterJson(card), `private-${card.id}`);
    assert.equal(imported.description, card.description.trim());
    assert.equal(imported.firstMessage, card.firstMessage.trim());
    assert.equal(getDzmmNewConversationBlockReason(imported), null);
  }
});

test("missing public opening uses the verified story background instead of a fabricated welcome", () => {
  const card = DZMM_AI_CHARACTERS.find(card => card.id === "3768869")!;
  const opening = getDzmmConversationOpening(card);
  assert.equal(opening.kind, "background");
  assert.match(opening.messages[0].content, /任白雪/);
  assert.doesNotMatch(opening.messages[0].content, /欢迎来到|补充自己的身份、目标和边界/);
});
