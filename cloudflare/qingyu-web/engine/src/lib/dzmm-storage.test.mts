import test from "node:test";
import assert from "node:assert/strict";
import * as storageModule from "./dzmm-storage";
import * as characterModule from "./dzmm-characters";
import * as memoryModule from "./dzmm-story-memory";
import * as worldModule from "./dzmm-world-state";
import * as conversationContextModule from "./dzmm-conversation-context";
import type { DzmmPreferences, DzmmSavedConversation, DzmmSavedState } from "./dzmm-storage";

const { DZMM_INITIAL_STATE, hydrateDzmmState } =
  storageModule as typeof import("./dzmm-storage");
const { DZMM_CHARACTERS, parseCharacterImport } =
  characterModule as typeof import("./dzmm-characters");
const { createDzmmStoryMemory, fingerprintDzmmStoryMessages } = memoryModule as typeof import("./dzmm-story-memory");
const { createDzmmWorldState } = worldModule as typeof import("./dzmm-world-state");
const { captureDzmmConversationOpening } = conversationContextModule as typeof import("./dzmm-conversation-context");
const publicId = DZMM_CHARACTERS[0].id;
const createdAt = "2026-10-02T03:00:00.000Z";

function savedState(): DzmmSavedState {
  return {
    ...DZMM_INITIAL_STATE,
    favorites: [],
    custom: [],
    conversations: [],
    preferences: { ...DZMM_INITIAL_STATE.preferences },
  };
}

function conversation(
  id = "good-conversation",
  characterId = publicId,
): DzmmSavedConversation {
  return {
    id,
    characterId,
    title: "雨中的书店",
    updatedAt: 1_759_369_600_000,
    messages: [
      { id: "opening", role: "assistant", content: "你好，欢迎来到书店。" },
      { id: "question", role: "user", content: " 想找一本旅行书 🌱 " },
    ],
  };
}

function localCharacter(id = "local-character") {
  return {
    ...parseCharacterImport(
      {
        name: "林音",
        author: "我",
        description: "书店店员",
        personality: "安静而好奇",
        scenario: "雨天的书店",
        firstMessage: "欢迎，想找什么书？",
        cover: "/dzmm/covers/1323657.webp",
        tags: ["都市", "原创"],
      },
      id,
    ),
    createdAt,
  };
}

test("valid saved state roundtrips without changing content, IDs, dates, or preferences", () => {
  const original = savedState();
  original.custom = [localCharacter()];
  original.favorites = [publicId, original.custom[0].id];
  original.conversations = [
    conversation(),
    conversation("local-conversation", original.custom[0].id),
  ];
  original.preferences = {
    nickname: "阿青",
    persona: "在城里经营一家书店。",
    preset: "用简洁自然的对话回应。",
    model: "story",
    dark: true,
  };

  const { state, warnings } = hydrateDzmmState(JSON.stringify(original));

  assert.deepEqual(state, original);
  assert.deepEqual(warnings, []);
  assert.notEqual(state.preferences, original.preferences);
});

test("adventure phase persists and keeps the same conversation history when chat begins", () => {
  const original = { ...savedState(), conversations: [{ ...conversation(), phase: "adventure" as const }] };
  const restored = hydrateDzmmState(JSON.stringify(original));
  assert.equal(restored.warnings.length, 0);
  assert.equal(restored.state.conversations[0].phase, "adventure");
  const chatState = { ...restored.state, conversations: restored.state.conversations.map(item => ({ ...item, phase: "chat" as const })) };
  const chatRestored = hydrateDzmmState(JSON.stringify(chatState));
  assert.equal(chatRestored.state.conversations[0].phase, "chat");
  assert.deepEqual(chatRestored.state.conversations[0].messages, original.conversations[0].messages);
});

