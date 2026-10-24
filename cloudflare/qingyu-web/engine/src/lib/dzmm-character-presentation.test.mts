import test from "node:test";
import assert from "node:assert/strict";
import * as presentationModule from "./dzmm-character-presentation";
import * as characterContextModule from "./dzmm-character-context";
import * as openingModule from "./dzmm-conversation-opening";
import * as conversationModule from "./dzmm-conversation-context";
import * as contextModule from "./dzmm-context";
import * as chatModule from "./dzmm-chat";
import type { DzmmCharacter, DzmmChatMessage } from "./dzmm-chat";
import type { DzmmSavedConversation } from "./dzmm-storage";

const { splitDzmmCharacterPresentation, applyDzmmReaderNames, getDzmmCharacterPreviewText, getDzmmCharacterCreatorNotes,
  projectDzmmStoryCharacter, projectDzmmSourceOpeningHistory } =
  ("default" in presentationModule ? presentationModule.default : presentationModule) as typeof import("./dzmm-character-presentation");
const { getDzmmOpeningMessages } =
  ("default" in characterContextModule ? characterContextModule.default : characterContextModule) as typeof import("./dzmm-character-context");
const { getDzmmConversationOpening } =
  ("default" in openingModule ? openingModule.default : openingModule) as typeof import("./dzmm-conversation-opening");
const { captureDzmmConversationOpening, applyDzmmConversationOpening, parseDzmmConversationOpening } =
  ("default" in conversationModule ? conversationModule.default : conversationModule) as typeof import("./dzmm-conversation-context");
const { prepareDzmmRequest } =
  ("default" in contextModule ? contextModule.default : contextModule) as typeof import("./dzmm-context");
const { validateDzmmChatInput, buildDzmmPromptPlan } =
  ("default" in chatModule ? chatModule.default : chatModule) as typeof import("./dzmm-chat");

const role = {
  id: "local-presentation-review",
  name: "龙漓",
  description: "我，南海龙王最小的女儿，龙漓，在海底待了三百年，今天要上岸找{{user}}看看钟楼。\nーーーーーー龙漓留。\n还有！才不是离家出走呢！",
  personality: "好奇又直率，尊重对方的选择。",
  scenario: "港城钟楼的午后。",
  firstMessage: "钟楼里的钟声响了，龙漓向你挥手。",
};
const credit = "【感谢大愣的跑图捏。】";
const productionNotes = "PS：嗨害是我光点！\n首发发现作者注忘记改成南海，还是初版设定的东海，二次修改（）\n主要测试模型为med，建议使用高级模型游玩。\n卡有问题请告诉我，我去修改。";
const metadataSentinel = "NEVER_SEND_CREATOR_METADATA";
const mixedOpening = `钟楼里的钟声响了，龙漓向你挥手。\n\n作者注：${metadataSentinel}，封面已经更新。`;

function storyTurns(plan: ReturnType<typeof buildDzmmPromptPlan>) {
  return plan.messages.filter((_message, index) => ["opening", "recent-history"].includes(plan.diagnostics.segments[index].source));
}

function planFor(character: DzmmCharacter & { id: string }, conversation: DzmmSavedConversation) {
  const input = applyDzmmConversationOpening(character, conversation);
  const request = prepareDzmmRequest(input, conversation.messages, undefined, undefined, "fast", 512, { userName: "巡钟人" });
  const validated = validateDzmmChatInput(request);
  return { request, validated, plan: buildDzmmPromptPlan(validated) };
}

