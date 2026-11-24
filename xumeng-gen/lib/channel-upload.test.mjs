import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FACE_VIDEO_MAX_BYTES,
  UPLOAD_TTL_SECONDS,
  mediaOriginProblem,
  mediaUrlProblem,
  ticketProblem,
  uploadSignature,
  uploadTicket,
} from "./channel-upload.mjs";

const SECRET = "test-secret";
const WORKER = "https://channel-media.xumengchat.top";

test("upload signatures match the worker HMAC contract", () => {
  assert.equal(
    uploadSignature(SECRET, 1700000000, 1048576),
    "a0eb1b5ac1d7d4527c02ed70dcf87f3ade8ca3342e5b8ab1f25a863e444d70ec",
  );
});

test("a ticket points at the signed direct upload endpoint", () => {
  const now = 1_700_000_000_000;
  const ticket = uploadTicket(SECRET, WORKER, 2_000_000, now);
  const url = new URL(ticket.url);
  assert.equal(url.origin, WORKER);
  assert.equal(url.pathname, "/api/studio/upload");
  assert.equal(url.searchParams.get("bytes"), "2000000");
  assert.equal(Number(url.searchParams.get("exp")), 1_700_000_000 + UPLOAD_TTL_SECONDS);
  assert.equal(url.searchParams.get("sig"), uploadSignature(SECRET, 1_700_000_000 + UPLOAD_TTL_SECONDS, 2_000_000));
  assert.equal(ticket.maxBytes, FACE_VIDEO_MAX_BYTES);
});

test("tickets are rejected when expired, oversized, or tampered with", () => {
  const now = Math.floor(Date.now() / 1000);
  const good = { secret: SECRET, expires: now + 60, bytes: 2_000_000, signature: uploadSignature(SECRET, now + 60, 2_000_000), now };
  assert.equal(ticketProblem(good), "");
  assert.match(ticketProblem({ ...good, expires: now - 1 }), /过期/);
  assert.match(ticketProblem({ ...good, signature: "0".repeat(64) }), /无效/);
  assert.match(ticketProblem({ ...good, bytes: FACE_VIDEO_MAX_BYTES + 1, signature: "" }), /太大/);
  assert.match(ticketProblem({ ...good, secret: "" }), /密钥/);
});

test("oversized and tiny videos never get a ticket", () => {
  assert.throws(() => uploadTicket(SECRET, WORKER, FACE_VIDEO_MAX_BYTES + 1), /64MB/);
  assert.throws(() => uploadTicket(SECRET, WORKER, 10), /64MB/);
});

test("the media origin must be https or a local dev worker", () => {
  assert.equal(mediaOriginProblem(WORKER), "");
  assert.equal(mediaOriginProblem("http://127.0.0.1:8787"), "");
  assert.match(mediaOriginProblem("http://channel-media.xumengchat.top"), /地址无效/);
  assert.match(mediaOriginProblem("not a url"), /地址无效/);
});

test("only files hosted by the media worker are accepted as video sources", () => {
  const hosted = `${WORKER}/api/studio/media/0feae679-cd7f-4fc0-90fb-6f8d8d9bacf2`;
  assert.equal(mediaUrlProblem(hosted, WORKER), "");
  assert.match(mediaUrlProblem("https://evil.example/api/studio/media/0feae679-cd7f-4fc0-90fb-6f8d8d9bacf2", WORKER), /无效/);
  assert.match(mediaUrlProblem(`${WORKER}/api/public/huanlian`, WORKER), /无效/);
  assert.match(mediaUrlProblem("http://channel-media.xumengchat.top/api/studio/media/0feae679-cd7f-4fc0-90fb-6f8d8d9bacf2", WORKER), /无效/);
});
