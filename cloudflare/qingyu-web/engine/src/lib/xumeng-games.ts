export const XUMENG_GAME_INLINE_BYTES = 256 * 1024;
export const XUMENG_GAME_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
// Ordinary HTML and ZIP packages fit this request envelope. A source made only of
// characters that JSON must escape can still be rejected before the 8 MB cap.
export const XUMENG_GAME_MAX_BODY_BYTES = 16 * 1024 * 1024;
export const XUMENG_GAME_MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export const XUMENG_GAME_MAX_PACKAGE_BYTES = 12 * 1024 * 1024;
export const XUMENG_GAME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

export type XumengGameDraft = { id: string; title: string; synopsis: string; source: string };
export type XumengGame = XumengGameDraft & { version: number; createdAt: number; updatedAt: number };
export type XumengGameSummary = Omit<XumengGame, "source"> & { sourceBytes: number };
export type XumengGameDetail = { accountId: string; game: XumengGame };
export type XumengGameList = { accountId: string; games: XumengGameSummary[] };

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export const xumengGameBytes = (value: string): number => new TextEncoder().encode(value).byteLength;
function text(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== "string" || value.includes("\0") || value.length > max || (required && !value.trim())) throw new Error(`${name}无效${required ? "，请填写后再保存" : ""}。`);
  return value;
}
export function parseXumengGameId(value: unknown): string {
  if (typeof value !== "string" || !XUMENG_GAME_ID.test(value)) throw new Error("游戏编号无效。");
  return value;
}
export function parseXumengGameDraft(value: unknown, requireTitle = true): XumengGameDraft {
  if (!object(value) || Object.keys(value).some(key => !["id", "title", "synopsis", "source"].includes(key))) throw new Error("游戏文件格式无效。");
  const source = text(value.source, "游戏源码", XUMENG_GAME_MAX_SOURCE_BYTES);
  if (xumengGameBytes(source) > XUMENG_GAME_MAX_SOURCE_BYTES) throw new Error("游戏源码超过 8 MB，请减少内容后重试。");
  return { id: parseXumengGameId(value.id), title: text(value.title, "游戏名称", 120, requireTitle), synopsis: text(value.synopsis, "游戏简介", 4000), source };
}
function number(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error("游戏版本或时间无效。");
  return value;
}
export function parseXumengGameDetail(value: unknown, accountId: string): XumengGameDetail {
  if (!object(value) || value.accountId !== accountId || !object(value.game)) throw new Error("游戏所属账号无效，请重新加载。");
  const { version, createdAt, updatedAt, ...draft } = value.game;
  return { accountId, game: { ...parseXumengGameDraft(draft), version: number(version, 1), createdAt: number(createdAt, 0), updatedAt: number(updatedAt, 0) } };
}
export function parseXumengGameList(value: unknown, accountId: string): XumengGameList {
  if (!object(value) || value.accountId !== accountId || !Array.isArray(value.games)) throw new Error("游戏列表所属账号无效，请重新加载。");
  const ids = new Set<string>();
  return { accountId, games: value.games.map(item => {
    if (!object(item)) throw new Error("游戏列表格式无效。");
    const id = parseXumengGameId(item.id);
    if (ids.has(id)) throw new Error("游戏列表出现重复编号。");
    ids.add(id);
    const sourceBytes = number(item.sourceBytes, 0);
    if (sourceBytes > XUMENG_GAME_MAX_SOURCE_BYTES) throw new Error("游戏大小无效。");
    return { id, title: text(item.title, "游戏名称", 120, true), synopsis: text(item.synopsis, "游戏简介", 4000), sourceBytes,
      version: number(item.version, 1), createdAt: number(item.createdAt, 0), updatedAt: number(item.updatedAt, 0) };
  }) };
}
export function xumengGameDraftFromDetail(detail: XumengGameDetail): XumengGameDraft {
  const { id, title, synopsis, source } = detail.game;
  return { id, title, synopsis, source };
}
export function exportXumengGameBackup(draft: XumengGameDraft): string {
  return JSON.stringify({ schema: "qingyu-game", version: 1, game: parseXumengGameDraft(draft, false) }, null, 2);
}
export function parseXumengGameImport(content: string, format: "html" | "json", filename = "", createId = () => crypto.randomUUID()): XumengGameDraft {
  if (xumengGameBytes(content) > (format === "html" ? XUMENG_GAME_MAX_SOURCE_BYTES : XUMENG_GAME_MAX_BACKUP_BYTES)) throw new Error("导入文件过大。HTML 最多 8 MB，备份最多 16 MB。");
  if (content.includes("\0")) throw new Error("文件包含无效字符，请使用 UTF-8 文本。");
  if (format === "html") return parseXumengGameDraft({ id: createId(), title: filename.replace(/\.html?$/i, "").slice(0, 120) || "导入的游戏", synopsis: "", source: content });
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("备份应为有效的 JSON 文件。"); }
  if (!object(value) || value.schema !== "qingyu-game" || value.version !== 1 || Object.keys(value).some(key => !["schema", "version", "game"].includes(key))) throw new Error("这不是晴屿游戏备份。");
  const draft = parseXumengGameDraft(value.game, false);
  const id = createId();
  if (id === draft.id) throw new Error("导入副本必须使用独立编号。");
  return { ...draft, id: parseXumengGameId(id) };
}

