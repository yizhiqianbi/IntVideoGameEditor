export const GROK_IMAGE_MODEL = "x-ai/grok-imagine-image-2.0";

export type ImageGenerationModel =
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
  return false;
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
}) {
  const segments = [input.name.trim(), input.bio.trim(), input.basePrompt.trim()]
    .filter((value) => value.length > 0);

  const subject = segments.join("，");

  return `${subject}。${CHARACTER_THREE_VIEW_PROMPT}明确21岁以上，全身入画，干净工作室灯光，无文字，无未成年人。`;
}

export function buildSceneImagePrompt(input: {
  name: string;
  description: string;
  basePrompt: string;
}) {
  const segments = [input.name.trim(), input.description.trim(), input.basePrompt.trim()]
    .filter((value) => value.length > 0);
  const subject = segments.join("，");

  return `${subject}，电影级场景设定图，无人物主导，环境细节清晰，构图稳定，适合作为互动影视场景参考图。`;
}
