import assert from "node:assert/strict";
import test from "node:test";
import { selectHomeBanners, type HomeBanner } from "./home-banners.ts";

const banner = (id: string, audience: HomeBanner["audience"], position: number): HomeBanner => ({
  id, audience, position, title: id, body: id, href: null,
});

test("homepage banners keep general separate and fall back only for a chosen audience", () => {
  const banners = [
    banner("g1", "general", 2),
    banner("m-low", "male", 1),
    banner("m-high", "male", 8),
    banner("f1", "female", 3),
  ];
  assert.deepEqual(selectHomeBanners(banners, null).map((item) => item.id), ["g1"]);
  assert.deepEqual(selectHomeBanners(banners, "general").map((item) => item.id), ["g1"]);
  assert.deepEqual(selectHomeBanners(banners, "female").map((item) => item.id), ["f1"]);
  assert.deepEqual(selectHomeBanners(banners, "male").map((item) => item.id), ["m-low", "m-high"]);
  assert.deepEqual(selectHomeBanners(banners.filter((item) => item.audience !== "female"), "female").map((item) => item.id), ["m-low", "m-high"]);
});
