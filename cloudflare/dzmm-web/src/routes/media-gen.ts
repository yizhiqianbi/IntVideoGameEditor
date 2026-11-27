import { AiapiError, runAiapiJob, sniffAiapiBytes } from "../../../../src/lib/aiapi-channel";
import { optimizeAigenPrompt, refineChatScenePrompt } from "../../../../src/lib/xumeng-aigen-prompt";
import { canvasTokenVideoCreditsFor, CHAT_SEGMENT_VIDEO_CREDITS, CHAT_SEGMENT_VIDEO_SECONDS } from "../../../../src/lib/xumeng-canvas-billing";
import { CHAT_CLIP_MODEL } from "../../../../src/lib/xumeng-chat-prompt-format";
import { generateSeedreamFlash } from "../../../../src/lib/xumeng-seedream";
import { STUDIO_STILL_CREDITS } from "../../../../src/lib/xumeng-studio-still-billing";
import { h3Query, h3Upstream } from "../h3-channel";
import { writeH3OfficialPrompt } from "../h3-official-prompt";
import { h3CanvasSize, runH3CanvasVideo, runH3ReferenceVideo } from "../h3-r2v";
import { generateVideoCharacter } from "../video-character";
import { BACKEND_ORIGIN, CANONICAL_ORIGIN, CREATE_MEDIA_ORIGIN, backendHeaders, json, type Env } from "./shared";

const AIAPI_RATIOS = new Set(["9:16", "3:4", "1:1", "4:3", "16:9"]);

async function loadKrea2Poster(request: Request, env: Env, templateId: string): Promise<string> {
  const assetUrl = new URL(`/assets/xumeng/krea2-actions/${templateId}.webp`, request.url);
  const asset = await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }));
  const type = asset.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!asset.ok || type === "text/html") {
    await asset.body?.cancel();
    return "";
  }
  const bytes = new Uint8Array(await asset.arrayBuffer());
  const webp = bytes.byteLength >= 12 && bytes.byteLength <= 200_000
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!webp) return "";
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function reserveStudioStill(request: Request, env: Env, templateId: string): Promise<{ id: string; claimToken: string } | Response> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/generation/studio-stills`, {
    method: "POST",
    headers: backendHeaders(request),
    body: JSON.stringify({ templateId, requestId: crypto.randomUUID() }),
    redirect: "manual",
  }));
  const payload = await upstream.json().catch(() => null) as { error?: unknown; reservationId?: unknown; claimToken?: unknown; credits?: unknown } | null;
  if (upstream.status === 401) return json({ error: "请先登录后再出图。" }, 401);
  if (upstream.status === 403) return json({ error: "请先登录正式账户后再出图。" }, 403);
  if (upstream.status === 402) return json({ error: `可用 Credit 不足，每次出图需要 ${STUDIO_STILL_CREDITS} Credit。`, code: "insufficient_credits" }, 402);
  if (upstream.status === 429) return json({ error: typeof payload?.error === "string" ? payload.error : "正在出图的任务过多，请先等待完成。" }, 429);
  if (!upstream.ok || payload?.credits !== STUDIO_STILL_CREDITS || typeof payload.reservationId !== "string" || typeof payload.claimToken !== "string") {
    return json({ error: "扣费没有完成，这次没有出图。" }, 502);
  }
  return { id: payload.reservationId, claimToken: payload.claimToken };
}

async function settleStudioStill(request: Request, env: Env, hold: { id: string; claimToken: string }, outcome: "charge" | "release"): Promise<boolean> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/generation/studio-stills/${hold.id}/${outcome}`, {
    method: "POST",
    headers: backendHeaders(request),
    body: JSON.stringify({ claimToken: hold.claimToken }),
    redirect: "manual",
  })).catch(() => null);
  if (!upstream?.ok) return false;
  if (outcome === "release") return true;
  const payload = await upstream.json().catch(() => null) as { status?: unknown; credits?: unknown } | null;
  return payload?.status === "charged" && payload.credits === STUDIO_STILL_CREDITS;
}

