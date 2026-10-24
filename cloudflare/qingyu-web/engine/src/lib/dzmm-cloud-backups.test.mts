import test from "node:test";
import assert from "node:assert/strict";
import * as module from "./dzmm-cloud-backups";
import * as characterModule from "./dzmm-characters";
import * as storageModule from "./dzmm-storage";
import * as contextModule from "./dzmm-conversation-context";
import * as memoryModule from "./dzmm-story-memory";
import * as worldModule from "./dzmm-world-state";

const { parseDzmmCloudBackup, readDzmmCloudRecoveries, writeDzmmCloudRecovery, clearOwnDzmmCloudRecovery,
  discardDzmmCloudRecovery, dzmmCloudBackupChoice, dzmmCloudRecoveryKey, dzmmCloudTabBackupKey,
  shouldRecoverDzmmCloudBackup, DZMM_CLOUD_RECOVERY_MAX_ENTRIES, DZMM_CLOUD_BACKUP_MAX_BYTES } = module as typeof import("./dzmm-cloud-backups");
const { parseCharacterImport } = characterModule as typeof import("./dzmm-characters");
const { DZMM_INITIAL_STATE } = storageModule as typeof import("./dzmm-storage");
const { captureDzmmConversationOpening } = contextModule as typeof import("./dzmm-conversation-context");
const { createDzmmStoryMemory } = memoryModule as typeof import("./dzmm-story-memory");
const { createDzmmWorldState, appendDzmmWorldSnapshot } = worldModule as typeof import("./dzmm-world-state");
type Backup = import("./dzmm-cloud-backups").DzmmCloudBackup;

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, failWrites: false,
    get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (this.failWrites) throw new DOMException("full", "QuotaExceededError"); values.set(key, value); },
    removeItem(key: string) { values.delete(key); }, clear() { values.clear(); } };
}
function backup(label: string, accountId = "account-one", version = 3): Backup {
  const card = parseCharacterImport({ name: "原创地图员", description: "检查河流和桥梁标记。", firstMessage: "地图已经展开。" }, "qa-map");
  const opening = captureDzmmConversationOpening(card);
  const messages = [{ id: "opening", role: "assistant" as const, content: "地图已经展开。" },
    { id: "user-shared", role: "user" as const, content: `  ${label}\n核对原文。  ` }];
  const world = createDzmmWorldState(); world.location = label; world.clock.elapsedMinutes = 12;
  return { accountId, version, updatedAt: 1234,
    state: { ...structuredClone(DZMM_INITIAL_STATE), custom: [card], conversations: [{ id: "same-conversation", characterId: card.id,
      title: card.name, messages, opening, updatedAt: 1200, worldClockMode: "story",
      storyMemory: createDzmmStoryMemory({ summary: label, scene: "河边", completed: [], pending: [], relationships: [], items: [] }, messages),
      worldState: appendDzmmWorldSnapshot(undefined, messages, world, 1200, "story") }] } };
}

test("independent writers preserve divergent same-conversation snapshots and exact continuity metadata", () => {
  const storage = memoryStorage(), a = backup("分支A"), b = backup("分支B");
  const ea = writeDzmmCloudRecovery(a, "writer-a", storage), eb = writeDzmmCloudRecovery(b, "writer-b", storage);
  assert.notEqual(ea.key, eb.key);
  assert.deepEqual(readDzmmCloudRecoveries(a.accountId, storage).map(entry => entry.state).sort((x,y) => JSON.stringify(x).localeCompare(JSON.stringify(y))),
    [a.state,b.state].sort((x,y) => JSON.stringify(x).localeCompare(JSON.stringify(y))));
  assert.deepEqual(parseDzmmCloudBackup(ea.raw, a.accountId), a);
  assert.deepEqual(dzmmCloudBackupChoice(ea), { key: ea.key, updatedAt: 1234, version: 3, messageCount: 2 });
});

