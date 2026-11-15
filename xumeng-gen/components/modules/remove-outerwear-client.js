export const ADULT_KEY = "xumeng-modules-18";
export const ADULT_HEADER = "X-Adult-Confirmed";
export const OUTERWEAR_PATH = "/api/remove-outerwear";

export const OUTERWEAR_COPY = {
  title: "去外套",
  line: "只移除外套，保留完整内搭",
  detail: "上传一张人物图。",
  button: "移除外套",
  hint: "处理后的画面会显示在这里。",
  needImage: "先上传一张人物图。",
  needAdult: "需要先确认已满 18 岁。",
};

export function buildRemoveOuterwearRequest(imageDataUrl, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (options.adultConfirmed) headers[ADULT_HEADER] = "1";
  const body = { image: imageDataUrl, prompt: options.prompt || "" };
  if (options.ratio) body.ratio = options.ratio;
  const references = Array.isArray(options.references) ? options.references.filter(Boolean).slice(0, 2) : [];
  if (references.length) body.references = references;
  return {
    url: OUTERWEAR_PATH,
    method: "POST",
    headers,
    body: JSON.stringify(body),
  };
}

export function parseRemoveOuterwearResponse(status, contentType, payload) {
  const type = contentType || "";
  if (status === 200 && type.startsWith("image/")) {
    return { ok: true, image: payload };
  }
  const error = payload && typeof payload === "object" ? payload.error : "";
  return {
    ok: false,
    status,
    code: payload && typeof payload === "object" ? payload.code : "",
    error: error || "去外套没有完成。",
  };
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

export async function fileToDataUrl(file) {
  const original = await readFile(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("图片读取失败。"));
      element.src = original;
    });
    const edge = Math.max(image.width, image.height);
    const scale = edge > 1280 ? 1280 / edge : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return original;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.86;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > 1_500_000 && quality > 0.5) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    return dataUrl;
  } catch {
    return original;
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function submitRemoveOuterwear(imageDataUrl, options = {}) {
  if (!options.adultConfirmed) {
    return { ok: false, status: 403, code: "adult-required", error: OUTERWEAR_COPY.needAdult };
  }
  let request = buildRemoveOuterwearRequest(imageDataUrl, options);
  const fetchImpl = options.fetchImpl || fetch;
  for (;;) {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    if (response.status === 413) return { ok: false, status: 413, error: "图片太大。" };
    const type = response.headers.get("content-type") || "";
    if (type.startsWith("image/")) {
      const blob = await response.blob();
      return parseRemoveOuterwearResponse(response.status, type, blob);
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = { error: "去外套没有完成。" };
    }
    if (response.status === 202 && payload && payload.taskId) {
      request = { ...request, body: JSON.stringify({ taskId: payload.taskId }) };
      await wait(4000);
      continue;
    }
    return parseRemoveOuterwearResponse(response.status, type, payload);
  }
}
