#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Qingyu path adapter of xumeng-roleplay-authoring/scripts/validate-card.mjs.
// Read-only authoring check. Uses the target application's importer and prompt
// assembly; never calls a provider, accesses stored accounts or writes files.
const MAX_FILE_BYTES = 256 * 1024;
const report = {
  ok: false,
  mode: 'local-read-only',
  import: { valid: false },
  authoring: { ready: false },
  promptAssembly: { valid: false, samples: [] },
  warnings: [],
  limitations: [
    '只验证文件导入及主、备选开场下的本地提示词组装；没有调用模型，不证明实际故事质量。',
    '样本使用中性用户输入及剧情时间。未在样本中触发的世界书组合仍可能在未来造成上下文超限。',
    '不检查远程图片可访问性、图片权属或公开投稿资格，也不会保存草稿或提交审核。',
  ],
};
let stage = 'arguments';
let unregisterTypescript;

function warning(code, message, details = {}) {
  if (!report.warnings.some(item => item.code === code)) report.warnings.push({ code, message, ...details });
}
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function collectText(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectText(item, output));
  else if (record(value)) Object.values(value).forEach(item => collectText(item, output));
  return output;
}
function exported(module, name) {
  const candidate = module?.[name] ?? module?.default?.[name] ?? module?.default?.default?.[name];
  if (typeof candidate !== 'function') throw new Error(`目标项目没有可用的 ${name} 导出；请确认这是当前叙梦项目。`);
  return candidate;
}
function parserError(error) {
  // Known application validation errors contain fixed labels/limits, not card text.
  // Never print arbitrary dependency stack traces, filesystem data or script output.
  return error instanceof Error && typeof error.message === 'string'
    ? error.message.slice(0, 400) : '角色卡验证失败。';
}
function print() { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); }

