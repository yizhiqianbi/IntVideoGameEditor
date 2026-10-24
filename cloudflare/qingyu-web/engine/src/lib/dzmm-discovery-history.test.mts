import assert from "node:assert/strict";
import test from "node:test";
import * as historyExports from "./dzmm-discovery-history.ts";
const history = (historyExports as typeof historyExports & { default?: typeof historyExports }).default ?? historyExports;
const accountId = "original-owner";
const filters = { sort: "new" as const, time: "month" as const, query: "  灯塔🌿  " };
const discovery = { version: 1 as const, accountId, route: "category/sfw", filters };

test("each classification history entry retains its own exact query, sorting and time", () => {
  const first = history.mergeDzmmDiscoveryHistory(null, discovery);
  const grid = history.mergeDzmmDiscoveryHistory(first, { ...discovery, route: "category", filters: { ...filters, query: "" } });
  const next = history.mergeDzmmDiscoveryHistory(grid, { ...discovery, route: "category/world", filters: { sort: "likes", time: "week", query: "地图" } });
  assert.deepEqual(history.readDzmmDiscoveryHistory(first, accountId, discovery.route), discovery);
  assert.deepEqual(history.readDzmmDiscoveryHistory(grid, accountId, "category")?.filters, { ...filters, query: "" });
  assert.deepEqual(history.readDzmmDiscoveryHistory(next, accountId, "category/world")?.filters, { sort: "likes", time: "week", query: "地图" });
  assert.equal(history.readDzmmDiscoveryHistory(next, accountId, discovery.route), null);
});

test("classification destinations require real slugs and bounded enum values", () => {
  assert.equal(history.DZMM_CATEGORY_QUERY_MAX_LENGTH, 1000);
  assert.deepEqual(history.dzmmDiscoveryRouteCategory("category"), { category: null });
  assert.deepEqual(history.dzmmDiscoveryRouteCategory("category/sfw"), { category: "sfw" });
  for (const route of ["characters", "category/", "category/unknown", "category/sfw/extra", "category/%73fw", "studio/new"])
    assert.equal(history.dzmmDiscoverySource(route, filters), null);
  for (const invalid of [{ ...filters, sort: "random" }, { ...filters, time: "year" }, { ...filters, sort: {} }, { ...filters, query: 1 }, { ...filters, query: "x".repeat(history.DZMM_CATEGORY_QUERY_MAX_LENGTH + 1) }, { ...filters, query: "正文\0" }])
    assert.equal(history.dzmmDiscoverySource(discovery.route, invalid), null);
  assert.equal(history.dzmmDiscoverySource(discovery.route, { ...filters, query: "x".repeat(history.DZMM_CATEGORY_QUERY_MAX_LENGTH) })?.filters.query.length, history.DZMM_CATEGORY_QUERY_MAX_LENGTH);
});

test("the accepted 121-character category query survives reload with its sorting and time", () => {
  const query = "北塔纸鹤查验20261013-" + "铃".repeat(106);
  assert.equal(query.length, 121);
  const item = { ...discovery, filters: { sort: "new" as const, time: "week" as const, query } };
  const before = structuredClone(item);
  const state = JSON.parse(JSON.stringify(history.mergeDzmmDiscoveryHistory({ host: "keep" }, item)));
  assert.deepEqual(history.readDzmmDiscoveryHistory(state, accountId, item.route), item);
  assert.equal(history.readDzmmDiscoveryHistory(state, "other-owner", item.route), null);
  assert.equal(history.readDzmmDiscoveryHistory(state, accountId, "category/world"), null);
  const origin = history.dzmmDiscoverySource(item.route, item.filters);
  assert.deepEqual(origin, { route: item.route, filters: item.filters });
  const detail = { version: 1 as const, accountId, route: "character/original-lighthouse", origin };
  const detailState = JSON.parse(JSON.stringify(history.mergeDzmmDiscoveryHistory(state, detail)));
  assert.deepEqual(history.readDzmmDiscoveryHistory(detailState, accountId, detail.route)?.origin, origin);
  assert.deepEqual(item, before);
});

