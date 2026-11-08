/** Uses the actual dashboard. All data and writes are disposable in-memory fixtures; unknown fetches are blocked. */
import { createRoot } from "react-dom/client";
import AdminDashboard from "../../../../src/components/dzmm/admin-dashboard";
import type { DzmmCloudUser } from "../../../../src/lib/dzmm-cloud";
import type { DzmmAdminAudit, DzmmAdminUser } from "../../../../src/lib/dzmm-admin-client";
import tavern from "../../../../src/components/dzmm/tavern.module.css";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OWNER_TWO = "10000000-0000-4000-8000-000000000002";
const MEMBER = "10000000-0000-4000-8000-000000000003";
const GUEST = "10000000-0000-4000-8000-000000000004";
const DAY = 86_400_000;
const NOW = Date.now();
const users: DzmmAdminUser[] = Array.from({ length: 23 }, (_, index) => {
  const id = [OWNER, OWNER_TWO, MEMBER, GUEST][index] ?? `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const isGuest = index === 3, role = index < 2 ? "super" as const : "user" as const;
  return { id, nickname: ["叙梦测试 Super", "第二个测试 Super", "管理测试用户", "原创测试游客"][index] ?? `原创新用户 ${index + 1}`,
    email: isGuest ? null : `admin-original-${index}@example.invalid`, isGuest, role,
    createdAt: NOW - index * 1000, emailVerified: !isGuest, creditUnlimited: false,
    availableCredits: index === 0 ? 1_000_000_000 : 1200, reservedCredits: index === 2 ? 50 : 0, totalSpentCredits: index === 2 ? 100 : 0,
    debtCredits: 0, adminAdjustedCredits: 0, subscription: { active: index === 2, expiresAt: index === 2 ? NOW + DAY * 20 : null } };
});
const state = {
  activeId: OWNER, readFailure: false, dropCreditResponse: false, delayNextRead: false,
  delayedRead: false, blockedRequests: 0, getRequests: 0, creditRequests: 0, creditApplications: 0,
  roleRequests: 0, roleApplications: 0, deniedStatus: 0, loginRequests: 0, accountChanged: 0,
  requestIds: [] as string[], creditBodies: [] as string[], counts: {} as Record<string, number>,
};
const audits: DzmmAdminAudit[] = [];
let delayedResolve: (() => void) | null = null;
const controlRoot = createRoot(document.getElementById("fixture-controls")!);
const dashboardRoot = createRoot(document.getElementById("root")!);
const publicState = () => ({ ...state, memberBalance: users[2].availableCredits, memberRole: users[2].role, auditCount: audits.length });
Object.assign(window, { __xumengAdminFixture: { snapshot: publicState } });
const active = () => users.find(user => user.id === state.activeId)!;
const cloudUser = (): DzmmCloudUser => { const user = active(); return { id: user.id, email: user.email, nickname: user.nickname, isGuest: user.isGuest, role: user.role }; };
function renderDashboard() {
  dashboardRoot.render(<div className={tavern.app}><AdminDashboard user={cloudUser()}
    onRequireAccount={() => { state.loginRequests++; renderControls(); }}
    onAccountChanged={() => { state.accountChanged++; renderControls(); }}
    publishingReview={<section aria-label="角色审核模拟入口">角色审核模块入口 · 只使用隔离测试数据</section>}
    forumModeration={<section aria-label="论坛管理模拟入口">论坛管理模块入口 · 只使用隔离测试数据</section>}
  /></div>);
}
function switchAccount(id: string) { state.activeId = id; renderDashboard(); renderControls(); }
function renderControls() {
  controlRoot.render(<section className="fixture-panel" aria-label="本地隔离验收控制台"><h1>Super 后台 · 本地隔离验收</h1><p>真实 AdminDashboard 与 client，模拟 API。无需真实账号、支付、模型调用；所有未知请求被阻止。</p><div className="fixture-actions">
    <button onClick={() => switchAccount(OWNER)}>切换 Super</button><button onClick={() => switchAccount(MEMBER)}>切换普通用户</button><button onClick={() => switchAccount(GUEST)}>切换游客</button><button onClick={() => switchAccount(OWNER_TWO)}>切换第二个 Super</button>
    <button onClick={() => { state.readFailure = true; renderControls(); }}>模拟读取失败</button><button onClick={() => { state.readFailure = false; renderControls(); }}>恢复读取</button>
    <button onClick={() => { state.dropCreditResponse = true; renderControls(); }}>丢失下一次 Credit 响应</button>
    <button onClick={() => { state.delayNextRead = true; renderControls(); }}>延迟下一次读取</button><button disabled={!state.delayedRead} onClick={() => { delayedResolve?.(); }}>释放旧读取结果</button>
    <button onClick={() => { void window.fetch("/api/backend/v1/admin/overview").then(response => { state.deniedStatus = response.status; renderControls(); }); }}>直接检查后台权限</button>
    <button onClick={() => window.location.reload()}>重置验收数据</button>
  </div><pre aria-label="模拟服务状态" role="status">{JSON.stringify(publicState(), null, 2)}</pre></section>);
}
function previewTraffic() {
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(Date.parse(`${today}T00:00:00Z`) - (6 - index) * 86_400_000).toISOString().slice(0, 10);
    const visitors = index === 6 ? 8 : 3;
    return { day, visitors, guestVisitors: 2, registeredVisitors: visitors - 2, newGuests: 1, newRegistered: 1 };
  });
  const last = days[6];
  return { timezone: "Asia/Shanghai", day: last.day, visitors: last.visitors, guestVisitors: last.guestVisitors, registeredVisitors: last.registeredVisitors, newGuests: last.newGuests, newRegistered: last.newRegistered, returningVisitors: last.visitors - last.newGuests - last.newRegistered, conversations: 2, chatRequests: 4, chargedCredits: 20, paidOrders: 1, forumPosts: 1, forumReplies: 0, likes: 3, openReports: 0, listedCharacters: 4, days };
}
const opsPackages = [{ id: "cny_28", amountMinor: 2800, credits: 2800, bonusCredits: 0, bonusRatio: "", weight: 1, enabled: true, createdAt: NOW, purchases: 1, checkoutReady: true }];
const opsBanners: unknown[] = [];
function opsPayload(path: string, accountId: string) {
  const day = new Date(NOW + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (path === "ops/packages") return { accountId, packages: opsPackages };
  if (path === "ops/scene-prices") return { accountId, prices: ["suggestion", "image", "video", "character", "voice"].map(scene => ({ scene, unit: scene === "suggestion" ? "per_k_token" : "per_call", amount: scene === "image" ? 10 : 0, revision: 1, updatedAt: 0 })) };
  if (path === "ops/model-prices") return { accountId, models: [{ id: "grok", model: "x-ai/grok", name: "测试模型", catalogIntro: "目录介绍", intro: "目录介绍", amount: null, revision: null, updatedAt: null }] };
  if (path === "ops/orientations") return { accountId, orientations: [{ id: "ori_male", name: "男性向", explanation: "面向男性读者", icon: "", updatedAt: NOW }] };
  if (path === "ops/subtags") return { accountId, subtags: [] };
  if (path === "ops/voices") return { accountId, voices: [] };
  if (path === "ops/characters") return { accountId, characters: [] };
  if (path === "ops/recharges") return { accountId, feeNote: "手续费尚未配置，以下金额是用户实付。", totals: { all: 2800, month: 2800, week: 0, day: 0 }, items: [] };
  if (path === "ops/analytics") return { accountId, note: "没有打点时这些格子为空。", balance: { total: 12, users: 2, perUser: 6 }, days: [{ day, newUsers: 1, newGuests: 0, dau: 1, landingUv: 1, registerRate: null, guestConvertRate: null, firstChatRate: null, firstMessageRate: null, d1Retention: null, d7Retention: null, chatters: 0, images: 0, videos: 0, suggestionUses: null, suggestionAdoption: null, ttftMs: null, detailToChat: null, creditsIssued: 0, checkinCredits: 0, inviteCredits: 0, creditsSpent: 0, spendRatio: null, checkins: 0, checkinRate: null, inviteBinds: 0, shareClicks: null, inviteRate: null }] };
  if (path === "ops/reviews") return { accountId, pending: 0, items: [] };
  if (path === "ops/reject-reasons") return { accountId, reasons: [{ id: "reject_other", label: "其他" }] };
  if (path === "banners") return { accountId, banners: opsBanners };
  return null;
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), window.location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const key = `${method} ${url.pathname}`;
  state.counts[key] = (state.counts[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return response(value, status); };
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/backend/v1/admin/")) {
    state.blockedRequests++; return finish({ error: "隔离模式拒绝未知请求。" }, 501);
  }
  const actor = active();
  if (actor.isGuest || actor.role !== "super") return finish({ error: "后台管理仅限 Super 账户。" }, 403);
  const path = url.pathname.slice("/api/backend/v1/admin/".length);
  if (method === "GET") {
    state.getRequests++;
    if (state.readFailure) return finish({ error: "模拟管理读取失败。恢复服务后重试。" }, 503);
    const accountId = actor.id;
    const limit = Number(url.searchParams.get("limit") ?? 20), offset = Number(url.searchParams.get("offset") ?? 0);
    const userId = url.searchParams.get("userId");
    const page = (values: unknown[]) => ({ accountId, items: values.slice(offset, offset + limit), total: values.length, limit, offset, hasMore: offset + limit < values.length });
    let body: unknown;
    if (path === "overview") body = { accountId, serverTime: NOW, stats: { users: users.length, registeredUsers: users.length - 1, guestUsers: 1, superUsers: 2,
      totalAvailableCredits: users.reduce((sum, user) => sum + user.availableCredits, 0), totalReservedCredits: 50, totalSpentCredits: 100,
      pendingUsage: 1, activeSubscriptions: 1, pendingSubmissions: 2, forumPosts: 5 },
      traffic: previewTraffic(),
      revenue: [{ provider: "zpay", currency: "cny", amountMinor: 2800, paidOrders: 1, mode: "live" }, { provider: "stripe", currency: "usd", amountMinor: 500, paidOrders: 1, mode: "test" }],
      billing: { enabled: false, priceRevision: null }, capabilities: { userRoles: true, creditAdjustments: true, paymentOrders: true, usageMetadata: true, privateConversations: false } };
    else if (path === "checkin") body = { accountId, credits: 5 };
    else if (path === "users") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase(), role = url.searchParams.get("role");
      body = page(users.filter(user => (!role || user.role === role) && `${user.nickname} ${user.email} ${user.id}`.toLowerCase().includes(q)));
    } else if (path === "subscriptions") body = page([
      { id: "sub-original-active", userId: MEMBER, nickname: users[2].nickname, planId: "vip-30", label: "原创新会员", status: "active", startsAt: NOW - DAY * 10, expiresAt: NOW + DAY * 20, dailyCredits: 100, claimsCount: 2, maxClaims: 30 },
      { id: "sub-original-scheduled", userId: MEMBER, nickname: users[2].nickname, planId: "vip-30", label: "原创续期会员", status: "scheduled", startsAt: NOW + DAY * 20, expiresAt: NOW + DAY * 50, dailyCredits: 100, claimsCount: 0, maxClaims: 30 },
    ].filter(item => !userId || item.userId === userId));
    else if (path === "orders") body = page([{ id: "zp_original_fixture", userId: MEMBER, nickname: users[2].nickname,
      provider: "zpay", mode: "live", kind: "recharge", currency: "cny", amountMinor: 2800, credits: 2800, status: "paid", createdAt: NOW - DAY, paidAt: NOW - DAY + 1000,
    }].filter(item => !userId || item.userId === userId));
    else if (path === "usage") body = page([
      { id: "super_original_usage", userId: OWNER, nickname: users[0].nickname, operation: "chat", model: "original-test-model", status: "settled", chargedCredits: 0, reservedCredits: 0, providerCostUsd: 0.001234, promptTokens: 100, completionTokens: 50, billingExempt: true, createdAt: NOW - 1000, finalizedAt: NOW },
      { id: "original_member_usage", userId: MEMBER, nickname: users[2].nickname, operation: "memory", model: "original-test-model", status: "pending", chargedCredits: 0, reservedCredits: 50, providerCostUsd: null, promptTokens: null, completionTokens: null, billingExempt: false, createdAt: NOW - 1000, finalizedAt: null },
    ].filter(item => !userId || item.userId === userId));
    else if (path === "audit") body = page([...audits].reverse().filter(item => !userId || item.targetUserId === userId));
    else if (path.startsWith("ops/") || path === "banners") body = opsPayload(path, accountId);
    else { state.blockedRequests++; return finish({ error: "隔离模式没有这个管理接口。" }, 404); }
    if (body === null) { state.blockedRequests++; return finish({ error: "隔离模式没有这个管理接口。" }, 404); }
    const snapshot = copy(body);
    if (state.delayNextRead) {
      state.delayNextRead = false; state.delayedRead = true; renderControls();
      await new Promise<void>(resolve => { delayedResolve = resolve; });
      delayedResolve = null; state.delayedRead = false;
      return finish(snapshot);
    }
    return finish(snapshot);
  }
  if (path === "ops/packages") {
    const raw = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}");
    if (raw.confirmed !== true) return finish({ error: "请二次确认后再保存。" }, 400);
    const created = { id: "pkg_fixture", amountMinor: raw.amountMinor, credits: raw.credits, bonusCredits: raw.bonusCredits ?? 0, bonusRatio: raw.bonusRatio ?? "", weight: raw.weight, enabled: Boolean(raw.enabled), createdAt: Date.now(), purchases: 0, checkoutReady: raw.credits === raw.amountMinor };
    opsPackages.unshift(created);
    return finish({ accountId: actor.id, package: created }, 201);
  }
  if (path === "banners") {
    const raw = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}");
    const banner = { id: crypto.randomUUID(), audience: raw.audience, position: raw.position, title: raw.title, body: raw.body, href: raw.href ?? null, deletedAt: null, enabled: raw.enabled !== false, desktopImage: raw.desktopImage ?? null, mobileImage: raw.mobileImage ?? null, orientationId: raw.orientationId ?? null };
    opsBanners.unshift(banner);
    return finish({ accountId: actor.id, banner }, 201);
  }
  const match = /^users\/([^/]+)\/(credits|role)$/.exec(path);
  if (method !== "POST" || !match) { state.blockedRequests++; return finish({ error: "隔离模式禁止这个操作。" }, 405); }
  const body = JSON.parse(typeof init?.body === "string" ? init.body : request ? await request.text() : "{}");
  if (body.accountId !== actor.id) return finish({ error: "管理账号已切换。" }, 409);
  const target = users.find(user => user.id === match[1]);
  if (!target || target.isGuest) return finish({ error: "不能调整游客账号。" }, 400);
  const kind = match[2];
  if (kind === "credits") { state.creditRequests++; state.creditBodies.push(JSON.stringify(body)); }
  else state.roleRequests++;
  state.requestIds.push(body.requestId);
  let audit = audits.find(entry => entry.actorId === actor.id && entry.requestId === body.requestId);
  const replayed = Boolean(audit);
  if (audit && (audit.targetUserId !== target.id || audit.reason !== body.reason || (kind === "credits" ? audit.delta !== body.delta : audit.role !== body.role))) return finish({ error: "同一个请求编号不能用于其他调整。" }, 409);
  if (!audit) {
    if (kind === "credits") {
      if (!Number.isSafeInteger(body.delta) || body.delta === 0 || Math.abs(body.delta) > 1_000_000 || target.availableCredits + body.delta < 0) return finish({ error: "调整数量无效或余额不足。" }, 409);
      target.availableCredits += body.delta; target.adminAdjustedCredits += body.delta; state.creditApplications++;
      audit = { id: `admin_${crypto.randomUUID()}`, actorId: actor.id, targetUserId: target.id, requestId: body.requestId, action: "credit_adjustment", delta: body.delta, reason: body.reason, createdAt: Date.now() };
    } else {
      if (target.id === actor.id && body.role === "user") return finish({ error: "不能撤销自己的 Super 权限。" }, 409);
      const previousRole = target.role; target.role = body.role; target.creditUnlimited = false; state.roleApplications++;
      audit = { id: `admin_${crypto.randomUUID()}`, actorId: actor.id, targetUserId: target.id, requestId: body.requestId, action: "role_change", previousRole, role: target.role, reason: body.reason, createdAt: Date.now() };
    }
    audits.push(audit);
  }
  if (kind === "credits" && state.dropCreditResponse) { state.dropCreditResponse = false; renderControls(); throw new TypeError("模拟已落库但响应丢失"); }
  return finish({ accountId: actor.id, user: copy(target), audit, replayed });
};
renderControls();
renderDashboard();
