#!/usr/bin/env node
/**
 * Cloudflare Pages custom-domain helper for the CCRent replica.
 *
 *   node tools/domains.mjs list
 *   node tools/domains.mjs add ccrent.cc ccrent.dev
 *   node tools/domains.mjs status
 *   node tools/domains.mjs remove old.example
 *
 * Auth: CLOUDFLARE_API_TOKEN env var, or the OAuth token stored by
 * `npx wrangler@4 login`. If the token expired, run `npx wrangler@4 whoami`
 * once (it refreshes) and retry.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '274d62c1f24b885b3dfe562cda5d60c1';
const PROJECT = process.env.PAGES_PROJECT || 'ccrent-dark';
const API = 'https://api.cloudflare.com/client/v4';

function readToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    path.join(os.homedir(), '.config/.wrangler/config/default.toml'),
    path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
  ];
  for (const file of candidates) {
    try {
      const txt = fs.readFileSync(file, 'utf8');
      const m = txt.match(/oauth_token = "([^"]+)"/);
      if (m) return m[1];
    } catch {}
  }
  return null;
}

const token = readToken();
if (!token) {
  console.error('找不到 Cloudflare 凭证。先运行： npx wrangler@4 login');
  process.exit(1);
}

async function api(method, endpoint, body) {
  const res = await fetch(API + endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    const msg = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
    throw new Error(`Cloudflare API ${res.status} — ${msg || 'unknown error'}`);
  }
  return json.result;
}

const base = `/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}/domains`;

async function listDomains() {
  const rows = await api('GET', base);
  if (!rows.length) {
    console.log(`Pages 项目 ${PROJECT} 还没有绑定自定义域名。`);
    return rows;
  }
  console.log(`Pages 项目 ${PROJECT} 自定义域名（${rows.length}）：\n`);
  for (const d of rows) {
    const cert = d.certificate_status ? `  cert: ${d.certificate_status}` : '';
    console.log(`- ${d.name}  [${d.status}]${cert}`);
    if (d.status !== 'active') {
      const v = d.verification_data || {};
      if (v.status) console.log(`    验证: ${v.status}`);
      if (v.txt_name) console.log(`    TXT: ${v.txt_name} = ${v.txt_value}`);
      if (v.cname) console.log(`    CNAME: ${v.cname} → ${v.cname_target || 'ccrent-dark.pages.dev'}`);
    }
  }
  return rows;
}

async function addDomains(names) {
  if (!names.length) {
    console.error('用法：node tools/domains.mjs add ccrent.cc [更多域名...]');
    process.exit(1);
  }
  for (const name of names) {
    const domain = name.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    try {
      const d = await api('POST', base, { name: domain });
      console.log(`✓ 已提交 ${domain} — 状态 ${d.status}`);
      const v = d.verification_data || {};
      if (v.txt_name) console.log(`  如需手动验证 TXT：${v.txt_name} = ${v.txt_value}`);
      if (v.cname) console.log(`  外部注册商 CNAME：${v.cname} → ${v.cname_target || 'ccrent-dark.pages.dev'}`);
    } catch (err) {
      console.error(`✗ ${domain} — ${err.message}`);
    }
  }
  console.log('\n绑定后 SSL 证书通常 1–5 分钟内签发，可用 `node tools/domains.mjs status` 查看。');
}

async function removeDomain(name) {
  if (!name) {
    console.error('用法：node tools/domains.mjs remove old.example');
    process.exit(1);
  }
  await api('DELETE', `${base}/${name}`);
  console.log(`已解绑 ${name}`);
}

const [cmd = 'list', ...rest] = process.argv.slice(2);
try {
  if (cmd === 'list' || cmd === 'status') await listDomains();
  else if (cmd === 'add') await addDomains(rest);
  else if (cmd === 'remove' || cmd === 'rm') await removeDomain(rest[0]);
  else {
    console.log(`用法：
  node tools/domains.mjs list
  node tools/domains.mjs add <domain...>
  node tools/domains.mjs status
  node tools/domains.mjs remove <domain>`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
