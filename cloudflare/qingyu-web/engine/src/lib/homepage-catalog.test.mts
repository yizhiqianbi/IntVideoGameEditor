import test from "node:test";
import assert from "node:assert/strict";
import homepageCatalogModule from "./homepage-catalog";

const {
  FEATURED_CASES,
  PRODUCT_LINES,
  getPrimaryProductLine,
} = homepageCatalogModule as typeof import("./homepage-catalog");

test("homepage exposes exactly one active primary product line", () => {
  const primary = getPrimaryProductLine();

  assert.equal(primary.slug, "interactive-film-game");
  assert.equal(primary.href, "/projects");
  assert.equal(primary.status, "active");
});

test("homepage exposes three product lines and at least three featured cases", () => {
  assert.equal(PRODUCT_LINES.length, 3);
  assert.ok(FEATURED_CASES.length >= 3);
});
