export const GROK_IMAGE_MODEL = "x-ai/grok-imagine-image-2.0";
export const FLUX_NSFW_MODEL = "heartsync/flux-nsfw-uncensored";

export type ImageGenerationModel =
  | typeof FLUX_NSFW_MODEL
  | typeof GROK_IMAGE_MODEL
  | "doubao-seedream-5-0-260128"
  | "doubao-seedream-4-5-251128"
  | "doubao-seedream-4-0-250828"
  | "doubao-seedream-3-0-t2i-250415";

export type ImageGenerationSize = "1K" | "2K";

export type ImageGenerationResponse = {
  model: ImageGenerationModel;
  mimeType: string;
  b64Json: string;
};

export const DEFAULT_CHARACTER_IMAGE_MODEL: ImageGenerationModel =
  GROK_IMAGE_MODEL;

export function isLocalFluxModel(model: unknown) {
  return model === FLUX_NSFW_MODEL;
}

export function parseImageModel(value: unknown): ImageGenerationModel {
  return IMAGE_MODEL_OPTIONS.some((option) => option.value === value)
    ? (value as ImageGenerationModel)
    : DEFAULT_CHARACTER_IMAGE_MODEL;
}

export function imageModelShortLabel(model: ImageGenerationModel) {
  return (
    IMAGE_MODEL_OPTIONS.find((option) => option.value === model)?.label.split(
      " · ",
    )[0] || "生图"
  );
}

export const DEFAULT_CHARACTER_IMAGE_SIZE: ImageGenerationSize = "1K";

export const CHARACTER_THREE_VIEW_PROMPT =
  "横向三格分镜排版，人物三视图：左侧完整全身正面视图，中间完整全身侧面视图，右侧完整全身背面视图；三格必须为同一个人物，五官、脸型、发型、眼镜、身材比例、服装正反面细节完全统一，无脸型差异、五官崩坏、服装错位、肢体畸形。";

export const REFERENCE_IMAGE_PROMPT =
  "上传的参考图是唯一的身份与构图基准，必须真正进行参考图生图：保留同一人物或同一场景的脸型、发型、肤色、体型、服装轮廓、材质、主要颜色、光线方向和空间关系；只按文字要求改变动作、表情或环境，不要换成另一个人，不要把参考图当成灵感图。";

export const IMAGE_MODEL_OPTIONS: Array<{
  value: ImageGenerationModel;
  label: string;
}> = [
  { value: GROK_IMAGE_MODEL, label: "Grok Image 2.0" },
  {
    value: "doubao-seedream-5-0-260128",
    label: "Seedream 5.0",
  },
  {
    value: "doubao-seedream-4-5-251128",
    label: "Seedream 4.5",
  },
  {
    value: "doubao-seedream-4-0-250828",
    label: "Seedream 4.0",
  },
  {
    value: "doubao-seedream-3-0-t2i-250415",
    label: "Seedream 3.0",
  },
];

export function buildCharacterImagePrompt(input: {
  name: string;
  bio: string;
  basePrompt: string;
  hasReference?: boolean;
}) {
  const segments = [input.name.trim(), input.bio.trim(), input.basePrompt.trim()]
    .filter((value) => value.length > 0);

  const subject = segments.join("，");
  const composition = input.hasReference
    ? "单人单画面角色设定图，优先保持参考图中的人物身份与视觉风格，构图清晰稳定，不要三格排版，不要新增第二个人物。"
    : CHARACTER_THREE_VIEW_PROMPT;

  return `${subject}。${composition}明确21岁以上，全身入画，干净工作室灯光，无文字，无未成年人。`;
}

export function buildSceneImagePrompt(input: {
  name: string;
  description: string;
  basePrompt: string;
  hasReference?: boolean;
}) {
  const segments = [input.name.trim(), input.description.trim(), input.basePrompt.trim()]
    .filter((value) => value.length > 0);
  const subject = segments.join("，");

  const composition = input.hasReference
    ? "单一连续画面，优先保持参考图的空间布局、镜头角度、材质、色调和光线方向，只修改文字明确要求的内容，不要换场景。"
    : "无人物主导，环境细节清晰，构图稳定";
  return `${subject}，电影级场景设定图，${composition}，适合作为互动影视场景参考图。`;
}