test("the dragon-letter example separates a leading illustration credit and production PS without rewriting source data", () => {
  const raw = `${credit}\r\n${role.description.replace(/\n/g, "\r\n")}\r\n\r\n${productionNotes.replace(/\n/g, "\r\n")}`;
  const card = Object.freeze({ ...role, description: raw, scenario: "", firstMessage: "" });
  const before = JSON.stringify(card);
  const result = splitDzmmCharacterPresentation(card.description);
  assert.equal(result.body, role.description);
  assert.deepEqual(result.notes, [credit, productionNotes]);
  assert.ok(result.body.includes("{{user}}"), "Presentation must not expand player macros.");
  assert.equal(getDzmmCharacterPreviewText(card), role.description);
  assert.deepEqual(getDzmmConversationOpening(card), {
    kind: "background", messages: [{ role: "assistant", content: role.description }],
  });
  assert.equal(JSON.stringify(card), before, "The source and its provenance remain byte-for-byte unchanged.");
});

test("copied CR-backslash-LF separators normalize only in derived text", () => {
  const raw = ["旅人抵达港口。", "", "作者注：封面已经更新。"].join("\r\\\n");
  const before = raw;
  assert.deepEqual(splitDzmmCharacterPresentation(raw), {
    body: "旅人抵达港口。", notes: ["作者注：封面已经更新。"],
  });
  assert.equal(raw, before);
});

test("ordinary letter PS, well-wishes, and quoted author-like words remain story prose", () => {
  const examples = [
    "小龙给你写信。\nPS：明早记得带地图。\n她把信放进信箱。",
    "小龙给你写信。\nPS：祝玩得开心，记得晚饭前回家。\n她把信放进信箱。",
    "她寄来信。\nPS：她把便签称为“作者说明”，其实只是在交代房间布置。\n故事继续。",
    "她寄来信。\nPS：老师说过“建议使用更准确的模型”，她还在想船模该怎么修。\n她把信放下。",
  ];
  for (const raw of examples) assert.deepEqual(splitDzmmCharacterPresentation(raw), { body: raw, notes: [] });
});

test("an ordinary PS before a separate production PS is not swallowed by later author cues", () => {
  const body = "我明早去钟楼。\nPS：记得带上地图。\n龙漓把信放进信箱。";
  const notes = "PS：作者注：主要测试模型为快速模型。";
  assert.deepEqual(splitDzmmCharacterPresentation(`${body}\n\n${notes}`), { body, notes: [notes] });
});

test("four-backtick outer fences retain shorter inner fences and note-like code verbatim", () => {
  const code = "````text\n这是一段书信。\n```\n作者注：这句是代码中的原文。\n````";
  const notes = "作者说明：封面已经更新。";
  assert.deepEqual(splitDzmmCharacterPresentation(`${code}\n\n${notes}`), { body: code, notes: [notes] });
  const tildes = "~~~~text\n~~~\nPS：建议使用高级模型。\n~~~~";
  assert.deepEqual(splitDzmmCharacterPresentation(tildes), { body: tildes, notes: [] });
});

test("fence lines with a trailing info string do not close an existing fenced code block", () => {
  const raw = "```text\n这是一段代码。\n```other\n作者注：仍在代码中。\n```\n故事继续。";
  assert.deepEqual(splitDzmmCharacterPresentation(raw), { body: raw, notes: [] });
});

test("indented and tab-indented code do not become author headings after trimming", () => {
  for (const indent of ["    ", "\t"]) {
    const raw = `${indent}作者说明：这是代码的字面内容。\n${indent}正文：\n${indent}原样保留。\n故事继续。`;
    const result = splitDzmmCharacterPresentation(raw);
    assert.equal(result.body, raw.trim());
    assert.deepEqual(result.notes, []);
  }
});

test("multi-line Chinese, Japanese, and ASCII quoted dialogue protects note-like lines", () => {
  for (const [open, close] of [["“", "”"], ["「", "」"], ["『", "』"], ['"', '"']]) {
    const body = `她照着便签读道：\n${open}\n作者注：这份地图由领主本人修改。\nPS：建议使用高级模型，指的是展柜里的船模型。\n${close}\n她把便签递给你。`;
    const notes = "作者备注：封面已经更新。";
    assert.deepEqual(splitDzmmCharacterPresentation(`${body}\n\n${notes}`), { body, notes: [notes] });
  }
});

