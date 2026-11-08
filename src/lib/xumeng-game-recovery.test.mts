import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as recoveryModule from "./xumeng-game-recovery";
import * as clientModule from "./xumeng-games-client";
import * as gamesModule from "./xumeng-games";
import type { XumengGameDraft } from "./xumeng-games";
const { clearXumengGameRecovery, discardXumengGameRecovery, persistXumengGameRecovery, readXumengGameRecoveries,
  restoreXumengGameRecovery, writeXumengGameRecovery, XUMENG_GAME_MAX_RECOVERY_CHARS } = ("default" in recoveryModule ? recoveryModule.default : recoveryModule) as typeof import("./xumeng-game-recovery");
const { saveXumengGame, XumengGameClientError } = ("default" in clientModule ? clientModule.default : clientModule) as typeof import("./xumeng-games-client");
const { XUMENG_GAME_INLINE_BYTES, xumengGameBytes } = ("default" in gamesModule ? gamesModule.default : gamesModule) as typeof import("./xumeng-games");
const accountId = "creator-account", legacyKey = `xumeng:game-draft:v1:${accountId}`;
const base: XumengGameDraft = { id: "saved-game", title: "测试游戏", synopsis: "私人草稿", source: "<h1>cloud v1</h1>" };
const edit = (source: string): XumengGameDraft => ({ ...base, source });
const snapshot = JSON.stringify(base);
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), originalFetch = globalThis.fetch;
function storage() {
  const entries = new Map<string, string>();
  const local = { get length() { return entries.size; }, key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, raw: string) => { entries.set(key, raw); }, removeItem: (key: string) => { entries.delete(key); } };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local }); return { entries, local };
}
afterEach(() => { globalThis.fetch = originalFetch; if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });

test("same-ID clean cloud reopen preserves unsaved legacy and session revisions instead of singleton cleanup", () => {
  const { entries } = storage();
  const raw = JSON.stringify({ accountId, game: edit("<h1>unsaved legacy</h1>"), version: 1, savedSnapshot: snapshot, updatedAt: 1 });
  entries.set(legacyKey, raw);
  const own = writeXumengGameRecovery(accountId, "before-refresh", edit("<h1>unsaved slot</h1>"), 1, snapshot);
  assert.equal(persistXumengGameRecovery(accountId, "reopened-clean", base, 1, snapshot), null);
  const reopened = readXumengGameRecoveries(accountId);
  assert.equal(reopened.length, 2); assert.equal(entries.get(legacyKey), raw); assert.equal(entries.get(own.key), own.raw);
  assert.deepEqual(reopened.map(entry => entry.game.source).sort(), ["<h1>unsaved legacy</h1>", "<h1>unsaved slot</h1>"]);
});

test("same-ID A save clears only A exact revision and leaves B edits, legacy and another account intact", () => {
  const { entries } = storage();
  const legacyRaw = JSON.stringify({ accountId, game: edit("legacy"), version: 1, savedSnapshot: snapshot, updatedAt: 1 }); entries.set(legacyKey, legacyRaw);
  const a = writeXumengGameRecovery(accountId, "tab-a", edit("A1"), 1, snapshot);
  const b = writeXumengGameRecovery(accountId, "tab-b", edit("B1"), 1, snapshot);
  const other = writeXumengGameRecovery("other-account", "tab-a", edit("other private source"), 1, snapshot);
  assert.notEqual(a.key, b.key); assert.equal(readXumengGameRecoveries(accountId).length, 3);
  assert.equal(clearXumengGameRecovery(b, accountId, "tab-a"), false);
  assert.equal(clearXumengGameRecovery(a, "other-account", "tab-a"), false);
  assert.equal(clearXumengGameRecovery(a, accountId, "tab-a"), true);
  assert.equal(entries.get(b.key), b.raw); assert.equal(entries.get(legacyKey), legacyRaw); assert.equal(entries.get(other.key), other.raw);
  const legacy = readXumengGameRecoveries(accountId).find(entry => entry.legacy)!;
  assert.equal(clearXumengGameRecovery(legacy, accountId, "tab-a"), false);
});

