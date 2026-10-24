import test from "node:test";
import assert from "node:assert/strict";
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { copyVerifiedAssets } from "../scripts/copy-assets.mjs";
import { fetchRequest, type Env } from "../src/worker";

const repo = resolve(import.meta.dirname, "../../..");
const slugs = ["peiyu", "tangtuantuan", "wangushi", "shenyan", "huoyushen", "jiwenqing", "naifuer", "songzhixia", "jiangchiye", "sunianzhi", "xuanjing", "nie-xiaoqian", "caleb", "edmund-harrower", "frankie-doyle", "redline-salvage", "rosalind", "the-lighthouse"];
const originalFiles = slugs.flatMap(slug => [`foreverse-${slug}.v2.json`, `foreverse-${slug}-cover.png`]).concat("LICENSE-CONTENT.txt").sort();
const allFiles = [...originalFiles, "manifest.json"].sort();
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const mime = (name: string) => name.endsWith(".json") ? "application/json" : name.endsWith(".png") ? "image/png" : "text/plain";

async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), "xumeng-exported-assets-"));
  const frontendRoot = join(scratch, "cloudflare/dzmm-web");
  const sourceRoot = join(scratch, "public/dzmm");
  const destination = join(frontendRoot, "dist/assets/xumeng");
  await mkdir(join(frontendRoot, "scripts"), { recursive: true });
  await copyFile(join(repo, "cloudflare/dzmm-web/scripts/build-action-demos.py"), join(frontendRoot, "scripts/build-action-demos.py"));
  await cp(join(repo, "public/dzmm"), sourceRoot, { recursive: true });
  await mkdir(join(scratch, "src/lib"), { recursive: true });
  for (const name of ["dzmm-public-introductions.json", "dzmm-character-media.json", "dzmm-category-covers.json"]) {
    await copyFile(join(repo, "src/lib", name), join(scratch, "src/lib", name));
  }
  return { scratch, frontendRoot, sourceRoot, destination };
}

function isolatedEnv(fetchAssets: Env["ASSETS"]["fetch"]): Env {
  return { GENERATION_ENABLED: "false", ASSETS: { fetch: fetchAssets },
    BACKEND: { fetch: async () => { throw new Error("Exported assets must not access production/backend data."); } },
    CHAT_RATE_LIMITER: { limit: async () => { throw new Error("Exported assets must not invoke a model."); } },
  };
}