test("primary and alternate opening snapshots roundtrip even after the private card has changed", () => {
  const originalCharacter = { ...localCharacter(), alternateGreetings: ["另一次灯塔相遇。"] };
  const cards = { ...originalCharacter, firstMessage: "修改后的医院开场。", alternateGreetings: ["修改后的车站开场。"] };
  const conversations = [0, 1].map(index => ({ ...conversation(`opening-snapshot-${index}`, cards.id),
    opening: captureDzmmConversationOpening(originalCharacter, index) }));
  const original = { ...savedState(), custom: [cards], conversations };
  const { state, warnings } = hydrateDzmmState(JSON.stringify(original));
  assert.deepEqual(state, original);
  assert.deepEqual(warnings, []);
  assert.notEqual(state.conversations[0].opening, conversations[0].opening);
  assert.notEqual(state.conversations[0].opening?.messages, conversations[0].opening.messages);
});

test("literal legacy opening opt-outs survive backup without expanding or modifying original messages", () => {
  const saved: DzmmSavedConversation = { ...conversation(), opening: { version: 1, kind: "opening", source: "history", messages: [] } };
  saved.messages[0].content = "旧书店里写着字面 {{user}}。";
  const original = { ...savedState(), conversations: [saved] };
  const restored = hydrateDzmmState(JSON.stringify(original));
  assert.deepEqual(restored.state, original);
  assert.deepEqual(restored.warnings, []);
});

test("damaged optional opening metadata isolates only the snapshot while preserving every raw conversation", () => {
  const good = captureDzmmConversationOpening(localCharacter());
  for (const opening of [null, [], { ...good, version: 2 }, { ...good, messages: [] },
    { ...good, source: "history" }, { ...good, messages: [{ role: "system", content: "spoof" }] },
    { ...good, messages: [{ role: "assistant", content: "bad\0text" }] },
    { ...good, messages: Array(8).fill({ role: "assistant", content: "中".repeat(12_000) }) },
  ]) {
    const restored = hydrateDzmmState(JSON.stringify({ ...savedState(), conversations: [{ ...conversation(), opening }, conversation("unrelated")] }));
    assert.deepEqual(restored.state.conversations, [conversation(), conversation("unrelated")]);
    assert.equal(restored.warnings.length, 1);
    assert.match(restored.warnings[0], /开场无效/);
  }
});

function rememberedConversation(): DzmmSavedConversation {
  const saved = conversation();
  saved.storyMemory = createDzmmStoryMemory({
    summary: "用户在雨天来到书店。", scene: "雨中的书店。", completed: ["店员已欢迎用户。"],
    pending: ["正在寻找旅行书。"], relationships: ["用户与店员初次见面。"], items: [],
  }, saved.messages.slice(0, 1));
  return saved;
}

test("optional story memory survives local JSON backup and rehydration with original messages", () => {
  const original = { ...savedState(), conversations: [rememberedConversation()] };
  const restored = hydrateDzmmState(JSON.stringify(original));
  assert.deepEqual(restored, { state: original, warnings: [] });
  assert.notEqual(restored.state.conversations[0].storyMemory, original.conversations[0].storyMemory);
  assert.notEqual(restored.state.conversations[0].storyMemory?.state.items, original.conversations[0].storyMemory?.state.items);
  assert.deepEqual(hydrateDzmmState(JSON.stringify(restored.state)), restored);
});

test("old saved conversations hydrate unchanged without adding inferred memory", () => {
  const original = { ...savedState(), conversations: [conversation()] };
  const restored = hydrateDzmmState(JSON.stringify(original));
  assert.deepEqual(restored, { state: original, warnings: [] });
  assert.equal(Object.hasOwn(restored.state.conversations[0], "storyMemory"), false);
  assert.equal(Object.hasOwn(restored.state.conversations[0], "worldState"), false);
  assert.equal(Object.hasOwn(restored.state.conversations[0], "worldClockMode"), false);
});

function worldConversation(): DzmmSavedConversation {
  const saved = conversation();
  saved.worldClockMode = "story";
  saved.worldState = { version: 1, snapshots: [1, 2].map(sourceCount => ({
    sourceCount, sourceFingerprint: fingerprintDzmmStoryMessages(saved.messages.slice(0, sourceCount)),
    recordedAt: sourceCount * 1_000, clockMode: "story" as const,
    state: { ...createDzmmWorldState(), location: sourceCount === 1 ? "书店门口" : "旅行书架前" },
  })) };
  return saved;
}

