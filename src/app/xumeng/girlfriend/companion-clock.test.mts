import assert from "node:assert/strict";
import test from "node:test";
import { companionClockLabel, companionClockVisible } from "./companion-clock.ts";

const sameDay = "2026-10-30T02:00:00.000Z";
const nineMinutes = "2026-10-30T02:09:00.000Z";
const tenMinutes = "2026-10-30T02:10:00.000Z";
const beforeMidnight = "2026-10-30T15:55:00.000Z";
const afterMidnight = "2026-10-30T16:04:00.000Z";

test("companion clocks appear on the first message, after ten minutes, and across a Beijing day", () => {
  assert.equal(companionClockVisible(sameDay), true);
  assert.equal(companionClockVisible(""), false);
  assert.equal(companionClockVisible(nineMinutes, sameDay), false);
  assert.equal(companionClockVisible(tenMinutes, sameDay), true);
  assert.equal(companionClockVisible(afterMidnight, beforeMidnight), true);
});

test("companion clock labels use Beijing time", () => {
  assert.equal(companionClockLabel(sameDay, "2026-10-30T06:00:00.000Z"), "上午10:00");
  assert.equal(companionClockLabel(sameDay, "2026-10-31T02:00:00.000Z"), "昨天 上午10:00");
});
