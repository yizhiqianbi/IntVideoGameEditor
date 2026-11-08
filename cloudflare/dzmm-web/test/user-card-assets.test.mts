import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifiedUserCardAssets } from "../scripts/user-card-assets.mjs";
import { userCardAssetPaths, XUMENG_USER_CARD_ASSET_PATHS } from "../src/user-card-assets";
import { fetchRequest, type Env } from "../src/worker";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = Buffer.from(JSON.stringify({ name: "原创灯塔地图员", description: "在灯塔整理航图。", firstMessage: "请选一张航图。" }));
const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VUUAAAAASUVORK5CYII=", "base64");
const manifest = { version: 1, batch: "20261024", provenance: "user-provided", files: [
  { path: "20261024/fixture.json", bytes: jsonBytes.length, sha256: hash(jsonBytes) },
  { path: "20261024/fixture.png", bytes: pngBytes.length, sha256: hash(pngBytes) },
] };

test("only exact manifest paths become public; malformed, repeated and traversal paths fail", () => {
  assert.deepEqual([...userCardAssetPaths(manifest)].sort(), ["user-cards/manifest.json", "user-cards/20261024/fixture.json", "user-cards/20261024/fixture.png"].sort());
  for (const path of ["../private.json", "20261024/../private.json", "20261024/private.js", "20261024/%2e%2e.json", "/20261024/fixture.json"]) {
    assert.throws(() => userCardAssetPaths({ ...manifest, files: [{ ...manifest.files[0], path }] }));
  }
  assert.throws(() => userCardAssetPaths({ ...manifest, files: [manifest.files[0], manifest.files[0]] }));
  assert.throws(() => userCardAssetPaths({ ...manifest, provenance: "CC BY 4.0" }));
});

test("build collection verifies untouched originals and excludes unlisted files, tampering and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "xumeng-supplied-test-"));
  const dir = join(root, "user-cards/20261024");
  await mkdir(dir, { recursive: true });
  const writeManifest = async (value: unknown) => writeFile(join(root, "user-cards/manifest.json"), JSON.stringify(value));
  try {
    await writeManifest(manifest);
    await writeFile(join(dir, "fixture.json"), jsonBytes); await writeFile(join(dir, "fixture.png"), pngBytes);
    await writeFile(join(dir, "excluded.json"), "PRIVATE_TEST_SENTINEL");
    assert.deepEqual([...(await verifiedUserCardAssets(root))].sort(), [...userCardAssetPaths(manifest)].sort());
    await writeFile(join(dir, "fixture.json"), Buffer.concat([jsonBytes, Buffer.from(" ")]));
    await assert.rejects(verifiedUserCardAssets(root), /字节校验失败/);
    await writeFile(join(dir, "fixture.json"), jsonBytes);
    await writeManifest({ ...manifest, files: [{ ...manifest.files[0], path: "../private.json" }] });
    await assert.rejects(verifiedUserCardAssets(root), /路径或校验值无效/);
    await writeManifest(manifest);
    await rm(join(dir, "fixture.json")); await symlink(join(dir, "excluded.json"), join(dir, "fixture.json"));
    await assert.rejects(verifiedUserCardAssets(root), /普通文件/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Worker serves only approved originals and rejects both unlisted data and HTML fallback", async () => {
  let fetches = 0;
  const env = { GENERATION_ENABLED: "false", ASSETS: { fetch: async request => {
    fetches++;
    return new Response((request as Request).method === "HEAD" ? null : "fixture", { headers: { "Content-Type": "application/json" } });
  } }, BACKEND: { fetch: async () => { throw new Error("No production backend allowed."); } }, CHAT_RATE_LIMITER: { limit: async () => { throw new Error("No model allowed."); } } } as Env;
  for (const path of XUMENG_USER_CARD_ASSET_PATHS) for (const method of ["GET", "HEAD"]) {
    const result = await fetchRequest(new Request(`https://xumengchat.top/assets/xumeng/${path}`, { method }), env);
    assert.equal(result.status, 200);
  }
  const previous = fetches;
  const result = await fetchRequest(new Request("https://xumengchat.top/assets/xumeng/user-cards/20261024/excluded-fixture.json"), env);
  assert.equal(result.status, 404); assert.equal(fetches, previous);
  env.ASSETS.fetch = async () => new Response("<html>fallback</html>", { headers: { "Content-Type": "text/html" } });
  const missing = await fetchRequest(new Request("https://xumengchat.top/assets/xumeng/user-cards/manifest.json"), env);
  assert.equal(missing.status, 404);
});