test("world checkpoints and both clock modes round-trip without changing original content", () => {
  for (const worldClockMode of ["story", "realtime"] as const) {
    const saved = { ...worldConversation(), worldClockMode };
    const original = { ...savedState(), conversations: [saved], preferences: { ...savedState().preferences, worldClockMode } };
    const restored = hydrateDzmmState(JSON.stringify(original));
    assert.deepEqual(restored, { state: original, warnings: [] });
    assert.notEqual(restored.state.conversations[0].worldState, saved.worldState);
    assert.notEqual(restored.state.conversations[0].worldState?.snapshots[0].state, saved.worldState?.snapshots[0].state);
  }
});

test("world checkpoints recover a matching earlier prefix after edits, rewinds, or regenerated messages", () => {
  const saved = worldConversation();
  for (const messages of [
    saved.messages.slice(0, 1),
    saved.messages.map((message, index) => index === 1 ? { ...message, content: "改找一本历史书。" } : message),
    saved.messages.map((message, index) => index === 1 ? { ...message, id: "replacement-turn" } : message),
  ]) {
    const restored = hydrateDzmmState(JSON.stringify({ ...savedState(), conversations: [{ ...saved, messages }] }));
    assert.deepEqual(restored.state.conversations[0].messages, messages);
    assert.deepEqual(restored.state.conversations[0].worldState, { version: 1, snapshots: saved.worldState!.snapshots.slice(0, 1) });
    assert.deepEqual(restored.warnings, []);
  }
  const messages = saved.messages.map(message => ({ ...message, id: `branch-${message.id}` }));
  const restored = hydrateDzmmState(JSON.stringify({ ...savedState(), conversations: [{ ...saved, messages }] }));
  assert.deepEqual(restored.state.conversations[0].messages, messages);
  assert.equal(Object.hasOwn(restored.state.conversations[0], "worldState"), false);
});

test("malformed, oversized, and invalid-date world journals are isolated from original messages", () => {
  const saved = worldConversation();
  const journal = saved.worldState!;
  for (const worldState of [
    null, {}, { ...journal, version: 2 }, { ...journal, unknown: true },
    { ...journal, snapshots: Array.from({ length: 9 }, (_, index) => ({ ...journal.snapshots[0], sourceCount: index + 1 })) },
    { ...journal, snapshots: [{ ...journal.snapshots[0], recordedAt: -1 }] },
    { ...journal, snapshots: [{ ...journal.snapshots[0], recordedAt: 8_640_000_000_000_001 }] },
    { ...journal, snapshots: [{ ...journal.snapshots[0], state: { ...journal.snapshots[0].state, location: "长".repeat(40_001) } }] },
  ]) {
    const restored = hydrateDzmmState(JSON.stringify({ ...savedState(), conversations: [{ ...saved, worldState }, conversation("untouched")] }));
    assert.deepEqual(restored.state.conversations, [{ ...conversation(), worldClockMode: "story" }, conversation("untouched")]);
    assert.equal(restored.warnings.length, 1);
    assert.match(restored.warnings[0], /世界状态.*保留原始消息/);
  }
});

test("unsupported world clock modes are ignored independently during local hydration", () => {
  const original = savedState();
  for (const invalid of ["hybrid", "automatic", null, 123]) {
    const restored = hydrateDzmmState(JSON.stringify({ ...original,
      preferences: { ...original.preferences, worldClockMode: invalid },
      conversations: [{ ...conversation(), worldClockMode: invalid }],
    }));
    assert.deepEqual(restored.state.conversations, [conversation()]);
    assert.deepEqual(restored.state.preferences, original.preferences);
    assert.equal(restored.warnings.length, 2);
  }
});

