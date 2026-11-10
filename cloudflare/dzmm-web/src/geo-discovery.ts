import { characterShareGEOEntries, characterShareLocations, shareTitle } from "./character-share";
import { XUMENG_COMMUNITY_GUIDELINES_DATE, XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION, XUMENG_COMMUNITY_GUIDELINES_PATH, XUMENG_COMMUNITY_GUIDELINES_TITLE } from "../../../src/lib/xumeng-community-guidelines";
import { XUMENG_PAYMENT_INFO_DRAFT, XUMENG_PAYMENT_INFO_PAGES } from "../../../src/lib/xumeng-payment-info";
import { gtmBodyHtml, gtmHeadHtml } from "./gtm";
import { xumengPublicTailHtml } from "../../../src/lib/xumeng-public-tail";
import { XUMENG_LOCALE_OPTIONS, xumengHtmlLang, xumengLocaleRoutePrefix, type XumengLocale } from "../../../src/lib/xumeng-i18n";

export const GEO_SITE = "https://xumengchat.top";
export const GEO_UPDATED = "2026-11-05";
export const GEO_DEFINITION = `叙梦（XUMENG）是 ${GEO_SITE}/ 上的 AI 角色卡与连续剧情互动故事空间。`;
export const GEO_BOUNDARY = "私人会话、账号信息、余额与未公开内容不在公开资料中。";
export const GEO_META_DESCRIPTION = "叙梦（XUMENG）是 AI 角色卡与连续剧情的互动故事空间。浏览公开角色、世界书与开场设定，再进入站内继续对话。";

const LANDING_SEO: Readonly<Record<XumengLocale, { title: string; description: string; heading: string; body: string; keywords: string[]; ogLocale: string }>> = Object.freeze({
  en: { title: "XUMENG | AI Character Cards, Roleplay and Interactive Stories", description: "Discover AI character cards, roleplay characters, worldbuilding and interactive stories on XUMENG.", heading: "AI character cards and interactive stories", body: "Browse public AI character cards, roleplay characters, worldbuilding settings and story openings, then continue the story in XUMENG.", keywords: ["AI character cards", "AI roleplay", "interactive stories", "worldbuilding"], ogLocale: "en_US" },
  "zh-Hans": { title: "叙梦｜AI角色卡、角色扮演与互动故事", description: "在叙梦发现 AI 角色卡、角色扮演、世界书和连续互动故事。", heading: "AI角色卡与互动故事", body: "浏览公开 AI 角色卡、角色扮演角色、世界书和故事开场设定，再进入叙梦继续互动剧情。", keywords: ["AI角色卡", "角色扮演", "互动故事", "世界书"], ogLocale: "zh_CN" },
  "zh-Hant": { title: "叙夢｜AI角色卡、角色扮演與互動故事", description: "在叙夢探索 AI 角色卡、角色扮演、世界書與連續互動故事。", heading: "AI角色卡與互動故事", body: "瀏覽公開 AI 角色卡、角色扮演角色、世界書與故事開場設定，再進入叙夢繼續互動劇情。", keywords: ["AI角色卡", "角色扮演", "互動故事", "世界書"], ogLocale: "zh_TW" },
  ja: { title: "XUMENG｜AIキャラクターカード・ロールプレイ・インタラクティブストーリー", description: "XUMENGでAIキャラクターカード、ロールプレイ、世界観設定、インタラクティブストーリーを探そう。", heading: "AIキャラクターカードと物語体験", body: "公開AIキャラクターカード、ロールプレイ用キャラクター、世界観設定、ストーリーの導入を見つけて、XUMENGで続きを楽しめます。", keywords: ["AIキャラクターカード", "AIロールプレイ", "インタラクティブストーリー", "世界観設定"], ogLocale: "ja_JP" },
  ko: { title: "XUMENG｜AI 캐릭터 카드·롤플레이·인터랙티브 스토리", description: "XUMENG에서 AI 캐릭터 카드, 롤플레이, 세계관 설정과 인터랙티브 스토리를 찾아보세요.", heading: "AI 캐릭터 카드와 인터랙티브 스토리", body: "공개 AI 캐릭터 카드, 롤플레이 캐릭터, 세계관 설정과 스토리 도입부를 둘러보고 XUMENG에서 이야기를 이어갈 수 있습니다.", keywords: ["AI 캐릭터 카드", "AI 롤플레이", "인터랙티브 스토리", "세계관 설정"], ogLocale: "ko_KR" },
});