test("an explicitly marked story section resumes prose after author metadata", () => {
  const notes = "## 作者说明\n主要测试模型为快速模型。";
  assert.deepEqual(splitDzmmCharacterPresentation(`${notes}\n正文：\n旅人推开门。\nPS：记得带地图。`), {
    body: "旅人推开门。\nPS：记得带地图。", notes: [notes],
  });
});

test("structured creator notes are retained for display and duplicate extracted notes appear once", () => {
  const note = "作者说明：这是独立的创作说明。";
  const card = {
    introduction: `玩家介绍。\n\n${note}`,
    description: `故事背景。\n\n${note}`,
    firstMessage: `角色向你问好。\n\n作者注：主要测试模型为快速模型。`,
    creatorNotes: note,
  };
  assert.deepEqual(getDzmmCharacterCreatorNotes(card), [note, "作者注：主要测试模型为快速模型。"]);
  assert.deepEqual(splitDzmmCharacterPresentation("", ` 独立作者备注\r\n第二行 `), {
    body: "", notes: ["独立作者备注\n第二行"],
  });
  assert.equal(getDzmmCharacterPreviewText(card), "玩家介绍。");
});

test("story text shows the current username wherever {{user}} appears", () => {
  assert.equal(applyDzmmReaderNames("{{USER}} 与 {{ char }}", { userName: "阿宁", characterName: "霍聿深" }), "阿宁 与 霍聿深");
  assert.equal(applyDzmmReaderNames("仍是 {{user}}", { userName: "  " }), "仍是 {{user}}");
  assert.equal(applyDzmmReaderNames("名字是 {{user}}", { userName: "{{char}}" }), "名字是 {{char}}");
  assert.equal(getDzmmCharacterPreviewText({ name: "霍聿深", description: "{{user}}联姻的丈夫。" }, "阿宁"), "阿宁联姻的丈夫。");
});

test("projection preserves authored personality, scenario and system instructions plus every user opening", () => {
  const card = {
    ...role,
    description: `${role.description}\n\n作者注：${metadataSentinel}。`,
    personality: "沉稳。\n作者说明：她礼貌而坚持原则。",
    scenario: "旅人抵达港口。\n作者说明：港口入夜关闭。",
    systemPrompt: "作者说明：对白需要体现当地礼节。",
    openingMessages: [
      { role: "user" as const, content: "我读出便签：\n作者注：今晚城门关闭。" },
      { role: "assistant" as const, content: mixedOpening },
    ],
    alternateGreetings: [`灯塔在远处亮起。\n\n作者注：${metadataSentinel}。`],
  };
  const before = JSON.stringify(card);
  const projected = projectDzmmStoryCharacter(card);
  assert.equal(projected.description, role.description);
  for (const field of ["personality", "scenario", "systemPrompt"] as const) assert.equal(projected[field], card[field]);
  assert.equal(projected.openingMessages[0].content, card.openingMessages[0].content);
  assert.equal(projected.openingMessages[1].content, role.firstMessage);
  assert.deepEqual(projected.alternateGreetings, ["灯塔在远处亮起。"]);
  assert.deepEqual(getDzmmOpeningMessages(card), projected.openingMessages);
  assert.equal(JSON.stringify(card), before);
});

test("a notes-only card gets a neutral welcome instead of an empty or author-only assistant opening", () => {
  const card = {
    ...role, description: "作者说明：封面已经更新。", scenario: "",
    firstMessage: "作者注：主要测试模型为快速模型。", introduction: "玩家介绍，不能作为开场。",
    creatorNotes: "独立作者备注不能作为开场。",
  };
  const opening = getDzmmConversationOpening(card);
  assert.equal(opening.kind, "welcome");
  assert.equal(opening.messages.length, 1);
  assert.ok(opening.messages[0].content.includes("龙漓"));
  assert.ok(opening.messages[0].content.includes("什么场景"));
  assert.doesNotMatch(opening.messages[0].content, /作者|封面|模型|玩家介绍/);
});

