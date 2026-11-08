import { RECOMMENDATION_CHARACTER_ID } from "../../../src/lib/xumeng-recommendations";
import {
  normalizeInviteCode,
  type AcquisitionSource, type XumengPoster,
} from "../../../src/lib/xumeng-acquisition";
import { rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

export async function markAcquisitionStarted(env: Pick<Env, "DB">, userId: string, now: number): Promise<void> {
  await env.DB.prepare("UPDATE acquisition_touches SET started_at=? WHERE user_id=? AND started_at IS NULL")
    .bind(now, userId).run();
}

function sourceOf(value: unknown): AcquisitionSource | null {
  if (value === "invite_link" || value === "character_share" || value === "poster") return value;
  return null;
}

function posterOf(value: unknown): XumengPoster | null {
  if (value === "catch" || value === "waiting" || value === "gaze") return value;
  return null;
}

export async function recordAcquisitionTouch(env: Env, user: UserRecord, body: Record<string, unknown>, now = Date.now()): Promise<boolean> {
  const source = sourceOf(body.source);
  if (!source) throw new ApiError(400, "来源无效。");
  const inviteCode = body.inviteCode == null || body.inviteCode === "" ? null : normalizeInviteCode(typeof body.inviteCode === "string" ? body.inviteCode : null);
  if (body.inviteCode != null && body.inviteCode !== "" && !inviteCode) throw new ApiError(400, "邀请码格式不正确。");
  const characterId = source === "character_share" && typeof body.characterId === "string" && RECOMMENDATION_CHARACTER_ID.test(body.characterId)
    ? body.characterId : null;
  const poster = source === "poster" ? posterOf(body.poster) : null;
  if (source === "poster" && !poster) throw new ApiError(400, "海报无效。");
  const inviter = inviteCode
    ? await env.DB.prepare("SELECT id FROM users WHERE referral_code=? AND is_guest=0").bind(inviteCode).first<{ id: string }>()
    : null;
  const inviterId = inviter && inviter.id !== user.id ? inviter.id : null;
  const inserted = await env.DB.prepare(`INSERT INTO acquisition_touches(
      user_id, source, invite_code, inviter_id, character_id, poster, landed_at
    ) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO NOTHING`)
    .bind(user.id, source, inviteCode, inviterId, characterId, poster, now).run();
  return inserted.meta.changes === 1;
}

export async function handleAcquisition(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path !== "/v1/acquisition") return null;
  if (request.method !== "POST") throw new ApiError(405, "来源记录仅支持 POST。");
  await rateLimit(request, env, "acquisition", 30, user.id);
  const recorded = await recordAcquisitionTouch(env, user, await readJson(request, 2048));
  return json({ recorded });
}
