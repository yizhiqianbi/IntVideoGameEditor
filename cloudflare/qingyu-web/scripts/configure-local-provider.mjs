import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
// Explicitly authorized account reuse. No original file or cloud binding is changed.
const path = process.argv[2];
if (!path) throw new Error('Pass the existing local provider settings file explicitly.');
const values = Object.fromEntries((await readFile(resolve(path), 'utf8')).split(/\r?\n/).filter(line => /^[A-Z_][A-Z_0-9]*=/.test(line)).map(line => {
  const at = line.indexOf('='); let value = line.slice(at + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
  else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  return [line.slice(0, at), value];
}));
if (!values.OPENROUTER_API_KEY) throw new Error('No authorized provider key in that file.');
const target = new URL('../.dev.vars', import.meta.url);
try { await readFile(target); throw new Error('Local configuration already exists; preserve it and update explicitly.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const config = {
  CHAT_BASE_URL: values.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  CHAT_API_KEY: values.OPENROUTER_API_KEY,
  CHAT_MODEL: values.OPENROUTER_MODEL || 'qwen/qwen3-30b-a3b-instruct-2507',
  MODERATION_PROTOCOL: 'chat-completions',
  MODERATION_BASE_URL: 'https://openrouter.ai/api/v1',
  MODERATION_API_KEY: values.OPENROUTER_API_KEY,
  MODERATION_MODEL: 'qwen/qwen3.6-plus',
  COMPANION_MEDIA_REVIEW_SECRET: randomBytes(32).toString('hex'),
};
await writeFile(target, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
await chmod(target, 0o600);
console.log('Independent local provider configuration created; credential values omitted.');
