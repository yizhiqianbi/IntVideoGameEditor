import { STUDIO_STILL_CREDITS } from "./xumeng-studio-still-billing";

const STILL_TYPES = ["image/png", "image/jpeg", "image/webp"];

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

export async function requestAiapiStill(
  input: { templateId: string; prompt: string; image: string; ratio: string },
  signal?: AbortSignal,
): Promise<{ image: Blob; chargedCredits: number }> {
  const response = await fetch("/api/aiapi/still", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const type = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!response.ok || !STILL_TYPES.includes(type)) {
    throw new Error(await errorMessage(response, "出图没有完成。"));
  }
  const chargedCredits = Number(response.headers.get("X-Charged-Credits"));
  if (chargedCredits !== STUDIO_STILL_CREDITS) throw new Error("扣费没有完成，这次没有出图。");
  return { image: await response.blob(), chargedCredits };
}

export async function requestAiapiVideo(
  input: { templateId: string; prompt: string; image: string; ratio: string },
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch("/api/aiapi/video", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok || !response.headers.get("Content-Type")?.includes("video/mp4")) {
    throw new Error(await errorMessage(response, "视频没有完成。"));
  }
  return response.blob();
}