async function reserveCanvasVideo(request: Request, env: Env, seconds: number): Promise<{ id: string; claimToken: string; credits: number } | Response> {
  let credits = 0;
  try { credits = canvasTokenVideoCreditsFor(seconds, "minimax-h3"); }
  catch { return json({ error: "视频时长需要在 2 到 15 秒之间。" }, 400); }
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/generation/canvas`, {
    method: "POST",
    headers: backendHeaders(request),
    body: JSON.stringify({ kind: "video", requestId: crypto.randomUUID(), seconds, model: "minimax-h3" }),
    redirect: "manual",
  }));
  const payload = await upstream.json().catch(() => null) as { error?: unknown; reservationId?: unknown; claimToken?: unknown; credits?: unknown } | null;
  if (upstream.status === 401) return json({ error: "请先登录后再生成视频。" }, 401);
  if (upstream.status === 403) return json({ error: "请先登录正式账户后再生成视频。" }, 403);
  if (upstream.status === 402) return json({ error: typeof payload?.error === "string" ? payload.error : `可用 Credit 不足，这次视频需要 ${credits} Credit。`, code: "insufficient_credits" }, 402);
  if (upstream.status === 429) return json({ error: typeof payload?.error === "string" ? payload.error : "正在生成的任务过多，请先等待完成。" }, 429);
  if (!upstream.ok || payload?.credits !== credits || typeof payload.reservationId !== "string" || typeof payload.claimToken !== "string") {
    return json({ error: "扣费没有完成，这次没有生成视频。" }, 502);
  }
  return { id: payload.reservationId, claimToken: payload.claimToken, credits };
}

async function reserveChatSegmentVideo(request: Request, env: Env): Promise<{ id: string; claimToken: string; credits: number } | Response> {
  const credits = CHAT_SEGMENT_VIDEO_CREDITS;
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/generation/canvas`, {
    method: "POST",
    headers: backendHeaders(request),
    body: JSON.stringify({ kind: "chat-segment", requestId: crypto.randomUUID() }),
    redirect: "manual",
  }));
  const payload = await upstream.json().catch(() => null) as { error?: unknown; reservationId?: unknown; claimToken?: unknown; credits?: unknown } | null;
  if (upstream.status === 401) return json({ error: "请先登录后再生成视频。" }, 401);
  if (upstream.status === 403) return json({ error: "请先登录正式账户后再生成视频。" }, 403);
  if (upstream.status === 402) return json({ error: typeof payload?.error === "string" ? payload.error : `可用 Credit 不足，这次视频需要 ${credits} Credit。`, code: "insufficient_credits" }, 402);
  if (upstream.status === 429) return json({ error: typeof payload?.error === "string" ? payload.error : "正在生成的任务过多，请先等待完成。" }, 429);
  if (!upstream.ok || payload?.credits !== credits || typeof payload.reservationId !== "string" || typeof payload.claimToken !== "string") {
    return json({ error: "扣费没有完成，这次没有生成视频。" }, 502);
  }
  return { id: payload.reservationId, claimToken: payload.claimToken, credits };
}

async function settleCanvasVideo(request: Request, env: Env, hold: { id: string; claimToken: string; credits: number }, outcome: "charge" | "release"): Promise<boolean> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/generation/canvas/${hold.id}/${outcome}`, {
    method: "POST",
    headers: backendHeaders(request),
    body: JSON.stringify({ claimToken: hold.claimToken }),
    redirect: "manual",
  })).catch(() => null);
  if (!upstream?.ok) return false;
  if (outcome === "release") return true;
  const payload = await upstream.json().catch(() => null) as { status?: unknown; credits?: unknown } | null;
  return payload?.status === "charged" && payload.credits === hold.credits;
}

async function storeAlbumStill(request: Request, env: Env, image: Response): Promise<string | Response> {
  const bytes = await image.arrayBuffer();
  if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: "相册图片不能超过 5 MB，这次没有扣 Credit。" }, 413);
  const headers = backendHeaders(request);
  headers.set("content-type", image.headers.get("Content-Type")?.includes("jpeg") ? "image/jpeg" : image.headers.get("Content-Type")?.includes("webp") ? "image/webp" : "image/png");
  headers.set("x-xumeng-media-purpose", "album");
  const stored = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/media`, {
    method: "POST", headers, body: bytes, redirect: "manual",
  }));
  const payload = await stored.json().catch(() => null) as { error?: unknown; url?: unknown } | null;
  if (!stored.ok || typeof payload?.url !== "string") {
    const message = typeof payload?.error === "string" && payload.error.includes("相册") ? payload.error : "相册保存失败，这次没有扣 Credit。";
    return json({ error: message }, stored.status === 401 || stored.status === 403 || stored.status === 429 ? stored.status : 502);
  }
  return payload.url;
}

