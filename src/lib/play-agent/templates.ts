import type { PlayAgentTemplate } from "./types";

export const PLAY_AGENT_TEMPLATES: PlayAgentTemplate[] = [
  {
    id: "single-screen-arcade",
    name: "单屏反应街机",
    category: "arcade",
    starterPrompt: "做一个 20-60 秒局长、3 秒内能看懂规则的单屏 H5 小游戏。",
    starterConstraints: [
      "首屏必须直接进入玩法",
      "规则一眼可懂",
      "适合封面流传播",
    ],
    outputShape: "single-screen",
  },
  {
    id: "viral-puzzle-loop",
    name: "爆款轻解谜",
    category: "puzzle",
    starterPrompt: "做一个简单上手、后续变紧张、带重复游玩冲动的轻解谜小游戏。",
    starterConstraints: [
      "前 5 秒必须让人理解目标",
      "失败要有近胜感",
      "局时尽量控制在 90 秒内",
    ],
    outputShape: "single-screen",
  },
  {
    id: "meta-sim-lite",
    name: "轻元进度模拟",
    category: "sim",
    starterPrompt: "做一个有简单成长感和回流目标的轻量模拟玩法。",
    starterConstraints: [
      "循环目标清晰",
      "每局都有小成长",
      "不依赖复杂多页面 UI",
    ],
    outputShape: "level-based",
  },
];

export function listPlayAgentTemplates() {
  return PLAY_AGENT_TEMPLATES;
}

export function getPlayAgentTemplateById(templateId: string) {
  return PLAY_AGENT_TEMPLATES.find((template) => template.id === templateId);
}
