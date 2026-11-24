#!/usr/bin/env node
/**
 * Build script for the CCRent dark-theme site.
 *
 * Reads the captured source HTML in ./source, strips the Astro runtime /
 * analytics / hydrated islands, rewrites copy + prices (tools/content.mjs),
 * localises assets, injects SEO metadata / structured data, and writes the
 * deployable site to ./dist.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SITE, REPLACEMENTS, PAGES, OG, EXTRA_FAQS, LLMS_TXT, KEYWORDS } from './content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = SITE.origin;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ links -- */
const LINKS = {
  '/': './',
  '/pricing/': 'pricing',
  '/#faq': '#faq',
  '/account/': '#',
  '/terms/': 'terms',
  '/refund/': 'refund',
  '/privacy/': 'privacy',
  '/help/': 'help',
  '/en/': 'https://ccrent.org/en/',
  '/en/pricing/': 'https://ccrent.org/en/pricing/',
};

/* --------------------------------------------------------------- helpers -- */
function stripScripts(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

function unwrapAstroIslands(html) {
  return html
    .replace(/<astro-island\b[\s\S]*?>/gi, '')
    .replace(/<\/astro-island>/gi, '')
    .replace(/<!--\s*astro:end\s*-->/gi, '')
    .replace(/<!--\s*astro:start\s*-->/gi, '');
}

function localiseAssets(html) {
  const map = [
    ['/_astro/Layout.DSeitLR6.css', 'assets/css/base.css'],
    ['/favicon-96x96.png', 'assets/img/favicon-96x96.png'],
    ['/favicon.svg', 'assets/img/favicon.svg'],
    ['/logo-mark.svg', 'assets/img/logo-mark.svg'],
    ['/favicon.ico', 'assets/img/favicon.ico'],
    ['/apple-touch-icon.png', 'assets/img/apple-touch-icon.png'],
    ['/map-dots.svg', 'assets/img/map-dots.svg'],
  ];
  for (const [from, to] of map) html = html.split(from).join(to);
  return html;
}

function rewriteContacts(html) {
  return html
    .split('dkk1152').join(SITE.contact.wechat)
    .split('CC_Rent').join(SITE.contact.telegram);
}

function rewriteLinks(html) {
  return html.replace(/href="(\/[^"]*)"/g, (whole, href) => {
    if (href.startsWith('/_astro/') || href.startsWith('/favicon') ||
        href.startsWith('/apple-touch') || href.startsWith('/site.webmanifest') ||
        href.startsWith('/sitemap')) return whole;
    if (href in LINKS) return `href="${LINKS[href]}"`;
    return whole;
  });
}

/** Apply central copy / price / region replacements (tools/content.mjs). */
function rewriteContent(html) {
  // The captured HTML uses non-breaking spaces (U+00A0) inside product names
  // like "Claude Max"; normalise them so copy replacements match reliably.
  html = html.replace(/\u00a0/g, ' ');
  for (const [from, to] of REPLACEMENTS) html = html.split(from).join(to);
  return html;
}