test("bad optional memory is dropped independently while all raw conversations are retained", () => {
  const remembered = rememberedConversation();
  for (const storyMemory of [
    null, {}, { ...remembered.storyMemory, version: 2 },
    { ...remembered.storyMemory, sourceCount: 100 },
    { ...remembered.storyMemory, extra: "unsupported" },
    { ...remembered.storyMemory, state: { ...remembered.storyMemory!.state, summary: "坏\0摘要" } },
  ]) {
    const restored = hydrateDzmmState(JSON.stringify({
      ...savedState(), conversations: [{ ...conversation(), storyMemory }, conversation("unrelated")],
    }));
    assert.deepEqual(restored.state.conversations, [conversation(), conversation("unrelated")]);
    assert.equal(restored.warnings.length, 1);
    assert.match(restored.warnings[0], /剧情记忆.*保留原始消息/);
  }
});

test("edited, deleted, regenerated and branched memory sources are dropped without losing history", () => {
  const saved = rememberedConversation();
  for (const messages of [
    saved.messages.map((message, index) => index === 0 ? { ...message, content: "编辑后的开场。" } : message),
    saved.messages.slice(1),
    saved.messages.map((message, index) => index === 0 ? { ...message, id: "regenerated-opening" } : message),
    saved.messages.map(message => ({ ...message, id: `new-branch-${message.id}` })),
  ]) {
    const restored = hydrateDzmmState(JSON.stringify({ ...savedState(), conversations: [{ ...saved, messages }] }));
    assert.deepEqual(restored.state.conversations, [{ ...conversation(), messages }]);
    assert.equal(restored.warnings.length, 1);
  }
  const changedTail = { ...saved, messages: saved.messages.map((message, index) => index === 1
    ? { ...message, content: "只修改最近未摘要的消息。" } : message) };
  assert.deepEqual(hydrateDzmmState(JSON.stringify({ ...savedState(), conversations: [changedTail] })), {
    state: { ...savedState(), conversations: [changedTail] }, warnings: [],
  });
});

test("original all-ages catalog conversations and favorites survive hydration alongside existing account records", () => {
  const [originalSample, ...importedCards] = DZMM_CHARACTERS;
  assert.ok(importedCards.length > 0);
  assert.deepEqual(
    new Set(DZMM_CHARACTERS.map((card) => card.id)),
    new Set(["qy-shiyu", "qy-shen", "qy-linchuan", "qy-xingcheng"]),
  );
  assert.ok(originalSample);
  const original = savedState();
  original.custom = [localCharacter()];
  original.favorites = [originalSample.id, original.custom[0].id, ...importedCards.map((card) => card.id)];
  original.conversations = [
    conversation("existing-public", originalSample.id),
    conversation("existing-private", original.custom[0].id),
    ...importedCards.flatMap((card) => [
      {
        ...conversation(`migrated-${card.id}`, card.id),
        title: card.name,
        // No original opening was captured; an empty new chat is valid.
        messages: [],
      },
      {
        ...conversation(`migrated-history-${card.id}`, card.id),
        title: card.name,
        // Synthetic account history must survive for every new catalog ID.
        messages: [
          { id: `question-${card.id}`, role: "user" as const, content: "我们从哪里开始这段故事？" },
          { id: `reply-${card.id}`, role: "assistant" as const, content: "先介绍你的角色与来意。" },
        ],
      },
    ]),
  ];

  const { state, warnings } = hydrateDzmmState(JSON.stringify(original));

  assert.deepEqual(warnings, []);
  assert.deepEqual(state, original);
  assert.deepEqual(state.custom, [localCharacter()]);
});

test("one broken custom card cannot discard valid cards, conversations, or favorites", () => {
  const good = localCharacter();
  const payload = {
    ...savedState(),
    custom: [{ id: "broken", name: 123 }, good],
    conversations: [
      conversation("good-local", good.id),
      conversation("orphaned", "broken"),
    ],
    favorites: [good.id, publicId, "broken", null, good.id],
  };

  const { state, warnings } = hydrateDzmmState(JSON.stringify(payload));

  assert.deepEqual(state.custom, [good]);
  assert.deepEqual(state.conversations, [payload.conversations[0]]);
  assert.deepEqual(state.favorites, [good.id, publicId]);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((warning) => warning.includes("角色")));
  assert.ok(warnings.some((warning) => warning.includes("对话")));
});

