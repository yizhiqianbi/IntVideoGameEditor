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

test("public search detail reload preserves Unicode and literal URL characters for exactly the same owner", () => {
  const query = "  面包🌿 50% /?# %2F  ";
  const origin = history.dzmmSearchDiscoverySource(query);
  assert.deepEqual(origin, { kind: "search", route: `search/${encodeURIComponent(query)}`, query });
  assert.equal(decodeURIComponent(origin!.route.slice(7)), query);
  for (const owner of [null, accountId]) {
    const item = { version: 1, accountId: owner, route: "character/original-baker", origin };
    const source = { host: "keep", xumengDiscovery: { stale: true } };
    const state = JSON.parse(JSON.stringify(history.mergeDzmmDiscoveryHistory(source, item)));
    assert.deepEqual(history.readDzmmDiscoveryHistory(state, owner, item.route), item);
    for (const other of [null, accountId, "other-owner"].filter(value => value !== owner))
      assert.equal(history.readDzmmDiscoveryHistory(state, other, item.route), null);
    assert.equal(history.readDzmmDiscoveryHistory(state, owner, "character/another-baker"), null);
    const related = history.mergeDzmmDiscoveryHistory(state, { ...item, route: "character/related-baker" });
    assert.deepEqual(history.readDzmmDiscoveryHistory(related, owner, "character/related-baker")?.origin, origin);
    assert.deepEqual(source, { host: "keep", xumengDiscovery: { stale: true } });
  }
});

test("public search accepts the complete input boundary without truncating or promoting invalid queries", () => {
  assert.equal(history.DZMM_GLOBAL_QUERY_MAX_LENGTH, 120);
  const query = " " + "麦".repeat(116) + "🌿 ";
  assert.equal(query.length, 120);
  const origin = history.dzmmSearchDiscoverySource(query);
  const item = { version: 1, accountId: null, route: "character/original-baker", origin };
  const state = JSON.parse(JSON.stringify(history.mergeDzmmDiscoveryHistory(null, item)));
  assert.deepEqual(history.readDzmmDiscoveryHistory(state, null, item.route)?.origin, { kind: "search", route: `search/${encodeURIComponent(query)}`, query });
  for (const invalid of [query + "麦", "", "   ", "面包\0", "\ud800", null, 1, {}])
    assert.equal(history.dzmmSearchDiscoverySource(invalid), null);
  const tooLong = { ...item, origin: { kind: "search", route: `search/${encodeURIComponent(query + "麦")}`, query: query + "麦" } };
  assert.deepEqual(history.mergeDzmmDiscoveryHistory({ host: "keep" }, tooLong), { host: "keep" });
});

test("search origins reject malformed, external and conflicting destinations instead of changing their meaning", () => {
  const origin = history.dzmmSearchDiscoverySource("面包")!;
  const item = { version: 1, accountId, route: "character/original-baker", origin };
  for (const invalid of [
    { ...origin, route: "search/%" }, { ...origin, route: "search/%E0%A4%A" },
    { ...origin, route: "https://example.com/#search/%E9%9D%A2%E5%8C%85" },
    { ...origin, route: "//example.com" }, { ...origin, route: "studio/new" },
    { ...origin, route: "category/sfw" }, { ...origin, route: "search/%00", query: "\0" },
    { ...origin, query: "另一查询" }, { ...origin, kind: "external" },
  ]) {
    const untrusted = { ...item, origin: invalid };
    assert.equal(history.readDzmmDiscoveryHistory({ xumengDiscovery: untrusted }, accountId, item.route), null);
    assert.deepEqual(history.mergeDzmmDiscoveryHistory({ host: "keep" }, untrusted), { host: "keep" });
  }
  const stripped = history.mergeDzmmDiscoveryHistory(null, { ...item, origin: { ...origin, accountToken: "not saved", filters } });
  assert.deepEqual(history.readDzmmDiscoveryHistory(stripped, accountId, item.route), item);
});

