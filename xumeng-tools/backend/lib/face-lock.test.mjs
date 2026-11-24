import assert from "node:assert/strict";
import { test } from "node:test";
import {
  animeFacePromptAllowed,
  animeFaceVerdict,
  FACE_AGE_MESSAGE,
  FACE_CLOSED_MESSAGE,
  FACE_LOCK_MESSAGE,
  readAnimeFaces,
} from "./face-lock.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ENV = { SEALION_API_KEY: "test-key", SEALION_BASE_URL: "https://open-sealion.aiaigirl.com/v1" };

function jsonReply(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("the check prompt can be sent through the existing text filter", () => {
  assert.equal(animeFacePromptAllowed(), true);
});

test("only a clear adult anime pair opens the lock", () => {
  const open = animeFaceVerdict('{"faceAnime":true,"sceneAnime":true,"bothAdult":true,"realPhoto":false}');
  assert.equal(open.ok, true);
  assert.equal(animeFaceVerdict('{"faceAnime":true,"sceneAnime":true,"bothAdult":true,"realPhoto":true}').error, FACE_LOCK_MESSAGE);
  assert.equal(animeFaceVerdict('{"faceAnime":false,"sceneAnime":true,"bothAdult":true,"realPhoto":false}').error, FACE_LOCK_MESSAGE);
  assert.equal(animeFaceVerdict('{"faceAnime":true,"sceneAnime":true,"bothAdult":false,"realPhoto":false}').error, FACE_AGE_MESSAGE);
});

test("a photo or a non-adult pair stays locked before any face swap", async () => {
  const photo = await readAnimeFaces(PNG, PNG, {
    env: ENV,
    fetchImpl: async () => jsonReply('{"faceAnime":true,"sceneAnime":true,"bothAdult":true,"realPhoto":true}'),
  });
  assert.equal(photo.ok, false);
  assert.equal(photo.error, FACE_LOCK_MESSAGE);
  const young = await readAnimeFaces(PNG, PNG, {
    env: ENV,
    fetchImpl: async () => jsonReply('{"faceAnime":true,"sceneAnime":true,"bothAdult":false,"realPhoto":false}'),
  });
  assert.equal(young.error, FACE_AGE_MESSAGE);
});

test("only an adult anime pair is allowed, and the check uses the fixed question", async () => {
  let seen = null;
  const result = await readAnimeFaces(PNG, PNG, {
    env: ENV,
    fetchImpl: async (url, init) => {
      seen = { url: String(url), body: JSON.parse(init.body) };
      return jsonReply('{"faceAnime":true,"sceneAnime":true,"bothAdult":true,"realPhoto":false}');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen.url, "https://open-sealion.aiaigirl.com/v1/chat/completions");
  assert.equal(seen.body.messages[0].content.includes("二次元"), true);
  assert.equal(seen.body.messages[1].content[1].type, "image_url");
  assert.equal(seen.body.messages[1].content[2].type, "image_url");
});

test("a missing key, a wrong host, or a failed check stays locked", async () => {
  let called = false;
  const missing = await readAnimeFaces(PNG, PNG, {
    env: {},
    fetchImpl: async () => { called = true; return jsonReply("{}"); },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, FACE_CLOSED_MESSAGE);
  assert.equal(called, false);
  const wrongHost = await readAnimeFaces(PNG, PNG, {
    env: { ...ENV, SEALION_BASE_URL: "https://example.com/v1" },
    fetchImpl: async () => { called = true; return jsonReply("{}"); },
  });
  assert.equal(wrongHost.error, FACE_CLOSED_MESSAGE);
  assert.equal(called, false);
  const bad = await readAnimeFaces("not-an-image", PNG, { env: ENV, fetchImpl: async () => { called = true; } });
  assert.equal(bad.status, 400);
  assert.equal(called, false);
});

test("missing or unclear answers stay locked", () => {
  assert.equal(animeFaceVerdict("看不清").error, FACE_CLOSED_MESSAGE);
  assert.equal(animeFaceVerdict('{"faceAnime":true,"sceneAnime":true,"realPhoto":false}').error, FACE_AGE_MESSAGE);
  assert.equal(animeFaceVerdict('{"faceAnime":"true","sceneAnime":true,"bothAdult":true,"realPhoto":false}').error, FACE_LOCK_MESSAGE);
});
