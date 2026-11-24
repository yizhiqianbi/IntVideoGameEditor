import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  assertDramaSubmitPayload,
  isDramaTimeoutError,
  isRetryableNetworkError,
  readApiJson,
  translateDramaApiError,
  translateDramaNetworkError,
} from "../src/lib/drama-api";

test("submit payload rejects embedded data URLs before they hit Vercel", () => {
  assert.throws(
    () =>
      assertDramaSubmitPayload({
        timelineDirector: {
          images: [{ url: "data:image/png;base64,AAAA" }],
        },
      }),
    /还没传到 GPU/,
  );
  assert.doesNotThrow(() =>
    assertDramaSubmitPayload({
      timelineDirector: {
        images: [{ url: "comfy-input:pencil_stills/a.png", file: "pencil_stills/a.png" }],
      },
    }),
  );
});

test("413 Request Entity Too Large becomes a Chinese error", async () => {
  await assert.rejects(
    () =>
      readApiJson(
        new Response("Request Entity Too Large", {
          status: 413,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    /参考图太大/,
  );
});

test("JSON error message is kept even when status is 502", async () => {
  await assert.rejects(
    () =>
      readApiJson(
        new Response(JSON.stringify({ error: "GPU 未就绪" }), { status: 502 }),
      ),
    /GPU 未就绪/,
  );
});

test("signal timed out becomes a Chinese timeout error", () => {
  const timeout = new Error("signal timed out");
  assert.equal(isDramaTimeoutError(timeout), true);
  assert.match(translateDramaApiError("signal timed out"), /提交超时/);
  assert.match(translateDramaNetworkError(timeout, "video"), /提交超时/);
});

test("browser Failed to fetch becomes a Chinese network error", () => {
  assert.equal(isRetryableNetworkError(new TypeError("Failed to fetch")), true);
  assert.match(
    translateDramaNetworkError(new TypeError("Failed to fetch"), "video"),
    /没送到服务器/,
  );
  assert.match(
    translateDramaNetworkError(new TypeError("Failed to fetch"), "input-image"),
    /参考图上传中断/,
  );
  assert.match(translateDramaApiError("Failed to fetch"), /没送到服务器/);
});

