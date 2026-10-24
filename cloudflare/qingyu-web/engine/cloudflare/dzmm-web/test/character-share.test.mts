import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CHARACTER_SHARE_INDEX } from "../src/character-share-index";
import { applyCharacterShareTags, readImageSize, renderCharacterSharePage, shareDescription, shareImagePlan, shareTitle } from "../src/character-share";
import { fetchRequest, type Env } from "../src/worker";

const peiyu = CHARACTER_SHARE_INDEX.find(card => card.id === "xumeng-foreverse-peiyu");

test("a listed character page carries the card tags before any script", () => {
  assert.ok(peiyu);
  const html = renderCharacterSharePage({ ...peiyu, url: `https://xumengchat.top/assets/xumeng/share/${peiyu.id}.jpg`, type: "image/jpeg", width: 1200, height: 630 });
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /<meta property="og:title" content="裴聿 - AI角色聊天" \/>/);
  assert.match(head, /<meta property="og:description" content="一个把「真相」当信仰的酷吏，和一双他从死牢里捞出来的眼睛。" \/>/);
  assert.match(head, /<meta property="og:image" content="https:\/\/xumengchat\.top\/assets\/xumeng\/share\/xumeng-foreverse-peiyu\.jpg" \/>/);
  assert.match(head, /<meta property="og:image:width" content="1200" \/>/);
  assert.match(head, /<meta property="og:image:height" content="630" \/>/);
  assert.match(head, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(head, /<meta name="twitter:title" content="裴聿 - AI角色聊天" \/>/);
  assert.match(head, /<meta name="twitter:image" content="https:\/\/xumengchat\.top\/assets\/xumeng\/share\/xumeng-foreverse-peiyu\.jpg" \/>/);
  assert.doesNotMatch(html, /http-equiv="refresh"|location\.replace/i);
  assert.match(html, /<img src="https:\/\/xumengchat\.top\/assets\/xumeng\/share\/xumeng-foreverse-peiyu\.jpg"/);
});

test("card text is escaped and kept short", () => {
  assert.equal(shareTitle(`花魁录"云绾`), `花魁录"云绾 - AI角色聊天`);
  assert.equal(shareDescription(`<b>简介: 你是醉花楼的头牌花魁云绾。</b><script>alert(1)</script>`), "你是醉花楼的头牌花魁云绾。");
  const html = renderCharacterSharePage({
    id: "published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    title: shareTitle(`花魁录"云绾`),
    description: shareDescription("简介: 你是醉花楼的头牌花魁云绾。"),
    url: "https://xumengchat.top/api/backend/v1/publishing/media/published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/1/cover",
    type: "image/png",
    width: 832,
    height: 1479,
  });
  assert.match(html, /content="花魁录&quot;云绾 - AI角色聊天"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /content="832"/);
  assert.match(html, /content="1479"/);
});

test("share covers are real 1200 by 630 jpegs", async () => {
  assert.equal(CHARACTER_SHARE_INDEX.length, 23);
  const bytes = new Uint8Array(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../dist/assets/xumeng/share/xumeng-foreverse-peiyu.jpg")));
  assert.deepEqual(readImageSize(bytes), { type: "image/jpeg", width: 1200, height: 630 });
});

test("published covers stay on an allowed public image", () => {
  const id = "published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  assert.deepEqual(shareImagePlan(`/api/dzmm/backend/v1/publishing/media/${id}/3/cover`, id), {
    kind: "backend",
    path: `/v1/publishing/media/${id}/3/cover`,
    absolute: `https://xumengchat.top/api/backend/v1/publishing/media/${id}/3/cover`,
  });
  assert.equal(shareImagePlan("https://127.0.0.1/secret.png", id), null);
  assert.equal(shareImagePlan("https://pxlorbit.com/storage/v1/object/public/pub_card_images/example.png", id)?.kind, "remote");
});

test("the app shell keeps the character card and drops the homepage card", () => {
  assert.ok(peiyu);
  const shell = `<!doctype html><html><head><title>叙梦 · 角色与故事</title><meta name="description" content="与角色相遇，让故事继续。" /><link rel="canonical" href="https://xumengchat.top/" /><meta property="og:url" content="https://xumengchat.top/" /><meta property="og:title" content="叙梦 · 角色与故事" /><meta property="og:description" content="与角色相遇，让故事继续。" /><meta property="og:image" content="https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png" /><meta property="og:image:width" content="512" /><meta property="og:image:height" content="512" /><meta name="twitter:card" content="summary" /><meta name="twitter:title" content="叙梦 · 角色与故事" /><meta name="twitter:description" content="与角色相遇，让故事继续。" /><meta name="twitter:image" content="https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png" /></head><body><div id="root"></div></body></html>`;
  const html = applyCharacterShareTags(shell, { ...peiyu, url: `https://xumengchat.top/assets/xumeng/share/${peiyu.id}.jpg`, type: "image/jpeg", width: 1200, height: 630 });
  assert.match(html, /<title>裴聿 - AI角色聊天<\/title>/);
  assert.match(html, /property="og:title" content="裴聿 - AI角色聊天"/);
  assert.match(html, /property="og:image" content="https:\/\/xumengchat\.top\/assets\/xumeng\/share\/xumeng-foreverse-peiyu\.jpg"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /id="root"/);
  assert.doesNotMatch(html, /叙梦 · 角色与故事|与角色相遇，让故事继续。|xumeng-icon-512|content="512"|content="summary"/);
});

test("the live path returns the tags and an unknown id does not fall through to the homepage", async () => {
  let assets = 0;
  let backend = 0;
  const shell = `<!doctype html><html><head><title>叙梦 · 角色与故事</title><meta property="og:title" content="叙梦 · 角色与故事" /><meta property="og:description" content="与角色相遇，让故事继续。" /><meta property="og:image" content="https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png" /><meta name="twitter:card" content="summary" /><meta name="twitter:title" content="叙梦 · 角色与故事" /><meta name="twitter:image" content="https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png" /></head><body><div id="root"></div></body></html>`;
  const env = {
    ASSETS: { fetch: async () => { assets += 1; return new Response(shell, { headers: { "Content-Type": "text/html; charset=utf-8" } }); } },
    BACKEND: { fetch: async () => { backend += 1; return new Response("no", { status: 500 }); } },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as Env;
  const page = await fetchRequest(new Request("https://xumengchat.top/c/xumeng-foreverse-peiyu"), env);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /property="og:image" content="https:\/\/xumengchat\.top\/assets\/xumeng\/share\/xumeng-foreverse-peiyu\.jpg"/);
  assert.match(html, /id="root"/);
  assert.doesNotMatch(html, /location\.replace/);
  assert.equal(assets, 1);
  assert.equal(backend, 0);
  const missing = await fetchRequest(new Request("https://xumengchat.top/c/missing-character"), env);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "角色不存在。");
  assert.equal(assets, 1);
});

test("png dimensions come from the file header", () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  assert.deepEqual(readImageSize(png), { type: "image/png", width: 1, height: 1 });
});
