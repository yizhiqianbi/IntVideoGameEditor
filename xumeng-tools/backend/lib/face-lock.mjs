import { normalizeImage } from "./reference-image.mjs";

const BLOCKED_NOTE = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;

export const ANIME_FACE_PROMPT = [
  "只输出一个 JSON 对象，不要解释。",
  "字段 faceAnime、sceneAnime、bothAdult、realPhoto 必须是布尔值。",
  "第一张是要使用的脸，第二张是要换进去的画面。",
  "faceAnime 仅当第一张是二次元或动漫绘画时为 true。",
  "sceneAnime 仅当第二张是二次元或动漫绘画时为 true。",
  "摄影、写实成片和 cosplay 实拍都不是二次元。",
  "bothAdult 仅当两张图里的角色都已成年时为 true。二次元成年角色即使五官画得偏年轻，也算成年。只有角色明显还是儿童时才为 false。",
  "realPhoto 在任意一张是摄影或写实成片时为 true。",
  "看不清或无法判断时，faceAnime、sceneAnime、bothAdult 为 false，realPhoto 为 true。",
].join("");

export const FACE_LOCK_MESSAGE = "只接受成年二次元画面，摄影或写实成片不能换脸。";
export const FACE_AGE_MESSAGE = "只接受成年二次元角色。";
export const FACE_CLOSED_MESSAGE = "检测没有通过，换脸已锁定。";

export function animeFacePromptAllowed() {
  return !BLOCKED_NOTE.test(ANIME_FACE_PROMPT);
}

const MODEL = "sealion-nova-pro";
const CHECK_HOST = "open-sealion.aiaigirl.com";

function replyText(payload) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : "";
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(part => typeof part?.text === "string" ? part.text : "").join("").trim();
}

async function askImages(env, faceUrl, sceneUrl, fetchImpl) {
  const apiKey = String(env.SEALION_API_KEY || "").trim();
  const baseUrl = String(env.SEALION_BASE_URL || `https://${CHECK_HOST}/v1`).trim().replace(/\/+$/, "");
  if (!apiKey) throw new Error("closed");
  let endpoint;
  try { endpoint = new URL(`${baseUrl}/chat/completions`); } catch { throw new Error("closed"); }
  if (endpoint.protocol !== "https:" || endpoint.hostname !== CHECK_HOST) throw new Error("closed");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: ANIME_FACE_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "第一张是脸，第二张是画面。" },
            { type: "image_url", image_url: { url: faceUrl } },
            { type: "image_url", image_url: { url: sceneUrl } },
          ],
        },
      ],
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(40_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error("closed");
  const text = replyText(payload);
  if (!text) throw new Error("closed");
  return text;
}

export async function readAnimeFaces(face, scene, options = {}) {
  const faceImage = await normalizeImage(face);
  const sceneImage = await normalizeImage(scene);
  const faceUrl = faceImage.ok ? faceImage.dataUrl : "";
  const sceneUrl = sceneImage.ok ? sceneImage.dataUrl : "";
  if (!faceUrl || !sceneUrl) return { ok: false, status: 400, error: faceImage.error || sceneImage.error || "脸和画面都要上传。" };
  try {
    const text = await askImages(options.env || process.env, faceUrl, sceneUrl, options.fetchImpl || fetch);
    const verdict = animeFaceVerdict(text);
    return verdict.ok ? { ok: true, status: 200 } : { ok: false, status: 422, error: verdict.error };
  } catch {
    return { ok: false, status: 422, error: FACE_CLOSED_MESSAGE };
  }
}

export function animeFaceVerdict(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: FACE_CLOSED_MESSAGE };
  let meta;
  try {
    meta = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { ok: false, error: FACE_CLOSED_MESSAGE };
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return { ok: false, error: FACE_CLOSED_MESSAGE };
  if (meta.faceAnime !== true || meta.sceneAnime !== true || meta.realPhoto !== false) {
    return { ok: false, error: FACE_LOCK_MESSAGE };
  }
  if (meta.bothAdult !== true) return { ok: false, error: FACE_AGE_MESSAGE };
  return { ok: true };
}
