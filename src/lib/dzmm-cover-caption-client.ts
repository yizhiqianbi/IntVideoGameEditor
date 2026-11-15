import { composeCoverCaption, parseCoverCaption, type DzmmCoverCaptionRequest } from "./dzmm-cover-caption";

export class DzmmCoverCaptionError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "DzmmCoverCaptionError"; }
}

export async function fetchCoverCaption(request: DzmmCoverCaptionRequest, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const response = await fetch("/api/cover-caption", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Xumeng-Request-Id": crypto.randomUUID() },
    body: JSON.stringify(request), signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    throw new DzmmCoverCaptionError(response.status, typeof body?.error === "string" ? body.error : "封面构思失败，请重试。");
  }
  try {
    const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const shot = parseCoverCaption({
      person: body.person, clothing: body.clothing, pose: body.pose,
      place: body.place, lighting: body.lighting, camera: body.camera,
    });
    const caption = composeCoverCaption(shot);
    if (!caption.trim()) throw new Error("封面画面是空的。");
    return caption;
  } catch (error) {
    throw new DzmmCoverCaptionError(502, error instanceof Error ? error.message : "封面构思失败，请重试。");
  }
}
