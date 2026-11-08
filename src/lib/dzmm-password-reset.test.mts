import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import resetModule from "./dzmm-email-auth";
import type { DzmmPasswordResetValues } from "./dzmm-email-auth";

const { DzmmEmailAuthError, requestDzmmPasswordResetCode, resetDzmmPassword } = resetModule as typeof import("./dzmm-email-auth");
const email = "person@example.com";
const challengeId = "11111111-1111-4111-8111-111111111111";
const timing = { expiresIn: 600, resendAfter: 60 };
const user = { id: "registered-account", email, nickname: "昵称", isGuest: false, role: "user" as const };
const values: DzmmPasswordResetValues = { email, challengeId, code: "123456", newPassword: "a-strong-new-password" };
function respond(t: TestContext, body: unknown, status = 200) {
  return t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
}
const errorStatus = (status: number) => (failure: unknown) => failure instanceof DzmmEmailAuthError && failure.status === status;

test("password reset request uses the password reset endpoint and preserves timing", async t => {
  const mock = respond(t, { challengeId, ...timing, ignored: "not retained" });
  assert.deepEqual(await requestDzmmPasswordResetCode(" Person@Example.COM "), { challengeId, ...timing });
  const [path, init] = mock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(path, "/api/backend/v1/auth/password/forgot/request");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body as string), { email });
});

test("password reset validates the authenticated account receipt", async t => {
  const response = { passwordChanged: true, authenticated: true, user };
  const mock = respond(t, response);
  assert.deepEqual(await resetDzmmPassword({ ...values, email: " Person@Example.COM " }), response);
  const [path, init] = mock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(path, "/api/backend/v1/auth/password/forgot/reset");
  assert.deepEqual(JSON.parse(init.body as string), values);
  for (const fields of [{ passwordChanged: false }, { authenticated: false }, { user: null }, { user: { ...user, isGuest: true } }, { user: { ...user, email: "other@example.com" } }]) {
    respond(t, { ...response, ...fields });
    await assert.rejects(resetDzmmPassword(values), errorStatus(502));
  }
  respond(t, { ...response, newPassword: values.newPassword });
  await assert.rejects(resetDzmmPassword(values), errorStatus(502));
});

test("password reset rejects invalid local inputs before transport", async t => {
  const mock = respond(t, { challengeId, ...timing });
  for (const fields of [{ email: "bad" }, { challengeId: "invalid" }, { code: "12345" }, { code: "12a456" }, { newPassword: "short" }, { newPassword: "x".repeat(257) }, { newPassword: "a\0b" }]) {
    await assert.rejects(resetDzmmPassword({ ...values, ...fields } as DzmmPasswordResetValues), errorStatus(400));
  }
  assert.equal(mock.mock.callCount(), 0);
});
