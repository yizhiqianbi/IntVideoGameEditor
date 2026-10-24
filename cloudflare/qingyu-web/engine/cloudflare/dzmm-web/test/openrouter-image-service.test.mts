import test from "node:test";
import assert from "node:assert/strict";
import { generateOpenRouterImage, openRouterImageConfigured } from "../src/openrouter-image-service";

const key = "isolated-openrouter-test-key";
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
const b64 = Buffer.from(png).toString("base64");

test("OpenRouter image request stays server-side and decodes b64_json", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const upstream = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ data: [{ b64_json: b64, mime_type: "image/png" }] });
  }) as typeof fetch;
  const output = await generateOpenRouterImage({ OPENROUTER_API_KEY: key, OPENROUTER_IMAGE_MODEL: "google/gemini-2.5-flash-image" }, { prompt: "Yume 在窗边发一张自然的自拍感照片", aspectRatio: "1:1", quality: "high" }, upstream);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal(new Headers(calls[0].init!.headers).get("Authorization"), `Bearer ${key}`);
  const body = JSON.parse(calls[0].init!.body as string);
  assert.deepEqual(body, { model: "google/gemini-2.5-flash-image", prompt: "Yume 在窗边发一张自然的自拍感照片", n: 1, aspect_ratio: "1:1", quality: "high" });
  assert.deepEqual(new Uint8Array(output.bytes), png);
  assert.equal(output.mimeType, "image/png");
  assert.equal(JSON.stringify(output).includes(key), false);
});

test("existing DZMM OpenRouter secret and base URL are accepted", async () => {
  assert.equal(openRouterImageConfigured({ DZMM_API_KEY: key, DZMM_BASE_URL: "https://openrouter.ai/api/v1", DZMM_IMAGE_MODEL: "openai/gpt-5-image" }), true);
  let called = false;
  const upstream = (async (_input: RequestInfo | URL, init?: RequestInit) => { called = true; assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${key}`); return Response.json({ data: [{ b64_json: b64 }] }); }) as typeof fetch;
  await generateOpenRouterImage({ DZMM_API_KEY: key, DZMM_BASE_URL: "https://openrouter.ai/api/v1", DZMM_IMAGE_MODEL: "openai/gpt-5-image" }, { prompt: "一张照片" }, upstream);
  assert.equal(called, true);
});

test("invalid input, unsafe base URL, missing model, and provider errors do not leak details", async () => {
  let calls = 0; const upstream = (async () => { calls++; return new Response("provider-secret", { status: 500 }); }) as typeof fetch;
  await assert.rejects(generateOpenRouterImage({ OPENROUTER_API_KEY: key, OPENROUTER_IMAGE_MODEL: "google/gemini-2.5-flash-image" }, {}, upstream), /请求无效/);
  await assert.rejects(generateOpenRouterImage({ OPENROUTER_API_KEY: key, OPENROUTER_BASE_URL: "https://evil.example/api/v1", OPENROUTER_IMAGE_MODEL: "google/gemini-2.5-flash-image" }, { prompt: "照片" }, upstream), /尚未配置/);
  await assert.rejects(generateOpenRouterImage({ OPENROUTER_API_KEY: key }, { prompt: "照片" }, upstream), /尚未配置/);
  await assert.rejects(generateOpenRouterImage({ OPENROUTER_API_KEY: key, OPENROUTER_IMAGE_MODEL: "google/gemini-2.5-flash-image" }, { prompt: "照片" }, upstream), error => error instanceof Error && /图片生成失败/.test(error.message) && !error.message.includes(key));
  assert.equal(calls, 1);
});

test("provider output must be base64 image bytes; remote URLs and malformed data are rejected", async () => {
  for (const value of [{ data: [{ url: "https://provider.example/image.png" }] }, { data: [{ b64_json: Buffer.from("not-an-image").toString("base64") }] }, { data: [] }]) {
    const upstream = (async () => Response.json(value)) as typeof fetch;
    await assert.rejects(generateOpenRouterImage({ OPENROUTER_API_KEY: key, OPENROUTER_IMAGE_MODEL: "google/gemini-2.5-flash-image" }, { prompt: "照片" }, upstream), /图片生成失败/);
  }
});