/** The original map has seven country markers — keep only the United States. */
function simplifyMap(html) {
  html = html.replace(
    /<span class="absolute size-2[^>]*?style="left:(?!75%)[^"]*"[^>]*?><\/span>/g,
    ''
  );
  html = html.replace(/<li data-label[\s\S]*?<\/li>/g, (m) =>
    m.includes('--x:58%;--y:18%') ? m : ''
  );
  return html;
}

/* -------------------------------------------------- hero mockup dark map -- */
const HERO_THEME = [
  ['bg-[linear-gradient(160deg,#eef0f3_0%,#d9dce2_50%,#c3c7cf_100%)]', 'mc-wallpaper'],
  ['bg-[radial-gradient(60%_50%_at_15%_15%,rgba(255,255,255,0.75)_0%,transparent_60%),radial-gradient(70%_60%_at_85%_90%,rgba(150,156,168,0.35)_0%,transparent_65%)]', 'mc-wallpaper-glow'],
  ['bg-white/45 px-[1.4em] text-[#1d1d1f]', 'mc-menubar px-[1.4em]'],
  ['text-[#1d1d1f]/85', 'mc-menubar-label'],
  ['bg-[#faf9f5] text-[#3d3929]', 'mc-claude-win'],
  ['border-r border-[#e8e6dc] bg-[#f5f4ed]', 'mc-claude-sidebar'],
  ['bg-[#e8e6dc] text-[#29261b]', 'mc-claude-active'],
  ['text-[#6b6757]', 'mc-claude-muted'],
  ['text-[#8a8676]', 'mc-claude-icon'],
  ['bg-[#f0eee6]', 'mc-claude-bubble'],
  ['text-[#29261b]', 'mc-claude-code'],
  ['border-[#e0ddd2] bg-white', 'mc-claude-input'],
  ['text-[#a29f93]', 'mc-claude-placeholder'],
  ['text-[#3d3929]', 'mc-claude-text'],
  ['bg-[#3d3929]', 'mc-avatar'],
  ['bg-[#1e1e1e]', 'mc-term'],
  ['bg-[#2a2a2a]', 'mc-term-bar'],
];
const ILLUSTRATION_THEME = [
  ['text-[#b45309]', 'mc-warn'],
  ['text-[#a3a3a3]', 'mc-illus-muted'],
];

function rethemeMockups(html) {
  const heroStart = html.indexOf('<main>');
  const heroEnd = html.indexOf('<section', html.indexOf('</section>', heroStart));
  const heroLen = heroEnd === -1 ? html.length : heroEnd;
  const hero = html.slice(heroStart, heroLen);
  let themed = hero;
  for (const [from, to] of HERO_THEME) themed = themed.split(from).join(to);
  for (const [from, to] of ILLUSTRATION_THEME) themed = themed.split(from).join(to);
  return html.slice(0, heroStart) + themed + html.slice(heroLen);
}

/* ------------------------------------------------------------- fragments -- */
function dialogs() {
  return `
<!-- ===================== 复刻站交互弹层（静态实现） ===================== -->
<div class="cr-dialog-backdrop" data-dialog="contact" hidden>
  <div class="cr-dialog" role="dialog" aria-modal="true" aria-labelledby="cr-contact-title">
    <button class="cr-dialog-close" type="button" data-dialog-close aria-label="关闭">&times;</button>
    <img class="cr-dialog-logo" src="assets/img/logo-mark.svg" width="36" height="36" alt="">
    <p class="cr-dialog-kicker"><span class="cr-dot"></span>24 小时内回复</p>
    <h2 id="cr-contact-title">联系我们预订</h2>
    <p class="cr-dialog-lead">告诉我们想要的套餐，24 小时内回复。</p>
    <div class="cr-contact-row">
      <span class="cr-contact-icon" aria-hidden="true">
        <svg viewBox="0 0 256 256" width="18" height="18" fill="currentColor"><path d="M128,24A104,104,0,0,0,36,164c0,18.9,5.4,36.6,14.8,51.6L44,240l26.1-6.6A103.7,103.7,0,0,0,128,232a104,104,0,0,0,0-208Zm-40,120a12,12,0,1,1,12-12A12,12,0,0,1,88,144Zm40,0a12,12,0,1,1,12-12A12,12,0,0,1,128,144Zm40,0a12,12,0,1,1,12-12A12,12,0,0,1,168,144Z"/></svg>
      </span>
      <span class="cr-contact-label">微信</span>
      <span class="cr-contact-value" data-copy-value="${SITE.contact.wechat}">${SITE.contact.wechat}</span>
      <button type="button" class="cr-copy" data-copy="${SITE.contact.wechat}" data-copied-label="已复制">复制</button>
    </div>
    <div class="cr-contact-row">
      <span class="cr-contact-icon" aria-hidden="true">
        <svg viewBox="0 0 256 256" width="18" height="18" fill="currentColor"><path d="M235.4,99.9,154.2,26.6A16,16,0,0,0,128,38.5V70.2C63.1,72.8,24,117.1,24,176a15.9,15.9,0,0,0,28.8,9.6c18.2-27.3,43.1-42.9,75.2-46.3v31.6A16,16,0,0,0,154.2,193l81.2-73.3a16,16,0,0,0,0-23.8Z"/></svg>
      </span>
      <span class="cr-contact-label">Telegram</span>
      <span class="cr-contact-value">@${SITE.contact.telegram}</span>
      <a href="https://t.me/${SITE.contact.telegram}" target="_blank" rel="noopener" class="cr-copy">打开对话</a>
    </div>
    <p class="cr-dialog-note">也可以直接通过页面底部的联系方式找我们。</p>
  </div>
</div>

<div class="cr-dialog-backdrop" data-dialog="booking" hidden>
  <div class="cr-dialog cr-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="cr-booking-title">
    <button class="cr-dialog-close" type="button" data-dialog-close aria-label="关闭">&times;</button>
    <img class="cr-dialog-logo" src="assets/img/logo-mark.svg" width="36" height="36" alt="">
    <p class="cr-dialog-kicker"><span class="cr-dot"></span>现货供应中 · 48 小时内交付</p>
    <h2 id="cr-booking-title">预订你的美国专属 Mac</h2>
    <p class="cr-dialog-lead">选好套餐，付款后 48 小时内交付。这里先帮你把信息整理好。</p>
    <div class="cr-form">
      <label class="cr-field">
        <span>地区</span>
        <select data-booking-region>
          <option>${SITE.region}</option>
        </select>
      </label>
      <label class="cr-field">
        <span>套餐</span>
        <select data-booking-plan>
          <option value="mac">仅 Mac 租赁 · $${SITE.prices.mac}/月</option>
          <option value="max">Claude Max · $${SITE.prices.max}/月</option>
          <option value="ultra">Claude Ultra · $${SITE.prices.ultra}/月</option>
          <option value="team">多台 / 团队 · 面议</option>
        </select>
      </label>
    </div>
    <div class="cr-booking-summary" data-booking-summary>仅 Mac 租赁 · $${SITE.prices.mac}/月 · ${SITE.region}</div>
    <div class="cr-dialog-actions">
      <a class="cr-btn cr-btn-primary" data-booking-send href="https://t.me/${SITE.contact.telegram}" target="_blank" rel="noopener">联系客服预订</a>
      <button class="cr-btn cr-btn-ghost" type="button" data-dialog-close>稍后再说</button>
    </div>
    <p class="cr-dialog-note">复刻演示站：按钮会跳转到 CCRent 官方 Telegram，仅用于展示交互。</p>
  </div>
</div>

<div class="cr-dialog-backdrop" data-dialog="stock" hidden>
  <div class="cr-dialog" role="dialog" aria-modal="true" aria-labelledby="cr-stock-title">
    <button class="cr-dialog-close" type="button" data-dialog-close aria-label="关闭">&times;</button>
    <img class="cr-dialog-logo" src="assets/img/logo-mark.svg" width="36" height="36" alt="">
    <p class="cr-dialog-kicker"><span class="cr-dot"></span>现货在库</p>
    <h2 id="cr-stock-title">现在预订，预计 48 小时内交付</h2>
    <p class="cr-dialog-lead">这批 Mac mini 已经到货上架。付款后我们马上配置好你的 Mac，把远程连接信息发给你。</p>
    <ol class="cr-steps">
      <li><span>01</span><div><strong>预订并付款</strong><em>现在</em></div></li>
      <li><span>02</span><div><strong>配置 Mac</strong><em>随即开始</em></div></li>
      <li><span>03</span><div><strong>交付连接信息</strong><em>48 小时内</em></div></li>
    </ol>
    <div class="cr-dialog-actions">
      <button class="cr-btn cr-btn-primary" type="button" data-open-booking>现在预订</button>
      <button class="cr-btn cr-btn-ghost" type="button" data-open-contact>先问问客服</button>
    </div>
    <p class="cr-dialog-note">时间从确认收款开始算，节假日或高峰期可能稍晚，以客服通知为准。</p>
  </div>
</div>

<div class="cr-dialog-backdrop" data-dialog="login" hidden>
  <div class="cr-dialog" role="dialog" aria-modal="true" aria-labelledby="cr-login-title">
    <button class="cr-dialog-close" type="button" data-dialog-close aria-label="关闭">&times;</button>
    <img class="cr-dialog-logo" src="assets/img/logo-mark.svg" width="36" height="36" alt="">
    <p class="cr-dialog-kicker"><span class="cr-dot"></span>账户</p>
    <h2 id="cr-login-title">登录 CCRent</h2>
    <p class="cr-dialog-lead">原站通过邮箱验证码登录，管理你的 Mac 与订阅。复刻演示站没有接入后端，这里只还原界面。</p>
    <div class="cr-form">
      <label class="cr-field"><span>邮箱</span><input type="email" placeholder="you@example.com" disabled></label>
    </div>
    <div class="cr-dialog-actions">
      <button class="cr-btn cr-btn-primary" type="button" disabled>发送登录链接</button>
      <button class="cr-btn cr-btn-ghost" type="button" data-dialog-close>关闭</button>
    </div>
    <p class="cr-dialog-note">演示站不收集任何信息。</p>
  </div>
</div>

<div class="cr-toast" data-toast hidden></div>
`;
}

/* ------------------------------------------------------------ SEO blocks -- */
function stripTags(s) {
  return s
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFaqs(body) {
  const faqs = [];
  const re = /<details[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = re.exec(body))) {
    const q = stripTags((m[1].match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || m[1]);
    const a = stripTags((m[2].match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || m[2]);
    if (q && a) faqs.push({ q, a });
  }
  return faqs;
}

function jsonLd({ page, faqs }) {
  const abs = (p) => `${ORIGIN}${p}`;
  const orgId = `${ORIGIN}/#organization`;
  const siteId = `${ORIGIN}/#website`;
  const graph = [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: SITE.name,
      url: `${ORIGIN}/`,
      logo: {
        '@type': 'ImageObject',
        url: abs('/assets/img/web-app-manifest-512x512.png'),
        width: 512,
        height: 512,
      },
      sameAs: [`https://t.me/${SITE.contact.telegram}`],
    },
    {
      '@type': 'WebSite',
      '@id': siteId,
      name: SITE.name,
      url: `${ORIGIN}/`,
      inLanguage: 'zh-CN',
      publisher: { '@id': orgId },
    },
    {
      '@type': 'WebPage',
      '@id': `${abs(page.path)}#webpage`,
      url: abs(page.path),
      name: page.title,
      description: page.description,
      inLanguage: 'zh-CN',
      keywords: (KEYWORDS[page.path] || KEYWORDS['/']).join(', '),
      isPartOf: { '@id': siteId },
    },
  ];

  if (page.path === '/' || page.path === '/pricing') {
    graph.push({
      '@type': 'Service',
      '@id': `${ORIGIN}/#service`,
      name: '美国 Mac mini 租用',
      serviceType: 'Mac mini 租赁',
      description:
        '专属美国 Mac mini M4，接入美国住宅 IP，预装 Claude Code；Claude Max / Ultra 账号由我们提供，远程连上即可使用。',
      provider: { '@id': orgId },
      areaServed: { '@type': 'Country', name: '美国', sameAs: 'https://www.wikidata.org/wiki/Q30' },
      offers: [
        {
          '@type': 'Offer',
          name: '仅 Mac 租赁',
          price: SITE.prices.mac,
          priceCurrency: SITE.currency,
          availability: 'https://schema.org/InStock',
          url: abs('/pricing'),
          description: '专属美国 Mac mini M4 + 美国住宅 IP，账号自备，月租。',
        },
        {
          '@type': 'Offer',
          name: 'Claude Max',
          price: SITE.prices.max,
          priceCurrency: SITE.currency,
          availability: 'https://schema.org/InStock',
          url: abs('/pricing'),
          description: 'Mac mini M4 + 美国住宅 IP + Claude Max 账号，月租。',
        },
        {
          '@type': 'Offer',
          name: 'Claude Ultra',
          price: SITE.prices.ultra,
          priceCurrency: SITE.currency,
          availability: 'https://schema.org/InStock',
          url: abs('/pricing'),
          description: 'Mac mini M4 + 美国住宅 IP + Claude Ultra 账号，月租。',
        },
      ],
    });
  }

  if (page.breadcrumb) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${abs(page.path)}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首页', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: page.breadcrumb, item: abs(page.path) },
      ],
    });
  }

  if (page.hasFaq && faqs.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${abs(page.path)}#faq`,
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

function headTags(page) {
  const canonical = `${ORIGIN}${page.path}`;
  const ogImage = `${ORIGIN}${OG.image}`;
  return `<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<meta name="keywords" content="${esc((KEYWORDS[page.path] || KEYWORDS['/']).join(','))}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="zh-CN" href="${canonical}">
<link rel="alternate" hreflang="x-default" href="${canonical}">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="${OG.width}">
<meta property="og:image:height" content="${OG.height}">
<meta property="og:image:alt" content="${esc(OG.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${ogImage}">`;
}

const HEAD_ASSETS = `<link rel="icon" type="image/png" href="/assets/img/favicon-96x96.png" sizes="96x96">
<link rel="icon" type="image/svg+xml" href="/assets/img/favicon.svg">
<link rel="shortcut icon" href="/assets/img/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/img/apple-touch-icon.png">
<meta name="theme-color" content="#08090b">
<link rel="preload" href="/assets/fonts/inter-latin-wght-normal.Dx4kXJAl.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/base.css">
<link rel="stylesheet" href="/assets/css/theme-dark.css">`;

/* ------------------------------------------------------- extra long-tail FAQ */
const FAQ_CHEVRON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 256 256" class="size-4 shrink-0 text-ink transition-transform group-open:rotate-180" aria-hidden="true"><path d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z"></path></svg>';

function faqHtml(items) {
  return items
    .map(
      (f) => `<details class="glass group rounded-xl [&amp;_summary::-webkit-details-marker]:hidden">
<summary class="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-[16px] font-medium text-ink">${FAQ_CHEVRON}<h3>${f.q}</h3></summary>
<p class="px-5 pb-5 pl-12 text-[15px] leading-relaxed text-muted-foreground">${f.a}</p>
</details>`
    )
    .join('\n');
}

function injectFaqs(body, pagePath) {
  const items = pagePath === '/' ? EXTRA_FAQS.home : pagePath === '/pricing' ? EXTRA_FAQS.pricing : null;
  if (!items?.length) return body;
  let anchor = -1;
  if (pagePath === '/') {
    anchor = body.indexOf('id="faq"');
  } else {
    const h2 = body.indexOf('价格常见问题');
    anchor = h2 >= 0 ? body.lastIndexOf('<section', h2) : -1;
  }
  if (anchor < 0) return body;
  const sectionEnd = body.indexOf('</section>', anchor);
  if (sectionEnd < 0) return body;
  const section = body.slice(anchor, sectionEnd);
  const lastDetail = section.lastIndexOf('</details>');
  if (lastDetail < 0) return body;
  const insertAt = anchor + lastDetail + '</details>'.length;
  return body.slice(0, insertAt) + '\n' + faqHtml(items) + body.slice(insertAt);
}

/* ------------------------------------------------------------ transform --- */
function extractBody(src) {
  const bodyStart = src.indexOf('<body');
  const bodyOpenEnd = src.indexOf('>', bodyStart) + 1;
  return src.slice(bodyOpenEnd, src.indexOf('</body>', bodyOpenEnd));
}

function transformBody(raw, { mockup = false, pagePath = '/' } = {}) {
  let body = extractBody(raw);
  body = stripScripts(body);
  body = unwrapAstroIslands(body);
  body = localiseAssets(body);
  if (mockup) body = rethemeMockups(body);
  body = body.replace(
    /<style>astro-island,astro-slot,astro-static-slot\{display:contents\}<\/style>/,
    ''
  );
  // copy, region + discount price updates
  body = rewriteContent(body);
  body = injectFaqs(body, pagePath);
  body = simplifyMap(body);

  body = body.replace('text-[#262626]', 'hero-title');
  // Brand lockup: redesigned mark + two-weight wordmark.
  body = body.replace(
    '<img src="assets/img/favicon.svg" alt="" aria-hidden="true" width="28" height="28" class="size-7">CCRent',
    '<img src="assets/img/logo-mark.svg" alt="" aria-hidden="true" width="28" height="28" class="size-7 cr-logo-mark">' +
      '<span class="cr-wordmark"><span class="cr-wordmark-cc">CC</span><span class="cr-wordmark-rent">Rent</span></span>'
  );
  body = body.replace(
    '<img src="assets/img/favicon.svg" alt="" aria-hidden="true" width="22" height="22" class="size-5.5">CCRent',
    '<img src="assets/img/logo-mark.svg" alt="" aria-hidden="true" width="22" height="22" class="size-5.5 cr-logo-mark">' +
      '<span class="cr-wordmark"><span class="cr-wordmark-cc">CC</span><span class="cr-wordmark-rent">Rent</span></span>'
  );
  // Login button (SSR disabled in the original) opens the static dialog.
  body = body.replace(
    /<button type="button" data-auth-open="true" class="([^"]*)" disabled="">登录<\/button>/,
    '<button type="button" data-open-login class="$1">登录</button>'
  );
  body = body.replace(
    'class="reveal-stagger grid gap-5 md:grid-cols-2 xl:grid-cols-4"',
    'class="reveal-stagger pricing-grid grid gap-5 md:grid-cols-2 xl:grid-cols-4"'
  );
  // Cloudflare email-protection anchors cannot work offline; decode them.
  body = body.replace(
    /<a href="\/cdn-cgi\/l\/email-protection" class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/a>/g,
    (m, hex) => {
      const key = parseInt(hex.slice(0, 2), 16);
      let email = '';
      for (let i = 2; i < hex.length; i += 2) {
        email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
      }
      return `<a href="mailto:${email}" class="__cf_email__">${email}</a>`;
    }
  );
  // English sub-site is out of scope: link out instead.
  body = body.replace(/href="(\/en\/[^"]*)"/g, 'href="https://ccrent.org$1"');
  body = rewriteContacts(body);
  body = rewriteLinks(body);
  body = body.replace(
    /<a ([^>]*href="https:\/\/ccrent\.org\/en[^"]*"[^>]*)>/g,
    (m, attrs) => `<a ${attrs} target="_blank" rel="noopener">`
  );
  // Accessibility/SEO: skip link target.
  body = body.replace('<main>', '<main id="main">');
  body = body.replace(
    '<body class="min-h-dvh bg-background text-foreground antialiased">',
    ''
  );
  return body;
}

