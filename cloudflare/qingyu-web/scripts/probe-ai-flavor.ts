import { readFile, writeFile } from 'node:fs/promises';
import { buildDzmmPromptPlan } from '../engine/src/lib/dzmm-chat';
import { QINGYU_CHARACTERS } from '../engine/src/lib/qingyu-catalog';
import { CLASSIC_STYLE, TRAVELER_STYLE } from '../engine/src/app/xumeng/girlfriend/companion-style';
import { INTIMATE_STYLE } from '../engine/src/app/xumeng/girlfriend/intimate-style';
import { buildQingyuCompanionTurn } from '../engine/cloudflare/qingyu-companion/src/host';
import { QINGYU_ROMANCE_STYLE } from '../engine/src/lib/qingyu-romance-style';

const label = process.argv[2] || 'run';
const env = Object.fromEntries((await readFile(new URL('../.dev.vars', import.meta.url), 'utf8')).trim().split('\n')
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => { const at = line.indexOf('='); return [line.slice(0, at), JSON.parse(line.slice(at + 1))]; }));

const tavernInputs = [
  ['chitchat', '路上买了个烤红薯，烫得我一直换手。'],
  ['comfort', '今天被领导当着全组的面说了一顿，挺丢人的。'],
  ['offended', '你是不是觉得我很好糊弄？刚才那话听着就很敷衍。'],
  ['probe', '你现在心里在想什么？说实话。'],
  ['compliment', '你长得还挺好看的。'],
] as const;
const companionInputs = [
  ['comfort', '今天被领导当着全组的面说了一顿，挺丢人的。'],
  ['busy', '在干嘛呢'],
  ['offended', '你回得好官方啊，像客服。'],
  ['goodnight', '困了，睡了'],
] as const;
const companionStyles: Record<string, typeof CLASSIC_STYLE> = { 'qy-shiyu': CLASSIC_STYLE, 'qy-shen': INTIMATE_STYLE, 'qy-linchuan': TRAVELER_STYLE };
const identities: Record<string, string> = {
  'qy-shiyu': '你是陆时予，26岁的男性钢琴家。',
  'qy-shen': '你是沈聿，28岁的男性古籍修复师。',
  'qy-linchuan': '你是季临川，27岁的男性旅行摄影师。',
  'qy-xingcheng': '你是许星澄，25岁的男性天文台工程师。',
};

const FLAVOR = /一丝|一抹|嘴角|眼(中|底|神)|目光|不易察觉|像是在|仿佛|似乎|微微|轻轻|顿了顿|稍顿|声音(很)?(轻|低)|语气|却很稳|低沉|磁性|指尖|安心|我(就)?在(这里|这儿)|认真听|慢慢来|不用急|别急|不着急|陪着你|不是[^。！？\n]{1,16}而?是|——/g;

async function call(messages: unknown) {
  const response = await fetch(`${env.CHAT_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CHAT_API_KEY}` },
    body: JSON.stringify({ model: env.CHAT_MODEL, messages, max_tokens: 600, temperature: .8, reasoning: { enabled: false } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) return { status: response.status, output: '' };
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return { status: response.status, output: data.choices?.[0]?.message?.content ?? '' };
}
function measure(output: string) {
  const hits = output.match(FLAVOR) ?? [];
  const speech = (output.match(/“[^”]*”/g) ?? []).join('');
  return { chars: output.length, speechChars: speech.length, flavorHits: hits.length, flavor: hits };
}

const jobs: Array<Promise<Record<string, unknown>>> = [];
for (const card of QINGYU_CHARACTERS) {
  for (const [kind, input] of tavernInputs) jobs.push((async () => {
    const plan = buildDzmmPromptPlan({ character: card, messages: [{ role: 'assistant', content: card.firstMessage }, { role: 'user', content: input }], model: 'balanced', maxTokens: 600 });
    const r = await call(plan.messages);
    return { mode: 'tavern', id: card.id, kind, input, status: r.status, ...measure(r.output), output: r.output };
  })());
  if (companionStyles[card.id]) for (const [kind, input] of companionInputs) jobs.push((async () => {
    const identity = identities[card.id];
    const messages = [{ role: 'system', content: [identity, QINGYU_ROMANCE_STYLE.tone, QINGYU_ROMANCE_STYLE.relationship, QINGYU_ROMANCE_STYLE.companion, '所有内容适合全年龄，不诱导排他依赖，不宣称是真人；不写名字标签、括号动作或心理描写。'].join('\n') },
      { role: 'user', content: buildQingyuCompanionTurn(companionStyles[card.id], input, identity) }];
    const r = await call(messages);
    return { mode: 'companion', id: card.id, kind, input, status: r.status, ...measure(r.output), output: r.output };
  })());
}
const results = await Promise.all(jobs);
const summary = (mode: string) => {
  const rows = results.filter(r => r.mode === mode && r.status === 200) as Array<{ chars: number; flavorHits: number }>;
  return { samples: rows.length, avgChars: Math.round(rows.reduce((a, r) => a + r.chars, 0) / rows.length),
    maxChars: Math.max(...rows.map(r => r.chars)), flavorPer100: +(rows.reduce((a, r) => a + r.flavorHits, 0) * 100 / rows.reduce((a, r) => a + r.chars, 0)).toFixed(2) };
};
const report = { label, model: env.CHAT_MODEL, style: QINGYU_ROMANCE_STYLE.version, createdAt: new Date().toISOString(),
  scope: 'Single-turn live samples after each opening (tavern) and with the companion style wrapper; no memory or multi-turn history.',
  summary: { tavern: summary('tavern'), companion: summary('companion') }, results };
await writeFile(new URL(`../evidence/ai-flavor-${label}.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary, null, 2));
