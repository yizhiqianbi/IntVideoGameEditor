#!/usr/bin/env node
// 用 Cloudflare API 一次性应用 P0（HTTP/3 + 0-RTT + 哈希静态资源响应头规则），并做外部验证。
//
// 用法：
//   # 只演练，不改线上（默认）
//   CLOUDFLARE_API_TOKEN=xxx node cf-p0-apply.mjs
//
//   # 真正应用
//   CLOUDFLARE_API_TOKEN=xxx node cf-p0-apply.mjs --apply
//
// Token 权限（Cloudflare → My Profile → API Tokens → Create Custom Token）：
//   Zone → Zone → Read
//   Zone → Zone Settings → Edit            （HTTP/3、0-RTT 设置）
//   Zone → Config Settings → Edit          （响应头 Transform Rule；API 文档里叫 Config Settings Write）
//   Zone Resources: 只包含 xumengchat.top
//
// 只碰三样东西，全部可回滚：
//   1. 区域设置 http3 = on
//   2. 区域设置 0rtt  = on
//   3. 响应头 Transform Rule（description = assets-immutable）
// 不动 HTML、不动缓存键、不清缓存、不动 Workers。

import { setTimeout as sleep } from "node:timers/promises";

const ZONE_NAME = process.env.CF_ZONE || "xumengchat.top";
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const RULE_DESCRIPTION = "assets-immutable";
// Free 套餐不允许 matches（正则）运算符，用函数写法；starts_with/ends_with 是函数不是运算符。
const EXPRESSION = String.raw`starts_with(http.request.uri.path, "/assets/") and (ends_with(http.request.uri.path, ".js") or ends_with(http.request.uri.path, ".css")) and not (http.request.uri.path eq "/assets/xumeng/live/rtc.js")`;
const APPLY = process.argv.includes("--apply");
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "";

const API = "https://api.cloudflare.com/client/v4";

function log(...args) { console.log(...args); }
function fail(message) { console.error(`✘ ${message}`); process.exitCode = 1; }

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const detail = (payload.errors || []).map(error => `${error.code} ${error.message}`).join("; ") || `HTTP ${response.status}`;
    const error = new Error(detail);
    error.status = response.status;
    error.codes = (payload.errors || []).map(item => item.code);
    throw error;
  }
  return payload.result;
}

