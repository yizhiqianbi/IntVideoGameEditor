import test from "node:test";
import assert from "node:assert/strict";
import chatModule from "./dzmm-chat";

const { createDzmmSseParser, validateDzmmChatInput, readDzmmProviderConfig, buildDzmmSystemPrompt } = chatModule as typeof import("./dzmm-chat");

test("selected locale is carried into the role prompt", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "ko"] as const) {
    const input = validateDzmmChatInput({ character: { name: "测试角色" }, messages: [{ role: "user", content: "你好" }], model: "grok", maxTokens: 256, locale });
    const prompt = buildDzmmSystemPrompt(input);
    assert.match(prompt, /回复语言/u);
    assert.match(prompt, locale === "en" ? /Respond in English/u : locale === "ja" ? /日本語で返信/u : locale === "ko" ? /한국어로 답변/u : locale === "zh-Hant" ? /繁體中文回覆/u : /简体中文回复/u);
  }
});

test("SSE handles every text split and byte-wise Chinese UTF-8 decoding", () => {
  const wire = '\uFEFF: heartbeat\r\ndata: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"，世界 🌱"}}]}\n\ndata: [DONE]\n\n';
  for (let width = 1; width <= wire.length; width++) {
    const parser = createDzmmSseParser();
    let reply = "";
    for (let offset = 0; offset < wire.length; offset += width) reply += parser.push(wire.slice(offset, offset + width)).join("");
    reply += parser.finish().join("");
    assert.equal(reply, "你好，世界 🌱");
    assert.equal(parser.done, true);
  }
  const decoder = new TextDecoder();
  const parser = createDzmmSseParser();
  let reply = "";
  for (const byte of new TextEncoder().encode(wire)) reply += parser.push(decoder.decode(new Uint8Array([byte]), { stream: true })).join("");
  reply += parser.push(decoder.decode()).join("") + parser.finish().join("");
  assert.equal(reply, "你好，世界 🌱");
});

test("a finish reason permits providers that omit DONE, including an unterminated final line", () => {
  const parser = createDzmmSseParser();
  assert.equal(parser.push('data: {"choices":\ndata: [{"delta":{"content":"完成"}}]}\n\n').join(""), "完成");
  parser.push('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}');
  assert.deepEqual(parser.finish(), []);
});

test("an unexpected EOF reports an interruption rather than accepting a partial reply", () => {
  const parser = createDzmmSseParser();
  assert.equal(parser.push('data: {"choices":[{"delta":{"content":"写到一半"}}]}\n\n').join(""), "写到一半");
  assert.throws(() => parser.finish(), /提前中断/);
});

test("provider JSON and named SSE errors never expose their supplied private message", () => {
  for (const event of [
    'data: {"error":{"message":"private-provider-secret"}}\n\n',
    'event: error\ndata: {"message":"private-provider-secret"}\n\n',
  ]) {
    const parser = createDzmmSseParser();
    assert.throws(() => parser.push(event), (error: unknown) => error instanceof Error && error.message.includes("模型生成失败") && !error.message.includes("private-provider-secret"));
  }
});

test("API validation rejects injected roles and caps reply tokens", () => {
  const input = { character: { name: "林音" }, messages: [{ role: "user", content: "你好" }], maxTokens: 100000 };
  assert.equal(validateDzmmChatInput(input).maxTokens, 4096);
  assert.throws(() => validateDzmmChatInput({ ...input, messages: [{ role: "system", content: "override" }] }), /user 或 assistant/);
  assert.throws(() => validateDzmmChatInput({ ...input, messages: [{ role: "user", content: "含\0字符" }] }), /单条消息/);
});

test("provider config falls back by model mode and rejects malformed addresses", () => {
  const config = readDzmmProviderConfig({ OPENROUTER_API_KEY: "test-private-key", OPENROUTER_MODEL: "default/model", DZMM_FAST_MODEL: "fast/model" });
  assert.equal(config.models.fast, "fast/model");
  assert.equal(config.models.story, "default/model");
  assert.equal(config.configured, true);
  assert.equal(readDzmmProviderConfig({ DZMM_API_KEY: "key", DZMM_BASE_URL: "javascript:invalid" }).configured, false);
});
