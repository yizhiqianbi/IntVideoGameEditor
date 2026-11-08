import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const DAY = 86400000;
const FEN = 100;
export const EARLY_REBATE_PERCENT = 20;
export const LATER_REBATE_PERCENT = 10;
export const EARLY_WINDOW_DAYS = 10;
export const MIN_EXCHANGE_FEN = FEN;
export const MIN_WITHDRAW_FEN = 10 * FEN;
export const WITHDRAW_INTERVAL_DAYS = 10;
const MAX_FEN = 1_000_000 * FEN;
const ID = /^[a-z]{2}_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

type LedgerRow = { id: string; amount_fen: number; kind: string; note: string; created_at: number };
type WithdrawalRow = { id: string; amount_fen: number; payout_account: string; status: string; created_at: number; updated_at: number };

function wholeYuan(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max || Number(value) % FEN !== 0) {
    throw new ApiError(400, "梦币金额须为整元，并落在允许范围内。");
  }
  return Number(value);
}

function payoutAccount(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "请填写收款账号。");
  const account = value.trim();
  if (account.length < 2 || account.length > 64 || /[\0\r\n]/.test(account)) throw new ApiError(400, "收款账号格式不正确。");
  return account;
}

function rebateFen(amountMinor: number, paidAt: number, invitedAt: number): number {
  const percent = paidAt < invitedAt + EARLY_WINDOW_DAYS * DAY ? EARLY_REBATE_PERCENT : LATER_REBATE_PERCENT;
  return Math.floor(amountMinor * percent / 100);
}

/** One verified RMB payment can create one invite rebate. Replay keeps the first amount. */
export function inviteRebateStatement(
  env: Pick<Env, "DB">,
  inviteeId: string,
  sourceId: string,
  amountMinor: number,
  paidAt: number,
  eventTable: "guagua_events" | "subscription_events",
  eventId: string,
  nonce: string,
): D1PreparedStatement {
  const windowEnd = EARLY_WINDOW_DAYS * DAY;
  return env.DB.prepare(`INSERT INTO dream_coin_ledger(id,user_id,amount_fen,kind,source_type,source_id,note,created_at)
    SELECT ?,e.inviter_id,
      CASE WHEN ? < e.created_at + ? THEN (? * ? / 100) ELSE (? * ? / 100) END,
      'invite_rebate','invite_rebate',?,?,?
    FROM referral_events e JOIN users u ON u.id=e.inviter_id AND u.is_guest=0
    WHERE e.invitee_id=? AND e.inviter_id<>e.invitee_id
      AND CASE WHEN ? < e.created_at + ? THEN (? * ? / 100) ELSE (? * ? / 100) END > 0
      AND EXISTS(SELECT 1 FROM ${eventTable} WHERE event_id=? AND processing_token=?)
    ON CONFLICT(source_type,source_id) DO NOTHING`)
    .bind(`dc_${crypto.randomUUID()}`, paidAt, windowEnd, amountMinor, EARLY_REBATE_PERCENT, amountMinor, LATER_REBATE_PERCENT,
      sourceId, "好友实付返利", paidAt, inviteeId, paidAt, windowEnd, amountMinor, EARLY_REBATE_PERCENT, amountMinor, LATER_REBATE_PERCENT, eventId, nonce);
}

async function balanceFen(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(amount_fen),0) AS fen FROM dream_coin_ledger WHERE user_id=?").bind(userId).first<{ fen: number }>();
  return Number(row?.fen ?? 0);
}

async function snapshot(env: Env, user: UserRecord) {
  const [entries, withdrawals, balance] = await Promise.all([
    env.DB.prepare("SELECT id,amount_fen,kind,note,created_at FROM dream_coin_ledger WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50").bind(user.id).all<LedgerRow>(),
    env.DB.prepare("SELECT id,amount_fen,payout_account,status,created_at,updated_at FROM dream_coin_withdrawals WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20").bind(user.id).all<WithdrawalRow>(),
    balanceFen(env, user.id),
  ]);
  return {
    accountId: user.id, unit: "梦币", yuanPerCoin: 1, creditsPerYuan: FEN, balanceFen: balance,
    earlyRebatePercent: EARLY_REBATE_PERCENT, laterRebatePercent: LATER_REBATE_PERCENT, earlyWindowDays: EARLY_WINDOW_DAYS,
    minExchangeFen: MIN_EXCHANGE_FEN, minWithdrawFen: MIN_WITHDRAW_FEN, withdrawIntervalDays: WITHDRAW_INTERVAL_DAYS,
    entries: entries.results.map(row => ({ id: row.id, amountFen: row.amount_fen, kind: row.kind, note: row.note, createdAt: row.created_at })),
    withdrawals: withdrawals.results.map(row => ({ id: row.id, amountFen: row.amount_fen, payoutAccount: row.payout_account, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })),
  };
}