test("new conversations use apply-opening then prepare, validation and provider assembly without metadata leakage", () => {
  const card = {
    ...role, description: `${role.description}\n\n作者注：${metadataSentinel}。`, firstMessage: mixedOpening,
    introduction: `DISPLAY_ONLY_INTRODUCTION`, creatorNotes: `DISPLAY_ONLY_CREATOR_NOTE`,
  };
  const opening = captureDzmmConversationOpening(card);
  const conversation: DzmmSavedConversation = {
    id: "new-presentation-review", characterId: card.id, title: card.name, updatedAt: 1, opening,
    messages: [...opening.messages.map((message, index) => ({ ...message, id: `opening-${index}` })),
      { id: "user-1", role: "user", content: "请带我去看钟楼。" }],
  };
  const before = JSON.stringify({ card, conversation });
  const { request, validated, plan } = planFor(card, conversation);
  for (const payload of [request, validated, plan.messages]) {
    assert.doesNotMatch(JSON.stringify(payload), /NEVER_SEND_CREATOR_METADATA|DISPLAY_ONLY_INTRODUCTION|DISPLAY_ONLY_CREATOR_NOTE/);
  }
  assert.deepEqual(storyTurns(plan), [
    { role: "assistant", content: role.firstMessage }, { role: "user", content: "请带我去看钟楼。" },
  ]);
  assert.ok(JSON.stringify(plan.messages).includes("巡钟人"), "The story still expands its real player macro.");
  assert.equal(JSON.stringify({ card, conversation }), before);
});

test("a raw API request projects a recognizable old opening while rejecting display-only fields", () => {
  const character: DzmmCharacter = { name: role.name, personality: role.personality, scenario: role.scenario,
    description: `${role.description}\n\n作者注：${metadataSentinel}。`, firstMessage: mixedOpening };
  const messages: DzmmChatMessage[] = [{ role: "assistant", content: mixedOpening }, { role: "user", content: "我想看看钟楼。" }];
  const raw = { character, messages };
  const before = JSON.stringify(raw);
  const validated = validateDzmmChatInput(raw);
  assert.deepEqual(validated.messages, [{ role: "assistant", content: role.firstMessage }, messages[1]]);
  assert.doesNotMatch(JSON.stringify(buildDzmmPromptPlan(validated).messages), /NEVER_SEND_CREATOR_METADATA/);
  assert.throws(() => validateDzmmChatInput({ ...raw, character: { ...character, creatorNotes: "显示备注" } }), /角色设定/);
  assert.equal(JSON.stringify(raw), before);
});

test("saved legacy template snapshots are cleaned only for the model and never rewrite real stored messages", () => {
  const card = { ...role, firstMessage: mixedOpening };
  const opening = parseDzmmConversationOpening({ version: 1, kind: "opening", source: "template",
    messages: [{ role: "assistant", content: mixedOpening }] });
  const conversation: DzmmSavedConversation = {
    id: "legacy-template-review", characterId: card.id, title: "已有书信", updatedAt: 1, opening,
    messages: [{ id: "legacy-opening", role: "assistant", content: mixedOpening },
      { id: "user-1", role: "user", content: "我们一起去钟楼吧。" }],
  };
  const before = JSON.stringify(conversation);
  const { plan } = planFor(card, conversation);
  assert.deepEqual(storyTurns(plan), [
    { role: "assistant", content: role.firstMessage }, { role: "user", content: "我们一起去钟楼吧。" },
  ]);
  assert.doesNotMatch(JSON.stringify(plan.messages), /NEVER_SEND_CREATOR_METADATA/);
  assert.equal(JSON.stringify(conversation), before);
});

