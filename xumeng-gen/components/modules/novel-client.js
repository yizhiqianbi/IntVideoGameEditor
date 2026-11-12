export const ADULT_HEADER = "X-Adult-Confirmed";
export const NOVEL_PATH = "/api/novel";
export const GENERATE_DEFAULT_COUNT = 4000;
export const CONTINUE_DEFAULT_COUNT = 2000;

export const NOVEL_COPY = {
  detail: "新写一篇，或接着已有正文往下写。可填写人物设定、地点场景、细节要求和目标字数。新写默认 4000 字，为目标准则，不保证精确。",
  plot: "剧情",
  plotHint: "人物在哪里，发生了什么。",
  source: "已有正文",
  sourceHint: "把要接着写的正文贴在这里。",
  character: "人物设定",
  scene: "地点场景",
  details: "细节/其他要求",
  count: "小说字数",
  continueCount: "续写字数",
  countHint: "默认 4000 字，为目标准则，不保证精确。",
  continueCountHint: "默认 2000 字，范围 500–2000。",
  optional: "可以留空",
  needPlot: "先写剧情。",
  needSource: "先贴上已有正文。",
  needAdult: "需要先确认已满 18 岁。",
  waiting: "正在生成…",
  write: "开始写",
  continue: "继续写",
};

export function defaultCount(mode) {
  return mode === "continue" ? String(CONTINUE_DEFAULT_COUNT) : String(GENERATE_DEFAULT_COUNT);
}

export function buildNovelRequest(fields, options = {}) {
  const mode = fields.mode === "continue" ? "continue" : "new";
  const body = { mode };
  if (mode === "new") body.description = fields.description ?? fields.plot ?? "";
  else body.source = fields.source ?? "";
  const character = (fields.character_setting ?? "").trim();
  const scene = (fields.location_scene ?? "").trim();
  const details = (fields.details ?? "").trim();
  const count = String(fields.count ?? "").trim();
  if (character) body.character_setting = character;
  if (scene) body.location_scene = scene;
  if (details) body.details = details;
  if (count) body.count = count;
  const headers = { "Content-Type": "application/json" };
  if (options.adultConfirmed) headers[ADULT_HEADER] = "1";
  return { url: NOVEL_PATH, method: "POST", headers, body: JSON.stringify(body) };
}

export function parseNovelResponse(status, contentType, payload) {
  const type = contentType || "";
  if (status === 200 && (type.startsWith("text/") || type.includes("json") || typeof payload === "string")) {
    const text = typeof payload === "string" ? payload : payload && payload.error ? "" : String(payload ?? "");
    if (type.includes("json") && payload && typeof payload === "object" && payload.error) {
      return { ok: false, status, code: payload.code || "", error: payload.error };
    }
    if (status === 200 && typeof payload === "string") return { ok: true, text: payload };
  }
  if (status === 200 && typeof payload === "string" && payload.trim()) {
    return { ok: true, text: payload };
  }
  const error = payload && typeof payload === "object" ? payload.error : "";
  return {
    ok: false,
    status,
    code: payload && typeof payload === "object" ? payload.code : "",
    error: error || "小说没有完成。",
  };
}

export async function submitNovel(fields, options = {}) {
  if (!options.adultConfirmed) {
    return { ok: false, status: 403, code: "adult-required", error: NOVEL_COPY.needAdult };
  }
  const request = buildNovelRequest(fields, options);
  const response = await (options.fetchImpl || fetch)(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const type = response.headers.get("content-type") || "";
  if (type.startsWith("text/") && !type.includes("json")) {
    const text = await response.text();
    return parseNovelResponse(response.status, type, text);
  }
  let payload = null;
  try {
    const text = await response.text();
    if (type.includes("json")) payload = JSON.parse(text);
    else payload = text;
  } catch {
    payload = { error: "小说没有完成。" };
  }
  return parseNovelResponse(response.status, type, payload);
}