test("anonymous search permission does not enable anonymous category or independent-detail snapshots", () => {
  const categoryOrigin = history.dzmmDiscoverySource(discovery.route, filters);
  for (const item of [
    { ...discovery, accountId: null },
    { version: 1, accountId: null, route: "character/original-baker", origin: categoryOrigin },
    { version: 1, accountId: null, route: "character/original-baker" },
  ]) {
    assert.equal(history.readDzmmDiscoveryHistory({ xumengDiscovery: item }, null, item.route), null);
    assert.deepEqual(history.mergeDzmmDiscoveryHistory({ host: "keep" }, item), { host: "keep" });
  }
  const signedCategory = history.mergeDzmmDiscoveryHistory(null, discovery);
  assert.deepEqual(history.readDzmmDiscoveryHistory(signedCategory, accountId, discovery.route), discovery);
  assert.equal(history.readDzmmDiscoveryHistory(signedCategory, null, discovery.route), null);
  const detail = { version: 1, accountId, route: "character/original-baker" };
  assert.deepEqual(history.readDzmmDiscoveryHistory(history.mergeDzmmDiscoveryHistory(null, detail), accountId, detail.route), detail);
});

test("reopening the same public card independently clears an inherited anonymous search origin", () => {
  const route = "character/original-baker";
  const origin = history.dzmmSearchDiscoverySource("面包");
  const searchDetail = history.mergeDzmmDiscoveryHistory({ host: "keep" }, { version: 1, accountId: null, route, origin });
  assert.deepEqual(history.readDzmmDiscoveryHistory(searchDetail, null, route)?.origin, origin);
  // pushState may inherit the previous detail state after returning through the shelf.
  const independentDetail = history.mergeDzmmDiscoveryHistory(searchDetail, null);
  const reloaded = JSON.parse(JSON.stringify(independentDetail));
  assert.deepEqual(reloaded, { host: "keep" });
  assert.equal(history.readDzmmDiscoveryHistory(reloaded, null, route), null);
  assert.deepEqual(history.readDzmmDiscoveryHistory(searchDetail, null, route)?.origin, origin);
});

const taskSelection = { hubTab: "market" as const, filter: "all" as const, category: "feedback" as const,
  query: "灯塔🌿 50% /?# %2F", taskId: "original-lighthouse-task" };

test("task list and associated detail retain bounded navigation through document reload", () => {
  for (const query of [taskSelection.query, "", "灯".repeat(118) + "🌿"]) {
    const selection = { ...taskSelection, query };
    const entry = { version: 1, accountId, route: "tasks", taskSelection: selection };
    const source = history.dzmmTaskDiscoverySource(selection);
    assert.deepEqual(source, { kind: "task-market", route: "tasks", selection });
    const state = JSON.parse(JSON.stringify(history.mergeDzmmDiscoveryHistory({ host: "keep" }, entry)));
    assert.deepEqual(history.readDzmmDiscoveryHistory(state, accountId, "tasks"), entry);
    const characterEntry = { version: 1, accountId, route: "character/original-lighthouse", origin: source };
    const detail = JSON.parse(JSON.stringify(history.mergeDzmmDiscoveryHistory(state, characterEntry)));
    assert.deepEqual(history.readDzmmDiscoveryHistory(detail, accountId, characterEntry.route)?.origin, source);
    const list = history.mergeDzmmDiscoveryHistory(detail, { ...entry, taskSelection: { ...selection, taskId: null } });
    assert.deepEqual(history.readDzmmDiscoveryHistory(list, accountId, "tasks")?.taskSelection, { ...selection, taskId: null });
  }
});

test("task navigation validates enums, query and IDs without broadening destinations", () => {
  for (const filter of ["open", "joined", "my", "completed", "all", "hidden", "review"])
    assert.equal(history.dzmmTaskSelection({ ...taskSelection, filter })?.filter, filter);
  for (const category of ["all", "roleplay", "writing", "feedback"])
    assert.equal(history.dzmmTaskSelection({ ...taskSelection, category })?.category, category);
  assert.equal(history.dzmmTaskSelection({ ...taskSelection, taskId: "x".repeat(128) })?.taskId?.length, 128);
  for (const invalid of [null, [], {}, { ...taskSelection, hubTab: "admin" }, { ...taskSelection, filter: "pending" },
    { ...taskSelection, category: "unknown" }, { ...taskSelection, query: 123 }, { ...taskSelection, query: "x".repeat(121) },
    { ...taskSelection, query: "灯塔\0" }, { ...taskSelection, query: "\ud800" }, { ...taskSelection, taskId: "" },
    { ...taskSelection, taskId: "x".repeat(129) }, { ...taskSelection, taskId: "a/b" }, { ...taskSelection, taskId: "%61" }])
    assert.equal(history.dzmmTaskSelection(invalid), null);
  assert.equal(history.dzmmTaskDiscoverySource({ ...taskSelection, hubTab: "platform" }), null);
  assert.equal(history.dzmmTaskDiscoverySource({ ...taskSelection, taskId: null }), null);
  const origin = history.dzmmTaskDiscoverySource(taskSelection)!;
  for (const route of ["https://example.com/tasks", "//example.com", "tasks/extra", "tasks/%", "tasks?filter=all", "category"])
    assert.equal(history.readDzmmDiscoveryHistory({ xumengDiscovery: { version: 1, accountId, route: "character/original-lighthouse", origin: { ...origin, route } } }, accountId, "character/original-lighthouse"), null);
});

