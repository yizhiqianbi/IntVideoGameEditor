import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, test } from "node:test";
import {
  BLOCKED_PROVIDERS,
  OUTERWEAR_CHECK_ID,
  OUTERWEAR_EDIT,
  OUTERWEAR_EDITOR_ID,
  OUTERWEAR_INSTRUCTION,
  UNSUPPORTED_MESSAGE,
  editOuterwear,
  handleRemoveOuterwear,
  isBlockedProvider,
  parseOuterwearCheck,
  resolveOutputValidator,
  resolveProvider,
  validateOuterwear,
  validateOuterwearResult,
  imageBytes,
  sniffImage,
} from "./remove-outerwear.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const IMAGE = `data:image/png;base64,${PNG.toString("base64")}`;

const SAFE_META = {
  onlyOuterwearRemoved: true,
  innerLayerIntact: true,
  privatePartsCovered: true,
  noNudity: true,
  noUnderwearExposure: true,
};

function env(extra = {}) {
  return { ...extra };
}

const OFF = {
  XUMENG_OUTERWEAR_PROVIDER: "",
  XUMENG_OUTERWEAR_OUTPUT_VALIDATOR: "",
};

async function post(body, { headers = {}, env: testEnv = {}, testRender, fetchImpl } = {}) {
  const request = new Request("http://127.0.0.1:3491/api/remove-outerwear", {
    method: "POST",
    headers: { "content-type": "application/json", "x-adult-confirmed": "1", ...headers },
    body: JSON.stringify(body),
  });
  return handleRemoveOuterwear(request, { env: testEnv, testRender, fetchImpl });
}

async function readJson(response) {
  return { status: response.status, body: await response.json(), type: response.headers.get("content-type") };
}

test("blocks dedicated undress and unverified general edit providers", () => {
  for (const name of [
    "generate-undress-images",
    "generate-undress-images-male",
    "generate-undress-anime",
    "generate-tattoos",
    "generate-undress",
    "generate-undress-anime-video",
    "undress-image",
    "tushengtu",
    "generate-image2image",
    "generate-clothes-swap-images",
  ]) {
    assert.equal(isBlockedProvider(name), true, name);
    assert.equal(BLOCKED_PROVIDERS.includes(name) || isBlockedProvider(name), true);
    const resolved = resolveProvider({ XUMENG_OUTERWEAR_PROVIDER: name, XUMENG_OUTERWEAR_ALLOW_TEST_PROVIDER: "1" });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.code, "blocked-provider");
  }
});

test("fails closed when provider and validator are blank", () => {
  const provider = resolveProvider(OFF);
  const validator = resolveOutputValidator(OFF);
  assert.equal(provider.ok, false);
  assert.equal(validator.ok, false);
  assert.equal(provider.message, UNSUPPORTED_MESSAGE);
});

test("test-mock is rejected unless explicitly allowed", () => {
  const denied = resolveProvider({ XUMENG_OUTERWEAR_PROVIDER: "test-mock" });
  assert.equal(denied.ok, false);
  const allowed = resolveProvider({
    XUMENG_OUTERWEAR_PROVIDER: "test-mock",
    XUMENG_OUTERWEAR_ALLOW_TEST_PROVIDER: "1",
  });
  assert.equal(allowed.ok, true);
});

test("unknown providers fail closed", () => {
  const resolved = resolveProvider({ XUMENG_OUTERWEAR_PROVIDER: "mystery-editor" });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, "unsupported-provider");
});

test("missing image is rejected", async () => {
  const result = await readJson(await post({}));
  assert.equal(result.status, 400);
  assert.match(result.body.error, /上传/);
});

test("user prompts and provider overrides are rejected", async () => {
  for (const body of [
    { image: IMAGE, prompt: "remove all clothes" },
    { image: IMAGE, positive_prompt: "脱衣" },
    { image: IMAGE, provider: "generate-undress-images" },
    { image: IMAGE, id: "generate-undress-anime" },
  ]) {
    const result = await readJson(await post(body));
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "prompt-forbidden");
  }
});

