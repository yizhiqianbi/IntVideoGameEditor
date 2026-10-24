/** Local-only real-component acceptance fixture. No fetch ever leaves this mock. */
import { createRoot } from "react-dom/client";
import { Recharge } from "../../../../src/components/dzmm/recharge";

const ACCOUNT = "qa-vip-round4";
const DAY = 86_400_000;
const PURCHASED_AT = Date.now() - DAY;
const SUBSCRIPTION = "sub-qa-vip-round4";
const ORDER = "sp_00000000-0000-4000-8000-000000000004";
const state = {
  balance: 0,
  externallyAdded: 0,
  claimed: false,
  claimedAt: null as number | null,
  claimFails: false,
  vipReadFails: false,
  getRequests: 0,
  simulatedPosts: 0,
  blockedRequests: 0,
  counts: {} as Record<string, number>,
  lastError: "",
};

function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="本地隔离验收控制台">
    <h1>VIP 与余额恢复 · 本地隔离验收</h1>
    <p>直接使用真实 Recharge。只修改模拟服务，购买已关闭；所有未知请求都失败，不访问正式账户或支付服务。</p>
    <div className="fixture-actions">
      <button type="button" onClick={() => { state.balance += 100; state.externallyAdded += 100; renderControls(); }}>增加测试余额100</button>
      <button type="button" onClick={() => { state.claimFails = true; state.lastError = ""; renderControls(); }}>模拟签到失败</button>
      <button type="button" onClick={() => { state.vipReadFails = true; state.lastError = ""; renderControls(); }}>模拟VIP读取失败</button>
      <button type="button" onClick={() => { state.claimFails = false; state.vipReadFails = false; state.lastError = ""; renderControls(); }}>恢复服务</button>
      <button type="button" onClick={() => window.location.reload()}>重置整个验收场景</button>
    </div>
    <pre role="status" aria-label="模拟服务状态">{JSON.stringify({
      account: ACCOUNT, serverBalance: state.balance, claimed: state.claimed,
      claimFailure: state.claimFails, vipReadFailure: state.vipReadFails,
      GET请求数: state.getRequests, 模拟签到POST数: state.simulatedPosts,
      拒绝未知请求数: state.blockedRequests, 最近模拟错误: state.lastError,
      请求明细: state.counts,
    }, null, 2)}</pre>
  </section>);
}

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function overview() {
  const now = Date.now();
  const dayKey = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    accountId: ACCOUNT, provider: "zpay", mode: "live", testMode: false,
    serverTime: now, balance: state.balance, totalSubscriptionGranted: state.claimed ? 100 : 0,
    subscriptions: [{
      id: SUBSCRIPTION, orderId: ORDER, planId: "qa-vip-30", label: "晴屿 VIP", status: "active",
      startsAt: PURCHASED_AT, expiresAt: PURCHASED_AT + 30 * DAY,
      dailyCredits: 100, claimsCount: state.claimed ? 1 : 0, maxClaims: 30,
    }],
    checkin: {
      subscriptionId: SUBSCRIPTION, dayKey, timezone: "Asia/Shanghai",
      claimed: state.claimed, claimable: !state.claimed, rewardCredits: 100,
      claimedAt: state.claimedAt, resetAt: Date.parse(`${dayKey}T00:00:00+08:00`) + DAY,
    },
  };
}

