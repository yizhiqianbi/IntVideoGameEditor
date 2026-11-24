"use client";

import { useEffect, useRef, useState } from "react";
import { RESIDENTS, TOWN_STORY } from "../lib/characters.mjs";
import { emptyWorkspace, parseWorkspace, STORAGE_KEY } from "../lib/storage.mjs";
import { isSafeText } from "../lib/safety.mjs";

function Icon({ name, size = 20, ...props }) {
  const paths = {
    compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/></>,
    book: <><path d="M12 6c-3-2-6-2-10-1v14c4-1 7-1 10 1 3-2 6-2 10-1V5c-4-1-7-1-10 1Z"/><path d="M12 6v14"/></>,
    note: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    back: <path d="M20 12H4m6-6-6 6 6 6"/>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
    leaf: <><path d="M20 3C10 2 3 6 4 13c1 7 15 7 16-10Z"/><path d="M4 21c1-7 6-10 11-13"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,
    send: <><path d="m21 3-7 18-4-8-8-4Z"/><path d="m10 13 11-10"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    chat: <path d="M21 11a9 9 0 0 1-9 9c-1.6 0-3-.4-4.3-1L3 21l1.5-4.8A9 9 0 1 1 21 11Z"/>,
    paw: <><ellipse cx="6" cy="7" rx="2" ry="3" transform="rotate(-20 6 7)"/><ellipse cx="12" cy="5" rx="2" ry="3"/><ellipse cx="18" cy="7" rx="2" ry="3" transform="rotate(20 18 7)"/><path d="M6 17c0-4 4-8 6-8s6 4 6 8c0 3-3 4-6 2-3 2-6 1-6-2Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.paw}</svg>;
}

const navigation = [
  { page: "discover", icon: "compass", label: "发现居民", english: "Discover" },
  { page: "stories", icon: "book", label: "我的故事", english: "My stories" },
  { page: "journal", icon: "note", label: "口袋手记", english: "Little moments" },
];
function readRoute() {
  const [page, id] = window.location.hash.slice(1).split("/");
  return { page: ["discover", "stories", "journal", "create", "resident", "chat", "about"].includes(page) ? page : "discover", id: id || "" };
}
function go(page, id = "") { window.location.hash = `#${page}${id ? `/${id}` : ""}`; }
function dateLabel(time) { return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(time)); }

