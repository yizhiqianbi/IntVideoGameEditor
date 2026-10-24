import { digest, tokenFrom } from "./auth";
import { ApiError, json, readJson } from "./http";
import { chatMediaDayKey, chatMediaMembership, chatMediaMinuteLimit, chatMediaOutputBytes,
  chatMediaOutputType, chatMediaUsage, chatMediaWithTimeout, cleanChatMediaText, expireChatMediaPending } from "./chat-media";
import { getXumengSpeechVoice, XUMENG_SPEECH_VOICES } from "../../../src/lib/xumeng-voices";
import type { Env, UserRecord } from "./types";

export const CHARACTER_VOICE_MODEL = "@cf/myshell-ai/melotts";
const LIMIT = 20, MAX_CHARS = 800, TIMEOUT = 90_000;
const SQL_NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export type CharacterVoiceOptions = { now?: () => number; audioTimeoutMs?: number };
type Row = {
  id: string; user_id: string; name: string; source_key: string; source_text: string; source_hash: string; model: string; voice_id?: string;
  status: "pending" | "ready" | "failed"; processing_token: string; object_key: string;
  mime_type: string | null; byte_length: number | null; audio_text_chars: number | null; total_text_chars: number | null;
  created_at: number;
};
export function characterVoiceFingerprint(name: string, sourceKey: string, text: string, voiceId = "melotts"): string {
  const voice = getXumengSpeechVoice(voiceId);
  if (!voice) throw new ApiError(400, "请选择可用的朗读音色。", { code: "invalid_voice_request" });
  // Keep the original serialized default fingerprint so old caches remain usable.
  return digest(JSON.stringify(voice.id === "melotts" ? { name, sourceKey, text, model: CHARACTER_VOICE_MODEL }
    : { name, sourceKey, text, model: voice.model, voiceId: voice.id }));
}
function asset(row: Row) {
  return { id: row.id, name: row.name, sourceKey: row.source_key, sourceHash: row.source_hash, model: row.model, voiceId: row.voice_id ?? "melotts",
    url: `/api/backend/v1/character-voice/assets/${row.id}`, createdAt: row.created_at, mimeType: row.mime_type,
    audioTextChars: row.audio_text_chars, totalTextChars: row.total_text_chars };
}
function matches(object: Pick<R2Object, "size" | "customMetadata">, row: Row) {
  const voice = getXumengSpeechVoice(row.voice_id ?? "melotts");
  return Boolean(voice && row.model === voice.model && characterVoiceFingerprint(row.name, row.source_key, row.source_text, voice.id) === row.source_hash
    && object.size === row.byte_length && object.customMetadata?.ownerId === row.user_id
    && object.customMetadata?.assetId === row.id && object.customMetadata?.sourceHash === row.source_hash);
}
function storageUnavailable() { return new ApiError(503, "朗读素材存储暂时不可用，请稍后重试。", { code: "voice_storage_unavailable" }); }
const enabled = (env: Env) => env.CHAT_MEDIA_ENABLED === "true" && Boolean(env.MEDIA);
async function viduConfigured(env: Env): Promise<boolean> {
  if (!env.VIDU_VOICE) return false;
  try { return await chatMediaWithTimeout(env.VIDU_VOICE.configured(), 5_000) === true; }
  catch { return false; }
}
async function speechVoices(env: Env): Promise<string[]> {
  if (!enabled(env)) return [];
  const vidu = await viduConfigured(env);
  return XUMENG_SPEECH_VOICES.filter(voice => voice.provider === "cloudflare" ? Boolean(env.AI) : vidu).map(voice => voice.id);
}
async function expire(env: Env, owner: string, now: number) {
  await expireChatMediaPending(env, owner, now);
  await env.DB.prepare(`UPDATE character_voice_assets SET status='failed',updated_at=? WHERE user_id=? AND status='pending'
    AND EXISTS(SELECT 1 FROM chat_media_usage WHERE id=character_voice_assets.processing_token AND status='failed')`).bind(now, owner).run();
}
async function invalidate(env: Env, row: Row, now: number) {
  await env.DB.prepare(`UPDATE character_voice_assets SET status='failed',updated_at=?
    WHERE id=? AND user_id=? AND status='ready' AND processing_token=? AND object_key=?`).bind(now, row.id, row.user_id, row.processing_token, row.object_key).run();
}
async function readyResponse(env: Env, row: Row, now: number) {
  let object: R2Object | null;
  try { object = await env.MEDIA!.head(row.object_key); } catch { throw storageUnavailable(); }
  if (!object || !matches(object, row)) {
    await invalidate(env, row, now);
    throw new ApiError(409, "这份朗读已失效，请重新生成。重新生成会使用今日额度。", { code: "voice_asset_unavailable" });
  }
  return json({ accountId: row.user_id, asset: asset(row) });
}
function sessionGuard(request: Request, env: Env, user: UserRecord, now: number) {
  const token = tokenFrom(request);
  if (!token) throw new ApiError(401, "登录状态已失效，请重新登录。");
  const hash = digest(token);
  const valid = () => env.DB.prepare(`SELECT 1 AS ok FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>MAX(?,${SQL_NOW})`)
    .bind(hash, user.id, now).first();
  return { hash, valid };
}
async function generate(request: Request, env: Env, user: UserRecord, now: number, options: CharacterVoiceOptions) {
  const body = await readJson(request, 12_000);
  if (![4, 5].includes(Object.keys(body).length) || Object.keys(body).some(key => !["accountId", "name", "sourceKey", "text", "voiceId"].includes(key))
    || typeof body.accountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.accountId)
    || typeof body.name !== "string" || !body.name.trim() || body.name.length > 120 || /[\u0000-\u001f\u007f]/.test(body.name)
    || typeof body.sourceKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,279}$/.test(body.sourceKey)
    || typeof body.text !== "string" || !body.text.trim() || Array.from(body.text).length > MAX_CHARS || body.text.includes("\0"))
    throw new ApiError(400, "请选择角色并填写 1–800 字的朗读台词。", { code: "invalid_voice_request" });
  const voice = getXumengSpeechVoice(body.voiceId === undefined ? "melotts" : body.voiceId);
  if (!voice) throw new ApiError(400, "请选择可用的朗读音色。", { code: "invalid_voice_request" });
  if (body.accountId !== user.id) throw new ApiError(409, "账户已切换，请刷新后重试。");
  const { hash: sessionHash, valid } = sessionGuard(request, env, user, now);
  if (!await valid()) throw new ApiError(401, "登录状态已失效，请重新登录。");
  const vip = await chatMediaMembership(env, user, now);
  if (user.isGuest || (!vip.active && !vip.adminPreview)) throw new ApiError(403, "角色朗读需要有效 VIP 会员。");
  if (!enabled(env)) throw new ApiError(503, "角色朗读暂未启用。");
  if (voice.provider === "cloudflare" ? !env.AI : !await viduConfigured(env))
    throw new ApiError(503, "所选朗读音色暂未接通，请选择其他可用音色。", { code: "voice_provider_unavailable" });
  const name = body.name.trim(), sourceKey = body.sourceKey, text = body.text, speech = cleanChatMediaText(text);
  if (!speech) throw new ApiError(400, "台词中没有可朗读的正文。");
  const sourceHash = characterVoiceFingerprint(name, sourceKey, text, voice.id);
  await expire(env, user.id, now);
  const lookup = () => env.DB.prepare("SELECT * FROM character_voice_assets WHERE user_id=? AND source_hash=?").bind(user.id, sourceHash).first<Row>();
  const existing = await lookup();
  if (existing?.status === "ready") return readyResponse(env, existing, now);
  if (existing?.status === "pending") throw new ApiError(409, "这段台词正在朗读，请稍后重试。", { retryAfter: 3 });
  await chatMediaMinuteLimit(env, user.id, now);
  const id = existing?.id ?? crypto.randomUUID(), token = crypto.randomUUID(), objectKey = `character-voice/${user.id}/${id}/${token}.audio`;
  const timeout = Math.max(1, Math.min(TIMEOUT, options.audioTimeoutMs ?? TIMEOUT));
  const reserved = await env.DB.batch([
    env.DB.prepare(`INSERT INTO chat_media_usage(id,user_id,asset_id,kind,day_key,status,created_at,expires_at)
      SELECT ?1,?2,?3,'audio',?4,'pending',?5,?6
      WHERE (EXISTS(SELECT 1 FROM users WHERE id=?2 AND is_guest=0 AND role='super') OR
        (SELECT COUNT(*) FROM chat_media_usage WHERE user_id=?2 AND day_key=?4 AND kind='audio' AND status IN ('pending','ready'))<?7)
      AND EXISTS(SELECT 1 FROM users WHERE id=?2 AND is_guest=0 AND (role='super' OR EXISTS(
        SELECT 1 FROM subscription_periods WHERE user_id=?2 AND revoked_at IS NULL AND starts_at<=?5 AND expires_at>?5)))
      AND EXISTS(SELECT 1 FROM sessions WHERE user_id=?2 AND token_hash=?9 AND expires_at>MAX(?5,${SQL_NOW}))
      AND NOT EXISTS(SELECT 1 FROM character_voice_assets WHERE user_id=?2 AND source_hash=?8 AND status IN ('pending','ready'))`)
      .bind(token, user.id, id, chatMediaDayKey(now), now, now + timeout + 30_000, LIMIT, sourceHash, sessionHash),
    env.DB.prepare(`INSERT INTO character_voice_assets(id,user_id,name,source_key,source_text,source_hash,model,status,processing_token,object_key,created_at,updated_at,voice_id)
      SELECT ?1,?2,?3,?4,?5,?6,?7,'pending',?8,?9,?10,?10,?11 WHERE EXISTS(SELECT 1 FROM chat_media_usage WHERE id=?8 AND status='pending')
      ON CONFLICT(user_id,source_hash) DO UPDATE SET status='pending',processing_token=excluded.processing_token,object_key=excluded.object_key,
        created_at=excluded.created_at,updated_at=excluded.updated_at,mime_type=NULL,byte_length=NULL,audio_text_chars=NULL,total_text_chars=NULL
      WHERE character_voice_assets.status='failed'`).bind(id, user.id, name, sourceKey, text, sourceHash, voice.model, token, objectKey, now, voice.id),
  ]);
  if (reserved[0].meta.changes !== 1 || reserved[1].meta.changes !== 1) {
    if (!await valid()) throw new ApiError(401, "登录状态已失效，请重新登录。");
    const winner = await lookup();
    if (winner?.status === "ready") return readyResponse(env, winner, now);
    if (winner?.status === "pending") throw new ApiError(409, "这段台词正在朗读，请稍后重试。", { retryAfter: 3 });
    const rights = await chatMediaMembership(env, user, now);
    if (!rights.active && !rights.adminPreview) throw new ApiError(403, "角色朗读需要有效 VIP 会员。");
    throw new ApiError(429, "今日语音额度已用完，明天再试。", { code: "voice_daily_quota", usage: await chatMediaUsage(env, user.id, now) });
  }
  let putAttempted = false, committed = false;
  try {
    const abort = new AbortController();
    const bytes = await chatMediaWithTimeout((async () => {
      if (voice.provider === "vidu") {
        let output: Awaited<ReturnType<NonNullable<Env["VIDU_VOICE"]>["generate"]>>;
        try { output = await env.VIDU_VOICE!.generate({ text: speech, voiceId: voice.id }); }
        catch { throw new Error("Voice provider failed"); }
        if (!output || !(output.bytes instanceof ArrayBuffer) || !["audio/mpeg", "audio/wav"].includes(output.mimeType)
          || !Number.isFinite(output.providerCredits) || output.providerCredits < 0
          || typeof output.taskId !== "string" || !output.taskId.trim() || output.taskId.length > 128 || /[\u0000-\u001f\u007f]/.test(output.taskId))
          throw new Error("Invalid voice provider result");
        const audio = await chatMediaOutputBytes(output.bytes, "audio", abort.signal);
        if (chatMediaOutputType(audio, "audio") !== output.mimeType) throw new Error("Invalid voice provider MIME");
        return audio;
      }
      const output = await (env.AI as unknown as { run(model: string, input: Record<string, unknown>): Promise<unknown> })
        .run(voice.model, { prompt: speech, lang: "zh" });
      return chatMediaOutputBytes(output, "audio", abort.signal);
    })(), timeout, () => abort.abort());
    const mimeType = chatMediaOutputType(bytes, "audio");
    if (!await valid()) throw new ApiError(401, "登录状态已失效，请重新登录。");
    putAttempted = true;
    await env.MEDIA!.put(objectKey, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { ownerId: user.id, assetId: id, sourceHash } });
    const finishedAt = options.now?.() ?? Date.now();
    const ready = await env.DB.batch([
      env.DB.prepare(`UPDATE character_voice_assets SET status='ready',mime_type=?,byte_length=?,audio_text_chars=?,total_text_chars=?,updated_at=?
        WHERE id=? AND user_id=? AND processing_token=? AND status='pending'
        AND EXISTS(SELECT 1 FROM chat_media_usage WHERE id=? AND user_id=? AND status='pending' AND expires_at>?)
        AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>MAX(?,${SQL_NOW}))
        AND EXISTS(SELECT 1 FROM users WHERE id=? AND is_guest=0 AND (role='super' OR EXISTS(
          SELECT 1 FROM subscription_periods WHERE user_id=? AND revoked_at IS NULL AND starts_at<=? AND expires_at>?)))`)
        .bind(mimeType, bytes.byteLength, Array.from(speech).length, Array.from(text).length, finishedAt, id, user.id, token,
          token, user.id, finishedAt, sessionHash, user.id, finishedAt, user.id, user.id, finishedAt, finishedAt),
      env.DB.prepare(`UPDATE chat_media_usage SET status='ready' WHERE id=? AND user_id=? AND status='pending'
        AND EXISTS(SELECT 1 FROM character_voice_assets WHERE id=? AND processing_token=? AND status='ready')`).bind(token, user.id, id, token),
    ]);
    if (ready[0].meta.changes !== 1 || ready[1].meta.changes !== 1) {
      if (!await valid()) throw new ApiError(401, "登录状态已失效，请重新登录。");
      throw new ApiError(409, "朗读任务或会员状态已失效，请刷新后重试。");
    }
    committed = true;
    const result = await lookup();
    if (!result || result.status !== "ready") throw new ApiError(409, "朗读任务已失效，请重新生成。");
    return json({ accountId: user.id, asset: asset(result) }, 201);
  } catch (error) {
    if (!committed) {
      let safeToDelete = false;
      try {
        const failed = await env.DB.batch([
          env.DB.prepare("UPDATE character_voice_assets SET status='failed',updated_at=? WHERE id=? AND user_id=? AND processing_token=? AND status='pending'")
            .bind(options.now?.() ?? Date.now(), id, user.id, token),
          env.DB.prepare("UPDATE chat_media_usage SET status='failed' WHERE id=? AND user_id=? AND status='pending'").bind(token, user.id),
        ]);
        safeToDelete = failed[0].meta.changes === 1;
      } catch { /* Expiry releases uncertain reservations. */ }
      if (putAttempted && !safeToDelete) {
        try {
          const recovered = await env.DB.prepare("SELECT status,processing_token,object_key FROM character_voice_assets WHERE id=? AND user_id=?").bind(id, user.id).first<Row>();
          safeToDelete = !recovered || recovered.status === "failed" || recovered.processing_token !== token || recovered.object_key !== objectKey;
        } catch { /* A possibly committed private asset must be preserved. */ }
      }
      if (putAttempted && safeToDelete) { try { await env.MEDIA!.delete(objectKey); } catch { /* Private orphan remains inaccessible. */ } }
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "角色朗读生成失败，台词已保留，请稍后重试。");
  }
}
async function getAsset(request: Request, env: Env, user: UserRecord, id: string, now: number) {
  if (!env.MEDIA) throw storageUnavailable();
  const row = await env.DB.prepare("SELECT * FROM character_voice_assets WHERE id=? AND user_id=? AND status='ready'").bind(id, user.id).first<Row>();
  if (!row) throw new ApiError(404, "朗读素材不存在。");
  const range = request.headers.get("Range"), size = row.byte_length!;
  if (range) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range), start = parsed?.[1] ? Number(parsed[1]) : null, end = parsed?.[2] ? Number(parsed[2]) : null;
    if (!parsed || (start === null && end === null) || (start !== null && (!Number.isSafeInteger(start) || start >= size))
      || (end !== null && (!Number.isSafeInteger(end) || (start === null ? end <= 0 : end < start))))
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  let object: R2ObjectBody | null;
  try { object = await env.MEDIA.get(row.object_key, range ? { range: request.headers } : undefined); } catch { throw storageUnavailable(); }
  if (!object || !("body" in object) || !matches(object, row)) {
    await invalidate(env, row, now);
    throw new ApiError(404, "这份朗读已失效，请重新生成。", { code: "voice_asset_unavailable" });
  }
  const headers = new Headers({ "Content-Type": row.mime_type!, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox", "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${id}.${row.mime_type === "audio/wav" ? "wav" : "mp3"}"` });
  if (range && object.range && "offset" in object.range && "length" in object.range) {
    const offset = object.range.offset ?? 0, length = object.range.length ?? object.size;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`); headers.set("Content-Length", String(length));
    return new Response(object.body as unknown as ReadableStream<Uint8Array>, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body as unknown as ReadableStream<Uint8Array>, { headers });
}
export async function handleCharacterVoice(request: Request, env: Env, user: UserRecord, options: CharacterVoiceOptions = {}): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (path !== "/v1/character-voice" && !path.startsWith("/v1/character-voice/")) return null;
  const now = options.now?.() ?? Date.now();
  const guard = sessionGuard(request, env, user, now);
  if (!await guard.valid()) throw new ApiError(401, "登录状态已失效，请重新登录。");
  if (path === "/v1/character-voice/generate") {
    if (request.method !== "POST") throw new ApiError(405, "此接口仅支持 POST。");
    return generate(request, env, user, now, options);
  }
  const found = /^\/v1\/character-voice\/assets\/([A-Za-z0-9_-]{1,128})$/.exec(path);
  if (found) {
    if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
    return getAsset(request, env, user, found[1], now);
  }
  if (path !== "/v1/character-voice") throw new ApiError(404, "角色朗读接口不存在。");
  if (request.method !== "GET") throw new ApiError(405, "此接口仅支持 GET。");
  if (url.search) throw new ApiError(400, "朗读状态请求参数无效。");
  await expire(env, user.id, now);
  const vip = await chatMediaMembership(env, user, now);
  const voices = await speechVoices(env);
  return json({ accountId: user.id, vip, quotaUnlimited: vip.unlimited, enabled: voices.length > 0, speechVoices: voices,
    model: CHARACTER_VOICE_MODEL, limits: { audio: LIMIT, maxVoiceChars: MAX_CHARS }, usage: { audio: (await chatMediaUsage(env, user.id, now)).audio } });
}
