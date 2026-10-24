import { resolveMentions, orderedImageUrls } from "./drama-mentions";
import { composeShotPrompt, ensureMentions, type DramaPromptSettings } from "./drama-prompt";
import { isLtxFamily } from "./drama-models";
import { singleShotDirection } from "./drama-direction";
import {
  withNegativePrompt,
  userNegativePrompt,
} from "./generation-constraints";
import { CHARACTER_THREE_VIEW_PROMPT } from "./image-generation";
import type { Shot } from "./drama";
export type AssetCard = {
  id: string;
  kind: "reference" | "scene";
  title: string;
  description: string;
  negativePrompt?: string;
  imageUrl: string;
  position: { x: number; y: number };
  positionLocked?: boolean;
};
export function newAsset(kind: AssetCard["kind"], index: number): AssetCard {
  return {
    id: crypto.randomUUID(),
    kind,
    title: kind === "scene" ? "新场景" : "角色参考",
    description: "",
    negativePrompt: "",
    imageUrl: "",
    position: { x: -360, y: index * 300 },
  };
}

export function variantAsset(card: AssetCard, offsetIndex = 1): AssetCard {
  const shift = Math.max(1, offsetIndex) * 48;
  return {
    ...card,
    id: crypto.randomUUID(),
    imageUrl: "",
    position: { x: card.position.x + shift, y: card.position.y + shift },
  };
}
export function assetImagePrompt(card: Pick<AssetCard, "kind" | "title" | "description">) {
  const subject = [card.title.trim(), card.description.trim()]
    .filter(Boolean)
    .join("。");
  if (card.kind === "scene")
    return `${subject}。影视场景参考图，空间布局、道具、材质和光线清晰，无人物主导，无文字。`;
  return `${subject}。成年角色设定图，明确21岁以上，全身或大半身入画，五官与身材清楚，干净工作室灯光，无文字，无未成年人。`;
}

export { CHARACTER_THREE_VIEW_PROMPT };

export function assetThreeViewPrompt(
  card: Pick<AssetCard, "title" | "description">,
) {
  const subject = [card.title.replace(/\s*·\s*三视图$/, "").trim(), card.description.trim()]
    .filter(Boolean)
    .join("。");
  const identity = subject
    ? `根据参考图中的同一成年角色「${subject}」，保持身份、年龄、五官、发型、身材、服装完全一致。`
    : "根据参考图中的同一成年角色，保持身份、年龄、五官、发型、身材、服装完全一致。";
  return `${identity}${CHARACTER_THREE_VIEW_PROMPT}明确21岁以上，全身入画，干净工作室灯光，无文字，无未成年人。`;
}

export function shotContext(
  shot: Shot,
  assets: AssetCard[],
  tone?: string,
  settings?: DramaPromptSettings,
) {
  const linked = (shot.assetIds || [])
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is AssetCard => !!a);
  const references = orderedImageUrls(shot, assets);
  const wantsRefs =
    linked.some((a) => a.imageUrl.trim()) ||
    !!shot.referenceMedia?.length ||
    /@(Image|Video|Audio)\d+\b/.test(shot.prompt);
  const mode =
    shot.mode === "t2v" && wantsRefs && !isLtxFamily(shot.videoModel)
      ? "ri2v"
      : shot.mode;
  const mentioned = ensureMentions({ ...shot, mode }, assets);
  const resolved = resolveMentions({ ...shot, ...mentioned, mode }, assets);
  const context = linked.map((a) => {
    const number = references.indexOf(a.imageUrl.trim()) + 1;
    const imageN = mode === "ri2v" && a.imageUrl.trim() ? number : 0;
    const lock = withNegativePrompt(
      a.description,
      userNegativePrompt(a.negativePrompt),
    );
    if (a.kind === "scene") {
      return imageN
        ? `Image ${imageN} = 场景锁定「${a.title}」空间、材料、床品与光线。${lock}`
        : `场景锁定「${a.title}」：保持空间、材料、床品与光线一致。${lock}`;
    }
    return imageN
      ? `Image ${imageN} = 锁定角色「${a.title}」身份、五官、发型、身材与服装。${lock}`
      : `角色锁定「${a.title}」：保持身份、五官、发型、身材与服装一致。${lock}`;
  });
  const composed = composeShotPrompt({ ...shot, prompt: resolved }, settings);
  return {
    mode,
    references,
    prompt: withNegativePrompt(
      [
        ...context,
        composed,
        composed.includes("规格：") ? "" : singleShotDirection(shot.duration),
      ]
        .filter(Boolean)
        .join("\n\n"),
      userNegativePrompt(shot.negativePrompt) ||
        userNegativePrompt(settings?.negative),
    ),
  };
}
