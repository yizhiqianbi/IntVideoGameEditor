import test from "node:test";
import assert from "node:assert/strict";
import mediaModule from "./dzmm-chat-media";
const { parseDzmmChatMediaAsset, parseDzmmChatMediaOverview, fingerprintDzmmMediaText, resolveDzmmChatMediaResult } = mediaModule as typeof import("./dzmm-chat-media");
const asset = { id: "asset-123", conversationId: "conversation-1", messageId: "message-1", kind: "audio",
  url: "/api/backend/v1/chat-media/assets/asset-123", sourceHash: "ab".repeat(32), createdAt: 1_000,
  mimeType: "audio/mpeg", audioTextChars: 120, totalTextChars: 200 };
const overview = { accountId: "account-1", conversationId: "conversation-1", vip: { active: true, expiresAt: 9_000, adminPreview: false },
  features: { audio: true, image: true }, limits: { audio: 20, image: 5, maxVoiceChars: 800 }, usage: { audio: 1, image: 0 }, assets: [asset] };

test("private voice and image metadata keeps message identity and partial narration counts", () => {
  assert.deepEqual(parseDzmmChatMediaOverview(overview, "account-1", "conversation-1"), overview);
  const image = { ...asset, kind: "image", mimeType: "image/png" };
  assert.equal(parseDzmmChatMediaAsset(image, "conversation-1").kind, "image");
  assert.equal(parseDzmmChatMediaAsset({ ...asset, mimeType: "audio/wav" }, "conversation-1").mimeType, "audio/wav");
});
test("foreign-account and foreign-conversation responses cannot reach a media panel", () => {
  assert.throws(() => parseDzmmChatMediaOverview(overview, "account-2", "conversation-1"));
  assert.throws(() => parseDzmmChatMediaOverview(overview, "account-1", "conversation-2"));
  assert.throws(() => parseDzmmChatMediaAsset({ ...asset, conversationId: "conversation-2" }, "conversation-1"));
});
test("media links cannot redirect users or leak a login cookie to an external host", () => {
  for (const url of ["https://example.invalid/audio.mp3", "//example.invalid/audio.mp3", "javascript:alert(1)",
    "/api/backend/v1/chat-media/assets/other", `${asset.url}?token=secret`, `${asset.url}#fragment`])
    assert.throws(() => parseDzmmChatMediaAsset({ ...asset, url }, "conversation-1"));
});
test("bad MIME, hashes, timestamps and malformed member quotas fail instead of showing broken media", () => {
  for (const change of [{ mimeType: "text/html" }, { kind: "image" }, { sourceHash: "not-a-fingerprint" },
    { createdAt: -1 }, { audioTextChars: "120" }, { id: "../asset-123" }])
    assert.throws(() => parseDzmmChatMediaAsset({ ...asset, ...change }, "conversation-1"));
  for (const change of [{ vip: { ...overview.vip, active: "true" } }, { usage: { audio: -1, image: 0 } },
    { assets: [asset, asset] }, { features: { audio: true } }])
    assert.throws(() => parseDzmmChatMediaOverview({ ...overview, ...change }, "account-1", "conversation-1"));
});
test("source text fingerprints match the server SHA256 and invalidate after editing", async () => {
  const { createHash } = await import("node:crypto");
  const source = "你好，窗外下着雨。🌧️";
  assert.equal(await fingerprintDzmmMediaText(source), createHash("sha256").update(source).digest("hex"));
  assert.notEqual(await fingerprintDzmmMediaText(source), await fingerprintDzmmMediaText(`${source}灯亮了。`));
});


test("Super media entitlement preserves unlimited markers without changing service availability", () => {
  const body = { ...overview, quotaUnlimited: true, vip: { active: false, expiresAt: null, adminPreview: true, unlimited: true }, features: { audio: false, image: true } };
  const parsed = parseDzmmChatMediaOverview(body, "account-1", "conversation-1");
  assert.equal(parsed.quotaUnlimited, true); assert.equal(parsed.vip.unlimited, true);
  assert.equal(parsed.features.audio, false);
  for (const fields of [{ quotaUnlimited: "true" }, { vip: { ...body.vip, unlimited: 1 } }, { vip: { ...body.vip, unlimited: false } }])
    assert.throws(() => parseDzmmChatMediaOverview({ ...body, ...fields }, "account-1", "conversation-1"));
});

const pending = { id: "asset-pending", messageId: "message-2", kind: "image", sourceHash: "cd".repeat(32), expiresAt: 12_000 };
test("pending directory metadata stays safe and optional for older servers", () => {
  const parsed = parseDzmmChatMediaOverview({ ...overview, pending: [{ ...pending, objectKey: "private-key", processingToken: "private-token" }] }, "account-1", "conversation-1");
  assert.deepEqual(parsed.pending, [pending]);
  const legacy = parseDzmmChatMediaOverview(overview, "account-1", "conversation-1");
  assert.equal(Object.hasOwn(legacy, "pending"), false);
  assert.deepEqual(parseDzmmChatMediaOverview({ ...overview, pending: [] }, "account-1", "conversation-1").pending, []);
});
test("malformed and duplicate pending identities fail instead of blocking unrelated messages", () => {
  for (const change of [{ id: "../pending" }, { id: "" }, { messageId: "" }, { kind: "video" },
    { sourceHash: "not-a-hash" }, { expiresAt: -1 }, { expiresAt: "12000" }])
    assert.throws(() => parseDzmmChatMediaOverview({ ...overview, pending: [{ ...pending, ...change }] }, "account-1", "conversation-1"));
  for (const value of [null, {}, [pending, pending]])
    assert.throws(() => parseDzmmChatMediaOverview({ ...overview, pending: value }, "account-1", "conversation-1"));
  assert.throws(() => parseDzmmChatMediaOverview({ ...overview, pending: [pending] }, "account-2", "conversation-1"));
});
test("result recovery binds message, kind and full source hash and prefers a completed asset", () => {
  const body = parseDzmmChatMediaOverview({ ...overview, pending: [pending] }, "account-1", "conversation-1");
  const target = { messageId: pending.messageId, kind: "image" as const, sourceHash: pending.sourceHash };
  assert.equal(resolveDzmmChatMediaResult(body, target).state, "pending");
  for (const change of [{ messageId: "another-message" }, { kind: "audio" as const }, { sourceHash: "ef".repeat(32) }])
    assert.equal(resolveDzmmChatMediaResult(body, { ...target, ...change }).state, "absent");
  const ready = { ...asset, ...target, id: pending.id, url: `/api/backend/v1/chat-media/assets/${pending.id}`, mimeType: "image/png" };
  const completed = parseDzmmChatMediaOverview({ ...overview, assets: [ready], pending: [pending] }, "account-1", "conversation-1");
  assert.deepEqual(resolveDzmmChatMediaResult(completed, target), { state: "ready", asset: ready });
});
test("an omitted pending field remains unknown and client time cannot release a server reservation", () => {
  const target = { messageId: pending.messageId, kind: "image" as const, sourceHash: pending.sourceHash };
  const legacy = parseDzmmChatMediaOverview(overview, "account-1", "conversation-1");
  assert.equal(resolveDzmmChatMediaResult(legacy, target).state, "unknown");
  assert.equal(resolveDzmmChatMediaResult({ ...legacy, pending: [] }, target).state, "absent");
  const reserved = parseDzmmChatMediaOverview({ ...overview, pending: [{ ...pending, expiresAt: 1 }] }, "account-1", "conversation-1");
  assert.equal(resolveDzmmChatMediaResult(reserved, target).state, "pending");
});
