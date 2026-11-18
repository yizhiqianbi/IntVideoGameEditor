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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch("/api/image-video", {
      method: "POST",
      headers: { "Content-Type": "application/json", [ADULT_HEADER]: "1" },
      body: JSON.stringify(body),
    });
    const type = response.headers.get("content-type") || "";
    if (response.ok && type.startsWith("video/")) return { ok: true, blob: await response.blob(), type };
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (response.ok && payload && typeof payload.url === "string") {
      return { ok: true, url: payload.url, type: type || "video/mp4" };
    }
    if (response.status === 202 && payload && payload.taskId) {
      body = { taskId: payload.taskId };
      await wait(8000);
      continue;
    }
    if (response.status === 413) return { ok: false, error: "视频太大。" };
    return { ok: false, error: payload && payload.error ? payload.error : "没有完成。" };
  }
  return { ok: false, error: "视频这次等太久了。请再试一次。" };
}

export function submitAnimeFace(face, scene, prompt) {
  return post("/api/face-swap", { face, scene, prompt });
}

// 视频不经过 Vercel 的 4.5MB 请求体：先领票据，把文件直传到渠道素材库，再让服务端换脸。
export async function uploadFaceVideo(file) {
  const ticketResponse = await fetch("/api/upload-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json", [ADULT_HEADER]: "1" },
    body: JSON.stringify({ bytes: file.size }),
  });
  const ticket = await ticketResponse.json().catch(() => null);
  const ticketError = ticket && typeof ticket.error === "string" ? ticket.error : "";
  if (!ticketResponse.ok || !ticket || typeof ticket.url !== "string") {
    return { ok: false, error: ticketError || "视频上传没有开始。" };
  }
  if (typeof ticket.maxBytes === "number" && file.size > ticket.maxBytes) {
    return { ok: false, error: "视频请控制在 64MB 以内。" };
  }
  let upload = null;
  try {
    upload = await fetch(ticket.url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "video/mp4" },
      body: file,
    });
  } catch {
    return { ok: false, error: "视频没有传上去。" };
  }
  const stored = await upload.json().catch(() => null);
  const uploadError = stored && typeof stored.error === "string" ? stored.error : "";
  if (!upload.ok || !stored || typeof stored.url !== "string") {
    return { ok: false, error: uploadError || "视频没有传上去。" };
  }
  return { ok: true, url: stored.url };
}

export async function submitFaceVideo(face, videoUrl, prompt, seconds) {
  let body = { face, videoUrl, prompt, seconds };
  for (let attempt = 0; attempt < 120; attempt += 1) {
    let response;
    try {
      response = await fetch("/api/face-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json", [ADULT_HEADER]: "1" },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, error: "换脸没有完成。" };
    }
    const payload = await response.json().catch(() => null);
    if (response.ok && payload && typeof payload.url === "string") {
      return { ok: true, url: payload.url, type: "video/mp4" };
    }
    if (response.status === 202 && payload && typeof payload.videoTaskId === "string") {
      body = { videoTaskId: payload.videoTaskId };
      await wait(8000);
      continue;
    }
    return { ok: false, error: payload && typeof payload.error === "string" ? payload.error : "换脸没有完成。" };
  }
  return { ok: false, error: "换脸这次等太久了。请再试一次。" };
}