const controls = createRoot(document.getElementById("fixture-controls")!);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), window.location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const signal = init?.signal ?? request?.signal;
  signal?.throwIfAborted();
  const key = `${method} ${url.pathname}`;
  state.counts[key] = (state.counts[key] ?? 0) + 1;
  if (method === "GET") state.getRequests++;
  const finish = (value: unknown, status = 200) => { renderControls(); return response(value, status); };
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/backend/")) {
    state.blockedRequests++; state.lastError = `隔离模式拒绝请求：${key}`;
    return finish({ error: state.lastError }, 501);
  }
  if (method === "POST" && url.pathname === "/api/backend/v1/subscriptions/checkin") {
    state.simulatedPosts++;
    const supplied = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}");
    if (supplied.accountId !== ACCOUNT || supplied.subscriptionId !== SUBSCRIPTION) {
      state.lastError = "模拟签到账户或会员不匹配。";
      return finish({ error: state.lastError }, 409);
    }
    if (state.claimFails) {
      state.lastError = "模拟签到失败：今日奖励暂未发放，请重试。";
      return finish({ error: state.lastError }, 409);
    }
    if (!state.claimed) { state.balance += 100; state.claimed = true; state.claimedAt = Date.now(); }
    const current = overview();
    return finish({ ...current, claim: {
      id: "claim-qa-vip-round4", subscriptionId: SUBSCRIPTION,
      dayKey: current.checkin.dayKey, credits: 100, claimedAt: state.claimedAt,
    } });
  }
  if (method !== "GET") {
    state.blockedRequests++; state.lastError = `隔离模式禁止创建订单或其他写入：${key}`;
    return finish({ error: state.lastError }, 405);
  }
  if (url.pathname === "/api/backend/v1/payments/config") return finish({
    enabled: false, provider: "zpay", mode: "live", testMode: false,
    currency: "cny", methods: [{ id: "alipay", label: "支付宝" }],
    packages: [
      { id: "qa-credit-28", amountMinor: 2800, currency: "cny", credits: 2800 },
      { id: "qa-credit-88", amountMinor: 8800, currency: "cny", credits: 8800 },
      { id: "qa-credit-188", amountMinor: 18800, currency: "cny", credits: 18800 },
    ], note: "本地隔离验收，真实购买关闭。", modelBillingLinked: false,
  });
  if (url.pathname === "/api/backend/v1/payments/wallet") return finish({
    accountId: ACCOUNT, provider: "zpay", mode: "live", testMode: false,
    balance: state.balance, totalPurchased: state.externallyAdded, totalRefunded: 0, orders: [],
  });
  if (url.pathname === "/api/backend/v1/subscriptions/config") return finish({
    provider: "zpay", mode: "live", testMode: false, enabled: false,
    timezone: "Asia/Shanghai", renewal: "manual", autoRenew: false, modelBillingLinked: false,
    methods: [{ id: "alipay", label: "支付宝" }],
    plans: [{
      id: "qa-vip-30", label: "晴屿 VIP", revision: 1, amountMinor: 2800, currency: "cny",
      durationDays: 30, dailyCredits: 100, maxClaims: 30, timezone: "Asia/Shanghai",
    }], note: "模拟已有 VIP；本地验收禁止购买。",
  });
  if (url.pathname === "/api/backend/v1/subscriptions" || url.pathname === "/api/backend/v1/subscriptions/") {
    if (state.vipReadFails) { state.lastError = "模拟VIP读取失败，请恢复服务后刷新。"; return finish({ error: state.lastError }, 503); }
    return finish(overview());
  }
  if (url.pathname === "/api/backend/v1/billing/config") return finish({
    enabled: false, priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null,
    memoryBilled: false, tokenUnit: 1000, rounding: "ceil_combined", outputIncludesReasoning: true,
    failureRule: "no_valid_output_refund", cancellationRule: "valid_output_bill_usage",
    missingUsageRule: "pending_then_refund", reservationTtlMs: 600000,
  });
  if (url.pathname === "/api/backend/v1/billing/usage") return finish({
    accountId: ACCOUNT, availableBalance: state.balance, reservedCredits: 0, totalSpent: 0,
    debtCredits: 0, items: [], nextCursor: null,
  });
  state.blockedRequests++; state.lastError = `隔离模式没有这个接口：${key}`;
  return finish({ error: state.lastError }, 501);
};

renderControls();
createRoot(document.getElementById("root")!).render(<Recharge
  userId={ACCOUNT} isGuest={false} focusVip={true}
  onRequireAccount={() => { state.lastError = "本地隔离验收不执行真实登录。"; renderControls(); }}
/>);