test("legacy background and selected alternate openings survive the actual apply-to-prepare path exactly once", () => {
  const background = `${role.description}\n\n作者注：${metadataSentinel}。`;
  const alternate = `另一幕：龙漓正在修理灯塔。\n\n作者注：${metadataSentinel}。`;
  const cases = [
    { character: { ...role, description: background, scenario: "", firstMessage: "" }, raw: background, body: role.description },
    { character: { ...role, alternateGreetings: [alternate] }, raw: alternate, body: "另一幕：龙漓正在修理灯塔。" },
  ];
  for (const [index, { character, raw, body }] of cases.entries()) {
    const conversation: DzmmSavedConversation = {
      id: `legacy-selected-review-${index}`, characterId: character.id, title: "已有相遇", updatedAt: 1,
      messages: [{ id: "opening", role: "assistant", content: raw },
        { id: "user", role: "user", content: "请继续讲你的计划。" }],
    };
    const before = JSON.stringify({ character, conversation });
    const { plan } = planFor(character, conversation);
    assert.deepEqual(storyTurns(plan), [
      { role: "assistant", content: body.replace("{{user}}", "巡钟人") },
      { role: "user", content: "请继续讲你的计划。" },
    ]);
    assert.doesNotMatch(JSON.stringify(plan.messages), /NEVER_SEND_CREATOR_METADATA/);
    assert.equal(JSON.stringify({ character, conversation }), before);
  }
});

test("unknown and genuinely edited conversation text is not reinterpreted as card author metadata", () => {
  const laterReply = `龙漓把信念给你听：\n作者说明：钟楼管理员今天会过来。`;
  const messages: DzmmChatMessage[] = [
    { role: "assistant", content: "我们已经到了另一座城，原开场不再有效。" },
    { role: "user", content: "请读出那张纸。" },
    { role: "assistant", content: laterReply },
    { role: "user", content: "作者注：这是我主动输入的便签内容。" },
  ];
  const before = JSON.stringify(messages);
  assert.deepEqual(projectDzmmSourceOpeningHistory(role, messages), messages);
  const conversation: DzmmSavedConversation = {
    id: "real-history-review", characterId: role.id, title: "真实历史", updatedAt: 1,
    messages: messages.map((message, index) => ({ ...message, id: `real-${index}` })),
  };
  const { plan } = planFor(role, conversation);
  assert.deepEqual(storyTurns(plan), messages);
  assert.equal(JSON.stringify(messages), before);
});

test("a recognized legacy primary opening pins its raw text across reload and repeated reconciliation", () => {
  const { resolveDzmmConversationOpening, reconcileDzmmConversationOpening } =
    ("default" in conversationModule ? conversationModule.default : conversationModule) as typeof import("./dzmm-conversation-context");
  const card = { ...role, firstMessage: mixedOpening };
  const conversation: DzmmSavedConversation = {
    id: "legacy-pin-primary", characterId: card.id, title: "旧相遇", updatedAt: 1,
    messages: [{ id: "raw-opening", role: "assistant", content: mixedOpening },
      { id: "latest-user", role: "user", content: "我看看摆钟。" }],
  };
  const before = JSON.stringify(conversation);
  const pinned = resolveDzmmConversationOpening(card, conversation);
  assert.equal(pinned.source, "template");
  assert.deepEqual(pinned.messages, [{ role: "assistant", content: mixedOpening }]);
  const loaded = parseDzmmConversationOpening(JSON.parse(JSON.stringify(pinned)));
  assert.deepEqual(reconcileDzmmConversationOpening(loaded, conversation.messages), loaded);
  assert.deepEqual(resolveDzmmConversationOpening(card, { ...conversation, opening: loaded }), loaded);
  const { plan } = planFor(card, { ...conversation, opening: loaded });
  assert.deepEqual(storyTurns(plan), [
    { role: "assistant", content: role.firstMessage },
    { role: "user", content: "我看看摆钟。" },
  ]);
  assert.doesNotMatch(JSON.stringify(plan.messages), /NEVER_SEND_CREATOR_METADATA/);
  assert.equal(JSON.stringify(conversation), before);
  const edited = conversation.messages.map(message => message.id === "raw-opening"
    ? { ...message, content: "工匠改口说：请去旁边的书店。" } : { ...message });
  assert.equal(reconcileDzmmConversationOpening(loaded, edited).source, "history");
});

