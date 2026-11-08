// node --experimental-strip-types --import ./src/lib/register-ts-extension.mjs --test src/lib/xumeng-acquisition.test.mts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readXumengRecommendationPage } from "./xumeng-recommendations-client.ts";
import {
  characterShareLocation, parseStoredAcquisition, posterEntryHref, posterShareLocation, readAcquisitionLanding,
} from "./xumeng-acquisition.ts";

test("registered character and poster links carry an invite code, guests stay clean", () => {
  assert.equal(characterShareLocation("xumeng-foreverse-peiyu", null), "/c/xumeng-foreverse-peiyu");
  assert.equal(characterShareLocation("xumeng-foreverse-peiyu", "xmabc123"), "/c/xumeng-foreverse-peiyu?invite=XMABC123&from=character");
  assert.equal(posterShareLocation("gaze", null), "/go/gaze");
  assert.equal(posterShareLocation("gaze", "XMABC123"), "/go/gaze?invite=XMABC123&from=poster");
  assert.equal(characterShareLocation("Not A Path", "XMABC123").includes("invite=XMABC123"), true);
});

test("poster clicks keep the invite and name the poster", () => {
  assert.equal(posterEntryHref("?invite=XMABC123&from=poster", "waiting"), "/?invite=XMABC123&from=poster&poster=waiting");
  assert.equal(posterEntryHref("", "catch"), "/?from=poster&poster=catch");
  assert.equal(posterEntryHref("?invite=no", "gaze"), "/?from=poster&poster=gaze");
});

test("the first landing is remembered and a later link does not replace it", () => {
  const first = readAcquisitionLanding({ pathname: "/c/xumeng-foreverse-peiyu", search: "?invite=XMABC123&from=character" });
  assert.deepEqual(first, { source: "character_share", inviteCode: "XMABC123", characterId: "xumeng-foreverse-peiyu", poster: null });
  const stored = parseStoredAcquisition(JSON.stringify(first));
  const later = readAcquisitionLanding({ pathname: "/", search: "?invite=XMOTHER1&from=poster&poster=gaze" });
  assert.equal(later?.source, "poster");
  assert.deepEqual(stored, first);
  assert.equal(readAcquisitionLanding({ pathname: "/c/xumeng-foreverse-peiyu", search: "" }), null);
  assert.equal(readAcquisitionLanding({ pathname: "/", search: "?invite=XMABC123" })?.source, "invite_link");
  assert.equal(parseStoredAcquisition("{"), null);
});

test("poster pages forward the current query without changing the canonical url", async () => {
  for (const poster of ["catch", "waiting", "gaze"] as const) {
    const html = await readFile(new URL(`../../cloudflare/dzmm-web/jump/${poster}.html`, import.meta.url), "utf8");
    assert.match(html, new RegExp(`rel="canonical" href="https://xumengchat.top/go/${poster}"`));
    assert.match(html, new RegExp(`poster=${poster}`));
    assert.match(html, /from=poster/);
    assert.match(html, /id="xumeng-enter"/);
  }
});

test("recommendation pages keep the reason for each card", () => {
  const page = readXumengRecommendationPage({
    ids: ["kept"],
    reasons: { kept: "same_tag", dropped: "nope", "bad id": "quality" },
    personalized: true,
    hiddenIds: [],
  });
  assert.deepEqual(page.reasons, { kept: "same_tag" });
  assert.equal(page.personalized, true);
});