export default function PawtaleApp() {
  const [route, setRoute] = useState({ page: "discover", id: "" });
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [savingEnabled, setSavingEnabled] = useState(true);
  const [mode, setMode] = useState("loading");
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [confirmReset, setConfirmReset] = useState(false);
  const modalRef = useRef(null);
  const residents = [...RESIDENTS, ...workspace.customs];
  const resident = residents.find((r) => r.id === route.id);

  useEffect(() => {
    const updateRoute = () => { setRoute(readRoute()); window.scrollTo({ top: 0 }); };
    updateRoute();
    window.addEventListener("hashchange", updateRoute);
    let loaded = emptyWorkspace();
    try { loaded = parseWorkspace(localStorage.getItem(STORAGE_KEY)); }
    catch { setSavingEnabled(false); setStorageError("没有读到已保存的故事。原数据暂不覆盖；本次内容可以导出备份，恢复有效备份后可继续保存。"); }
    setWorkspace(loaded);
    setReady(true);
    const controller = new AbortController();
    fetch("/api/chat", { signal: controller.signal }).then(async (r) => { if (!r.ok) throw new Error(); return r.json(); }).then((data) => setMode(data.mode)).catch((e) => { if (e.name !== "AbortError") setMode("unavailable"); });
    return () => { window.removeEventListener("hashchange", updateRoute); controller.abort(); };
  }, []);
  useEffect(() => {
    if (!ready || !savingEnabled) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); }
    catch { setStorageError("浏览器空间不足，当前改动尚未保存。请先导出备份。"); }
  }, [workspace, ready, savingEnabled]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2800); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (confirmReset) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [confirmReset]);

  function toggleFavorite(id) {
    setWorkspace((w) => ({ ...w, favorites: w.favorites.includes(id) ? w.favorites.filter((f) => f !== id) : [...w.favorites, id] }));
  }
  function updateConversation(id, messages, conversationMode = mode) {
    setWorkspace((w) => ({ ...w, conversations: { ...w.conversations, [id]: { messages: messages.slice(-160), updatedAt: Date.now(), mode: conversationMode } } }));
  }
  function saveNote(content, source = "随手记") {
    if (!content.trim() || content.length > 3000 || !isSafeText(content)) { setToast("请记录 1–3000 字、适合全年龄的小事。"); return false; }
    setWorkspace((w) => ({ ...w, notes: [{ id: crypto.randomUUID(), content: content.trim(), createdAt: Date.now(), source }, ...w.notes].slice(0, 100) }));
    setToast("这一刻，放进口袋了。"); return true;
  }
  function exportBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "pawtale-stories.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("故事已导出到下载文件夹。");
  }
  const activePage = ["resident", "chat"].includes(route.page) ? "discover" : route.page;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>跳到主要内容</a>
    <aside className="sidebar">
      <a className="brand" href="#discover" aria-label="尾语 PAWTALE 首页"><img src="/mark.svg" width="43" height="43" alt=""/><span><strong>尾语</strong><small>PAWTALE</small></span></a>
      <div className="sidebar-caption">一些陪伴，一点想象。</div>
      <nav aria-label="主导航">{navigation.map((item) => <a key={item.page} href={`#${item.page}`} className={`nav-item ${activePage === item.page ? "active" : ""}`} aria-current={activePage === item.page ? "page" : undefined}><Icon name={item.icon}/><span>{item.label}<small>{item.english}</small></span>{item.page === "stories" && Object.keys(workspace.conversations).length > 0 ? <i className="nav-count">{Object.keys(workspace.conversations).length}</i> : null}</a>)}</nav>
      <a className={`create-link ${activePage === "create" ? "active" : ""}`} href="#create"><Icon name="plus" size={18}/>创造一位新朋友</a>
      <div className="sidebar-bottom"><div className="sidebar-flower"><Icon name="leaf" size={27}/></div><p>小小的世界，<br/>容得下每一种心情。</p><a href="#about" className="about-link">关于尾语 <Icon name="arrow" size={14}/></a><div className="traveler"><span className="avatar"><Icon name="paw" size={20}/></span><span>小镇旅人<small>故事保存在此浏览器</small></span><button className="icon-button" onClick={exportBackup} title="导出故事备份" aria-label="导出故事备份"><Icon name="download" size={17}/></button></div></div>
    </aside>

    <main className={`main-area ${route.page === "chat" ? "chat-main" : ""}`} id="main-content" tabIndex={-1}>
      <header className="topbar"><div className="breadcrumb"><span>尾语小镇</span><span className="breadcrumb-divider">/</span><strong>{({ discover: "发现", stories: "我的故事", journal: "口袋手记", create: "创造居民", resident: "认识新朋友", chat: resident?.name || "对话", about: "关于尾语" })[route.page]}</strong></div><div className="topbar-right"><span className="weather"><Icon name="sun" size={17}/>心情宜放晴</span><span className="all-ages"><Icon name="leaf" size={13}/>全年龄友好</span></div></header>
      {storageError ? <div className="storage-alert" role="alert">{storageError}<button onClick={exportBackup}>导出备份</button></div> : null}
      {!ready ? <div className="loading-page">正在打开小镇的门…</div> : <div key={`${route.page}-${route.id}`} className="page-enter">
        {route.page === "discover" ? <Discover residents={residents} favorites={workspace.favorites} toggleFavorite={toggleFavorite} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter}/> : null}
        {route.page === "resident" && resident ? <ResidentDetail resident={resident} favorite={workspace.favorites.includes(resident.id)} toggleFavorite={() => toggleFavorite(resident.id)}/> : null}
        {route.page === "chat" && resident ? <Chat key={resident.id} resident={resident} conversation={workspace.conversations[resident.id]} mode={mode} updateConversation={updateConversation} saveNote={saveNote} onReset={() => setConfirmReset(true)}/> : null}
        {["resident", "chat"].includes(route.page) && !resident ? <Empty icon="paw" title="这位居民还没有搬来" text="去小镇里，认识一位已经在这里的朋友。" action="发现居民" onAction={() => go("discover")}/> : null}
        {route.page === "stories" ? <Stories residents={residents} conversations={workspace.conversations} onExport={exportBackup} onImport={(value) => { setWorkspace(value); setSavingEnabled(true); setStorageError(""); setToast("故事备份已恢复。"); }}/> : null}
        {route.page === "journal" ? <Journal notes={workspace.notes} onSave={saveNote} onDelete={(id) => setWorkspace((w) => ({ ...w, notes: w.notes.filter((n) => n.id !== id) }))}/> : null}
        {route.page === "create" ? <CreateResident count={workspace.customs.length} onCreated={(newResident) => { setWorkspace((w) => ({ ...w, customs: [...w.customs, newResident] })); setToast("新朋友搬来小镇了。"); go("resident", newResident.id); }}/> : null}
        {route.page === "about" ? <About mode={mode}/> : null}
      </div>}
      {route.page !== "chat" ? <footer className="page-footer"><span>PAWTALE · 把平凡日子，聊成喜欢的故事。</span><a href="#about">温柔相处的小约定 <Icon name="arrow" size={13}/></a></footer> : null}
    </main>
    {toast ? <div className="toast" role="status"><Icon name="check" size={17}/>{toast}</div> : null}
    <dialog ref={modalRef} className="confirm-dialog" onCancel={() => setConfirmReset(false)} onClose={() => setConfirmReset(false)}><div><span className="eyebrow">A NEW CHAPTER</span><h2>翻开新的一页？</h2><p>这会清空与{resident?.name}的当前对话。你可以先导出备份，口袋里的手记会保留。</p><div className="dialog-actions"><button className="text-button" onClick={() => setConfirmReset(false)}>继续原来的故事</button><button className="primary-button" onClick={() => { if (resident) setWorkspace((w) => { const conversations = { ...w.conversations }; delete conversations[resident.id]; return { ...w, conversations }; }); setConfirmReset(false); }}>开启新篇</button></div></div></dialog>
  </div>;
}

