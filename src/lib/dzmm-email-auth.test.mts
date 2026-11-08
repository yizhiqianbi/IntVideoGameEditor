import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import authModule from "./dzmm-email-auth";
import type { DzmmEmailCodeValues } from "./dzmm-email-auth";
const {
  DzmmEmailAuthError, fetchDzmmEmailAuthConfig, normalizeDzmmEmail, requestDzmmEmailCode, verifyDzmmEmailCode,
} = authModule as typeof import("./dzmm-email-auth");

const email = "person@example.com";
const challengeId = "11111111-1111-4111-8111-111111111111";
const timing = { expiresIn: 600, resendAfter: 60 };
const values = { email, challengeId, code: "123456" };
const user = { id: "registered-account", email, nickname: "昵称", isGuest: false, role: "user" };
const verified = { user, authenticated: true, registered: false };
function respond(t: TestContext, body: unknown, status = 200) {
  return t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
}
const errorStatus = (status: number) => (failure: unknown) => failure instanceof DzmmEmailAuthError && failure.status === status;

test("email config accepts enabled and disabled services with bounded timings", async t => {
  for (const enabled of [true, false]) {
    const config = { enabled, ...timing, note: enabled ? "验证码有效期为 10 分钟。" : "邮箱验证码服务暂未开通。" };
    respond(t, { ...config, ignored: "not retained" });
    assert.deepEqual(await fetchDzmmEmailAuthConfig(), config);
  }
});

test("config and challenge responses reject malformed data and timing drift", async t => {
  for (const fields of [{ enabled: "yes" }, { expiresIn: 601 }, { expiresIn: "600" }, { resendAfter: 0 }, { resendAfter: 61 }, { note: null }, { note: "x".repeat(1001) }]) {
    respond(t, { enabled: true, ...timing, note: "", ...fields });
    await assert.rejects(fetchDzmmEmailAuthConfig(), errorStatus(502));
  }
  for (const fields of [{ challengeId: "not-a-uuid" }, { challengeId: "11111111-1111-0111-1111-111111111111" }, { expiresIn: 300 }, { resendAfter: 59 }]) {
    respond(t, { challengeId, ...timing, ...fields });
    await assert.rejects(requestDzmmEmailCode(email), errorStatus(502));
  }
  for (const payload of [null, [], "raw response"]) {
    respond(t, payload);
    await assert.rejects(requestDzmmEmailCode(email), errorStatus(502));
  }
});

test("request normalizes the email and uses the same-origin JSON transport", async t => {
  const mock = respond(t, { challengeId, ...timing, ignored: "not retained" });
  assert.deepEqual(await requestDzmmEmailCode(" Person@Example.COM "), { challengeId, ...timing });
  const [path, init] = mock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(path, "/api/backend/v1/auth/email/request");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  assert.deepEqual(init.headers, { Accept: "application/json", "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(init.body as string), { email });
  assert.ok(init.signal instanceof AbortSignal);
});

test("verify returns a matching authenticated account and coherent password setup flags", async t => {
  for (const role of ["user", "super"] as const) {
    for (const passwordSetupRequired of [true, false, undefined]) {
      const flags = passwordSetupRequired === undefined ? {} : { passwordSetupRequired };
      const payload = { ...verified, registered: passwordSetupRequired === true, ...flags, user: { ...user, role, ...flags } };
      const mock = respond(t, { ...payload, ignored: { untrusted: "not retained" } });
      assert.deepEqual(await verifyDzmmEmailCode({ ...values, email: " Person@Example.COM ", nickname: " 新昵称 " }), payload);
      const init = mock.mock.calls[0].arguments[1] as RequestInit;
      assert.deepEqual(JSON.parse(init.body as string), { ...values, nickname: "新昵称" });
    }
  }
  respond(t, { ...verified, passwordSetupRequired: true });
  assert.equal((await verifyDzmmEmailCode(values)).passwordSetupRequired, true);
  respond(t, { ...verified, user: { ...user, passwordSetupRequired: true } });
  assert.equal((await verifyDzmmEmailCode(values)).user.passwordSetupRequired, true);
});

test("verify includes the initiating account pin without changing the authenticated result", async t => {
  const mock = respond(t, verified);
  const accountId = "initiating-guest-account";
  assert.deepEqual(await verifyDzmmEmailCode({ ...values, accountId }), verified);
  const [path, init] = mock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(path, "/api/backend/v1/auth/email/verify");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body as string), { ...values, accountId });
});

test("verify forwards a normalized referral code for first-time email signup", async t => {
  const mock = respond(t, verified);
  assert.deepEqual(await verifyDzmmEmailCode({ ...values, referralCode: " xmabc123 " }), verified);
  const init = mock.mock.calls[0].arguments[1] as RequestInit;
  assert.equal(JSON.parse(init.body as string).referralCode, "XMABC123");
});

test("invalid initiating account pins are rejected before transport", async t => {
  const mock = respond(t, verified);
  for (const accountId of [null, "", "   ", "x".repeat(201), "guest\0account", 123]) {
    await assert.rejects(verifyDzmmEmailCode({ ...values, accountId } as unknown as DzmmEmailCodeValues), errorStatus(400));
  }
  assert.equal(mock.mock.callCount(), 0);
});

