import test from "node:test";
import assert from "node:assert/strict";
import characterModule from "./dzmm-characters";
import characterContextModule from "./dzmm-character-context";
import contextModule from "./dzmm-context";
import chatModule from "./dzmm-chat";
import handlerModule from "./dzmm-chat-handler";

const { parseCharacterImport, exportCharacterJson } = characterModule as typeof import("./dzmm-characters");
const { getDzmmOpeningMessages, parseDzmmCharacterContext } = characterContextModule as typeof import("./dzmm-character-context");
const { prepareDzmmRequest } = contextModule as typeof import("./dzmm-context");
const { buildDzmmPromptPlan, buildDzmmSystemPrompt, validateDzmmChatInput } = chatModule as typeof import("./dzmm-chat");
const { handleDzmmChatPost } = handlerModule as typeof import("./dzmm-chat-handler");

function importedCard() {
  return parseCharacterImport({ spec: "chara_card_v2", data: {
    name: "原创档案员", description: "CHARACTER_DESCRIPTION", personality: "认真核对文献。", scenario: "协助成年旅人查阅档案。",
    first_mes: "PRIMARY_GREETING：旧港档案已备好。", alternate_greetings: ["ALTERNATE_GREETING：山城档案已备好。"],
    system_prompt: "AUTHOR_CHARACTER_SETTING", creator_notes: "DISPLAY_ONLY_AUTHOR_NOTES",
    character_book: { name: "档案", entries: [
      { id: 1, keys: [], constant: true, insertion_order: 20, position: "before_char", content: "COMMON_BEFORE：{{char}}负责登记。" },
      { id: 2, keys: ["旧港"], insertion_order: 10, position: "before_char", content: "PRIMARY_BEFORE：旧港建于南岸。" },
      { id: 3, keys: ["山城"], insertion_order: 10, position: "before_char", content: "ALTERNATE_BEFORE：山城档案在楼上。" },
      { id: 4, keys: [], constant: true, insertion_order: 10, position: "after_char", content: "EXPLICIT_AFTER" },
      { id: 5, keys: [], constant: true, insertion_order: 20, content: "DEFAULT_AFTER" },
      { id: 6, keys: [], constant: true, enabled: false, position: "before_char", content: "DISABLED_BEFORE" },
    ] },
  } }, "worldbook-position-original");
}

test("v2 position survives import and normalized export without changing the omitted default", () => {
  const card = importedCard();
  const positions = card.characterBook!.entries.map(entry => entry.position);
  assert.deepEqual(positions, ["before_char", "before_char", "before_char", "after_char", undefined, "before_char"]);
  assert.deepEqual(parseCharacterImport(exportCharacterJson(card), card.id).characterBook, card.characterBook);
  assert.equal(Object.hasOwn(card.characterBook!.entries[4], "position"), false);
  assert.deepEqual(card.characterBook!.entries.map(entry => entry.id), ["1", "2", "3", "4", "5", "6"]);
});

test("unsupported worldbook positions fail validation instead of silently moving a source entry", () => {
  for (const position of [null, 0, "before_system", "at_depth", "", {}]) {
    const context = { character_book: { entries: [{ keys: [], constant: true, content: "资料", position }] } };
    assert.throws(() => parseDzmmCharacterContext(context), /世界书位置/);
    assert.throws(() => validateDzmmChatInput({ character: { name: "档案员", characterBook: context.character_book }, messages: [{ role: "user", content: "你好" }] }),
      /世界书位置/);
  }
});

