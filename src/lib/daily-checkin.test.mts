import test from "node:test";
import assert from "node:assert/strict";
import daily from "./daily-checkin";

const { checkinRewards, checkinDay, previousCheckinDay, checkinStatus, CHECKIN_CYCLE_DAYS } = daily as typeof import("./daily-checkin");

test("default cycle matches the advertised 7-day rewards", () => {
  assert.deepEqual(checkinRewards(50), [50, 80, 80, 50, 50, 50, 130]);
  assert.equal(checkinRewards(50).reduce((sum, value) => sum + value, 0), 490);
});

test("day index wraps after a completed cycle", () => {
  assert.equal(checkinDay(0, false), 1);
  assert.equal(checkinDay(3, false), 4);
  assert.equal(checkinDay(7, false), 1);
  assert.equal(checkinDay(7, true), 7);
  assert.equal(checkinDay(8, true), 1);
});

test("previous day keys handle month and leap-year boundaries", () => {
  assert.equal(previousCheckinDay("2026-03-01"), "2026-02-28");
  assert.equal(previousCheckinDay("2024-03-01"), "2024-02-29");
  assert.equal(previousCheckinDay("2026-01-01"), "2025-12-31");
});

test("consecutive days build a streak and a gap breaks it", () => {
  const today = "2026-11-21";
  const streak = checkinStatus(["2026-11-19", "2026-11-20"], today);
  assert.equal(streak.streak, 2);
  assert.equal(streak.day, 3);
  assert.equal(streak.claimedToday, false);
  assert.equal(streak.todayReward, 80);

  const broken = checkinStatus(["2026-11-17", "2026-11-18"], today);
  assert.equal(broken.streak, 0);
  assert.equal(broken.day, 1);

  const claimed = checkinStatus(["2026-11-19", "2026-11-20", "2026-11-21"], today);
  assert.equal(claimed.claimedToday, true);
  assert.equal(claimed.streak, 3);
  assert.equal(claimed.day, 3);
  assert.equal(claimed.todayReward, 80);
});

test("a full cycle restarts at day one", () => {
  const days = ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
  const status = checkinStatus(days, "2026-11-21");
  assert.equal(status.streak, 7);
  assert.equal(status.day, 1);
  assert.equal(status.todayReward, 50);
  assert.equal(status.rewards.length, CHECKIN_CYCLE_DAYS);
});
