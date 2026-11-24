import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const skip = new Set(["node_modules", "dist", ".wrangler", "package-lock.json", "fork-empty-product.mjs", "verify-empty.mjs"]);
const text = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".css", ".json", ".html", ".svg", ".sql", ".jsonc", ".md", ".txt"]);
const needles = ["叙梦", "xumeng", "XUMENG", "dzmm", "DZMM", "xumengchat", "lumivale", "foreverse", "裴聿", "林幺", "acct_1", "c466b70a"];

async function files(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await files(full, out);
    else if (text.has(extname(entry.name))) out.push(full);
  }
  return out;
}

const hits = [];
for (const file of await files(root)) {
  const body = await readFile(file, "utf8");
  for (const needle of needles) {
    if (body.includes(needle)) hits.push(`${relative(root, file)}: ${needle}`);
  }
}
if (hits.length) {
  console.error(hits.slice(0, 40).join("\n"));
  process.exit(1);
}

const tsx = fileURLToPath(new URL("../../cloudflare/dzmm-web/node_modules/.bin/tsx", import.meta.url));
if (!(await stat(tsx).then(() => true).catch(() => false))) {
  console.log("empty-text-ok");
  process.exit(0);
}
const check = spawnSync(tsx, ["--eval", `
import { SHELF_CATALOG_CHARACTERS, SHELF_LISTED_CHARACTERS } from "./shared/lib/shelf-characters.ts";
import { CHARACTER_SHARE_INDEX } from "./frontend/src/character-share-index.ts";
import { GIRLFRIEND_CAST } from "./shared/app/folio/girlfriend/cast.ts";
if (SHELF_CATALOG_CHARACTERS.length || SHELF_LISTED_CHARACTERS.length || CHARACTER_SHARE_INDEX.length || GIRLFRIEND_CAST.length) {
  throw new Error("catalog is not empty");
}
console.log("empty-catalog-ok");
`], { cwd: root, encoding: "utf8" });
if (check.status !== 0) {
  console.error(check.stdout);
  console.error(check.stderr);
  process.exit(check.status ?? 1);
}
process.stdout.write(check.stdout);
