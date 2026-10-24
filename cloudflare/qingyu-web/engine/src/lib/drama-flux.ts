/** The former specialized local checkpoint is excluded from Qingyu. */
export async function fluxHealth() {
  return { ready: false };
}
export async function generateFluxStill(_input: { prompt: string; image?: string; size?: "1K" | "2K"; aspectRatio?: string }): Promise<{ model: import("./image-generation").ImageGenerationModel; mimeType: string; b64Json: string }> {
  throw new Error("此旧版图像适配器不在晴屿中提供，请使用全年龄图像服务。");
}