function Discover({ residents, favorites, toggleFavorite, query, setQuery, filter, setFilter }) {
  const list = residents.filter((r) => (filter === "all" || r.species === filter || (filter === "favorites" && favorites.includes(r.id))) && `${r.name}${r.job}${r.breed}${r.tags.join("")}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <section className="hero" aria-labelledby="hero-title"><img className="hero-art" src="/art/hero.webp" alt="穿着毛衣的橘猫书店店长与穿绿夹克的金毛邮差，在海边小镇的书店门口相遇" fetchPriority="high"/><div className="hero-wash"/><div className="hero-copy"><div className="eyebrow"><span/>WELCOME TO YOUR LITTLE WORLD</div><h1 id="hero-title">把日常，说给<br/>有尾巴的朋友。</h1><p>在这里，慢慢认识，认真倾听。<br/>和猫猫狗狗一起，把小日子过成故事。</p><a className="primary-button" href="#resident/milo">遇见第一位朋友 <Icon name="arrow" size={17}/></a><div className="hero-footnote"><span className="mini-paw"><Icon name="paw" size={15}/></span>不用想好开场，一句「你好」就很好。</div></div><span className="hero-corner">LIFE IS BETTER WITH A LITTLE TAIL.</span></section>
    <div className="intro-strip"><span><Icon name="leaf" size={17}/>没有必须完成的事，只有想见的朋友。</span><span>原创居民 <i/> 温暖陪伴 <i/> 自由叙事</span></div>
    <section className="residents-section" aria-labelledby="residents-title"><div className="section-heading"><div><span className="eyebrow">MEET THE NEIGHBORS</span><h2 id="residents-title">今天，想和谁说说话？</h2></div><label className="search-field"><Icon name="search" size={17}/><input placeholder="找一位合拍的朋友" aria-label="搜索居民" value={query} onChange={(e) => setQuery(e.target.value)}/>{query ? <button aria-label="清除搜索" onClick={() => setQuery("")}><Icon name="close" size={14}/></button> : null}</label></div>
      <div className="filter-row" role="group" aria-label="筛选居民">{[["all", "所有居民"], ["cat", "猫猫居民"], ["dog", "狗狗居民"], ["favorites", "我的收藏"]].map(([key, text]) => <button key={key} className={filter === key ? "selected" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === "favorites" ? <Icon name="heart" size={14}/> : null}{text}{key === "all" ? <span>{residents.length.toString().padStart(2, "0")}</span> : null}</button>)}</div>
      {list.length ? <div className="resident-grid">{list.map((r, i) => <article className="resident-card" key={r.id} style={{ "--card-delay": `${i * 70}ms` }}><div className="resident-image"><a href={`#resident/${r.id}`} aria-label={`认识${r.name}`}><img src={r.image} alt={`${r.breed}${r.name}，${r.job}`} loading="lazy"/></a><span className="image-label"><Icon name="pin" size={12}/>{r.location}</span><button className={`favorite-button ${favorites.includes(r.id) ? "favorited" : ""}`} aria-label={`${favorites.includes(r.id) ? "取消收藏" : "收藏"}${r.name}`} aria-pressed={favorites.includes(r.id)} onClick={() => toggleFavorite(r.id)}><Icon name="heart" size={17}/></button></div><div className="resident-info"><div className="resident-name"><a href={`#resident/${r.id}`}><h3>{r.name}<span>{r.english}</span></h3></a><span>{r.breed} · {r.job}</span></div><p>{r.line}</p><div className="resident-bottom"><span>{r.tags.join(" / ")}</span><a href={`#chat/${r.id}`} aria-label={`和${r.name}聊聊`} className="round-link"><Icon name="arrow" size={19}/></a></div></div></article>)}</div> : <Empty compact icon={filter === "favorites" ? "heart" : "search"} title={filter === "favorites" && !query ? "把喜欢的朋友，留在这里" : "还没有找到合拍的朋友"} text={filter === "favorites" && !query ? "点一下居民照片上的爱心，下次就能很快找到。" : "试试其他名字、职业，或者看看所有居民。"} action="看看所有居民" onAction={() => { setQuery(""); setFilter("all"); }}/>}
    </section>
    <section className="town-story"><div className="story-art"><img src="/art/sunny.webp" alt="阿晴带着明信片和小雏菊走在海风里" loading="lazy"/></div><div><span className="eyebrow">A LITTLE ADVENTURE</span><h2>{TOWN_STORY.title}</h2><p>{TOWN_STORY.subtitle}</p><a href="#chat/sunny" className="inline-link">走进这段故事 <Icon name="arrow" size={17}/></a></div><span className="story-number">01<br/><small>TOWN TALES</small></span></section>
  </>;
}

function ResidentDetail({ resident: r, favorite, toggleFavorite }) {
  return <section className="detail-page"><a className="back-link" href="#discover"><Icon name="back" size={16}/>回到小镇</a><div className="detail-layout"><div className="detail-art"><img src={r.image} alt={`${r.name}在${r.location}`} fetchPriority="high"/><span><Icon name="pin" size={15}/>{r.location}</span></div><div className="detail-copy"><span className="eyebrow">A FRIEND YOU HAVEN’T MET YET</span><div className="detail-name"><h1>{r.name}<span>{r.english}</span></h1><button className={`outline-icon ${favorite ? "favorited" : ""}`} aria-label={favorite ? "取消收藏" : "收藏这位居民"} aria-pressed={favorite} onClick={toggleFavorite}><Icon name="heart"/></button></div><p className="resident-occupation">{r.breed} / {r.job}</p><h2>“{r.line}”</h2><p className="detail-description">{r.description}</p><div className="detail-tags">{r.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="current-chapter"><span className="eyebrow">LIFE LATELY</span><h3>最近在忙的小事</h3><p>{r.goal}</p></div><a href={`#chat/${r.id}`} className="primary-button">和{r.name}打个招呼 <Icon name="arrow" size={17}/></a><p className="detail-note">一段友好的相遇，从你愿意说的话开始。</p>{r.id.startsWith("custom-") ? <p className="detail-note">原创居民暂用公共示意插画。</p> : null}</div></div></section>;
}

function Chat({ resident: r, conversation, mode, updateConversation, saveNote, onReset }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const requestRef = useRef(null);
  const messages = conversation?.messages || [{ role: "assistant", content: r.opening }];
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" }); }, [messages.length, busy]);
  useEffect(() => () => requestRef.current?.abort(), []);

  async function send(text) {
    if (requestRef.current || !text.trim()) return;
    const content = text.trim();
    if (content.length > 2000) { setError("每次最多写 2000 字，慢慢说就好。"); return; }
    const controller = new AbortController(); requestRef.current = controller;
    const history = [...messages, { role: "user", content }];
    setBusy(true); setPendingText(content); setError(""); setDraft("");
    // Save only a complete turn. A failed request keeps the draft for retry.
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId: r.id.startsWith("custom-") ? "custom" : r.id, ...(r.id.startsWith("custom-") ? { customResident: r } : {}), messages: history.slice(-40) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(150000)]) });
      const data = await response.json();
      if (!response.ok || typeof data.text !== "string") throw new Error(data.error || "消息还没送达，请再试一次。");
      updateConversation(r.id, [...history, { role: "assistant", content: data.text }], data.mode);
    } catch (e) { if (e.name !== "AbortError") { setError(e.name === "TimeoutError" ? "这次等得有点久，消息还没有送达。可以再试一次。" : e.message); setDraft(content); } }
    finally { if (requestRef.current === controller) { requestRef.current = null; setPendingText(""); setBusy(false); } }
  }
  const roundCount = messages.filter((m) => m.role === "user").length;
  return <div className="chat-layout"><section className="conversation-pane" aria-label={`与${r.name}的故事`}><header className="conversation-header"><a href={`#resident/${r.id}`} className="icon-button" aria-label="返回居民详情"><Icon name="back"/></a><img src={r.image} alt="" className="chat-avatar"/><div><h1>{r.name}<span>{r.english}</span></h1><p>{r.location} · {r.label}</p></div><button className="text-button new-chapter" onClick={onReset} disabled={busy}><Icon name="plus" size={15}/>新篇</button></header><div className="conversation-scroll"><div className="story-time"><span/>{r.location} · 故事的这一页<span/></div><div className="mode-note"><Icon name="leaf" size={14}/>{mode === "demo" ? "本地故事体验 · 回复来自预写分支，尚未连接 AI" : mode === "model" ? "AI 居民 · 故事由你们一起写下" : mode === "loading" ? "正在确认对话服务…" : "对话服务暂不可用，请稍后重试"}</div><div className="messages" aria-live="polite">{(busy && pendingText ? [...messages, { role: "user", content: pendingText }] : messages).map((message, i) => <div key={`${i}-${message.role}`} className={`message ${message.role}`}><div className="message-author">{message.role === "user" ? "你" : r.name}<span>{message.role === "assistant" ? "·" : ""}</span></div><div className="message-content">{message.content}</div>{message.role === "assistant" ? <button className="save-moment" onClick={() => saveNote(message.content, `与${r.name}的故事`)} aria-label={`收藏第${i + 1}条回复到手记`}><Icon name="note" size={14}/>收进手记</button> : null}</div>)}{busy ? <div className="typing" role="status">{r.name}正在想一想<span/><span/><span/></div> : null}<div ref={bottomRef}/></div></div><div className="composer-area">{!roundCount ? <div className="suggested-prompts">{r.prompts.map((p) => <button key={p} onClick={() => send(p)} disabled={busy || mode === "unavailable" || mode === "loading"}>{p}<Icon name="arrow" size={13}/></button>)}</div> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}<form className="composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}><textarea aria-label={`给${r.name}的消息`} placeholder={`和${r.name}说点什么…`} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }}/><button type="submit" aria-label="发送消息" disabled={!draft.trim() || busy || mode === "loading" || mode === "unavailable"}><Icon name="send" size={19}/></button></form><div className="composer-caption"><span>Enter 发送 · Shift + Enter 换行</span><span>虚构角色 · 全年龄故事</span></div></div></section><aside className="chat-context"><img src={r.image} alt={`${r.name}的日常`} className="context-portrait"/><div className="context-copy"><span className="eyebrow">OUR LITTLE CHAPTER</span><h2>慢慢来，<br/>故事会有回声。</h2><div className="context-divider"/><span className="context-label">眼前的小计划</span><p>{r.goal}</p><span className="context-label">我们聊了</span><strong className="round-count">{roundCount.toString().padStart(2, "0")}<small>回合日常</small></strong><p className="context-footnote">对话只保存在此浏览器。<br/>喜欢的话，记得收进手记。</p></div></aside></div>;
}