function renderPage({ source, out, page, mockup = false }) {
  const raw = read(source);
  const body = transformBody(raw, { mockup, pagePath: page.path });
  const faqs = page.hasFaq ? extractFaqs(body) : [];
  const ld = jsonLd({ page, faqs });
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags(page)}
${HEAD_ASSETS}
<script type="application/ld+json">${ld}</script>
</head>
<body class="cr-body">
<a class="cr-skip" href="#main">跳到主要内容</a>
${body.trim()}
${dialogs()}
<script src="/assets/js/site.js" defer></script>
</body>
</html>`;
  write(out, html);
  console.log(out, (html.length / 1024).toFixed(1) + 'kb', '· faq:', faqs.length);
  return faqs.length;
}

/* --------------------------------------------------------------- build ---- */
const faqCounts = {};
for (const [file, page] of Object.entries(PAGES)) {
  const source = `source/${file}`;
  const out = file;
  faqCounts[file] = renderPage({
    source,
    out,
    page,
    mockup: file === 'index.html',
  });
}

/* ------------------------------------------------------------- dist out -- */
const DIST = path.join(root, 'dist');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
for (const file of Object.keys(PAGES)) {
  fs.copyFileSync(path.join(root, file), path.join(DIST, file));
}
fs.cpSync(path.join(root, 'assets'), path.join(DIST, 'assets'), { recursive: true });

const now = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.values(PAGES)
  .map(
    (p) => `  <url>
    <loc>${ORIGIN}${p.path}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changeFreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(DIST, `${SITE.indexNowKey}.txt`), SITE.indexNowKey);
