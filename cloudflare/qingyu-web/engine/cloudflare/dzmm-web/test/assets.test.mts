import test from "node:test";
import assert from "node:assert/strict";
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { copyVerifiedAssets } from "../scripts/copy-assets.mjs";
import { CRITICAL_STATIC_ASSETS, assetMimeTypes, matchesAssetMime } from "../scripts/asset-contract.mjs";
import { fetchRequest, type Env } from "../src/worker";

const repo = resolve(import.meta.dirname, "../../..");
async function fixture(): Promise<{ scratch: string; frontendRoot: string; sourceRoot: string }> {
  const scratch = await mkdtemp(join(tmpdir(), "xumeng-assets-test-"));
  const frontendRoot = join(scratch, "cloudflare/dzmm-web");
  const sourceRoot = join(scratch, "public/dzmm");
  await mkdir(frontendRoot, { recursive: true });
  await mkdir(join(frontendRoot, "scripts"), { recursive: true });
  await copyFile(join(repo, "cloudflare/dzmm-web/scripts/build-action-demos.py"), join(frontendRoot, "scripts/build-action-demos.py"));
  await cp(join(repo, "public/dzmm"), sourceRoot, { recursive: true });
  await mkdir(join(scratch, "src/lib"), { recursive: true });
  for (const name of ["dzmm-public-introductions.json", "dzmm-character-media.json", "dzmm-category-covers.json"]) {
    await copyFile(join(repo, "src/lib", name), join(scratch, "src/lib", name));
  }
  return { scratch, frontendRoot, sourceRoot };
}

