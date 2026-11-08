// node --experimental-strip-types --import ./src/lib/register-ts-extension.mjs --test src/lib/xumeng-recommendations.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { recommendationShelfTags } from "./xumeng-shelf-tags.ts";
import {
  isPublicRecommendationCharacter, rankXumengRecommendations, recommendationDay, recommendationWindowStart,
  toRecommendationCandidate, type RecommendationCandidate, type RecommendationDaily,
} from "./xumeng-recommendations.ts";

const NOW = Date.parse("2026-10-28T12:00:00+08:00");
const TODAY = "2026-10-28";
const OLD = Date.parse("2020-01-01T00:00:00Z");

function card(id: string, tags: string[], authorId = id, createdAt = OLD): RecommendationCandidate {
  return { id, tags, authorId, createdAt, listed: true };
}

function daily(id: string, row: Partial<RecommendationDaily> & { day?: string }): [string, RecommendationDaily[]] {
  return [id, [{ day: row.day ?? TODAY, qualified: row.qualified ?? 0, likes: row.likes ?? 0, favorites: row.favorites ?? 0 }]];
}

test("Shanghai windows use the calendar week and ignore display numbers", () => {
  assert.equal(recommendationDay(NOW), TODAY);
  assert.equal(recommendationDay(Date.parse("2026-10-27T16:30:00Z")), TODAY);
  assert.equal(new Date(recommendationWindowStart("week", NOW)!).toISOString(), "2026-10-25T16:00:00.000Z");
  assert.equal(recommendationWindowStart("day", NOW), Date.parse("2026-10-28T00:00:00+08:00"));
  assert.deepEqual(recommendationShelfTags(["NSFW", "男性向", "剧情", "校园", "古风"]), ["古风"]);
});

test("private, retired, and minor-coded cards never become candidates", () => {
  assert.equal(isPublicRecommendationCharacter({ id: "local-1", tags: ["古风"], sourceKind: "original" }), false);
  assert.equal(isPublicRecommendationCharacter({ id: "kept", tags: ["古风"], sourceKind: "original", catalogReadiness: "metadata-only" }), false);
  assert.equal(isPublicRecommendationCharacter({ id: "mine", tags: ["古风"], sourceKind: "original", authoringDraft: { entries: [] } }), false);
  assert.equal(isPublicRecommendationCharacter({ id: "campus", tags: ["校园", "古风"], sourceKind: "public-summary" }), false);
  assert.equal(isPublicRecommendationCharacter({ id: "published-11111111-1111-1111-1111-111111111111", tags: ["古风"], sourceKind: "original", publication: { id: "published" } }), true);
  assert.equal(toRecommendationCandidate({ id: "local-hidden", tags: ["古风"], authorId: "a", createdAt: OLD, listed: true }), null);
  assert.equal(toRecommendationCandidate({ id: "visible", tags: ["校园"], authorId: "a", createdAt: OLD, listed: true }), null);
  assert.equal(toRecommendationCandidate({ id: "visible", tags: ["古风"], authorId: "a", createdAt: OLD, listed: false }), null);
});

test("hard filters drop blocked, hidden, minor, and private cards before scoring", () => {
  const result = rankXumengRecommendations({
    surface: "home", now: NOW, blockedTags: ["古风"], hiddenIds: ["hidden"],
    candidates: [
      card("blocked", ["古风", "修仙"]),
      card("minor", ["校园", "修仙"]),
      { ...card("private", ["修仙"]), listed: false },
      { ...card("local-secret", ["修仙"]), listed: true },
      card("hidden", ["修仙"]),
      card("kept", ["修仙"]),
    ],
    daily: new Map([
      daily("blocked", { likes: 50 }), daily("minor", { likes: 50 }), daily("private", { likes: 50 }),
      daily("hidden", { likes: 50 }), daily("kept", { likes: 1 }),
    ]),
  });
  assert.deepEqual(result.ids, ["kept"]);
  assert.equal(result.personalized, false);
});