test("fresh revision replaces only this writer's exact current revision, never foreign or archived writer", () => {
  const storage = memoryStorage(), a = writeDzmmCloudRecovery(backup("A"), "writer-a", storage);
  const b = writeDzmmCloudRecovery(backup("B"), "writer-b", storage);
  const newer = writeDzmmCloudRecovery(backup("A新编辑"), "writer-a", storage, a);
  assert.notEqual(newer.key, a.key); assert.equal(storage.getItem(a.key), null);
  assert.equal(storage.getItem(b.key), b.raw);
  const archived = writeDzmmCloudRecovery(backup("载入另一版本后的编辑"), "rotated-writer", storage);
  assert.equal(storage.getItem(newer.key), newer.raw);
  assert.equal(storage.getItem(archived.key), archived.raw);
});

test("acknowledgement clear requires exact owner and captured raw; stale ack does not clear a newer edit", () => {
  const storage = memoryStorage(), a = writeDzmmCloudRecovery(backup("A"), "writer-a", storage);
  const b = writeDzmmCloudRecovery(backup("B"), "writer-b", storage);
  assert.equal(clearOwnDzmmCloudRecovery(b, "writer-a", storage), false);
  storage.setItem(a.key, a.raw + " ");
  assert.equal(clearOwnDzmmCloudRecovery(a, "writer-a", storage), false);
  storage.setItem(a.key, a.raw);
  assert.equal(clearOwnDzmmCloudRecovery(a, "writer-a", storage), true);
  assert.equal(storage.getItem(b.key), b.raw);
});

test("legacy recovery is read-only compatible and embedded account/writer mismatches never enter the list", () => {
  const storage = memoryStorage(), original = backup("原始兼容备份");
  storage.setItem(dzmmCloudRecoveryKey(original.accountId), JSON.stringify(original));
  writeDzmmCloudRecovery(backup("其他账号", "account-two"), "other-writer", storage);
  const invalid = writeDzmmCloudRecovery(backup("匹配"), "writer-one", storage);
  storage.setItem(invalid.key, JSON.stringify({ ...JSON.parse(invalid.raw), accountId: "account-two" }));
  const entries = readDzmmCloudRecoveries(original.accountId, storage);
  assert.equal(entries.length, 1); assert.equal(entries[0].writerId, null); assert.deepEqual(entries[0].state, original.state);
  assert.equal(parseDzmmCloudBackup(JSON.stringify(original), "account-two"), null);
  assert.notEqual(dzmmCloudTabBackupKey(original.accountId), dzmmCloudTabBackupKey("account-two"));
});

test("malformed complete-state recovery is rejected instead of silently dropping a conversation", () => {
  const valid = backup("严格恢复"), raw = JSON.stringify(valid);
  const damaged = structuredClone(valid); damaged.state.conversations[0].messages[1].content = "  ";
  assert.equal(parseDzmmCloudBackup(JSON.stringify(damaged), valid.accountId), null);
  assert.equal(parseDzmmCloudBackup(JSON.stringify({ ...valid, version: Number.MAX_SAFE_INTEGER + 1 }), valid.accountId), null);
  assert.equal(parseDzmmCloudBackup(JSON.stringify({ ...valid, state: { version: 1 } }), valid.accountId), null);
  assert.equal(parseDzmmCloudBackup(raw + " ".repeat(DZMM_CLOUD_BACKUP_MAX_BYTES), valid.accountId), null);
  assert.deepEqual(parseDzmmCloudBackup(raw, valid.accountId), valid);
  const missingId = JSON.parse(raw); delete missingId.state.conversations[0].messages[0].id;
  assert.equal(parseDzmmCloudBackup(JSON.stringify(missingId), valid.accountId), null);
  const reordered = { ...valid, state: { preferences: valid.state.preferences, conversations: valid.state.conversations,
    custom: valid.state.custom, favorites: valid.state.favorites, version: valid.state.version } };
  const parsed = parseDzmmCloudBackup(JSON.stringify(reordered), valid.accountId)!;
  assert.deepEqual(parsed.state, valid.state);
  assert.equal(JSON.stringify(parsed.state), JSON.stringify(storageModule.hydrateDzmmState(JSON.stringify(valid.state)).state));
});