fs.writeFileSync(path.join(DIST, 'llms.txt'), LLMS_TXT);
fs.writeFileSync(
  path.join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`
);
fs.writeFileSync(
  path.join(DIST, 'site.webmanifest'),
  JSON.stringify(
    {
      name: 'CCRent · 美国 Mac mini 租用',
      short_name: 'CCRent',
      description: '美国 Mac mini 租用，预装 Claude Code，美国住宅 IP，远程连上就能用。',
      start_url: '/',
      display: 'standalone',
      background_color: '#08090b',
      theme_color: '#08090b',
      lang: 'zh-CN',
      icons: [
        { src: '/assets/img/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
        {
          src: '/assets/img/web-app-manifest-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    },
    null,
    2
  )
);
fs.writeFileSync(
  path.join(DIST, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/assets/*
  Cache-Control: public, max-age=604800, stale-while-revalidate=86400
`
);
fs.writeFileSync(
  path.join(DIST, '404.html'),
  `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>页面不存在 | CCRent</title>
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/base.css"><link rel="stylesheet" href="/assets/css/theme-dark.css"></head>
<body class="cr-body" style="min-height:100dvh;display:grid;place-items:center">
<main style="text-align:center;padding:40px">
  <img src="/assets/img/logo-mark.svg" width="56" height="56" alt="CCRent" style="margin:0 auto 24px;display:block">
  <p style="font-size:64px;font-weight:600;letter-spacing:-.04em;line-height:1">404</p>
  <p style="color:var(--cr-muted);margin-top:14px">这个页面不存在，或者已经被搬走了。</p>
  <a href="/" style="display:inline-flex;align-items:center;height:44px;padding:0 24px;margin-top:26px;border-radius:999px;background:#f1f2f4;color:#0a0b0d;font-weight:500;text-decoration:none">回到首页</a>
</main></body></html>
`
);

