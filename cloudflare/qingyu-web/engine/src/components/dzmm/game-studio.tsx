"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { buildXumengGamePreview, createXumengGameDraft, decodeXumengGameFile, exportXumengGameBackup, importXumengGameArchive, parseXumengGameImport,
  XUMENG_GAME_MAX_PACKAGE_BYTES, XUMENG_GAME_TEMPLATES, xumengGameBytes, xumengGameDraftFromDetail,
  type XumengGameDetail, type XumengGameDraft, type XumengGameSummary } from "../../lib/xumeng-games";
import { deleteXumengGame, fetchXumengGame, fetchXumengGames, saveXumengGame, XumengGameClientError } from "../../lib/xumeng-games-client";
import { clearXumengGameRecovery, discardXumengGameRecovery, persistXumengGameRecovery, readXumengGameRecoveries, restoreXumengGameRecovery,
  type XumengGameRecovery } from "../../lib/xumeng-game-recovery";
import Icon from "./icons";
import styles from "./game-studio.module.css";

type Props = { userId: string | null; isGuest: boolean; onRequireAccount: () => void; onBack: () => void;
  onDirtyChange?: (value: boolean) => void; onBusyChange?: (value: boolean) => void; onSaved?: (id: string) => void;
  onNavigate?: (id: string | null) => void; initialId?: string | null };
const snapshot = (draft: XumengGameDraft) => JSON.stringify(draft);
const EDITOR_SOURCE_BYTES = 1024 * 1024;
const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
const message = (failure: unknown) => failure instanceof Error ? failure.message : "操作失败，当前源码仍保留。";
function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const filename = (title: string) => title.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 90) || "未命名游戏";

