import test from "node:test";
import assert from "node:assert/strict";

import playAgentSessionsModule from "./sessions";

const {
  createPlayAgentSession,
  getPlayAgentSessionRecord,
  generatePlanForPlayAgentSession,
  runPlayAgentSession,
  buildPlayAgentApplyPayload,
  resetPlayAgentSessionsForTest,
} = playAgentSessionsModule as typeof import("./sessions");

test("session lifecycle produces plan, bundle, and apply payload", async () => {
  resetPlayAgentSessionsForTest();

  const created = createPlayAgentSession({
    projectId: "project-1",
    templateId: "single-screen-arcade",
    skillIds: ["funx-instant-arcade", "funx-cover-director"],
    prompt: "做一个关于港口调度的 H5 单屏小游戏",
  });

  assert.equal(created.projectId, "project-1");
  assert.equal(created.status, "idle");

  const planned = await generatePlanForPlayAgentSession(created.id, {
    templateId: "single-screen-arcade",
    skillIds: ["funx-instant-arcade", "funx-cover-director"],
    prompt: "做一个关于港口调度的 H5 单屏小游戏",
  });

  assert.match(planned.concept, /港口调度|H5/);

  const ran = await runPlayAgentSession(created.id);

  assert.equal(ran.files.length > 0, true);
  assert.equal(ran.previewEntry, "src/game.ts");

  const record = getPlayAgentSessionRecord(created.id);

  assert.ok(record?.bundle);
  assert.equal(record?.events.length ? true : false, true);

  const applyPayload = buildPlayAgentApplyPayload(created.id);

  assert.equal(applyPayload.projectId, "project-1");
  assert.equal(applyPayload.bundle.previewEntry, "src/game.ts");
  assert.equal(applyPayload.skillIds.length, 2);
});
