import assert from "node:assert/strict";
import test from "node:test";
import * as coverModule from "./dzmm-cover-media";
import * as routesModule from "./xumeng-routes";

const cover = ("default" in coverModule ? coverModule.default : coverModule) as typeof import("./dzmm-cover-media");
const routes = ("default" in routesModule ? routesModule.default : routesModule) as typeof import("./xumeng-routes");
const {
  DZMM_COVER_IMAGE_MAX_BYTES,
  DZMM_COVER_VIDEO_MAX_BYTES,
  checkDzmmCoverHeader,
  isDzmmCoverVideoUrl,
  sniffDzmmCoverMedia,
} = cover;
const { xumengCardCoverUrl } = routes;

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"));
const mp4 = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
]);
const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
const audioMp4 = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20,
  0x00, 0x00, 0x00, 0x00, 0x4d, 0x34, 0x41, 0x20, 0x6d, 0x70, 0x34, 0x32,
]);

test("cover sniff accepts png, mp4 and webm and rejects disguised headers", () => {
  assert.equal(sniffDzmmCoverMedia(png), "image/png");
  assert.equal(sniffDzmmCoverMedia(mp4), "video/mp4");
  assert.equal(sniffDzmmCoverMedia(webm), "video/webm");
  assert.equal(sniffDzmmCoverMedia(audioMp4), null);
  assert.equal(sniffDzmmCoverMedia(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61])), null);
  const pngAsVideo = checkDzmmCoverHeader({ bytes: png, byteLength: png.byteLength, declaredType: "video/mp4", filename: "cover.mp4" });
  assert.equal(pngAsVideo.ok, false);
  const mp4AsPng = checkDzmmCoverHeader({ bytes: mp4, byteLength: mp4.byteLength, declaredType: "image/png", filename: "cover.png" });
  assert.equal(mp4AsPng.ok, false);
  const renamed = checkDzmmCoverHeader({ bytes: mp4, byteLength: mp4.byteLength, declaredType: "video/mp4", filename: "cover.png" });
  assert.equal(renamed.ok, false);
  if (!renamed.ok) assert.match(renamed.message, /扩展名/);
});

test("cover videos have their own 16 MB limit and stay out of the gallery", () => {
  const video = checkDzmmCoverHeader({ bytes: mp4, byteLength: mp4.byteLength, declaredType: "video/mp4", filename: "loop.mp4" });
  assert.equal(video.ok, true);
  if (video.ok) assert.equal(video.extension, "mp4");
  const webmFile = checkDzmmCoverHeader({ bytes: webm, byteLength: webm.byteLength, declaredType: "", filename: "loop.webm" });
  assert.equal(webmFile.ok, true);
  const tooBig = checkDzmmCoverHeader({ bytes: mp4, byteLength: DZMM_COVER_VIDEO_MAX_BYTES + 1, declaredType: "video/mp4", filename: "loop.mp4" });
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.equal(tooBig.status, 413);
  const imageTooBig = checkDzmmCoverHeader({ bytes: png, byteLength: DZMM_COVER_IMAGE_MAX_BYTES + 1, declaredType: "image/png", filename: "cover.png" });
  assert.equal(imageTooBig.ok, false);
  if (!imageTooBig.ok) assert.match(imageTooBig.message, /5 MB/);
  const gallery = checkDzmmCoverHeader({ bytes: mp4, byteLength: mp4.byteLength, declaredType: "video/mp4", filename: "loop.mp4", gallery: true });
  assert.equal(gallery.ok, false);
  if (!gallery.ok) assert.match(gallery.message, /画廊/);
  assert.equal(DZMM_COVER_VIDEO_MAX_BYTES, 16 * 1024 * 1024);
});

test("video cover URLs stay on cover and are not rewritten into washed image cards", () => {
  const published = "/api/dzmm/backend/v1/publishing/media/published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/2/cover.mp4";
  assert.equal(isDzmmCoverVideoUrl(published), true);
  assert.equal(isDzmmCoverVideoUrl(`${published}?v=1`), true);
  assert.equal(isDzmmCoverVideoUrl(published.replace(".mp4", ".webm")), true);
  assert.equal(isDzmmCoverVideoUrl(published.replace(".mp4", ".png")), false);
  assert.equal(xumengCardCoverUrl(published), "/api/backend/v1/publishing/media/published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/2/cover.mp4");
});
