import assert from "node:assert/strict";
import test from "node:test";
import { assistantRepliedAfter, generationStillOpen, nextCompanionPollDelay, nextHealthRetryDelay, nextSendRetryDelay, quietSessionPoll, REPLY_GRACE_MS, recoveryFacts, retryAfterMs, sendAttemptLimit, shouldWakeParked, STARTING_SEND_ATTEMPTS } from "../../../src/app/xumeng/girlfriend/companion-poll.ts";

test("a healthy visible chat keeps the short follow-up interval", () => {
  assert.equal(nextCompanionPollDelay({ failures: 0, followUp: true, visible: true }), 2_000);
  assert.equal(nextCompanionPollDelay({ failures: 0, followUp: false, visible: true }), 8_000);
  assert.equal(nextCompanionPollDelay({ failures: 0, followUp: true, visible: false }), 20_000);
});

test("a failing session poll backs off and honors Retry-After", () => {
  assert.equal(nextCompanionPollDelay({ failures: 1, followUp: true, visible: true }), 16_000);
  assert.equal(nextCompanionPollDelay({ failures: 4, followUp: true, visible: true }), 120_000);
  assert.equal(nextCompanionPollDelay({ failures: 1, followUp: true, visible: true, retryAfterMs: 30_000 }), 30_000);
  assert.equal(nextCompanionPollDelay({ failures: 3, followUp: true, visible: true, retryAfterMs: 5_000 }), 64_000);
});

test("health retries stretch out but stay inside the boot window", () => {
  assert.deepEqual([1, 2, 3, 4, 8].map(nextHealthRetryDelay), [1_000, 2_000, 4_000, 8_000, 8_000]);
});

test("a checkpoint wake stays quiet and a missing snapshot is reported only when the host says so", () => {
  assert.equal(quietSessionPoll("CONTAINER_STARTING"), true);
  assert.equal(quietSessionPoll("NATIVE_NOT_READY"), true);
  assert.equal(quietSessionPoll("RECOVERY_REVIEW_REQUIRED"), false);
  assert.deepEqual(recoveryFacts({ snapshotVerified: false, deliveryAmbiguous: false }), { snapshotVerified: false, deliveryAmbiguous: false });
  assert.deepEqual(recoveryFacts({ error: "聊天恢复需要核查" }), {});
});

test("a delivered user line keeps the first generation open until an assistant reply follows", () => {
  const sent = new Date(1_000).toISOString();
  const pending = [{ state: "accepted", createdAt: sent }];
  assert.equal(assistantRepliedAfter([{ id: "req", role: "user", text: "在吗", requestId: "req" }], "req"), false);
  assert.equal(assistantRepliedAfter([
    { id: "req", role: "user", text: "在吗", requestId: "req" },
    { id: "reply", role: "assistant", text: "在" },
  ], "req"), true);
  assert.equal(generationStillOpen(pending, 1_000 + REPLY_GRACE_MS - 1), true);
  assert.equal(generationStillOpen(pending, 1_000 + REPLY_GRACE_MS), false);
  assert.equal(generationStillOpen([{ state: "uncertain", createdAt: sent }], 1_000), false);
});

test("a booting engine keeps the same send alive longer than two eight-second tries", () => {
  assert.equal(sendAttemptLimit("CONTAINER_STARTING"), STARTING_SEND_ATTEMPTS);
  assert.equal(sendAttemptLimit("NATIVE_NOT_READY"), STARTING_SEND_ATTEMPTS);
  assert.equal(sendAttemptLimit("BILLING_UNAVAILABLE"), 2);
  const waits = Array.from({ length: STARTING_SEND_ATTEMPTS }, (_, attempt) => nextSendRetryDelay("CONTAINER_STARTING", attempt));
  const covered = waits.reduce((sum, wait) => sum + wait, 0);
  assert.ok(covered >= 17_200);
  assert.equal(nextSendRetryDelay("BILLING_UNAVAILABLE", 0), 8_000);
});

test("focusing a parked chat wakes it once", () => {
  assert.equal(shouldWakeParked(true, false), true);
  assert.equal(shouldWakeParked(true, true), false);
  assert.equal(shouldWakeParked(undefined, false), false);
});

test("Retry-After accepts seconds and an HTTP date", () => {
  assert.equal(retryAfterMs("30"), 30_000);
  assert.equal(retryAfterMs("Thu, 05 Nov 2026 03:00:30 GMT", Date.parse("Thu, 05 Nov 2026 03:00:00 GMT")), 30_000);
  assert.equal(retryAfterMs("soon"), undefined);
});
