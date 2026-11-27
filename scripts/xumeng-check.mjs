#!/usr/bin/env node
/**
 * 叙梦工程统一自检脚本 (scripts/xumeng-check.mjs)
 *
 * 用法:
 *   node scripts/xumeng-check.mjs          # 完整自检（规范 + 类型 + 构建 + dry-run + 核心测试）
 *   node scripts/xumeng-check.mjs --fast   # 快速模式（跳过 wrangler dry-run 与测试）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.join(REPO_ROOT, "cloudflare/dzmm-web");
const BACKEND_DIR = path.join(REPO_ROOT, "cloudflare/dzmm");
const MIGRATIONS_DIR = path.join(BACKEND_DIR, "migrations");

const FAST = process.argv.includes("--fast");
const LEGACY_DUPLICATE_PREFIXES = new Set(["0043", "0095"]);

const results = [];

function record(name, ok, detail = "", ms = 0) {
  results.push({ name, ok, detail, ms });
  const icon = ok ? "PASS" : "FAIL";
  const time = ms > 0 ? ` (${(ms / 1000).toFixed(1)}s)` : "";
  console.log(`[${icon}] ${name}${time}${detail ? ` — ${detail}` : ""}`);
}

function runCmd(name, cmd, args, cwd, extraCheck) {
  const start = Date.now();
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
    maxBuffer: 16 * 1024 * 1024,
  });
  const ms = Date.now() - start;
  const combined = `${res.stdout || ""}\n${res.stderr || ""}`;
  if (res.status !== 0) {
    const tail = combined.trim().split("\n").slice(-20).join("\n");
    record(name, false, `exit=${res.status}\n${tail}`, ms);
    return false;
  }
  if (extraCheck) {
    const err = extraCheck(combined);
    if (err) {
      record(name, false, err, ms);
      return false;
    }
  }
  record(name, true, "", ms);
  return true;
}

// 1. D1 Migration Invariants
function checkMigrations() {
  const start = Date.now();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const seen = new Map();
  const errors = [];

  for (const file of files) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
    if (!match) {
      errors.push(`非规范命名: ${file}`);
      continue;
    }
    const prefix = match[1];
    const num = Number(prefix);
    if (seen.has(prefix) && !LEGACY_DUPLICATE_PREFIXES.has(prefix)) {
      errors.push(`新增重复迁移编号 ${prefix}: ${seen.get(prefix)} 与 ${file}`);
    }
    seen.set(prefix, file);

    if (num >= 99) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      if (/ALTER\s+TABLE\s+\w+\s+RENAME\s+TO\s+\w+_old/i.test(sql) && !/PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(sql)) {
        errors.push(`${file} 使用 RENAME TO *_old 但未关闭外键或采用 _next 模式，存在悬空 FK 风险`);
      }
    }
  }

  record(
    "D1 迁移规范检查",
    errors.length === 0,
    errors.length ? errors.join("; ") : `${files.length} 个迁移文件，无新增重复编号`,
    Date.now() - start,
  );
}

// 2. Repo Root Cleanliness
function checkRootCleanliness() {
  const start = Date.now();
  const entries = fs.readdirSync(REPO_ROOT);
  const scratchPatterns = [
    /^capture.*\.mjs$/i,
    /^crawl_.*\.py$/i,
    /^hgtv_/i,
    /^explore-.*\.mjs$/i,
    /^test-.*\.(mjs|html)$/i,
  ];
  const stray = entries.filter((name) => scratchPatterns.some((re) => re.test(name)));
  record(
    "仓库根目录整洁度",
    stray.length === 0,
    stray.length ? `发现临时脚本应归档到 scripts/archive/: ${stray.join(", ")}` : `${entries.length} 项，无杂散临时脚本`,
    Date.now() - start,
  );
}

// 3. Source Size Guardrails (soft report)
function reportHotspots() {
  const targets = [
    "cloudflare/dzmm-web/src/worker.ts",
    "src/components/dzmm/tavern-app.tsx",
    "cloudflare/dzmm/src/app.ts",
  ];
  const summary = targets.map((rel) => {
    const full = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(full)) return `${rel}: missing`;
    const lines = fs.readFileSync(full, "utf8").split("\n").length;
    return `${path.basename(rel)}=${lines}L`;
  });
  console.log(`[INFO] 核心入口规模: ${summary.join(" | ")}`);
}

console.log("=== 叙梦 (Xumeng) 工程自检开始 ===");
checkMigrations();
checkRootCleanliness();
reportHotspots();

const tscBin = path.join(WEB_DIR, "node_modules/.bin/tsc");
const viteBin = path.join(WEB_DIR, "node_modules/.bin/vite");
const wranglerBin = path.join(WEB_DIR, "node_modules/.bin/wrangler");
const tsxBin = path.join(WEB_DIR, "node_modules/.bin/tsx");

// 4. Client TypeScript
runCmd("dzmm-web 客户端 TypeScript 检查", tscBin, ["--noEmit", "-p", "tsconfig.client.json"], WEB_DIR);

// 5. Vite Production Build (assert 0 configLoader warnings)
runCmd("dzmm-web Vite 构建（零配置警告）", viteBin, ["build"], WEB_DIR, (output) => {
  if (/failed to load config|configLoader|commonjs|extensionless/i.test(output)) {
    return "Vite 构建出现配置/模块加载警告";
  }
  return null;
});

if (!FAST) {
  // 6. Wrangler Dry-Run for both Workers
  runCmd(
    "dzmm-web Worker 打包检查 (wrangler dry-run)",
    wranglerBin,
    ["deploy", "--dry-run", "--config", "wrangler.jsonc", "--outdir", "/tmp/xumeng-check-web"],
    WEB_DIR,
  );
  runCmd(
    "dzmm-backend Worker 打包检查 (wrangler dry-run)",
    wranglerBin,
    ["deploy", "--dry-run", "--config", "wrangler.jsonc", "--outdir", "/tmp/xumeng-check-backend"],
    BACKEND_DIR,
  );

  // 7. Core Automated Tests
  runCmd(
    "前端会员订阅意图单测",
    tsxBin,
    ["--test", "src/lib/dzmm-subscription-intent.test.mts"],
    REPO_ROOT,
  );
  runCmd(
    "后端 D1 会员订阅与升级集成测试",
    tsxBin,
    ["--test", "test/subscription-tiers-upgrade.test.mjs"],
    BACKEND_DIR,
  );
  runCmd(
    "边缘网关核心路由/支付/安全单测",
    tsxBin,
    [
      "--test",
      "test/routes.test.mts",
      "test/guagua-gateway.test.mts",
      "test/zpay-gateway.test.mts",
      "test/payments-webhook.test.mts",
      "test/nowpayments-webhook.test.mts",
      "test/telegram-feedback.test.mts",
      "test/geo-discovery.test.mts",
      "test/generation-pause.test.mts",
      "test/h3-channel.test.mts",
      "test/h3-r2v.test.mts",
      "test/chat-media-proxy.test.mts",
      "test/character-voice-proxy.test.mts",
      "test/share-poster.test.mts",
    ],
    WEB_DIR,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 工程自检完成: ${results.length - failed.length}/${results.length} 通过 ===`);
process.exit(failed.length > 0 ? 1 : 0);