test("malformed messages and unknown characters isolate only their own conversation", () => {
  const valid = conversation();
  const invalidConversations = [
    null,
    { ...conversation("unknown"), characterId: "missing-character" },
    { ...conversation("wrong-messages"), messages: {} },
    {
      ...conversation("wrong-role"),
      messages: [{ id: "bad", role: "system", content: "你好" }],
    },
    {
      ...conversation("wrong-content"),
      messages: [{ id: "bad", role: "user", content: {} }],
    },
    {
      ...conversation("empty-content"),
      messages: [{ id: "bad", role: "user", content: "  " }],
    },
    {
      ...conversation("long-content"),
      messages: [{ id: "bad", role: "user", content: "字".repeat(12_001) }],
    },
    {
      ...conversation("wrong-id"),
      messages: [{ id: 123, role: "user", content: "你好" }],
    },
  ];

  const { state, warnings } = hydrateDzmmState(
    JSON.stringify({
      ...savedState(),
      conversations: [...invalidConversations, valid],
    }),
  );

  assert.deepEqual(state.conversations, [valid]);
  assert.equal(warnings.length, invalidConversations.length);
});

test("long saved history and empty conversations are retained; only request preparation trims history", () => {
  const long = conversation("long-history");
  long.messages = Array.from({ length: 250 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? "user" : "assistant",
    content: `消息 ${index}：${"中".repeat(1_000)}`,
  }));
  const empty = { ...conversation("empty-history"), messages: [] };

  const { state, warnings } = hydrateDzmmState(
    JSON.stringify({
      ...savedState(),
      conversations: [long, empty],
    }),
  );

  assert.deepEqual(state.conversations, [long, empty]);
  assert.deepEqual(warnings, []);
});

test("preferences validate fields independently and accept the supported length boundaries", () => {
  const preferences = {
    nickname: "名".repeat(30),
    persona: "我".repeat(4_000),
    preset: "预".repeat(8_000),
    model: "fast",
    dark: true,
  };
  const accepted = hydrateDzmmState(
    JSON.stringify({ ...savedState(), preferences }),
  );
  assert.deepEqual(accepted.state.preferences, preferences);
  assert.deepEqual(accepted.warnings, []);

  for (const [field, value] of [
    ["nickname", "名".repeat(31)],
    ["nickname", " "],
    ["nickname", false],
    ["persona", "我".repeat(4_001)],
    ["persona", {}],
    ["preset", "预".repeat(8_001)],
    ["preset", []],
    ["model", "unknown-model"],
    ["dark", "false"],
  ] as const) {
    const { state, warnings } = hydrateDzmmState(
      JSON.stringify({
        ...savedState(),
        preferences: { ...preferences, [field]: value },
      }),
    );
    assert.equal(
      state.preferences[field],
      DZMM_INITIAL_STATE.preferences[field],
    );
    for (const otherField of Object.keys(
      preferences,
    ) as (keyof typeof preferences)[]) {
      if (otherField !== field)
        assert.equal(state.preferences[otherField], preferences[otherField]);
    }
    assert.equal(warnings.length, 1);
  }
});

test("missing optional collections and preferences use fresh defaults", () => {
  const first = hydrateDzmmState('{"version":1}');
  const second = hydrateDzmmState('{"version":1}');
  assert.deepEqual(first.state, DZMM_INITIAL_STATE);
  assert.deepEqual(first.warnings, []);
  first.state.favorites.push(publicId);
  first.state.preferences.nickname = "修改后的昵称";
  assert.deepEqual(second.state, DZMM_INITIAL_STATE);

  const malformed = hydrateDzmmState(
    JSON.stringify({
      version: 1,
      custom: null,
      conversations: 5,
      favorites: {},
      preferences: [],
    }),
  );
  assert.deepEqual(malformed.state, DZMM_INITIAL_STATE);
  assert.equal(malformed.warnings.length, 4);
});

