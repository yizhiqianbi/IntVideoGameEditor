import { generateSeedreamFlash } from "../../../src/lib/xumeng-seedream";

/** Native ports of the studio lab tools: prompt polish, outerwear removal and
 * the illustration face pass. They share the worker's existing provider keys
 * instead of the retired Vercel studio endpoints. */
export interface StudioLabEnv {
  SEALION_API_KEY?: string;
  SEALION_BASE_URL?: string;
  GLM_API_KEY?: string;
  GLM_BASE_URL?: string;
  DZMM_API_KEY?: string;
  DZMM_BASE_URL?: string;
  WHATSTOKEN_API_KEY?: string;
}

type Kind = "image" | "video" | "story" | "character";

const SEALION_HOST = "open-sealion.aiaigirl.com";
const SEALION_MODEL = "sealion-nova-pro";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const BLOCKED = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;

const SYSTEMS: Record<Kind, string> = {
  image: "你是生图提示词编辑。把用户的想法写成一条中文画面描述，让生图模型能按句执行。只输出提示词，不要解释，不要加引号。固定用五行，每行一句：主体：画面里的人或物，人物是虚构的成年人，写清性别、体态和衣着。动作：正在发生的身体接触，用直接说法。身体：只写画面里在场的人的性器官。画面：构图、景别和背景。光线：光线和质感。不要写未成年、幼态、校服、学生、真实人物或明星。总长度不超过 600 字。",
  video: "你是图生视频提示词编辑。把用户的想法改成一条中文分镜，让视频模型能按句执行。只输出提示词，不要解释，不要加引号。固定用六行，每行一句：人物、动作、身体、镜头、场景、声音。人物是虚构的成年人，动作按时间写清楚，身体只写画面里在场的人的性器官。不要写未成年、幼态、校服、学生、真实人物或明星。总长度不超过 600 字。",
  story: "你是小说情节编辑。把用户的想法写成一段给小说模型用的故事描述。只输出描述，不要解释，不要加引号。固定用四行：人物、场景、情节、走向。人物是虚构的成年人，情节用直接说法。不要写未成年、幼态、校服、学生、真实人物或明星。总长度不超过 600 字。",
  character: "你是小说人物设定编辑。把用户的想法写成给小说模型用的人物设定。只输出设定，不要解释，不要加引号。固定用四行：身份、外貌、性格、关系。人物是虚构的成年人。不要写未成年、幼态、校服、学生、真实人物或明星。总长度不超过 600 字。",
};

const COAT_PROMPT = "把人物身上最外层的衣物去掉，露出下面的肌肤；保持同一张脸、发型、表情、姿势、体型、背景、光线和画风完全不变，不改变镜头，不新增人物，不出现文字或水印。所有人物均为自愿成年人。";
const FACE_PROMPT = "把人物的脸重新绘制成更精致的二次元插画脸：保留五官比例、神态和发型辨识度，肤色与光线保持一致；身体、姿势、服装和背景保持不变，不要换成另一个人，不出现文字或水印。所有人物均为自愿成年人。";

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function decodeImage(value: unknown): { bytes: Uint8Array; mime: string } | null {
  if (typeof value !== "string" || value.length < 64) return null;
  const raw = (value.includes(",") ? value.slice(value.indexOf(",") + 1) : value).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) return null;
  if (raw.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) return null;
  let binary: string;
  try { binary = atob(raw); } catch { return null; }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.length < 64 || bytes.length > MAX_IMAGE_BYTES) return null;
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png"
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg"
    : bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP" ? "image/webp"
    : "";
  return mime ? { bytes, mime } : null;
}

function dataUrl(image: { bytes: Uint8Array; mime: string }): string {
  let binary = "";
  for (let offset = 0; offset < image.bytes.length; offset += 0x8000) binary += String.fromCharCode(...image.bytes.subarray(offset, offset + 0x8000));
  return `data:${image.mime};base64,${btoa(binary)}`;
}

type Provider = { label: string; url: string; key: string; model: string };

/** The studio's old sealion key is dead, so the editor walks the providers the
 * worker already holds and keeps the first answer that looks like a prompt. */
