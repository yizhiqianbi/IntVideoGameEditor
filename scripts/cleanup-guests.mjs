#!/usr/bin/env node
/**
 * Find (and optionally delete) empty guest accounts.
 *
 * Safe by default: prints a dry-run summary. Deleting requires --delete.
 * A guest is only eligible when it has NO conversations, messages, favorites,
 * credit grants/payments and is older than --days.
 *
 * Usage:
 *   HOME=./.wrangler-home CLOUDFLARE_ACCOUNT_ID=... node scripts/cleanup-guests.mjs --days 7
 *   ... --days 7 --delete --limit 2000
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const days = Math.max(1, Number(value("--days", "7")) || 7);
const limit = Math.min(20_000, Math.max(1, Number(value("--limit", "5000")) || 5000));
const apply = args.includes("--delete");
const root = resolve(import.meta.dirname, "..");
const config = "cloudflare/dzmm/wrangler.production.jsonc";
const env = { ...process.env, HOME: process.env.HOME || resolve(root, ".wrangler-home") };

function d1(sql) {
  const output = execFileSync("npx", ["--prefix", "cloudflare/dzmm", "wrangler", "d1", "execute", "dzmm-db",
    "--remote", "--config", config, "--json", "--command", sql], { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(output.slice(output.indexOf("["))).flatMap((entry) => entry.results ?? []);
}

const cutoff = Date.now() - days * 86_400_000;
const rows = d1(`SELECT id, created_at FROM users u WHERE u.is_guest = 1 AND u.created_at < ${cutoff}
  AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM trusted_credit_grants g WHERE g.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM payment_credit_ledger p WHERE p.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM subscription_orders o WHERE o.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM subscription_periods sp WHERE sp.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM dream_coin_ledger d WHERE d.user_id = u.id)
  ORDER BY u.created_at ASC LIMIT ${limit};`);

const total = d1(`SELECT COUNT(*) AS n FROM users WHERE is_guest = 1;`)[0]?.n ?? 0;
console.log(`游客总数: ${total}`);
console.log(`可清理（>${days} 天、无会话/消息/收藏/积分/订阅）: ${rows.length}${rows.length >= limit ? `+（已截断到 ${limit}）` : ""}`);
for (const row of rows.slice(0, 5)) console.log(`  样例 ${row.id} 创建于 ${new Date(Number(row.created_at)).toISOString().slice(0, 10)}`);
if (!rows.length) process.exit(0);
if (!apply) { console.log("这是 dry-run。确认后加 --delete 执行。"); process.exit(0); }

const ids = rows.map((row) => String(row.id));
const quoted = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
const statements = [
  `DELETE FROM preferences WHERE user_id IN (${quoted});`,
  `DELETE FROM sessions WHERE user_id IN (${quoted});`,
  `DELETE FROM users WHERE id IN (${quoted});`,
];
for (const sql of statements) {
  const output = execFileSync("npx", ["--prefix", "cloudflare/dzmm", "wrangler", "d1", "execute", "dzmm-db",
    "--remote", "--config", config, "--json", "--command", sql], { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  console.log(sql.split("WHERE")[0].trim(), "→", output.match(/"rows_written":\s*(\d+)/)?.[1] ?? "?");
}
console.log("清理完成");
