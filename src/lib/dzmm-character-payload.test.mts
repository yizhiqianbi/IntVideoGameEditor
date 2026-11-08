import assert from "node:assert/strict";
import test from "node:test";
import payloadModule from "./dzmm-character-payload";

const { externalizeCharacterRow, payloadDigest, readPayloadDigest, resolveCharacterContext, splitUtf8 } = payloadModule as typeof import("./dzmm-character-payload");

test("payload parts stay inside the byte cap and do not split a character", () => {
  const text = `甲🌱${"乙".repeat(40)}`;
  const parts = splitUtf8(text, 12);
  assert.equal(parts.join(""), text);
  const encoder = new TextEncoder();
  for (const part of parts) {
    assert.ok(encoder.encode(part).byteLength <= 12);
    assert.ok(!/[\uD800-\uDBFF]$/.test(part));
  }
  assert.ok(parts.length > 1);
});

test("a small character row stays inline and a large extension round-trips", () => {
  const small = { id: "small", context_json: "{\"note\":\"短\"}" };
  assert.deepEqual(externalizeCharacterRow(small, { inlineBytes: 200, partBytes: 40 }), { row: small, parts: [] });
  const context = JSON.stringify({ book: "书".repeat(80) });
  const stored = externalizeCharacterRow({ id: "large", name: "角色", context_json: context }, { inlineBytes: 200, partBytes: 40 });
  assert.notEqual(stored.row.context_json, context);
  assert.equal(readPayloadDigest(stored.row.context_json as string), payloadDigest(context));
  assert.equal(resolveCharacterContext(stored.row.context_json as string, stored.parts), context);
  assert.throws(() => resolveCharacterContext(stored.row.context_json as string, stored.parts.slice(0, -1)));
});
