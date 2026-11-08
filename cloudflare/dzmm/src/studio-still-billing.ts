import { digest, tokenFrom } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";
import { STUDIO_STILL_CREDITS } from "../../../src/lib/xumeng-studio-still-billing";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TEMPLATE_ID = /^krea2-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SQL_NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const HOLD_MS = 900_000;
const HOLD_LIMIT = 3;

type ChargeRow = { id: string; status: "reserved" | "charged" | "released"; credits: number; claim_hash: string };

function claimToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sessionHash(request: Request, env: Env, user: UserRecord, now: number): Promise<string> {
  const token = tokenFrom(request);
  if (!token) throw new ApiError(401, "登录状态已失效，请重新登录。");
  const hash = digest(token);
  const found = await env.DB.prepare(`SELECT 1 AS ok FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>MAX(?,${SQL_NOW})`).bind(hash, user.id, now).first();
  if (!found) throw new ApiError(401, "登录状态已失效，请重新登录。");
  return hash;
}

function receipt(userId: string, row: ChargeRow, token?: string) {
  return { accountId: userId, reservationId: row.id, status: row.status, credits: row.credits, ...(token ? { claimToken: token } : {}) };
}

async function reserve(request: Request, env: Env, user: UserRecord, now: number): Promise<Response> {
  if (user.isGuest) throw new ApiError(403, "请注册或登录后再出图。");
  const body = await readJson(request, 2000);
  if (Object.keys(body).some(key => key !== "templateId" && key !== "requestId")) throw new ApiError(400, "出图请求参数无效。");
  const templateId = body.templateId;
  const requestId = body.requestId;
  if (typeof templateId !== "string" || !TEMPLATE_ID.test(templateId) || templateId.length > 100
    || typeof requestId !== "string" || !UUID.test(requestId)) throw new ApiError(400, "出图请求参数无效。");
  const hash = await sessionHash(request, env, user, now);
  const id = crypto.randomUUID();
  const token = claimToken();
  const inserted = await env.DB.batch([
    env.DB.prepare(`INSERT INTO studio_still_charges(id,user_id,request_id,template_id,claim_hash,status,credits,created_at,expires_at)
      SELECT ?,u.id,?,?,?,'reserved',?,?,? FROM users u JOIN credit_usage_balances b ON b.user_id=u.id
      WHERE u.id=? AND u.is_guest=0 AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND user_id=u.id AND expires_at>MAX(?,${SQL_NOW}))
      AND b.balance>=? AND (SELECT COUNT(*) FROM studio_still_charges WHERE user_id=u.id AND status='reserved' AND expires_at>?)<?
      ON CONFLICT(user_id,request_id) DO NOTHING`)
      .bind(id, requestId, templateId, digest(token), STUDIO_STILL_CREDITS, now, now + HOLD_MS, user.id, hash, now, STUDIO_STILL_CREDITS, now, HOLD_LIMIT),
    env.DB.prepare("SELECT id,status,credits,claim_hash FROM studio_still_charges WHERE user_id=? AND request_id=?").bind(user.id, requestId),
  ]);
  const row = inserted[1].results[0] as unknown as ChargeRow | undefined;
  if (inserted[0].meta.changes === 1 && row?.id === id) return json(receipt(user.id, row, token), 201);
  if (row) throw new ApiError(409, "这个出图请求已经处理，请重新生成。");
  await sessionHash(request, env, user, now);
  if (user.isGuest) throw new ApiError(403, "请注册或登录后再出图。");
  const wallet = await env.DB.prepare("SELECT balance FROM credit_usage_balances WHERE user_id=?").bind(user.id).first<{ balance: number }>();
  if (!wallet || Number(wallet.balance) < STUDIO_STILL_CREDITS) {
    throw new ApiError(402, `可用 Credit 不足，每次出图需要 ${STUDIO_STILL_CREDITS} Credit。`, { code: "insufficient_credits", requiredCredits: STUDIO_STILL_CREDITS });
  }
  const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM studio_still_charges WHERE user_id=? AND status='reserved' AND expires_at>?`).bind(user.id, now).first<{ n: number }>();
  throw new ApiError(open && open.n >= HOLD_LIMIT ? 429 : 402, open && open.n >= HOLD_LIMIT ? "正在出图的任务过多，请先等待完成。" : `可用 Credit 不足，每次出图需要 ${STUDIO_STILL_CREDITS} Credit。`);
}

async function settle(request: Request, env: Env, user: UserRecord, now: number, id: string, outcome: "charged" | "released"): Promise<Response> {
  if (!UUID.test(id)) throw new ApiError(404, "出图扣费记录不存在。");
  const body = await readJson(request, 2000);
  if (Object.keys(body).some(key => key !== "claimToken") || typeof body.claimToken !== "string" || !/^[a-f0-9]{64}$/.test(body.claimToken)) {
    throw new ApiError(400, "出图请求参数无效。");
  }
  const claim = digest(body.claimToken);
  const updated = await env.DB.prepare(`UPDATE studio_still_charges SET status=?,finalized_at=?
    WHERE id=? AND user_id=? AND claim_hash=? AND status='reserved' AND expires_at>?`)
    .bind(outcome, now, id, user.id, claim, now).run();
  const row = await env.DB.prepare("SELECT id,status,credits,claim_hash FROM studio_still_charges WHERE id=? AND user_id=?").bind(id, user.id).first<ChargeRow>();
  if (!row || row.claim_hash !== claim) throw new ApiError(404, "出图扣费记录不存在。");
  if (updated.meta.changes === 1 || row.status === outcome) return json(receipt(user.id, { ...row, status: outcome, credits: row.credits }));
  throw new ApiError(409, outcome === "charged" ? "这次预留已经失效，没有扣 Credit。" : "这次预留不能再退回。");
}

export async function handleStudioStillBilling(request: Request, env: Env, user: UserRecord, now: number): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/v1/generation/studio-stills") {
    if (request.method !== "POST") throw new ApiError(405, "此接口仅支持POST。");
    return reserve(request, env, user, now);
  }
  const match = /^\/v1\/generation\/studio-stills\/([a-f0-9-]{36})\/(charge|release)$/i.exec(path);
  if (!match) return null;
  if (request.method !== "POST") throw new ApiError(405, "此接口仅支持POST。");
  return settle(request, env, user, now, match[1], match[2] === "charge" ? "charged" : "released");
}
