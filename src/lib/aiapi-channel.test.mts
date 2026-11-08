import assert from "node:assert/strict";
import test from "node:test";
import { aiapiForm, aiapiImageFrame, aiapiVideoFrame, readAiapiTask, runAiapiJob, sniffAiapiBytes } from "./aiapi-channel.ts";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

test("qwen edit uses a portrait frame and a json image list", () => {
  const form = aiapiForm({ kind: "image", prompt: "换成夜景", imageUrls: ["https://create.xumengchat.top/api/studio/media/a"], ratio: "9:16" }, "task-1");
  assert.deepEqual(aiapiImageFrame("9:16"), { width: 1088, height: 1920 });
  assert.equal(form.get("positive_prompt"), "换成夜景");
  assert.equal(form.get("image_urls"), JSON.stringify(["https://create.xumengchat.top/api/studio/media/a"]));
  assert.equal(form.get("width"), "1088");
});

test("h3 reference stays inside the short-video frame and duration", () => {
  const form = aiapiForm({
    kind: "video",
    prompt: "她转身",
    imageUrls: ["https://cdn.example/a.png"],
    videoUrls: ["https://cdn.example/move.mp4"],
    ratio: "16:9",
    seconds: 8,
  }, "task-2");
  assert.deepEqual(aiapiVideoFrame("16:9"), { width: 960, height: 540 });
  assert.equal(form.get("duration"), "8");
  assert.equal(form.get("video_format"), "video/h264-mp4");
  assert.equal(form.get("video_urls"), JSON.stringify(["https://cdn.example/move.mp4"]));
  assert.throws(() => aiapiForm({ kind: "video", prompt: "她转身", imageUrls: ["https://cdn.example/a.png"], ratio: "16:9", seconds: 20 }, "task-3"));
});

test("comma joined input urls do not hide the result", () => {
  const reference = "https://channel-media.xumengchat.top/api/studio/media/c824d2bf-5fd8-48de-a32a-bec660770bf1";
  const poster = "https://xumengchat.top/assets/xumeng/krea2-actions/demo.webp";
  const view = readAiapiTask({
    status: 2,
    out_data: `${reference},${poster}`,
    result: "https://cdn.example/out.png",
  }, [reference, poster]);
  assert.equal(view.url, "https://cdn.example/out.png");
});

test("a finished task prefers the media url inside out_data", () => {
  const view = readAiapiTask({ status: 2, error_code: "SUCCESS", out_data: JSON.stringify({ images: ["https://cdn.example/out.png"] }) });
  assert.equal(view.phase, "done");
  assert.equal(view.url, "https://cdn.example/out.png");
  assert.equal(readAiapiTask({ task_status: 1 }).phase, "pending");
  assert.equal(readAiapiTask({ status: 3, detail: "参数不对" }).error, "参数不对");
});

test("a channel job polls once and downloads the png", async () => {
  const calls: string[] = [];
  const result = await runAiapiJob({ baseUrl: "https://p0-api.inaiai.com", apiKey: "key", secretKey: "secret" }, {
    kind: "image",
    prompt: "夜景",
    imageUrls: ["https://create.xumengchat.top/api/studio/media/a"],
    ratio: "1:1",
  }, async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/qwen_image21_multi_image_edit")) {
      return new Response(JSON.stringify({ task_id: "task-9", status: 0 }));
    }
    if (url.includes("/api/public/task")) {
      return new Response(JSON.stringify({ status: 2, error_code: "SUCCESS", out_data: { url: "https://cdn.example/out.png" } }));
    }
    assert.equal(url, "https://cdn.example/out.png");
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  }, () => 0, async () => undefined);
  assert.equal(result.contentType, "image/png");
  assert.equal(sniffAiapiBytes(result.bytes, "image"), "image/png");
  assert.equal(calls[0].startsWith("POST "), true);
  assert.equal(calls.some(call => call.includes("/api/public/task?task_id=task-9")), true);
});

test("a result redirect is followed when the next address is public", async () => {
  const result = await runAiapiJob({ baseUrl: "https://p0-api.inaiai.com", apiKey: "key", secretKey: "secret" }, {
    kind: "image",
    prompt: "夜景",
    imageUrls: ["https://create.xumengchat.top/api/studio/media/a"],
    ratio: "1:1",
  }, async (input) => {
    const url = String(input);
    if (url.endsWith("/qwen_image21_multi_image_edit")) return new Response(JSON.stringify({ task_id: "task-7", status: 2, out_data: { url: "https://cdn.example/jump" } }));
    if (url === "https://cdn.example/jump") return new Response(null, { status: 302, headers: { Location: "https://cdn.example/out.png" } });
    assert.equal(url, "https://cdn.example/out.png");
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  }, () => 0, async () => undefined);
  assert.equal(result.contentType, "image/png");
});

test("a private result url is refused", async () => {
  await assert.rejects(() => runAiapiJob({ baseUrl: "https://p0-api.inaiai.com", apiKey: "key", secretKey: "secret" }, {
    kind: "image",
    prompt: "夜景",
    imageUrls: ["https://create.xumengchat.top/api/studio/media/a"],
    ratio: "1:1",
  }, async (input) => {
    const url = String(input);
    if (url.includes("/task")) return new Response(JSON.stringify({ status: 2, out_data: { url: "https://127.0.0.1/secret.png" } }));
    return new Response(JSON.stringify({ task_id: "task-8", status: 0 }));
  }, () => 0, async () => undefined), /资源地址无效/);
});