test("optional appearance, author, and preset preferences roundtrip at their supported boundaries", () => {
  const preferences: DzmmPreferences = {
    ...DZMM_INITIAL_STATE.preferences,
    bio: "介".repeat(500), gender: "other", theme: "system", homeLayout: "single",
    showFloatingChat: false, floatingSize: "large", floatingOpacity: 20.5, maxTokens: 4096,
    blockedTags: Array.from({ length: 50 }, (_, index) => `${index}`.padEnd(40, "签")),
    followedAuthors: Array.from({ length: 200 }, (_, index) => `${index}`.padEnd(120, "作")),
    presets: Array.from({ length: 30 }, (_, index) => ({
      id: `${index}`.padEnd(120, "i"), name: "名".repeat(80), content: "预".repeat(8_000),
    })),
  };
  const original = { ...savedState(), preferences };
  const accepted = hydrateDzmmState(JSON.stringify(original));
  assert.deepEqual(accepted.state, original);
  assert.deepEqual(accepted.warnings, []);
  assert.notEqual(accepted.state.preferences.presets, preferences.presets);
  assert.notEqual(accepted.state.preferences.presets?.[0], preferences.presets?.[0]);
  assert.deepEqual(hydrateDzmmState(JSON.stringify(savedState())).state.preferences, DZMM_INITIAL_STATE.preferences,
    "Old records must not acquire optional defaults.");

  for (const floatingOpacity of [20, 100]) {
    const result = hydrateDzmmState(JSON.stringify({ ...original, preferences: { ...preferences, floatingOpacity, maxTokens: 128 } }));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.state.preferences.floatingOpacity, floatingOpacity);
    assert.equal(result.state.preferences.maxTokens, 128);
  }
});

test("invalid optional scalar preferences are omitted without changing valid old fields", () => {
  const core = { ...DZMM_INITIAL_STATE.preferences, nickname: "已有昵称", dark: true };
  const cases: [string, unknown][] = [
    ["bio", "介".repeat(501)], ["bio", "坏\0介绍"], ["bio", {}],
    ["gender", "unknown"], ["theme", "blue"], ["homeLayout", "triple"],
    ["showFloatingChat", "true"], ["floatingSize", "huge"],
    ["floatingOpacity", 19.99], ["floatingOpacity", 100.01], ["floatingOpacity", "50"], ["floatingOpacity", null],
    ["maxTokens", 127], ["maxTokens", 4097], ["maxTokens", 2048.5], ["maxTokens", "2048"],
  ];
  for (const [field, value] of cases) {
    const result = hydrateDzmmState(JSON.stringify({ ...savedState(), preferences: { ...core, [field]: value } }));
    assert.deepEqual(result.state.preferences, core, `${field} must not affect valid preferences.`);
    assert.equal(result.warnings.length, 1);
  }
});

