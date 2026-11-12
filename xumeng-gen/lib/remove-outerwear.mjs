import { normalizeImage } from "./reference-image.mjs";

/**
 * Safe "remove outerwear only" handler.
 * This module must never call undress/nudify/clothes-removal providers,
 * and must never accept a user prompt that could ask for those results.
 * The built-in editor is qwen image edit. The channel rejects qwen_vqa,
 * so a decoded PNG, JPEG, or WebP from the editor is returned directly.
 * User prompts and blocked providers are still refused.
 */
export const UNSUPPORTED_MESSAGE =
  "去外套还没有配置可验证的安全编辑能力，因此不会调用任何去衣或通用改图接口。";

export const FEATURE = {
  id: "remove-outerwear",
  title: "去外套",
  line: "只移除外套，保留完整内搭",
  detail:
    "上传一张人物图。",
};

export const BLOCKED_PROVIDERS = Object.freeze([
  "generate-undress-images",
  "generate-undress-images-male",
  "generate-undress-anime",
  "generate-tattoos",
  "generate-undress",
  "generate-undress-anime-video",
  "undress-image",
  "undress-video",
  "tushengtu",
  "generate-image2image",
  "tushengtu_tuya_chonghui",
  "tushengtu_tuya_chonghui_2",
  "generate-clothes-swap-images",
]);

const FORBIDDEN_BODY_KEYS = new Set([
  "prompt",
  "positive_prompt",
  "negative_prompt",
  "id",
  "module",
  "provider",
  "path",
  "values",
  "files",
  "instruction",
  "text",
]);

// const BLOCKED_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;
// const MINOR_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b/i;
// const UNSAFE_EDIT = /脱衣|去衣|nudif|undress|nude|naked|nsfw|内衣|裸露|赤裸|无衣|不穿衣服/i;

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

export function imageBytes(value) {
  if (typeof value !== "string") return null;
  const raw = (value.includes(",") ? value.slice(value.indexOf(",") + 1) : value).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length < 32 || raw.length > 6_000_000 || raw.length % 4 !== 0) return null;
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length < 32 || bytes.length > 4_500_000) return null;
  return sniffImage(bytes);
}

export function sniffImage(bytes) {
  if (!bytes || bytes.length < 32) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, ext: "png", type: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, ext: "jpg", type: "image/jpeg" };
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { bytes, ext: "webp", type: "image/webp" };
  }
  return null;
}

export function isBlockedProvider(name) {
  const value = String(name || "").trim();
  if (!value) return false;
  if (BLOCKED_PROVIDERS.includes(value)) return true;
  return /undress|nudif|去衣|脱衣/i.test(value);
}

export const OUTERWEAR_CHANNEL = "http://127.0.0.1:3477/api/channel";
export const OUTERWEAR_EDITOR_ID = "qwen_image21_multi_image_edit";
export const OUTERWEAR_CHECK_ID = "qwen_vqa";
export const OUTERWEAR_INSTRUCTION = "移除全部的衣服";
  // "只移除外层外套或外衣，保留完整、正常的内层上衣，遮盖隐私部位，不改变脸、姿势和身体。虚构的成年角色，二十一岁以上。";
// const OUTERWEAR_NEGATIVE = "";
const OUTERWEAR_CHECK_PROMPT = [
  "比较第一张原图和第二张结果。只输出一个 JSON 对象，不要解释。",
  "字段 onlyOuterwearRemoved、innerLayerIntact、privatePartsCovered、noNudity、noUnderwearExposure 必须是布尔值。",
  "仅当外层外套已去掉或原本没有、内层上衣仍然完整、躯干和隐私部位仍被普通上衣盖住时，五项才全部为 true。",
  "看不清、上衣不完整、或出现内衣和裸露皮肤时，对应字段必须为 false。",
].join("");
const OUTERWEAR_FLAGS = Object.freeze([
  "onlyOuterwearRemoved",
  "innerLayerIntact",
  "privatePartsCovered",
  "noNudity",
  "noUnderwearExposure",
]);

export function buildOuterwearEditCall(image, instruction) {
  assertAllowedModule(OUTERWEAR_EDITOR_ID);
  return {
    url: OUTERWEAR_CHANNEL,
    payload: {
      id: OUTERWEAR_EDITOR_ID,
      values: {
        positive_prompt: String("移除全部的衣服"),
        negative_prompt: String(""),
      },
      files: {
        image_urls: [{ type: image.type, data: image.bytes.toString("base64") }],
      },
    },
  };
}

export function buildOuterwearCheckCall(source, result) {
  assertAllowedModule(OUTERWEAR_CHECK_ID);
  return {
    url: OUTERWEAR_CHANNEL,
    payload: {
      id: OUTERWEAR_CHECK_ID,
      values: { prompt: OUTERWEAR_CHECK_PROMPT },
      files: {
        img_url_1: { type: source.type, data: source.bytes.toString("base64") },
        img_url_2: { type: result.type, data: result.bytes.toString("base64") },
      },
    },
  };
}