async function exchange(request: Request, env: Env, user: UserRecord) {
  const body = await readJson(request, 512);
  if (Object.keys(body).some(key => key !== "amountFen")) throw new ApiError(400, "兑换数量只能由本次请求确定。");
  const amount = wholeYuan(body.amountFen, MIN_EXCHANGE_FEN, MAX_FEN);
  await rateLimit(request, env, "dream-exchange-account", 30, user.id);
  const id = `dx_${crypto.randomUUID()}`;
  const now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO dream_coin_ledger(id,user_id,amount_fen,kind,source_type,source_id,note,created_at)
      SELECT ?,id,?,?,?,?,?,? FROM users WHERE id=? AND is_guest=0
      AND (SELECT COALESCE(SUM(amount_fen),0) FROM dream_coin_ledger WHERE user_id=users.id)>=?
      ON CONFLICT(source_type,source_id) DO NOTHING`)
      .bind(`dc_${crypto.randomUUID()}`, -amount, "exchange", "exchange", id, "兑换为 Credit", now, user.id, amount),
    env.DB.prepare(`INSERT INTO dream_coin_exchanges(id,user_id,amount_fen,credits,created_at)
      SELECT source_id,user_id,-amount_fen,-amount_fen,created_at FROM dream_coin_ledger
      WHERE source_type='exchange' AND source_id=? AND user_id=? AND amount_fen=?`)
      .bind(id, user.id, -amount),
  ]);
  if (!results[0].meta.changes || !results[1].meta.changes) throw new ApiError(409, "梦币余额不足，或这笔兑换没有完成。");
  return json({ ...(await snapshot(env, user)), exchangedFen: amount, credited: amount }, 201);
}

async function withdraw(request: Request, env: Env, user: UserRecord) {
  const body = await readJson(request, 1024);
  if (Object.keys(body).some(key => key !== "amountFen" && key !== "payoutAccount")) throw new ApiError(400, "提现只接受金额和收款账号。");
  const amount = wholeYuan(body.amountFen, MIN_WITHDRAW_FEN, MAX_FEN);
  const account = payoutAccount(body.payoutAccount);
  await rateLimit(request, env, "dream-withdraw-account", 10, user.id);
  const id = `dw_${crypto.randomUUID()}`;
  const now = Date.now();
  const earliest = now - WITHDRAW_INTERVAL_DAYS * DAY;
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO dream_coin_withdrawals(id,user_id,amount_fen,payout_account,status,created_at,updated_at)
      SELECT ?,id,?,?, 'pending',?,? FROM users WHERE id=? AND is_guest=0
      AND (SELECT COALESCE(SUM(amount_fen),0) FROM dream_coin_ledger WHERE user_id=users.id)>=?
      AND NOT EXISTS(SELECT 1 FROM dream_coin_withdrawals w WHERE w.user_id=users.id AND w.status='pending')
      AND NOT EXISTS(SELECT 1 FROM dream_coin_withdrawals w WHERE w.user_id=users.id AND w.status='paid' AND w.created_at>?)`)
      .bind(id, amount, account, now, now, user.id, amount, earliest),
    env.DB.prepare(`INSERT INTO dream_coin_ledger(id,user_id,amount_fen,kind,source_type,source_id,note,created_at)
      SELECT ?,user_id,?, 'withdraw_hold','withdraw_hold',id,'提现申请冻结',created_at FROM dream_coin_withdrawals
      WHERE id=? AND user_id=? AND status='pending' ON CONFLICT(source_type,source_id) DO NOTHING`)
      .bind(`dc_${crypto.randomUUID()}`, -amount, id, user.id),
  ]);
  if (!results[0].meta.changes || !results[1].meta.changes) throw new ApiError(409, "余额不足，或已有未完成的提现，或距上次成功提现不足 10 天。");
  return json(await snapshot(env, user), 201);
}

async function settle(env: Env, actor: UserRecord, id: string, request: Request) {
  if (actor.role !== "super") throw new ApiError(403, "只有管理员可以确认提现结果。");
  if (!ID.test(id)) throw new ApiError(404, "提现记录不存在。");
  const body = await readJson(request, 256);
  if (body.status !== "paid" && body.status !== "rejected") throw new ApiError(400, "请确认打款或退回。");
  const now = Date.now();
  if (body.status === "paid") {
    const updated = await env.DB.prepare("UPDATE dream_coin_withdrawals SET status='paid',updated_at=? WHERE id=? AND status='pending'").bind(now, id).run();
    if (!updated.meta.changes) throw new ApiError(409, "这笔提现已经处理过。");
    return json({ id, status: "paid" });
  }
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE dream_coin_withdrawals SET status='rejected',updated_at=? WHERE id=? AND status='pending'").bind(now, id),
    env.DB.prepare(`INSERT INTO dream_coin_ledger(id,user_id,amount_fen,kind,source_type,source_id,note,created_at)
      SELECT ?,user_id,amount_fen,'withdraw_release','withdraw_release',id,'提现退回',? FROM dream_coin_withdrawals
      WHERE id=? AND status='rejected' ON CONFLICT(source_type,source_id) DO NOTHING`)
      .bind(`dc_${crypto.randomUUID()}`, now, id),
  ]);
  if (!results[0].meta.changes || !results[1].meta.changes) throw new ApiError(409, "这笔提现已经处理过。");
  return json({ id, status: "rejected" });
}

export async function handleDreamCoin(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const settlement = /^\/v1\/dream-coin\/withdrawals\/([^/]+)$/.exec(path);
  if (path !== "/v1/dream-coin" && path !== "/v1/dream-coin/exchange" && path !== "/v1/dream-coin/withdrawals" && !settlement) return null;
  if (settlement) {
    if (request.method !== "POST") throw new ApiError(405, "确认提现仅支持 POST。");
    return settle(env, user, settlement[1], request);
  }
  if (user.isGuest) throw new ApiError(403, "请先注册或登录，再使用梦币。");
  if (path === "/v1/dream-coin") {
    if (request.method !== "GET") throw new ApiError(405, "梦币记录仅支持 GET。");
    return json(await snapshot(env, user));
  }
  if (request.method !== "POST") throw new ApiError(405, "梦币变更仅支持 POST。");
  return path.endsWith("/exchange") ? exchange(request, env, user) : withdraw(request, env, user);
}

export const dreamCoinRebatePreview = rebateFen;
