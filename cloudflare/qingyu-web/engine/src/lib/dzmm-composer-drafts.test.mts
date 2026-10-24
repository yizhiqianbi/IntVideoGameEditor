import assert from "node:assert/strict";
import { test } from "node:test";
import module from "./dzmm-composer-drafts";
const { dzmmComposerStorageKey, readDzmmComposerDrafts, writeDzmmComposerDrafts, parseDzmmComposerDrafts } = module as typeof import("./dzmm-composer-drafts");
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test("literal new input and failed originals survive roundtrip without changing story data", () => {
  const store = storage(), drafts = { "original-a": { text: "  灯塔🌿\n\n未发送。  ", failed: ["失败原句\n", "  保留空白  "] }, "original-b": { text: "园丁的新芽", failed: [] } };
  writeDzmmComposerDrafts(store, "original-owner", drafts);
  assert.deepEqual(readDzmmComposerDrafts(store, "original-owner"), drafts);
  assert.deepEqual(readDzmmComposerDrafts(store, "other-owner"), {});
  assert.equal(store.values.size, 1);
});
test("cache ownership and malformed records are rejected as a whole without rewriting raw bytes", () => {
  const store = storage(), key = dzmmComposerStorageKey("owner");
  const raw = JSON.stringify({ version: 1, accountId: "other", drafts: { a: { text: "属于其他账号", failed: [] } } });
  store.setItem(key, raw);
  assert.throws(() => readDzmmComposerDrafts(store, "owner"));
  assert.equal(store.getItem(key), raw);
  for (const draft of [{ text: "正文", failed: [1] }, { text: "正文\0", failed: [] }, { text: "x".repeat(12_001), failed: [] }]) {
    assert.throws(() => parseDzmmComposerDrafts(JSON.stringify({ version: 1, accountId: "owner", drafts: { a: draft } }), "owner"));
  }
});
test("quota failure and oversized input leave previous cache intact instead of truncating", () => {
  const store = storage();writeDzmmComposerDrafts(store, "owner", { a: { text: "之前的安全稿", failed: [] } });
  const old = store.getItem(dzmmComposerStorageKey("owner"));
  const quota = { ...store, setItem() { throw new Error("quota"); } };
  assert.throws(() => writeDzmmComposerDrafts(quota, "owner", { a: { text: "当前未缓存稿", failed: [] } }));
  assert.equal(store.getItem(dzmmComposerStorageKey("owner")), old);
  assert.throws(() => writeDzmmComposerDrafts(store, "owner", { a: { text: "新句", failed: Array(1000).fill("字".repeat(12_000)) } }));
  assert.equal(store.getItem(dzmmComposerStorageKey("owner")), old);
});
test("acknowledged empty input clears only its own account cache; prototype keys remain ordinary IDs", () => {
  const store = storage();writeDzmmComposerDrafts(store, "other", { b: { text: "其他账户", failed: [] } });
  const drafts = parseDzmmComposerDrafts('{"version":1,"accountId":"owner","drafts":{"__proto__":{"text":"原创保留","failed":[]}}}', "owner");
  assert.equal(Object.hasOwn(drafts, "__proto__"), true);assert.equal(drafts.__proto__.text, "原创保留");
  writeDzmmComposerDrafts(store, "owner", drafts);writeDzmmComposerDrafts(store, "owner", { a: { text: "", failed: [] } });
  assert.equal(store.getItem(dzmmComposerStorageKey("owner")), null);assert.equal(readDzmmComposerDrafts(store, "other").b.text, "其他账户");
});

test("unacknowledged sends retain exact originals even when composer text is empty", () => {
  const store = storage(), draft = { a: { text: "", failed: [], pending: { requestId: "original-send", text: "  已发送未确认🌿\n\n原文。  " } } };
  writeDzmmComposerDrafts(store, "owner", draft);assert.deepEqual(readDzmmComposerDrafts(store, "owner"), draft);
  assert.throws(() => parseDzmmComposerDrafts(JSON.stringify({ version: 1, accountId: "owner", drafts: { a: { text: "", failed: [], pending: { requestId: "", text: "原句" } } } }), "owner"));
});
