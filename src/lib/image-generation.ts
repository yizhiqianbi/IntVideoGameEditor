export type ImageGenerationModel =
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
  "doubao-seedream-5-0-260128";

export const DEFAULT_CHARACTER_IMAGE_SIZE: ImageGenerationSize = "2K";

export const IMAGE_MODEL_OPTIONS: Array<{
  value: ImageGenerationModel;
  label: string;
}> = [
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

  return `${subject}，单人角色设定图，正脸清晰，服装稳定，电影感人像，适合作为互动影视角色参考图。`;
}
