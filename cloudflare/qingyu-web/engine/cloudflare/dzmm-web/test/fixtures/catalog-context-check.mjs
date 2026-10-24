/** Local React SSR and actual request-plan verification. No browser or provider calls. */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import * as react from "react";
import * as serverRender from "react-dom/server";

const vite = await createServer({ configFile: fileURLToPath(new URL("./catalog-context-vite.config.ts", import.meta.url)),
  server: { middlewareMode: true }, logLevel: "error" });
try {
  const load = name => vite.ssrLoadModule(fileURLToPath(new URL(`../../../../src/${name}`, import.meta.url)));
  const loaded = await Promise.allSettled([
    load("components/dzmm/character-detail.tsx"),
    load("lib/dzmm-characters.ts"), load("lib/dzmm-context.ts"), load("lib/dzmm-chat.ts"), load("lib/dzmm-conversation-context.ts"),
    load("lib/dzmm-character-presentation.ts"), load("lib/dzmm-catalog.ts"),
  ]);
  const failure = loaded.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  const [detailModule, chars, context, chat, opening, presentation, catalog] = loaded.map(result => result.value);
  const plain = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
  const noop = () => {};
  const render = character => serverRender.renderToStaticMarkup(react.createElement(detailModule.default, {
    character, favorites: false, related: [], onBack: noop, onStart: noop, onFavorite: noop, onExport: noop,
    onEdit: noop, onSelect: noop, onNotice: noop,
  }));
  const completed = chars.DZMM_LISTED_CHARACTERS.filter(card => card.catalogReadiness === "public-context");
  assert.equal(completed.length, 5);
  assert.equal(completed.filter(card => card.firstMessage).length, 4);
  const checks = completed.map(card => {
    const html = render(card), story = presentation.projectDzmmStoryCharacter(card);
    assert.ok(html.includes(plain(presentation.splitDzmmCharacterPresentation(card.description).body)), `${card.id} exact visible introduction`);
    if (card.firstMessage) assert.ok(html.includes(plain(presentation.splitDzmmCharacterPresentation(card.firstMessage).body)), `${card.id} exact visible opening`);
    assert.ok(html.includes("完整角色卡和世界书尚未补齐"));
    assert.doesNotMatch(html, /来自\s*dzmm|from\s+dzmm/i);
    const snapshot = opening.captureDzmmConversationOpening(card);
    const messages = [...snapshot.messages.map((message, index) => ({ ...message, id: `opening-${index}` })), { id: "user", role: "user", content: "我先观察周围。" }];
    const request = context.prepareDzmmRequest(opening.applyDzmmConversationOpening(card, { opening: snapshot, messages }), messages, undefined, undefined, "balanced");
    assert.equal(request.character.description, story.description);
    assert.deepEqual(request.character.openingMessages, snapshot.messages);
    const plan = chat.buildDzmmPromptPlan(chat.validateDzmmChatInput(request));
    assert.equal(plan.diagnostics.segments.filter(segment => segment.source === "opening").length, 1);
    return { id: card.id, detailIntroExact: true, detailOpeningExact: Boolean(card.firstMessage), requestDescriptionExact: true, singleOpening: true };
  });
  const missing = chars.DZMM_LISTED_CHARACTERS.find(card => card.catalogReadiness === "metadata-only");
  assert.ok(render(missing).includes("补充角色设定"));
  assert.ok(!render(missing).includes("开始对话"));
  assert.equal(catalog.getDzmmNewConversationBlockReason(missing), catalog.DZMM_CHARACTER_CONTEXT_MISSING);
  const imported = chars.parseCharacterImport({ name: "原创图书员", description: "三十岁的图书员负责地图档案。", firstMessage: "请先看看这份地图。" }, "local-catalog-check-original");
  assert.equal(catalog.getDzmmNewConversationBlockReason(imported), null);
  assert.ok(render(imported).includes("开始对话"));
  console.log(JSON.stringify({ status: "passed", publicDetails: checks, metadataEditAction: true, originalImportAllowed: true,
    networkCalls: 0, modelCalls: 0, note: "SSR/action labels and request logic verified; click routing still needs browser acceptance." }, null, 2));
} finally { await vite.close(); }
