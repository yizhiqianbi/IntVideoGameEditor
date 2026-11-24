import { test } from "node:test";
import assert from "node:assert/strict";
import ltx from "../src/lib/drama-ltx";
test("LTX rejects unsupported video modes and duration before inference", async () => {
  await assert.rejects(ltx.ltxGenerate({ mode: "t2v" }), /首帧/);
  await assert.rejects(
    ltx.ltxGenerate({ mode: "i2v", duration: 30, prompt: "Calm lake" }),
    /首帧/,
  );
  await assert.rejects(
    ltx.ltxGenerate({
      mode: "i2v",
      lastFrame: "https://example.com/image.png",
    }),
    /尾帧/,
  );
    await assert.rejects(
      ltx.ltxGenerate({ videoModel: "ltx-sulphur", mode: "i2v" }),
      /文生视频/,
    );
    await assert.rejects(
      ltx.ltxGenerate({ videoModel: "ltx-10eros", mode: "ri2v" }),
      /10Eros-Max/,
    );
});
test("LTX submits supported dimensions and returns model-tagged task", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("data:"))
      return new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "image/png" },
      });
    assert.ok(String(url).includes("/pencil/ltx/i2v"));
    const form = init?.body as FormData;
    assert.equal(form.get("num_frames"), "361");
    assert.equal(form.get("width"), "896");
    assert.equal(form.get("height"), "512");
    return Response.json({ id: "012345abcdef", status: "queued" });
  };
  try {
    assert.equal(
      (
        await ltx.ltxGenerate({
          mode: "i2v",
          prompt: "Calm lake",
          firstFrame: "data:image/png;base64,AQ==",
          aspectRatio: "16:9",
        })
      ).videoModel,
      "ltx-10eros",
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("LTX 8s submits 193 frames", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("data:"))
      return new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "image/png" },
      });
    const form = init?.body as FormData;
    assert.equal(form.get("num_frames"), "193");
    return Response.json({ id: "012345abcdef", status: "queued" });
  };
  try {
    await ltx.ltxGenerate({
      mode: "i2v",
      duration: 8,
      prompt: "Calm lake",
      firstFrame: "data:image/png;base64,AQ==",
      aspectRatio: "16:9",
    });
  } finally {
    globalThis.fetch = original;
  }
});
test("Sulphur T2V submits without a first frame", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).includes("/pencil/ltx/t2v"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.num_frames, 361);
    assert.equal(body.width, 512);
    assert.equal(body.height, 896);
    assert.equal(body.image, undefined);
    return Response.json({ id: "fedcba987654", status: "queued" });
  };
  try {
    const result = await ltx.ltxGenerate({
      videoModel: "ltx-sulphur",
      mode: "t2v",
      prompt: "Two adults kiss in a hotel doorway",
      aspectRatio: "9:16",
    });
    assert.equal(result.videoModel, "ltx-sulphur");
    assert.equal(result.taskId, "fedcba987654");
  } finally {
    globalThis.fetch = original;
  }
});
test("legacy PinkCherry requests are remapped off the LTX adapter", async () => {
  await assert.rejects(
    ltx.ltxGenerate({
      videoModel: "ltx-pinkcherry",
      mode: "t2v",
      prompt: "Two adults kiss in a hotel doorway",
    }),
    /独立适配器/,
  );
});
test("LTX surfaces FastAPI validation detail instead of a generic failure", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://"))
      return new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "image/png" },
      });
    return Response.json(
      {
        detail: [
          { type: "missing", loc: ["query", "body"], msg: "Field required" },
        ],
      },
      { status: 422 },
    );
  };
  try {
    await assert.rejects(
      ltx.ltxGenerate({
        videoModel: "ltx-10eros",
        mode: "i2v",
        prompt: "Two adults kiss in a hotel doorway",
        firstFrame: "https://example.com/lin.png",
        aspectRatio: "9:16",
      }),
      /Field required/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("LTX status maps completion to its own media route", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: "succeeded" });
  try {
    const result = await ltx.ltxStatus("012345abcdef");
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.videoUrl, "/api/drama/ltx-media?id=012345abcdef");
  } finally {
    globalThis.fetch = original;
  }
});
