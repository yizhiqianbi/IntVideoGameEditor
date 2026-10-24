import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import gamesModule from "./xumeng-games";
const { buildXumengGamePreview, createXumengGameDraft, decodeXumengGameFile, exportXumengGameBackup, importXumengGameArchive, parseXumengGameDraft, parseXumengGameImport,
  parseXumengGameDetail, parseXumengGameList, XUMENG_GAME_INLINE_BYTES, XUMENG_GAME_MAX_SOURCE_BYTES, XUMENG_GAME_TEMPLATES } = gamesModule as typeof import("./xumeng-games");

test("HTML and backup import preserve source exactly and use independent draft identities", () => {
  const draft = { ...createXumengGameDraft("story", () => "original"), title: " 未完成的游戏 ", synopsis: "简介\n🌊", source: " <h1>海港</h1>\n<script>let a = 1;</script>\t " };
  const imported = parseXumengGameImport(exportXumengGameBackup(draft), "json", "", () => "copy");
  assert.deepEqual(imported, { ...draft, id: "copy" });
  assert.equal(parseXumengGameImport(draft.source, "html", "我的游戏.html", () => "html-copy").source, draft.source);
  assert.equal(parseXumengGameImport(draft.source, "html", "我的游戏.html", () => "html-copy").title, "我的游戏");
  assert.throws(() => parseXumengGameImport(exportXumengGameBackup(draft), "json", "", () => "original"), /独立/);
  assert.equal(JSON.parse(exportXumengGameBackup({ ...draft, title: "" })).game.title, "");
  assert.throws(() => parseXumengGameDraft({ ...draft, title: "" }), /名称/);
});
test("byte limits and strict decoding reject malformed source and unknown private fields without truncation", () => {
  const draft = createXumengGameDraft("blank", () => "blank");
  assert.throws(() => parseXumengGameDraft({ ...draft, source: "中".repeat(Math.ceil(XUMENG_GAME_MAX_SOURCE_BYTES / 3)) }), /8 MB/);
  assert.equal(parseXumengGameDraft({ ...draft, source: "x".repeat(XUMENG_GAME_INLINE_BYTES + 1) }).source.length, XUMENG_GAME_INLINE_BYTES + 1);
  assert.throws(() => parseXumengGameDraft({ ...draft, source: "x\0y" }));
  assert.throws(() => parseXumengGameDraft({ ...draft, secret: "unsupported" }));
  assert.throws(() => decodeXumengGameFile(Uint8Array.of(0xc3, 0x28).buffer), /UTF-8/);
  const bytes = new TextEncoder().encode("源码🌊"); assert.equal(decodeXumengGameFile(bytes.buffer), "源码🌊");
  assert.equal(parseXumengGameDraft({ ...draft, source: "x".repeat(XUMENG_GAME_MAX_SOURCE_BYTES) }).source.length, XUMENG_GAME_MAX_SOURCE_BYTES);
});
test("detail/list parsing verifies identity, version, identifiers and summary sizes", () => {
  const draft = createXumengGameDraft("blank", () => "work"), game = { ...draft, version: 1, createdAt: 0, updatedAt: 1 };
  assert.deepEqual(parseXumengGameDetail({ accountId: "author", game }, "author").game, game);
  assert.throws(() => parseXumengGameDetail({ accountId: "other", game }, "author"), /账号/);
  const { source: _source, ...summary } = game;
  const list = { accountId: "author", games: [{ ...summary, sourceBytes: 100 }] };
  assert.deepEqual(parseXumengGameList(list, "author"), list);
  assert.throws(() => parseXumengGameList({ ...list, games: [list.games[0], list.games[0]] }, "author"), /重复/);
  assert.throws(() => parseXumengGameList({ ...list, games: [{ ...list.games[0], sourceBytes: XUMENG_GAME_MAX_SOURCE_BYTES + 1 }] }, "author"), /大小/);
});
test("preview prepends restrictive CSP without sharing parent credentials or introducing a site bridge", () => {
  const source = '<meta http-equiv="Content-Security-Policy" content="default-src *"><script src="https://hostile.example.test/script.js"></script>';
  const output = buildXumengGamePreview(source);
  assert.ok(output.indexOf("default-src 'none'") < output.indexOf("default-src *"));
  for (const directive of ["connect-src 'none'", "frame-src 'none'", "worker-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(output.includes(directive));
  assert.ok(output.endsWith(`${source}</body></html>`));
  assert.ok(!output.includes("allow-same-origin")); assert.ok(!output.includes("accountId"));
  const page = "<!doctype html><html><head><title>港</title></head><body><h1>灯</h1></body></html>";
  const document = buildXumengGamePreview(page);
  assert.ok(document.startsWith("<!doctype html><html><head>"));
  assert.ok(document.includes("connect-src 'none'"));
  assert.ok(document.includes("<body><h1>灯</h1></body></html>"));
  assert.equal(document.includes("<body><!doctype"), false);
});

function storeZip(entries: { name: string; data: Uint8Array; method?: number; original?: number }[]) {
  const locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name), data = entry.data;
    const local = new Uint8Array(30 + name.length + data.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(8, entry.method ?? 0, true);
    view.setUint32(18, data.length, true); view.setUint32(22, entry.original ?? data.length, true);
    view.setUint16(26, name.length, true); local.set(name, 30); local.set(data, 30 + name.length);
    const header = new Uint8Array(46 + name.length), directory = new DataView(header.buffer);
    directory.setUint32(0, 0x02014b50, true); directory.setUint16(4, 20, true); directory.setUint16(6, 20, true);
    directory.setUint16(10, entry.method ?? 0, true); directory.setUint32(20, data.length, true); directory.setUint32(24, entry.original ?? data.length, true);
    directory.setUint16(28, name.length, true); directory.setUint32(42, offset, true); header.set(name, 46);
    locals.push(local); central.push(header); offset += local.length;
  }
  const directory = new Uint8Array(central.reduce((sum, item) => sum + item.length, 0));
  let cursor = 0; for (const item of central) { directory.set(item, cursor); cursor += item.length; }
  const end = new Uint8Array(22), tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true); tail.setUint16(8, entries.length, true); tail.setUint16(10, entries.length, true);
  tail.setUint32(12, directory.length, true); tail.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directory.length + end.length);
  cursor = 0; for (const item of locals) { output.set(item, cursor); cursor += item.length; }
  output.set(directory, cursor); output.set(end, cursor + directory.length); return output;
}
test("zip import inlines html, css, script and image into one playable document", async () => {
  const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1);
  const css = new TextEncoder().encode("body{background:url(art.png)}");
  const compressed = new Uint8Array(await new Response(new Blob([css]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const html = new TextEncoder().encode("<!doctype html><html><head><link rel=\"stylesheet\" href=\"style.css\"></head><body><img src=\"./art.png\"><script src=\"play/game.js\"></script></body></html>");
  const script = new TextEncoder().encode("document.body.dataset.ready='yes'");
  const zip = storeZip([
    { name: "index.html", data: html },
    { name: "style.css", data: compressed, method: 8, original: css.length },
    { name: "art.png", data: png },
    { name: "play/game.js", data: script },
    { name: "../secret.html", data: new TextEncoder().encode("<h1>no</h1>") },
  ]);
  const imported = await importXumengGameArchive(zip, "雾港.zip", () => "zip-game");
  assert.equal(imported.title, "雾港");
  assert.equal(imported.source.includes("data:image/png;base64,"), true);
  assert.equal(imported.source.includes("background:url(\"data:image/png;base64,"), true);
  assert.equal(imported.source.includes("document.body.dataset.ready='yes'"), true);
  assert.equal(imported.source.includes("../secret"), false);
  assert.equal(imported.source.includes("src=\"style.css\""), false);
});

// Unit playtest of the original templates' deterministic branching and restart
// loop. This does not replace the root's actual sandbox/browser acceptance.
function dom() {
  const elements = new Map<string, { textContent: string; children: any[]; onclick?: () => void; attributes: Record<string,string>; replaceChildren: () => void; append: (element: any) => void; setAttribute: (name: string, value: string) => void }>();
  const create = () => ({ textContent: "", children: [] as any[], attributes: {} as Record<string,string>, replaceChildren() { this.children = []; }, append(element: any) { this.children.push(element); }, setAttribute(name: string,value: string) { this.attributes[name] = value; } });
  return { elements, document: { querySelector(selector: string) { if (!elements.has(selector)) elements.set(selector, create()); return elements.get(selector)!; }, createElement() { return create(); } } };
}
test("original story template has two distinct choices, two endings and a working restart loop", () => {
  const { elements, document } = dom(); const source = XUMENG_GAME_TEMPLATES[0].source;
  vm.runInNewContext(source.match(/<script>([\s\S]*?)<\/script>/)![1], { document });
  assert.equal(elements.get("#title")!.textContent, "雨夜邮局"); assert.equal(elements.get("#choices")!.children.length, 2);
  elements.get("#choices")!.children[0].onclick(); assert.equal(elements.get("#title")!.textContent, "旧日坐标");
  elements.get("#choices")!.children[0].onclick(); assert.equal(elements.get("#title")!.textContent, "海上的回应");
  elements.get("#choices")!.children[0].onclick(); assert.equal(elements.get("#title")!.textContent, "雨夜邮局");
  elements.get("#choices")!.children[1].onclick(); elements.get("#choices")!.children[1].onclick();
  assert.equal(elements.get("#title")!.textContent, "新的航线");
});
test("original puzzle template completes its objective in two moves and restarts the loop", () => {
  const { elements, document } = dom(); const source = XUMENG_GAME_TEMPLATES[1].source;
  vm.runInNewContext(source.match(/<script>([\s\S]*?)<\/script>/)![1], { document });
  assert.equal(elements.get("#status")!.textContent, "已操作 0 / 6 步。");
  elements.get("#lamps")!.children[0].onclick(); elements.get("#lamps")!.children[2].onclick();
  assert.equal(elements.get("#status")!.textContent, "航道信号已恢复！你用了 2 步。");
  elements.get("#restart")!.onclick!(); assert.equal(elements.get("#status")!.textContent, "已操作 0 / 6 步。");
  for (let index = 0; index < 6; index++) elements.get("#lamps")!.children[0].onclick();
  assert.equal(elements.get("#status")!.textContent, "信号恢复失败。点击重新开始再试一次。");
  elements.get("#restart")!.onclick!(); assert.equal(elements.get("#status")!.textContent, "已操作 0 / 6 步。");
});
