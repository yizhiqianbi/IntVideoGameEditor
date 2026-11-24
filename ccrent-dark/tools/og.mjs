#!/usr/bin/env node
/**
 * Renders assets/img/og.png (1200×630) — the social share card used by
 * og:image / twitter:image. Requires playwright (already used by the
 * workspace tooling).
 *
 *   node tools/og.mjs
 */
import { chromium } from '/Users/pencil/Documents/IntVideoGameEditor/node_modules/playwright/index.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { SITE } from './content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = (p) => 'file://' + path.join(root, p);
// Inline the SVG logo; file:// images are blocked when using page.setContent.
const logoData = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, 'assets/img/logo-mark.svg')).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; src: url('${file('assets/fonts/inter-latin-wght-normal.Dx4kXJAl.woff2')}') format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; }
body { margin: 0; width: 1200px; height: 630px; overflow: hidden;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif;
  color: #f2f4f8;
  background:
    radial-gradient(60% 55% at 50% -8%, rgba(91,130,255,.35) 0%, transparent 62%),
    radial-gradient(40% 40% at 96% 100%, rgba(52,211,153,.14) 0%, transparent 70%),
    linear-gradient(160deg, #0d1018 0%, #08090b 55%, #0b0d12 100%);
  padding: 58px 64px; }
.grid { position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px);
  background-size: 24px 24px;
  mask-image: radial-gradient(70% 70% at 50% 30%, #000 0%, transparent 82%); }
.brand { display: flex; align-items: center; gap: 14px; position: relative; }
.brand img { width: 46px; height: 46px; border-radius: 12px; box-shadow: 0 12px 30px -12px rgba(77,124,255,.8); }
.brand .word { display: flex; align-items: baseline; font-size: 28px; letter-spacing: -.045em; line-height: 1; }
.brand .cc { font-weight: 700; } .brand .rent { font-weight: 500; color: #c7cbd4; }
h1 { position: relative; margin: 58px 0 0; font-size: 74px; line-height: 1.06; letter-spacing: -.045em; font-weight: 700; }
h1 .soft { color: #9db6ff; }
p.sub { position: relative; margin: 20px 0 0; font-size: 25px; color: #a9aebb; letter-spacing: -.01em; }
.pills { position: relative; display: flex; gap: 14px; margin-top: 34px; }
.pill { padding: 12px 22px; border-radius: 999px; font-size: 20px; font-weight: 500;
  background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.12); color: #e6e9f2; }
.pill strong { color: #fff; font-weight: 700; }
.pill.hot { background: #f1f2f4; color: #0a0b0d; border-color: transparent; }
.foot { position: absolute; left: 64px; bottom: 46px; display: flex; align-items: center; gap: 12px;
  font-size: 19px; color: #8b909c; }
.foot .dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; box-shadow: 0 0 12px #34d399; }
.term { position: absolute; right: 64px; bottom: 46px; font-size: 18px; color: #7c8494; letter-spacing: .02em; }
</style></head><body>
<div class="grid"></div>
<div class="brand">
  <img src="${logoData}" alt="">
  <span class="word"><span class="cc">CC</span><span class="rent">Rent</span></span>
</div>
<h1>美国 Mac mini 租用<span class="soft">，</span><br>Claude Code 开机即用</h1>
<p class="sub">专属 Mac mini M4 · 美国住宅 IP · 48 小时内交付</p>
<div class="pills">
  <span class="pill"><strong>$143</strong>/月 · 仅 Mac</span>
  <span class="pill"><strong>$324</strong>/月起 · Max</span>
  <span class="pill"><strong>$466</strong>/月起 · Ultra</span>
</div>
<div class="foot"><span class="dot"></span>现货供应中 · ${SITE.origin.replace('https://', '')}</div>
<div class="term">预装 Claude Code · 远程连上就能用</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
const tmp = path.join(root, '.og-tmp.html');
fs.writeFileSync(tmp, html);
await page.goto('file://' + tmp, { waitUntil: 'networkidle' });
fs.unlinkSync(tmp);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(root, 'assets/img/og.png') });
await browser.close();
console.log('assets/img/og.png written (1200×630)');
