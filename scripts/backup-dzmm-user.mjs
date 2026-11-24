#!/usr/bin/env node
/**
 * Export one account's D1 rows (characters / conversations / messages /
 * favorites / preferences / character payloads) into a timestamped folder + zip.
 *
 * Usage:
 *   HOME=./.wrangler-home CLOUDFLARE_ACCOUNT_ID=... \
 *     node scripts/backup-dzmm-user.mjs --email super@xumengchat.top
 *   ... --account-id <uuid>
 *
 * Reads only; never writes to D1.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createZip } from "./lib/zip.mjs";

const args = process.argv.slice(2);
const argument = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const email = argument("--email");
const accountId = argument("--account-id");
if (!email && !accountId) {
  console.error("用法: node scripts/backup-dzmm-user.mjs --email <邮箱> | --account-id <uuid>");
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const config = "cloudflare/dzmm/wrangler.production.jsonc";
const env = { ...process.env, HOME: process.env.HOME || join(root, ".wrangler-home") };
function d1(sql) {
  const output = execFileSync("npx", ["--prefix", "cloudflare/dzmm", "wrangler", "d1", "execute", "dzmm-db",
    "--remote", "--config", config, "--json", "--command", sql], { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const start = output.indexOf("[");
  return JSON.parse(output.slice(start)).flatMap((entry) => entry.results ?? []);
}

const users = accountId
  ? d1(`SELECT id, email, nickname, role, is_guest, created_at FROM users WHERE id = '${accountId.replace(/'/g, "''")}';`)
  : d1(`SELECT id, email, nickname, role, is_guest, created_at FROM users WHERE email = '${email.replace(/'/g, "''")}';`);
if (!users.length) { console.error("没有找到该账号。"); process.exit(1); }
const user = users[0];
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = join(root, "output/xumeng/backups", `${user.nickname || "user"}-${stamp}`);
mkdirSync(outDir, { recursive: true });

const tables = ["characters", "conversations", "messages", "favorites", "preferences", "character_payloads"];
const files = [];
for (const table of tables) {
  const rows = d1(`SELECT * FROM ${table} WHERE user_id = '${String(user.id).replace(/'/g, "''")}';`);
  const name = `${table}.json`;
  writeFileSync(join(outDir, name), JSON.stringify(rows, null, 0));
  files.push(name);
  console.log(`${table}: ${rows.length}`);
}
writeFileSync(join(outDir, "account.json"), JSON.stringify(user, null, 2));
files.push("account.json");
const zipPath = join(outDir, "backup.zip");
const zip = createWriteStream(zipPath);
createZip({ output: zip, files: files.map((name) => ({ name, data: readFileSync(join(outDir, name)) })) }).then(() => {
  console.log(`备份完成: ${outDir}`);
  console.log(`压缩包: ${zipPath}`);
});
