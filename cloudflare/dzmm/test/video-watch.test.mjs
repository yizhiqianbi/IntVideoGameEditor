import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { tsImport } from "tsx/esm/api";
import { splitSqlStatements } from "./sql-migrations.mjs";

const { fetchRequest } = await tsImport("../src/app.ts", import.meta.url);
const { digest } = await tsImport("../src/auth.ts", import.meta.url);
let store;
let DB;
before(async () => {
  store = new Miniflare(convertV4MiniflareOptions({
    compatibilityDate: "2026-10-01", modules: true,
    script: "export default { fetch() { return new Response('video watch') } }",
    d1Databases: { DB: "video-watch-tests" },
  }));
  DB = await store.getD1Database("DB");
  const files = (await readdir(new URL("../migrations/", import.meta.url))).filter(file => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    await DB.batch(splitSqlStatements(sql).filter(part => part.trim()).map(part => DB.prepare(part)));
  }
});
after(async () => { await store?.dispose(); });

async function account(credits) {
  const id = randomUUID();
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await DB.prepare("INSERT INTO users(id,email,nickname,is_guest,version,created_at) VALUES (?,?,?,0,0,?)").bind(id, `${id}@video.test`, "看剧的人", now).run();
  await DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").bind(digest(token), id, now + 86_400_000, now).run();
  await DB.prepare("INSERT INTO trusted_credit_grants(grant_key,user_id,credits,reason,created_at) VALUES (?,?,?,?,?)").bind(`video:${id}`, id, credits, "video-test", now).run();
  return { id, token };
}
async function call(token, path, body) {
  const response = await fetchRequest(new Request(`https://xumengchat.top${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: `dzmm_session=${token}`, Origin: "https://xumengchat.top", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { DB, APP_ORIGINS: "https://xumengchat.top" });
  return { status: response.status, data: await response.json() };
}

test("episode one is free and later episodes charge once", async () => {
  const member = await account(80);
  const first = await call(member.token, "/v1/videos/unlock", { episodeId: "hg-11138-1" });
  assert.equal(first.status, 200);
  assert.equal(first.data.chargedCredits, 0);
  assert.equal(first.data.balance, 80);
  const second = await call(member.token, "/v1/videos/unlock", { episodeId: "hg-11138-2" });
  assert.equal(second.status, 200);
  assert.equal(second.data.chargedCredits, 50);
  assert.equal(second.data.balance, 30);
  const again = await call(member.token, "/v1/videos/unlock", { episodeId: "hg-11138-2" });
  assert.equal(again.data.chargedCredits, 0);
  assert.equal(again.data.balance, 30);
  const listed = await call(member.token, "/v1/videos/unlocks?dramaId=hg-11138");
  assert.deepEqual(listed.data.episodeIds, ["hg-11138-2"]);
  const poor = await call(member.token, "/v1/videos/unlock", { episodeId: "hg-11138-3" });
  assert.equal(poor.status, 402);
  assert.equal(poor.data.balance ?? poor.data.availableCredits, 30);
});

test("guests cannot buy an episode", async () => {
  const response = await fetchRequest(new Request("https://xumengchat.top/v1/auth/guest", {
    method: "POST", headers: { Origin: "https://xumengchat.top", "Content-Type": "application/json", "CF-Connecting-IP": randomUUID() }, body: "{}",
  }), { DB, APP_ORIGINS: "https://xumengchat.top" });
  const token = response.headers.getSetCookie?.().find(cookie => cookie.startsWith("dzmm_session="))?.split(";")[0].slice("dzmm_session=".length);
  const denied = await call(token, "/v1/videos/unlock", { episodeId: "hg-11138-2" });
  assert.equal(denied.status, 403);
});
