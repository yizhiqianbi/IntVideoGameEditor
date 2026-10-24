import assert from "node:assert/strict";
import test from "node:test";
import adminModule from "./dzmm-admin-client";
const {
  adjustDzmmAdminCredits, changeDzmmAdminRole, DzmmAdminError, fetchDzmmAdminSubscriptions,
  fetchDzmmAdminUsers, fetchDzmmAdminOrders, fetchDzmmAdminOverview, parseDzmmAdminUser,
} = adminModule as typeof import("./dzmm-admin-client");

const actor = "10000000-0000-4000-8000-000000000001";
const target = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const user = { id: target, email: "original-admin-fixture@example.invalid", nickname: "管理测试用户", isGuest: false, role: "user",
  createdAt: 1000, emailVerified: true, creditUnlimited: false, availableCredits: 1200, reservedCredits: 0, totalSpentCredits: 0,
  debtCredits: 0, adminAdjustedCredits: 0, subscription: { active: false, expiresAt: null } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const overview = (revenue: unknown[]) => ({ accountId: actor, serverTime: 1000,
  stats: { users: 1, registeredUsers: 1, guestUsers: 0, superUsers: 0, totalAvailableCredits: 0, totalReservedCredits: 0,
    totalSpentCredits: 0, pendingUsage: 0, activeSubscriptions: 0, pendingSubmissions: 0, forumPosts: 0 },
  revenue, billing: { enabled: false, priceRevision: null },
  capabilities: { userRoles: true, creditAdjustments: true, paymentOrders: true, usageMetadata: true, privateConversations: false } });
const order = { id: "original-finance-order", userId: target, nickname: user.nickname, provider: "subscription", mode: "live",
  kind: "subscription", currency: "cny", amountMinor: 2800, credits: null, status: "paid", createdAt: 1000, paidAt: 1001 };
async function withFetch<T>(fetcher: typeof fetch, operation: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await operation(); } finally { globalThis.fetch = previous; }
}

test("管理用户解析拒绝伪造无限 Credit 标志，并剔除服务额外字段", () => {
  assert.throws(() => parseDzmmAdminUser({ ...user, creditUnlimited: true }), DzmmAdminError);
  assert.throws(() => parseDzmmAdminUser({ ...user, isGuest: true, role: "super", creditUnlimited: true }), DzmmAdminError);
  assert.deepEqual(parseDzmmAdminUser({ ...user, passwordHash: "never-display", privateState: "never-read" }), user);
  assert.equal(parseDzmmAdminUser({ ...user, role: "super", creditUnlimited: false, availableCredits: 1_000_000_000 }).availableCredits, 1_000_000_000);
});

test("后台请求保护账号边界、权限错误与分页参数", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return response({ accountId: target, items: [user], limit: 20, offset: 0, total: 1, hasMore: false }); }, async () => {
    await assert.rejects(fetchDzmmAdminUsers(actor), (error: unknown) => error instanceof DzmmAdminError && error.status === 409);
    await assert.rejects(fetchDzmmAdminUsers(actor, { limit: 51 }), (error: unknown) => error instanceof DzmmAdminError && error.status === 400);
    assert.equal(calls, 1);
  });
  await withFetch(async () => response({ error: "后台管理仅限 Super 账户。" }, 403), async () => {
    await assert.rejects(fetchDzmmAdminUsers(actor), (error: unknown) => error instanceof DzmmAdminError && error.status === 403);
  });
});

test("用户查询按真实 API 分页，搜索不会注入其他参数", async () => {
  await withFetch(async (input, init) => {
    const url = new URL(String(input), "https://xumengchat.top");
    assert.equal(url.pathname, "/api/backend/v1/admin/users");
    assert.equal(url.searchParams.get("q"), "原创 &role=super");
    assert.equal(url.searchParams.get("role"), "user");
    assert.equal(url.searchParams.getAll("role").length, 1);
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    return response({ accountId: actor, items: [user], total: 21, limit: 20, offset: 0, hasMore: true });
  }, async () => {
    const result = await fetchDzmmAdminUsers(actor, { q: "原创 &role=super", role: "user" });
    assert.equal(result.items[0].id, target); assert.equal(result.hasMore, true);
  });
});

test("未来会员 scheduled 状态能读取且只保留公开管理字段", async () => {
  const subscription = { id: "sub-fixture", userId: target, nickname: user.nickname, planId: "vip-30", label: "原创新会员",
    status: "scheduled", startsAt: 2000, expiresAt: 3000, dailyCredits: 100, claimsCount: 0, maxClaims: 30 };
  await withFetch(async () => response({ accountId: actor, items: [{ ...subscription, paymentSecret: "hidden" }], total: 1, limit: 20, offset: 0, hasMore: false }), async () => {
    assert.deepEqual((await fetchDzmmAdminSubscriptions(actor)).items, [subscription]);
  });
});

