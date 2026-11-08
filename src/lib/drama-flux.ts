import { COMFY_BASE, comfyFetch } from "./drama-comfy";

export const FLUX_NSFW_MODEL = "heartsync/flux-nsfw-uncensored";

export async function fluxHealth() {
  const response = await comfyFetch("/pencil/flux/health");
  if (!response.ok) throw new Error("Flux 生图服务未就绪");
  return response.json() as Promise<{
    ready: boolean;
    checkpoint?: string;
    lora?: string;
    models?: Record<string, { name?: string; available?: boolean }>;
  }>;
}

export async function generateFluxStill(input: {
  prompt: string;
  image?: string;
  size?: "1K" | "2K";
  aspectRatio?: string;
}) {
  const response = await fetch(`${COMFY_BASE}/pencil/flux/t2i`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(170_000),
    body: JSON.stringify({
      prompt: input.prompt,
      image: input.image,
      size: input.size === "2K" ? "2K" : "1K",
      aspect_ratio: input.aspectRatio,
    }),
  });
  const payload = (await response.json()) as {
    mimeType?: string;
    b64Json?: string;
    error?: string;
  };
  if (!response.ok || !payload.b64Json) {
    throw new Error(payload.error || "Flux 生图失败");
  }
  return {
    model: FLUX_NSFW_MODEL,
    mimeType: payload.mimeType || "image/png",
    b64Json: payload.b64Json,
  };
}
