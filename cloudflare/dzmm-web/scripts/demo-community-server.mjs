import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Independent, loopback-only preview. No production component or data is changed.
// This server has no network client and never proxies API or media requests.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const DEFAULT_DATA = resolve(repository, "output/xumeng/demo-community-20261009/community.json");
const DEFAULT_DIST = resolve(here, "../dist");
const OWNER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER = { id: OWNER, email: null, nickname: "本地演示访客", isGuest: false, role: "user" };
const READ_ONLY = "这是独立本地演示，人物与内容均为原创虚构示例；此操作不会保存或提交到主站。";
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const number = (value, fallback, maximum = 100_000) => /^\d+$/.test(String(value ?? "")) ? Math.min(maximum, Number(value)) : fallback;
const label = value => String(value).includes("演示") ? String(value) : `【演示】${value}`;
const MIME = { ".html": "text/html;charset=utf-8", ".js": "text/javascript;charset=utf-8", ".mjs": "text/javascript;charset=utf-8", ".css": "text/css;charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json;charset=utf-8", ".woff": "font/woff", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-src 'none'; form-action 'self'; base-uri 'self'";

const demoCss = `:root{--demo-height:94px}body{padding-top:var(--demo-height)!important}.demo-banner{position:fixed;top:0;left:0;right:0;z-index:80;box-sizing:border-box;padding:10px 20px;background:#fff0f5;color:#822246;border-bottom:1px solid #f8cddd;font:12px/1.65 -apple-system,BlinkMacSystemFont,"Noto Sans SC",sans-serif}.demo-banner strong{font-weight:650}.demo-banner p{margin:2px 0 5px}.demo-links{display:flex;gap:6px 17px;align-items:center;flex-wrap:wrap}.demo-links a{display:inline-flex;min-height:32px;align-items:center;color:#b31b57;text-decoration:none}.demo-links a:focus-visible,.demo-page :is(a,input,button):focus-visible{outline:2px solid #ed1763;outline-offset:3px}[class*="topbar_"]{top:var(--demo-height)!important}.demo-page{max-width:1160px;margin:0 auto;padding:30px 22px 80px;font:14px/1.8 -apple-system,BlinkMacSystemFont,"Noto Sans SC",sans-serif;color:#25252b}.demo-page h1{font-size:26px;margin:0 0 8px}.demo-page header p{color:#71717a;margin:0 0 22px}.demo-search{display:flex;gap:10px;align-items:center;margin:0 0 22px;flex-wrap:wrap}.demo-search input{padding:11px 12px;border:1px solid #dedee3;border-radius:8px;min-height:44px;box-sizing:border-box;font:inherit;flex:1;min-width:0}.demo-search button,.demo-pagination a{border:1px solid #dedee3;border-radius:8px;padding:8px 14px;min-height:44px;box-sizing:border-box;background:white;color:#25252b;font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}.demo-profiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 25px;border-top:1px solid #eee}.demo-profile{border-bottom:1px solid #eee;padding:23px 0;min-width:0}.demo-profile h2{font-size:15px;margin:8px 0;overflow-wrap:anywhere}.demo-profile img{width:48px;height:48px;border-radius:50%;float:left;margin-right:12px}.demo-profile .demo-tag{color:#a31850;font-size:11px}.demo-profile p{color:#71717a;font-size:12px;clear:both;overflow-wrap:anywhere}.demo-profile a{color:#b31b57;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}.demo-pagination{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-top:25px}.demo-pagination div{display:flex;gap:9px}.demo-toast{position:fixed;left:20px;right:20px;bottom:78px;z-index:130;max-width:600px;margin:auto;background:#822246;color:white;padding:13px 16px;border-radius:10px;font:12px/1.8 sans-serif}.demo-muted{color:#71717a;font-size:12px}@media(max-width:760px){.demo-banner{padding:9px 13px;font-size:11px}.demo-links{gap:3px 12px}.demo-page{padding:25px 17px 85px}.demo-profiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}.demo-profile h2{font-size:14px}.demo-pagination{align-items:flex-start;flex-direction:column}.demo-pagination div{align-self:flex-end}}@media(max-width:480px){.demo-profiles{grid-template-columns:1fr}.demo-search input{flex-basis:100%}.demo-links a{min-height:30px}}@media(prefers-color-scheme:dark){body.demo-directory{background:#080808}.demo-banner{background:#311421;border-color:#5c2540;color:#ffd3e2}.demo-banner a{color:#ff8db5}.demo-page{color:#f4f4f5}.demo-page header p,.demo-profile p,.demo-muted{color:#aaaab5}.demo-profiles,.demo-profile{border-color:#303039}.demo-profile .demo-tag,.demo-profile a{color:#ff8db5}.demo-search input,.demo-search button,.demo-pagination a{background:#121212;color:#f4f4f5;border-color:#33333b}}`;
function banner() {
  return `<aside class="demo-banner" aria-label="独立演示环境"><strong>叙梦 · 本地原创演示社区</strong><p>100 个虚构人物档案与原创示例内容；不是已注册用户、真实活跃度或交易。只读预览。</p><nav class="demo-links" aria-label="演示导航"><a href="/#characters">角色</a><a href="/#forum">论坛</a><a href="/#tasks">委托</a><a href="/#novels">小说副本</a><a href="/demo/authors">100 人物档案</a></nav></aside>`;
}
const demoScript = `(()=>{const b=document.querySelector('.demo-banner');const resize=()=>{if(b)document.documentElement.style.setProperty('--demo-height',b.getBoundingClientRect().height+'px')};resize();if(b)new ResizeObserver(resize).observe(b);window.addEventListener('resize',resize);let t;const tell=()=>{let n=document.querySelector('.demo-toast');if(!n){n=document.createElement('div');n.className='demo-toast';n.setAttribute('role','status');document.body.append(n)}n.textContent=${JSON.stringify(READ_ONLY)};clearTimeout(t);t=setTimeout(()=>n.remove(),6000)};const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{try{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(u.origin!==location.origin){tell();return Promise.reject(new TypeError('Independent demo blocks external requests'))}if((init?.method||(input instanceof Request?input.method:'GET')).toUpperCase()!=='GET')tell();return nativeFetch(input,init)}catch(e){return Promise.reject(e)}};document.addEventListener('click',e=>{const a=e.target instanceof Element?e.target.closest('a[href]'):null;if(a){const u=new URL(a.href,location.href);if(u.origin!==location.origin&&!['blob:','data:'].includes(u.protocol)){e.preventDefault();tell()}}},true);const repair=()=>{document.querySelectorAll('a[href^="https://www.dzmm.ai/"]').forEach(a=>{a.removeAttribute('href');a.textContent='原创演示内容来源'});document.querySelectorAll('[class*="authorInfo_"]>p').forEach(p=>{if(p.textContent!=='虚构演示人物 · 原创示例署名')p.textContent='虚构演示人物 · 原创示例署名'});document.querySelectorAll('[class*="source_"]>span').forEach(n=>{if(n.textContent.includes('简介、开场白和角色设定为本地原创样本。')||n.textContent.includes('这是本站作者提交并经审核发布的角色。'))n.textContent='原创演示角色 · 作者为虚构示例档案；未经过真实账号投稿或审核。'});document.querySelectorAll('[class*="cardActions_"]>span').forEach(n=>{if(n.textContent==='0 人已验收')n.textContent='演示委托 · 没有真实领取'});document.querySelectorAll('[class*="floatingChat_"]').forEach(n=>{n.style.display='none'});};new MutationObserver(repair).observe(document.getElementById('root')||document.body,{childList:true,subtree:true});})();`;
function shell(body, { app = false, css = "", title = "叙梦原创演示人物" } = {}) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)}</title><style>${demoCss}${css}</style></head><body class="${app ? "" : "demo-directory"}">${banner()}${body}<script>${demoScript}</script></body></html>`;
}
function avatar(profile, index) {
  const colors = ["#ffe5ee", "#e8ecff", "#ddf5ed", "#f8ead4", "#e7eff7", "#efe5fb", "#f7e2dc", "#e6f0dc", "#dff1f2", "#f1e4e8"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="${colors[index % colors.length]}"/><path d="M-10 76Q50 ${index % 2 ? 25 : 120} 112 64" fill="none" stroke="#ffffffaa" stroke-width="14"/><text x="50" y="61" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#655066">${escape((profile.nickname || "演").slice(0, 1))}</text></svg>`;
}
function cover(character, index) {
  const colors = [["#edb9d0", "#604661"], ["#d2dbb7", "#53695a"], ["#adc4d7", "#41586d"], ["#d6c8e7", "#665a80"], ["#edccb0", "#806047"]];
  const [light, dark] = colors[index % colors.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect width="480" height="640" fill="url(#bg)"/><circle cx="${100 + (index % 5) * 55}" cy="150" r="85" fill="#ffffff30"/><path d="M-20 490Q120 ${300 + index % 6 * 20} 250 480T520 430V660H-20Z" fill="#ffffff28"/><path d="M0 520Q230 350 500 530V660H0Z" fill="#00000015"/><rect x="26" y="26" width="114" height="34" rx="17" fill="#ffffffc9"/><text x="83" y="49" font-family="sans-serif" font-size="17" text-anchor="middle" fill="${dark}">原创演示</text><text x="34" y="565" font-family="sans-serif" font-size="25" fill="white">${escape((character.name || "原创角色").replace(/^【演示】/, "").slice(0, 15))}</text><text x="34" y="602" font-family="sans-serif" font-size="17" fill="#ffffffe0">${escape((character.author || "虚构演示人物").slice(0, 22))}</text></svg>`;
}

export async function createDemoCommunityServer({ dataPath = DEFAULT_DATA, distPath = DEFAULT_DIST, port = 21982 } = {}) {
  const raw = await readFile(dataPath, "utf8"), data = JSON.parse(raw);
  for (const [key, count] of [["profiles", 100], ["characters", 40], ["posts", 100], ["tasks", 24], ["novels", 8]]) {
    if (!Array.isArray(data[key]) || data[key].length !== count) throw new Error(`演示数据 ${key} 必须有 ${count} 条，尚未启动。`);
    if (data[key].some(entry => entry?.isDemo !== true)) throw new Error(`演示数据 ${key} 含未标明虚构来源的对象，尚未启动。`);
  }
  const profiles = data.profiles, profileMap = new Map(profiles.map(p => [p.id, p]));
  if (profileMap.size !== 100 || profiles.some(p => !p.isDemo || !p.nickname?.includes("演示"))) throw new Error("演示人物标记或唯一 ID 无效。");
  const generatedAt = Date.parse(data.generatedAt || data.createdAt || "2026-10-09T10:00:00Z");
  const now = Number.isFinite(generatedAt) ? generatedAt : Date.UTC(2026, 9, 9, 10);
  // Existing bundled client only retains sourceKind public-summary as the source
  // catalog after publication pagination. This local wire adapter is explicitly
  // fixture data, never a claim of real import/publication. The banner + labeled
  // names + local source explanation identify every sample as original fiction.
  const characters = data.characters.map((c, index) => ({ ...c, name: label(c.name), author: label(c.author), heat: "—", likes: "—", tags: [...new Set([...(c.tags || []), "演示内容", "一般向"])],
    cover: `/demo/assets/cover/${encodeURIComponent(c.id)}.svg`, sourceKind: "public-summary", promptOrigin: "original", sourceUrl: "", createdAt: c.createdAt || new Date(now).toISOString(),
    publication: { id: c.publication?.id || `demo-${c.id}`, authorId: c.publication?.authorId || profiles[index % 100].id, revision: 1 } }));
  if (new Set(characters.map(c => c.id)).size !== 40 || characters.some(c => !profileMap.has(c.publication.authorId))) throw new Error("演示角色与署名关联无效。");
  const posts = data.posts.map(p => ({ ...p, title: label(p.title), upvotes: 0, downvotes: 0, replyCount: 0, myVote: 0 }));
  if (new Set(posts.map(p => p.id)).size !== 100 || posts.some(p => !profileMap.has(p.author?.id))) throw new Error("演示主题与署名关联无效。");
  const tasks = data.tasks.map(t => ({ ...t, title: label(t.title), canClaim: false, approvedCount: 0, submissionCount: 0, participating: false, hidden: false, reviewReason: READ_ONLY }));
  if (new Set(tasks.map(t => t.id)).size !== 24 || tasks.some(t => !profileMap.has(t.owner?.id))) throw new Error("演示委托与署名关联无效。");
  const novels = data.novels.map(entry => {
    if (!profileMap.has(entry.ownerId) || !entry.draft?.chapters?.length) throw new Error("演示小说与虚构作者关联无效。");
    const d = entry.draft, author = profileMap.get(entry.ownerId);
    const work = { ...d, title: `【演示副本】${d.title.replace(/^【演示】/, "")}`, synopsis: `${author.nickname}的原创演示作品，仅在本地访客工作台只读展示。\n${d.synopsis}`, version: 1, createdAt: now, updatedAt: now };
    delete work.chapters;
    const chapters = d.chapters.map((c, index) => ({ ...c, workId: d.id, position: index, version: 1, createdAt: now, updatedAt: now }));
    return { accountId: OWNER, work, chapters };
  });
  const state = { version: 1, custom: [], favorites: [], conversations: [], preferences: { nickname: USER.nickname, persona: "", preset: "", model: "qwen", dark: false, theme: "light", worldClockMode: "story" } };
  const metrics = { readOnly: true, outgoingRequests: 0, mutationsBlocked: 0, unknownApis: 0, requests: 0, manifestSha256: createHash("sha256").update(raw).digest("hex") };
  const index = await readFile(resolve(distPath, "index.html"), "utf8");
  const scriptPaths = [...index.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map(match => match[1]);
  if (!scriptPaths.length) throw new Error("独立演示需要已经构建的前端 dist，尚未启动。");
  const frozenResources = new Map(await Promise.all(scriptPaths.map(async path => [path, await readFile(resolve(distPath, `.${path}`))])));
  const appHtml = index.replace(/<title>[^<]*<\/title>/, "<title>叙梦 · 原创虚构社区演示</title>").replace("</head>", `<meta name="robots" content="noindex,nofollow"><style>${demoCss}</style></head>`).replace("<body>", `<body>${banner()}<script>${demoScript}</script>`);
  const json = (res, value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json;charset=utf-8", "Cache-Control": "no-store", "X-Xumeng-Independent-Demo": "true", "X-Content-Type-Options": "nosniff" }); res.end(JSON.stringify(value)); };
  const html = (res, value, status = 200) => { res.writeHead(status, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Xumeng-Independent-Demo": "true", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" }); res.end(value); };
  const slice = (items, url, extra = {}) => { const limit = Math.max(1, number(url.searchParams.get("limit"), 20, 50)), offset = number(url.searchParams.get("offset"), 0); return { ...extra, items: items.slice(offset, offset + limit), total: items.length, limit, offset, hasMore: offset + limit < items.length }; };
  function directory(url) {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100), offset = number(url.searchParams.get("offset"), 0), selected = profiles.filter(p => `${p.nickname} ${p.bio} ${p.genres?.join(" ")}`.includes(q));
    const entries = selected.slice(offset, offset + 20).map(p => {
      const own = characters.filter(c => c.publication.authorId === p.id);
      return `<article class="demo-profile"><img src="/demo/assets/avatar/${encodeURIComponent(p.id)}.svg" alt=""><span class="demo-tag">虚构演示人物</span><h2>${escape(p.nickname)}</h2><p>${escape(p.bio)}</p><span class="demo-muted">${escape(p.genres?.join(" · ") || "原创创作")}</span><div>${own.length ? own.map(c => `<a href="/#character/${encodeURIComponent(c.id)}">查看${escape(c.name)}</a>`).join("<br>") : '<span class="demo-muted">本次示例以论坛主题展示</span>'}</div><a href="/#forum/post/${encodeURIComponent(posts.find(post => post.author.id === p.id)?.id || "")}">查看原创主题</a></article>`;
    }).join("");
    const link = start => `/demo/authors?${new URLSearchParams({ q, offset: String(start) })}`;
    return shell(`<main class="demo-page"><header><h1>100 个原创演示人物</h1><p>人物档案是虚构署名，用于浏览原创示例；没有创建真实注册账户。</p></header><form class="demo-search" method="get"><input aria-label="搜索演示人物" name="q" value="${escape(q)}" maxlength="100" placeholder="搜索昵称、主创方向或简介"><button type="submit">搜索</button></form><div class="demo-profiles">${entries || "<p>没有匹配的原创演示人物。</p>"}</div><footer class="demo-pagination"><span>${selected.length} 个匹配档案 · 本页 ${Math.min(20, Math.max(0, selected.length - offset))} 个</span><div>${offset ? `<a href="${escape(link(Math.max(0, offset - 20)))}">上一页</a>` : ""}${offset + 20 < selected.length ? `<a href="${escape(link(offset + 20))}">下一页</a>` : ""}</div></footer></main>`);
  }
  const server = createServer(async (req, res) => {
    metrics.requests++;
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const path = decodeURIComponent(url.pathname);
      if (req.method !== "GET" && req.method !== "HEAD") { metrics.mutationsBlocked++; return json(res, { error: READ_ONLY, code: "demo_read_only" }, 403); }
      if (path === "/demo/health") return json(res, { ok: true, ...metrics, counts: { profiles: profiles.length, characters: characters.length, posts: posts.length, tasks: tasks.length, novels: novels.length }, resources: scriptPaths, viewerId: OWNER });
      if (path === "/demo/metrics") return json(res, metrics);
      if (path === "/demo/authors") return html(res, directory(url));
      if (path.startsWith("/demo/assets/avatar/")) {
        const id = path.slice("/demo/assets/avatar/".length).replace(/\.svg$/, ""), profile = profileMap.get(id);
        if (!profile) return json(res, { error: "演示头像不存在" }, 404);
        res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" }); return res.end(avatar(profile, profiles.indexOf(profile)));
      }
      if (path.startsWith("/demo/assets/cover/")) {
        const id = path.slice("/demo/assets/cover/".length).replace(/\.svg$/, ""), character = characters.find(c => c.id === id);
        if (!character) return json(res, { error: "演示封面不存在" }, 404);
        res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" }); return res.end(cover(character, characters.indexOf(character)));
      }
      if (path.startsWith("/api/")) {
        const A = "/api/backend/v1", q = url.searchParams;
        if (path === `${A}/session`) return json(res, { user: USER, authenticated: true });
        if (path === `${A}/state`) return json(res, { user: USER, state, version: 0, initialized: true });
        if (path === `${A}/characters`) return json(res, { characters });
        if (path === `${A}/publishing/catalog`) return json(res, { characters: [], total: 0, limit: 20, offset: number(q.get("offset"), 0), hasMore: false });
        if (path === `${A}/publishing/mine`) return json(res, { publications: [], total: 0, limit: 20, offset: 0, hasMore: false });
        if (path === "/api/chat") return json(res, { configured: false, model: "本地演示不调用模型", reason: READ_ONLY });
        if (path === `${A}/billing/config`) return json(res, { enabled: false, priceRevision: null, inputCreditsPer1000: null, outputCreditsPer1000: null, memoryBilled: false, tokenUnit: 1000, rounding: "ceil_combined", outputIncludesReasoning: true, failureRule: "no_valid_output_refund", cancellationRule: "valid_output_bill_usage", missingUsageRule: "pending_then_refund", reservationTtlMs: 600000 });
        if (path === `${A}/billing/usage`) return json(res, { accountId: OWNER, availableBalance: 0, reservedCredits: 0, totalSpent: 0, debtCredits: 0, items: [], nextCursor: null });
        if (path === `${A}/payments/wallet`) return json(res, { accountId: OWNER, balance: 0, orders: [], mode: "live", testMode: false, provider: "zpay", creditUnlimited: false, billingExempt: false, totalPurchased: 0, totalRefunded: 0 });
        if (path === `${A}/payments/config`) return json(res, { enabled: false, currency: "cny", packages: [], note: READ_ONLY, modelBillingLinked: true, provider: "zpay", mode: "live", testMode: false, methods: [] });
        if (path === `${A}/subscriptions/config`) return json(res, { provider: "zpay", mode: "live", testMode: false, enabled: false, timezone: "Asia/Shanghai", renewal: "manual", autoRenew: false, modelBillingLinked: true, methods: [], plans: [], note: READ_ONLY });
        if (path === `${A}/subscriptions`) return json(res, { accountId: OWNER, provider: "zpay", mode: "live", testMode: false, serverTime: now, balance: 0, totalSubscriptionGranted: 0, subscriptions: [], checkin: { subscriptionId: null, dayKey: new Date(now + 8 * 3600000).toISOString().slice(0, 10), timezone: "Asia/Shanghai", claimed: false, claimable: false, rewardCredits: 0, claimedAt: null, resetAt: now + 86400000 } });
        if (path === `${A}/chat-media`) return json(res, { accountId: OWNER, conversationId: q.get("conversationId"), vip: { active: false, expiresAt: null, adminPreview: false }, features: { audio: false, image: false }, limits: { audio: 0, image: 0, maxVoiceChars: 800 }, usage: { audio: 0, image: 0 }, assets: [] });
        if (path === "/api/live/status") return json(res, { accountId: OWNER, available: false, configured: false, realAllowed: false });
        if (path === `${A}/generation/config`) return json(res, { accountId: OWNER, enabled: false, costMultiplier: 3, models: [], note: READ_ONLY });
        if (path === `${A}/generation/jobs`) return json(res, { accountId: OWNER, jobs: [] });
        if (path === `${A}/tasks`) return json(res, { accountId: OWNER, isGuest: false, serverTime: now, resetAt: now + 86400000, timezone: "UTC", pointsKind: "credit", modelBillingLinked: true, rewardUnit: "Credit", note: READ_ONLY, points: { balance: 0, totalEarned: 0, expired: 0, expiringSoon: 0, earliestExpiryAt: null }, tasks: [], recentClaims: [] });
        if (path === `${A}/forum/posts`) {
          const values = posts.filter(p => (!q.get("category") || p.category === q.get("category")) && (!q.get("tag") || p.tags.includes(q.get("tag"))) && (!q.get("q") || `${p.title} ${p.body} ${p.author.nickname}`.includes(q.get("q"))));
          const offset = q.has("cursor") ? number((q.get("cursor") || "").replace(/^demo:/, ""), 0) : number(q.get("offset"), 0), limit = 20;
          const tagCounts = new Map(); for (const post of values) for (const tag of post.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          return json(res, { posts: values.slice(offset, offset + limit), total: values.length, limit, offset, hasMore: offset + limit < values.length, nextCursor: offset + limit < values.length ? `demo:${offset + limit}` : null, popularTags: [...tagCounts].slice(0, 15).map(([tag, count]) => ({ tag, count })) });
        }
        if (path.startsWith(`${A}/forum/posts/`)) { const post = posts.find(p => p.id === path.slice(`${A}/forum/posts/`.length)); return post ? json(res, { post, replies: [], total: 0, offset: 0, limit: 20, hasMore: false, nextCursor: null }) : json(res, { error: "演示主题不存在" }, 404); }
        if (path === `${A}/task-market`) {
          const values = tasks.filter(t => (!q.get("category") || q.get("category") === "all" || t.category === q.get("category")) && (!q.get("q") || `${t.title} ${t.description} ${t.owner.nickname}`.includes(q.get("q"))) && (!q.get("filter") || ["all", "open"].includes(q.get("filter"))));
          const page = slice(values, url); return json(res, { accountId: OWNER, pointsKind: "credit", modelBillingLinked: true, rewardUnit: "Credit", tasks: page.items, total: page.total, offset: page.offset, limit: page.limit, hasMore: page.hasMore });
        }
        if (path.startsWith(`${A}/task-market/`)) { const task = tasks.find(t => t.id === path.slice(`${A}/task-market/`.length)); return task ? json(res, { accountId: OWNER, task, assignment: null, submissions: [] }) : json(res, { error: "演示委托不存在" }, 404); }
        if (path === `${A}/novels`) return json(res, { accountId: OWNER, works: novels.map(n => ({ ...n.work, chapterCount: n.chapters.length, wordCount: n.chapters.reduce((sum, c) => sum + (c.content.match(/\S/gu)?.length || 0), 0) })) });
        if (path.startsWith(`${A}/novels/`)) { const novel = novels.find(n => n.work.id === path.slice(`${A}/novels/`.length)); return novel ? json(res, novel) : json(res, { error: "演示小说副本不存在" }, 404); }
        if (path.startsWith(`${A}/admin`)) return json(res, { error: "演示访客没有后台权限，本地预览不模拟管理账号。" }, 403);
        metrics.unknownApis++; return json(res, { error: "此 API 未加入独立演示；请求不会转发到主站。", code: "demo_api_not_available" }, 404);
      }
      if (path === "/" || path === "/index.html") return html(res, appHtml);
      if (frozenResources.has(path)) { res.writeHead(200, { "Content-Type": MIME[extname(path)], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); return req.method === "HEAD" ? res.end() : res.end(frozenResources.get(path)); }
      const file = resolve(distPath, `.${path}`);
      if (!file.startsWith(resolve(distPath) + sep)) return json(res, { error: "路径无效" }, 403);
      try {
        const info = await stat(file); if (!info.isFile()) throw new Error("not file");
        const bytes = await readFile(file); res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); return req.method === "HEAD" ? res.end() : res.end(bytes);
      } catch { return json(res, { error: "本地演示资源不存在；不会尝试访问外站。" }, 404); }
    } catch (error) { json(res, { error: `本地演示请求失败：${error instanceof Error ? error.message : "未知错误"}` }, 500); }
  });
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", accept); });
  return { server, metrics, url: `http://127.0.0.1:${server.address().port}`, viewerId: OWNER };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, "").split(/=(.*)/s, 2)));
  const handle = await createDemoCommunityServer({ ...(flags.data ? { dataPath: resolve(flags.data) } : {}), ...(flags.dist ? { distPath: resolve(flags.dist) } : {}), ...(flags.port ? { port: Number(flags.port) } : {}) });
  process.stdout.write(`${JSON.stringify({ url: handle.url, readOnly: true, manifestSha256: handle.metrics.manifestSha256, viewerId: handle.viewerId })}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => handle.server.close(() => process.exit(0)));
}