test("verify rejects wrong accounts, guest sessions and malformed authentication flags", async t => {
  for (const fields of [{ authenticated: false }, { authenticated: "true" }, { registered: 1 }, { user: null },
    { user: { ...user, email: "other@example.com" } }, { user: { ...user, email: null } }, { user: { ...user, email: "Person@Example.com" } },
    { user: { ...user, isGuest: true } }, { user: { ...user, isGuest: "false" } }, { user: { ...user, role: "admin" } },
    { user: { ...user, id: "" } }, { user: { ...user, nickname: "" } }, { user: { ...user, nickname: "x".repeat(31) } },
    { passwordSetupRequired: "true" }, { user: { ...user, passwordSetupRequired: 1 } },
    { passwordSetupRequired: false, user: { ...user, passwordSetupRequired: true } }]) {
    respond(t, { ...verified, ...fields });
    await assert.rejects(verifyDzmmEmailCode(values), errorStatus(502));
  }
});

test("successful responses cannot expose codes, password hashes or token hashes", async t => {
  for (const secret of [{ code: "123456" }, { password_hash: "private" }, { token_hash: "private" }, { user: { code: "123456" } }, { extra: [{ passwordHash: "private" }] }]) {
    respond(t, { challengeId, ...timing, ...secret });
    await assert.rejects(requestDzmmEmailCode(email), errorStatus(502));
  }
  respond(t, { ...verified, user: { ...user, password_hash: "private" } });
  await assert.rejects(verifyDzmmEmailCode(values), errorStatus(502));
  respond(t, { enabled: true, ...timing, note: "", token_hash: "private" });
  await assert.rejects(fetchDzmmEmailAuthConfig(), errorStatus(502));
});

test("invalid emails, codes, challenge identifiers and nicknames never call the server", async t => {
  const mock = respond(t, { challengeId, ...timing });
  assert.equal(normalizeDzmmEmail(" Person@Example.COM "), email);
  for (const invalid of ["", "no-at-sign", "person@example", "person@@example.com", "person@ example.com", "person\0@example.com", `${"x".repeat(243)}@example.com`]) {
    await assert.rejects(requestDzmmEmailCode(invalid), errorStatus(400));
  }
  for (const fields of [{ challengeId: "wrong" }, { code: "12345" }, { code: "1234567" }, { code: "12a456" }, { code: " 123456 " },
    { nickname: "" }, { nickname: "   " }, { nickname: "x".repeat(31) }, { nickname: "a\0b" }, { referralCode: "bad code" }, { referralCode: "x".repeat(33) }, { email: "invalid" }]) {
    await assert.rejects(verifyDzmmEmailCode({ ...values, ...fields }), errorStatus(400));
  }
  await assert.rejects(verifyDzmmEmailCode(null as unknown as DzmmEmailCodeValues), errorStatus(400));
  assert.equal(mock.mock.callCount(), 0);
});

test("503 send failures stay failures and never display raw server responses", async t => {
  respond(t, { challengeId, ...timing, error: "provider key private, code 123456", password_hash: "private" }, 503);
  await assert.rejects(requestDzmmEmailCode(email), failure => {
    assert.ok(failure instanceof DzmmEmailAuthError);
    assert.equal(failure.status, 503);
    assert.equal(failure.message, "邮箱验证码服务暂时不可用，请稍后重试。");
    return true;
  });
  respond(t, verified, 503);
  await assert.rejects(verifyDzmmEmailCode(values), errorStatus(503));
  respond(t, { error: "code 123456" }, 429);
  await assert.rejects(requestDzmmEmailCode(email), failure => {
    assert.ok(failure instanceof DzmmEmailAuthError);
    assert.equal(failure.status, 429);
    assert.equal(failure.message, "请求过于频繁，请稍后重试。");
    return true;
  });
});

test("network failures and non-JSON successes cannot produce authentication", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private transport detail"); });
  await assert.rejects(verifyDzmmEmailCode(values), errorStatus(503));
  t.mock.method(globalThis, "fetch", async () => new Response("not json", { status: 200 }));
  await assert.rejects(verifyDzmmEmailCode(values), errorStatus(502));
});

test("pre-aborted requests never start transport", async t => {
  const mock = respond(t, { challengeId, ...timing });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestDzmmEmailCode(email, controller.signal), { name: "AbortError" });
  assert.equal(mock.mock.callCount(), 0);
});

test("abort discards a completed response even when transport ignores cancellation", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_input, init) => {
    assert.equal(init?.signal?.aborted, false);
    controller.abort();
    return Response.json(verified);
  });
  await assert.rejects(verifyDzmmEmailCode(values, controller.signal), { name: "AbortError" });
});

test("abort stops waiting for an unresponsive transport or response body", async t => {
  for (const responseBody of [false, true]) {
    const controller = new AbortController();
    t.mock.method(globalThis, "fetch", async () => responseBody
      ? { ok: true, json: () => new Promise(() => undefined) } as unknown as Response
      : await new Promise<Response>(() => undefined));
    const pending = requestDzmmEmailCode(email, controller.signal);
    const rejection = assert.rejects(pending, { name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await rejection;
  }
});

test("the 15 second deadline rejects even when transport ignores its abort signal", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let transportSignal: AbortSignal | null = null;
  t.mock.method(globalThis, "fetch", (_input, init) => {
    transportSignal = init?.signal ?? null;
    return new Promise<Response>(() => undefined);
  });
  const pending = requestDzmmEmailCode(email);
  const rejection = assert.rejects(pending, errorStatus(503));
  t.mock.timers.tick(14_999);
  assert.equal((transportSignal as AbortSignal | null)?.aborted, false);
  t.mock.timers.tick(1);
  await rejection;
  assert.equal((transportSignal as AbortSignal | null)?.aborted, true);
});
