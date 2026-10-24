/** Isolated real-component acceptance. Every application fetch is intercepted. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import NovelStudio from "../../../../src/components/dzmm/novel-studio";
import { countDzmmNovelWords, createDzmmNovelDraft, parseDzmmNovelDraft, type DzmmNovelDetail } from "../../../../src/lib/dzmm-novels";

const STORE_KEY = "qa-novel-flow-server-v1";
type Database = Record<string, DzmmNovelDetail[]>;
function seed(): Database {
  const draft = { ...createDzmmNovelDraft(), id: "qa-work-one", title: "原创 · 雾港航标", synopsis: "一位修理员寻找熄灭航标的原因。", tags: ["悬疑"], notes: "第三人称，线索有明确因果。", outline: "来港、调查、修复。", chapters: [{ id: "qa-chapter-one", title: "熄灯", content: "雾落下来时，港口的航标熄灭了。\n\n修理员林遥把工具箱放在台阶上。" }] };
  const { chapters, ...work } = draft;
  return { "qa-novel-a": [{ accountId: "qa-novel-a", work: { ...work, version: 1, createdAt: 1, updatedAt: 1 }, chapters: chapters.map((chapter, position) => ({ ...chapter, workId: work.id, position, version: 1, createdAt: 1, updatedAt: 1 })) }], "qa-novel-b": [] };
}
function database(): Database { try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") ?? seed(); } catch { return seed(); } }
let db = database();
let accountId = "qa-novel-a", failSave = false, conflictNext = false, holdSave = false, holdList = false;
let delayed: (() => void) | null = null;
let delayedList: ((fail?: boolean) => void) | null = null;
let generationMode: "normal" | "partial-failure" | "json-error" | "oversize" = "normal";
const counts = { requests: 0, saves: 0, generations: 0, blocked: 0 };
const controls = createRoot(document.getElementById("fixture-controls")!);
function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
function resetOwnedData() {
  const accounts = ["qa-novel-a", "qa-novel-b"];
  for (const key of Object.keys(localStorage)) {
    if (key === STORE_KEY || accounts.some(account => key === `qingyu-novel-recovery:${account}`
      || key.startsWith(`qingyu-novel-recovery-v2:${account}:`)
      || key.startsWith(`qingyu-novel-recovery-dismissed:qingyu-novel-recovery-v2:${account}:`)
      || key.startsWith(`qingyu-novel-recovery-dismissed-legacy:${account}:`))) localStorage.removeItem(key);
  }
  window.location.reload();
}
let switchAccount = (_id: string) => { void _id; };
let observedDirty = false, observedBusy = false;
function renderControls(dirty = observedDirty, busy = observedBusy) {
  observedDirty = dirty; observedBusy = busy;
  controls.render(<section className="fixture-panel" aria-label="小说本地隔离验收控制台"><h1>小说私人工作台 · 本地隔离验收</h1><p>真实 NovelStudio；原创测试稿、模拟云端和模拟 AI。未知请求全部拒绝，不访问生产或真实模型。</p><div><button type="button" onClick={() => { accountId = accountId === "qa-novel-a" ? "qa-novel-b" : "qa-novel-a"; switchAccount(accountId); renderControls(); }}>切换测试账号 A / B</button><button type="button" onClick={() => { failSave = !failSave; renderControls(dirty, busy); }}>{failSave ? "恢复保存服务" : "模拟保存失败"}</button><button type="button" onClick={() => { conflictNext = true; renderControls(dirty, busy); }}>下次保存模拟冲突</button><button type="button" onClick={() => { holdSave = true; renderControls(dirty, busy); }}>下次保存提交后挂起响应</button><button type="button" onClick={() => { delayed?.(); delayed = null; renderControls(dirty, busy); }}>释放挂起保存响应</button><button type="button" onClick={() => { holdList = true; renderControls(dirty, busy); }}>下次列表读取挂起</button><button type="button" onClick={() => { delayedList?.(); delayedList = null; renderControls(dirty, busy); }}>释放挂起列表响应</button><button type="button" onClick={() => { delayedList?.(true); delayedList = null; renderControls(dirty, busy); }}>释放挂起列表为失败</button><label>模拟 AI 响应<select aria-label="模拟 AI 响应" value={generationMode} onChange={event => { generationMode = event.target.value as typeof generationMode; renderControls(); }}><option value="normal">正常流式</option><option value="partial-failure">首段后中断</option><option value="json-error">JSON 错误响应</option><option value="oversize">超长预览</option></select></label><button type="button" onClick={resetOwnedData}>重置原创测试稿</button></div><pre role="status">{JSON.stringify({ accountId, generationMode, dirty, busy, failSave, conflictNext, holdSave, responsePending: Boolean(delayed), listResponsePending: Boolean(delayedList), holdList, counts, worksA: db["qa-novel-a"].map(item => ({ title: item.work.title, version: item.work.version, chapters: item.chapters.length })), worksB: db["qa-novel-b"].map(item => ({ title: item.work.title, version: item.work.version, chapters: item.chapters.length })) }, null, 2)}</pre></section>);
}
function json(value: unknown, status = 200) { return Response.json(value, { status }); }
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const req = input instanceof Request ? input : null, url = new URL(req?.url ?? String(input), window.location.origin);
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase(), signal = init?.signal ?? req?.signal;
  signal?.throwIfAborted(); counts.requests++;
  if (url.origin === window.location.origin && url.pathname === "/api/novel-generation" && method === "POST") {
    counts.generations++; const body = JSON.parse(String(init?.body));
    const responseMode = generationMode;
    if (responseMode === "json-error") { renderControls(); return json({ error: "模拟供应商 JSON 错误" }); }
    const pieces = body.operation === "outline" ? ["世界观：雾港的航标需要每晚校准。\n", "角色：修理员林遥寻找故障原因。\n", "第一章：熄灯；第二章：旧线路；第三章：重新点亮。"] : ["林遥蹲下来，检查航标底座。\n\n", "一道细小的刻痕沿着铜盖延伸，", "她把手电移近，发现刻痕旁还有昨晚留下的编号。"];
    if (responseMode === "oversize") pieces.splice(0, pieces.length, "原创超长预览。".repeat(8000));
    renderControls(); let timer: ReturnType<typeof setTimeout>, index = 0, stopped = false;
    return new Response(new ReadableStream({ start(stream) { const abort = () => { if (!stopped) { stopped = true; clearTimeout(timer); stream.error(new DOMException("Aborted", "AbortError")); } }; signal?.addEventListener("abort", abort, { once: true });
      const next = () => { if (stopped) return; if (responseMode === "partial-failure" && index === 1) { stopped = true; signal?.removeEventListener("abort", abort); stream.error(new Error("模拟流式连接中断，已收到内容可保留。")); return; } if (index < pieces.length) { stream.enqueue(new TextEncoder().encode(pieces[index++])); timer = setTimeout(next, 550); } else { stopped = true; signal?.removeEventListener("abort", abort); stream.close(); } }; timer = setTimeout(next, 250); }, cancel() { stopped = true; clearTimeout(timer); } }), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const match = /^\/api\/backend\/v1\/novels(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match || url.origin !== window.location.origin) { counts.blocked++; throw new Error("本地验收拒绝未知请求。"); }
  // Every tab talks to the same mock database, just as cloud saves do. Keep
  // held responses captured below, while fresh reads see another tab's save.
  db = database();
  const owner = accountId, works = db[owner], workId = match[1] ? decodeURIComponent(match[1]) : null;
  const old = works.find(item => item.work.id === workId);
  if (method === "GET") {
    if (!workId && holdList) {
      holdList = false;
      const value = { accountId: owner, works: works.map(item => ({ ...item.work, chapterCount: item.chapters.length, wordCount: item.chapters.reduce((sum, chapter) => sum + countDzmmNovelWords(chapter.content), 0) })) };
      return new Promise<Response>(resolve => {
        // Deliver the captured old-account response even after cancellation, to
        // exercise stale completions rather than an ideal fetch abort alone.
        delayedList = fail => resolve(fail ? json({ accountId: owner, error: "模拟已保存后的列表读取失败。" }, 503) : json(value)); renderControls();
      });
    }
    renderControls();
    return workId ? old ? json(old) : json({ accountId: owner, error: "作品不存在。" }, 404)
      : json({ accountId: owner, works: works.map(item => ({ ...item.work, chapterCount: item.chapters.length, wordCount: item.chapters.reduce((sum, chapter) => sum + countDzmmNovelWords(chapter.content), 0) })) });
  }
  const body = JSON.parse(String(init?.body));
  if (body.accountId !== owner) return json({ accountId: owner, error: "账号已切换。" }, 401);
  if (failSave) return json({ accountId: owner, error: "模拟保存失败，正文已保留。" }, 503);
  if (method === "DELETE") {
    if (!old) return json({ accountId: owner, error: "作品不存在。" }, 404);
    if (old.work.version !== body.version) return json({ accountId: owner, error: "云端版本已改变。", current: old }, 409);
    db[owner] = works.filter(item => item.work.id !== workId); persist(); renderControls(); return json({ accountId: owner, deleted: true });
  }
  const draft = parseDzmmNovelDraft(body.work), existing = works.find(item => item.work.id === draft.id);
  if (conflictNext && existing) { existing.work.version++; existing.work.title = "原创云端新版本"; conflictNext = false; persist(); }
  if ((method === "POST" && existing) || (method === "PUT" && existing?.work.version !== body.version)) { renderControls(); return json({ accountId: owner, error: "模拟另一台设备已修改作品。", current: existing }, 409); }
  const now = Date.now(), { chapters, ...metadata } = draft;
  const value: DzmmNovelDetail = { accountId: owner, work: { ...metadata, version: (existing?.work.version ?? 0) + 1, createdAt: existing?.work.createdAt ?? now, updatedAt: now }, chapters: chapters.map((chapter, position) => ({ ...chapter, workId: draft.id, position, version: 1, createdAt: now, updatedAt: now })) };
  db[owner] = [...works.filter(item => item.work.id !== draft.id), value]; persist(); counts.saves++; renderControls();
  if (holdSave) { holdSave = false; return new Promise<Response>((resolve, reject) => { delayed = () => resolve(json(value)); signal?.addEventListener("abort", () => { delayed = null; reject(new DOMException("Aborted", "AbortError")); }, { once: true }); renderControls(); }); }
  return json(value);
};
function Fixture() {
  const [account, setAccount] = useState(accountId), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { switchAccount = setAccount; return () => { switchAccount = () => {}; }; }, []);
  return <NovelStudio userId={account} isGuest={false} onRequireAccount={() => {}} onDirtyChange={value => { setDirty(value); renderControls(value, busy); }} onBusyChange={value => { setBusy(value); renderControls(dirty, value); }} />;
}
renderControls();
createRoot(document.getElementById("root")!).render(<Fixture />);