test("verified assets build only under the new namespace with original brand files and unchanged catalog bytes", async () => {
  const { scratch, frontendRoot, sourceRoot } = await fixture();
  try {
    await writeFile(join(sourceRoot, ".env.local"), "unapproved-private-file");
    const count = await copyVerifiedAssets({ frontendRoot });
    const destination = join(frontendRoot, "dist/assets/xumeng");
    assert.ok(count > 60);
    assert.deepEqual((await readdir(join(frontendRoot, "dist"))), ["assets"]);
    assert.deepEqual((await readdir(join(destination, "brand"))).sort(), ["sources.json", "xumeng-character-placeholder.svg", "xumeng-favicon.ico", "xumeng-icon-192.png", "xumeng-icon-512.png", "xumeng-mark.svg"]);
    await assert.rejects(readFile(join(destination, ".env.local")), { code: "ENOENT" });
    for (const name of ["public-character-samples.json", "public-character-introductions.json", "public-character-media.json", "public-category-covers.json", "brand/xumeng-mark.svg", "brand/xumeng-character-placeholder.svg", "covers/2999180.webp"]) {
      assert.deepEqual(await readFile(join(destination, name)), await readFile(join(sourceRoot, name)));
    }
    const manifest = JSON.parse(await readFile(join(destination, "manifest.webmanifest"), "utf8"));
    assert.equal(manifest.id, "/");
    assert.equal(manifest.start_url, "/");
    assert.deepEqual(manifest.icons.map((icon: { src: string }) => icon.src), ["/assets/xumeng/brand/xumeng-icon-192.png", "/assets/xumeng/brand/xumeng-icon-512.png"]);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("legacy PWA entry and icon URLs are rejected by the asset build", async () => {
  const { scratch, frontendRoot, sourceRoot } = await fixture();
  try {
    const manifestPath = join(sourceRoot, "manifest.webmanifest");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.start_url = "/dzmm";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /安装清单/);
    manifest.start_url = "/";
    manifest.icons[0].src = "/dzmm/brand/icon-192.png";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /安装图标/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("template previews reject changed bytes and falsely claimed model output", async () => {
  const { scratch, frontendRoot, sourceRoot } = await fixture();
  try {
    const preview = join(sourceRoot, "generation-templates/character.svg");
    const original = await readFile(preview);
    await writeFile(preview, Buffer.concat([original, Buffer.from("\n")]));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /模板示意图片校验失败/);
    await writeFile(preview, original);
    const manifestPath = join(sourceRoot, "generation-templates/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.provenance.modelOutput = true;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /模板原创示意资源清单无效/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("source byte validation and ordinary-file checks remain mandatory after path migration", async () => {
  const { scratch, frontendRoot, sourceRoot } = await fixture();
  try {
    const introductionPath = join(sourceRoot, "public-character-introductions.json");
    const original = await readFile(introductionPath);
    await writeFile(introductionPath, Buffer.concat([original, Buffer.from("\n")]));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /逐字节一致/);
    await writeFile(introductionPath, original);
    const markPath = join(sourceRoot, "brand/xumeng-mark.svg");
    const externalPath = join(scratch, "not-a-build-source.svg");
    await copyFile(markPath, externalPath);
    await rm(markPath);
    await symlink(externalPath, markPath);
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /普通文件/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("original action videos reject altered bytes, forged MP4 dimensions, extra IDs and changed source", async () => {
  const { scratch, frontendRoot, sourceRoot } = await fixture();
  try {
    const path = join(sourceRoot, "action-templates/action-high-five.mp4");
    const original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from("changed")]));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /动作示意资源格式或字节校验失败/);
    await writeFile(path, original);
    const manifestPath = join(sourceRoot, "action-templates/manifest.json");
    const originalManifest = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(originalManifest);
    const tkhdType = original.indexOf(Buffer.from("tkhd"));
    assert.ok(tkhdType > 4);
    const altered = Buffer.from(original);
    const tkhdStart = tkhdType - 4;
    const tkhdEnd = tkhdStart + altered.readUInt32BE(tkhdStart);
    altered.writeUInt32BE(320 * 65536, tkhdEnd - 8);
    manifest.assets[0].video.sha256 = createHash("sha256").update(altered).digest("hex");
    await writeFile(path, altered);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /动作示意资源格式或字节校验失败/);
    await writeFile(path, original);
    manifest.assets[0].id = "action-unapproved";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /动作示意资源 ID 无效/);
    await writeFile(manifestPath, originalManifest);
    await writeFile(join(frontendRoot, "scripts/build-action-demos.py"), "changed source");
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /动作模板原创示意资源清单或绘制源码校验无效/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("every built asset passes the actual Worker route with its MIME and bytes while unapproved files stay private", async () => {
  const { scratch, frontendRoot, sourceRoot } = await fixture();
  try {
    await copyVerifiedAssets({ frontendRoot });
    const destination = join(frontendRoot, "dist/assets/xumeng");
    const builtFiles = (await readdir(destination, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => relative(destination, join(entry.parentPath, entry.name))).sort();
    for (const path of CRITICAL_STATIC_ASSETS) {
      assert.ok(builtFiles.includes(path), `发布检查资源不在构建产物中：${path}`);
    }

    let assetFetches = 0;
    const env: Env = {
      ASSETS: { fetch: async input => {
        assetFetches++;
        const request = input as Request;
        const pathname = new URL(request.url).pathname;
        assert.ok(pathname.startsWith("/assets/xumeng/"));
        const path = pathname.slice("/assets/xumeng/".length);
        try {
          const bytes = await readFile(join(destination, path));
          return new Response(request.method === "HEAD" ? null : bytes, {
            headers: { "Content-Type": `${assetMimeTypes(path)[0]}; charset=utf-8` },
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return new Response("<html>SPA fallback</html>", { headers: { "Content-Type": "text/html" } });
        }
      } },
      BACKEND: { fetch: async () => { throw new Error("static assets must not call the backend"); } },
      CHAT_RATE_LIMITER: { limit: async () => { throw new Error("static assets must not call a model"); } },
    };
    for (const path of builtFiles) {
      const original = await readFile(join(sourceRoot, path));
      for (const method of ["GET", "HEAD"]) {
        const response = await fetchRequest(new Request(`https://xumengchat.top/assets/xumeng/${path}`, { method }), env);
        assert.equal(response.status, 200, `${method} route blocked built asset: ${path}`);
        assert.equal(response.headers.get("Location"), null, path);
        assert.ok(matchesAssetMime(path, response.headers.get("Content-Type")), `MIME mismatch: ${path}`);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === "HEAD" ? Buffer.alloc(0) : original, path);
      }
    }
    assert.equal(assetFetches, builtFiles.length * 2);

    // These exist on disk and the ASSETS binding would serve them. The Worker
    // must reject their URLs before invoking the binding.
    for (const path of ["brand/unapproved.svg", "private.json", "action-templates/unapproved.mp4", "action-templates/action-high-five.webm"]) {
      await writeFile(join(destination, path), "unapproved-private-file");
      for (const method of ["GET", "HEAD"]) {
        const response = await fetchRequest(new Request(`https://xumengchat.top/assets/xumeng/${path}`, { method }), env);
        assert.equal(response.status, 404, path);
        assert.match(response.headers.get("Content-Type") || "", /application\/json/);
        assert.equal(response.headers.get("Location"), null);
      }
    }
    assert.equal(assetFetches, builtFiles.length * 2);
    const missing = await fetchRequest(new Request("https://xumengchat.top/assets/xumeng/covers/999999999999.webp"), env);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("Content-Type") || "", /application\/json/);
    assert.equal(assetFetches, builtFiles.length * 2 + 1);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
