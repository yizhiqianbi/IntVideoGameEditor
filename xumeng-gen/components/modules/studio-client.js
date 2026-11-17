export const ADULT_HEADER = "X-Adult-Confirmed";

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function post(url, body) {
  let current = body;
  for (;;) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [ADULT_HEADER]: "1" },
      body: JSON.stringify(current),
    });
    const type = response.headers.get("content-type") || "";
    if (response.ok && (type.startsWith("image/") || type.startsWith("video/"))) {
      return { ok: true, blob: await response.blob(), type };
    }
    if (response.status === 413) return { ok: false, error: "图片太大。" };
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (response.status === 202 && payload && payload.taskId) {
      current = { taskId: payload.taskId };
      await wait(4000);
      continue;
    }
    return { ok: false, error: payload && payload.error ? payload.error : "没有完成。" };
  }
}

export function submitTextImage({ prompt, ratio, image }) {
  const body = { prompt, ratio: ratio || "portrait" };
  if (image) {
    body.image = image;
    body.images = [image];
  }
  return post("/api/text-image", body);
}

export async function optimizeVideoPrompt(text) {
  return optimizePrompt(text, "video");
}

export async function optimizePrompt(text, kind) {
  const response = await fetch("/api/optimize-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json", [ADULT_HEADER]: "1" },
    body: JSON.stringify({ text: text || "", kind: kind === "character" || kind === "image" || kind === "story" ? kind : "video" }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload.prompt !== "string") {
    return { ok: false, error: payload && payload.error ? payload.error : "提示词没有优化完。" };
  }
  return { ok: true, prompt: payload.prompt };
}

export async function submitImageVideo(images, action, seconds, mode) {
  let body = { images, image: images[0], action, seconds, mode };
  for (;;) {
    const response = await fetch("/api/image-video", {
      method: "POST",
      headers: { "Content-Type": "application/json", [ADULT_HEADER]: "1" },
      body: JSON.stringify(body),
    });
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.startsWith("video/")) return { ok: true, blob: await response.blob(), type };
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (response.status === 202 && payload && payload.taskId) {
      body = { taskId: payload.taskId };
      await wait(4000);
      continue;
    }
    if (response.status === 413) return { ok: false, error: "图片太大。" };
    return { ok: false, error: payload && payload.error ? payload.error : "没有完成。" };
  }
}

export function submitAnimeFace(face, scene, prompt) {
  return post("/api/face-swap", { face, scene, prompt });
}