function channelFailure(error: unknown): Response {
  const message = error instanceof AiapiError ? error.message : "渠道生成没有完成。";
  const status = error instanceof AiapiError && error.status >= 400 && error.status < 600 ? error.status : 502;
  return json({ error: message }, status);
}

export async function krea2Generate(request: Request, env: Env): Promise<Response> {
  if (env.GENERATION_ENABLED === "false") return json({ error: "图片与视频生成已暂停开放。", code: "generation_paused" }, 503);
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "请求格式无效。" }, 400); }
  const templateId = body && typeof body === "object" && typeof (body as { templateId?: unknown }).templateId === "string"
    ? (body as { templateId: string }).templateId : "";
  const posterTemplate = templateId !== "krea2-free" && /^krea2-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId);
  const templateImage = posterTemplate ? await loadKrea2Poster(request, env, templateId) : "";
  if (posterTemplate && !templateImage) return json({ error: "这个画面模板没有参考图。" }, 502);
  const album = request.headers.get("x-xumeng-album") === "1";
  const hold = await reserveStudioStill(request, env, templateId);
  if (hold instanceof Response) return hold;
  let image: Response;
  try {
    const record = body && typeof body === "object" ? body as { prompt?: unknown; image?: unknown; ratio?: unknown } : {};
    const prompt = typeof record.prompt === "string" ? record.prompt : "";
    const reference = templateImage || (typeof record.image === "string" ? record.image : "");
    const ratio = typeof record.ratio === "string" ? record.ratio : undefined;
    const apiKey = env.WHATSTOKEN_API_KEY?.trim();
    if (!apiKey) throw new Error("出图服务还没接上。");
    const still = await generateSeedreamFlash({ apiKey, prompt, image: reference, ratio });
    image = new Response(still.bytes, { headers: { "Content-Type": still.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    await settleStudioStill(request, env, hold, "release");
    return json({ error: "出图没有完成，这次没有扣 Credit。" }, 502);
  }
  if (!image.ok || !image.headers.get("Content-Type")?.startsWith("image/")) {
    await settleStudioStill(request, env, hold, "release");
    return image;
  }
  if (album) {
    const stored = await storeAlbumStill(request, env, image);
    if (stored instanceof Response) {
      await settleStudioStill(request, env, hold, "release");
      return stored;
    }
    const charged = await settleStudioStill(request, env, hold, "charge");
    if (!charged) {
      await settleStudioStill(request, env, hold, "release");
      return json({ error: "扣费没有完成，这次没有扣 Credit。" }, 502);
    }
    return json({ url: stored, chargedCredits: STUDIO_STILL_CREDITS });
  }
  const charged = await settleStudioStill(request, env, hold, "charge");
  if (!charged) {
    await image.body?.cancel();
    await settleStudioStill(request, env, hold, "release");
    return json({ error: "扣费没有完成，这次没有出图。" }, 502);
  }
  const headers = new Headers(image.headers);
  headers.set("X-Charged-Credits", String(STUDIO_STILL_CREDITS));
  return new Response(image.body, { status: 200, headers });
}

export async function aigenOptimizePrompt(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  if (request.headers.get("x-adult-confirmed") !== "1") return json({ error: "需要先确认已满 18 岁。" }, 403);
  const session = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, { headers: backendHeaders(request), redirect: "manual" }));
  const account = await session.json().catch(() => null) as { user?: { id?: unknown; isGuest?: unknown } } | null;
  if (session.status === 401 || !account?.user || typeof account.user.id !== "string") return json({ error: "请先登录后再优化提示词。" }, 401);
  if (!session.ok) return json({ error: "账户服务暂时不可用。" }, 503);
  if (account.user.isGuest !== false) return json({ error: "请先登录后再优化提示词。" }, 403);
  const limit = await env.CHAT_RATE_LIMITER.limit({ key: `aigen-optimize:${account.user.id}` });
  if (!limit.success) return json({ error: "提示词优化太频繁，请稍后再试。" }, 429);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20_000) return json({ error: "请求格式无效。" }, 400);
  const body = await request.json().catch(() => null) as { text?: unknown; kind?: unknown } | null;
  if (body?.text != null && typeof body.text !== "string") return json({ error: "请求格式无效。" }, 400);
  const kind = body?.kind == null ? "image" : body.kind;
  if (kind !== "image" && kind !== "video") return json({ error: "优化类型无效。" }, 400);
  const result = await optimizeAigenPrompt(typeof body?.text === "string" ? body.text : "", {
    OPENROUTER_API_KEY: env.DZMM_API_KEY,
    OPENROUTER_BASE_URL: env.DZMM_BASE_URL,
    SEALION_API_KEY: env.SEALION_API_KEY,
    SEALION_BASE_URL: env.SEALION_BASE_URL,
  }, kind);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ prompt: result.prompt });
}

