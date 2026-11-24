import test from "node:test";
import assert from "node:assert/strict";
import cache from "./xumeng-recommendation-cache";

const { readCachedRecommendation, writeCachedRecommendation, RECOMMENDATION_CACHE_TTL_MS } = cache as typeof import("./xumeng-recommendation-cache");
const page = { ids: ["a", "b"], reasons: { a: "same_tag" }, personalized: true, hiddenIds: ["x"] };

test("cached recommendation round-trips per account and key", () => {
  writeCachedRecommendation("u1", "home", page as never);
  const hit = readCachedRecommendation("u1", "home");
  assert.deepEqual(hit?.page.ids, ["a", "b"]);
  assert.equal(hit?.page.personalized, true);
  assert.equal(readCachedRecommendation("u2", "home"), null);
  assert.equal(readCachedRecommendation("u1", "ranking"), null);
});

test("cached recommendation expires after the TTL", () => {
  const now = Date.now();
  writeCachedRecommendation("u3", "home", page as never, now);
  assert.ok(readCachedRecommendation("u3", "home", now + 1000));
  assert.equal(readCachedRecommendation("u3", "home", now + RECOMMENDATION_CACHE_TTL_MS + 1), null);
});