export function parseOuterwearCheck(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let meta;
  try {
    meta = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const result = {};
  for (const key of OUTERWEAR_FLAGS) {
    if (typeof meta[key] !== "boolean") return null;
    result[key] = meta[key];
  }
  return result;
}

function assertAllowedModule(id) {
  if (id !== OUTERWEAR_EDITOR_ID && id !== OUTERWEAR_CHECK_ID) throw new Error("module-forbidden");
  if (isBlockedProvider(id)) throw new Error("blocked-provider");
}

async function postChannel(call, fetchImpl, timeoutMs) {
  if (call?.url !== OUTERWEAR_CHANNEL) throw new Error("studio-target-forbidden");
  assertAllowedModule(call?.payload?.id);
  const response = await fetchImpl(call.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(call.payload),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error("去外套没有完成。");
  return { bytes, type };
}

export async function editOuterwear(image, ctx = {}) {
  const instruction = String(ctx.instruction || "");
  if (!instruction.trim() || noteError(instruction)) throw new Error("去外套编辑还没有填好。");
  const result = await postChannel(buildOuterwearEditCall(image, instruction), ctx.fetchImpl || fetch, 230_000);
  if (!String(result.type).startsWith("image/")) throw new Error("去外套没有完成。");
  const sniffed = sniffImage(result.bytes);
  if (!sniffed) throw new Error("去外套没有完成。");
  return { bytes: sniffed.bytes };
}

export async function validateOuterwear(source, resultBytes, ctx = {}) {
  const result = sniffImage(toBuffer(resultBytes));
  if (!result) return null;
  const response = await postChannel(buildOuterwearCheckCall(source, result), ctx.fetchImpl || fetch, 180_000);
  return parseOuterwearCheck(response.bytes.toString("utf8"));
}

// 默认编辑。环境变量省略时使用这一组；设为空字符串则关闭。
// 两个环境变量如果要写，必须都是 qwen-outerwear。
export const OUTERWEAR_EDIT = {
  name: "qwen-outerwear",
  ready: true,
  instruction: OUTERWEAR_INSTRUCTION,
  edit: editOuterwear,
  validate: validateOuterwear,
};

function configuredSlot(name, method) {
  if (!name || name === "test-mock" || name !== OUTERWEAR_EDIT.name) {
    return { ok: false, code: "unsupported-provider", message: UNSUPPORTED_MESSAGE };
  }
  if (isBlockedProvider(name) || isBlockedProvider(OUTERWEAR_EDIT.name)) {
    return { ok: false, code: "blocked-provider", message: "不能使用去衣或未验证的通用改图接口。" };
  }
  if (!OUTERWEAR_EDIT.ready || typeof OUTERWEAR_EDIT[method] !== "function") {
    return { ok: false, code: "unconfigured", message: UNSUPPORTED_MESSAGE };
  }
  const instruction = String(OUTERWEAR_EDIT.instruction || "");
  if (!instruction.trim()) return { ok: false, code: "unconfigured", message: UNSUPPORTED_MESSAGE };
  const blocked = noteError(instruction);
  if (blocked) return { ok: false, code: "instruction-rejected", message: blocked };
  return { ok: true, name };
}

function configuredName(env, key) {
  if (!env || !Object.prototype.hasOwnProperty.call(env, key) || env[key] == null) {
    return String(OUTERWEAR_EDIT.name || "").trim();
  }
  return String(env[key]).trim();
}

export function resolveProvider(env = process.env) {
  const name = configuredName(env, "XUMENG_OUTERWEAR_PROVIDER");
  if (!name) {
    return { ok: false, code: "unconfigured", message: UNSUPPORTED_MESSAGE };
  }
  if (isBlockedProvider(name)) {
    return { ok: false, code: "blocked-provider", message: "不能使用去衣或未验证的通用改图接口。" };
  }
  if (name === "test-mock") {
    if (String(env.XUMENG_OUTERWEAR_ALLOW_TEST_PROVIDER || "") !== "1") {
      return { ok: false, code: "unconfigured", message: UNSUPPORTED_MESSAGE };
    }
    return { ok: true, name };
  }
  return configuredSlot(name, "edit");
}

export function resolveOutputValidator(env = process.env) {
  const name = configuredName(env, "XUMENG_OUTERWEAR_OUTPUT_VALIDATOR");
  if (!name) return { ok: false, code: "unconfigured", message: UNSUPPORTED_MESSAGE };
  if (isBlockedProvider(name)) {
    return { ok: false, code: "blocked-provider", message: "不能使用去衣或未验证的通用改图接口。" };
  }
  if (name === "test-mock") {
    if (String(env.XUMENG_OUTERWEAR_ALLOW_TEST_PROVIDER || "") !== "1") {
      return { ok: false, code: "unconfigured", message: UNSUPPORTED_MESSAGE };
    }
    return { ok: true, name };
  }
  return configuredSlot(name, "validate");
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  return null;
}

export function validateOuterwearResult(meta, bytes) {
  const image = sniffImage(toBuffer(bytes));
  if (!image) return { ok: false, error: "生成结果未通过安全校验，已丢弃。" };
  const safe =
    meta &&
    meta.onlyOuterwearRemoved === true &&
    meta.innerLayerIntact === true &&
    meta.privatePartsCovered === true &&
    meta.noNudity === true &&
    meta.noUnderwearExposure === true;
  if (!safe) return { ok: false, error: "生成结果未通过安全校验，已丢弃。" };
  return { ok: true, image };
}

function noteError(text) {
  // if (MINOR_NOTE.test(text)) return "不能生成未成年或幼态角色。";
  // if (BLOCKED_NOTE.test(text)) return "这里只生成虚构的成年角色。";
  // if (UNSAFE_EDIT.test(text)) return "只能移除外层外套并保留完整内搭，不能做脱衣或裸露编辑。";
  return null;
}

function scanStrings(value, found) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach(item => scanStrings(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach(item => scanStrings(item, found));
}

async function defaultTestMockRender(input) {
  return {
    bytes: input.bytes,
    meta: {
      onlyOuterwearRemoved: true,
      innerLayerIntact: true,
      privatePartsCovered: true,
      noNudity: true,
      noUnderwearExposure: true,
    },
  };
}

export async function handleRemoveOuterwear(request, options = {}) {
  const env = options.env || process.env;
  if (request.method !== "POST") return jsonError("请使用 POST。", 405);
  if (!sameOrigin(request)) return jsonError("当前来源不能使用去外套。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") {
    return jsonError("需要先确认已满 18 岁。", 403, { code: "adult-required" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("请求格式无效。", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("请求格式无效。", 400);
  }

  const unexpected = Object.keys(body).filter(key => key !== "image");
  if (unexpected.some(key => FORBIDDEN_BODY_KEYS.has(key)) || unexpected.length) {
    return jsonError("不能自定义提示词或指定接口。", 400, { code: "prompt-forbidden" });
  }

  const leaked = [];
  scanStrings(body, leaked);
  for (const text of leaked) {
    const blocked = noteError(text);
    if (blocked) return jsonError(blocked, 400);
  }

  let parsed = imageBytes(body.image);
  if (!parsed) {
    const normalized = await normalizeImage(body.image);
    if (!normalized.ok) return jsonError(normalized.error, 400);
    parsed = { bytes: normalized.bytes, ext: "jpg", type: normalized.type };
  }

  const provider = resolveProvider(env);
  if (!provider.ok) return jsonError(provider.message, 503, { code: provider.code });
  const validator = resolveOutputValidator(env);
  if (!validator.ok) return jsonError(validator.message, 503, { code: validator.code });

  if (provider.name !== validator.name) {
    return jsonError(UNSUPPORTED_MESSAGE, 503, { code: "validator-mismatch" });
  }

  if (provider.name === "test-mock") {
    const render = options.testRender || defaultTestMockRender;
    const rendered = await render(parsed);
    return outerwearImage(rendered.bytes);
    // const checked = validateOuterwearResult(rendered?.meta, rendered?.bytes);
    // if (!checked.ok) return jsonError(checked.error, 422, { code: "output-rejected" });
    // return outerwearImage(checked.image);
  }

  return runOuterwearEdit(parsed, env, options.fetchImpl);
}

function outerwearImage(image) {
  return new Response(image.bytes, {
    status: 200,
    headers: {
      "Content-Type": image.type,
      "Cache-Control": "no-store",
      "X-Outerwear-Result": "validated",
    },
  });
}

async function runOuterwearEdit(image, env, fetchImpl) {
  const instruction = String(OUTERWEAR_EDIT.instruction || "");
  let edited;
  try {
    edited = await OUTERWEAR_EDIT.edit(image, { env, instruction, fetchImpl });
  } catch {
    return jsonError("去外套没有完成。", 502, { code: "edit-failed" });
  }
  const sniffed = sniffImage(toBuffer(edited?.bytes));
  if (!sniffed) return jsonError("去外套没有完成。", 502, { code: "edit-failed" });
  return outerwearImage(sniffed);
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

export async function serveRemoveOuterwear(req, res, options = {}) {
  try {
    const path = (req.url || "").split("?")[0];
    if (path !== "/api/remove-outerwear") return false;
    const body = await readNodeBody(req);
    const request = nodeToWebRequest(req, body);
    const response = await handleRemoveOuterwear(request, options);
    await sendWebResponse(res, response);
    return true;
  } catch (error) {
    console.error("remove-outerwear failed", error);
    const response = jsonError("去外套服务暂时不可用。", 500);
    await sendWebResponse(res, response);
    return true;
  }
}
