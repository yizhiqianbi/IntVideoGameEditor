/**
 * Allowlisted novel handler for the 3488 page.
 * Only generate-novel / continue-novel may be forwarded to the local
 * 3477 channel route. Credentials stay on that server; this process
 * never reads .env or returns keys.
 */
export const UNSUPPORTED_MESSAGE = "小说渠道还没配上或暂时不可用。";
export const CHANNEL_TARGET = "http://127.0.0.1:3477/api/channel";
export const FORWARD_TIMEOUT_MS = 190_000;
export const GENERATE_DEFAULT_COUNT = 4000;
export const CONTINUE_DEFAULT_COUNT = 2000;
export const CONTINUE_MIN_COUNT = 500;
export const CONTINUE_MAX_COUNT = 2000;
/** Local safety cap for new novels. Not a documented public-API maximum. */
export const GENERATE_LOCAL_MAX_COUNT = 20_000;
export const CONTINUE_FILE_LIMIT = 1_000_000;
export const ALLOWED_IDS = Object.freeze(["generate-novel", "continue-novel"]);

const GENERATE_KEYS = new Set(["description", "character_setting", "location_scene", "details", "count"]);
const CONTINUE_VALUE_KEYS = new Set([
  "count",
  "plot_direction",
  "character_setting",
  "location_scene",
  "details",
  "continuation_type",
]);
const CLIENT_KEYS = new Set([
  "mode",
  "description",
  "character_setting",
  "location_scene",
  "details",
  "count",
  "source",
  "continuation_type",
]);

const BLOCKED_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;
const MINOR_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b/i;

