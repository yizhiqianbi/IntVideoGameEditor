import assert from "node:assert/strict";
import test from "node:test";
import { h3Query, h3Upstream } from "../src/h3-channel";

test("the site channel only forwards the H3 routes Xumeng uses", () => {
  assert.equal(h3Upstream("GET", "/api/h3/health"), "/pencil/health");
  assert.equal(h3Upstream("POST", "/api/h3/prompt"), "/pencil/h3/prompt");
  assert.equal(h3Upstream("POST", "/api/h3/image"), "/pencil/input-image");
  assert.equal(h3Upstream("POST", "/api/h3/references"), "/pencil/references");
  assert.equal(h3Upstream("GET", "/api/h3/references/0123456789abcdef0123456789abcdef"), "/pencil/references/0123456789abcdef0123456789abcdef");
  assert.equal(h3Upstream("GET", "/api/h3/prompt"), null);
  assert.equal(h3Upstream("POST", "/api/h3/health"), null);
  assert.equal(h3Upstream("GET", "/pencil/health"), null);
  assert.equal(h3Query("/api/h3/health", ""), "");
  assert.equal(h3Query("/api/h3/health", "?url=https://evil.example"), null);
  assert.equal(h3Query("/api/h3/references/0123456789abcdef0123456789abcdef", "?metadata=1"), "?metadata=1");
});