test("one like does not outrank a qualified chat, and ranking ignores favorites and other days", () => {
  const candidates = [card("later", ["修仙"]), card("earlier", ["都市"]), card("saved", ["纯爱"]), card("yesterday", ["西幻"])];
  const home = rankXumengRecommendations({
    surface: "home", now: NOW, candidates,
    daily: new Map([
      daily("earlier", { likes: 1 }),
      daily("later", { qualified: 1 }),
      daily("saved", { favorites: 20 }),
    ]),
  });
  assert.ok(home.ids.indexOf("later") < home.ids.indexOf("earlier"));
  assert.equal(home.reasons.later, "quality");

  const day = rankXumengRecommendations({
    surface: "ranking", period: "day", now: NOW, candidates,
    daily: new Map([
      daily("later", { qualified: 1 }),
      daily("yesterday", { day: "2026-10-27", likes: 30 }),
      daily("saved", { favorites: 20 }),
      daily("earlier", { likes: 1 }),
    ]),
  });
  assert.deepEqual(day.ids, ["later", "earlier"]);
  assert.equal(day.reasons.later, "ranking");

  const week = rankXumengRecommendations({
    surface: "ranking", period: "week", now: NOW, candidates,
    daily: new Map([
      daily("yesterday", { day: "2026-10-25", likes: 1 }),
      daily("earlier", { day: "2026-10-26", likes: 1 }),
    ]),
  });
  assert.deepEqual(week.ids, ["earlier"]);
  assert.deepEqual(rankXumengRecommendations({ surface: "ranking", period: "all", now: NOW, candidates: [card("none", ["都市"])] }).ids, []);
});

test("ranking keeps score order for one author instead of spreading the shelf", () => {
  const candidates = ["a1", "a2", "a3", "b"].map((id) => card(id, ["都市"], "same"));
  const result = rankXumengRecommendations({
    surface: "ranking", period: "all", now: NOW, candidates,
    daily: new Map([
      daily("a1", { likes: 30 }), daily("a2", { likes: 20 }), daily("a3", { likes: 10 }), daily("b", { likes: 9 }),
    ]),
  });
  assert.deepEqual(result.ids, ["a1", "a2", "a3", "b"]);
});

test("personal ranking waits for three positives and ignores generic tags", () => {
  const positives = ["p1", "p2", "p3"].map((id) => card(id, ["古风"], id));
  const candidates = [...positives, card("match", ["古风"], "match"), card("generic", ["NSFW", "男性向", "剧情"], "generic"), card("other", ["修仙"], "other")];
  const activity = new Map([daily("other", { likes: 1 })]);
  const cold = rankXumengRecommendations({ surface: "for_you", now: NOW, candidates, positiveIds: ["p1", "p2"], daily: activity });
  assert.equal(cold.personalized, false);
  assert.ok(cold.ids.indexOf("other") < cold.ids.indexOf("match"));

  const warm = rankXumengRecommendations({ surface: "for_you", now: NOW, candidates, positiveIds: ["p1", "p2", "p3"], daily: activity });
  assert.equal(warm.personalized, true);
  const home = rankXumengRecommendations({ surface: "home", now: NOW, candidates, positiveIds: ["p1", "p2", "p3"], daily: activity });
  assert.equal(home.personalized, false);
  assert.ok(warm.ids.indexOf("match") < warm.ids.indexOf("other"));
  assert.equal(warm.reasons.match, "same_tag");
  assert.equal(warm.reasons.generic, "quality");
  assert.ok(warm.ids.indexOf("match") < warm.ids.indexOf("generic"));
});