try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${JSON.stringify({ usage: 'node validate-card.mjs <card.json> --repo <叙梦项目目录>',
      repoDefault: '当前工作目录', readOnly: true }, null, 2)}\n`);
    process.exit(0);
  }
  let cardFile, repo = process.cwd();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--repo') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--repo 后需要提供叙梦项目目录。');
      repo = resolve(args[++index]);
    } else if (arg.startsWith('-')) throw new Error('未知参数。用法：node validate-card.mjs <card.json> --repo <叙梦项目目录>');
    else if (cardFile) throw new Error('每次只验证一个 JSON 角色卡文件。');
    else cardFile = resolve(arg);
  }
  if (!cardFile) throw new Error('请提供 JSON 角色卡文件。用法：node validate-card.mjs <card.json> --repo <叙梦项目目录>');

  stage = 'file';
  let fileStats;
  try { fileStats = await stat(cardFile); }
  catch { throw new Error('找不到或无法读取角色卡文件。'); }
  if (!fileStats.isFile()) throw new Error('角色卡路径必须指向文件。');
  report.import.fileBytes = fileStats.size;
  report.import.maxFileBytes = MAX_FILE_BYTES;
  if (fileStats.size > MAX_FILE_BYTES) throw new Error('角色卡文件不能超过 256 KiB。');
  let raw;
  try { raw = await readFile(cardFile, 'utf8'); }
  catch { throw new Error('无法读取角色卡文件。'); }
  let supplied;
  try { supplied = JSON.parse(raw); }
  catch { throw new Error('角色卡不是有效的 JSON。'); }

  stage = 'repository';
  repo = resolve(repo);
  const paths = { characters: join(repo, 'engine/src/lib/dzmm-characters.ts'),
    context: join(repo, 'engine/src/lib/dzmm-character-context.ts'),
    prepare: join(repo, 'engine/src/lib/dzmm-context.ts'), chat: join(repo, 'engine/src/lib/dzmm-chat.ts') };
  for (const path of [join(repo, 'package.json'), ...Object.values(paths)]) {
    try { if (!(await stat(path)).isFile()) throw new Error(); }
    catch { throw new Error('项目目录不是可用的叙梦源码目录，缺少 package.json 或角色卡/上下文实现。'); }
  }
  let tsImport;
  try {
    const require = createRequire(pathToFileURL(join(repo, 'package.json')));
    const loader = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
    tsImport = loader.tsImport ?? loader.default?.tsImport;
    if (typeof tsImport !== 'function') throw new Error();
    // Register the same repository's CJS compatibility hook as well. Recent
    // Node releases otherwise use native type stripping for transitive imports,
    // which cannot load this application's extensionless imports and JSON data.
    // Actual module loading still goes through the repository's tsImport API.
    const cjsLoader = await import(pathToFileURL(require.resolve('tsx/cjs/api')).href);
    const registerCjs = cjsLoader.register ?? cjsLoader.default?.register;
    if (typeof registerCjs !== 'function') throw new Error();
    unregisterTypescript = registerCjs();
  } catch { throw new Error('项目缺少可用的 tsx 依赖，请先使用项目已有的依赖安装流程。'); }
  let modules;
  try {
    modules = await Promise.all(Object.values(paths).map(path => tsImport(pathToFileURL(path).href, import.meta.url)));
  } catch { throw new Error('无法加载项目的实际角色卡/提示词实现，请确认源码完整且项目依赖已安装。'); }
  const parseCharacterImport = exported(modules[0], 'parseCharacterImport');
  const getDzmmOpeningMessages = exported(modules[1], 'getDzmmOpeningMessages');
  const prepareDzmmRequest = exported(modules[2], 'prepareDzmmRequest');
  const buildDzmmPromptPlan = exported(modules[3], 'buildDzmmPromptPlan');
  const validateDzmmChatInput = exported(modules[3], 'validateDzmmChatInput');

  stage = 'import';
  const card = parseCharacterImport(raw);
  const source = supplied.spec === 'chara_card_v2' ? supplied.data : supplied;
  report.import = { ...report.import, valid: true,
    format: supplied.spec === 'chara_card_v2' ? 'SillyTavern-v2-JSON' : 'Xumeng-plain-JSON',
    fieldChars: Object.fromEntries(['name', 'author', 'description', 'personality', 'scenario', 'firstMessage',
      'systemPrompt', 'postHistoryInstructions', 'messageExamples', 'introduction']
      .map(field => [field, typeof card[field] === 'string' ? card[field].length : 0])),
    tags: card.tags.length, galleryImages: card.gallery?.length ?? 0,
    suggestedReplies: card.suggestedReplies?.length ?? 0,
    worldbookEntries: card.characterBook?.entries.length ?? 0,
  };

  // Advisory warnings: the importer remains the authority. These small lists
  // explain dropped fields/macros, rather than attempting another schema parser.
  const known = new Set(['name', 'author', 'cover', 'tags', 'description', 'personality', 'scenario',
    'firstMessage', 'first_mes', 'systemPrompt', 'system_prompt', 'postHistoryInstructions', 'post_history_instructions',
    'messageExamples', 'mes_example', 'alternateGreetings', 'alternate_greetings', 'openingMessages', 'opening_messages',
    'characterBook', 'character_book', 'introduction', 'gallery', 'suggestedReplies', 'creator_notes', 'creatorNotes', 'creator', 'character_version']);
  const ignored = Object.keys(source).filter(key => !known.has(key));
  if (ignored.length) warning('IGNORED_CARD_FIELDS', '存在导入器不保留的字段；SillyTavern 扩展、动态变量、存储元数据及脚本不会因此生效。', { count: ignored.length });
  if (Object.hasOwn(source, 'creator_notes')) warning('CREATOR_NOTES_DISPLAY_ONLY', '作者备注仅供展示，不会传给模型；重要设定应写入模型设定字段。');
  if (source.introduction !== undefined || source.gallery !== undefined || source.suggestedReplies !== undefined) {
    warning('DISPLAY_METADATA_NOT_PROMPT', '角色介绍、图库和建议回复用于界面展示，不直接加入模型提示词。');
  }
  const originalBook = source.characterBook ?? source.character_book;
  if (record(originalBook)) {
    const bookKnown = new Set(['name', 'description', 'scanDepth', 'scan_depth', 'entries']);
    const entryKnown = new Set(['id', 'name', 'comment', 'keys', 'secondaryKeys', 'secondary_keys', 'content',
      'enabled', 'constant', 'selective', 'caseSensitive', 'case_sensitive', 'insertionOrder', 'insertion_order', 'position']);
    const extras = Object.keys(originalBook).filter(key => !bookKnown.has(key)).length
      + (Array.isArray(originalBook.entries) ? originalBook.entries.reduce((total, entry) =>
        total + (record(entry) ? Object.keys(entry).filter(key => !entryKnown.has(key)).length : 0), 0) : 0);
    if (extras) warning('IGNORED_WORLDBOOK_FIELDS', '世界书含不支持的附加字段；正则、概率、递归、冷却或自定义插入位置不会生效。', { count: extras });
  }
  const macroTexts = collectText({ description: card.description, personality: card.personality, scenario: card.scenario,
    firstMessage: card.firstMessage, systemPrompt: card.systemPrompt, postHistoryInstructions: card.postHistoryInstructions,
    messageExamples: card.messageExamples, alternateGreetings: card.alternateGreetings,
    openingMessages: card.openingMessages, entries: card.characterBook?.entries.map(entry => ({ content: entry.content })) });
  let unsupportedMacroCount = 0;
  for (const value of macroTexts) {
    for (const match of value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      if (!/^(char|user|original)$/i.test(match[1].trim())) unsupportedMacroCount++;
    }
  }
  if (unsupportedMacroCount) warning('UNSUPPORTED_MACROS', '只有 {{char}}、{{user}}、{{original}} 会展开；未知宏保留字面，动态变量、日期、随机或条件表达式不会执行。', { count: unsupportedMacroCount });

  stage = 'authoring-readiness';
  const mainOpening = getDzmmOpeningMessages(card, 0);
  const assistantMainOpenings = mainOpening.filter(message => message.role === 'assistant' && message.content.trim()).length;
  const modelSettingFields = ['description', 'personality', 'scenario', 'systemPrompt']
    .filter(field => typeof card[field] === 'string' && card[field].trim()).length;
  report.authoring = { ready: Boolean(assistantMainOpenings && modelSettingFields),
    mainOpeningMessages: mainOpening.length, assistantMainOpenings,
    alternateOpenings: card.alternateGreetings?.length ?? 0, nonemptyModelSettingFields: modelSettingFields };
  if (!report.authoring.ready) {
    const errors = [];
    if (!assistantMainOpenings) errors.push('主开场至少需要一条非空 assistant 角色消息。');
    if (!modelSettingFields) errors.push('详细描述、性格、场景或系统指令至少填写一项。');
    report.authoring.errors = errors;
    throw new Error('角色卡已经可以导入，但尚未达到试聊所需的创作完整度。');
  }

  stage = 'prompt-assembly';
  // A fixed reference instant makes local diagnostics reproducible. In story mode
  // it is only a server-clock reference, not an invented in-story calendar anchor.
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const samples = Array.from({ length: 1 + (card.alternateGreetings?.length ?? 0) }, (_, index) => index);
  for (const openingIndex of samples) {
    try {
      const opening = getDzmmOpeningMessages(card, openingIndex);
      const messages = [...opening, { role: 'user', content: '我先听你说。' }];
      const prepared = prepareDzmmRequest(card, messages, undefined, undefined, 'balanced', 2048,
        { userName: '访客', world: { clockMode: 'story' } });
      const plan = buildDzmmPromptPlan(validateDzmmChatInput(prepared), now);
      report.promptAssembly.samples.push({ openingIndex, valid: true, openingMessages: opening.length,
        providerMessages: plan.messages.length,
        promptChars: plan.messages.reduce((total, message) => total + message.content.length, 0),
        promptUtf8Bytes: new TextEncoder().encode(JSON.stringify(plan.messages)).byteLength,
        diagnostics: plan.diagnostics });
    } catch (error) {
      report.promptAssembly.samples.push({ openingIndex, valid: false, error: parserError(error) });
    }
  }
  report.promptAssembly.valid = report.promptAssembly.samples.every(sample => sample.valid);
  report.ok = report.import.valid && report.authoring.ready && report.promptAssembly.valid;
  if (!report.ok) throw new Error('角色卡可导入，但至少一个开场的实际提示词组装失败，详见样本诊断。');
  report.stage = 'completed';
} catch (error) {
  report.stage = stage;
  report.error = parserError(error);
  process.exitCode = 1;
}
if (typeof unregisterTypescript === 'function') unregisterTypescript();
print();
