"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FEEDBACK_LABELS, FEEDBACK_STATUSES, FeedbackError, feedbackDraftKey, fetchFeedback, fetchFeedbackHandoff, parseFeedbackDrafts, serializeFeedbackDrafts, updateFeedback,
  type FeedbackDrafts, type FeedbackHandoff, type FeedbackItem, type FeedbackPage, type FeedbackStatus } from "@/lib/xumeng-feedback-client";
import Icon from "./icons";
import s from "./feedback-inbox.module.css";

type DraftSnapshot = { drafts: FeedbackDrafts; warning: string; unreadable: boolean; original: string | null; exported: string | null };
const LIMIT = 20;
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const errorText = (value: unknown) => value instanceof Error ? value.message : "操作失败，请重试。";
const mediaName = (kind: string) => ({ photo: "图片", video: "视频", animation: "动画", audio: "音频", voice: "语音", document: "文件", sticker: "贴纸" }[kind] ?? "附件");
function readDrafts(accountId: string): DraftSnapshot {
  let original: string | null = null;
  try { original = typeof window === "undefined" ? null : localStorage.getItem(feedbackDraftKey(accountId)); return { drafts: parseFeedbackDrafts(original, accountId), warning: "", unreadable: false, original: null, exported: null }; }
  catch { return { drafts: {}, warning: "本地决策草稿无法读取，原缓存已保留。新输入请先导出备份再离开。", unreadable: true, original, exported: null }; }
}