function Stories({ residents, conversations, onExport, onImport }) {
  const [importError, setImportError] = useState("");
  const [importCandidate, setImportCandidate] = useState(null);
  const importRef = useRef(null);
  const items = Object.entries(conversations).filter(([id]) => residents.some((r) => r.id === id)).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  async function readImport(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try { if (file.size > 3000000) throw new Error("备份文件过大。"); const data = parseWorkspace(await file.text()); setImportCandidate(data); setImportError(""); }
    catch { setImportError("这个文件不是可读取的尾语备份，请选择导出的 JSON 文件。"); }
  }
  return <section className="collection-page"><PageHeading eyebrow="STORIES WE SHARE" title="故事，还在继续。" description="每一次认真说过的话，都在这里留下一页。"><button className="subtle-button" onClick={() => importRef.current?.click()}><Icon name="plus" size={15}/>导入备份</button><button className="subtle-button" onClick={onExport}><Icon name="download" size={16}/>导出故事</button></PageHeading><input type="file" accept="application/json,.json" hidden ref={importRef} onChange={readImport}/>{importError ? <p className="form-error" role="alert">{importError}</p> : null}{importCandidate ? <div className="import-confirm" role="alert"><p>准备恢复 {Object.keys(importCandidate.conversations).length} 段故事、{importCandidate.notes.length} 条手记。这会替换当前浏览器中的尾语内容。</p><button className="primary-button" onClick={() => { onImport(importCandidate); setImportCandidate(null); }}>确认恢复</button><button className="text-button" onClick={() => setImportCandidate(null)}>取消</button></div> : null}{items.length ? <div className="story-list">{items.map(([id, c]) => { const r = residents.find((r) => r.id === id); return <a key={id} href={`#chat/${id}`} className="saved-story"><img src={r.image} alt=""/><div><span className="eyebrow">{r.location}</span><h2>和{r.name}的日常</h2><p>{c.messages.at(-1)?.content}</p><small>{dateLabel(c.updatedAt)} · {c.messages.filter((m) => m.role === "user").length} 回合{c.mode === "demo" ? " · 本地故事体验" : ""}</small></div><span className="continue-story">继续故事 <Icon name="arrow" size={19}/></span></a>; })}</div> : <Empty icon="book" title="我们的第一页，还空着" text="去和一位居民打个招呼。对话会自动保存在这里。" action="去认识新朋友" onAction={() => go("discover")}/>}</section>;
}

