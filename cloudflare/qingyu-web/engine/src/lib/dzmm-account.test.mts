import assert from "node:assert/strict";
import test from "node:test";
import accountModule from "./dzmm-account";
const { changeDzmmPassword } = accountModule as typeof import("./dzmm-account");

const accountId = "displayed-account";
const newPassword = "strong-account-password";

test("password setup pins the displayed account and validates its success receipt", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ passwordChanged: true, accountId }));
  await changeDzmmPassword(accountId, "", newPassword);
  const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
  assert.equal(url, "/api/backend/v1/auth/password");
  assert.deepEqual(JSON.parse(init.body as string), { accountId, currentPassword: "", newPassword });
  assert.equal(init.credentials, "same-origin");
});

test("password changes cannot report success for a missing or different account", async t => {
  for (const result of [{ passwordChanged: true }, { passwordChanged: true, accountId: "other-account" },
    { passwordChanged: false, accountId }, { passwordChanged: "true", accountId }, null]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(result));
    await assert.rejects(changeDzmmPassword(accountId, "old-account-password", newPassword), /结果未通过验证/);
  }
});

test("invalid account identities never send a password request", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not send"); });
  for (const invalid of ["", " ", "a".repeat(201), "bad\0identity"]) {
    await assert.rejects(changeDzmmPassword(invalid, "", newPassword), /账号信息无效/);
  }
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("a stale-cookie rejection stays a failed password change", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "当前账号已切换，请重新加载。" }, { status: 409 }));
  await assert.rejects(changeDzmmPassword(accountId, "", newPassword), { status: 409 });
});