/* ----------------------------------------------------- asset versioning -- */
// Cloudflare Pages / browser caches can keep old CSS after a deploy. Add a
// content hash to every local asset URL so each build gets fresh URLs.
const assetHash = (rel) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(DIST, rel))).digest('hex').slice(0, 8);
const versioned = [
  ['assets/css/base.css', 'assets/css/base.css'],
  ['assets/css/theme-dark.css', 'assets/css/theme-dark.css'],
  ['assets/js/site.js', 'assets/js/site.js'],
  ['assets/img/logo-mark.svg', 'assets/img/logo-mark.svg'],
  ['assets/img/favicon.svg', 'assets/img/favicon.svg'],
  ['assets/img/favicon-96x96.png', 'assets/img/favicon-96x96.png'],
  ['assets/img/favicon.ico', 'assets/img/favicon.ico'],
  ['assets/img/apple-touch-icon.png', 'assets/img/apple-touch-icon.png'],
  ['assets/img/og.png', 'assets/img/og.png'],
].map(([ref, rel]) => [ref, `${ref}?v=${assetHash(rel)}`]);

for (const file of fs.readdirSync(DIST).filter((f) => f.endsWith('.html'))) {
  const full = path.join(DIST, file);
  let html = fs.readFileSync(full, 'utf8');
  // longest paths first so one reference cannot be partially replaced
  for (const [from, to] of versioned.sort((a, b) => b[0].length - a[0].length)) {
    html = html.split(from).join(to);
  }
  fs.writeFileSync(full, html);
}

if (!fs.existsSync(path.join(root, 'assets/img/og.png'))) {
  console.warn('⚠️  assets/img/og.png 不存在，社交分享图会 404。运行 `npm run og` 生成。');
}
console.log('dist/ →', fs.readdirSync(DIST).join(', '));
console.log('FAQ schema pages:', faqCounts);