test("task history never crosses account or exact route boundaries and strips payloads", () => {
  const origin = history.dzmmTaskDiscoverySource(taskSelection)!;
  for (const entry of [
    { version: 1, accountId, route: "tasks", taskSelection },
    { version: 1, accountId, route: "character/original-lighthouse", origin },
  ]) {
    const state = history.mergeDzmmDiscoveryHistory({ host: "keep" }, entry);
    assert.deepEqual(history.readDzmmDiscoveryHistory(state, accountId, entry.route), entry);
    for (const owner of [null, "different-owner"]) assert.equal(history.readDzmmDiscoveryHistory(state, owner, entry.route), null);
    for (const route of ["tasks/extra", "character/other-role"]) assert.equal(history.readDzmmDiscoveryHistory(state, accountId, route), null);
    const anonymous = { ...entry, accountId: null };
    assert.deepEqual(history.mergeDzmmDiscoveryHistory({ host: "keep" }, anonymous), { host: "keep" });
    assert.equal(history.readDzmmDiscoveryHistory({ xumengDiscovery: anonymous }, accountId, entry.route), null);
    assert.equal(history.readDzmmDiscoveryHistory({ xumengDiscovery: anonymous }, null, entry.route), null);
    assert.equal(history.readDzmmDiscoveryHistory({ xumengDiscovery: { ...entry, version: 2 } }, accountId, entry.route), null);
  }
  const entry = { version: 1, accountId, route: "character/original-lighthouse", origin };
  const before = structuredClone(entry);
  const state = history.mergeDzmmDiscoveryHistory({ host: "keep" }, { ...entry, token: "discard", origin: { ...origin, body: "discard", selection: { ...taskSelection, claimed: true, reward: 100, body: "discard" } } });
  assert.deepEqual(state, { host: "keep", xumengDiscovery: entry });
  assert.deepEqual(entry, before);
});

test("independently reopening the same role clears task origin rather than reviving its task", () => {
  const entry = { version: 1, accountId, route: "character/original-lighthouse", origin: history.dzmmTaskDiscoverySource(taskSelection) };
  const state = history.mergeDzmmDiscoveryHistory({ host: { key: "preserve" } }, entry);
  const independent = JSON.parse(JSON.stringify(history.mergeDzmmDiscoveryHistory(state, { version: 1, accountId, route: entry.route })));
  assert.deepEqual(history.readDzmmDiscoveryHistory(independent, accountId, entry.route), { version: 1, accountId, route: entry.route });
  assert.deepEqual(independent.host, { key: "preserve" });
  assert.deepEqual(history.readDzmmDiscoveryHistory(state, accountId, entry.route)?.origin, entry.origin);
  const search = history.dzmmSearchDiscoverySource("灯塔");
  const searched = history.mergeDzmmDiscoveryHistory(state, { ...entry, origin: search });
  assert.deepEqual(history.readDzmmDiscoveryHistory(searched, accountId, entry.route)?.origin, search);
});

test("restored review navigation is downgraded before ordinary account requests", () => {
  const review = { ...taskSelection, filter: "review" as const };
  assert.deepEqual(history.dzmmTaskSelectionForRole(review, false), { ...taskSelection, filter: "open", taskId: null });
  assert.deepEqual(history.dzmmTaskSelectionForRole(review, true), review);
  assert.deepEqual(history.dzmmTaskSelectionForRole(taskSelection, false), taskSelection);
  assert.deepEqual(history.dzmmTaskSelectionForRole({ ...taskSelection, filter: "invalid" }, true), history.defaultDzmmTaskSelection());
  assert.equal(review.filter, "review");
  assert.equal(review.taskId, taskSelection.taskId);
});
