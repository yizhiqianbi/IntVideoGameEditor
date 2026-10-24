import { digest, requireUser, tokenFrom } from "./auth";
import { ApiError } from "./http";
import type { Env, UserRecord } from "./types";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const PRICE_REVISION = 1 as const;
const CREDITS = 2 as const;
const TTL = 600_000;
const SQL_NOW = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";

export type CompanionReceiptRow = {
  id: string; user_id: string; request_id: string; session_id: string;
  price_revision: number; credits_per_message: number; reserved_credits: number;
  status: "reserved" | "settled" | "released"; charged_credits: number;
  outcome: "completed" | "failed" | "expired" | null; created_at: number;
  expires_at: number; finalized_at: number | null;
};

function validInput(input: unknown): asserts input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "女友聊天计费请求格式无效。");
}
function receipt(row: CompanionReceiptRow) {
  return {
    id: row.id, accountId: row.user_id, requestId: row.request_id, sessionId: row.session_id,
    status: row.status, priceRevision: 1 as const, creditsPerMessage: 2 as const,
    reservedCredits: row.reserved_credits, chargedCredits: row.charged_credits,
    returnedCredits: row.status === "reserved" ? 0 : row.reserved_credits - row.charged_credits,
    billingExempt: false as const, createdAt: row.created_at, expiresAt: row.expires_at,
    finalizedAt: row.finalized_at, outcome: row.outcome,
  };
}
function assertClaim(input: unknown): asserts input is { accountId: string; reservationId: string; claimToken: string } {
  validInput(input);
  if (Object.keys(input).some(key => !["accountId", "reservationId", "claimToken", "outcome"].includes(key))
    || typeof input.accountId !== "string" || !UUID.test(input.accountId)
    || typeof input.reservationId !== "string" || !UUID.test(input.reservationId)
    || typeof input.claimToken !== "string" || !UUID.test(input.claimToken))
    throw new ApiError(400, "女友聊天结算授权无效。");
}

export function companionBillingEnabled(env: Env) {
  return env.COMPANION_BILLING_ENABLED === "true";
}

async function expire(env: Env, userId: string | null, limit = 50) {
  const nonce = crypto.randomUUID();
  const predicate = userId ? "AND user_id=?" : "";
  const bindings = userId ? [Date.now(), nonce, userId, limit] : [Date.now(), nonce, limit];
  await env.DB.batch([
    env.DB.prepare(`UPDATE companion_turn_requests SET status='released', outcome='expired', finalized_at=MAX(?,${SQL_NOW}), processing_token=?
      WHERE id IN (SELECT id FROM companion_turn_requests WHERE status='reserved' AND expires_at<=${SQL_NOW} ${predicate} ORDER BY expires_at,id LIMIT ?)`)
      .bind(...bindings),
    env.DB.prepare(`INSERT INTO companion_turn_ledger(reservation_id,user_id,kind,credits,outcome,created_at)
      SELECT id,user_id,'release',0,'expired',finalized_at FROM companion_turn_requests WHERE processing_token=? AND status='released'
      ON CONFLICT(reservation_id) DO NOTHING`).bind(nonce),
  ]);
}

