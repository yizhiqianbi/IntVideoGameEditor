import assert from "node:assert/strict";
import test from "node:test";
import * as renditionModule from "./xumeng-cover-rendition";
import * as routesModule from "./xumeng-routes";

const { publishedCardObjectKey, publishedMediaSlot, xumengPublishedCoverCardUrl } =
  ("default" in renditionModule ? renditionModule.default : renditionModule) as typeof import("./xumeng-cover-rendition");
const { xumengCardCoverUrl, xumengCoverMissUrl, XUMENG_FALLBACK_COVER } =
  ("default" in routesModule ? routesModule.default : routesModule) as typeof import("./xumeng-routes");

const cover = "/api/dzmm/backend/v1/publishing/media/published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/2/cover";

test("published covers point at the washed card and stay idempotent", () => {
  const card = xumengCardCoverUrl(cover);
  assert.equal(card, "/api/backend/v1/publishing/media/published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/2/cover-card");
  assert.equal(xumengCardCoverUrl(card), card);
  assert.equal(xumengPublishedCoverCardUrl(`${cover}?v=1`), `${cover}-card?v=1`);
  assert.equal(publishedMediaSlot("gallery-3-card")?.name, "gallery-3");
  assert.equal(publishedMediaSlot("gallery-3-card")?.card, true);
  assert.equal(publishedMediaSlot("cover")?.card, false);
  assert.equal(publishedMediaSlot("notes"), null);
  assert.equal(publishedCardObjectKey("published/id/2/nonce/cover.png"), "published/id/2/nonce/cover.png.card.webp");
});

test("a missing washed cover falls back to the original, then the placeholder", () => {
  const original = xumengCardCoverUrl(cover).replace(/-card$/, "");
  assert.equal(xumengCoverMissUrl(`https://xumengchat.top${xumengCardCoverUrl(cover)}`, cover), original);
  assert.equal(xumengCoverMissUrl(original, cover), XUMENG_FALLBACK_COVER);
  assert.equal(xumengCoverMissUrl("/assets/xumeng/exported-cards/foreverse-peiyu-cover-card.jpg", "/dzmm/exported-cards/foreverse-peiyu-cover.png"), "/assets/xumeng/exported-cards/foreverse-peiyu-cover.png");
});
