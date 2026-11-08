// node --experimental-strip-types --import ./src/lib/register-ts-extension.mjs --test src/lib/character-heat.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { completedRounds, successfulRoundDeltas } from "./character-heat.ts";

test("a round is a user message answered by the next assistant message", () => {
  assert.equal(completedRounds([{ role: "user" }, { role: "assistant" }, { role: "user" }]), 1);
  assert.equal(completedRounds([{ role: "assistant" }, { role: "user" }, { role: "assistant" }]), 1);
});

test("the first sync of a conversation does not dump old history into today", () => {
  const next = [{ id: "new", characterId: "c", messages: [{ role: "user" as const }, { role: "assistant" as const }] }];
  assert.deepEqual(successfulRoundDeltas([], next), []);
  const previous = [{ id: "old", characterId: "c", messages: [{ role: "user" as const }] }];
  const answered = [{ id: "old", characterId: "c", messages: [{ role: "user" as const }, { role: "assistant" as const }] }];
  assert.deepEqual(successfulRoundDeltas(previous, answered), [{ characterId: "c", rounds: 1 }]);
  assert.deepEqual(successfulRoundDeltas(answered, answered), []);
  assert.deepEqual(successfulRoundDeltas(previous, [{ id: "old", characterId: "", messages: answered[0]!.messages }]), []);
});