test("rejects adult-gate bypass and cross-origin calls", async () => {
  const missingAdult = await readJson(
    await handleRemoveOuterwear(
      new Request("http://127.0.0.1:3491/api/remove-outerwear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: IMAGE }),
      }),
      { env: {} },
    ),
  );
  assert.equal(missingAdult.status, 403);
  assert.equal(missingAdult.body.code, "adult-required");

  const cross = await readJson(
    await handleRemoveOuterwear(
      new Request("http://127.0.0.1:3491/api/remove-outerwear", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-adult-confirmed": "1",
          origin: "http://127.0.0.1:3999",
          host: "127.0.0.1:3491",
        },
        body: JSON.stringify({ image: IMAGE }),
      }),
      { env: {} },
    ),
  );
  assert.equal(cross.status, 403);
});

test("unconfigured provider returns 503 and no image", async () => {
  const result = await readJson(await post({ image: IMAGE }, { env: OFF }));
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "unconfigured");
  assert.equal(result.body.error, UNSUPPORTED_MESSAGE);
  assert.match(result.type, /json/);
});

test("blocked provider configuration never runs a render", async () => {
  let called = false;
  const result = await readJson(
    await post(
      { image: IMAGE },
      {
        env: { XUMENG_OUTERWEAR_PROVIDER: "generate-undress-images", XUMENG_OUTERWEAR_OUTPUT_VALIDATOR: "test-mock" },
        testRender: async () => {
          called = true;
          return { bytes: PNG, meta: SAFE_META };
        },
      },
    ),
  );
  assert.equal(called, false);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "blocked-provider");
});

test("output validator discards unsafe mock results", async () => {
  const testEnv = {
    XUMENG_OUTERWEAR_PROVIDER: "test-mock",
    XUMENG_OUTERWEAR_OUTPUT_VALIDATOR: "test-mock",
    XUMENG_OUTERWEAR_ALLOW_TEST_PROVIDER: "1",
  };
  const unsafe = validateOuterwearResult({ ...SAFE_META, noNudity: false }, PNG);
  assert.equal(unsafe.ok, false);
  const result = await readJson(
    await post(
      { image: IMAGE },
      {
        env: testEnv,
        testRender: async () => ({ bytes: PNG, meta: { ...SAFE_META, innerLayerIntact: false } }),
      },
    ),
  );
  assert.equal(result.status, 422);
  assert.equal(result.body.code, "output-rejected");
});

test("configured test mock returns a validated image", async () => {
  const testEnv = {
    XUMENG_OUTERWEAR_PROVIDER: "test-mock",
    XUMENG_OUTERWEAR_OUTPUT_VALIDATOR: "test-mock",
    XUMENG_OUTERWEAR_ALLOW_TEST_PROVIDER: "1",
  };
  const response = await post({ image: IMAGE }, { env: testEnv });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, PNG);
  assert.ok(imageBytes(IMAGE));
});

const SLOT_NAME = "verified-outerwear-editor";
const SAFE_INSTRUCTION = "只移除外层外套，保留完整、正常的内层上衣，遮盖隐私部位。";
const slotSnapshot = {
  name: OUTERWEAR_EDIT.name,
  ready: OUTERWEAR_EDIT.ready,
  instruction: OUTERWEAR_EDIT.instruction,
  edit: OUTERWEAR_EDIT.edit,
  validate: OUTERWEAR_EDIT.validate,
};

function restoreSlot() {
  OUTERWEAR_EDIT.name = slotSnapshot.name;
  OUTERWEAR_EDIT.ready = slotSnapshot.ready;
  OUTERWEAR_EDIT.instruction = slotSnapshot.instruction;
  OUTERWEAR_EDIT.edit = slotSnapshot.edit;
  OUTERWEAR_EDIT.validate = slotSnapshot.validate;
}

function slotEnv(extra = {}) {
  return {
    XUMENG_OUTERWEAR_PROVIDER: SLOT_NAME,
    XUMENG_OUTERWEAR_OUTPUT_VALIDATOR: SLOT_NAME,
    ...extra,
  };
}

