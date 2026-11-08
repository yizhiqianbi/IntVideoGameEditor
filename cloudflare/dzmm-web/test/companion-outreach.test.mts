import test from "node:test";
import assert from "node:assert/strict";
import { reviveDue, type ReviveLane } from "../../xumeng-companion/src/outreach";

function lane(patch: Partial<ReviveLane> = {}): ReviveLane {
  return {
    accountId: "4c7c7b4e-5c9b-451c-98f9-632dc4f65212", profile: "cast-qiaowan",
    sessionId: "a86b6c7b-31d7-45e5-9b62-956fbcb8a9d7",
    lastUserAt: 0, lastUserText: "晚安，先忙", lastSeenAt: 0, lastRevivedAt: 0, lastAttemptAt: 0, quiet: true, ...patch,
  };
}

test("revival keeps every session, including ones already woken or told to stop", () => {
  const quiet = lane({ sessionId: "a86b6c7b-31d7-45e5-9b62-956fbcb8a9d7", lastAttemptAt: 20 });
  const revived = lane({ sessionId: "b86b6c7b-31d7-45e5-9b62-956fbcb8a9d8", lastRevivedAt: 99, lastUserAt: 10, quiet: false, lastAttemptAt: 5 });
  const fresh = lane({ sessionId: "c86b6c7b-31d7-45e5-9b62-956fbcb8a9d9", quiet: false, lastAttemptAt: 0 });
  assert.deepEqual(reviveDue([quiet, revived, fresh]).map(item => item.sessionId), [fresh.sessionId, revived.sessionId, quiet.sessionId]);
});
