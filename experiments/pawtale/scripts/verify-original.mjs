import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../../../", import.meta.url);
const baseline = JSON.parse(await readFile(new URL("../qa/original-files.sha256.json", import.meta.url), "utf8"));
const changed = [];
const unrelatedChanges = [];
for (const [path, hash] of Object.entries(baseline)) {
  try {
    const current = createHash("sha256").update(await readFile(new URL(path, root))).digest("hex");
    if (hash !== current) (path.startsWith("cloudflare/qingyu-web/") ? unrelatedChanges : changed).push(path);
  } catch { (path.startsWith("cloudflare/qingyu-web/") ? unrelatedChanges : changed).push(path); }
}
console.log(JSON.stringify({ root: fileURLToPath(root), checked: Object.keys(baseline).filter((path) => !path.startsWith("cloudflare/qingyu-web/")).length, changed, unrelatedChanges, note: "qingyu-web is a separate parallel project, outside the original xumeng scope; it is observed but never written or reverted here." }, null, 2));
if (changed.length) process.exitCode = 1;