test("invalid or duplicate preference collection entries preserve valid entries and unrelated settings", () => {
  const core = { ...DZMM_INITIAL_STATE.preferences, bio: "已有介绍", theme: "light" as const };
  const result = hydrateDzmmState(JSON.stringify({
    ...savedState(), preferences: {
      ...core,
      blockedTags: ["剧情", "剧情", " ", "坏\0标签", "标".repeat(41), 1, "奇幻"],
      followedAuthors: ["作者甲", "作者甲", " ", "坏\0作者", "作".repeat(121), null, "作者乙"],
      presets: [
        { id: "first", name: "原预设", content: "保留首条内容\n与换行。" },
        { id: "first", name: "重复 ID", content: "不能替换首条。" },
        { id: " ", name: "无效 ID", content: "" },
        { id: "坏\0ID", name: "无效 ID", content: "" },
        { id: "long-name", name: "名".repeat(81), content: "" },
        { id: "long-content", name: "长正文", content: "预".repeat(8_001) },
        { id: "nul-content", name: "无效正文", content: "坏\0正文" },
        { id: "empty-name", name: " ", content: "" },
        null,
        { id: "second", name: "空预设", content: "" },
      ],
    },
  }));
  assert.deepEqual(result.state.preferences, {
    ...core, blockedTags: ["剧情", "奇幻"], followedAuthors: ["作者甲", "作者乙"],
    presets: [
      { id: "first", name: "原预设", content: "保留首条内容\n与换行。" },
      { id: "second", name: "空预设", content: "" },
    ],
  });
  assert.equal(result.warnings.length, 18);

  for (const [field, value] of [
    ["blockedTags", Array.from({ length: 51 }, (_, i) => `标签 ${i}`)],
    ["followedAuthors", Array.from({ length: 201 }, (_, i) => `作者 ${i}`)],
    ["presets", Array.from({ length: 31 }, (_, i) => ({ id: `preset-${i}`, name: "预设", content: "" }))],
    ["blockedTags", {}], ["followedAuthors", false], ["presets", null],
  ] as const) {
    const rejected = hydrateDzmmState(JSON.stringify({ ...savedState(), preferences: { ...core, [field]: value } }));
    assert.deepEqual(rejected.state.preferences, core);
    assert.equal(rejected.warnings.length, 1);
  }
});

test("NUL characters cannot enter custom cards, messages, IDs, or preferences", () => {
  const good = localCharacter("good");
  const { state, warnings } = hydrateDzmmState(
    JSON.stringify({
      ...savedState(),
      custom: [
        good,
        { ...localCharacter("bad-name"), name: "坏\0名字" },
        { ...localCharacter("bad-tags"), tags: ["都市\0"] },
        { ...localCharacter("bad-cover"), cover: "/bad\0.webp" },
        { ...localCharacter("bad-id"), id: "bad\0id" },
      ],
      conversations: [
        conversation(),
        {
          ...conversation("bad-content"),
          messages: [{ id: "message", role: "user", content: "坏\0消息" }],
        },
        { ...conversation("bad-conversation-id"), id: "conversation\0id" },
      ],
      preferences: {
        nickname: "坏\0名",
        persona: "坏\0身份",
        preset: "坏\0预设",
      },
    }),
  );

  assert.deepEqual(state.custom, [good]);
  assert.deepEqual(state.conversations, [conversation()]);
  assert.deepEqual(state.preferences, DZMM_INITIAL_STATE.preferences);
  assert.equal(warnings.length, 9);
  assert.ok(!JSON.stringify(state).includes("\\u0000"));
});

test("saved custom cards cannot impersonate public source metadata", () => {
  const original = localCharacter();
  const { state } = hydrateDzmmState(
    JSON.stringify({
      ...savedState(),
      custom: [
        {
          ...original,
          sourceKind: "public-summary",
          promptOrigin: "extracted",
          sourceUrl: "https://www.dzmm.ai/character/123",
          heat: "999万",
          likes: "9999",
        },
      ],
    }),
  );

  assert.deepEqual(state.custom, [original]);
});

test("missing IDs have deterministic collision-free fallbacks and invalid metadata has safe defaults", () => {
  const raw = JSON.stringify({
    version: 1,
    custom: [
      { name: "无 ID 的角色" },
      { name: "已有 ID 的角色", id: "saved-character-0" },
    ],
    conversations: [
      { characterId: publicId, messages: [{ role: "user", content: "你好" }] },
      {
        ...conversation("saved-conversation-0"),
        title: "坏\0标题",
        updatedAt: -1,
      },
    ],
  });

  const { state, warnings } = hydrateDzmmState(raw);
  assert.deepEqual(hydrateDzmmState(raw), hydrateDzmmState(raw));
  assert.equal(state.custom[0].id, "saved-character-0-1");
  assert.equal(state.custom[0].createdAt, "1970-01-01T00:00:00.000Z");
  assert.equal(state.conversations[0].id, "saved-conversation-0-1");
  assert.equal(state.conversations[0].messages[0].id, "saved-message-0-0");
  assert.equal(state.conversations[0].title, DZMM_CHARACTERS[0].name);
  assert.equal(state.conversations[0].updatedAt, 0);
  assert.equal(state.conversations[1].title, DZMM_CHARACTERS[0].name);
  assert.equal(state.conversations[1].updatedAt, 0);
  assert.equal(warnings.length, 2);
});

