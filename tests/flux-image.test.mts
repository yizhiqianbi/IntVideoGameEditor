import { test } from "node:test";
import assert from "node:assert/strict";
import route from "../src/app/api/image/generate/route";
import imageGen from "../src/lib/image-generation";
const FLUX_NSFW_MODEL = imageGen.FLUX_NSFW_MODEL as string;

const { POST } = route;
const request = (body: object) =>
  new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("Flux NSFW stills go to the local Comfy endpoint without a cloud key", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/pencil\/flux\/t2i$/);
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.match(body.prompt, /26岁成年女性/);
    assert.match(body.prompt, /负面：无多余手指/);
    assert.equal(body.size, "2K");
    assert.equal(body.aspect_ratio, "2:1");
    return Response.json({
      mimeType: "image/png",
      b64Json: "aW1hZ2U=",
    });
  };
  try {
    const response = await POST(
      request({
        model: FLUX_NSFW_MODEL,
        prompt: "26岁成年女性",
        negativePrompt: "多余手指",
        size: "2K",
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      model: FLUX_NSFW_MODEL,
      mimeType: "image/png",
      b64Json: "aW1hZ2U=",
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("Flux reports GPU errors without requiring API keys", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: "Flux 权重未就绪" }, { status: 502 });
  try {
    const response = await POST(
      request({
        model: FLUX_NSFW_MODEL,
        prompt: "portrait",
      }),
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).message, "Flux 权重未就绪");
  } finally {
    globalThis.fetch = original;
  }
});