export function localizedLandingLocale(normalizedPath: string): XumengLocale | null {
  const option = XUMENG_LOCALE_OPTIONS.find(item => item.locale !== "zh-Hans" && `/${item.routePrefix}` === normalizedPath);
  return option?.locale ?? null;
}

export function localizedLandingPath(locale: XumengLocale): string {
  return locale === "zh-Hans" ? "/" : `/${xumengLocaleRoutePrefix(locale)}`;
}

export function localizedLandingSeo(locale: XumengLocale) {
  return LANDING_SEO[locale] ?? LANDING_SEO[XUMENG_LOCALE_OPTIONS[1].locale];
}

export function localizedLandingAlternates(): readonly { locale: XumengLocale; href: string; hreflang: string }[] {
  return XUMENG_LOCALE_OPTIONS.map(option => ({ locale: option.locale, href: `${GEO_SITE}${localizedLandingPath(option.locale)}`, hreflang: option.htmlLang.toLowerCase() }));
}

export function localizedLandingJsonLd(locale: XumengLocale): string {
  const seo = localizedLandingSeo(locale);
  const url = `${GEO_SITE}${localizedLandingPath(locale)}`;
  return jsonLd({ "@context": "https://schema.org", "@type": "WebSite", "@id": `${url}#website`, url, name: "XUMENG", description: seo.description, inLanguage: xumengHtmlLang(locale), publisher: { "@type": "Organization", name: "XUMENG", url: `${GEO_SITE}/` } });
}

export function renderLocalizedLandingFallback(locale: XumengLocale): string {
  const seo = localizedLandingSeo(locale);
  const path = localizedLandingPath(locale);
  const cards = featuredCharacters().slice(0, 8).map(card => `<li><a href="${path === "/" ? "" : path}/c/${card.id}">${escapeHtml(card.title)}</a></li>`).join("");
  return `<main id="xumeng-public-intro" style="max-width:760px;margin:0 auto;padding:32px 20px;font:16px/1.7 system-ui,sans-serif;color:#f4efe8;background:#07070b"><h1>${escapeHtml(seo.heading)}</h1><p>${escapeHtml(seo.body)}</p><p>${seo.keywords.map(escapeHtml).join(" · ")}</p><h2>${escapeHtml(locale === "en" ? "Featured public characters" : locale === "ja" ? "注目の公開キャラクター" : locale === "ko" ? "추천 공개 캐릭터" : "精选公开角色")}</h2><ul>${cards}</ul></main>`;
}

const ANSWER_AGENTS = [
  "*",
  "Googlebot",
  "Google-Extended",
  "GoogleOther",
  "Bingbot",
  "Baiduspider",
  "Sogou web spider",
  "360Spider",
  "YisouSpider",
  "Bytespider",
  "PetalBot",
  "Applebot",
  "Applebot-Extended",
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "Amazonbot",
  "CCBot",
  "Meta-ExternalAgent",
  "FacebookBot",
  "cohere-ai",
  "YouBot",
  "DuckAssistBot",
  "Diffbot",
] as const;

type GeoPageId = "about" | "faq" | "characters";

const GEO_DOCUMENTS = new Set([
  "/llms.txt",
  "/llms-full.txt",
  "/.well-known/llms.txt",
  "/robots.txt",
  "/sitemap.xml",
  "/feed.xml",
  "/about",
  "/faq",
  "/characters",
]);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function featuredCharacters() {
  return characterShareGEOEntries();
}

function robotDisallows(): string[] {
  const paths = ["/api/", "/health", "/jump", "/go/"];
  if (XUMENG_PAYMENT_INFO_DRAFT) paths.push(...XUMENG_PAYMENT_INFO_PAGES.map(page => page.path));
  return paths;
}

