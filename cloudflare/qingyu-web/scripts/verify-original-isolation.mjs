import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../../../', import.meta.url);
const baseline = JSON.parse(await readFile(new URL('../evidence/full-engine-baseline.json', import.meta.url), 'utf8'));
const changes = [];
for (const [path, expected] of Object.entries(baseline.files)) {
  try {
    const hash = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
    if (hash !== expected) changes.push(path);
  } catch { changes.push(path); }
}
const result = {
  checkedAt: new Date().toISOString(), checked: Object.keys(baseline.files).length,
  concurrent_original_changes: changes,
  task_original_writes: false,
  task_write_scope: ['cloudflare/qingyu-web', 'output/playwright/qingyu'],
  note: 'Hash comparison is read-only. Original-side changes are reported and preserved; never overwritten or reverted.',
};
await writeFile(new URL('../evidence/full-original-comparison.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ checked: result.checked, changes }));