export async function videoCharacterApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  const session = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, { headers: backendHeaders(request), redirect: "manual" }));
  const account = await session.json().catch(() => null) as { user?: { id?: unknown; isGuest?: unknown } } | null;
  if (session.status === 401 || !account?.user || typeof account.user.id !== "string") return json({ error: "请先登录后再生成角色卡。" }, 401);
  if (!session.ok) return json({ error: "账户服务暂时不可用。" }, 503);
  if (account.user.isGuest !== false) return json({ error: "请先注册或登录正式账户。" }, 403);
  const limit = await env.CHAT_RATE_LIMITER.limit({ key: `video-card:${account.user.id}` });
  if (!limit.success) return json({ error: "角色卡生成太频繁，请稍后再试。" }, 429);
  const body = await request.json().catch(() => null) as { dramaId?: unknown; title?: unknown; synopsis?: unknown; tags?: unknown; category?: unknown } | null;
  const dramaId = typeof body?.dramaId === "string" ? body.dramaId.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(dramaId)) return json({ error: "缺少短剧编号。" }, 400);
  const existing = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/video-characters/${encodeURIComponent(dramaId)}`, {
    headers: backendHeaders(request), redirect: "manual",
  })).catch(() => null);
  if (existing && existing.ok) {
    const saved = await existing.json().catch(() => null) as { card?: unknown; official?: unknown; dramaId?: unknown } | null;
    if (saved?.card) return json({ card: saved.card, official: true, cached: true, dramaId });
  }
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return json({ error: "缺少短剧信息。" }, 400);
  const synopsis = typeof body?.synopsis === "string" ? body.synopsis.trim().slice(0, 1200) : "";
  const category = typeof body?.category === "string" ? body.category.trim().slice(0, 40) : "";
  const tags = Array.isArray(body?.tags) ? body.tags.filter(tag => typeof tag === "string").slice(0, 10).map(tag => (tag as string).slice(0, 30)) : [];
  try {
    const card = await generateVideoCharacter(env, { title, synopsis, tags, category });
    let official = false;
    const save = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/video-characters`, {
      method: "POST", headers: backendHeaders(request), redirect: "manual",
      body: JSON.stringify({ dramaId, card }),
    })).catch(() => null);
    if (save && (save.ok || save.status === 409)) official = true;
    return json({ card, official, dramaId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "AI 角色卡生成失败，请稍后再试。" }, 502);
  }
}

async function aiapiCaller(request: Request, env: Env): Promise<Response | null> {
  if (env.GENERATION_ENABLED === "false") return json({ error: "图片与视频生成已暂停开放。", code: "generation_paused" }, 503);
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) {
    return json({ error: "当前来源不能使用这条渠道试接。" }, 403);
  }
  const session = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, {
    headers: backendHeaders(request), redirect: "manual",
  }));
  const account = await session.json().catch(() => null) as { user?: { id?: unknown; isGuest?: unknown } } | null;
  if (session.status === 401 || !account?.user || typeof account.user.id !== "string") return json({ error: "请先登录后再使用渠道试接。" }, 401);
  if (!session.ok) return json({ error: "账户服务暂时不可用。" }, 503);
  if (account.user.isGuest !== false) return json({ error: "请先登录正式账户后再使用渠道试接。" }, 403);
  const limit = await env.CHAT_RATE_LIMITER.limit({ key: `aiapi:${account.user.id}` });
  if (!limit.success) return json({ error: "渠道试接请求太频繁，请稍后再试。" }, 429);
  if (!env.AIAPI_BASE_URL || !env.AIAPI_APIKEY || !env.AIAPI_SECRETKEY) return json({ error: "渠道密钥还没配上。" }, 503);
  if (!env.MEDIA) return json({ error: "渠道试接的图片中转还没接上。" }, 503);
  return null;
}

