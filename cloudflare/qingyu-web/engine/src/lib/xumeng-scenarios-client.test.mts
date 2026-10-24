import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import scenarioModule from "./xumeng-scenarios";
import clientModule from "./xumeng-scenarios-client";
import type { XumengScenarioDetail } from "./xumeng-scenarios";
const { createXumengScenario } = scenarioModule as typeof import("./xumeng-scenarios");
const { clearScenarioRecovery, fetchXumengScenario, fetchXumengScenarios, readScenarioRecoveries, saveXumengScenario, writeScenarioRecovery } = clientModule as typeof import("./xumeng-scenarios-client");
const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
afterEach(() => { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage }); });
const accountId = "scenario-client-account", scenario = createXumengScenario(true);
const detail: XumengScenarioDetail = { accountId, scenario: { ...scenario, version: 1, createdAt: 1, updatedAt: 2 } };
test("failed request keeps the submitted draft and account mismatch cannot become accepted content", async () => {
  const before = JSON.stringify(scenario); globalThis.fetch = async () => { throw new Error("isolated network loss"); };
  await assert.rejects(saveXumengScenario(accountId, scenario, null), /输入仍保留/); assert.equal(JSON.stringify(scenario), before);
  globalThis.fetch = async () => Response.json({ ...detail, accountId: "foreign-account" });
  await assert.rejects(fetchXumengScenario(accountId, scenario.id), /账号已切换/);
  globalThis.fetch = async () => Response.json({ ...detail, scenario: { ...detail.scenario, id: "wrong-id" } });
  await assert.rejects(fetchXumengScenario(accountId, scenario.id), /编号不一致/);
});
test("lost save acknowledgement is adopted only when every submitted field matches", async () => {
  globalThis.fetch = async () => Response.json({ accountId, error: "conflict", current: detail }, { status: 409 });
  assert.deepEqual(await saveXumengScenario(accountId, scenario, null), detail);
  await assert.rejects(saveXumengScenario(accountId, { ...scenario, hostNotes: "different secret" }, null), /conflict/);
});
test("request includes exact account and abort signal and rejects invalid list records", async () => {
  const abort = new AbortController(); let captured: RequestInit | undefined;
  globalThis.fetch = async (_url, options) => { captured = options; return Response.json({ accountId, scenarios: [{ id: scenario.id, title: scenario.title, synopsis: scenario.synopsis, version: 1, updatedAt: 2, roleCount: 2, stageCount: 3 }] }); };
  assert.equal((await fetchXumengScenarios(accountId, abort.signal)).scenarios[0].id, scenario.id); assert.equal(captured?.credentials, "same-origin"); assert.equal(captured?.signal, abort.signal);
  globalThis.fetch = async () => Response.json({ accountId, scenarios: [{ version: -1 }] });
  await assert.rejects(fetchXumengScenarios(accountId), /无效/);
});
test("recovery is account and document scoped, and clearing a stale revision preserves the newer edit", () => {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { get length() { return entries.size; }, key: (index: number) => [...entries.keys()][index] ?? null, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) } });
  const first = writeScenarioRecovery(accountId, "document-a", scenario, null), otherDocument = writeScenarioRecovery(accountId, "document-b", { ...scenario, title: "other tab" }, 1);
  writeScenarioRecovery("other-account", "document-c", { ...scenario, title: "private to other account" }, 1);
  assert.equal(readScenarioRecoveries(accountId).length, 2); assert.ok(readScenarioRecoveries(accountId).every(entry => entry.draft.title !== "private to other account"));
  clearScenarioRecovery(otherDocument, accountId, "document-a"); assert.equal(readScenarioRecoveries(accountId).length, 2);
  const newer = writeScenarioRecovery(accountId, "document-a", { ...scenario, title: "newer edit" }, null); clearScenarioRecovery(first, accountId, "document-a"); assert.ok(readScenarioRecoveries(accountId).some(entry => entry.draft.title === "newer edit"));
  clearScenarioRecovery(newer, accountId, "document-a"); assert.equal(readScenarioRecoveries(accountId).length, 1); assert.equal(readScenarioRecoveries("other-account").length, 1);
});
