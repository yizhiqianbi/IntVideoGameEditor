import test from "node:test";
import assert from "node:assert/strict";

import playAgentModule from "./index";

const {
  buildPlayAgentPlanInput,
  composePlayAgentPrompt,
  getPlayAgentTemplateById,
  getPlayAgentSkillById,
  runMockPlayAgent,
} = playAgentModule as typeof import("./index");

test("builds a plan input from template, skills, and prompt", async () => {
  const template = getPlayAgentTemplateById("single-screen-arcade");
  const skills = [
    getPlayAgentSkillById("funx-instant-arcade"),
    getPlayAgentSkillById("funx-cover-director"),
  ];

  assert.ok(template);
  assert.equal(skills.length, 2);

  const planInput = buildPlayAgentPlanInput({
    projectId: "project-1",
    prompt: "做一个 20 秒内能结束、适合排行榜传播的 H5 小游戏",
    templateId: template!.id,
    skillIds: skills.map((skill) => skill!.id),
  });

  assert.equal(planInput.template.id, "single-screen-arcade");
  assert.equal(planInput.skills.length, 2);
  assert.match(composePlayAgentPrompt(planInput), /20 秒内能结束/);
});

test("mock adapter returns a runnable artifact bundle", async () => {
  const result = await runMockPlayAgent({
    projectId: "project-1",
    templateId: "single-screen-arcade",
    skillIds: ["funx-instant-arcade", "funx-cover-director"],
    prompt: "做一个关于港口调度的单屏小游戏",
  });

  assert.equal(result.plan.filesToGenerate.length > 0, true);
  assert.equal(result.files.some((file) => file.path.endsWith("game.ts")), true);
  assert.equal(typeof result.coverPrompt, "string");
  assert.equal(typeof result.previewEntry, "string");
});