function Journal({ notes, onSave, onDelete }) {
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState("");
  return <section className="collection-page"><PageHeading eyebrow="LITTLE THINGS, KEPT CLOSE" title="把喜欢的瞬间，放进口袋。" description="一句话、一点心情，或者今天的小小发现。"/><form className="journal-composer" onSubmit={(e) => { e.preventDefault(); if (onSave(draft)) setDraft(""); }}><textarea aria-label="写下今天的手记" placeholder="今天，有什么想记住的小事？" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={3000}/><div><span>只保存在你的浏览器里</span><button className="primary-button" disabled={!draft.trim()}><Icon name="plus" size={16}/>收进口袋</button></div></form>{notes.length ? <div className="notes-list">{notes.map((n) => <article className="journal-note" key={n.id}><div className="note-date"><span>{dateLabel(n.createdAt)}</span><small>{n.source}</small></div><p>{n.content}</p>{deleting === n.id ? <div className="delete-confirm"><span>移除这条手记？</span><button onClick={() => { onDelete(n.id); setDeleting(""); }}>移除</button><button onClick={() => setDeleting("")}>保留</button></div> : <button className="icon-button delete-note" aria-label="删除这条手记" onClick={() => setDeleting(n.id)}><Icon name="trash" size={16}/></button>}</article>)}</div> : <Empty compact icon="leaf" title="小小的事，也值得被记住" text="写下第一条手记，或者把居民的一句话收进来。"/>}</section>;
}

