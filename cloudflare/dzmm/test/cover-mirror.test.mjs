import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { pendingRemoteSlots, remoteMirrorUrl, sniffStoredImage } = await tsImport("../src/cover-mirror.ts", import.meta.url);

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

test("only the known public image host can be copied", () => {
  assert.equal(remoteMirrorUrl("https://static.aiaigirl.com/images/20260122/example.png"), "https://static.aiaigirl.com/images/20260122/example.png");
  assert.equal(remoteMirrorUrl("https://user:pass@static.aiaigirl.com/a.png"), null);
  assert.equal(remoteMirrorUrl("https://static.aiaigirl.com:8443/a.png"), null);
  assert.equal(remoteMirrorUrl("http://static.aiaigirl.com/a.png"), null);
  assert.equal(remoteMirrorUrl("https://pxlorbit.com/a.png"), null);
  assert.equal(remoteMirrorUrl("/api/dzmm/backend/v1/publishing/media/published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/1/cover"), null);
});

test("image bytes decide the stored type when the server label is wrong", () => {
  assert.equal(sniffStoredImage(jpeg)?.type, "image/jpeg");
  assert.equal(sniffStoredImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))?.extension, ".png");
  assert.equal(sniffStoredImage(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(sniffStoredImage(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))?.type, "image/avif");
});

test("a copied cover is not downloaded again", () => {
  const snapshot = {
    cover: "https://static.aiaigirl.com/images/cover.png",
    gallery: ["https://static.aiaigirl.com/images/extra.png", "/api/already"],
  };
  assert.deepEqual(pendingRemoteSlots(snapshot, {}), [
    { slot: "cover", url: snapshot.cover },
    { slot: "gallery-0", url: snapshot.gallery[0] },
  ]);
  assert.deepEqual(pendingRemoteSlots(snapshot, { cover: "published/x/1/n/cover.jpg" }), [
    { slot: "gallery-0", url: snapshot.gallery[0] },
  ]);
});