function referenceBytes(raw: unknown): { bytes: Uint8Array; type: string } | Response {
  const value = typeof raw === "string" ? raw : "";
  const trimmed = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value.trim();
  if (trimmed.length < 32 || trimmed.length > 12_000_000 || !/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
    return json({ error: "请先上传参考图。" }, 400);
  }
  let binary: string;
  try { binary = atob(trimmed.replace(/\s/g, "")); } catch { return json({ error: "请先上传参考图。" }, 400); }
  if (binary.length > 8_000_000) return json({ error: "参考图太大。" }, 413);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const type = sniffAiapiBytes(bytes, "image");
  if (!type) return json({ error: "参考图需要是 PNG、JPG 或 WebP。" }, 400);
  return { bytes, type };
}

async function publishChannelImage(env: Env, bytes: Uint8Array, type: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.MEDIA!.put(id, bytes, { httpMetadata: { contentType: type } });
  return `${CREATE_MEDIA_ORIGIN}/api/studio/media/${id}`;
}

export async function aiapiStill(request: Request, env: Env): Promise<Response> {
  const blocked = await aiapiCaller(request, env);
  if (blocked) return blocked;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "请求格式无效。" }, 400); }
  const record = body && typeof body === "object" ? body as { templateId?: unknown; prompt?: unknown; image?: unknown; ratio?: unknown } : {};
  const templateId = typeof record.templateId === "string" ? record.templateId : "";
  if (templateId !== "krea2-free" && !/^krea2-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId)) return json({ error: "没有这个画面模板。" }, 400);
  const ratio = typeof record.ratio === "string" ? record.ratio : "";
  if (!AIAPI_RATIOS.has(ratio)) return json({ error: "画面比例需要是 9:16、3:4、1:1、4:3 或 16:9。" }, 400);
  const prompt = typeof record.prompt === "string" ? record.prompt : "";
  const image = referenceBytes(record.image);
  if (image instanceof Response) return image;
  const hold = await reserveStudioStill(request, env, templateId);
  if (hold instanceof Response) return hold;
  try {
    const hosted = await publishChannelImage(env, image.bytes, image.type);
    const imageUrls = templateId === "krea2-free"
      ? [hosted]
      : [hosted, `${CANONICAL_ORIGIN}/assets/xumeng/krea2-actions/${templateId}.webp`];
    const rendered = await runAiapiJob(
      { baseUrl: env.AIAPI_BASE_URL, apiKey: env.AIAPI_APIKEY, secretKey: env.AIAPI_SECRETKEY },
      { kind: "image", prompt, imageUrls, ratio },
    );
    const charged = await settleStudioStill(request, env, hold, "charge");
    if (!charged) {
      await settleStudioStill(request, env, hold, "release");
      return json({ error: "扣费没有完成，这次没有出图。" }, 502);
    }
    return new Response(rendered.bytes, {
      status: 200,
      headers: {
        "Content-Type": rendered.contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Charged-Credits": String(STUDIO_STILL_CREDITS),
      },
    });
  } catch (error) {
    await settleStudioStill(request, env, hold, "release");
    return channelFailure(error);
  }
}

