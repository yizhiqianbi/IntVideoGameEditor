import { getPlayAgentSkillById } from "./skills";
import { getPlayAgentTemplateById } from "./templates";
import type { PlayAgentPlanInput } from "./types";

export function buildPlayAgentPlanInput(input: {
  projectId: string;
  prompt: string;
  templateId: string;
  skillIds: string[];
}): PlayAgentPlanInput {
  const template = getPlayAgentTemplateById(input.templateId);

  if (!template) {
    throw new Error("未找到对应的 Play 模板。");
  }

  const skills = input.skillIds.map((skillId) => {
    const skill = getPlayAgentSkillById(skillId);

    if (!skill) {
      throw new Error(`未找到对应的 Skill：${skillId}`);
    }

    return skill;
  });

  return {
    projectId: input.projectId,
    prompt: input.prompt.trim(),
    template,
    skills,
  };
}

export function composePlayAgentPrompt(input: PlayAgentPlanInput) {
  const sections = [
    `项目：${input.projectId}`,
    `模板：${input.template.name}`,
    `模板提示：${input.template.starterPrompt}`,
    `模板约束：${input.template.starterConstraints.join("；")}`,
    `技能：${input.skills.map((skill) => `${skill.name}（${skill.promptFrame}）`).join("；")}`,
    `用户需求：${input.prompt}`,
  ];

  return sections.join("\n");
}