test("capacity retains every branch, permits exact-own replacement, and never evicts unrelated data", () => {
  const storage = memoryStorage(); storage.setItem("other-project:keep", "original");
  const entries = Array.from({ length: DZMM_CLOUD_RECOVERY_MAX_ENTRIES }, (_, i) => writeDzmmCloudRecovery(backup(`归档${i}`), `writer-${i}`, storage));
  const before = new Map(storage.values);
  assert.throws(() => writeDzmmCloudRecovery(backup("额外分支"), "overflow", storage), /容量已满/);
  assert.deepEqual(storage.values, before);
  const newest = writeDzmmCloudRecovery(backup("当前编辑仍可保存"), "writer-0", storage, entries[0]);
  assert.equal(readDzmmCloudRecoveries("account-one", storage).length, DZMM_CLOUD_RECOVERY_MAX_ENTRIES);
  assert.equal(storage.getItem(newest.key), newest.raw);
  assert.equal(storage.getItem("other-project:keep"), "original");
});

test("quota failure keeps the earlier current revision and foreign branches intact", () => {
  const storage = memoryStorage(), a = writeDzmmCloudRecovery(backup("A"), "writer-a", storage);
  const b = writeDzmmCloudRecovery(backup("B"), "writer-b", storage), before = new Map(storage.values);
  storage.failWrites = true;
  assert.throws(() => writeDzmmCloudRecovery(backup("A新编辑"), "writer-a", storage, a), /full/);
  assert.deepEqual(storage.values, before); assert.equal(storage.getItem(b.key), b.raw);
});

test("aggregate byte limit and UTF-8 entry limit fail without discarding any archived history", () => {
  const storage = memoryStorage(), large = backup("较长原创备份");
  large.state.conversations[0].messages.push(...Array.from({ length: 180 }, (_, index) => ({
    id: `long-${index}`, role: "user" as const, content: "a".repeat(10_000) })));
  for (let index = 0; index < 4; index++) writeDzmmCloudRecovery(large, `large-${index}`, storage);
  const before = new Map(storage.values);
  assert.throws(() => writeDzmmCloudRecovery(large, "over-bytes", storage), /容量已满/);
  assert.deepEqual(storage.values, before);
  const unicode = backup("UTF-8边界");
  unicode.state.conversations[0].messages.push(...Array.from({ length: 90 }, (_, index) => ({
    id: `unicode-${index}`, role: "user" as const, content: "字".repeat(10_000) })));
  const unicodeRaw = JSON.stringify(unicode);
  assert.ok(unicodeRaw.length < DZMM_CLOUD_BACKUP_MAX_BYTES);
  assert.equal(parseDzmmCloudBackup(unicodeRaw, unicode.accountId), null);
});

test("explicit selected discard respects captured raw and leaves other revisions and tab current cache untouched", () => {
  const storage = memoryStorage(), a = writeDzmmCloudRecovery(backup("A"), "writer-a", storage);
  const b = writeDzmmCloudRecovery(backup("B"), "writer-b", storage);
  const sessionKey = dzmmCloudTabBackupKey("account-one"); storage.setItem(sessionKey, JSON.stringify(backup("独立标签页")));
  storage.setItem(a.key, a.raw + " ");
  assert.equal(discardDzmmCloudRecovery(a, storage), false); assert.notEqual(storage.getItem(a.key), null);
  storage.setItem(a.key, a.raw);
  assert.equal(discardDzmmCloudRecovery(a, storage), true);
  assert.equal(storage.getItem(b.key), b.raw); assert.notEqual(storage.getItem(sessionKey), null);
});

test("clean stale tab cache yields to a newer cloud save; dirty and unmarked legacy branches remain protected", () => {
  const earlier = backup("先前已保存的内容", "account-one", 1), cloud = backup("另一页面的新内容", "account-one", 2);
  const clean = parseDzmmCloudBackup(JSON.stringify({ ...earlier, dirty: false }), earlier.accountId)!;
  const dirty = parseDzmmCloudBackup(JSON.stringify({ ...earlier, dirty: true }), earlier.accountId)!;
  const legacy = parseDzmmCloudBackup(JSON.stringify(earlier), earlier.accountId)!;
  assert.equal(shouldRecoverDzmmCloudBackup(clean, cloud.state), false);
  assert.equal(shouldRecoverDzmmCloudBackup(dirty, cloud.state), true);
  assert.equal(shouldRecoverDzmmCloudBackup(legacy, cloud.state), true);
  assert.equal(shouldRecoverDzmmCloudBackup(dirty, earlier.state), false);
  assert.equal(parseDzmmCloudBackup(JSON.stringify({ ...earlier, dirty: "false" }), earlier.accountId), null);
});