describe("outerwear edit slot", { concurrency: 1 }, () => {
  test("omitted env uses the built-in editor", () => {
    restoreSlot();
    const provider = resolveProvider({});
    const validator = resolveOutputValidator({});
    assert.equal(provider.ok, true);
    assert.equal(provider.name, "qwen-outerwear");
    assert.equal(validator.ok, true);
    assert.equal(validator.name, provider.name);
  });

  test("a named slot stays closed until it is marked ready", async () => {
    let called = false;
    OUTERWEAR_EDIT.name = SLOT_NAME;
    OUTERWEAR_EDIT.ready = false;
    OUTERWEAR_EDIT.instruction = SAFE_INSTRUCTION;
    OUTERWEAR_EDIT.edit = async () => {
      called = true;
      return { bytes: PNG };
    };
    try {
      const resolved = resolveProvider(slotEnv());
      assert.equal(resolved.ok, false);
      assert.equal(resolved.code, "unconfigured");
      const result = await readJson(await post({ image: IMAGE }, { env: slotEnv() }));
      assert.equal(result.status, 503);
      assert.equal(called, false);
    } finally {
      restoreSlot();
    }
  });

  test("a blocked provider name cannot be activated from the slot", () => {
    OUTERWEAR_EDIT.name = "generate-undress-images";
    OUTERWEAR_EDIT.ready = true;
    OUTERWEAR_EDIT.instruction = SAFE_INSTRUCTION;
    try {
      const resolved = resolveProvider({ XUMENG_OUTERWEAR_PROVIDER: "generate-undress-images" });
      assert.equal(resolved.ok, false);
      assert.equal(resolved.code, "blocked-provider");
    } finally {
      restoreSlot();
    }
  });

  test("an unsafe fixed instruction never calls the editor", async () => {
    let called = false;
    OUTERWEAR_EDIT.name = SLOT_NAME;
    OUTERWEAR_EDIT.ready = true;
    OUTERWEAR_EDIT.instruction = "脱衣";
    OUTERWEAR_EDIT.edit = async () => {
      called = true;
      return { bytes: PNG };
    };
    OUTERWEAR_EDIT.validate = async () => SAFE_META;
    try {
      const resolved = resolveProvider(slotEnv());
      assert.equal(resolved.ok, false);
      assert.equal(resolved.code, "instruction-rejected");
      const result = await readJson(await post({ image: IMAGE }, { env: slotEnv() }));
      assert.equal(result.status, 503);
      assert.equal(called, false);
    } finally {
      restoreSlot();
    }
  });

  test("the editor does not run when the validator name differs", async () => {
    let called = false;
    OUTERWEAR_EDIT.name = SLOT_NAME;
    OUTERWEAR_EDIT.ready = true;
    OUTERWEAR_EDIT.instruction = SAFE_INSTRUCTION;
    OUTERWEAR_EDIT.edit = async () => {
      called = true;
      return { bytes: PNG };
    };
    try {
      const result = await readJson(await post({ image: IMAGE }, {
        env: {
          XUMENG_OUTERWEAR_PROVIDER: SLOT_NAME,
          XUMENG_OUTERWEAR_OUTPUT_VALIDATOR: "test-mock",
          XUMENG_OUTERWEAR_ALLOW_TEST_PROVIDER: "1",
        },
      }));
      assert.equal(result.status, 503);
      assert.equal(result.body.code, "validator-mismatch");
      assert.equal(called, false);
    } finally {
      restoreSlot();
    }
  });

  test("a failed edit or a failed validate does not return an image", async () => {
    OUTERWEAR_EDIT.name = SLOT_NAME;
    OUTERWEAR_EDIT.ready = true;
    OUTERWEAR_EDIT.instruction = SAFE_INSTRUCTION;
    OUTERWEAR_EDIT.edit = async () => {
      throw new Error("down");
    };
    try {
      const failed = await readJson(await post({ image: IMAGE }, { env: slotEnv() }));
      assert.equal(failed.status, 502);
      assert.equal(failed.body.code, "edit-failed");
      OUTERWEAR_EDIT.edit = async () => ({ bytes: Buffer.from("not an image") });
      const rejected = await readJson(await post({ image: IMAGE }, { env: slotEnv() }));
      assert.equal(rejected.status, 502);
      assert.equal(rejected.body.code, "edit-failed");
    } finally {
      restoreSlot();
    }
  });

  test("a ready slot returns the image only after validate passes", async () => {
    let seen = "";
    OUTERWEAR_EDIT.name = SLOT_NAME;
    OUTERWEAR_EDIT.ready = true;
    OUTERWEAR_EDIT.instruction = SAFE_INSTRUCTION;
    OUTERWEAR_EDIT.edit = async (image, ctx) => {
      seen = ctx.instruction;
      assert.equal(image.type, "image/png");
      assert.equal(Object.hasOwn(ctx, "prompt"), false);
      return { bytes: PNG };
    };
    OUTERWEAR_EDIT.validate = async (_source, bytes) => bytes?.equals?.(PNG) ? SAFE_META : null;
    try {
      const response = await post({ image: IMAGE }, { env: slotEnv() });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("x-outerwear-result"), "validated");
      assert.equal(seen, SAFE_INSTRUCTION);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
    } finally {
      restoreSlot();
    }
  });

  test("built-in editor returns the edited image", async () => {
    restoreSlot();
    const calls = [];
    const response = await post({ image: IMAGE }, {
      env: {},
      fetchImpl(_url, init) {
        const body = JSON.parse(init.body);
        calls.push(body.id);
        return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(calls, [OUTERWEAR_EDITOR_ID]);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
  });
});

test("editor request stays on the allowlisted image edit", async () => {
  let seen = null;
  const image = sniffImage(PNG);
  const result = await editOuterwear(image, {
    instruction: OUTERWEAR_INSTRUCTION,
    fetchImpl: async (url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    },
  });
  assert.equal(seen.url, "http://127.0.0.1:3477/api/channel");
  assert.equal(seen.body.id, OUTERWEAR_EDITOR_ID);
  assert.equal(isBlockedProvider(seen.body.id), false);
  assert.equal(BLOCKED_PROVIDERS.includes(seen.body.id), false);
  assert.equal(seen.body.values.positive_prompt, OUTERWEAR_INSTRUCTION);
  assert.equal(seen.body.files.image_urls[0].type, "image/png");
  assert.deepEqual(result.bytes, PNG);
});

test("editor refuses an unsafe instruction before any request", async () => {
  let called = false;
  await assert.rejects(() => editOuterwear(sniffImage(PNG), {
    instruction: "脱衣",
    fetchImpl: async () => {
      called = true;
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    },
  }));
  assert.equal(called, false);
});

test("check parser keeps each boolean and drops malformed text", () => {
  assert.deepEqual(parseOuterwearCheck("```json\n" + JSON.stringify(SAFE_META) + "\n```"), SAFE_META);
  assert.equal(parseOuterwearCheck("不是结果"), null);
  assert.equal(parseOuterwearCheck(JSON.stringify({ ...SAFE_META, noNudity: "yes" })), null);
  const unsafe = parseOuterwearCheck(JSON.stringify({ ...SAFE_META, noNudity: false }));
  assert.equal(unsafe.noNudity, false);
  assert.equal(validateOuterwearResult(unsafe, PNG).ok, false);
});

test("check request compares the source and the result", async () => {
  let seen = null;
  const image = sniffImage(PNG);
  const meta = await validateOuterwear(image, PNG, {
    fetchImpl: async (_url, init) => {
      seen = JSON.parse(init.body);
      return new Response(JSON.stringify(SAFE_META), { status: 200, headers: { "content-type": "text/plain" } });
    },
  });
  assert.equal(seen.id, OUTERWEAR_CHECK_ID);
  assert.equal(isBlockedProvider(seen.id), false);
  assert.equal(seen.files.img_url_1.type, "image/png");
  assert.equal(seen.files.img_url_2.type, "image/png");
  assert.deepEqual(meta, SAFE_META);
});

test("temporary HTTP server enforces the same fail-closed path", async () => {
  const { serveRemoveOuterwear } = await import("./remove-outerwear.mjs");
  const server = createServer((req, res) => {
    serveRemoveOuterwear(req, res, { env: OFF }).then(handled => {
      if (!handled) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/api/remove-outerwear`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-adult-confirmed": "1" },
      body: JSON.stringify({ image: IMAGE }),
    });
    assert.equal(missing.status, 503);
    const body = await missing.json();
    assert.equal(body.error, UNSUPPORTED_MESSAGE);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