function GameWorkspace({ userId, isGuest, onRequireAccount, onBack, onDirtyChange, onBusyChange, onSaved, onNavigate, initialId }: Props) {
  const accountId = !isGuest && userId ? userId : "guest";
  const account = useRef(accountId); account.current = accountId;
  const mounted = useRef(false), generation = useRef(0), controllers = useRef(new Set<AbortController>()), busyRef = useRef(false);
  const draftRef = useRef<XumengGameDraft | null>(null), savedRef = useRef("");
  const editorOwner = useRef(""), recoveryRef = useRef<XumengGameRecovery | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<XumengGameDraft | null>(null), [version, setVersion] = useState<number | null>(null);
  const [library, setLibrary] = useState<XumengGameSummary[]>([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [recoveries, setRecoveries] = useState<XumengGameRecovery[]>([]), [recoverySaved, setRecoverySaved] = useState(false);
  const [conflict, setConflict] = useState<XumengGameDetail | null>(null), [preview, setPreview] = useState<string | null>(null), [previewRevision, setPreviewRevision] = useState(0);
  const [search, setSearch] = useState("");
  draftRef.current = draft;
  const dirty = Boolean(draft && (version === null || snapshot(draft) !== savedRef.current));
  const backedUp = Boolean(recoverySaved && draft && recoveryRef.current?.owner === editorOwner.current && snapshot(recoveryRef.current.game) === snapshot(draft));
  const active = (owner: string, epoch: number) => mounted.current && account.current === owner && generation.current === epoch;
  const setWorking = (value: boolean) => { busyRef.current = value; setBusy(value); };
  const install = (game: XumengGameDraft, savedVersion: number | null, baseline = savedVersion === null ? "" : snapshot(game), owner: string = crypto.randomUUID()) => {
    editorOwner.current = owner; recoveryRef.current = null; setRecoverySaved(false);
    draftRef.current = game; savedRef.current = baseline; setDraft(game); setVersion(savedVersion); setConflict(null); setPreview(null); setError(""); setNotice("");
  };
  const refreshRecoveries = useCallback(() => { setRecoveries(readXumengGameRecoveries(accountId)); }, [accountId]);
  const retainCurrent = useCallback(() => {
    if (!draftRef.current) return null;
    const entry = persistXumengGameRecovery(accountId, editorOwner.current, draftRef.current, version, savedRef.current);
    if (entry) { recoveryRef.current = entry; setRecoverySaved(true); }
    refreshRecoveries(); return entry;
  }, [accountId, version, refreshRecoveries]);
  function requestScope() {
    const controller = new AbortController(); controllers.current.add(controller);
    return { owner: account.current, epoch: generation.current, controller, finish: () => controllers.current.delete(controller) };
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; controllers.current.forEach(controller => controller.abort()); }; }, []);
  useEffect(() => {
    generation.current += 1; controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); busyRef.current = false;
    setBusy(false); setLoading(false); setDraft(null); draftRef.current = null; savedRef.current = ""; setVersion(null); setLibrary([]); setConflict(null); setPreview(null);
    editorOwner.current = ""; recoveryRef.current = null; setRecoverySaved(false);
    let retained: XumengGameRecovery[] = [];
    setError(""); setNotice(""); setSearch("");
    try { if (!isGuest && userId) retained = readXumengGameRecoveries(accountId); }
    catch { setNotice("浏览器恢复副本不可用。离开前请保存到云端或导出备份。"); }
    setRecoveries(retained);
    const scope = requestScope();
    if (isGuest || !userId) {
      if (initialId) { setError(initialId === "new" ? "请登录后创建游戏，源码会保存到你的私人作品。" : "请登录后打开私人游戏。"); onRequireAccount(); }
      scope.finish(); return;
    }
    if (initialId === "new") {
      if (retained.length) setNotice("发现未保存的游戏。请选择恢复副本，或创建独立的新稿。");
      else install(createXumengGameDraft(), null);
    }
    setLoading(true);
    void (async () => {
      try {
        if (initialId && initialId !== "new") {
          const detail = await fetchXumengGame(scope.owner, initialId, scope.controller.signal);
          if (!active(scope.owner, scope.epoch)) return;
          install(xumengGameDraftFromDetail(detail), detail.game.version);
        }
        const result = await fetchXumengGames(scope.owner, scope.controller.signal);
        if (active(scope.owner, scope.epoch)) setLibrary(result.games);
      } catch (failure) { if (active(scope.owner, scope.epoch) && !scope.controller.signal.aborted) setError(message(failure)); }
      finally { scope.finish(); if (active(scope.owner, scope.epoch)) setLoading(false); }
    })();
    return () => scope.controller.abort();
  // Initial navigation belongs to a new workspace; changing account invalidates
  // every request, draft and preview before any late response can be adopted.
  }, [accountId, initialId, isGuest, userId]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy || loading); }, [busy, loading, onBusyChange]);
  useEffect(() => () => { onDirtyChange?.(false); onBusyChange?.(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => {
    // A route reset may have replaced the ref before this old render's
    // persistence effect runs. Never write that stale draft over its successor.
    if (!draft || draftRef.current !== draft) return;
    try {
      // A clean GET/install is not a save acknowledgement. It must leave all
      // older sessions, including same-ID and legacy drafts, recoverable.
      retainCurrent();
    } catch { setRecoverySaved(false); setNotice("浏览器恢复副本不可用。离开前请保存到云端或导出备份。"); }
  }, [draft, version, dirty, accountId, retainCurrent]);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith("qingyu:game-draft:")) return;
      try {
        refreshRecoveries();
        if (recoveryRef.current) setRecoverySaved(localStorage.getItem(recoveryRef.current.key) === recoveryRef.current.raw);
      } catch { setRecoverySaved(false); setNotice("浏览器恢复副本不可用。离开前请保存到云端或导出备份。"); }
    };
    window.addEventListener("storage", update); return () => window.removeEventListener("storage", update);
  }, [refreshRecoveries]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function canReplace(replacementConfirmed = false): boolean {
    if (busyRef.current) return false;
    if (dirty) {
      try { retainCurrent(); }
      catch { setRecoverySaved(false); setNotice("浏览器未能保留当前修改。请先保存或导出备份，再切换作品。"); return false; }
      return replacementConfirmed || window.confirm("当前游戏尚未保存。继续会切换作品，浏览器仍保留恢复副本。请先保存或导出需要保留的源码。");
    }
    return true;
  }
  function restore(entry: XumengGameRecovery) {
    if (!requireAccount() || !canReplace()) return;
    try {
      const owner = crypto.randomUUID(), cloned = restoreXumengGameRecovery(entry, accountId, owner);
      install(cloned.game, cloned.version, cloned.savedSnapshot, owner); recoveryRef.current = cloned; setRecoverySaved(true);
      refreshRecoveries(); setNotice("已恢复未保存的游戏。原恢复副本仍保留，确认内容后可保存或导出。");
      onNavigate?.(cloned.version === null ? "new" : cloned.game.id);
    } catch (failure) { setError(message(failure)); }
  }
  function requireAccount(): boolean { if (isGuest || !userId) { onRequireAccount(); return false; } return true; }
  function newGame(template: "story" | "puzzle" | "blank") { if (requireAccount() && canReplace()) { install(createXumengGameDraft(template), null); onNavigate?.("new"); } }
  async function refresh() {
    if (isGuest || !userId) { onRequireAccount(); return; }
    if (busyRef.current) return;
    const scope = requestScope(); setWorking(true); setError("");
    try { const result = await fetchXumengGames(scope.owner, scope.controller.signal); if (active(scope.owner, scope.epoch)) setLibrary(result.games); }
    catch (failure) { if (active(scope.owner, scope.epoch) && !scope.controller.signal.aborted) setError(message(failure)); }
    finally { scope.finish(); if (active(scope.owner, scope.epoch)) setWorking(false); }
  }
  async function open(id: string) {
    if (!canReplace()) return;
    const scope = requestScope(); setWorking(true); setError("");
    try { const detail = await fetchXumengGame(scope.owner, id, scope.controller.signal); if (active(scope.owner, scope.epoch)) { install(xumengGameDraftFromDetail(detail), detail.game.version); onNavigate?.(detail.game.id); } }
    catch (failure) { if (active(scope.owner, scope.epoch) && !scope.controller.signal.aborted) setError(message(failure)); }
    finally { scope.finish(); if (active(scope.owner, scope.epoch)) setWorking(false); }
  }
  async function save(copy = false) {
    if (busyRef.current || !draftRef.current) return;
    if (isGuest || !userId) { onRequireAccount(); return; }
    const pending = copy ? { ...draftRef.current, id: crypto.randomUUID(), title: draftRef.current.title || "游戏副本" } : draftRef.current;
    const expected = copy ? null : version, scope = requestScope(), pendingOwner = editorOwner.current; setWorking(true); setError(""); setNotice("");
    let pendingRecovery: XumengGameRecovery | null = null;
    try { pendingRecovery = retainCurrent(); }
    catch { setRecoverySaved(false); setNotice("浏览器恢复副本不可用，正在尝试保存到云端。当前源码仍在编辑器中。"); }
    try {
      const detail = await saveXumengGame(scope.owner, pending, expected, scope.controller.signal);
      if (!active(scope.owner, scope.epoch)) return;
      install(xumengGameDraftFromDetail(detail), detail.game.version, snapshot(xumengGameDraftFromDetail(detail)), pendingOwner); setNotice("已保存到私人作品。可从创作中心重新打开。");
      onSaved?.(detail.game.id);
      const { source: _source, ...summary } = detail.game;
      setLibrary(previous => [{ ...summary, sourceBytes: xumengGameBytes(detail.game.source) }, ...previous.filter(item => item.id !== detail.game.id)]);
      try { if (pendingRecovery) clearXumengGameRecovery(pendingRecovery, scope.owner, pendingOwner); refreshRecoveries(); }
      catch { setNotice("云端保存已确认，浏览器恢复副本未能清理。原副本仍可稍后核对。"); }
    } catch (failure) {
      if (active(scope.owner, scope.epoch) && !scope.controller.signal.aborted) {
        setError(message(failure)); if (failure instanceof XumengGameClientError && failure.current) setConflict(failure.current);
      }
    } finally { scope.finish(); if (active(scope.owner, scope.epoch)) setWorking(false); }
  }
  async function remove() {
    if (!draft || version === null || busyRef.current || !window.confirm("删除这部私人游戏？此操作不会删除其他作品。请先导出需要保留的源码。")) return;
    const scope = requestScope(); setWorking(true); setError("");
    try {
      await deleteXumengGame(scope.owner, draft.id, version, scope.controller.signal);
      if (!active(scope.owner, scope.epoch)) return;
      setLibrary(previous => previous.filter(item => item.id !== draft.id));
      // Deleting the cloud work does not discard unsaved browser revisions.
      setDraft(null); draftRef.current = null; recoveryRef.current = null; setRecoverySaved(false); savedRef.current = ""; setVersion(null); setPreview(null); setNotice("游戏已删除。");
    } catch (failure) { if (active(scope.owner, scope.epoch) && !scope.controller.signal.aborted) setError(message(failure)); }
    finally { scope.finish(); if (active(scope.owner, scope.epoch)) setWorking(false); }
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!requireAccount()) return;
    if (!file || !canReplace()) return;
    if (!/\.(html?|json|zip)$/i.test(file.name)) { setError("请上传 HTML、网页游戏 ZIP 或晴屿 JSON 备份。"); return; }
    if (file.size > XUMENG_GAME_MAX_PACKAGE_BYTES) { setError("文件超过 12 MB，未覆盖当前草稿。"); return; }
    const scope = requestScope(); setWorking(true); setError("");
    try {
      const buffer = await file.arrayBuffer();
      if (!active(scope.owner, scope.epoch)) return;
      const imported = /\.zip$/i.test(file.name)
        ? await importXumengGameArchive(new Uint8Array(buffer), file.name)
        : parseXumengGameImport(decodeXumengGameFile(buffer), /\.json$/i.test(file.name) ? "json" : "html", file.name);
      if (!active(scope.owner, scope.epoch)) return;
      install(imported, null); setNotice("已导入独立副本。确认内容后保存到私人作品。");
      onNavigate?.("new");
    } catch (failure) { if (active(scope.owner, scope.epoch)) setError(message(failure)); }
    finally { scope.finish(); if (active(scope.owner, scope.epoch)) setWorking(false); }
  }
  function previewGame() {
    if (!draft) return;
    try { setPreview(buildXumengGamePreview(draft.source)); setPreviewRevision(value => value + 1); setError(""); }
    catch (failure) { setError(message(failure)); }
  }
  function leaveEditor() { if (!canReplace()) return; setDraft(null); draftRef.current = null; recoveryRef.current = null; setRecoverySaved(false); setVersion(null); savedRef.current = ""; setPreview(null); setConflict(null); setError(""); onNavigate?.(null); }
  const results = library.filter(item => `${item.title} ${item.synopsis}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className={styles.studio}>
    <header className={styles.header}><div className={styles.heading}>
      <button className={styles.back} aria-label={draft ? "返回游戏作品列表" : "返回创作中心"} disabled={busy || loading} onClick={draft ? leaveEditor : onBack}><Icon name="back" size={19} /></button>
      <div><p className={styles.eyebrow}>创作中心 / 游戏</p><h1>{draft?.title || "游戏创作"}</h1><p className={styles.status}>{draft ? busy ? "正在保存或加载…" : dirty ? backedUp ? "尚未保存 · 浏览器保留恢复副本" : "尚未保存 · 浏览器恢复副本未确认" : `私人作品 · 已保存 v${version}` : "网页游戏 · HTML、压缩包与试玩"}</p></div>
    </div><div className={styles.actions}>
      <button className={styles.secondary} disabled={busy || loading} onClick={() => { if (requireAccount()) fileInput.current?.click(); }}><Icon name="upload" size={15} />导入</button>
      {draft ? <><button className={styles.secondary} disabled={busy} onClick={() => { try { download(exportXumengGameBackup(draft), `${filename(draft.title)}.qingyu-game.json`, "application/json;charset=utf-8"); } catch (failure) { setError(message(failure)); } }}><Icon name="download" size={15} />备份</button>
        <button className={styles.primary} disabled={busy || loading || !dirty} onClick={() => void save()}><Icon name="check" size={16} />保存</button></> : <button className={styles.primary} disabled={busy || loading} onClick={() => newGame("blank")}><Icon name="plus" size={16} />新建游戏</button>}
    </div></header>
    <input ref={fileInput} type="file" accept=".html,.htm,.json,.zip,application/zip" hidden onChange={event => void importFile(event)} />
    <div className={styles.messages}>{error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
      {conflict && <div className={styles.recovery}><div><strong>云端已有 v{conflict.game.version}，当前源码未被覆盖。</strong><p>可先导出备份，再另存副本；加载云端会替换当前编辑器。</p></div><button className={styles.secondary} disabled={busy} onClick={() => void save(true)}>另存副本</button><button className={styles.secondary} disabled={busy} onClick={() => { if (window.confirm("加载云端版本会替换当前编辑器，请确认已导出备份。") && canReplace(true)) install(xumengGameDraftFromDetail(conflict), conflict.game.version); }}>加载云端版本</button></div>}
      {recoveries.filter(entry => !draft || !dirty || entry.owner !== editorOwner.current || snapshot(entry.game) !== snapshot(draft)).map(entry => <div key={entry.key} className={styles.recovery}><div><strong>{entry.game.id === draft?.id ? "这部游戏有未保存修改" : "发现未保存的游戏"}：{entry.game.title || "未命名游戏"}</strong><p>{new Date(entry.updatedAt).toLocaleString("zh-CN")} · 恢复副本仅保存在当前浏览器、当前账号。</p></div><button className={styles.secondary} disabled={busy || loading} onClick={() => restore(entry)}>恢复草稿</button><button className={styles.quiet} disabled={busy || loading} onClick={() => {
        if (!window.confirm("删除这份浏览器恢复副本？云端作品不受影响。")) return;
        try { if (!discardXumengGameRecovery(entry, accountId)) setNotice("这份副本已在其他页面更新，未删除。请核对后重新选择。"); refreshRecoveries(); }
        catch (failure) { setError(message(failure)); }
      }}>丢弃副本</button></div>)}
    </div>
    {!draft ? <main className={styles.library}><section className={styles.templates}><h2>从模板开始</h2><div>{XUMENG_GAME_TEMPLATES.map(template => <button key={template.id} disabled={busy || loading} onClick={() => newGame(template.id)}><span><strong>{template.title}</strong><small>{template.description}</small></span><Icon name="chevron" size={17} /></button>)}</div></section>
      <section><div className={styles.sectionHead}><h2>我的游戏 <span>{library.length}</span></h2><button className={styles.quiet} disabled={busy || loading || isGuest} onClick={() => void refresh()}><Icon name="refresh" size={15} />刷新</button></div>
        {isGuest || !userId ? <div className={styles.empty}><p>登录后可选择模板、编写源码，并保存到私人作品。</p><button className={styles.secondary} onClick={onRequireAccount}>登录并创作</button></div> : <><label className={styles.search}><Icon name="search" size={17} /><input type="search" aria-label="搜索我的游戏" placeholder="搜索游戏名称或简介" value={search} onChange={event => setSearch(event.target.value)} /></label>
          {loading ? <p className={styles.empty} role="status">正在加载私人作品…</p> : results.length ? <div className={styles.workList}>{results.map(game => <button key={game.id} className={styles.workRow} disabled={busy} onClick={() => void open(game.id)}><Icon name="compass" size={24} /><span><strong>{game.title}</strong><small>{game.synopsis || "暂无简介"}</small><em>{formatSize(game.sourceBytes)} · v{game.version} · {new Date(game.updatedAt).toLocaleString("zh-CN")}</em></span><Icon name="chevron" size={16} /></button>)}</div> : <p className={styles.empty}>{search ? "没有匹配的游戏。" : error ? "作品未能加载，可刷新重试。" : "还没有私人游戏。选择模板，修改后保存。"}</p>}</>}
      </section></main> : <main className={styles.workspace}>
        <section className={styles.editor}><div className={styles.metadata}><label>游戏名称<input aria-label="游戏名称" maxLength={120} value={draft.title} disabled={busy} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label>游戏简介<textarea aria-label="游戏简介" maxLength={4000} rows={2} value={draft.synopsis} disabled={busy} onChange={event => setDraft({ ...draft, synopsis: event.target.value })} /></label></div>
          <div className={styles.sectionHead}><h2>HTML 源码</h2><span className={styles.bytes}>{formatSize(xumengGameBytes(draft.source))} / 8 MB</span></div>
          {xumengGameBytes(draft.source) > EDITOR_SOURCE_BYTES ? <div className={styles.previewEmpty}><p>这部作品有 {formatSize(xumengGameBytes(draft.source))}，已经包含页面、脚本和图片。</p><small>可以直接试玩、备份和保存。要修改内容，请重新导入 HTML 或 ZIP。</small></div> : <textarea className={styles.code} aria-label="HTML 游戏源码" spellCheck={false} disabled={busy} value={draft.source} onChange={event => { setDraft({ ...draft, source: event.target.value }); setError(""); }} />}
          <p className={styles.help}>可以导入单个 HTML，或包含 index.html、样式、脚本、图片和音频的 ZIP。试玩允许内联脚本、内联样式与 data 图片；外部脚本、接口请求和嵌套页面不会加载。超过 1 MB 的作品不会写入浏览器恢复副本。</p>
          <div className={styles.editorFooter}><button className={styles.secondary} disabled={busy} onClick={() => download(draft.source, `${filename(draft.title)}.html`, "text/html;charset=utf-8")}><Icon name="download" size={15} />导出 HTML</button>{version !== null && <button className={styles.danger} disabled={busy} onClick={() => void remove()}>删除游戏</button>}</div>
        </section>
        <section className={styles.preview}><div className={styles.sectionHead}><h2>试玩</h2><button className={styles.secondary} disabled={busy} onClick={previewGame}><Icon name={preview ? "refresh" : "play"} size={15} />{preview ? "重新运行" : "运行游戏"}</button></div>
          {preview ? <iframe key={previewRevision} title={`${draft.title || "游戏"}试玩`} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" srcDoc={preview} /> : <div className={styles.previewEmpty}><Icon name="play" size={32} /><p>点击“运行游戏”试玩当前源码。</p><small>修改源码后重新运行，预览从头开始。</small></div>}
          {preview && <button className={styles.quiet} onClick={() => setPreview(null)}><Icon name="stop" size={14} />停止试玩</button>}
          <p className={styles.help}>试玩在独立沙箱内运行，不共享晴屿账号、钱包或私人数据。作品保存在私人库中。</p>
        </section>
      </main>}
  </div>;
}

export default function GameStudio(props: Props) {
  // Reset the entire workspace synchronously on an identity change. The old
  // editor cannot flash or persist its draft under the incoming account key.
  return <GameWorkspace key={!props.isGuest && props.userId ? props.userId : "guest"} {...props} />;
}
