import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CHARACTER_SHARE_INDEX } from "../src/character-share-index";
import { applyCharacterShareTags, characterShareGEOEntries, readImageSize, renderCharacterSharePage, shareDescription, shareImagePlan, shareTitle } from "../src/character-share";
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
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(jsonLd);
  const structured = JSON.parse(jsonLd) as { "@type": string; mainEntity?: { name?: string; url?: string } };
  assert.equal(structured["@type"], "WebPage");
  assert.equal(structured.mainEntity?.name, "裴聿 - AI角色聊天");
  assert.equal(structured.mainEntity?.url, "https://xumengchat.top/c/xumeng-foreverse-peiyu");
  assert.doesNotMatch(html, /http-equiv="refresh"|location\.replace/i);
  assert.match(html, /<img src="https:\/\/xumengchat\.top\/assets\/xumeng\/share\/xumeng-foreverse-peiyu\.jpg"/);
  assert.match(html, /<main>[\s\S]*<h1>裴聿 - AI角色聊天<\/h1>/);
  assert.match(html, /在叙梦开始角色互动/);
  assert.match(html, /if \(invite\.length < 6\) return;/);
  assert.match(html, /<link rel="canonical" href="https:\/\/xumengchat\.top\/c\/xumeng-foreverse-peiyu" \/>/);
});

test("the GEO catalog is deliberately limited to public featured cards", () => {
  const entries = characterShareGEOEntries();
  assert.equal(entries.length, 8);
  assert.ok(entries.every(entry => entry.id.startsWith("xumeng-foreverse-")));
  assert.ok(entries.every(entry => !/色情|性虐|奴隶|性奴/i.test(`${entry.title} ${entry.description}`)));
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const supplied = JSON.parse(await readFile(resolve(root, "src/lib/xumeng-user-provided-cards-2026-10-24.json"), "utf8"));
  const exported = JSON.parse(await readFile(resolve(root, "src/lib/xumeng-exported-cards-2026-10-21.json"), "utf8"));
  const context = JSON.parse(await readFile(resolve(root, "src/lib/dzmm-public-context-2026-10-15.json"), "utf8"));
  const retired = new Set(JSON.parse(await readFile(resolve(root, "src/lib/xumeng-retired-cards.json"), "utf8")).ids);
  const listed = [...exported.map((card: { id: string }) => card.id), ...supplied.map((card: { id: string }) => card.id), ...context.characters.map((card: { id: string }) => card.id)];
  assert.equal(CHARACTER_SHARE_INDEX.length, listed.length - listed.filter((id: string) => retired.has(id)).length);
  const bytes = new Uint8Array(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "../dist/assets/xumeng/share/xumeng-foreverse-peiyu.jpg")));
  assert.deepEqual(readImageSize(bytes), { type: "image/jpeg", width: 1200, height: 630 });
});

test("published covers stay on an allowed public image", () => {
  const id = "published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  assert.deepEqual(shareImagePlan(`/api/dzmm/backend/v1/publishing/media/${id}/3/cover`, id), {
    kind: "backend",
    path: `/v1/publishing/media/${id}/3/cover`,
    publicationId: id,
    revision: "3",
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
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(jsonLd);
  assert.equal((JSON.parse(jsonLd) as { mainEntity?: { name?: string } }).mainEntity?.name, "裴聿 - AI角色聊天");
  assert.match(html, /id="root"/);
  assert.match(html, /<noscript>[\s\S]*<h1>裴聿 - AI角色聊天<\/h1>/);
  assert.doesNotMatch(html, /叙梦 · 角色与故事|与角色相遇，让故事继续。|xumeng-icon-512|content="512"/);
  assert.doesNotMatch(html, new RegExp('content="summary"'));
});

