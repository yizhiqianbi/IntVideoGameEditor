import { requireUser } from "./auth";
import { creditUsageBalanceStatement, creditUsageReceipt, superUsageReceipt, publicCreditBillingConfig } from "./credit-usage";
import { ApiError, json } from "./http";
import type { Env, UserRecord } from "./types";

export async function handleBillingApi(request: Request, env: Env, suppliedUser?: UserRecord | null): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (path !== "/v1/billing/config" && path !== "/v1/billing/usage") return null;
  if (request.method !== "GET") throw new ApiError(405, "计费查询仅支持 GET。");
  if (path === "/v1/billing/config") return json(publicCreditBillingConfig(env));
  const user = suppliedUser ?? await requireUser(request, env);
  if (user.isGuest) throw new ApiError(403, "请登录正式账户查看 Credit 消费记录。");
  if ([...url.searchParams.keys()].some(key => key !== "limit" && key !== "cursor")) throw new ApiError(400, "消费记录查询参数无效。");
  const sourceLimit = url.searchParams.get("limit") ?? "20", limit = Number(sourceLimit);
  if (!/^\d{1,2}$/.test(sourceLimit) || limit < 1 || limit > 50) throw new ApiError(400, "每页记录数量应在 1 至 50 之间。");
  const cursor = url.searchParams.get("cursor");
  let createdAt: number | null = null, id: string | null = null;
  if (cursor) {
    try {
      if (cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("invalid cursor");
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || parsed[0] < 0
        || typeof parsed[1] !== "string" || !/^usage_[a-f0-9-]{36}$/.test(parsed[1])) throw new Error("invalid cursor");
      [createdAt, id] = parsed;
    } catch { throw new ApiError(400, "消费记录分页位置无效。"); }
  }
  const pageQuery = `SELECT * FROM (SELECT id,created_at,0 AS exempt FROM credit_usage_requests WHERE user_id=? UNION ALL
      SELECT id,created_at,1 FROM super_generation_usage WHERE user_id=?) WHERE (? IS NULL OR created_at<? OR (created_at=? AND id<?))
      ORDER BY created_at DESC,id DESC LIMIT ?`;
  const pageBindings = [user.id, user.id, createdAt, createdAt, createdAt, id, limit + 1];
  // D1 batches share one transaction. Read totals, page references and receipt
  // facts together so a concurrent settlement cannot split this response.
  const results = await env.DB.batch([
    creditUsageBalanceStatement(env, user.id),
    env.DB.prepare(pageQuery).bind(...pageBindings),
    env.DB.prepare(`WITH usage_page AS (${pageQuery}) SELECT * FROM credit_usage_requests
      WHERE user_id=? AND id IN (SELECT id FROM usage_page WHERE exempt=0)`).bind(...pageBindings, user.id),
    env.DB.prepare(`WITH usage_page AS (${pageQuery}) SELECT * FROM super_generation_usage
      WHERE user_id=? AND id IN (SELECT id FROM usage_page WHERE exempt=1)`).bind(...pageBindings, user.id),
  ]);
  const balance = results[0].results[0] as { balance: number; reserved_credits: number; total_spent: number; debt_credits: number } | undefined;
  if (!balance) throw new ApiError(401, "账户已失效，请重新登录。");
  if ([balance.balance, balance.reserved_credits, balance.total_spent, balance.debt_credits].some(value => !Number.isSafeInteger(value) || value < 0))
    throw new ApiError(503, "钱包余额需要核对，请联系管理员。");
  const refs = results[1].results.slice(0, limit) as { id: string; created_at: number; exempt: number }[], last = refs.at(-1);
  type ReceiptRow = Parameters<typeof creditUsageReceipt>[0];
  const ordinaryRows = new Map((results[2].results as unknown as ReceiptRow[]).map(row => [row.id, row]));
  const exemptRows = new Map((results[3].results as unknown as ReceiptRow[]).map(row => [row.id, row]));
  const items = refs.map(ref => {
    const row = (ref.exempt ? exemptRows : ordinaryRows).get(ref.id);
    if (!row) throw new ApiError(503, "消费记录需要核对，请稍后刷新。");
    return ref.exempt ? superUsageReceipt(row) : creditUsageReceipt(row);
  });
  return json({ accountId: user.id, creditUnlimited: false, billingExempt: false, availableBalance: balance.balance, reservedCredits: balance.reserved_credits,
    totalSpent: balance.total_spent, debtCredits: balance.debt_credits, items,
    nextCursor: results[1].results.length > limit && last ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString("base64url") : null });
}
