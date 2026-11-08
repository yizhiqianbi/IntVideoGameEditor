export async function requestH3ReferenceVideo(input: { templateId: string; prompt: string; image: string }, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch("/api/h3/r2v", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId: input.templateId, prompt: input.prompt, image: input.image }),
    signal,
  });
  if (!response.ok || !response.headers.get("Content-Type")?.includes("video/mp4")) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof payload?.error === "string" ? payload.error : "视频没有完成。");
  }
  return response.blob();
}