export async function aiapiVideo(request: Request, env: Env): Promise<Response> {
  const blocked = await aiapiCaller(request, env);
  if (blocked) return blocked;
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "请求格式无效。" }, 400); }
  const record = body && typeof body === "object" ? body as { templateId?: unknown; prompt?: unknown; image?: unknown; ratio?: unknown } : {};
  const templateId = typeof record.templateId === "string" ? record.templateId : "";
  if (!/^h3-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId)) return json({ error: "没有这个动作模板。" }, 400);
  const ratio = typeof record.ratio === "string" && AIAPI_RATIOS.has(record.ratio) ? record.ratio : "9:16";
  const prompt = typeof record.prompt === "string" ? record.prompt : "";
  const image = referenceBytes(record.image);
  if (image instanceof Response) return image;
  const hold = await reserveCanvasVideo(request, env, 8);
  if (hold instanceof Response) return hold;
  try {
    const hosted = await publishChannelImage(env, image.bytes, image.type);
    const rendered = await runAiapiJob(
      { baseUrl: env.AIAPI_BASE_URL, apiKey: env.AIAPI_APIKEY, secretKey: env.AIAPI_SECRETKEY },
      {
        kind: "video",
        prompt,
        imageUrls: [hosted],
        videoUrls: [`${CANONICAL_ORIGIN}/assets/xumeng/h3-actions/${templateId}.mp4`],
        seconds: 8,
        ratio,
      },
    );
    const charged = await settleCanvasVideo(request, env, hold, "charge");
    if (!charged) {
      await settleCanvasVideo(request, env, hold, "release");
      return json({ error: "扣费没有完成，这次没有生成视频。" }, 502);
    }
    return new Response(rendered.bytes, {
      status: 200,
      headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Charged-Credits": String(hold.credits) },
    });
  } catch (error) {
    await settleCanvasVideo(request, env, hold, "release");
    return channelFailure(error);
  }
}