test("raw legacy multi-openings keep notes-only assistant turns in the snapshot while omitting them from model prose", () => {
  const { resolveDzmmConversationOpening, reconcileDzmmConversationOpening } =
    ("default" in conversationModule ? conversationModule.default : conversationModule) as typeof import("./dzmm-conversation-context");
  const authored = [
    { role: "assistant" as const, content: `作者备注：${metadataSentinel}` },
    { role: "user" as const, content: "我走进钟表铺。" },
    { role: "assistant" as const, content: `成年工匠打开工具箱。\nPS：作者注：${metadataSentinel}` },
  ];
  const card = { ...role, firstMessage: authored[0].content, openingMessages: authored };
  const conversation: DzmmSavedConversation = {
    id: "legacy-pin-multi", characterId: card.id, title: "旧钟表铺", updatedAt: 1,
    messages: [...authored, { role: "user" as const, content: "我检查齿轮。" }].map((message, index) => ({ ...message, id: `raw-${index}` })),
  };
  const before = JSON.stringify({ card, conversation });
  const opening = resolveDzmmConversationOpening(card, conversation);
  assert.equal(opening.source, "template");
  assert.deepEqual(opening.messages, authored);
  assert.deepEqual(reconcileDzmmConversationOpening(opening, conversation.messages), opening);
  const { request, plan } = planFor(card, { ...conversation, opening });
  const expected = [{ role: "user", content: "我走进钟表铺。" },
    { role: "assistant", content: "成年工匠打开工具箱。" }, { role: "user", content: "我检查齿轮。" }];
  assert.deepEqual(request.messages, expected);
  assert.deepEqual(storyTurns(plan), expected);
  assert.doesNotMatch(JSON.stringify(plan.messages), /NEVER_SEND_CREATOR_METADATA/);
  assert.equal(JSON.stringify({ card, conversation }), before);
});

test("legacy selected alternate openings pin the original alternate and do not reinsert the primary on reload", () => {
  const { resolveDzmmConversationOpening, reconcileDzmmConversationOpening } =
    ("default" in conversationModule ? conversationModule.default : conversationModule) as typeof import("./dzmm-conversation-context");
  const alternate = `成年工匠在码头检查一座旧钟。\nPS：作者注：${metadataSentinel}`;
  const card = { ...role, alternateGreetings: [alternate] };
  const conversation: DzmmSavedConversation = {
    id: "legacy-pin-alternate", characterId: card.id, title: "旧码头", updatedAt: 1,
    messages: [{ id: "alternate", role: "assistant", content: alternate },
      { id: "latest", role: "user", content: "我们先检查钟摆。" }],
  };
  const before = JSON.stringify({ card, conversation });
  const opening = resolveDzmmConversationOpening(card, conversation);
  assert.equal(opening.source, "template");
  assert.deepEqual(opening.messages, [{ role: "assistant", content: alternate }]);
  assert.deepEqual(reconcileDzmmConversationOpening(opening, conversation.messages), opening);
  const { plan } = planFor(card, { ...conversation, opening: parseDzmmConversationOpening(opening) });
  assert.deepEqual(storyTurns(plan), [{ role: "assistant", content: "成年工匠在码头检查一座旧钟。" },
    { role: "user", content: "我们先检查钟摆。" }]);
  assert.doesNotMatch(JSON.stringify(plan.messages), /NEVER_SEND_CREATOR_METADATA/);
  assert.equal(JSON.stringify({ card, conversation }), before);
});
