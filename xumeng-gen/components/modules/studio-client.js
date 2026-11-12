export const ADULT_HEADER = "X-Adult-Confirmed";

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", [ADULT_HEADER]: "1" },
    body: JSON.stringify(body),
  });
  const type = response.headers.get("content-type") || "";
  if (response.ok && (type.startsWith("image/") || type.startsWith("video/"))) {
    return { ok: true, blob: await response.blob(), type };
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { ok: false, error: payload && payload.error ? payload.error : "没有完成。" };
}

export function submitTextImage(prompt, style, clarity) {
  return post("/api/text-image", { prompt, style, clarity });
}

export function submitImageVideo(image, action, seconds) {
  return post("/api/image-video", { image, action, seconds });
}

export function submitAnimeFace(face, scene) {
  return post("/api/face-swap", { face, scene });
}
