import { apiFetch } from "./client";
import type { ImageGenerationModel, ImageGenerationResponse } from "@/lib/image-generation";

export interface GenerateImageInput {
  apiKey?: string;
  prompt: string;
  model?: ImageGenerationModel;
}

export function generateImage(body: GenerateImageInput) {
  return apiFetch<ImageGenerationResponse>("/api/image/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