test("detail source roundtrips after a document reload and binds to its exact character", () => {
  const origin = history.dzmmDiscoverySource(discovery.route, filters);
  const item = { version: 1, accountId, route: "character/original-lighthouse", origin };
  const state = JSON.parse(JSON.stringify(history.mergeDzmmDiscoveryHistory(null, item)));
  assert.deepEqual(history.readDzmmDiscoveryHistory(state, accountId, item.route)?.origin, origin);
  assert.equal(history.readDzmmDiscoveryHistory(state, accountId, "character/original-map"), null);
  assert.equal(history.readDzmmDiscoveryHistory(state, "other-owner", item.route), null);
  const related = history.mergeDzmmDiscoveryHistory(state, { ...item, route: "character/original-map" });
  assert.deepEqual(history.readDzmmDiscoveryHistory(related, accountId, "character/original-map")?.origin, origin);
  assert.equal(history.readDzmmDiscoveryHistory(related, accountId, item.route), null);
});

test("independent details carry no stale discovery origin and sources cannot be arbitrary routes", () => {
  const state = history.mergeDzmmDiscoveryHistory(null, { ...discovery, route: "character/original-lighthouse", filters: undefined, origin: { route: discovery.route, filters } });
  const direct = history.mergeDzmmDiscoveryHistory(state, { version: 1, accountId, route: "character/original-map" });
  assert.deepEqual(history.readDzmmDiscoveryHistory(direct, accountId, "character/original-map"), { version: 1, accountId, route: "character/original-map" });
  for (const route of ["studio/new", "search/private", "https://example.com", "category/unknown"])
    assert.equal(history.readDzmmDiscoveryHistory(history.mergeDzmmDiscoveryHistory(null, { version: 1, accountId, route: "character/original-map", origin: { route, filters } }), accountId, "character/original-map"), null);
});

test("history replacement preserves foreign keys, strips unrelated snapshot data and never mutates the old entry", () => {
  const old = { key: "react-history-key", idx: 3, usr: { panel: "open" }, unrelated: [1, 2], xumengDiscovery: { old: true } };
  const before = structuredClone(old);
  const next = history.mergeDzmmDiscoveryHistory(old, { ...discovery, privateConversation: "not a saved field", filters: { ...filters, extra: "not saved" } });
  assert.deepEqual(old, before);
  assert.deepEqual(next, { ...old, xumengDiscovery: discovery });
  assert.notEqual(next, old);
});

test("malformed, stale-version, oversize and foreign-account snapshots fail closed without relabeling ownership", () => {
  for (const item of [{ ...discovery, version: 2 }, { ...discovery, accountId: "" }, { ...discovery, accountId: "x".repeat(129) }, { ...discovery, route: "character/a/b", filters: undefined }, { ...discovery, filters: { ...filters, query: "x".repeat(history.DZMM_CATEGORY_QUERY_MAX_LENGTH + 1) } }])
    assert.equal(history.readDzmmDiscoveryHistory({ xumengDiscovery: item }, accountId, item.route), null);
  const oversize = { ...discovery, filters: { ...filters, query: "x".repeat(history.DZMM_CATEGORY_QUERY_MAX_LENGTH + 1) } };
  const oversizeBefore = structuredClone(oversize);
  assert.deepEqual(history.mergeDzmmDiscoveryHistory({ host: "keep" }, oversize), { host: "keep" });
  assert.deepEqual(oversize, oversizeBefore);
  const old = history.mergeDzmmDiscoveryHistory({ host: "keep" }, discovery);
  assert.equal(history.readDzmmDiscoveryHistory(old, "new-owner", discovery.route), null);
  assert.deepEqual(old.xumengDiscovery, discovery);
  assert.deepEqual(history.mergeDzmmDiscoveryHistory(old, null), { host: "keep" });
  for (const state of [null, [], "bad", 1]) assert.equal(history.readDzmmDiscoveryHistory(state, accountId, discovery.route), null);
});