test("co-occurrence, follows, and author matches are separate reasons", () => {
  const positives = ["p1", "p2", "p3"].map((id) => card(id, ["古风"], `author-${id}`));
  const candidates = [
    ...positives,
    card("also", ["修仙"], "also"),
    card("once", ["都市"], "once"),
    card("followed", ["纯爱"], "followed-author"),
    card("same", ["西幻"], "author-p1"),
    card("plain", ["冒险"], "plain"),
  ];
  const result = rankXumengRecommendations({
    surface: "for_you", now: NOW, candidates, positiveIds: ["p1", "p2", "p3"],
    followedAuthorIds: ["followed-author"],
    cooccurrence: new Map([["also", 2], ["once", 1]]),
  });
  assert.equal(result.reasons.also, "also_chatted");
  assert.equal(result.reasons.followed, "followed_author");
  assert.equal(result.reasons.same, "same_author");
  assert.ok(result.ids.indexOf("also") < result.ids.indexOf("once"));
  assert.ok(result.ids.indexOf("followed") < result.ids.indexOf("plain"));
  assert.equal(result.reasons.once, "quality");
});

test("a minor-only overlap is not a similarity reason", () => {
  const result = rankXumengRecommendations({
    surface: "home", now: NOW,
    candidates: [card("anchor", ["校园"]), card("other", ["修仙"])],
    positiveIds: ["anchor", "missing-2", "missing-3"],
  });
  assert.equal(result.personalized, false);
  assert.deepEqual(result.ids, ["other"]);
});

test("related recommendations use the open card and drop the card itself", () => {
  const seed = card("seed", ["古风"], "seed");
  const result = rankXumengRecommendations({
    surface: "related", now: NOW, seedId: "seed",
    candidates: [seed, card("match", ["古风"], "match"), card("other", ["修仙"], "other")],
    daily: new Map([daily("other", { qualified: 3 })]),
  });
  assert.equal(result.personalized, true);
  assert.equal(result.ids.includes("seed"), false);
  assert.equal(result.reasons.match, "same_tag");
  assert.ok(result.ids.indexOf("match") < result.ids.indexOf("other"));
  assert.deepEqual(rankXumengRecommendations({
    surface: "related", now: NOW, seedId: "seed", blockedTags: ["古风"], candidates: [seed, card("match", ["古风"])],
  }).ids, []);
  assert.deepEqual(rankXumengRecommendations({
    surface: "related", now: NOW, seedId: "missing", candidates: [card("match", ["古风"])],
  }).ids, []);
});

test("new cards reserve two exploration slots without beating a real qualified chat", () => {
  const old = Array.from({ length: 10 }, (_, index) => card(`old-${index}`, [`标签${index}`], `author-${index}`));
  const fresh = card("fresh", ["新"], "fresh-author", NOW);
  const hotFresh = card("hot-fresh", ["热"], "hot-author", NOW);
  const explored = rankXumengRecommendations({
    surface: "home", now: NOW, candidates: [...old, fresh],
    daily: new Map(old.map((item) => daily(item.id, { qualified: 2 }))),
  });
  assert.ok(explored.ids.indexOf("fresh") < 8);
  assert.equal(explored.reasons.fresh, "explore");
  assert.ok(explored.ids.indexOf("old-0") < explored.ids.indexOf("fresh"));

  const natural = rankXumengRecommendations({
    surface: "for_you", now: NOW, candidates: [...old, hotFresh],
    daily: new Map([...old.map((item) => daily(item.id, { likes: 1 })), daily("hot-fresh", { qualified: 6 })]),
  });
  assert.equal(natural.ids[0], "hot-fresh");
  assert.equal(natural.reasons["hot-fresh"], "quality");
});

test("a visitor with no positives is ordered by decayed quality", () => {
  const result = rankXumengRecommendations({
    surface: "home", now: NOW, positiveIds: [],
    candidates: [card("low", ["都市"]), card("high", ["修仙"])],
    daily: new Map([daily("low", { likes: 1 }), daily("high", { qualified: 2 })]),
  });
  assert.equal(result.personalized, false);
  assert.ok(result.ids.indexOf("high") < result.ids.indexOf("low"));
  assert.equal(result.reasons.high, "quality");
});