const ARCHIVE_MIME: Record<string, string> = {
  css: "text/css", gif: "image/gif", htm: "text/html", html: "text/html", jpeg: "image/jpeg", jpg: "image/jpeg",
  js: "text/javascript", mp3: "audio/mpeg", ogg: "audio/ogg", png: "image/png", svg: "image/svg+xml",
  wav: "audio/wav", webp: "image/webp", woff: "font/woff", woff2: "font/woff2",
};
const ARCHIVE_EMBEDDED = new Set(["gif", "jpeg", "jpg", "mp3", "ogg", "png", "svg", "wav", "webp", "woff", "woff2"]);

function archivePath(baseFile: string, reference: string) {
  const clean = reference.trim().split(/[?#]/, 1)[0] ?? "";
  if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(clean)) return "";
  const directory = baseFile.includes("/") ? baseFile.slice(0, baseFile.lastIndexOf("/") + 1) : "";
  const stack: string[] = [];
  for (const part of `${directory}${clean}`.split("/")) {
    if (part === "..") { if (!stack.length) return ""; stack.pop(); }
    else if (part && part !== ".") stack.push(part);
  }
  return stack.join("/");
}
function archiveFile(files: Map<string, Uint8Array>, path: string) {
  return files.get(path) ?? [...files].find(([name]) => name.toLowerCase() === path.toLowerCase())?.[1];
}
function dataUri(bytes: Uint8Array, mime: string) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
function embeddedAsset(files: Map<string, Uint8Array>, baseFile: string, reference: string) {
  const path = archivePath(baseFile, reference);
  const bytes = path ? archiveFile(files, path) : undefined;
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return bytes && ARCHIVE_EMBEDDED.has(extension) ? dataUri(bytes, ARCHIVE_MIME[extension]!) : "";
}
function rewriteCssUrls(css: string, cssPath: string, files: Map<string, Uint8Array>) {
  return css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, _quote: string, target: string) => {
    const uri = embeddedAsset(files, cssPath, target);
    return uri ? `url("${uri}")` : match;
  }).replace(/<\/style/gi, "<\\/style");
}
function inlineArchiveDocument(entry: string, files: Map<string, Uint8Array>) {
  const source = archiveFile(files, entry);
  if (!source) throw new Error("压缩包里没有可玩的 HTML。");
  const html = new TextDecoder().decode(source)
    .replace(/<link\b([^>]*?)href=(["'])(.*?)\2([^>]*)>/gi, (match, before: string, _quote: string, reference: string, after: string) => {
      const path = archivePath(entry, reference);
      const bytes = path && /\.css(?:$|[?#])/i.test(reference) ? archiveFile(files, path) : undefined;
      if (!bytes || !(/\brel\s*=\s*(["']?)stylesheet\1/i.test(`${before}${after}`) || /\.css(?:$|[?#])/i.test(reference))) return match;
      return `<style>${rewriteCssUrls(new TextDecoder().decode(bytes), path, files)}</style>`;
    })
    .replace(/<script\b([^>]*?)src=(["'])(.*?)\2([^>]*)>\s*<\/script>/gi, (match, _before: string, _quote: string, reference: string) => {
      const path = archivePath(entry, reference);
      const bytes = path && /\.js(?:$|[?#])/i.test(path) ? archiveFile(files, path) : undefined;
      return bytes ? `<script>${new TextDecoder().decode(bytes).replace(/<\/script/gi, "<\\/script")}</script>` : match;
    })
    .replace(/\b(src|href)=(["'])(.*?)\2/gi, (match, attribute: string, quote: string, reference: string) => {
      const uri = embeddedAsset(files, entry, reference);
      return uri ? `${attribute}=${quote}${uri}${quote}` : match;
    })
    .replace(/<style>([\s\S]*?)<\/style>/gi, (_match, css: string) => `<style>${rewriteCssUrls(css, entry, files)}</style>`);
  if (xumengGameBytes(html) > XUMENG_GAME_MAX_SOURCE_BYTES) throw new Error("打包后的游戏超过 8 MB。请减少图片或音频后再导入。");
  return html;
}
async function inflateRaw(bytes: Uint8Array) {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Uint8Array(await new Response(new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
}
export async function importXumengGameArchive(bytes: Uint8Array, filename: string, createId: () => string = () => crypto.randomUUID()): Promise<XumengGameDraft> {
  if (bytes.byteLength > XUMENG_GAME_MAX_PACKAGE_BYTES) throw new Error("压缩包超过 12 MB。");
  const files = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0, total = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true), method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true), original = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength, end = start + compressed;
    if ((flags & 0x1) || (flags & 0x8) || compressed === 0xffffffff || end > bytes.length) throw new Error("这个压缩包无法导入。请使用未加密的普通 ZIP。");
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength)).replaceAll("\\", "/");
    offset = end;
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    if (!name || name.endsWith("/") || name.split("/").includes("..") || name.startsWith("/") || !ARCHIVE_MIME[extension]) continue;
    if (files.size >= 200) throw new Error("压缩包里的文件过多。");
    const payload = bytes.subarray(start, end);
    const content = compressed === 0 ? new Uint8Array() : method === 0 ? payload : method === 8 ? await inflateRaw(payload) : null;
    if (!content || (original && content.byteLength !== original)) throw new Error("压缩包里的文件无法解压。");
    total += content.byteLength;
    if (total > XUMENG_GAME_MAX_SOURCE_BYTES) throw new Error("解压后的游戏超过 8 MB。");
    files.set(name, content);
  }
  if (!files.size) throw new Error("压缩包里没有可导入的文件。");
  const pages = [...files.keys()].filter(name => /\.html?$/i.test(name));
  const entry = pages.find(name => /(^|\/)index\.html?$/i.test(name)) ?? (pages.length === 1 ? pages[0] : "");
  if (!entry) throw new Error("压缩包里需要一个 index.html。");
  return parseXumengGameDraft({ id: createId(), title: filename.replace(/\.zip$/i, "").trim().slice(0, 120) || "导入的游戏", synopsis: "从网页游戏压缩包导入。", source: inlineArchiveDocument(entry, files) });
}
export function decodeXumengGameFile(buffer: ArrayBuffer): string {
  if (buffer.byteLength > XUMENG_GAME_MAX_BACKUP_BYTES) throw new Error("导入文件过大。");
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer); } catch { throw new Error("请导入 UTF-8 编码的 HTML 或晴屿 JSON 备份。"); }
}

// A first, restrictive policy remains effective even when imported HTML adds
// its own meta policy. The iframe must also use sandbox="allow-scripts" and
// never allow-same-origin. No postMessage bridge or site credentials are sent.
export const XUMENG_GAME_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; media-src data: blob: https:; connect-src 'none'; font-src data: https:; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
export function buildXumengGamePreview(source: string): string {
  parseXumengGameDraft({ id: "preview", title: "预览", synopsis: "", source });
  const policy = `<meta http-equiv="Content-Security-Policy" content="${XUMENG_GAME_PREVIEW_CSP}"><meta name="referrer" content="no-referrer">`;
  if (/^\s*<!doctype\s+html/i.test(source) || /^\s*<html[\s>]/i.test(source)) {
    if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, match => `${match}${policy}`);
    return source.replace(/<html[^>]*>/i, match => `${match}<head>${policy}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${policy}<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${source}</body></html>`;
}

const templateHead = (title: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#faf6fa;color:#574657;font:16px/1.8 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}main{max-width:580px;padding:30px}h1{font-size:28px;line-height:1.3}button{background:#a17e97;color:white;border:0;padding:12px 20px;border-radius:8px;margin:8px 8px 8px 0;cursor:pointer;font:inherit}small{color:#806d7b}#choices{margin-top:25px}</style></head><body>`;
const story = `${templateHead("雾港来信")}<main><small>原创分支故事 · 雾港来信</small><h1 id="title"></h1><p id="story"></p><div id="choices"></div></main><script>
const scenes={start:{title:'雨夜邮局',text:'最后一班渡船即将离港。桌上有一封没有署名的来信，窗外的灯塔熄灭了。你有十分钟作出决定。',choices:[['拆开来信','letter'],['先去灯塔','tower']]},letter:{title:'旧日坐标',text:'信中是一张航海图，背面写着：先点亮灯塔，船才能找到回来的路。你带着图跑向岸边。',choices:[['寻找备用灯油','oil'],['借渡船的信号灯','signal']]},tower:{title:'灯塔楼梯',text:'守塔人正在寻找失踪的灯芯。你发现窗台上留着一行坐标，邮局也许有答案。',choices:[['回邮局取信','letter'],['用手电发出信号','signal']]},oil:{title:'海上的回应',text:'仓库里还留着半瓶灯油。灯塔重新亮起，远处传来三声汽笛。你把航海图交给守塔人，一起等待归来的船。',choices:[['重新开始','start']]},signal:{title:'新的航线',text:'渡船船长愿意帮忙。两盏信号灯轮流闪烁，失散的船终于找到了航道。你留在码头，听船上的旅人讲述风暴。',choices:[['重新开始','start']]}};
function show(id){const scene=scenes[id];document.querySelector('#title').textContent=scene.title;document.querySelector('#story').textContent=scene.text;const choices=document.querySelector('#choices');choices.replaceChildren();for(const [label,next]of scene.choices){const button=document.createElement('button');button.textContent=label;button.onclick=()=>show(next);choices.append(button)}}show('start');
</script></body></html>`;
const puzzle = `${templateHead("灯塔密码")}<main><small>原创轻量小游戏 · 灯塔密码</small><h1>点亮三盏灯</h1><p>每次点击会切换这盏灯及相邻的灯。六步内让三盏灯同时亮起，恢复航道信号。</p><div id="lamps"></div><p id="status"></p><button id="restart">重新开始</button></main><script>
let lights=[false,true,false],moves=0;function render(){const root=document.querySelector('#lamps');root.replaceChildren();lights.forEach((on,index)=>{const button=document.createElement('button');button.textContent=(on?'● 亮灯 ':'○ 熄灯 ')+(index+1);button.setAttribute('aria-pressed',String(on));button.onclick=()=>{if(lights.every(Boolean)||moves>=6)return;for(let next=Math.max(0,index-1);next<=Math.min(2,index+1);next++)lights[next]=!lights[next];moves++;render()};root.append(button)});document.querySelector('#status').textContent=lights.every(Boolean)?'航道信号已恢复！你用了 '+moves+' 步。':moves>=6?'信号恢复失败。点击重新开始再试一次。':'已操作 '+moves+' / 6 步。'}document.querySelector('#restart').onclick=()=>{lights=[false,true,false];moves=0;render()};render();
</script></body></html>`;
export const XUMENG_GAME_TEMPLATES = [
  { id: "story", title: "分支故事", description: "两条选择，两个结局，可修改场景与选项。", gameTitle: "雾港来信", source: story },
  { id: "puzzle", title: "轻量小游戏", description: "点亮灯塔信号，包含胜利反馈和重新开始。", gameTitle: "灯塔密码", source: puzzle },
] as const;
export function createXumengGameDraft(template: "story" | "puzzle" | "blank" = "story", createId = () => crypto.randomUUID()): XumengGameDraft {
  const selected = XUMENG_GAME_TEMPLATES.find(item => item.id === template);
  return { id: createId(), title: selected?.gameTitle ?? "新游戏", synopsis: "", source: selected?.source ?? `${templateHead("新游戏")}<main><h1>我的游戏</h1><p>从这里开始。</p></main></body></html>` };
}
