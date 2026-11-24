import { test } from "node:test";
import assert from "node:assert/strict";
import route from "../src/app/api/image/generate/route";
const { POST } = route;
const model = "x-ai/grok-imagine-image-2.0";
const request = (body: object) =>
  new Request("http://localhost/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("Grok routes user key to OpenRouter and decodes image response", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/images");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer supplied-key",
    );
    assert.deepEqual(JSON.parse(init?.body as string), {
      model,
      prompt: "A mountain landscape",
      resolution: "1K",
      quality: "low",
      n: 1,
    });
    return Response.json({
      data: [{ b64_json: "aW1hZ2U=", media_type: "image/jpeg" }],
    });
  };
  try {
    const response = await POST(
      request({
        model,
        apiKey: "supplied-key",
        prompt: "A mountain landscape",
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      model,
      mimeType: "image/jpeg",
      b64Json: "aW1hZ2U=",
    });
  } finally {
    globalThis.fetch = original;
  }
});
test("Grok uses server OpenRouter key and exposes provider errors", async () => {
  const original = globalThis.fetch,
    key = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "server-key";
  globalThis.fetch = async (_url, init) => {
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer server-key",
    );
    return Response.json(
      { error: { message: "Insufficient credits" } },
      { status: 402 },
    );
  };
  try {
    const response = await POST(request({ model, prompt: "Landscape" }));
    assert.equal(response.status, 402);
    assert.equal((await response.json()).message, "Insufficient credits");
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = key;
  }
});
test("Grok 2K character sheets use medium quality and a wide 2:1 frame", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init?.body as string), {
      model,
      prompt: "turnaround",
      resolution: "2K",
      quality: "medium",
      n: 1,
      aspect_ratio: "2:1",
    });
    return Response.json({
      data: [{ b64_json: "aW1hZ2U=", media_type: "image/png" }],
    });
  };
  try {
    const response = await POST(
      request({
        model,
        apiKey: "supplied-key",
        prompt: "turnaround",
        size: "2K",
      }),
    );
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});
test("Grok three-view sends the source image and 2K size", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init?.body as string), {
      model,
      prompt: "three view sheet",
      resolution: "2K",
      quality: "medium",
      n: 1,
      aspect_ratio: "2:1",
      images: ["data:image/png;base64,AQ=="],
    });
    return Response.json({
      data: [{ b64_json: "aW1hZ2U=", media_type: "image/png" }],
    });
  };
  try {
    const response = await POST(
      request({
        model,
        apiKey: "supplied-key",
        prompt: "three view sheet",
        image: "data:image/png;base64,AQ==",
        size: "2K",
      }),
    );
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});
test("unsupported model is rejected before calling a provider", async () => {
  assert.equal(
    (await POST(request({ model: "unknown", prompt: "Landscape" }))).status,
    400,
  );
});
