import assert from "node:assert/strict";
import test from "node:test";
import { groupRelationshipAlbum, parseRelationshipAlbum, relationshipMediaObjectKey, type RelationshipAlbumItem } from "./relationship-album.ts";

const first: RelationshipAlbumItem = { id: "11111111-1111-4111-8111-111111111111", kind: "image", createdAt: Date.parse("2026-10-30T15:30:00.000Z"), mimeType: "image/jpeg" };
const nextDay: RelationshipAlbumItem = { id: "22222222-2222-4222-8222-222222222222", kind: "video", createdAt: Date.parse("2026-10-30T16:30:00.000Z"), mimeType: "video/mp4" };

test("relationship album groups by Beijing date with the newest day first", () => {
  const groups = groupRelationshipAlbum([nextDay, first]);
  assert.deepEqual(groups.map(group => group.label), ["2026年10月31日", "2026年10月30日"]);
  assert.equal(groups[0]?.items[0]?.kind, "video");
  assert.equal(groups[1]?.items[0]?.kind, "image");
});

test("relationship album parsing keeps only complete rows", () => {
  const items = parseRelationshipAlbum({ items: [first, { id: "nope", kind: "image", createdAt: 1, mimeType: "image/jpeg" }, { id: first.id, kind: "audio", createdAt: 1, mimeType: "audio/mpeg" }] });
  assert.deepEqual(items, [first]);
  assert.equal(relationshipMediaObjectKey("/api/backend/v1/media/user-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg"), "user-1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg");
  assert.equal(relationshipMediaObjectKey("https://example.com/video.mp4"), null);
});