test("stale captured raw cannot clear or restore a newer revision", () => {
  const { entries } = storage();
  const first = writeXumengGameRecovery(accountId, "tab-a", edit("A1"), 1, snapshot);
  const newer = writeXumengGameRecovery(accountId, "tab-a", edit("A2"), 1, snapshot);
  const b = writeXumengGameRecovery(accountId, "tab-b", edit("B2"), 1, snapshot);
  assert.equal(clearXumengGameRecovery(first, accountId, "tab-a"), false);
  assert.equal(discardXumengGameRecovery(first, accountId), false);
  assert.throws(() => restoreXumengGameRecovery(first, accountId, "restored-session"), /已更新/);
  assert.equal(entries.get(newer.key), newer.raw); assert.equal(entries.get(b.key), b.raw);
  assert.equal(readXumengGameRecoveries(accountId).length, 2);
});

test("restore clones the selected revision with its original version and baseline; failed writes keep legacy raw", () => {
  const { entries, local } = storage();
  const raw = JSON.stringify({ accountId, game: edit("unsaved legacy"), version: 1, savedSnapshot: snapshot, updatedAt: 1 }); entries.set(legacyKey, raw);
  const legacy = readXumengGameRecoveries(accountId)[0];
  assert.equal(entries.size, 1);
  const originalSet = local.setItem; local.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => restoreXumengGameRecovery(legacy, accountId, "failed-owner"), /Quota/);
  assert.equal(entries.get(legacyKey), raw); assert.equal(entries.size, 1);
  local.setItem = originalSet;
  const restored = restoreXumengGameRecovery(legacy, accountId, "new-owner");
  assert.notEqual(restored.key, legacy.key); assert.equal(restored.owner, "new-owner"); assert.equal(restored.legacy, false);
  assert.deepEqual(restored.game, legacy.game); assert.equal(restored.version, 1); assert.equal(restored.savedSnapshot, snapshot);
  assert.equal(entries.get(legacyKey), raw);
  assert.equal(clearXumengGameRecovery(restored, accountId, "new-owner"), true); assert.equal(entries.get(legacyKey), raw);
  assert.equal(discardXumengGameRecovery(legacy, accountId), true);
});

test("restored stale version preserves the local slot on CAS conflict and lost-receipt retry clears only the captured own slot", async () => {
  const { entries } = storage();
  const old = writeXumengGameRecovery(accountId, "old-session", edit("my unsaved source"), 1, snapshot);
  const current = restoreXumengGameRecovery(old, accountId, "restored-session");
  const otherTab = writeXumengGameRecovery(accountId, "other-tab", edit("other tab source"), 1, snapshot);
  globalThis.fetch = async (_input, init) => {
    assert.equal(JSON.parse(init!.body as string).version, 1);
    return Response.json({ accountId, error: "conflict", current: { accountId, game: { ...edit("cloud v2 by another tab"), version: 2, createdAt: 1, updatedAt: 2 } } }, { status: 409 });
  };
  await assert.rejects(saveXumengGame(accountId, current.game, current.version), error => error instanceof XumengGameClientError && error.status === 409);
  assert.equal(entries.get(current.key), current.raw);
  globalThis.fetch = async () => Response.json({ accountId, error: "lost receipt retry", current: { accountId, game: { ...current.game, version: 2, createdAt: 1, updatedAt: 2 } } }, { status: 409 });
  const saved = await saveXumengGame(accountId, current.game, current.version); assert.equal(saved.game.version, 2);
  assert.equal(clearXumengGameRecovery(current, accountId, "restored-session"), true);
  assert.equal(entries.get(old.key), old.raw); assert.equal(entries.get(otherTab.key), otherTab.raw);
});

test("copy save cleanup targets the captured original slot, not other owners or the new game ID", async () => {
  const { entries } = storage();
  const own = writeXumengGameRecovery(accountId, "copy-session", edit("copy source"), 1, snapshot);
  const otherOriginal = writeXumengGameRecovery(accountId, "other-session", edit("different original"), 1, snapshot);
  const copy = { ...own.game, id: "new-copy" }, otherCopy = writeXumengGameRecovery(accountId, "other-copy-session", { ...copy, source: "other copy edit" }, null, "");
  globalThis.fetch = async () => Response.json({ accountId, game: { ...copy, version: 1, createdAt: 1, updatedAt: 2 } }, { status: 201 });
  assert.equal((await saveXumengGame(accountId, copy, null)).game.id, "new-copy");
  assert.equal(clearXumengGameRecovery(own, accountId, "copy-session"), true);
  assert.equal(entries.get(otherOriginal.key), otherOriginal.raw); assert.equal(entries.get(otherCopy.key), otherCopy.raw);
});