function CreateResident({ count, onCreated }) {
  const [species, setSpecies] = useState("cat");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event) {
    event.preventDefault(); if (busy) return;
    if (count >= 30) { setError("当前浏览器最多保存 30 位原创居民。"); return; }
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/characters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, species }), signal: AbortSignal.timeout(60000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "居民还没准备好，请再试一次。");
      onCreated({ ...result.resident, id: `custom-${crypto.randomUUID()}` });
    } catch (e) { setError(e.name === "TimeoutError" ? "检查资料用的时间有点长，请再试一次。" : e.message); }
    finally { setBusy(false); }
  }
  return <section className="create-page"><PageHeading eyebrow="MAKE ROOM FOR SOMEONE NEW" title="小镇，等一位新朋友。" description="给他一份生活，也留一点让故事发生的空间。"/><div className="create-layout"><form className="resident-form" onSubmit={create}><fieldset><legend>先认识一下</legend><div className="species-choice" role="group" aria-label="居民种族"><button type="button" className={species === "cat" ? "chosen" : ""} aria-pressed={species === "cat"} onClick={() => setSpecies("cat")}><Icon name="paw"/>一位猫猫</button><button type="button" className={species === "dog" ? "chosen" : ""} aria-pressed={species === "dog"} onClick={() => setSpecies("dog")}><Icon name="paw"/>一位狗狗</button></div><div className="form-two-columns"><label>名字<input name="name" placeholder="大家怎么称呼他？" maxLength={12} required/></label><label>在小镇做什么<input name="job" placeholder="例如：面包师、修理匠" maxLength={24} required/></label></div><label>性格与说话方式<textarea name="personality" placeholder="遇到朋友遇到麻烦时，他会怎么做？有什么自己的小习惯？" maxLength={500} required/></label></fieldset><fieldset><legend>让故事开始</legend><label>眼前的小目标<textarea name="goal" placeholder="例如：想在周末前，烤出一款适合野餐的面包。" maxLength={200} required/></label><label>第一次见面的开场<textarea name="opening" placeholder="他正在做什么？你可以怎样加入？留一个小小的选择。" maxLength={500} required className="opening-input"/></label></fieldset>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="primary-button" disabled={busy}>{busy ? "正在准备搬家…" : "让新朋友搬来小镇"}<Icon name="arrow" size={17}/></button><p className="form-footnote">居民为成年拟人化猫狗，故事须适合全年龄。资料保存在本浏览器。</p></form><aside className="create-aside"><img src={species === "cat" ? "/art/milo.webp" : "/art/sunny.webp"} alt="原创居民的公共示意插画"/><div><span className="eyebrow">EVERY TAIL HAS A TALE</span><h2>不必完美，<br/>有自己的生活就好。</h2><p>一个想完成的小目标，<br/>一件愿意和人分享的事。<br/>就是好故事的开始。</p><small>目前使用公共示意插画。</small></div></aside></div></section>;
}