async function zoneId() {
  const zones = await api(`/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  if (!zones?.length) throw new Error(`找不到区域 ${ZONE_NAME}（token 是否包含该 zone 的权限？）`);
  return zones[0].id;
}

async function readSetting(zone, name) {
  try {
    const result = await api(`/zones/${zone}/settings/${name}`);
    return result?.value ?? null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function enableSetting(zone, name, label) {
  const current = await readSetting(zone, name);
  if (current === "on") {
    log(`  = ${label}: 已经是 on，跳过`);
    return { changed: false, value: current };
  }
  if (!APPLY) {
    log(`  + ${label}: ${current ?? "(未知)"} → on（演练，未写入）`);
    return { changed: true, value: "on", planned: true };
  }
  const result = await api(`/zones/${zone}/settings/${name}`, { method: "PATCH", body: { value: "on" } });
  log(`  ✓ ${label}: ${current ?? "(未知)"} → ${result?.value ?? "on"}`);
  return { changed: true, value: result?.value ?? "on" };
}

const RULE = {
  action: "rewrite",
  action_parameters: {
    headers: {
      "Cache-Control": { operation: "set", value: CACHE_CONTROL },
    },
  },
  expression: EXPRESSION,
  description: RULE_DESCRIPTION,
};

async function entrypoint(zone) {
  try {
    return await api(`/zones/${zone}/rulesets/phases/http_response_headers_transform/entrypoint`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function ensureRule(zone) {
  const current = await entrypoint(zone);
  const existing = current?.rules ?? [];
  const ours = existing.find(rule => rule.description === RULE_DESCRIPTION);
  const rest = existing.filter(rule => rule.description !== RULE_DESCRIPTION);

  if (ours
    && ours.action === RULE.action
    && ours.expression === RULE.expression
    && JSON.stringify(ours.action_parameters?.headers) === JSON.stringify(RULE.action_parameters.headers)) {
    log(`  = Transform Rule「${RULE_DESCRIPTION}」已存在且一致，跳过`);
    return { changed: false };
  }

  log(`  ${ours ? "~" : "+"} Transform Rule「${RULE_DESCRIPTION}」${ours ? "更新为" : "新建"}：${CACHE_CONTROL}`);
  log(`    expression: ${EXPRESSION}`);
  if (!APPLY) {
    log("    （演练，未写入）");
    return { changed: true, planned: true };
  }
  await api(`/zones/${zone}/rulesets/phases/http_response_headers_transform/entrypoint`, {
    method: "PUT",
    body: { rules: [...rest, RULE] },
  });
  log("  ✓ 已写入（保留原有其它响应头规则）");
  return { changed: true };
}

async function verify() {
  const origin = `https://${ZONE_NAME}`;
  const home = await fetch(`${origin}/`);
  const html = await home.text();
  const bundle = html.match(/\/assets\/main-[A-Za-z0-9_-]+\.(?:js|css)/)?.[0];
  const nonHashed = "/assets/xumeng/brand/xumeng-icon-192.png";

  for (let attempt = 1; attempt <= 6; attempt++) {
    const [asset, other] = await Promise.all([
      bundle ? fetch(`${origin}${bundle}`, { method: "HEAD" }) : null,
      fetch(`${origin}${nonHashed}`, { method: "HEAD" }),
    ]);
    const cacheControl = asset?.headers.get("cache-control") || "(none)";
    const otherCacheControl = other.headers.get("cache-control") || "(none)";
    const altSvc = home.headers.get("alt-svc") || "(none)";
    log(`  第 ${attempt} 次验证：`);
    log(`    哈希资源 ${bundle ?? "(未找到)"} → cache-control: ${cacheControl}`);
    log(`    非哈希资源 ${nonHashed} → cache-control: ${otherCacheControl}`);
    log(`    首页 alt-svc（HTTP/3）：${altSvc}`);
    const cacheOk = cacheControl.includes("max-age=31536000");
    const otherOk = !otherCacheControl.includes("max-age=31536000");
    const h3Ok = altSvc.includes("h3=");
    if (cacheOk && otherOk && h3Ok) {
      log("  ✓ P0 验证通过");
      return true;
    }
    if (attempt < 6) await sleep(5000);
  }
  fail("验证未通过：见上面的响应头。若 cache-control 没变，说明 Transform Rule 没作用到 Worker 响应，改用代码方案（worker.ts 已改好，部署即可）。");
  return false;
}

async function main() {
  log(`Cloudflare P0 应用脚本（${APPLY ? "APPLY 模式" : "演练模式，加 --apply 才会写入"}）`);
  log(`zone: ${ZONE_NAME}`);
  if (!TOKEN) {
    console.error("✘ 缺少 CLOUDFLARE_API_TOKEN（或 CF_API_TOKEN）环境变量。");
    console.error("  创建 token：Cloudflare → My Profile → API Tokens → Create Custom Token");
    console.error("  权限：Zone Read + Zone Settings:Edit + Config Settings:Edit，资源只选该 zone。");
    console.error("  然后：CLOUDFLARE_API_TOKEN=xxx node infra/cn-edge/cf-p0-apply.mjs --apply");
    process.exitCode = 2;
    return;
  }

  const zone = await zoneId();
  log(`zone id: ${zone}`);

  log("\n[1/3] HTTP/3");
  await enableSetting(zone, "http3", "HTTP/3");

  log("\n[2/3] 0-RTT");
  try {
    await enableSetting(zone, "0rtt", "0-RTT");
  } catch (error) {
    log(`  ! 0-RTT 设置失败（可能该套餐不支持，跳过）：${error.message}`);
  }

  log("\n[3/3] 响应头 Transform Rule");
  await ensureRule(zone);

  if (!APPLY) {
    log("\n演练结束。确认无误后加 --apply 再跑一次。");
    return;
  }

  log("\n外部验证（最多等 30 秒生效）");
  await verify();
}

main().catch(error => {
  console.error(`✘ 失败：${error.message}`);
  if (error.status === 403) console.error("  通常是 token 权限不足，检查 Zone Settings:Edit / Config Settings:Edit。");
  if (error.status === 401) console.error("  token 无效或已过期。");
  process.exitCode = 1;
});