test("tag and id filters stay inside the requested subset", () => {
  const candidates = [card("a", ["古风"]), card("b", ["修仙"]), card("c", ["古风", "修仙"]), card("fresh", ["古风"], "fresh-author", NOW)];
  const tagged = rankXumengRecommendations({
    surface: "home", now: NOW, candidates, tags: ["古风"],
    daily: new Map([daily("b", { qualified: 9 })]),
  });
  assert.equal(tagged.ids.includes("b"), false);
  assert.ok(tagged.ids.includes("a"));
  assert.ok(tagged.ids.includes("c"));

  const searched = rankXumengRecommendations({
    surface: "search", now: NOW, candidates, allowedIds: ["b"],
    daily: new Map([daily("a", { qualified: 9 }), daily("b", { likes: 1 })]),
  });
  assert.deepEqual(searched.ids, ["b"]);

  const category = rankXumengRecommendations({
    surface: "category", now: NOW, candidates, allowedIds: ["a", "fresh"],
    daily: new Map([daily("a", { qualified: 3 })]),
  });
  assert.deepEqual(category.ids.includes("b"), false);
  assert.deepEqual(category.ids.includes("c"), false);
  assert.ok(category.ids.indexOf("a") < category.ids.indexOf("fresh"));
  assert.notEqual(category.reasons.fresh, "explore");
});

test("only the home shelf reserves fresh cards", () => {
  const old = Array.from({ length: 10 }, (_, index) => card(`old-${index}`, [`标签${index}`], `author-${index}`));
  const fresh = card("fresh", ["新"], "fresh-author", NOW);
  const rows = new Map(old.map((item) => daily(item.id, { qualified: 2 })));
  for (const surface of ["for_you", "search", "category"] as const) {
    const result = rankXumengRecommendations({ surface, now: NOW, candidates: [...old, fresh], daily: rows });
    assert.ok(result.ids.indexOf("fresh") >= 8, surface);
    assert.notEqual(result.reasons.fresh, "explore");
  }
});

test("home shelf places one new card after every three heated cards", () => {
  const heated = ["a", "b", "c", "d", "e", "f"].map((id, index) => card(id, ["古风"]));
  const fresh = [card("n1", ["新"], "n1", NOW - 1000), card("n2", ["新"], "n2", NOW - 2000)];
  const rows = new Map(heated.map((item, index) => [item.id, [{ day: TODAY, qualified: 0, likes: 0, favorites: 0, rounds: 12 - index }]]));
  const result = rankXumengRecommendations({ surface: "home", now: NOW, candidates: [...heated, ...fresh], daily: rows });
  assert.deepEqual(result.ids.slice(0, 3), ["a", "b", "c"]);
  assert.deepEqual(result.ids.slice(4, 7), ["d", "e", "f"]);
  assert.deepEqual([result.ids[3], result.ids[7]].sort(), ["n1", "n2"]);
  assert.equal(result.reasons[result.ids[3]!], "explore");
  assert.equal(result.reasons.a, "quality");
  assert.equal(result.personalized, false);
  const hot = card("hot", ["热"], "hot", NOW);
  rows.set("hot", [{ day: TODAY, qualified: 0, likes: 0, favorites: 0, rounds: 50 }]);
  const withHot = rankXumengRecommendations({ surface: "home", now: NOW, candidates: [...heated, ...fresh, hot], daily: rows });
  assert.equal(withHot.ids[0], "hot");
  assert.equal(withHot.reasons.hot, "quality");
});

test("the same author and primary tag do not fill the first screen", () => {
  const authors = ["a", "b", "c"] as const;
  const tags = { a: "古风", b: "修仙", c: "都市" };
  const candidates = authors.flatMap((author) => [1, 2, 3, 4].map((index) => card(`${author}-${index}`, [tags[author]], author)));
  const result = rankXumengRecommendations({ surface: "for_you", now: NOW, candidates });
  const first = result.ids.slice(0, 6);
  for (const author of authors) assert.equal(first.filter((id) => id.startsWith(`${author}-`)).length, 2);
});