function providers(env: StudioLabEnv): Provider[] {
  const list: Provider[] = [];
  const sealion = env.SEALION_API_KEY?.trim();
  if (sealion) {
    try {
      const base = new URL(env.SEALION_BASE_URL?.trim() || `https://${SEALION_HOST}/v1`);
      if (base.protocol === "https:" && base.hostname === SEALION_HOST) list.push({ label: "sealion", url: `${base.href.replace(/\/+$/, "")}/chat/completions`, key: sealion, model: SEALION_MODEL });
    } catch { /* ignore a broken sealion base */ }
  }
  const glm = env.GLM_API_KEY?.trim();
  if (glm) list.push({ label: "glm", url: `${(env.GLM_BASE_URL?.trim() || "https://8888ai.cc.cd/v1").replace(/\/+$/, "")}/chat/completions`, key: glm, model: "glm-5.2" });
  const openrouter = env.DZMM_API_KEY?.trim();
  if (openrouter) list.push({ label: "openrouter", url: `${(env.DZMM_BASE_URL?.trim() || "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/chat/completions`, key: openrouter, model: "x-ai/grok-4.7" });
  return list;
}

async function polish(body: Record<string, unknown>, env: StudioLabEnv): Promise<Response> {
  const kind: Kind = body.kind === "character" || body.kind === "story" || body.kind === "image" ? body.kind : "video";
  const source = (typeof body.text === "string" ? body.text : "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
  if (BLOCKED.test(source)) return json({ error: "不能优化这段描述。" }, 400);
  const chain = providers(env);
  if (!chain.length) return json({ error: "提示词优化还没配上。" }, 503);
  for (const provider of chain) {
    try {
      const response = await fetch(provider.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.key}` },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: SYSTEMS[kind] },
            { role: "user", content: source ? `用户原句：${source}` : "用户还没有写内容，写一段虚构的成年人场景。" },
          ],
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.warn("lab_optimize_provider_failed", { provider: provider.label, status: response.status, detail: detail.slice(0, 160) });
        continue;
      }
      const payload = await response.json().catch(() => null) as { choices?: { message?: { content?: unknown } }[] } | null;
      const reply = payload?.choices?.[0]?.message?.content;
      const prompt = typeof reply === "string" ? reply.replace(/^["'“”\s]+|["'“”\s]+$/g, "").slice(0, 800) : "";
      if (prompt.length < 5 || BLOCKED.test(prompt)) continue;
      return json({ prompt });
    } catch (error) {
      console.warn("lab_optimize_provider_error", { provider: provider.label, error: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
    }
  }
  return json({ error: "提示词没有优化完。" }, 502);
}

async function edit(body: Record<string, unknown>, env: StudioLabEnv, kind: "coat" | "face"): Promise<Response> {
  const apiKey = env.WHATSTOKEN_API_KEY?.trim();
  if (!apiKey) return json({ error: "出图服务还没接上。" }, 503);
  const image = decodeImage(body.image);
  if (!image) return json({ error: "先上传一张 JPG、PNG 或 WebP 图片。" }, 400);
  const written = typeof body.prompt === "string" ? body.prompt.replace(/\s+/g, " ").trim().slice(0, 600) : "";
  if (written && BLOCKED.test(written)) return json({ error: "这段描述不能使用。" }, 400);
  const prompt = written ? `${written}。保持同一张脸、发型、姿势、体型、背景和光线不变。所有人物均为自愿成年人。` : kind === "coat" ? COAT_PROMPT : FACE_PROMPT;
  try {
    const still = await generateSeedreamFlash({ apiKey, prompt, image: dataUrl(image), ratio: "3:4" });
    return new Response(still.bytes, {
      status: 200,
      headers: { "Content-Type": still.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    const message = error instanceof Error && /timeout|aborted/i.test(error.message) ? "这次等太久了，请再试一次。" : (error instanceof Error && error.message ? error.message : "没有完成，请再试一次。");
    return json({ error: message }, 502);
  }
}

export async function handleStudioLab(request: Request, env: StudioLabEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/lab/")) return null;
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "请求格式无效。" }, 400);
    body = parsed as Record<string, unknown>;
  } catch { return json({ error: "请求格式无效。" }, 400); }
  if (path === "/api/lab/optimize-prompt") return polish(body, env);
  if (path === "/api/lab/coat" || path === "/api/lab/face") {
    if (request.headers.get("x-adult-confirmed") !== "1") return json({ error: "需要先确认已满 18 岁。" }, 403);
    return edit(body, env, path === "/api/lab/coat" ? "coat" : "face");
  }
  return json({ error: "接口不存在。" }, 404);
}
