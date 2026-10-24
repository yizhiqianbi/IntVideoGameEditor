import type { PlayAgentSkillRef } from "./types";

export const PLAY_AGENT_SKILLS: PlayAgentSkillRef[] = [
  {
    id: "funx-instant-arcade",
    name: "极速街机",
    kind: "gameplay",
    promptFrame: "规则必须在 3 秒内理解，单局 20-60 秒，操作反馈清晰直接。",
  },
  {
    id: "funx-viral-puzzle",
    name: "爆款解谜",
    kind: "gameplay",
    promptFrame: "前半段简单，后半段快速拉高张力，制造近胜失败和复玩欲望。",
  },
  {
    id: "funx-meta-retention",
    name: "轻元进度",
    kind: "retention",
    promptFrame: "加入轻量成长、分数追逐或多层目标，让用户有再次返回的动机。",
  },
  {
    id: "funx-social-challenge",
    name: "社交挑战",
    kind: "social",
    promptFrame: "让结果可比较、可截图、可榜单化，强化分享和对战感。",
  },
  {
    id: "funx-browser-inventor",
    name: "浏览器巧思",
    kind: "gameplay",
    promptFrame: "用一个单点子撑起玩法，强调浏览器原生、轻巧、有记忆点。",
  },
  {
    id: "funx-cover-director",
    name: "封面导演",
    kind: "cover",
    promptFrame: "封面只突出一个玩法瞬间和一个清楚标题，禁止廉价发光与复杂贴纸。",
  },
];

export function listPlayAgentSkills() {
  return PLAY_AGENT_SKILLS;
}

export function getPlayAgentSkillById(skillId: string) {
  return PLAY_AGENT_SKILLS.find((skill) => skill.id === skillId);
}
