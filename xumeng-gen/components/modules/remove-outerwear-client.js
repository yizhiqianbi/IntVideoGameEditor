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
  return {
    url: OUTERWEAR_PATH,
    method: "POST",
    headers,
    body: JSON.stringify({ image: imageDataUrl }),
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

export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

export async function submitRemoveOuterwear(imageDataUrl, options = {}) {
  if (!options.adultConfirmed) {
    return { ok: false, status: 403, code: "adult-required", error: OUTERWEAR_COPY.needAdult };
  }
  const request = buildRemoveOuterwearRequest(imageDataUrl, options);
  const response = await (options.fetchImpl || fetch)(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
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
  return parseRemoveOuterwearResponse(response.status, type, payload);
}
