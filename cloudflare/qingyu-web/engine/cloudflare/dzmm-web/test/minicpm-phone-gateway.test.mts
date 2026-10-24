import test from "node:test";
import assert from "node:assert/strict";
import { handleMiniCpmPhone, type MiniCpmPhoneEnvironment } from "../src/minicpm-phone-gateway";

const origin = "https://xumengchat.top";

function environment(): MiniCpmPhoneEnvironment {
  return {
    BACKEND: { fetch: async () => Response.json({ user: { id: "phone-test", isGuest: false, role: "user" } }) },
    MINICPM_API_KEY: "server-side-key",
    MINICPM_REALTIME_URL: "wss://minicpmo45.modelbest.cn/v1/realtime?mode=audio",
    MINICPM_PHONE_ENABLED: "true",
  };
}

function upgrade(): Request {
  return new Request(`${origin}/api/phone/ws`, {
    headers: { Cookie: "dzmm_session=test-only", Origin: origin, Upgrade: "websocket" },
  });
}

test("phone handshake does not keep the page request signal after upgrade", async () => {
  const request = upgrade();
  let signal: AbortSignal | undefined;
  const response = await handleMiniCpmPhone(request, environment(), async (_input, init) => {
    signal = init?.signal ?? undefined;
    assert.equal(signal, undefined);
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    assert.equal(new URL(String(_input)).protocol, "https:");
    assert.equal(init?.redirect, "manual");
    return new Response("rejected", { status: 502 });
  });
  assert.equal(response.status, 503);
  assert.equal(signal, undefined);
  assert.match(((await response.json()) as { error: string }).error, /未接受连接/);
});
