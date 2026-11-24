import test from "node:test";
import assert from "node:assert/strict";
import charactersModule from "../dzmm-characters";
import contextModule from "../dzmm-context";
import chatModule from "../dzmm-chat";

const { parseCharacterImport, exportCharacterJson } = charactersModule as typeof import("../dzmm-characters");
const { prepareDzmmRequest } = contextModule as typeof import("../dzmm-context");
const { buildDzmmPromptPlan } = chatModule as typeof import("../dzmm-chat");

/** A SillyTavern v2 card carrying every advanced world-book field this app kept
 * dropping before P1'. */
const advancedCard = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "码头档案员",
    description: "旧港档案馆的成年管理员。",
    personality: "寡言",
    scenario: "旧港档案馆",
    first_mes: "欢迎来到档案馆。",
    mes_example: "<START>",
    character_book: {
      name: "旧港设定",
      scan_depth: 6,
      entries: [
        {
          id: 1, keys: ["旧[港湾]"], content: "REGEX_LORE：旧港与旧湾是同一条海岸线。", use_regex: true,
          selective: true, secondary_keys: ["地图"], selective_logic: 3, probability: 100, use_probability: true,
          insertion_order: 10, position: "before_char",
        },
        {
          id: 2, keys: [], constant: true, content: "DEPTH_LORE：档案员此刻正在整理第七排卷宗。",
          insertion_order: 20, extensions: { position: 4, depth: 1, role: 0 },
        },
        {
          id: 3, keys: ["灯塔"], content: "PROBABILITY_ZERO_LORE", probability: 0, use_probability: true,
          group: "港口", group_weight: 30, prevent_recursion: true, sticky: 2, cooldown: 1, delay: 1,
        },
        {
          id: 4, keys: ["地图"], content: "MATCH_WHOLE_WORD_LORE", match_whole_words: true, case_sensitive: true,
          position: "after_char", use_budget: true, scan_depth: 3,
        },
      ],
    },
  },
};

test("importing an ST card keeps advanced world-book fields", () => {
  const character = parseCharacterImport(advancedCard);
  const entries = character.characterBook!.entries;
  assert.equal(entries.length, 4);
  const regex = entries[0];
  assert.equal(regex.useRegex, true);
  assert.equal(regex.selectiveLogic, 3);
  assert.equal(regex.probability, 100);
  assert.equal(regex.useProbability, true);
  assert.deepEqual(regex.secondaryKeys, ["地图"]);
  assert.equal(entries[1].position, "at_depth");
  assert.equal(entries[1].depth, 1);
  assert.equal(entries[1].role, "system");
  assert.equal(entries[2].group, "港口");
  assert.equal(entries[2].groupWeight, 30);
  assert.equal(entries[2].preventRecursion, true);
  assert.equal(entries[2].sticky, 2);
  assert.equal(entries[2].cooldown, 1);
  assert.equal(entries[2].delay, 1);
  assert.equal(entries[3].matchWholeWords, true);
  assert.equal(entries[3].caseSensitive, true);
  assert.equal(entries[3].scanDepth, 3);
});

test("export keeps advanced world-book fields for a later re-import", () => {
  const character = parseCharacterImport(advancedCard);
  const exported = exportCharacterJson(character);
  assert.match(exported, /"useRegex": true/u);
  assert.match(exported, /"selectiveLogic": 3/u);
  assert.match(exported, /"group": "港口"/u);
  assert.match(exported, /"depth": 1/u);
});

test("the client prepares a request that still carries the advanced fields", () => {
  const character = parseCharacterImport(advancedCard);
  const request = prepareDzmmRequest(character, [
    { role: "assistant", content: "欢迎来到档案馆。" },
    { role: "user", content: "帮我找旧湾的地图" },
  ], "安静叙事", "来自远方的旅人", "grok", 256, { promptStyle: "tavern", userName: "旅人" });
  const entries = request.character.characterBook?.entries ?? [];
  assert.ok(entries.some(entry => entry.useRegex === true));
  assert.ok(entries.some(entry => entry.position === "at_depth" && entry.depth === 1));
});

test("the tavern engine activates regex keys, depth entries and skips zero probability", () => {
  const character = parseCharacterImport(advancedCard);
  const request = prepareDzmmRequest(character, [
    { role: "assistant", content: "欢迎来到档案馆。" },
    { role: "user", content: "帮我查看旧湾，地图。顺便看看灯塔" },
  ], "安静叙事", "来自远方的旅人", "grok", 256, { promptStyle: "tavern", userName: "旅人" });
  const plan = buildDzmmPromptPlan(request);
  const contents = plan.messages.map(message => message.content).join("\n");
  assert.match(contents, /REGEX_LORE/u, "regex key with secondary key AND_ALL activates");
  assert.match(contents, /DEPTH_LORE/u, "@depth entry is injected");
  assert.match(contents, /MATCH_WHOLE_WORD_LORE/u);
  assert.doesNotMatch(contents, /PROBABILITY_ZERO_LORE/u, "probability 0 never activates");
  const depthIndex = plan.messages.findIndex(message => message.content.includes("DEPTH_LORE"));
  assert.ok(depthIndex > 0);
});
