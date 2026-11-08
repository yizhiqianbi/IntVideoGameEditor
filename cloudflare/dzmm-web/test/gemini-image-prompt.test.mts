import assert from "node:assert/strict";
import test from "node:test";
import { writeGeminiImagePrompt } from "../src/gemini-image-prompt";

const image = `data:image/png;base64,${"a".repeat(80)}`;
const env = { DZMM_API_KEY: "k".repeat(24), DZMM_BASE_URL: "https://openrouter.ai/api/v1" };

test("gemini writes a prompt from the reference image and keeps the key on the server", async () => {
  const calls: { url: string; body: { messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[] } }[] = [];
  const response = await writeGeminiImagePrompt(env, "根据图片生成提示词", image, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${"k".repeat(24)}`);
    return Response.json({ choices: [{ message: { content: "她站在窗边，暖色台灯，看向镜头。" } }] });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "她站在窗边，暖色台灯，看向镜头。" });
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].body.messages[0].content[1].image_url?.url, image);
  assert.doesNotMatch(calls[0].body.messages[0].content[0].text ?? "", /根据图片生成提示词/);
  assert.match(calls[0].body.messages[0].content[0].text ?? "", /只输出提示词本身/);
});

test("a user note is included and a missing key never calls upstream", async () => {
  let note = "";
  const response = await writeGeminiImagePrompt(env, "写成夜景", image, async (_url, init) => {
    note = JSON.parse(String(init?.body)).messages[0].content[0].text;
    return Response.json({ choices: [{ message: { content: [{ type: "text", text: "夜色窗边。" }] } }] });
  });
  assert.match(note, /用户补充：写成夜景/);
  assert.deepEqual(await response.json(), { text: "夜色窗边。" });
  let called = false;
  const missing = await writeGeminiImagePrompt({}, "写成夜景", image, async () => { called = true; return new Response(""); });
  assert.equal(missing.status, 503);
  assert.equal(called, false);
  const empty = await writeGeminiImagePrompt(env, "", "not-an-image", async () => { called = true; return new Response(""); });
  assert.equal(empty.status, 400);
  assert.equal(called, false);
});