function About({ mode }) {
  return <section className="about-page"><img src="/mark.svg" width="60" height="60" alt="尾语标志"/><span className="eyebrow">PAWTALE · 尾语</span><h1>有尾巴的朋友，<br/>有温度的日常。</h1><p>尾语是一个原创猫狗居民小镇。每位居民有自己的生活，你可以走近、倾听，或和他们一起完成一件小事。这里的角色与故事都是虚构的。</p><div className="about-rules"><article><Icon name="leaf"/><h2>温柔相处</h2><p>我们只写适合全年龄的日常、友谊与小冒险，不提供成人模式。尊重彼此，也保留和现实朋友相处的时间。</p></article><article><Icon name="note"/><h2>故事属于你</h2><p>当前对话、收藏与手记只保存在此浏览器。清除浏览器数据会移除故事，可以在「我的故事」导出或恢复备份。</p></article><article><Icon name="chat"/><h2>关于此刻的对话</h2><p>{mode === "model" ? "当前已连接独立模型。消息和角色设定将发送给所配置的模型服务，用于生成和检查回复。" : "当前是本地故事体验，回复来自预先写好的分支，尚未连接 AI 模型。故事仍可体验、收藏和保存。"}</p></article></div><a href="#discover" className="primary-button">回到小镇 <Icon name="arrow" size={17}/></a></section>;
}

function PageHeading({ eyebrow, title, description, children }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children ? <div className="page-heading-actions">{children}</div> : null}</div>; }
function Empty({ icon, title, text, action, onAction, compact = false }) { return <div className={`empty-state ${compact ? "compact" : ""}`}><div className="empty-icon"><Icon name={icon} size={30}/></div><h2>{title}</h2><p>{text}</p>{action ? <button className="inline-link" onClick={onAction}>{action}<Icon name="arrow" size={16}/></button> : null}</div>; }