export function jsonError(error, status, extra = {}) {
  return new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function noteError(text) {
  if (MINOR_NOTE.test(text)) return "不能生成未成年或幼态角色。";
  if (BLOCKED_NOTE.test(text)) return "这里只生成虚构的成年角色。";
  return null;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

export function parseCount(raw, mode) {
  const fallback = mode === "continue" ? CONTINUE_DEFAULT_COUNT : GENERATE_DEFAULT_COUNT;
  const text = clean(raw);
  if (!text) return { ok: true, value: fallback, omitted: true };
  if (!/^\d+$/.test(text)) return { ok: false, error: "字数需要是整数。" };
  const value = Number(text);
  if (mode === "continue") {
    if (value < CONTINUE_MIN_COUNT || value > CONTINUE_MAX_COUNT) {
      return { ok: false, error: `续写字数需要在 ${CONTINUE_MIN_COUNT}–${CONTINUE_MAX_COUNT} 之间。` };
    }
    return { ok: true, value };
  }
  const normalized = value === 0 ? GENERATE_DEFAULT_COUNT : value;
  if (normalized < 1) return { ok: false, error: "字数需要是正整数。" };
  if (normalized > GENERATE_LOCAL_MAX_COUNT) {
    return { ok: false, error: `字数超过本地安全上限 ${GENERATE_LOCAL_MAX_COUNT} 字。` };
  }
  return { ok: true, value: normalized };
}

export function buildNovelPayload(input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!body) return { ok: false, status: 400, error: "请求格式无效。" };
  const unexpected = Object.keys(body).filter(key => !CLIENT_KEYS.has(key));
  if (unexpected.length) return { ok: false, status: 400, error: "不能指定其他接口或额外字段。", code: "field-forbidden" };

  const mode = body.mode === "continue" ? "continue" : body.mode === "new" || body.mode == null || body.mode === "" ? "new" : null;
  if (!mode) return { ok: false, status: 400, error: "写法只能是新写或续写。", code: "field-forbidden" };
  const id = mode === "continue" ? "continue-novel" : "generate-novel";

  const count = parseCount(body.count, mode);
  if (!count.ok) return { ok: false, status: 400, error: count.error };

  const values = {};
  const files = {};
  const texts = [];

  if (mode === "new") {
    const description = clean(body.description);
    if (!description) return { ok: false, status: 400, error: "先写剧情。" };
    values.description = description;
    texts.push(description);
    for (const key of ["character_setting", "location_scene", "details"]) {
      const value = clean(body[key]);
      if (value) {
        values[key] = value;
        texts.push(value);
      }
    }
    values.count = String(count.value);
  } else {
    const source = String(body.source ?? "").replace(/^\uFEFF/, "");
    const trimmed = source.replace(/\s+$/, "").replace(/^\s+/, "");
    if (!trimmed) return { ok: false, status: 400, error: "先贴上已有正文。" };
    const bytes = Buffer.from(trimmed, "utf8");
    if (bytes.includes(0)) return { ok: false, status: 400, error: "文本文件需要是 UTF-8。" };
    if (bytes.length > CONTINUE_FILE_LIMIT) return { ok: false, status: 413, error: "上传的文件太大。" };
    files.file_url = { type: "text/plain; charset=utf-8", data: bytes.toString("base64") };
    texts.push(trimmed);
    for (const key of ["character_setting", "location_scene", "details", "plot_direction"]) {
      const value = clean(body[key]);
      if (value) {
        values[key] = value;
        texts.push(value);
      }
    }
    const continuation = clean(body.continuation_type);
    if (continuation) {
      if (continuation !== "continue_chapter" && continuation !== "new_chapters") {
        return { ok: false, status: 400, error: "续写方式无效。" };
      }
      values.continuation_type = continuation;
    }
    values.count = String(count.value);
  }

  for (const text of texts) {
    const blocked = noteError(text);
    if (blocked) return { ok: false, status: 400, error: blocked };
    if (text.length > 4000 && mode === "new") {
      // description can be long; channel-form slices prompts to 4000. Keep a local cap for optional fields only.
    }
  }

  if (!ALLOWED_IDS.includes(id)) return { ok: false, status: 400, error: "没有这个渠道能力。", code: "id-forbidden" };
  for (const key of Object.keys(values)) {
    const allowed = mode === "new" ? GENERATE_KEYS : CONTINUE_VALUE_KEYS;
    if (!allowed.has(key)) return { ok: false, status: 400, error: "不能指定其他接口或额外字段。", code: "field-forbidden" };
  }

  return { ok: true, id, values, files };
}

function allowedTarget(url) {
  try {
    const parsed = new URL(url);
    const hostOk = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return hostOk && parsed.port === "3477" && parsed.pathname === "/api/channel" && parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function defaultForward(payload, options = {}) {
  const target = options.target || CHANNEL_TARGET;
  if (!allowedTarget(target)) throw new Error("novel-target-forbidden");
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: payload.id, values: payload.values, files: payload.files }),
    signal: AbortSignal.timeout(options.timeoutMs || FORWARD_TIMEOUT_MS),
    redirect: "manual",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const headers = new Headers();
  const type = response.headers.get("content-type") || "application/octet-stream";
  headers.set("Content-Type", type);
  headers.set("Cache-Control", "no-store");
  return new Response(bytes, { status: response.status, headers });
}

export async function handleNovel(request, options = {}) {
  if (request.method !== "POST") return jsonError("请使用 POST。", 405);
  if (!sameOrigin(request)) return jsonError("当前来源不能使用小说接口。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") {
    return jsonError("需要先确认已满 18 岁。", 403, { code: "adult-required" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("请求格式无效。", 400);
  }

  const built = buildNovelPayload(body);
  if (!built.ok) return jsonError(built.error, built.status, built.code ? { code: built.code } : {});

  const forward = options.forward || defaultForward;
  try {
    return await forward({ id: built.id, values: built.values, files: built.files }, options);
  } catch (error) {
    const name = error && typeof error === "object" ? String(error.name || "") : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return jsonError("小说这次等太久了。请再试一次。", 504, { code: "timeout" });
    }
    return jsonError(UNSUPPORTED_MESSAGE, 502, { code: "forward-failed" });
  }
}

export function nodeToWebRequest(req, body, protocol = "http") {
  const url = `${protocol}://${req.headers.host || "127.0.0.1"}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const method = req.method || "GET";
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") init.body = body;
  return new Request(url, init);
}

export async function readNodeBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function sendWebResponse(res, response) {
  const headers = Object.fromEntries(response.headers.entries());
  const bytes = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(bytes);
}

export async function serveNovel(req, res, options = {}) {
  try {
    const path = (req.url || "").split("?")[0];
    if (path !== "/api/novel") return false;
    const body = await readNodeBody(req);
    const request = nodeToWebRequest(req, body);
    const response = await handleNovel(request, options);
    await sendWebResponse(res, response);
    return true;
  } catch {
    const response = jsonError("小说服务暂时不可用。", 500);
    await sendWebResponse(res, response);
    return true;
  }
}