export async function h3CanvasVideo(request: Request, env: Env): Promise<Response> {
  if (env.GENERATION_ENABLED === "false") return json({ error: "图片与视频生成已暂停开放。", code: "generation_paused" }, 503);
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) {
    return json({ error: "当前来源不能使用这条视频通道。" }, 403);
  }
  const session = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, {
    headers: backendHeaders(request), redirect: "manual",
  }));
  const account = await session.json().catch(() => null) as { user?: { id?: unknown; isGuest?: unknown } } | null;
  if (session.status === 401 || !account?.user || typeof account.user.id !== "string") return json({ error: "请先登录后再使用视频通道。" }, 401);
  if (!session.ok) return json({ error: "账户服务暂时不可用。" }, 503);
  if (account.user.isGuest !== false) return json({ error: "请先登录正式账户后再使用视频通道。" }, 403);
  const limit = await env.CHAT_RATE_LIMITER.limit({ key: `h3:${account.user.id}` });
  if (!limit.success) return json({ error: "视频请求太频繁，请稍后再试。" }, 429);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "请求格式无效。" }, 400); }
  const record = body && typeof body === "object"
    ? body as {
      prompt?: unknown;
      image?: unknown;
      ratio?: unknown;
      characterName?: unknown;
      appearance?: unknown;
      scenario?: unknown;
      recentContext?: unknown;
      conversationId?: unknown;
      messageId?: unknown;
    }
    : {};
  const source = typeof record.prompt === "string" ? record.prompt.replace(/\s+/g, " ").trim().slice(0, 1200) : "";
  const characterName = typeof record.characterName === "string"
    ? record.characterName.replace(/[\u0000-\u001f\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40)
    : "";
  const appearance = typeof record.appearance === "string" ? record.appearance.replace(/\s+/g, " ").trim().slice(0, 220) : "";
  const scenario = typeof record.scenario === "string" ? record.scenario.replace(/\s+/g, " ").trim().slice(0, 240) : "";
  const recentContext = typeof record.recentContext === "string" ? record.recentContext.replace(/\s+/g, " ").trim().slice(0, 680) : "";
  const ratio = typeof record.ratio === "string" ? record.ratio : "9:16";
  const frame = h3CanvasSize(ratio);
  if (!frame) return json({ error: "画面比例需要是 9:16、3:4、1:1、4:3 或 16:9。" }, 400);
  const conversationId = typeof record.conversationId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(record.conversationId) ? record.conversationId : "";
  const messageId = typeof record.messageId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(record.messageId) ? record.messageId : "";
  const blockedClip = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;
  if (!source || blockedClip.test(source)) return json({ error: "这一段不能生成视频。" }, 400);
  const characterLabel = `角色·${characterName || "主角"}`;
  const briefParts = [
    `请以 <Picture 1>（${characterLabel}）作为角色身份参考（[reference generation]，不要当成 0.00 秒锁死首帧），自由构图并直出一段 ${CHAT_SEGMENT_VIDEO_SECONDS} 秒单镜头带原声剧情短片。`,
  ];
  if (appearance && !blockedClip.test(appearance)) briefParts.push(`角色固有外貌与穿搭参考（仅本轮未说明衣着时沿用）：${appearance}`);
  if (scenario && !blockedClip.test(scenario)) briefParts.push(`故事场景背景：${scenario}`);
  if (recentContext && !blockedClip.test(recentContext)) briefParts.push(`前情上下文（仅用于延续地点、时间光线与未更换的衣着，不要演旧动作）：${recentContext}`);
  briefParts.push(`本轮剧情（动作表演与原句对白以此为准）：${source}`);
  const directorBrief = briefParts.join("\n").slice(0, 1750);
  const hold = await reserveChatSegmentVideo(request, env);
  if (hold instanceof Response) return hold;
  const video = await runH3CanvasVideo({
    base: env.H3_COMFY_URL ?? "",
    token: env.H3_COMFY_TOKEN ?? "",
    prompt: directorBrief,
    image: typeof record.image === "string" ? record.image : "",
    labels: [characterLabel],
    seconds: CHAT_SEGMENT_VIDEO_SECONDS,
    ratio,
    rewrite: async (rawPrompt, references) => {
      const official = await writeH3OfficialPrompt(env, rawPrompt, references, {
        seconds: CHAT_SEGMENT_VIDEO_SECONDS,
        width: frame.width,
        height: frame.height,
      }).catch(() => null);
      if (official) return official;
      const fallback = await refineChatScenePrompt(source, CHAT_CLIP_MODEL, {
        OPENROUTER_API_KEY: env.DZMM_API_KEY,
        OPENROUTER_BASE_URL: env.DZMM_BASE_URL,
        SEALION_API_KEY: env.SEALION_API_KEY,
        SEALION_BASE_URL: env.SEALION_BASE_URL,
      }, fetch, {
        ...(characterName ? { characterName } : {}),
        ...(appearance ? { appearance } : {}),
        ...(scenario ? { scenario } : {}),
        ...(recentContext ? { recentContext } : {}),
      });
      return fallback.ok ? fallback.prompt : null;
    },
  });
  if (!video.ok) {
    await video.body?.cancel();
    await settleCanvasVideo(request, env, hold, "release");
    return video;
  }
  const charged = await settleCanvasVideo(request, env, hold, "charge");
  if (!charged) {
    await video.body?.cancel();
    await settleCanvasVideo(request, env, hold, "release");
    return json({ error: "扣费没有完成，这次没有生成视频。" }, 502);
  }
  const headers = new Headers(video.headers);
  headers.set("X-Charged-Credits", String(hold.credits));
  headers.set("X-H3-Mode", "ref2va");
  if (conversationId && messageId) {
    const mp4Bytes = await video.arrayBuffer();
    try {
      const saveHeaders = backendHeaders(request);
      saveHeaders.set("Content-Type", "video/mp4");
      saveHeaders.set("X-Conversation-Id", conversationId);
      saveHeaders.set("X-Message-Id", messageId);
      const saved = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/chat-media/video`, {
        method: "POST",
        headers: saveHeaders,
        body: mp4Bytes,
        redirect: "manual",
      }));
      if (saved.ok) {
        const meta = await saved.json().catch(() => null) as { asset?: { id?: string; url?: string } } | null;
        if (meta?.asset?.id && meta?.asset?.url) {
          headers.set("X-Chat-Media-Asset-Id", meta.asset.id);
          headers.set("X-Chat-Media-Asset-Url", meta.asset.url);
        }
      }
    } catch {
      // Never lose a paid video if persistence transiently fails; still stream bytes to client.
    }
    headers.set("Content-Length", String(mp4Bytes.byteLength));
    return new Response(mp4Bytes, { status: video.status, headers });
  }
  return new Response(video.body, { status: video.status, headers });
}

export async function h3ReferenceVideo(request: Request, env: Env): Promise<Response> {
  if (env.GENERATION_ENABLED === "false") return json({ error: "图片与视频生成已暂停开放。", code: "generation_paused" }, 503);
  if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) {
    return json({ error: "当前来源不能使用这条视频通道。" }, 403);
  }
  const session = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, {
    headers: backendHeaders(request), redirect: "manual",
  }));
  const account = await session.json().catch(() => null) as { user?: { id?: unknown; isGuest?: unknown } } | null;
  if (session.status === 401 || !account?.user || typeof account.user.id !== "string") return json({ error: "请先登录后再使用视频通道。" }, 401);
  if (!session.ok) return json({ error: "账户服务暂时不可用。" }, 503);
  if (account.user.isGuest !== false) return json({ error: "请先登录正式账户后再使用视频通道。" }, 403);
  const limit = await env.CHAT_RATE_LIMITER.limit({ key: `h3:${account.user.id}` });
  if (!limit.success) return json({ error: "视频请求太频繁，请稍后再试。" }, 429);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "请求格式无效。" }, 400); }
  const record = body && typeof body === "object" ? body as { templateId?: unknown; prompt?: unknown; image?: unknown } : {};
  const templateId = typeof record.templateId === "string" ? record.templateId : "";
  if (!/^h3-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId)) return json({ error: "没有这个动作模板。" }, 400);
  const asset = await env.ASSETS.fetch(new Request(new URL(`/assets/xumeng/h3-actions/${templateId}.mp4`, request.url), { method: "GET" }));
  if (!asset.ok) { await asset.body?.cancel(); return json({ error: "这个动作模板没有参考视频。" }, 502); }
  const templateVideo = new Uint8Array(await asset.arrayBuffer());
  const hold = await reserveCanvasVideo(request, env, 5);
  if (hold instanceof Response) return hold;
  const video = await runH3ReferenceVideo({
    base: env.H3_COMFY_URL ?? "",
    token: env.H3_COMFY_TOKEN ?? "",
    templateId,
    extra: typeof record.prompt === "string" ? record.prompt : "",
    image: typeof record.image === "string" ? record.image : "",
    templateVideo,
  });
  if (!video.ok) {
    await video.body?.cancel();
    await settleCanvasVideo(request, env, hold, "release");
    return video;
  }
  const charged = await settleCanvasVideo(request, env, hold, "charge");
  if (!charged) {
    await video.body?.cancel();
    await settleCanvasVideo(request, env, hold, "release");
    return json({ error: "扣费没有完成，这次没有生成视频。" }, 502);
  }
  const headers = new Headers(video.headers);
  headers.set("X-Charged-Credits", String(hold.credits));
  return new Response(video.body, { status: video.status, headers });
}

export async function h3Channel(request: Request, env: Env, path: string): Promise<Response> {
  const upstreamPath = h3Upstream(request.method, path);
  const query = h3Query(path, new URL(request.url).search);
  if (!upstreamPath || query === null) return json({ error: "接口不存在。" }, 404);
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) {
    return json({ error: "当前来源不能使用这条视频通道。" }, 403);
  }
  const session = await env.BACKEND.fetch(new Request(`${BACKEND_ORIGIN}/v1/session`, {
    headers: backendHeaders(request), redirect: "manual",
  }));
  const account = await session.json().catch(() => null) as { user?: { id?: unknown; isGuest?: unknown } } | null;
  if (session.status === 401 || !account?.user || typeof account.user.id !== "string") return json({ error: "请先登录后再使用视频通道。" }, 401);
  if (!session.ok) return json({ error: "账户服务暂时不可用。" }, 503);
  if (account.user.isGuest !== false) return json({ error: "请先登录正式账户后再使用视频通道。" }, 403);
  const limit = await env.CHAT_RATE_LIMITER.limit({ key: `h3:${account.user.id}` });
  if (!limit.success) return json({ error: "视频请求太频繁，请稍后再试。" }, 429);
  const base = env.H3_COMFY_URL?.replace(/\/$/, "") ?? "";
  const token = env.H3_COMFY_TOKEN ?? "";
  if (!base.startsWith("https://") || token.length < 32) return json({ error: "视频通道还没有接上。" }, 503);
  const length = Number(request.headers.get("Content-Length") || "0");
  if (length > 52_000_000) return json({ error: "上传内容过大。" }, 413);
  const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: "application/json" });
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);
  let upstream: Response;
  try {
    upstream = await fetch(`${base}${upstreamPath}${query}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(request.method === "GET" ? 20_000 : 300_000),
      ...(request.method === "POST" ? { duplex: "half" as const } : {}),
    });
  } catch {
    return json({ error: "视频通道暂时连不上。" }, 502);
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    return json({ error: "视频通道返回了无效响应。" }, 502);
  }
  const responseHeaders = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
}