test("eighteen original JSON cards, eighteen covers and the license copy with manifest hashes; unapproved files do not", async () => {
  const { scratch, frontendRoot, sourceRoot, destination } = await fixture();
  try {
    for (const name of ["private.json", ".env", "merchant-private-key.pem", "foreverse-not-imported.v2.json"]) {
      await writeFile(join(sourceRoot, "exported-cards", name), "PRIVATE_TEST_SENTINEL");
    }
    await copyVerifiedAssets({ frontendRoot });
    assert.deepEqual((await readdir(join(destination, "exported-cards"))).sort(), allFiles);
    const manifest = JSON.parse(await readFile(join(sourceRoot, "exported-cards/manifest.json"), "utf8"));
    assert.equal(manifest.license, "CC BY 4.0");
    assert.deepEqual(manifest.files.map((file: { path: string }) => file.path).sort(), originalFiles);
    for (const file of manifest.files) {
      const source = await readFile(join(sourceRoot, "exported-cards", file.path));
      const built = await readFile(join(destination, "exported-cards", file.path));
      assert.deepEqual(built, source);
      assert.equal(built.length, file.bytes);
      assert.equal(hash(built), file.sha256);
      if (file.path.endsWith(".v2.json")) {
        const card = JSON.parse(built.toString("utf8"));
        assert.equal(card.spec, "chara_card_v2");
        assert.ok(card.data.description && card.data.first_mes && card.data.character_book.entries.length);
      }
    }
    assert.deepEqual(await readFile(join(destination, "exported-cards/manifest.json")), await readFile(join(sourceRoot, "exported-cards/manifest.json")));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("changed original card, cover or license bytes fail the build before publication", async () => {
  const { scratch, frontendRoot, sourceRoot } = await fixture();
  try {
    for (const name of ["foreverse-peiyu.v2.json", "foreverse-peiyu-cover.png", "LICENSE-CONTENT.txt"]) {
      const path = join(sourceRoot, "exported-cards", name);
      const original = await readFile(path);
      await writeFile(path, Buffer.concat([original, Buffer.from("\nTAMPERED_TEST_SENTINEL")]));
      await assert.rejects(copyVerifiedAssets({ frontendRoot }), /完整角色原件字节校验失败/);
      await writeFile(path, original);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("a forged original manifest cannot copy a private path and a symlink cannot become a published original", async () => {
  const { scratch, frontendRoot, sourceRoot } = await fixture();
  try {
    const manifestPath = join(sourceRoot, "exported-cards/manifest.json");
    const rawManifest = await readFile(manifestPath);
    const manifest = JSON.parse(rawManifest.toString("utf8"));
    manifest.files[0].path = "../.env";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /完整角色原件路径无效/);
    await writeFile(manifestPath, rawManifest);
    const source = join(sourceRoot, "exported-cards/foreverse-peiyu.v2.json");
    const external = join(scratch, "not-an-approved-original.json");
    await copyFile(source, external);
    await rm(source);
    await symlink(external, source);
    await assert.rejects(copyVerifiedAssets({ frontendRoot }), /完整角色原件必须是普通文件/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("the Worker serves only approved card files with exact GET/HEAD bytes while media generation stays closed", async () => {
  const { scratch, frontendRoot, sourceRoot, destination } = await fixture();
  try {
    await copyVerifiedAssets({ frontendRoot });
    let assetFetches = 0;
    const env = isolatedEnv(async input => {
      assetFetches++;
      const request = input as Request;
      const name = new URL(request.url).pathname.split("/").at(-1)!;
      const bytes = await readFile(join(destination, "exported-cards", name));
      return new Response(request.method === "HEAD" ? null : bytes, { headers: { "Content-Type": mime(name) } });
    });
    for (const name of allFiles) for (const method of ["GET", "HEAD"]) {
      const response = await fetchRequest(new Request(`https://xumengchat.top/assets/xumeng/exported-cards/${name}`, { method }), env);
      assert.equal(response.status, 200, `${method} ${name}`);
      assert.equal(response.headers.get("Content-Type"), mime(name));
      assert.equal(response.headers.get("Location"), null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === "HEAD" ? Buffer.alloc(0) : await readFile(join(sourceRoot, "exported-cards", name)));
    }
    assert.equal(assetFetches, allFiles.length * 2);
    for (const name of ["private.json", "merchant-private-key.pem", ".env", "foreverse-not-imported.v2.json"]) {
      await writeFile(join(destination, "exported-cards", name), "PRIVATE_TEST_SENTINEL");
      for (const method of ["GET", "HEAD"]) {
        const response = await fetchRequest(new Request(`https://xumengchat.top/assets/xumeng/exported-cards/${name}`, { method }), env);
        assert.equal(response.status, 404, `${method} ${name}`);
        assert.match(response.headers.get("Content-Type") || "", /application\/json/);
        assert.equal(response.headers.get("Location"), null);
      }
    }
    assert.equal(assetFetches, allFiles.length * 2, "Unapproved paths are rejected before the asset binding.");
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("an approved card URL with an HTML fallback is a 404 rather than a successful download", async () => {
  let assetFetches = 0;
  const env = isolatedEnv(async () => {
    assetFetches++;
    return new Response("<html>SPA fallback</html>", { headers: { "Content-Type": "text/html; charset=UTF-8" } });
  });
  for (const name of allFiles) for (const method of ["GET", "HEAD"]) {
    const response = await fetchRequest(new Request(`https://xumengchat.top/assets/xumeng/exported-cards/${name}`, { method }), env);
    assert.equal(response.status, 404, `${method} ${name}`);
    assert.match(response.headers.get("Content-Type") || "", /application\/json/);
    assert.equal(response.headers.get("Location"), null);
    assert.ok(!(await response.text()).includes("SPA fallback"));
  }
  assert.equal(assetFetches, allFiles.length * 2);
});
