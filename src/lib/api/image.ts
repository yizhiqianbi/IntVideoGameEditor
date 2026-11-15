import { apiFetch } from "./client";
import type { ImageGenerationModel, ImageGenerationResponse, ImageGenerationSize } from "@/lib/image-generation";

export interface GenerateImageInput {
  apiKey?: string;
  prompt: string;
  model?: ImageGenerationModel;
  size?: ImageGenerationSize;
  /** Data URL or HTTPS URL for image-to-image generation. */
  image?: string;
  aspectRatio?: string;
}

export function generateImage(body: GenerateImageInput) {
  return apiFetch<ImageGenerationResponse>("/api/image/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