export function geoCanonicalPath(normalizedPath: string): string | null {
  return GEO_DOCUMENTS.has(normalizedPath) ? normalizedPath : null;
}

export function publicRobotsTxt(): string {
  const rules = ["Allow: /", "Allow: /c/", "Allow: /assets/xumeng/share/", ...robotDisallows().map(path => `Disallow: ${path}`)];
  const groups = ANSWER_AGENTS.map(agent => [`User-agent: ${agent}`, ...rules].join("\n"));
  return [
    "# 叙梦公开发现。回答引擎可引用首页、说明、问答、精选角色、社区公约、llms.txt 与公开角色页。",
    `# llms: ${GEO_SITE}/llms.txt`,
    `# llms-full: ${GEO_SITE}/llms-full.txt`,
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "",
    groups.join("\n\n"),
    "",
    `Sitemap: ${GEO_SITE}/sitemap.xml`,
    "",
  ].join("\n");
}

type SitemapEntry = { loc: string; lastmod?: string; changefreq: string; priority: string; image?: { loc: string; title?: string } };

export type PublishedSitemapCharacter = { id: string; updatedAt: number; revision: number; coverExtension: "png" | "jpg" | null; title?: string };

const PUBLISHED_SITEMAP_ID = /^published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SITEMAP_CATALOG = "https://dzmm-backend.850587960.workers.dev/v1/publishing/sitemap";
const SITEMAP_CACHE = "https://xumengchat.top/sitemap.xml?v=character-title";

function sitemapLastmod(updatedAt: number): string | undefined {
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0 || updatedAt > 10_000_000_000_000) return undefined;
  const iso = new Date(updatedAt).toISOString();
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined;
}

/** Accept only the anonymous sitemap index. Anything else means the catalog was not read. */
export function publishedSitemapCharacters(payload: unknown): PublishedSitemapCharacter[] | null {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { characters?: unknown }).characters)) return null;
  const rows = (payload as { characters: unknown[] }).characters.slice(0, 50_000);
  const characters: PublishedSitemapCharacter[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; updatedAt?: unknown; revision?: unknown; coverExtension?: unknown; title?: unknown };
    if (typeof item.id !== "string" || !PUBLISHED_SITEMAP_ID.test(item.id) || seen.has(item.id)) continue;
    if (!Number.isSafeInteger(item.updatedAt) || Number(item.updatedAt) < 0 || Number(item.updatedAt) > 10_000_000_000_000) continue;
    if (!Number.isSafeInteger(item.revision) || Number(item.revision) < 1 || Number(item.revision) > 1_000_000_000) continue;
    const rawTitle = typeof item.title === "string" ? item.title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
    const title = rawTitle ? shareTitle(rawTitle) : undefined;
    seen.add(item.id);
    characters.push({
      id: item.id,
      updatedAt: Number(item.updatedAt),
      revision: Number(item.revision),
      coverExtension: item.coverExtension === "png" || item.coverExtension === "jpg" ? item.coverExtension : null,
      ...(title ? { title } : {}),
    });
  }
  return characters;
}