test("NOWPayments 订单与收入保留 microUSDT 六位单位，旧 CNY 返回形状不变", async () => {
  const usdt = { ...order, id: "original-usdt-order", provider: "nowpayments", currency: "usdt", amountMinor: 5_000_000, amountScale: 6 };
  const legacyRevenue = { provider: "subscription", currency: "cny", amountMinor: 2800, paidOrders: 1, mode: "live" };
  const usdtRevenue = { provider: "nowpayments", currency: "usdt", amountMinor: 5_000_000, amountScale: 6, paidOrders: 1, mode: "live" };
  await withFetch(async input => String(input).includes("/overview") ? response(overview([legacyRevenue, usdtRevenue]))
    : response({ accountId: actor, items: [{ ...order, checkoutSecret: "hidden" }, { ...usdt, checkoutSecret: "hidden" }], total: 2, limit: 20, offset: 0, hasMore: false }), async () => {
    assert.deepEqual((await fetchDzmmAdminOrders(actor)).items, [order, usdt]);
    assert.deepEqual((await fetchDzmmAdminOverview(actor)).revenue, [legacyRevenue, usdtRevenue]);
  });
});

test("管理金额拒绝缺少或错配 USDT 小数位、渠道与币种，不能默认为美分", async () => {
  for (const fields of [
    { provider: "nowpayments", currency: "usdt" },
    { provider: "nowpayments", currency: "usdt", amountScale: 2 },
    { provider: "stripe", currency: "usdt", amountScale: 6 },
    { provider: "nowpayments", currency: "usd", amountScale: 6 },
    { provider: "subscription", currency: "cny", amountScale: 6 },
    { provider: "nowpayments", currency: "usdt", amountScale: "6" },
  ]) {
    const invalidOrder = { ...order, amountMinor: 5_000_000, ...fields };
    const invalidRevenue = { ...fields, amountMinor: 5_000_000, paidOrders: 1, mode: "live" };
    await withFetch(async input => String(input).includes("/overview") ? response(overview([invalidRevenue]))
      : response({ accountId: actor, items: [invalidOrder], total: 1, limit: 20, offset: 0, hasMore: false }), async () => {
      await assert.rejects(fetchDzmmAdminOrders(actor), DzmmAdminError);
      await assert.rejects(fetchDzmmAdminOverview(actor), DzmmAdminError);
    });
  }
});

test("Credit 响应丢失后重试保持相同 requestId 和请求体，校验实际审计回执", async () => {
  const sent: string[] = [];
  const audit = { id: "admin-fixture", actorId: actor, targetUserId: target, requestId, action: "credit_adjustment", delta: 50, reason: "原创隔离验收", createdAt: 1000 };
  await withFetch(async (input, init) => {
    assert.equal(String(input), `/api/backend/v1/admin/users/${target}/credits`);
    assert.equal(init?.method, "POST"); sent.push(String(init?.body));
    if (sent.length === 1) throw new TypeError("simulated response loss");
    return response({ accountId: actor, user: { ...user, availableCredits: 1250, adminAdjustedCredits: 50 }, audit, replayed: true });
  }, async () => {
    const action = { accountId: actor, requestId, delta: 50, reason: "  原创隔离验收  " };
    await assert.rejects(adjustDzmmAdminCredits(target, action), (error: unknown) => error instanceof DzmmAdminError && error.status === 503);
    const result = await adjustDzmmAdminCredits(target, action);
    assert.equal(result.replayed, true); assert.equal(result.user.availableCredits, 1250);
    assert.equal(sent[0], sent[1]); assert.equal(JSON.parse(sent[0]).requestId, requestId);
  });
  await withFetch(async () => response({ accountId: actor, user, audit: { ...audit, delta: 100 }, replayed: false }), async () => {
    await assert.rejects(adjustDzmmAdminCredits(target, { accountId: actor, requestId, delta: 50, reason: audit.reason }), DzmmAdminError);
  });
});

test("角色修改拒绝错误目标、错误权限回执和无效原因", async () => {
  const audit = { id: "admin-fixture-role", actorId: actor, targetUserId: target, requestId, action: "role_change", previousRole: "user", role: "user", reason: "原创权限验收", createdAt: 1000 };
  await withFetch(async () => response({ accountId: actor, user, audit, replayed: false }), async () => {
    await assert.rejects(changeDzmmAdminRole(target, { accountId: actor, requestId, role: "super", reason: audit.reason }), DzmmAdminError);
    await assert.rejects(changeDzmmAdminRole(target, { accountId: actor, requestId, role: "super", reason: "第一行\n第二行" }), (error: unknown) => error instanceof DzmmAdminError && error.status === 400);
  });
});
