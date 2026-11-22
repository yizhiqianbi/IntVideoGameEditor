import test from "node:test";
import assert from "node:assert/strict";
import cardModule from "./card";
import worldbookModule from "./worldbook";
const { TAVERN_ENTRY_POSITION, TAVERN_SELECTIVE_LOGIC, parseTavernWorldbook } = worldbookModule as typeof import("./worldbook");
const { TAVERN_CARD_SPEC_V3, contextFromTavernCard, parseTavernCard, serializeTavernCard, serializeTavernWorldbook, tavernCardFromContext, tavernCompatibilityReport } = cardModule as typeof import("./card");

const v2Card = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "档案员",
    description: "描述",
    personality: "认真",
    scenario: "旧港",
    first_mes: "开场",
    mes_example: "<START>",
    creator_notes: "作者备注",
    system_prompt: "系统设定",
    post_history_instructions: "历史后指令",
    alternate_greetings: ["备选一", "备选二"],
    group_only_greetings: ["群聊开场"],
    tags: ["剧情"],
    creator: "作者",
    character_version: "1.2",
    character_book: {
      name: "档案",
      scan_depth: 4,
      entries: [
        { id: 1, keys: ["旧港"], secondary_keys: ["南岸"], selective: true, selective_logic: 3, content: "旧港在南岸。", position: "before_char", insertion_order: 10, case_sensitive: true, use_regex: false, match_whole_words: true, probability: 70, use_probability: true, group: "港", group_weight: 20, prevent_recursion: true, sticky: 2, cooldown: 3, delay: 1 },
        { id: 2, keys: [], constant: true, content: "常驻设定", extensions: { position: 4, depth: 2, role: 1 } },
      ],
    },
    extensions: { talkativeness: "0.5", depth_prompt: { prompt: "备注" }, custom_plugin_flag: true },
  },
};

test("parses a v2 card and keeps advanced world-book fields", () => {
  const { card, warnings } = parseTavernCard(v2Card);
  assert.equal(card.spec, "chara_card_v2");
  assert.equal(card.data.name, "档案员");
  assert.deepEqual(card.data.alternate_greetings, ["备选一", "备选二"]);
  assert.deepEqual(card.data.group_only_greetings, ["群聊开场"]);
  assert.equal(card.data.system_prompt, "系统设定");
  assert.equal(card.data.creator, "作者");
  const entries = card.data.character_book!.entries;
  assert.equal(entries[0].selectiveLogic, TAVERN_SELECTIVE_LOGIC.AND_ALL);
  assert.equal(entries[0].caseSensitive, true);
  assert.equal(entries[0].matchWholeWords, true);
  assert.equal(entries[0].useProbability, true);
  assert.equal(entries[0].group, "港");
  assert.equal(entries[0].groupWeight, 20);
  assert.equal(entries[0].preventRecursion, true);
  assert.equal(entries[0].sticky, 2);
  assert.equal(entries[0].cooldown, 3);
  assert.equal(entries[0].delay, 1);
  assert.equal(entries[1].position, TAVERN_ENTRY_POSITION.AT_DEPTH);
  assert.equal(entries[1].depth, 2);
  assert.equal(entries[1].role, "user");
  assert.ok(warnings.some(warning => warning.includes("custom_plugin_flag")));
});

test("serialize and re-parse round-trips the supported card model", () => {
  const first = parseTavernCard(v2Card).card;
  const serialized = serializeTavernCard(first);
  assert.deepEqual(serialized.spec, TAVERN_CARD_SPEC_V3);
  const second = parseTavernCard(serialized).card;
  assert.deepEqual(second.data, first.data);
});

test("bare card bodies without spec are accepted with a warning-free parse", () => {
  const { card } = parseTavernCard({ name: "裸卡", description: "只有名字和描述" });
  assert.equal(card.data.name, "裸卡");
  assert.equal(card.data.description, "只有名字和描述");
  assert.equal(card.spec, TAVERN_CARD_SPEC_V3);
});

test("a card without a name is rejected", () => {
  assert.throws(() => parseTavernCard({ data: { description: "无名字" } }), /缺少角色名/u);
});

test("context conversion keeps prompt fields and the world book", () => {
  const { card } = parseTavernCard(v2Card);
  const context = contextFromTavernCard(card);
  assert.equal(context.systemPrompt, "系统设定");
  assert.equal(context.postHistoryInstructions, "历史后指令");
  assert.equal(context.messageExamples, "<START>");
  assert.equal(context.creatorNotes, "作者备注");
  assert.deepEqual(context.alternateGreetings, ["备选一", "备选二"]);
  assert.ok(context.characterBook?.entries.length === 2);
});

test("context to card keeps openings and merges alternate greetings", () => {
  const card = tavernCardFromContext({
    name: "裴聿",
    author: "原作者",
    description: "设定",
    firstMessage: "主开场",
    alternateGreetings: ["备选开场"],
    openingMessages: [{ role: "assistant", content: "主开场" }, { role: "assistant", content: "第二开场" }],
    messageExamples: "示例",
    characterBook: parseTavernWorldbook({ entries: [{ keys: ["长安"], content: "长安城。" }] }),
    speechVoice: "xumeng-voice-1" as never,
    extensions: { xumeng: { keep: true } },
    tags: ["剧情"],
  });
  assert.equal(card.data.first_mes, "主开场");
  assert.deepEqual(card.data.alternate_greetings, ["备选开场", "第二开场"]);
  assert.equal(card.data.creator, "原作者");
  assert.equal(card.data.character_book?.entries.length, 1);
  assert.deepEqual(card.data.extensions.xumeng, { keep: true, speechVoice: "xumeng-voice-1" });
});

test("compatibility report lists unsupported extensions and book warnings", () => {
  const { card } = parseTavernCard(v2Card);
  const report = tavernCompatibilityReport(card);
  assert.ok(report.supported.includes("character_book"));
  assert.ok(report.supported.includes("alternate_greetings"));
  assert.ok(report.unsupported.some(item => item.includes("custom_plugin_flag")));
  assert.ok(report.warnings.some(warning => warning.includes("高级触发规则")));
});

test("serializeTavernWorldbook is parseable back to the same entries", () => {
  const book = parseTavernWorldbook({ name: "b", entries: [
    { id: 7, keys: ["a"], content: "A", position: "after_char", insertion_order: 3, extensions: { position: 1 } },
  ] });
  const roundTrip = parseTavernWorldbook(serializeTavernWorldbook(book));
  assert.deepEqual(roundTrip.entries, book.entries);
});

test("user-role openings survive the v3 extension round-trip", () => {
  const source = {
    name: "双开场",
    openingMessages: [{ role: "user" as const, content: "我先开口" }, { role: "assistant" as const, content: "回应开场" }],
  };
  const card = tavernCardFromContext(source);
  assert.deepEqual((card.data.extensions.xumeng as Record<string, unknown>).openingMessages, source.openingMessages);
  const context = contextFromTavernCard(parseTavernCard(serializeTavernCard(card)).card);
  assert.deepEqual(context.openingMessages, source.openingMessages);
});
