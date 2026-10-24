import assert from "node:assert/strict";
import test from "node:test";
import saveModule from "./dzmm-explicit-save";
import type { DzmmExplicitSaveGate } from "./dzmm-explicit-save";

const { dzmmExplicitSaveStopMessage, planDzmmExplicitSave } = saveModule as typeof import("./dzmm-explicit-save");

const ready: DzmmExplicitSaveGate = {
  accountId: "account", ready: true, paused: false, conflicted: false,
  persisted: true, storageWarning: false, switchingAccount: false,
};

test("an explicit save writes when sync can accept the current draft", () => {
  assert.equal(planDzmmExplicitSave(ready), "write");
});

test("a paused connection resumes in place instead of sending the author away", () => {
  assert.equal(planDzmmExplicitSave({ ...ready, paused: true }), "resume");
  assert.equal(planDzmmExplicitSave({ ...ready, ready: false }), "resume");
  assert.equal(dzmmExplicitSaveStopMessage("unsynced"), "草稿已保存在本地备份，云端尚未同步。请重新同步后再试。");
});

test("a version conflict is not pushed over the cloud copy", () => {
  assert.equal(planDzmmExplicitSave({ ...ready, paused: true, conflicted: true }), "conflict");
  assert.equal(planDzmmExplicitSave({ ...ready, conflicted: true }), "conflict");
  assert.match(dzmmExplicitSaveStopMessage("conflict"), /加载云端版本/);
});

test("a draft without a local backup is not resumed", () => {
  assert.equal(planDzmmExplicitSave({ ...ready, paused: true, persisted: false }), "incomplete");
  assert.equal(planDzmmExplicitSave({ ...ready, paused: true, storageWarning: true }), "incomplete");
  assert.equal(planDzmmExplicitSave({ ...ready, storageWarning: true }), "write");
  assert.match(dzmmExplicitSaveStopMessage("incomplete"), /导出记录/);
});

test("an account switch does not resume a paused draft", () => {
  assert.equal(planDzmmExplicitSave({ ...ready, paused: true, switchingAccount: true }), "unsynced");
  assert.equal(planDzmmExplicitSave({ ...ready, accountId: null, paused: true }), "unsynced");
});
