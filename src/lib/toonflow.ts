import { assetImagePrompt, type AssetCard } from "./drama-assets";
import { CHARACTER_THREE_VIEW_PROMPT } from "./image-generation";
import { DEFAULT_PROMPT_SETTINGS, type DramaPromptSettings } from "./drama-prompt";

export const TOONFLOW_LOOKS = ["cinematic", "toon"] as const;
export type ToonflowLook = (typeof TOONFLOW_LOOKS)[number];

export const TOONFLOW_STEPS = [
  { id: "story", label: "原著", hint: "整理人物目标与冲突，拆成可拍的单镜头" },
  { id: "script", label: "编剧", hint: "核对动作、对白与时间轴" },
  { id: "cast", label: "角色", hint: "角色与场景设定图，保持外观和服装一致" },
  { id: "shoot", label: "出片", hint: "用 H3 按镜生成" },
] as const;

export type ToonflowStep = (typeof TOONFLOW_STEPS)[number]["id"];

export const TOONFLOW_SAMPLE =
  "26岁的林晚和29岁的周衡在酒店套房门口争执。门一关上，走廊里的脚步声停在门外，他们必须在暴露线索和保护彼此之间做选择。";

export function toonflowAssetPrompt(
  card: Pick<AssetCard, "kind" | "title" | "description">,
  look: ToonflowLook,
) {
  const subject = [card.title.trim(), card.description.trim()]
    .filter(Boolean)
    .join("。");
  if (look === "toon") {
    if (card.kind === "scene")
      return `${subject}。二维动画场景设定图，空间、道具与材质清楚，赛璐璐上色，无人物主导，无文字。`;
    return `${subject}。二维动画角色设定图，五官、发型与服装清晰，赛璐璐上色，干净线稿。${CHARACTER_THREE_VIEW_PROMPT}无文字。`;
  }
  return assetImagePrompt(card);
}

export function toonflowPromptSettings(look: ToonflowLook): DramaPromptSettings {
  if (look === "toon") {
    return {
      ...DEFAULT_PROMPT_SETTINGS,
      style:
        "二维动画短剧，赛璐璐上色，稳定线稿，人物与场景风格统一，服装和道具细节清楚。无文字、无水印、无Logo。",
      lighting: "自然主光与柔和轮廓光，人物和场景色彩协调。",
    };
  }
  return DEFAULT_PROMPT_SETTINGS;
}

export function nextToonflowStep(
  step: ToonflowStep,
  counts: { shots: number; assets: number; images: number; videos: number },
): ToonflowStep {
  if (step === "story" && counts.shots > 0) return "script";
  if (step === "script" && counts.assets > 0) return "cast";
  if (step === "cast" && counts.images > 0) return "shoot";
  return step;
}