test("a broken duplicate does not hide a valid custom card, and duplicate conversation IDs are isolated", () => {
  const good = localCharacter();
  const validConversation = conversation();
  const { state, warnings } = hydrateDzmmState(
    JSON.stringify({
      ...savedState(),
      custom: [
        { id: good.id, name: null },
        good,
        good,
        localCharacter(publicId),
      ],
      conversations: [validConversation, validConversation],
    }),
  );

  assert.deepEqual(state.custom, [good]);
  assert.deepEqual(state.conversations, [validConversation]);
  assert.equal(warnings.length, 4);
});

test("unreadable JSON and unsupported root versions throw so the caller can preserve the raw backup", () => {
  for (const raw of [
    "{broken",
    "null",
    "[]",
    '{"version":2}',
    '{"version":"1"}',
  ]) {
    assert.throws(() => hydrateDzmmState(raw));
  }
});

test("author context roundtrips privately while malformed context isolates its card", () => {
  const rich = parseCharacterImport({ name: "原创档案员", introduction: "公开简介", systemPrompt: "保持角色", postHistoryInstructions: "结尾留出选择",
    messageExamples: "角色：欢迎", alternateGreetings: ["另一场景"], openingMessages: [{ role: "assistant", content: "你好" }],
    gallery: ["/local/photo.webp"], suggestedReplies: ["找地图"], characterBook: { entries: [{ keys: [], constant: true, content: "虚构海港" }] },
  }, "rich");
  rich.createdAt = createdAt;
  const original = { ...savedState(), custom: [rich], favorites: [rich.id], conversations: [conversation("rich-chat", rich.id)] };
  assert.deepEqual(hydrateDzmmState(JSON.stringify(original)), { state: original, warnings: [] });
  const bad = { ...rich, id: "broken-context", characterBook: { entries: [{ keys: ["bad\0key"], content: "bad" }] } };
  const isolated = hydrateDzmmState(JSON.stringify({ ...original, custom: [bad, rich] }));
  assert.deepEqual(isolated.state, original);
  assert.equal(isolated.warnings.length, 1);
});

test("an untouched neutral writing preset upgrades to the all-ages default while a custom preset stays", () => {
  const legacy = "保持角色性格。用动作、环境和自然对话推进故事，不替用户决定行动。";
  const upgraded = hydrateDzmmState(JSON.stringify({ ...savedState(), preferences: { ...savedState().preferences, preset: legacy } }));
  assert.equal(upgraded.state.preferences.preset, DZMM_INITIAL_STATE.preferences.preset);
  assert.match(upgraded.state.preferences.preset, /全年龄/);
  const custom = hydrateDzmmState(JSON.stringify({ ...savedState(), preferences: { ...savedState().preferences, preset: "只写日常，不写亲密。" } }));
  assert.equal(custom.state.preferences.preset, "只写日常，不写亲密。");
});

test("separately loaded approved public IDs retain favorites and conversations without accepting private shadows", () => {
  const id = "published-12345678-1234-1234-1234-123456789abc";
  const original = { ...savedState(), favorites: [id], conversations: [conversation("published-chat", id)] };
  assert.deepEqual(hydrateDzmmState(JSON.stringify(original)), { state: original, warnings: [] });
  const invalid = hydrateDzmmState(JSON.stringify({ ...original, custom: [localCharacter(id)], favorites: [id, "published-forged"],
    conversations: [...original.conversations, conversation("forged", "published-forged")],
  }));
  assert.deepEqual(invalid.state, original);
  assert.equal(invalid.warnings.length, 3);
});
