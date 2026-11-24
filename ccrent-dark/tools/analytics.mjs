#!/usr/bin/env node
/**
 * Today's Cloudflare analytics for ccrent.cc.
 *
 *   npm run analytics
 *
 * Uses Cloudflare GraphQL:
 *  - zone HTTP analytics (all requests incl. bots/assets)
 *  - Web Analytics RUM (real browser page loads / visits / referrers)
 * Auth: CLOUDFLARE_API_TOKEN or the OAuth token stored by wrangler.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SITE } from './content.mjs';

const { accountId, zoneId, rumSiteTag } = SITE.cloudflare;

function readToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const file of [
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
  ]) {
    try {
      const m = fs.readFileSync(file, 'utf8').match(/oauth_token = "([^"]+)"/);
      if (m) return m[1];
    } catch {}
  }
  throw new Error('找不到 Cloudflare 凭证，先运行 npx wrangler@4 login');
}

const token = readToken();
const today = new Date().toISOString().slice(0, 10);
const dayStart = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

async function gql(query) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    if (process.env.DEBUG_QUERY) console.error(query);
    throw new Error(json.errors.map((e) => `${e.message}${e.path ? ' @ ' + e.path.join('.') : ''}`).join('; '));
  }
  return json.data.viewer;
}

const query = `query {
  viewer {
  zones(filter: {zoneTag: "${zoneId}"}) {
    daily: httpRequests1dGroups(limit: 1, filter: {date_geq: "${today}", date_leq: "${today}"}) {
      sum { requests pageViews cachedRequests bytes } uniq { uniques }
    }
    hourly: httpRequests1hGroups(limit: 24, filter: {datetime_geq: "${dayStart}"}, orderBy: [datetime_ASC]) {
      dimensions { datetime } sum { requests pageViews }
    }
    countries: httpRequestsAdaptiveGroups(limit: 10, filter: {datetime_geq: "${dayStart}"}, orderBy: [count_DESC]) {
      count dimensions { clientCountryName }
    }
    paths: httpRequestsAdaptiveGroups(limit: 10, filter: {datetime_geq: "${dayStart}"}, orderBy: [count_DESC]) {
      count dimensions { clientRequestPath }
    }
    status: httpRequestsAdaptiveGroups(limit: 10, filter: {datetime_geq: "${dayStart}"}, orderBy: [count_DESC]) {
      count dimensions { edgeResponseStatus }
    }
    devices: httpRequestsAdaptiveGroups(limit: 5, filter: {datetime_geq: "${dayStart}"}, orderBy: [count_DESC]) {
      count dimensions { clientDeviceType }
    }
  }
  accounts(filter: {accountTag: "${accountId}"}) {
    pages: rumPageloadEventsAdaptiveGroups(limit: 50, filter: {date_geq: "${today}", date_leq: "${today}"}) {
      count sum { visits } dimensions { siteTag requestPath }
    }
    refs: rumPageloadEventsAdaptiveGroups(limit: 50, filter: {date_geq: "${today}", date_leq: "${today}"}) {
      count sum { visits } dimensions { siteTag refererHost }
    }
    devices: rumPageloadEventsAdaptiveGroups(limit: 20, filter: {date_geq: "${today}", date_leq: "${today}"}) {
      count sum { visits } dimensions { siteTag deviceType }
    }
    countries: rumPageloadEventsAdaptiveGroups(limit: 50, filter: {date_geq: "${today}", date_leq: "${today}"}) {
      count sum { visits } dimensions { siteTag countryName }
    }
    total: rumPageloadEventsAdaptiveGroups(limit: 50, filter: {date_geq: "${today}", date_leq: "${today}"}) {
      count sum { visits } dimensions { siteTag }
    }
  }
  }
}`;

const data = await gql(query);
const zone = data.zones[0];
const acc = data.accounts[0];
const d = zone.daily[0] || { sum: {}, uniq: {} };

const sumRum = (rows) => {
  const total = { loads: 0, visits: 0 };
  rows.filter((r) => r.dimensions.siteTag === rumSiteTag).forEach((r) => {
    total.loads += r.count;
    total.visits += r.sum.visits;
  });
  return total;
};
const agg = (rows, dim) => {
  const m = {};
  rows.filter((r) => r.dimensions.siteTag === rumSiteTag).forEach((r) => {
    const k = r.dimensions[dim] || '(direct)';
    const o = m[k] || { loads: 0, visits: 0 };
    o.loads += r.count;
    o.visits += r.sum.visits;
    m[k] = o;
  });
  return Object.entries(m).sort((a, b) => b[1].visits - a[1].visits || b[1].loads - a[1].loads);
};

const rum = sumRum(acc.total);
const pct = (n, t) => (t ? ((n / t) * 100).toFixed(1) + '%' : '-');
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

console.log(`\nCCRent · ${today} 数据（Cloudflare，含部分当天）`);
console.log('='.repeat(58));
console.log(`边缘节点  PV ${fmt(d.sum.pageViews)} · UV ${fmt(d.uniq.uniques)} · 请求 ${fmt(d.sum.requests)} · 流量 ${(Number(d.sum.bytes || 0) / 1048576).toFixed(1)} MB · 缓存命中 ${fmt(d.sum.cachedRequests)}`);
console.log(`真实浏览器  页面加载 ${fmt(rum.loads)} · 访问 ${fmt(rum.visits)}（Web Analytics RUM）`);

console.log('\n▍页面（RUM 访问）');
for (const [k, v] of agg(acc.pages, 'requestPath').slice(0, 10)) {
  console.log(`  ${k.padEnd(22)} ${String(v.visits).padStart(4)} 次访问   ${String(v.loads).padStart(4)} 加载`);
}
console.log('\n▍来源（RUM 访问）');
for (const [k, v] of agg(acc.refs, 'refererHost').slice(0, 8)) {
  console.log(`  ${k.padEnd(22)} ${String(v.visits).padStart(4)} 次访问`);
}
console.log('\n▍设备（RUM 访问）');
for (const [k, v] of agg(acc.devices, 'deviceType')) {
  console.log(`  ${k.padEnd(10)} ${String(v.visits).padStart(4)} 次访问  ${pct(v.visits, rum.visits)}`);
}
console.log('\n▍国家/地区（RUM 访问）');
for (const [k, v] of agg(acc.countries, 'countryName').slice(0, 8)) {
  console.log(`  ${k.padEnd(4)} ${String(v.visits).padStart(4)} 次访问  ${pct(v.visits, rum.visits)}`);
}
console.log('\n▍请求最多的路径（边缘，含资源）');
for (const r of zone.paths.slice(0, 10)) {
  console.log(`  ${(r.dimensions.clientRequestPath || '').padEnd(40)} ${fmt(r.count)}`);
}
console.log('\n▍响应状态（边缘）');
for (const r of zone.status) {
  console.log(`  ${r.dimensions.edgeResponseStatus}  ${fmt(r.count)}`);
}
console.log('\n▍按小时（边缘，UTC）');
for (const h of zone.hourly) {
  console.log(`  ${h.dimensions.datetime.slice(11, 16)}  req ${fmt(h.sum.requests).padStart(6)}  pv ${fmt(h.sum.pageViews).padStart(5)}`);
}
console.log('\n数据说明：边缘数据含爬虫与静态资源请求；RUM 为真实浏览器页面加载，不含 bot。pages.dev 默认域不在统计内。');
