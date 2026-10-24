import { writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:8796';
const checks = [];
for (const path of ['/api/status', '/api/backend/v1/health', '/api/chat', '/api/backend/v1/auth/email/config', '/api/backend/v1/billing/config']) {
  const response = await fetch(origin + path);
  const data = await response.json();
  checks.push({ path, status: response.status, data });
}
// These read-only endpoints return public capabilities, never credentials.
await writeFile(new URL('../evidence/local-service-status.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2) + '\n');
console.log(JSON.stringify(checks.map(({path,status,data})=>({path,status,configured:data.configured,enabled:data.enabled}))));