test("llms.txt describes only public answer-engine sources", async () => {
  const env = {
    ASSETS: { fetch: async () => new Response("not used") },
    BACKEND: { fetch: async () => new Response("not used") },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as Env;
  const response = await fetchRequest(new Request("https://xumengchat.top/llms.txt"), env);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /^# 叙梦/m);
  assert.match(body, /\/c\/xumeng-foreverse-peiyu/);
  assert.doesNotMatch(body, /性虐都市|性奴|色情/);
  assert.match(body, /私人会话、账号信息、余额/);
});

test("robots keeps APIs out of discovery while preserving the sitemap", async () => {
  const env = {
    ASSETS: { fetch: async () => new Response("not used") },
    BACKEND: { fetch: async () => new Response("not used") },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as Env;
  const response = await fetchRequest(new Request("https://xumengchat.top/robots.txt"), env);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Disallow: \/api\//);
  assert.match(body, /Sitemap: https:\/\/xumengchat\.top\/sitemap\.xml/);
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

test("a published card advertises a crawlable cover and serves it for GET and HEAD", async () => {
  const id = "published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const shell = `<!doctype html><html><head><title>叙梦 · 角色与故事</title><meta name="description" content="与角色相遇，让故事继续。" /><link rel="canonical" href="https://xumengchat.top/" /><meta property="og:url" content="https://xumengchat.top/" /><meta property="og:title" content="叙梦 · 角色与故事" /><meta property="og:description" content="与角色相遇，让故事继续。" /><meta property="og:image" content="https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png" /><meta name="twitter:card" content="summary" /><meta name="twitter:title" content="叙梦 · 角色与故事" /><meta name="twitter:image" content="https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png" /></head><body><div id="root"></div></body></html>`;
  const cover = `https://xumengchat.top/assets/xumeng/share/${id}-2.png`;
  let coverReads = 0;
  const env = {
    ASSETS: { fetch: async () => new Response(shell, { headers: { "Content-Type": "text/html; charset=utf-8" } }) },
    BACKEND: { fetch: async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith(`/v1/publishing/catalog/${id}`)) {
        return Response.json({ character: { name: "林沐沐", description: "简介: 身高165cm，纤细小巧，在学校很受欢迎，实际重度社恐。", cover: `/api/dzmm/backend/v1/publishing/media/${id}/2/cover` } });
      }
      if (url.endsWith(`/v1/publishing/media/${id}/2/cover`)) {
        coverReads += 1;
        return new Response(png, { headers: { "Content-Type": "image/png", "Content-Length": String(png.byteLength), ETag: "\"cover-2\"" } });
      }
      return new Response("no", { status: 500 });
    } },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as Env;
  const page = await fetchRequest(new Request(`https://xumengchat.top/c/${id}`), env);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /property="og:image" content="https:\/\/xumengchat\.top\/assets\/xumeng\/share\/published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-2\.png"/);
  assert.match(html, /name="twitter:image" content="https:\/\/xumengchat\.top\/assets\/xumeng\/share\/published-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-2\.png"/);
  assert.doesNotMatch(html, /property="og:image" content="[^"]*\/api\//);
  const image = await fetchRequest(new Request(cover), env);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.match(image.headers.get("cache-control") ?? "", /public/);
  assert.equal(image.headers.get("content-security-policy"), null);
  assert.equal(image.headers.get("etag"), "\"cover-2\"");
  assert.deepEqual(readImageSize(new Uint8Array(await image.arrayBuffer())), { type: "image/png", width: 1, height: 1 });
  const head = await fetchRequest(new Request(cover, { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-type"), "image/png");
  assert.equal(head.headers.get("content-length"), String(png.byteLength));
  assert.equal(await head.text(), "");
  const mismatch = await fetchRequest(new Request(cover.replace(/png$/, "jpg")), env);
  assert.equal(mismatch.status, 404);
  const denied = await fetchRequest(new Request(cover, { method: "POST" }), env);
  assert.equal(denied.status, 405);
  assert.equal(coverReads, 4);
});

test("a published card with an off-site cover still opens the app shell", async () => {
  const id = "published-a16f0000-0000-4000-8000-00000000000a";
  const cover = "https://static.aiaigirl.com/images/20260122/example.png";
  assert.equal(shareImagePlan(cover, id), null);
  const shell = `<!doctype html><html><head><title>叙梦 · 角色与故事</title><meta name="description" content="与角色相遇，让故事继续。" /><link rel="canonical" href="https://xumengchat.top/" /><meta property="og:url" content="https://xumengchat.top/" /><meta property="og:title" content="叙梦 · 角色与故事" /><meta property="og:description" content="与角色相遇，让故事继续。" /><meta property="og:image" content="https://xumengchat.top/assets/xumeng/brand/xumeng-icon-512.png" /></head><body><div id="root"></div></body></html>`;
  let assets = 0;
  let remoteReads = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("aiaigirl.com")) remoteReads += 1;
    return originalFetch(input, init);
  }) as typeof fetch;
  const env = {
    ASSETS: { fetch: async () => { assets += 1; return new Response(shell, { headers: { "Content-Type": "text/html; charset=utf-8" } }); } },
    BACKEND: { fetch: async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith(`/v1/publishing/catalog/${id}`)) {
        return Response.json({ character: { name: "林沐沐", description: "简介: 身高165cm，纤细小巧。", cover } });
      }
      if (url.endsWith("/v1/publishing/catalog/published-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")) {
        return new Response("missing", { status: 404 });
      }
      return new Response("no", { status: 500 });
    } },
    CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as Env;
  try {
    const page = await fetchRequest(new Request(`https://xumengchat.top/c/${id}`), env);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /<title>林沐沐 - AI角色聊天<\/title>/);
    assert.match(html, /id="root"/);
    assert.match(html, /property="og:image" content="https:\/\/xumengchat\.top\/assets\/xumeng\/brand\/xumeng-icon-512\.png"/);
    assert.doesNotMatch(html, /aiaigirl\.com/);
    assert.equal(assets, 1);
    assert.equal(remoteReads, 0);
    const missing = await fetchRequest(new Request("https://xumengchat.top/c/published-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), env);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), "角色不存在。");
    assert.equal(assets, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("png dimensions come from the file header", () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  assert.deepEqual(readImageSize(png), { type: "image/png", width: 1, height: 1 });
});