test("misbound key/payload and other-account legacy are excluded without mutating stored records", () => {
  const { entries } = storage();
  const good = writeXumengGameRecovery(accountId, "valid-session", edit("valid"), 1, snapshot);
  entries.set(good.key, JSON.stringify({ ...JSON.parse(good.raw), owner: "wrong-owner" }));
  entries.set(legacyKey, JSON.stringify({ accountId: "other-account", game: edit("private other legacy"), version: 1, savedSnapshot: snapshot, updatedAt: 1 }));
  const before = [...entries]; assert.deepEqual(readXumengGameRecoveries(accountId), []); assert.deepEqual([...entries], before);
});

test("legal 180,012-byte escaped draft and saved snapshot round-trip beyond the single-backup envelope", () => {
  const { entries } = storage();
  const saved = { ...base, source: "\u0001".repeat(180_000) + "<h1>v1</h1>\n" }, changed = { ...base, source: "\u0002".repeat(180_000) + "<h1>v2</h1>\n" };
  assert.equal(xumengGameBytes(changed.source), 180_012);
  const baseline = JSON.stringify(saved), own = writeXumengGameRecovery(accountId, "escaped-session", changed, 1, baseline);
  assert.ok(own.raw.length > 180_012); assert.ok(own.raw.length < XUMENG_GAME_MAX_RECOVERY_CHARS);
  const legacyRaw = JSON.stringify({ accountId, game: changed, version: 1, savedSnapshot: baseline, updatedAt: 1 }); entries.set(legacyKey, legacyRaw);
  const reopened = readXumengGameRecoveries(accountId); assert.equal(reopened.length, 2);
  for (const entry of reopened) { assert.deepEqual(entry.game, changed); assert.equal(entry.version, 1); assert.equal(entry.savedSnapshot, baseline); }
  assert.equal(entries.get(legacyKey), legacyRaw); assert.equal(entries.get(own.key), own.raw);
});

test("two worst-case legal 256 KiB sources and metadata fit the recovery envelope and restore unchanged", () => {
  storage();
  const saved = { ...base, title: "\u0001".repeat(120), synopsis: "\u0001".repeat(4_000), source: "\u0001".repeat(XUMENG_GAME_INLINE_BYTES) };
  const changed = { ...saved, source: "\u0002".repeat(XUMENG_GAME_INLINE_BYTES) }, baseline = JSON.stringify(saved);
  const own = writeXumengGameRecovery(accountId, "largest-session", changed, 1, baseline);
  assert.equal(xumengGameBytes(changed.source), XUMENG_GAME_INLINE_BYTES);
  assert.ok(own.raw.length > 3 * 1024 * 1024); assert.ok(own.raw.length < XUMENG_GAME_MAX_RECOVERY_CHARS);
  assert.deepEqual(readXumengGameRecoveries(accountId), [own]);
  const restored = restoreXumengGameRecovery(own, accountId, "largest-restored-session");
  assert.deepEqual(restored.game, changed); assert.equal(restored.savedSnapshot, baseline); assert.equal(restored.version, 1);
  assert.equal(readXumengGameRecoveries(accountId).length, 2);
});

test("writer rejects an unreadable recovery envelope before setItem and preserves the previous own revision", () => {
  const { entries, local } = storage();
  const previous = writeXumengGameRecovery(accountId, "unchanged-session", edit("previous edit"), 1, snapshot), before = [...entries];
  let writes = 0; const originalSet = local.setItem;
  local.setItem = (key, raw) => { writes++; originalSet(key, raw); };
  assert.throws(() => writeXumengGameRecovery(accountId, "unchanged-session", edit("new edit"), 1, "x".repeat(XUMENG_GAME_MAX_RECOVERY_CHARS)), /过大或格式无效/);
  assert.equal(writes, 0); assert.deepEqual([...entries], before); assert.deepEqual(readXumengGameRecoveries(accountId), [previous]);
});