export default function FeedbackInbox({ accountId, onRequireAccount }: { accountId: string; onRequireAccount: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<{ q: string; status: FeedbackStatus | ""; offset: number }>({ q: "", status: "pending", offset: 0 });
  const [remote, setRemote] = useState<{ page: FeedbackPage | null; loading: boolean; error: string; denied: number | null; fetchedAt: number | null }>({ page: null, loading: true, error: "", denied: null, fetchedAt: null });
  const [snapshot, setSnapshot] = useState(() => readDrafts(accountId));
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<{ feedbackId: string; loading: boolean; result: FeedbackHandoff | null; error: string; copyError: string; copied: boolean } | null>(null);
  const currentDrafts = useRef(snapshot);
  const root = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const readRun = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const workingRef = useRef<string | null>(null);
  const handoffController = useRef<AbortController | null>(null);
  const handoffRun = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLTextAreaElement>(null);
  const dialogTitle = useId();
  const handoffOpen = handoff !== null;
  const closeHandoff = useCallback(() => { handoffRun.current++; handoffController.current?.abort(); setHandoff(null); }, []);

  useEffect(() => { alive.current = true; return () => { alive.current = false; readController.current?.abort(); writeController.current?.abort(); handoffController.current?.abort(); }; }, []);
  useEffect(() => {
    if (!handoffOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeHandoff(); return; }
      if (event.key !== "Tab") return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]');
      if (!elements?.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); };
  }, [handoffOpen, closeHandoff]);
  function persist(drafts: FeedbackDrafts) {
    const previous = currentDrafts.current;
    let warning = previous.warning;
    if (!previous.unreadable) {
      try {
        const raw = serializeFeedbackDrafts(accountId, drafts);
        if (Object.keys(drafts).length) localStorage.setItem(feedbackDraftKey(accountId), raw); else localStorage.removeItem(feedbackDraftKey(accountId));
        warning = "";
      } catch { warning = "本地决策草稿未能保存。文字仍在，请导出备份后再切换页面、账号或刷新。"; }
    }
    const next = { ...previous, drafts, warning, exported: null };
    currentDrafts.current = next; setSnapshot(next);
  }
  const load = useCallback(async () => {
    readController.current?.abort();
    const run = ++readRun.current;
    const controller = new AbortController(); readController.current = controller;
    setRemote(value => ({ ...value, loading: true, error: "" }));
    try {
      const page = await fetchFeedback(accountId, { ...filter, limit: LIMIT }, controller.signal);
      if (!alive.current || controller.signal.aborted || run !== readRun.current) return;
      setRemote({ page, loading: false, error: "", denied: null, fetchedAt: Date.now() });
    } catch (error) {
      if (!alive.current || controller.signal.aborted || run !== readRun.current) return;
      const denied = error instanceof FeedbackError && [401, 403].includes(error.status) ? error.status : null;
      setRemote(value => ({ ...value, ...(denied ? { page: null, fetchedAt: null } : {}), loading: false, error: errorText(error), denied }));
    }
  }, [accountId, filter]);
  useEffect(() => { void load(); return () => { readController.current?.abort(); }; }, [load]);

  // Persisted drafts survive ordinary tab/route changes. If storage fails, keep
  // this editor mounted until its new input is exported or saved successfully.
  useEffect(() => {
    const unsafe = () => {
      const value = currentDrafts.current;
      return Boolean(value.warning && Object.keys(value.drafts).length && value.exported !== JSON.stringify({ accountId, drafts: value.drafts, original: value.original }));
    };
    const unload = (event: BeforeUnloadEvent) => { if (unsafe()) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (unsafe() && target && !root.current?.contains(target) && target.closest("button,a")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (unsafe() && event.key === "Enter" && target && !root.current?.contains(target) && target.closest("button,a,input")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const hash = (event: HashChangeEvent) => {
      if (!unsafe() || new URL(event.oldURL).hash === new URL(event.newURL).hash) return;
      event.stopImmediatePropagation(); history.replaceState(null, "", event.oldURL);
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true); document.addEventListener("keydown", key, true); window.addEventListener("hashchange", hash, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); document.removeEventListener("keydown", key, true); window.removeEventListener("hashchange", hash, true); };
  }, [accountId]);

  function edit(item: FeedbackItem, change: Partial<{ status: FeedbackStatus; note: string }>) {
    const previous = currentDrafts.current.drafts[item.id] ?? { revision: item.revision, status: item.status, note: item.note };
    const next = { ...previous, ...change };
    const drafts = { ...currentDrafts.current.drafts };
    if (next.status === item.status && next.note === item.note && next.revision === item.revision) delete drafts[item.id]; else drafts[item.id] = next;
    persist(drafts); setErrors(value => ({ ...value, [item.id]: "" })); setNotice("");
  }
  function exportDrafts() {
    const value = currentDrafts.current;
    const content = JSON.stringify({ accountId, drafts: value.drafts, original: value.original });
    const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
    try {
      const link = document.createElement("a"); link.href = url; link.download = "晴屿反馈决策备份.json";
      document.body.append(link); link.click(); link.remove();
      const next = { ...value, exported: content }; currentDrafts.current = next; setSnapshot(next);
    } finally { URL.revokeObjectURL(url); }
  }
  async function save(event: FormEvent, item: FeedbackItem) {
    event.preventDefault();
    const draft = currentDrafts.current.drafts[item.id];
    if (!draft || workingRef.current || draft.revision !== item.revision) return;
    const controller = new AbortController(); writeController.current = controller;
    workingRef.current = item.id; setWorking(item.id); setNotice(""); setErrors(value => ({ ...value, [item.id]: "" }));
    try {
      const updated = await updateFeedback(item.id, { accountId, ...draft }, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      const drafts = { ...currentDrafts.current.drafts }; delete drafts[item.id]; persist(drafts);
      setRemote(value => value.page ? { ...value, page: { ...value.page, items: value.page.items.map(entry => entry.id === item.id ? updated : entry) } } : value);
      setNotice(`已保存为「${FEEDBACK_LABELS[updated.status]}」。`);
      await load();
    } catch (error) {
      if (!alive.current || controller.signal.aborted) return;
      if (error instanceof FeedbackError && error.status === 409 && error.latest?.id === item.id) {
        const latest = error.latest;
        setRemote(value => value.page ? { ...value, page: { ...value.page, items: value.page.items.map(entry => entry.id === item.id ? latest : entry) } } : value);
        setErrors(value => ({ ...value, [item.id]: "反馈已更新，已读取最新版本。你的决策草稿仍保留，请核对后继续。" }));
      } else {
        if (error instanceof FeedbackError && [401, 403].includes(error.status)) setRemote(value => ({ ...value, page: null, fetchedAt: null, denied: error.status, error: error.message }));
        setErrors(value => ({ ...value, [item.id]: errorText(error) }));
      }
    } finally { workingRef.current = null; if (alive.current) setWorking(null); }
  }
  async function openHandoff(item: FeedbackItem) {
    if (workingRef.current || currentDrafts.current.drafts[item.id] || remote.denied || (item.status !== "fix" && item.status !== "improve")) return;
    handoffController.current?.abort();
    const controller = new AbortController(); handoffController.current = controller;
    const run = ++handoffRun.current;
    setHandoff({ feedbackId: item.id, loading: true, result: null, error: "", copyError: "", copied: false });
    try {
      const result = await fetchFeedbackHandoff(accountId, item.id, item.revision, controller.signal);
      if (!alive.current || controller.signal.aborted || run !== handoffRun.current) return;
      // Validate against the judgment visible when the action was requested.
      if (result.status !== item.status || result.note !== item.note) throw new FeedbackError(502, "任务与当前判断不一致，请刷新反馈并重新核对。");
      setHandoff({ feedbackId: item.id, loading: false, result, error: "", copyError: "", copied: false });
    } catch (error) {
      if (!alive.current || controller.signal.aborted || run !== handoffRun.current) return;
      if (error instanceof FeedbackError && [401, 403].includes(error.status)) {
        setRemote(value => ({ ...value, page: null, fetchedAt: null, denied: error.status, error: error.message })); closeHandoff(); return;
      }
      if (error instanceof FeedbackError && error.status === 409 && error.latest?.id === item.id) {
        const latest = error.latest;
        setRemote(value => value.page ? { ...value, page: { ...value.page, items: value.page.items.map(entry => entry.id === item.id ? latest : entry) } } : value);
        // A source edit also invalidates its earlier approval. Retain an existing
        // draft; otherwise prepare the latest judgment for explicit confirmation.
        if (!currentDrafts.current.drafts[item.id]) persist({ ...currentDrafts.current.drafts, [item.id]: { revision: latest.revision, status: latest.status, note: latest.note } });
        setOpened(value => ({ ...value, [item.id]: true }));
        setHandoff({ feedbackId: item.id, loading: false, result: null, error: `${error.message} 已读取最新反馈，决策草稿仍保留。请返回核对并重新保存判断，再交给 Codex。`, copyError: "", copied: false });
      } else setHandoff({ feedbackId: item.id, loading: false, result: null, error: errorText(error), copyError: "", copied: false });
    }
  }
  async function copyHandoff() {
    const result = handoff?.result;
    if (!result) return;
    const run = handoffRun.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(result.markdown);
      if (!alive.current || run !== handoffRun.current) return;
      setHandoff(value => value ? { ...value, copied: true, copyError: "" } : value);
    } catch {
      if (!alive.current || run !== handoffRun.current) return;
      setHandoff(value => value ? { ...value, copied: false, copyError: "无法自动复制。已选中任务文本，可手动复制，或下载 Markdown。" } : value);
      preview.current?.focus(); preview.current?.select();
    }
  }
  function downloadHandoff() {
    const result = handoff?.result;
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }));
    try {
      const link = document.createElement("a"); link.href = url; link.download = result.fileName;
      document.body.append(link); link.click(); link.remove();
    } finally { URL.revokeObjectURL(url); }
  }
  const count = Object.keys(snapshot.drafts).length;
  const page = remote.page;
  return <div ref={root} className={s.inbox}>
    <div className={s.toolbar}><p>只收集指定群里 @ Bot 的反馈，处理状态由你判断。</p><button type="button" className={s.outline} disabled={remote.loading || Boolean(working)} onClick={() => void load()}><Icon name="refresh" size={15} />刷新反馈</button></div>
    {page && !page.integrationConfigured && <div className={s.setup} role="status"><strong>等待 Telegram Bot 绑定</strong><p>收件箱已准备好。配置 Bot 和接收群后，群里 @ Bot 的消息会出现在这里。</p></div>}
    {snapshot.warning && <div className={s.error} role="alert"><p>{snapshot.warning}</p><button className={s.outline} type="button" onClick={exportDrafts}>导出决策备份</button></div>}
    {count > 0 && <p className={s.draftNote} role="status">{count} 条未提交决策{snapshot.warning ? "仍在当前页面" : "已保存在本机"}，切换筛选或后台功能后可继续。{!snapshot.warning && <button className={s.text} type="button" onClick={exportDrafts}>导出备份</button>}</p>}
    <div className={s.statuses} aria-label="反馈状态筛选"><button type="button" aria-pressed={filter.status === ""} disabled={Boolean(working)} onClick={() => setFilter(value => ({ ...value, status: "", offset: 0 }))}>全部{page ? <span>{Object.values(page.counts).reduce((a, b) => a + b, 0)}</span> : null}</button>{FEEDBACK_STATUSES.map(status => <button type="button" key={status} aria-pressed={filter.status === status} disabled={Boolean(working)} onClick={() => setFilter(value => ({ ...value, status, offset: 0 }))}>{FEEDBACK_LABELS[status]}{page ? <span>{page.counts[status]}</span> : null}</button>)}</div>
    <form className={s.search} onSubmit={event => { event.preventDefault(); setFilter(value => ({ ...value, q: query.trim(), offset: 0 })); }}><label>搜索反馈<input type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} placeholder="正文、群名、发言者或决策备注" disabled={Boolean(working)} /></label><button type="submit" className={s.outline} disabled={remote.loading || Boolean(working)}><Icon name="search" size={15} />搜索</button>{filter.q && <button type="button" className={s.text} disabled={Boolean(working)} onClick={() => { setQuery(""); setFilter(value => ({ ...value, q: "", offset: 0 })); }}>清除</button>}</form>
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {remote.error && <div className={s.error} role="alert"><p>{remote.error}{page ? "当前显示的是上次加载的反馈。" : ""}</p><button className={s.outline} type="button" disabled={remote.loading || Boolean(working)} onClick={() => remote.denied === 401 ? onRequireAccount() : void load()}>{remote.denied === 401 ? "重新登录" : "重试加载"}</button></div>}
    {remote.loading && <p className={s.loading} role="status">正在加载反馈…{page ? "已有内容继续保留。" : ""}</p>}
    {page?.items.length === 0 && !remote.loading && !remote.error && <div className={s.empty}><Icon name="chat" size={27} /><h3>{filter.q ? "没有匹配的反馈" : "这里还没有反馈"}</h3><p>{filter.q || filter.status !== "" ? "可以调整搜索词，或查看全部状态。" : "请在已绑定的群里 @ Bot 提交反馈。"}</p></div>}
    {page && <div className={s.list} aria-label="Telegram 反馈列表">{page.items.map(item => {
      const draft = snapshot.drafts[item.id];
      const decision = draft ?? { revision: item.revision, status: item.status, note: item.note };
      const conflict = Boolean(draft && draft.revision !== item.revision);
      return <article key={item.id} className={s.feedback}>
        <header><div><strong>{item.chatTitle || "Telegram 群"}</strong><span>{item.senderName || "群成员"}{item.senderUsername ? ` · @${item.senderUsername}` : ""} · {date(item.messageAt)}</span></div><span className={s.badge} data-status={item.status}>{FEEDBACK_LABELS[item.status]}</span></header>
        {item.replyText && <blockquote><span>引用{item.replySenderName ? ` · ${item.replySenderName}` : ""}</span><p>{item.replyText}</p></blockquote>}
        <p className={s.body}>{item.text || "此反馈只有附件，没有文字说明。"}</p>
        {item.media && <p className={s.attachment}><Icon name={item.media.kind === "photo" ? "image" : item.media.kind === "video" ? "video" : "book"} size={14} />{mediaName(item.media.kind)}{item.media.fileName ? ` · ${item.media.fileName}` : ""}{item.media.size !== null ? ` · ${Math.ceil(item.media.size / 1024).toLocaleString("zh-CN")} KB` : ""}<span>附件内容请在 Telegram 查看</span></p>}
        <div className={s.source}>{item.messageUrl ? <a href={item.messageUrl} target="_blank" rel="noopener noreferrer">查看原消息 ↗</a> : <span>私密群原消息链接不可用</span>}{item.editedAt && <span>群消息已编辑 · {date(item.editedAt)}</span>}{(item.status === "fix" || item.status === "improve") && <div className={s.handoffAction}><button type="button" className={s.outline} disabled={Boolean(draft) || conflict || Boolean(working) || Boolean(remote.denied) || handoffOpen} onClick={() => void openHandoff(item)}><Icon name="copy" size={14} />交给 Codex</button>{draft && <small>请先保存判断</small>}</div>}</div>
        <details open={Boolean(opened[item.id] || draft)} onToggle={event => { const open = event.currentTarget.open; setOpened(value => ({ ...value, [item.id]: open })); }}>
          <summary>查看与判断{draft && <span>有未提交决策</span>}</summary>
          <form className={s.editor} onSubmit={event => void save(event, item)}>
            {conflict && <div className={s.conflict} role="alert"><strong>最新版本与草稿不同</strong><p>最新状态：{FEEDBACK_LABELS[item.status]} · 更新于 {date(item.updatedAt)}</p><p className={s.latestNote}>最新备注：{item.note || "无"}</p><p>下面保留你的原决策草稿，请先核对原消息和最新判断。</p><button className={s.outline} type="button" disabled={Boolean(working)} onClick={() => { persist({ ...currentDrafts.current.drafts, [item.id]: { ...decision, revision: item.revision } }); setErrors(value => ({ ...value, [item.id]: "" })); }}>已核对，保留草稿继续修改</button></div>}
            <label>处理状态<select value={decision.status} disabled={Boolean(working) || Boolean(remote.denied)} onChange={event => edit(item, { status: event.target.value as FeedbackStatus })}>{FEEDBACK_STATUSES.map(status => <option key={status} value={status}>{FEEDBACK_LABELS[status]}</option>)}</select></label>
            <label>决策备注<textarea value={decision.note} maxLength={2000} rows={3} placeholder="记录你决定修复、改进或暂不处理的原因" disabled={Boolean(working) || Boolean(remote.denied)} onChange={event => edit(item, { note: event.target.value })} /><small>{decision.note.length.toLocaleString("zh-CN")} / 2,000</small></label>
            {errors[item.id] && <p className={s.saveError} role="alert">{errors[item.id]}</p>}
            <footer><span>{draft ? "草稿未提交" : item.decidedAt ? `判断已保存 · ${date(item.decidedAt)}` : "等待你的判断"}</span><button className={s.primary} type="submit" disabled={!draft || conflict || Boolean(working) || Boolean(remote.denied)}>{working === item.id ? "正在保存…" : "保存判断"}</button></footer>
          </form>
        </details>
      </article>;
    })}</div>}
    {page && <footer className={s.pagination}><span>共 {page.total.toLocaleString("zh-CN")} 条{remote.fetchedAt ? ` · 更新于 ${date(remote.fetchedAt)}` : ""}</span><div><button className={s.outline} type="button" disabled={remote.loading || Boolean(working) || filter.offset === 0} onClick={() => setFilter(value => ({ ...value, offset: Math.max(0, value.offset - LIMIT) }))}>上一页</button><button className={s.outline} type="button" disabled={remote.loading || Boolean(working) || !page.hasMore} onClick={() => setFilter(value => ({ ...value, offset: value.offset + LIMIT }))}>下一页</button></div></footer>}
    {handoff && <div className={s.overlay} onMouseDown={event => { if (event.target === event.currentTarget) closeHandoff(); }}><div ref={dialog} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby={dialogTitle} tabIndex={-1}>
      <header><h2 id={dialogTitle}>交给 Codex</h2><button className={s.close} type="button" aria-label="关闭 Codex 交接" onClick={closeHandoff}><Icon name="close" size={19} /></button></header>
      <div className={s.handoffBody}><p>复制后粘贴到当前 Codex 任务，我会按你的判断复现、修改并验证。</p><small>这是任务文本预览，尚未发送或开始执行。</small>
        {handoff.loading && <p className={s.loading} role="status">正在生成当前判断的任务文本…</p>}
        {handoff.error && <p className={s.saveError} role="alert">{handoff.error}</p>}
        {handoff.result && <label>任务 Markdown<textarea ref={preview} readOnly value={handoff.result.markdown} rows={14} spellCheck={false} /></label>}
        {handoff.copyError && <p className={s.saveError} role="alert">{handoff.copyError}</p>}{handoff.copied && <p className={s.notice} role="status">任务文本已复制，请粘贴到当前 Codex 任务。</p>}
      </div><footer><button className={s.outline} type="button" onClick={closeHandoff}>{handoff.error ? "返回判断" : "关闭"}</button>{handoff.result && <><button className={s.outline} type="button" onClick={downloadHandoff}><Icon name="download" size={14} />下载 .md</button><button className={s.primary} type="button" onClick={() => void copyHandoff()}><Icon name="copy" size={14} />复制任务文本</button></>}</footer>
    </div></div>}
  </div>;
}