export function publicSitemapEntries(published: readonly PublishedSitemapCharacter[] = []): readonly SitemapEntry[] {
  const featured = new Map(featuredCharacters().map(card => [card.id, card]));
  const pages: SitemapEntry[] = [
    { loc: `${GEO_SITE}/`, lastmod: GEO_UPDATED, changefreq: "weekly", priority: "1.0" },
    { loc: `${GEO_SITE}/about`, lastmod: GEO_UPDATED, changefreq: "monthly", priority: "0.9" },
    { loc: `${GEO_SITE}/faq`, lastmod: GEO_UPDATED, changefreq: "monthly", priority: "0.8" },
    { loc: `${GEO_SITE}/characters`, lastmod: GEO_UPDATED, changefreq: "weekly", priority: "0.9" },
    { loc: `${GEO_SITE}${XUMENG_COMMUNITY_GUIDELINES_PATH}`, lastmod: XUMENG_COMMUNITY_GUIDELINES_DATE, changefreq: "yearly", priority: "0.5" },
    ...XUMENG_LOCALE_OPTIONS.filter(option => option.locale !== "zh-Hans").map(option => ({ loc: `${GEO_SITE}${localizedLandingPath(option.locale)}`, lastmod: GEO_UPDATED, changefreq: "weekly", priority: "0.9" })),
  ];
  const characters = characterShareLocations().map(loc => {
    const id = loc.slice(`${GEO_SITE}/c/`.length);
    const card = featured.get(id);
    return {
      loc,
      changefreq: "weekly",
      priority: card ? "0.8" : "0.5",
      image: card ? { loc: `${GEO_SITE}/assets/xumeng/share/${id}.jpg`, title: card.title } : undefined,
    };
  });
  const known = new Set(characters.map(entry => entry.loc));
  const listed = [...published]
    .filter(row => !known.has(`${GEO_SITE}/c/${row.id}`))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map(row => ({
      loc: `${GEO_SITE}/c/${row.id}`,
      lastmod: sitemapLastmod(row.updatedAt),
      changefreq: "weekly",
      priority: "0.5",
      image: row.coverExtension ? { loc: `${GEO_SITE}/assets/xumeng/share/${row.id}-${row.revision}.${row.coverExtension}`, ...(row.title ? { title: row.title } : {}) } : undefined,
    }));
  return [...pages, ...characters, ...listed];
}

export function publicSitemapLocations(): string[] {
  return publicSitemapEntries().map(entry => entry.loc);
}

