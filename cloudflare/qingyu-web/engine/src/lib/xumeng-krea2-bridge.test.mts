import assert from "node:assert/strict";
import test from "node:test";
import { renderKrea2Still } from "./xumeng-krea2-bridge.ts";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const reference = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";

test("a krea2 template sends the reference and returns the png", async () => {
  const calls: string[] = [];
  const response = await renderKrea2Still("http://gpu.example", { templateId: "krea2-deepthroat", prompt: "slow", image: reference }, async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/generate")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.image, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ");
      assert.equal(body.style, "photo");
      return new Response(JSON.stringify({ file: "krea2-deepthroat-42.png" }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
  assert.deepEqual(calls, ["POST http://gpu.example/generate", "GET http://gpu.example/output/krea2-deepthroat-42.png"]);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.status, 200);
});

test("an unknown style falls back to the photographic style", async () => {
  await renderKrea2Still("http://gpu.example", { templateId: "krea2-deepthroat", prompt: "slow", image: reference, style: "oil" }, async (input, init) => {
    if (String(input).endsWith("/generate")) {
      assert.equal(JSON.parse(String(init?.body)).style, "photo");
      return new Response(JSON.stringify({ file: "krea2-deepthroat-7.png" }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
});

test("a chosen style is sent with the reference", async () => {
  await renderKrea2Still("http://gpu.example", { templateId: "krea2-deepthroat", prompt: "slow", image: reference, style: "cinema" }, async (input, init) => {
    if (String(input).endsWith("/generate")) {
      assert.equal(JSON.parse(String(init?.body)).style, "cinema");
      return new Response(JSON.stringify({ file: "krea2-deepthroat-7.png" }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
});

test("a template poster is sent with the uploaded reference", async () => {
  const response = await renderKrea2Still("http://gpu.example", { templateId: "krea2-deepthroat", prompt: "slow", image: reference }, async (input, init) => {
    const url = String(input);
    if (url.endsWith("/generate")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.templateImage, "poster");
      return new Response(JSON.stringify({ file: "krea2-deepthroat-7.png" }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  }, "poster");
  assert.equal(response.status, 200);
});

test("a still without a reference image is not generated", async () => {
  const response = await renderKrea2Still("http://gpu.example", { templateId: "krea2-deepthroat", prompt: "slow" }, async () => {
    throw new Error("should not fetch");
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "请先上传参考图。");
});

test("a missing gpu address does not invent an image", async () => {
  const response = await renderKrea2Still("", { templateId: "krea2-deepthroat", prompt: "", image: reference }, async () => {
    throw new Error("should not fetch");
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "出图服务还没接上。");
});

test("an incompatible weight is shown and not replaced", async () => {
  const response = await renderKrea2Still("http://gpu.example", { templateId: "krea2-ahegao", image: reference }, async () => new Response(JSON.stringify({ error: "这个权重不是 Krea 2 格式，没有生成。" }), { status: 422 }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /不是 Krea 2/);
});