test("before-char placement stays after platform rules and before character data with stable per-position order", () => {
  const card = importedCard();
  const opening = getDzmmOpeningMessages(card);
  const request = prepareDzmmRequest(card, [...opening, { role: "user", content: "请继续介绍。" }]);
  const input = validateDzmmChatInput(request);
  const plan = buildDzmmPromptPlan(input);
  assert.deepEqual(plan.diagnostics.segments.slice(0, 4).map(segment => segment.source),
    ["platform-rules", "worldbook-before-character", "character", "worldbook"]);
  assert.equal(plan.messages[0].content, buildDzmmSystemPrompt(input, true), "Source card data cannot replace the initial platform rules.");
  assert.ok(!plan.messages[0].content.includes("COMMON_BEFORE"));
  assert.ok(!plan.messages[0].content.includes("CHARACTER_DESCRIPTION"));
  assert.match(plan.messages[1].content, /故事参考资料/);
  assert.ok(plan.messages[1].content.indexOf("PRIMARY_BEFORE") < plan.messages[1].content.indexOf("COMMON_BEFORE"));
  assert.match(plan.messages[1].content, /原创档案员负责登记/);
  assert.match(plan.messages[2].content, /CHARACTER_DESCRIPTION/);
  assert.match(plan.messages[2].content, /AUTHOR_CHARACTER_SETTING/);
  assert.ok(plan.messages[3].content.indexOf("EXPLICIT_AFTER") < plan.messages[3].content.indexOf("DEFAULT_AFTER"));
  assert.equal(plan.diagnostics.loreEntries, 4);
  assert.ok(!JSON.stringify(plan.messages).includes("DISABLED_BEFORE"));
  assert.equal(plan.diagnostics.segments.at(-1)?.source, "round-reminder");
});

test("cards without active before-char entries retain the legacy system and post-character worldbook layout", () => {
  const input = validateDzmmChatInput({ character: { name: "原创档案员", description: "CHARACTER_DATA", characterBook: { entries: [
    { keys: ["missing-key"], content: "INACTIVE_BEFORE", position: "before_char" },
    { keys: [], content: "LEGACY_LORE", constant: true },
    { keys: [], content: "EXPLICIT_AFTER", constant: true, position: "after_char" },
  ] } }, messages: [{ role: "user", content: "请看档案。" }] });
  const plan = buildDzmmPromptPlan(input);
  assert.deepEqual(plan.diagnostics.segments.slice(0, 2).map(segment => segment.source), ["rules-and-character", "worldbook"]);
  assert.equal(plan.messages[0].content, buildDzmmSystemPrompt(input));
  assert.match(plan.messages[1].content, /LEGACY_LORE/);
  assert.match(plan.messages[1].content, /EXPLICIT_AFTER/);
  assert.ok(!JSON.stringify(plan.messages).includes("INACTIVE_BEFORE"));
});

for (const openingIndex of [0, 1]) test(`first provider request activates only selected opening ${openingIndex} lore and keeps its position`, async () => {
  const card = importedCard();
  const opening = getDzmmOpeningMessages(card, openingIndex);
  const history = [...opening, { role: "user" as const, content: "请继续介绍。" }];
  const before = JSON.stringify(card);
  const prepared = prepareDzmmRequest(card, history);
  const plan = buildDzmmPromptPlan(validateDzmmChatInput(prepared));
  let captured: { messages: Array<{ role: string; content: string }> } | undefined;
  let providerCalls = 0;
  const response = await handleDzmmChatPost(new Request("https://app.test/api/dzmm/chat", {
    method: "POST", body: JSON.stringify(prepared),
  }), { DZMM_API_KEY: "local-test-placeholder", DZMM_BASE_URL: "https://provider.test/v1", DZMM_MODEL: "local-test" }, {
    providerFetch: async (_url, options) => {
      providerCalls++;
      captured = JSON.parse(options!.body as string);
      return new Response('data: {"choices":[{"delta":{"content":"请看这一页。"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "请看这一页。");
  assert.equal(providerCalls, 1, "Only the isolated provider stub is called.");
  assert.deepEqual(captured!.messages, plan.messages);
  const selected = openingIndex ? "ALTERNATE" : "PRIMARY";
  const excluded = openingIndex ? "PRIMARY" : "ALTERNATE";
  const wire = JSON.stringify(captured!.messages);
  assert.match(captured!.messages[1].content, new RegExp(`${selected}_BEFORE`));
  assert.ok(!wire.includes(`${excluded}_BEFORE`));
  assert.ok(!wire.includes(`${excluded}_GREETING`));
  assert.equal(captured!.messages.filter(message => message.content === opening[0].content).length, 1);
  assert.ok(!wire.includes("DISPLAY_ONLY_AUTHOR_NOTES"));
  assert.deepEqual(captured!.messages.filter((_message, index) => ["opening", "recent-history"].includes(plan.diagnostics.segments[index].source)), history);
  assert.equal(JSON.stringify(card), before);
});