export async function companionReserve(env: Env, input: unknown) {
  validInput(input);
  if (Object.keys(input).some(key => !["sessionToken", "accountId", "requestId", "sessionId", "requestFingerprint"].includes(key))
    || typeof input.sessionToken !== "string" || !/^[a-f0-9]{64}$/.test(input.sessionToken)
    || typeof input.accountId !== "string" || !UUID.test(input.accountId)
    || typeof input.requestId !== "string" || !UUID.test(input.requestId)
    || typeof input.sessionId !== "string" || !UUID.test(input.sessionId)
    || typeof input.requestFingerprint !== "string" || !SHA256.test(input.requestFingerprint))
    throw new ApiError(400, "女友聊天计费请求无效。");
  if (!companionBillingEnabled(env)) throw new ApiError(503, "女友聊天付费功能尚未开放。");
  const request = new Request("https://billing.internal/v1/companion", { headers: { Cookie: `qingyu_session=${input.sessionToken}` } });
  const user = await requireUser(request, env);
  if (user.id !== input.accountId || user.isGuest) throw new ApiError(401, "账户已切换，请重新登录。");
  await expire(env, user.id);
  const id = crypto.randomUUID(), claimToken = crypto.randomUUID(), now = Date.now();
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO companion_turn_requests(id,user_id,request_id,session_id,request_fingerprint,price_revision,credits_per_message,reserved_credits,authorization_hash,processing_token,created_at,expires_at)
      SELECT ?,u.id,?,?,?,?,2,2,?,?,?,? FROM users u JOIN credit_usage_balances b ON b.user_id=u.id
      WHERE u.id=? AND u.is_guest=0 AND b.balance>=2 AND EXISTS(SELECT 1 FROM sessions WHERE user_id=u.id AND token_hash=? AND expires_at>MAX(?,${SQL_NOW}))
      ON CONFLICT(user_id,request_id) DO NOTHING`)
      .bind(id, input.requestId.toLowerCase(), input.sessionId.toLowerCase(), input.requestFingerprint, PRICE_REVISION,
        digest(claimToken), crypto.randomUUID(), now, now + TTL, user.id, digest(input.sessionToken), now),
    env.DB.prepare("SELECT * FROM companion_turn_requests WHERE user_id=? AND request_id=?").bind(user.id, input.requestId.toLowerCase()),
    env.DB.prepare("SELECT balance,reserved_credits FROM credit_usage_balances WHERE user_id=?").bind(user.id),
  ]);
  const row = result[1].results[0] as unknown as CompanionReceiptRow | undefined;
  if (!row) {
    const wallet = result[2].results[0] as { balance: number } | undefined;
    throw new ApiError(402, `当前可用 ${wallet?.balance ?? 0} Credit，本次需要 2 Credit。`, { code: "insufficient_credits", availableCredits: wallet?.balance ?? 0, requiredCredits: 2 });
  }
  const created = row.id === id;
  return { enabled: true as const, created, receipt: receipt(row), ...(created ? { claimToken } : {}) };
}

export async function companionFinalize(env: Env, input: unknown) {
  assertClaim(input);
  const outcome = (input as any).outcome;
  if (outcome !== "completed" && outcome !== "failed") throw new ApiError(400, "结算结果无效。");
  const hash = digest(input.claimToken), nonce = crypto.randomUUID(), now = Date.now();
  const status = outcome === "completed" ? "settled" : "released";
  const charged = outcome === "completed" ? 2 : 0;
  await env.DB.batch([
    env.DB.prepare(`UPDATE companion_turn_requests SET status=?,charged_credits=?,outcome=?,finalized_at=MAX(?,${SQL_NOW}),processing_token=?
      WHERE id=? AND user_id=? AND authorization_hash=? AND status='reserved' AND expires_at>MAX(?,${SQL_NOW})`)
      .bind(status, charged, outcome, now, nonce, input.reservationId, input.accountId, hash, now),
    env.DB.prepare(`INSERT INTO companion_turn_ledger(reservation_id,user_id,kind,credits,outcome,created_at)
      SELECT id,user_id,CASE WHEN status='settled' THEN 'charge' ELSE 'release' END,CASE WHEN status='settled' THEN -2 ELSE 0 END,outcome,finalized_at
      FROM companion_turn_requests WHERE id=? AND user_id=? AND processing_token=? ON CONFLICT(reservation_id) DO NOTHING`)
      .bind(input.reservationId, input.accountId, nonce),
  ]);
  const row = await env.DB.prepare("SELECT * FROM companion_turn_requests WHERE id=? AND user_id=? AND authorization_hash=?")
    .bind(input.reservationId, input.accountId, hash).first<CompanionReceiptRow>();
  if (!row) throw new ApiError(404, "女友聊天结算请求不存在。");
  if (row.status !== status || row.outcome !== outcome) throw new ApiError(409, "这条聊天请求已经结算，不能重复修改。", { receipt: receipt(row) });
  return { receipt: receipt(row) };
}

export async function companionGet(env: Env, input: unknown) {
  assertClaim(input);
  const row = await env.DB.prepare("SELECT * FROM companion_turn_requests WHERE id=? AND user_id=? AND authorization_hash=?")
    .bind(input.reservationId, input.accountId, digest(input.claimToken)).first<CompanionReceiptRow>();
  if (!row) throw new ApiError(404, "女友聊天结算请求不存在。");
  return { receipt: receipt(row) };
}

export async function companionOverview(env: Env, request: Request, user: UserRecord) {
  if (user.isGuest) throw new ApiError(403, "请登录正式账户查看女友聊天 Credit。");
  await expire(env, user.id);
  const results = await env.DB.batch([
    env.DB.prepare("SELECT balance,reserved_credits FROM credit_usage_balances WHERE user_id=?").bind(user.id),
    env.DB.prepare("SELECT * FROM companion_turn_requests WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20").bind(user.id),
  ]);
  const wallet = results[0].results[0] as { balance: number; reserved_credits: number } | undefined;
  if (!wallet) throw new ApiError(401, "账户已失效，请重新登录。");
  return { enabled: companionBillingEnabled(env), priceRevision: 1 as const, creditsPerMessage: 2 as const,
    balance: wallet.balance, reservedCredits: wallet.reserved_credits,
    receipts: (results[1].results as unknown as CompanionReceiptRow[]).map(receipt) };
}

export async function companionReleaseExpired(env: Env, limit = 50) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new ApiError(400, "清理数量无效。");
  const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM companion_turn_requests WHERE status='reserved' AND expires_at<=?").bind(Date.now()).first<{ n: number }>();
  await expire(env, null, limit);
  return { released: before?.n ?? 0 };
}