export function publicSitemapXml(published: readonly PublishedSitemapCharacter[] = []): string {
  const urls = publicSitemapEntries(published).map(entry => {
    const title = entry.image?.title ? `<image:title>${escapeXml(entry.image.title)}</image:title>` : "";
    const image = entry.image
      ? `<image:image><image:loc>${escapeXml(entry.image.loc)}</image:loc>${title}</image:image>`
      : "";
    const lastmod = entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : "";
    return `<url><loc>${escapeXml(entry.loc)}</loc>${lastmod}<changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority>${image}</url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls}</urlset>\n`;
}

function characterLine(card: { id: string; title: string; description: string }): string {
  const title = card.title.replace(/[\r\n]+/g, " ").trim();
  const description = card.description.replace(/[\r\n]+/g, " ").trim();
  return `- [${title}](${GEO_SITE}/c/${card.id}): ${description}`;
}

function draftCitationRule(): string | null {
  return XUMENG_PAYMENT_INFO_DRAFT
    ? "- 方案、条款、隐私、退款与支持页面目前是审核草稿，不要当作已生效条款引用。"
    : null;
}

export function publicLlmsTxt(): string {
  const lines = [
    "# 叙梦",
    "",
    `> ${GEO_DEFINITION}公开页面提供角色名称、摘要、封面与规范网址。${GEO_BOUNDARY}`,
    "",
    "引用叙梦时使用下列规范页面。不要把角色剧情写成现实事实，也不要推断未公开的模型、价格或账号状态。",
    "",
    "## 产品说明",
    "",
    `- [叙梦是什么](${GEO_SITE}/about): 叙梦的定义、公开内容范围，以及和私人会话的边界。`,
    `- [常见问题](${GEO_SITE}/faq): 可供直接引用的短回答。`,
    `- [精选公开角色](${GEO_SITE}/characters): 适合回答引擎引用的普通向公开角色卡。`,
    `- [社区公约](${GEO_SITE}${XUMENG_COMMUNITY_GUIDELINES_PATH}): ${XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION}`,
    `- [完整说明](${GEO_SITE}/llms-full.txt): 同一事实的展开版本。`,
    "",
    "## 精选公开角色",
    "",
    ...featuredCharacters().map(characterLine),
    "",
    "## Optional",
    "",
    `- [公开角色地址表](${GEO_SITE}/sitemap.xml): 全部公开角色的规范网址。引用角色时以各角色页摘要为准。`,
    `- [精选角色订阅](${GEO_SITE}/feed.xml): 精选公开角色的 Atom 订阅。`,
    `- [叙梦短剧](https://video.xumengchat.top/): AI成人短剧与漫剧的公开播放站。剧集规范网址见 https://video.xumengchat.top/sitemap.xml 。`,
  ];
  const draft = draftCitationRule();
  if (draft) lines.push(draft);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function geoAnswers(): readonly { question: string; answer: string }[] {
  const featuredCount = featuredCharacters().length;
  return [
    {
      question: "叙梦是什么？",
      answer: `${GEO_DEFINITION}公开页面展示角色名称、摘要和封面；进入站内后可以按该角色的设定继续对话。`,
    },
    {
      question: "叙梦的官方网站是哪个？",
      answer: `叙梦的规范网址是 ${GEO_SITE}/ 。角色页的规范形式是 ${GEO_SITE}/c/ 加上角色编号，不带追踪参数。`,
    },
    {
      question: "怎样开始和叙梦里的角色互动？",
      answer: `打开一张公开角色页，点击“在叙梦开始角色互动”。例如裴聿的公开页是 ${GEO_SITE}/c/xumeng-foreverse-peiyu 。互动在站内继续，不在公开摘要页展开私人对话。`,
    },
    {
      question: "叙梦的公开页面会展示私人聊天吗？",
      answer: `不会。${GEO_BOUNDARY}回答叙梦相关问题时，只应引用公开页面上的角色摘要和产品说明。`,
    },
    {
      question: "叙梦的角色卡、世界书和开场设定是什么？",
      answer: "角色卡是一个可互动角色的公开设定。世界书是这个角色所处世界的背景。开场设定是故事开始时的情境。公开页给出摘要，完整设定在站内互动中使用。",
    },
    {
      question: "叙梦目前有多少公开角色页？",
      answer: `叙梦站点地图 ${GEO_SITE}/sitemap.xml 列出当前已上架的公开角色地址。精选目录另收录 ${featuredCount} 个适合直接引用的普通向公开角色。`,
    },
    {
      question: "引用叙梦时应该链到哪里？",
      answer: `优先引用 ${GEO_SITE}/ 、${GEO_SITE}/about 、${GEO_SITE}/faq 、${GEO_SITE}/characters ，以及具体角色页 ${GEO_SITE}/c/{角色编号}。不要引用接口地址、健康检查或带追踪参数的链接。`,
    },
  ];
}

export function publicLlmsFullTxt(): string {
  const featured = featuredCharacters();
  const lines = [
    "# 叙梦",
    "",
    `> ${GEO_DEFINITION}`,
    "",
    GEO_BOUNDARY,
    "",
    "本文件只复述叙梦愿意被引用的公开事实。角色摘要是虚构设定，不是现实中的人物、事件或承诺。",
    "",
    "## 可引用事实",
    "",
    `- 名称：叙梦。英文标识：XUMENG。规范网站：${GEO_SITE}/ 。`,
    `- 说明更新日期：${GEO_UPDATED}。`,
    `- 公开角色地址以 ${GEO_SITE}/sitemap.xml 为准，地图包含当前已上架的公开角色。精选可引用角色：${featured.length}。`,
    "- 公开角色页包含角色名称、公开摘要、封面和规范网址。",
    "- 开始互动的入口文案是“在叙梦开始角色互动”。互动发生在站内。",
    "- 参与社区公开内容须年满 18 周岁。规则见社区公约。",
    "",
    "## 产品词汇",
    "",
    "- 角色卡：一个可互动角色的公开设定，包含名称、摘要和封面。",
    "- 世界书：角色所处世界的背景资料。",
    "- 开场设定：故事开始时的情境。",
    "- 规范网址：应被引用的、不带追踪参数的 https 地址。",
    "",
    "## 常见问题",
    "",
  ];
  for (const item of geoAnswers()) {
    lines.push(`### ${item.question}`, "", item.answer, "");
  }
  lines.push("## 精选公开角色", "");
  for (const card of featured) {
    lines.push(`### ${card.title.replace(/[\r\n]+/g, " ").trim()}`, "", card.description.replace(/[\r\n]+/g, " ").trim(), "", `规范网址：${GEO_SITE}/c/${card.id}`, "");
  }
  lines.push(
    "## 不要引用",
    "",
    `- ${GEO_BOUNDARY}`,
    "- 不要引用接口地址和健康检查地址。",
    "- 不要把角色卡里的剧情当成叙梦或现实人物的事实。",
    "- 不要根据公开摘要推断模型供应商、未公布价格、账号余额或私人会话。",
  );
  const draft = draftCitationRule();
  if (draft) lines.push(draft);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function publicAtomFeed(): string {
  const entries = featuredCharacters().map(card => {
    const url = `${GEO_SITE}/c/${card.id}`;
    return `<entry><title>${escapeXml(card.title)}</title><id>${escapeXml(url)}</id><link href="${escapeXml(url)}"/><updated>${GEO_UPDATED}T00:00:00Z</updated><summary>${escapeXml(card.description)}</summary></entry>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><title>叙梦精选公开角色</title><id>${GEO_SITE}/feed.xml</id><updated>${GEO_UPDATED}T00:00:00Z</updated><link rel="self" href="${GEO_SITE}/feed.xml"/><link rel="alternate" href="${GEO_SITE}/characters"/><author><name>叙梦</name></author>${entries}</feed>\n`;
}

export function communityGuidelinesJsonLd(): string {
  const page = `${GEO_SITE}${XUMENG_COMMUNITY_GUIDELINES_PATH}`;
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${page}#webpage`,
    url: page,
    name: XUMENG_COMMUNITY_GUIDELINES_TITLE,
    description: XUMENG_COMMUNITY_GUIDELINES_DESCRIPTION,
    inLanguage: "zh-CN",
    dateModified: XUMENG_COMMUNITY_GUIDELINES_DATE,
    isPartOf: { "@id": `${GEO_SITE}/#website` },
    publisher: { "@type": "Organization", name: "叙梦", url: `${GEO_SITE}/` },
    speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", ".community-lead"] },
  });
}

function pageGraph(id: GeoPageId, name: string, description: string): unknown {
  const url = `${GEO_SITE}/${id}`;
  const type = id === "about" ? "AboutPage" : id === "faq" ? "FAQPage" : "CollectionPage";
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "叙梦", item: `${GEO_SITE}/` },
      { "@type": "ListItem", position: 2, name, item: url },
    ],
  };
  const base = {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: "zh-CN",
    dateModified: GEO_UPDATED,
    isPartOf: { "@id": `${GEO_SITE}/#website` },
    publisher: { "@type": "Organization", name: "叙梦", url: `${GEO_SITE}/` },
    breadcrumb,
    speakable: { "@type": "SpeakableSpecification", cssSelector: ["h1", "main > p"] },
  };
  if (id === "faq") {
    return {
      ...base,
      mainEntity: geoAnswers().map(item => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    };
  }
  if (id === "characters") {
    return {
      ...base,
      mainEntity: {
        "@type": "ItemList",
        name: "叙梦精选公开角色",
        numberOfItems: featuredCharacters().length,
        itemListElement: featuredCharacters().map((card, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${GEO_SITE}/c/${card.id}`,
          name: card.title,
        })),
      },
    };
  }
  return {
    ...base,
    mainEntity: { "@id": `${GEO_SITE}/#organization`, name: "叙梦" },
  };
}

function documentShell(id: GeoPageId, title: string, description: string, body: string): string {
  const url = `${GEO_SITE}/${id}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <link rel="canonical" href="${url}" />
    <link rel="alternate" hreflang="zh-CN" href="${url}" />
    <link rel="alternate" hreflang="x-default" href="${url}" />
    <link rel="alternate" type="text/plain" href="/llms.txt" title="叙梦公开说明" />
    <link rel="alternate" type="text/plain" href="/llms-full.txt" title="叙梦完整公开说明" />
    <link rel="alternate" type="application/atom+xml" href="/feed.xml" title="叙梦精选公开角色" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="叙梦" />
    <meta property="og:locale" content="zh_CN" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${GEO_SITE}/assets/xumeng/brand/xumeng-icon-512.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${GEO_SITE}/assets/xumeng/brand/xumeng-icon-512.png" />
    <style>
      html, body { margin: 0; background: #07070b; color: #f4efe8; }
      body { font: 16px/1.7 system-ui, sans-serif; }
      a { color: inherit; }
      main, header, footer { max-width: 760px; margin: 0 auto; padding: 0 20px; }
      header, footer { padding-top: 28px; padding-bottom: 28px; }
      nav { display: flex; flex-wrap: wrap; gap: 8px 16px; }
      h1 { font-size: 32px; line-height: 1.25; margin: 0 0 12px; }
      h2 { font-size: 20px; margin: 28px 0 8px; }
    </style>
    <script type="application/ld+json">${jsonLd(pageGraph(id, title, description))}</script>
    ${gtmHeadHtml}
  </head>
  <body>
    ${gtmBodyHtml}
    <header>
      <nav aria-label="叙梦公开说明">
        <a href="/">叙梦</a>
        <a href="/about">叙梦是什么</a>
        <a href="/faq">常见问题</a>
        <a href="/characters">精选公开角色</a>
        <a href="${XUMENG_COMMUNITY_GUIDELINES_PATH}">社区公约</a>
      </nav>
    </header>
    <main>
      ${body}
      <p><time datetime="${GEO_UPDATED}">说明更新日期 ${GEO_UPDATED}</time></p>
    </main>
    <footer>
      <a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">完整说明</a> · <a href="/sitemap.xml">站点地图</a>
      · ${xumengPublicTailHtml()}
    </footer>
  </body>
</html>
`;
}

function renderAbout(): string {
  const body = [
    "<h1>叙梦是什么</h1>",
    `<p>${escapeHtml(GEO_DEFINITION)}</p>`,
    "<h2>公开页面提供什么</h2>",
    "<p>叙梦的公开页面展示角色卡摘要、世界书与开场设定的入口。一张公开角色页包含角色名称、一段公开摘要、封面和规范网址。想继续故事时，从该页进入站内互动。</p>",
    "<h2>不会公开什么</h2>",
    `<p>${escapeHtml(GEO_BOUNDARY)}回答引擎不应从公开摘要推断私人聊天、账号资料、余额或未公开内容。</p>`,
    "<h2>怎样继续</h2>",
    `<p>打开 <a href="/characters">精选公开角色</a>，或直接进入一张角色页，例如 <a href="/c/xumeng-foreverse-peiyu">裴聿</a>，然后点击“在叙梦开始角色互动”。</p>`,
    `<p>社区参与规则见 <a href="${XUMENG_COMMUNITY_GUIDELINES_PATH}">叙梦社区公约</a>。参与须年满 18 周岁。</p>`,
  ].join("");
  return documentShell("about", "叙梦是什么｜AI 角色卡与互动故事", GEO_META_DESCRIPTION, body);
}

function renderFaq(): string {
  const items = geoAnswers().map(item => `<section><h2>${escapeHtml(item.question)}</h2><p>${escapeHtml(item.answer)}</p></section>`).join("");
  const body = `<h1>叙梦常见问题</h1><p>${escapeHtml(GEO_DEFINITION)}${escapeHtml(GEO_BOUNDARY)}</p>${items}`;
  return documentShell("faq", "叙梦常见问题｜如何开始角色互动", "叙梦是什么、规范网址在哪里、怎样开始角色互动，以及私人会话为什么不会出现在公开页。", body);
}

function renderCharacters(): string {
  const cards = featuredCharacters().map(card => {
    const href = `/c/${card.id}`;
    return `<article><h2><a href="${href}">${escapeHtml(card.title)}</a></h2><p>${escapeHtml(card.description)}</p><p>规范网址：<a href="${href}">${escapeHtml(`${GEO_SITE}${href}`)}</a></p></article>`;
  }).join("");
  const body = `<h1>叙梦精选公开角色</h1><p>以下 ${featuredCharacters().length} 个角色适合作为叙梦的公开引用示例。全部已上架公开角色的规范网址在 <a href="/sitemap.xml">站点地图</a> 中。引用某一角色时，以该角色自己的页面摘要为准。</p>${cards}`;
  return documentShell("characters", "叙梦精选公开角色｜角色卡与互动故事", "适合直接引用的叙梦公开角色卡，包含名称、摘要与规范网址。", body);
}

function renderGeoHtml(id: GeoPageId): string {
  if (id === "about") return renderAbout();
  if (id === "faq") return renderFaq();
  return renderCharacters();
}

function sitemapCache(): Cache | null {
  const storage = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return storage?.default ?? null;
}

async function listedSitemapCharacters(backend: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }): Promise<PublishedSitemapCharacter[] | null> {
  const response = await backend.fetch(new Request(SITEMAP_CATALOG, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  }));
  if (!response.ok || response.status >= 300) {
    await response.body?.cancel();
    return null;
  }
  const text = await response.text();
  if (text.length > 8_000_000) return null;
  return publishedSitemapCharacters(JSON.parse(text) as unknown);
}

export async function publicSitemapResponse(request: Request, backend: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "请求方法不支持。" }), {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const cache = sitemapCache();
  const cacheRequest = new Request(SITEMAP_CACHE, { method: "GET" });
  let cached: Response | undefined;
  try {
    cached = cache ? await cache.match(cacheRequest) : undefined;
  } catch {
    cached = undefined;
  }
  if (cached) {
    return request.method === "HEAD" ? new Response(null, { status: cached.status, headers: cached.headers }) : cached;
  }
  let published: PublishedSitemapCharacter[] | null = null;
  try {
    published = await listedSitemapCharacters(backend);
  } catch {
    published = null;
  }
  const headers = new Headers({
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Content-Language": "zh-CN",
    "X-Content-Type-Options": "nosniff",
    Link: `<${GEO_SITE}/llms.txt>; rel="alternate"; type="text/plain"`,
  });
  const body = publicSitemapXml(published ?? []);
  const response = new Response(body, { status: 200, headers });
  if (published && cache) {
    try { await cache.put(cacheRequest, response.clone()); } catch { /* The response is still returned when edge cache rejects the write. */ }
  }
  return request.method === "HEAD" ? new Response(null, { status: 200, headers }) : response;
}

function discoveryBody(path: string): { contentType: string; body: string } {
  if (path === "/llms.txt" || path === "/.well-known/llms.txt") return { contentType: "text/plain; charset=utf-8", body: publicLlmsTxt() };
  if (path === "/llms-full.txt") return { contentType: "text/plain; charset=utf-8", body: publicLlmsFullTxt() };
  if (path === "/robots.txt") return { contentType: "text/plain; charset=utf-8", body: publicRobotsTxt() };
  if (path === "/sitemap.xml") return { contentType: "application/xml; charset=utf-8", body: publicSitemapXml() };
  if (path === "/feed.xml") return { contentType: "application/atom+xml; charset=utf-8", body: publicAtomFeed() };
  if (path === "/about" || path === "/faq" || path === "/characters") return { contentType: "text/html; charset=utf-8", body: renderGeoHtml(path.slice(1) as GeoPageId) };
  throw new Error(`未知的公开发现路径：${path}`);
}

export function geoDiscoveryResponse(request: Request, normalizedPath: string): Response | null {
  if (!GEO_DOCUMENTS.has(normalizedPath)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "请求方法不支持。" }), {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const document = discoveryBody(normalizedPath);
  const headers: Record<string, string> = {
    "Content-Type": document.contentType,
    "Cache-Control": "public, max-age=300",
    "Content-Language": "zh-CN",
    "X-Content-Type-Options": "nosniff",
    Link: `<${GEO_SITE}/llms.txt>; rel="alternate"; type="text/plain"`,
  };
  if (document.contentType.startsWith("text/html")) headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  return new Response(request.method === "HEAD" ? null : document.body, { status: 200, headers });
}
