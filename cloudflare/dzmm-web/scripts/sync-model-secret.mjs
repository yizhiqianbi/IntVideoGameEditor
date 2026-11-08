import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const webRoot = fileURLToPath(new URL('../', import.meta.url));
const cliEnvironment = { ...process.env };
const require = createRequire(`${projectRoot}package.json`);
require('@next/env').loadEnvConfig(projectRoot, true, { info() {}, error() {} });
const { readDzmmProviderConfig } = await import('../../../src/lib/dzmm-chat.ts');
const config = readDzmmProviderConfig();
if (!config.configured) throw new Error('本地模型配置无效，未上传任何密钥。');

const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const child = spawn(process.execPath, [wrangler, 'secret', 'bulk', '--config', 'wrangler.jsonc'], {
  cwd: webRoot,
  env: cliEnvironment,
  stdio: ['pipe', 'inherit', 'inherit'],
});
// Only the selected model key goes to Wrangler stdin. No secret file is created.
child.stdin.end(JSON.stringify({ DZMM_API_KEY: config.apiKey }));
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
if (code !== 0) process.exit(code ?? 1);
