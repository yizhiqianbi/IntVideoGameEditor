import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { categories, characters, getCharacter, type Character, type Conversation, type CustomCharacter } from "./catalog";
import { emptyJourney, parseJourney, STORAGE_KEY, type Journey } from "./storage";

type IconName = "compass" | "chat" | "book" | "heart" | "plus" | "search" | "arrow" | "leaf" | "close" | "back" | "send" | "settings" | "sun" | "download" | "check";
function Icon({ name, size = 20, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  const paths: Record<IconName, ReactNode> = {
    compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/></>,
    chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 10h10M7 14h6"/>,
    book: <><path d="M12 5C8 2 3 3 2 4v15c3-2 7-1 10 1 3-2 7-3 10-1V4c-3-2-7-1-10 1ZM12 5v15"/><path d="M6 8h2M16 8h2"/></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>, leaf: <><path d="M20 3C5 2 2 9 6 16c7 4 14 0 14-13Z"/><path d="M4 21 15 10"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>, back: <path d="m14 5-7 7 7 7M7 12h14"/>, send: <><path d="m3 3 19 9-19 9 3-9Z"/><path d="M6 12h16"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>, check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? "wide" : ""}`} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close"/></button></div>{children}</dialog>;
}
async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(100_000) });
  const data = await res.json(); if (!res.ok) throw new Error(data.error || "暂时没能连接上，请重试。"); return data;
}
const uid = () => crypto.randomUUID();
const navItems: { id: View; label: string; icon: IconName }[] = [{ id: "discover", label: "发现", icon: "compass" }, { id: "chat", label: "消息", icon: "chat" }, { id: "stories", label: "故事书", icon: "book" }, { id: "favorites", label: "我的收藏", icon: "heart" }];
type View = "discover" | "chat" | "stories" | "favorites";
const getView = (): View => navItems.find(n => `#${n.id}` === window.location.hash)?.id ?? "discover";

export default function App() {
  const [view, setView] = useState<View>(getView);
  const [journey, setJourney] = useState<Journey>(emptyJourney);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部相遇");
  const [sort, setSort] = useState("recommended");
  const [detail, setDetail] = useState<Character | null>(null);
  const [modal, setModal] = useState<"create" | "about" | "settings" | null>(null);
  const [status, setStatus] = useState<"loading" | "demo" | "live" | "offline">("loading");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [draft, setDraft] = useState("");
  const [baseId, setBaseId] = useState("lin");
  const [creatorName, setCreatorName] = useState(characters[0].name);
  const [creatorDescription, setCreatorDescription] = useState(characters[0].description);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const statusRequest = useRef(0);
  function refreshStatus() {
    const id = ++statusRequest.current; setStatus("loading");
    fetch("/api/status").then(async r => { if (!r.ok) throw new Error(); const d = await r.json(); if (!["demo", "live"].includes(d.mode)) throw new Error(); if (id === statusRequest.current) setStatus(d.mode); }).catch(() => { if (id === statusRequest.current) setStatus("offline"); });
  }
  useEffect(() => {
    try { const saved = parseJourney(localStorage.getItem(STORAGE_KEY)); setJourney(saved); setActiveId(saved.activeConversationId ?? null); } catch { setStorageError("本地旅程暂时无法读取。原始数据已保留，你可以在旅程设置中导出备份。"); }
    setLoaded(true); refreshStatus();
    const change = () => setView(getView()); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => { if (!loaded || storageError) return; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(journey)); } catch { setStorageError("浏览器没有保存成功。请导出旅程备份，避免刷新后丢失。"); } }, [journey, loaded, storageError]);
  useEffect(() => { if (loaded && activeId) setJourney(s => s.activeConversationId === activeId ? s : { ...s, activeConversationId: activeId }); }, [activeId, loaded]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 3800); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "end" }); }, [activeId, journey.conversations, view]);
  function navigate(next: View) { window.location.hash = next; setView(next); setQuery(""); setChatError(""); }
  function favorite(id: string) { setJourney(s => ({ ...s, favorites: s.favorites.includes(id) ? s.favorites.filter(f => f !== id) : [...s.favorites, id] })); }
  function launch(character: Character, custom?: CustomCharacter) {
    if (storageError) { setNotice("请先在旅程设置中处理保存问题。"); return; }
    const mode = status === "live" ? "live" : "demo";
    const existing = journey.conversations.find(c => c.characterId === character.id && c.customId === custom?.id && c.mode === mode);
    let id = existing?.id;
    if (!id) {
      id = uid();
      const conversation: Conversation = { id, characterId: character.id, customId: custom?.id, mode, node: "start", updatedAt: Date.now(), messages: [{ id: uid(), role: "assistant", content: character.scenes.start.text }] };
      setJourney(s => ({ ...s, conversations: [conversation, ...s.conversations].slice(0, 80) }));
    }
    setActiveId(id); setDetail(null); setModal(null); setDraft(""); navigate("chat");
  }
  const active = journey.conversations.find(c => c.id === activeId) ?? journey.conversations[0];
  const activeCharacter = active ? getCharacter(active.characterId) : undefined;
  const activeCustom = journey.custom.find(c => c.id === active?.customId);
  const activeName = activeCustom?.name ?? activeCharacter?.name;
  async function send(choiceId?: string) {
    if (!active || busy || storageError) return;
    const conversationId = active.id;
    setBusy(true); setChatError("");
    try {
      const body = active.mode === "demo" ? { characterId: active.characterId, node: active.node, choiceId } : { characterId: active.characterId, message: draft, history: active.messages.slice(-16), ...(activeCustom ? { custom: activeCustom } : {}) };
      const result = await post("/api/chat", body);
      if (result.mode !== active.mode) throw new Error("服务模式已切换。请从发现页重新打开这位伙伴。");
      setJourney(s => ({ ...s, conversations: s.conversations.map(c => c.id !== conversationId ? c : { ...c, node: result.node ?? c.node, updatedAt: Date.now(), messages: [...c.messages, { id: uid(), role: "user" as const, content: result.userText }, { id: uid(), role: "assistant" as const, content: result.reply }].slice(-80) }) }));
      setDraft("");
    } catch (error) { setChatError(error instanceof Error ? error.message : "连接暂时中断了，原来的故事还在。"); }
    finally { setBusy(false); }
  }
  async function create(e: FormEvent) {
    e.preventDefault(); if (creating || storageError) return; setCreating(true); setCreateError("");
    try {
      const result = await post("/api/characters/review", { baseId, name: creatorName, description: creatorDescription });
      setJourney(s => ({ ...s, custom: [...s.custom, result.character].slice(-40) })); setModal(null); navigate("stories"); setNotice("新伙伴已加入你的故事书。");
    } catch (error) { setCreateError(error instanceof Error ? error.message : "暂时没能保存，请重试。"); }
    finally { setCreating(false); }
  }
  function exportJourney() {
    let raw = JSON.stringify(journey, null, 2);
    try { if (storageError) raw = localStorage.getItem(STORAGE_KEY) ?? raw; } catch { /* Export the in-memory journey if storage access is denied. */ }
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "晴屿-旅程备份.json"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const shown = characters.filter(c => (view !== "favorites" || journey.favorites.includes(c.id)) && (category === "全部相遇" || c.category === category) && `${c.name}${c.subtitle}${c.description}${c.tags.join("")}`.includes(query.trim())).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : 0);
  const statusLabel = status === "live" ? "AI 故事已连接" : status === "demo" ? "本地故事体验" : status === "offline" ? "连接暂时中断" : "正在连接小岛";
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#discover" onClick={() => navigate("discover")} aria-label="晴屿首页"><img src="/mark.svg" alt=""/><div><strong>晴屿<span>QINGYU</span></strong><small>让故事，温柔发生</small></div></a>
      <span className="sidebar-label">我的小岛</span>
      <nav aria-label="主导航">{navItems.map(item => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}><Icon name={item.icon}/><span>{item.label}</span>{item.id === "chat" && journey.conversations.length > 0 && <span className="nav-count">{journey.conversations.length}</span>}</button>)}</nav>
      <button className="create-nav" onClick={() => { setCreateError(""); setModal("create"); }}><Icon name="plus" size={18}/> 创作新伙伴</button>
      <div className="sidebar-bottom"><div className="island-note"><Icon name="sun" size={30}/><p>留一点时间，<br/>给想象中的小世界。</p><span>HAVE A LITTLE DAYDREAM</span></div><button className="profile" onClick={() => { setConfirmClear(false); setModal("settings"); }}><span className="profile-avatar">旅</span><span><strong>小岛旅人</strong><small>今天也很高兴遇见你</small></span><Icon name="settings" size={17}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><span className="topbar-mood"><Icon name="leaf" size={16}/> 属于你的故事小岛</span><div className="topbar-actions">{view !== "chat" && <label className="search"><Icon name="search" size={17}/><input aria-label="搜索伙伴或故事" placeholder="找一位伙伴，或一个故事" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="清空搜索" onClick={() => setQuery("")}><Icon name="close" size={14}/></button>}</label>}<button className={`connection ${status}`} onClick={() => setModal("about")}><span/>{statusLabel}</button></div></header>
      {storageError && <div role="alert" className="storage-warning">{storageError}<button onClick={() => setModal("settings")}>旅程设置</button></div>}
      <main className={view === "chat" ? "chat-main" : "content-main"}>
        {(view === "discover" || view === "favorites") && <div className="page-enter" key={view}>
          <div className="page-heading"><div><p className="eyebrow">{view === "discover" ? "A LITTLE HELLO, A NEW STORY" : "SOME HELLOS ARE WORTH KEEPING"}</p><h1>{view === "discover" ? <>今天，想遇见谁<span className="heading-dot">？</span></> : "把喜欢，留在这里"}</h1><p className="page-description">{view === "discover" ? "和有趣的灵魂聊聊天，让平常的一天多一点想象。" : "你收藏的小岛伙伴，随时都在故事里等你。"}</p></div><span className="handwritten">{view === "discover" ? "a little joy, every day ♡" : "saved with love ♡"}</span></div>
          {view === "discover" && <section className="hero" aria-label="今日故事推荐"><img className="hero-art" src="/art/island.webp" alt="海边小岛上的书屋、花园与围着绿围巾的小猫" fetchPriority="high"/><div className="hero-copy"><span className="hero-kicker"><span/> 小岛今日营业中</span><h2>在故事里，<br/>遇见一点小美好。</h2><p>一位新朋友，一段小冒险。<br/>下一页，和你一起写。</p><button className="primary" onClick={() => setDetail(characters[2])}>开启今日故事 <Icon name="arrow" size={17}/></button></div><span className="hero-caption">YOUR LITTLE ISLAND OF STORIES</span></section>}
          <section className="discovery-section" aria-labelledby="discover-title"><div className="section-heading"><div><h2 id="discover-title">{view === "discover" ? "慢慢认识，刚刚好" : "喜欢的伙伴"}<span>{view === "discover" ? "每一次相遇，都有新的可能" : `${journey.favorites.length} 位伙伴已收藏`}</span></h2></div><select aria-label="伙伴排序" value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">为你推荐</option><option value="name">按名字排序</option></select></div>
            <div className="filters" aria-label="伙伴分类">{["全部相遇", ...categories].map((c, i) => <button key={c} onClick={() => setCategory(c)} className={category === c ? "selected" : ""} aria-pressed={category === c}>{i === 0 && <Icon name="compass" size={15}/>} {c}</button>)}</div>
            {shown.length > 0 ? <div className="character-grid">{shown.map((c, i) => <article className="character-card" style={{ animationDelay: `${i * 65}ms` }} key={c.id}><div className="character-image" style={{ background: c.color }}><button className="image-open" onClick={() => setDetail(c)} aria-label={`认识${c.name}`}><img src={c.art} alt={`${c.name}的原创故事插画`} loading="lazy"/></button><span className="category-badge">{c.category}</span><button className={`favorite ${journey.favorites.includes(c.id) ? "saved" : ""}`} onClick={() => favorite(c.id)} aria-label={`${journey.favorites.includes(c.id) ? "取消收藏" : "收藏"}${c.name}`} aria-pressed={journey.favorites.includes(c.id)}><Icon name="heart" size={17} filled={journey.favorites.includes(c.id)}/></button></div><button className="character-copy" onClick={() => setDetail(c)}><span className="character-title">{c.name}<Icon name="arrow" size={17}/></span><span className="character-subtitle">{c.subtitle}</span><span className="tags">{c.tags.map(t => <span key={t}># {t}</span>)}</span></button></article>)}</div> : <div className="empty-state"><Icon name={view === "favorites" ? "heart" : "search"} size={34}/><h3>{query ? "还没有找到这位伙伴" : view === "favorites" ? "还没有收藏的小岛伙伴" : "这个分类里暂时没有伙伴"}</h3><p>{query ? "试试名字、花店、森林或海边。" : "在喜欢的伙伴上点一下爱心，就能在这里再见。"}</p><button className="text-button" onClick={() => { setQuery(""); setCategory("全部相遇"); if (view === "favorites") navigate("discover"); }}>去小岛逛逛 <Icon name="arrow" size={16}/></button></div>}
          </section>
          {view === "discover" && <section className="story-invite"><div className="invite-icon"><Icon name="book" size={28}/></div><div><span className="eyebrow">A STORY CAN START WITH YOU</span><h3>心里住着一个角色？</h3><p>给 TA 一个名字，也给故事一个开始。</p></div><button className="secondary" onClick={() => { setCreateError(""); setModal("create"); }}>创作我的伙伴 <Icon name="plus" size={16}/></button></section>}
        </div>}
        {view === "stories" && <div className="page-enter"><div className="page-heading"><div><p className="eyebrow">ONE PAGE, ONE LITTLE ADVENTURE</p><h1>你的小岛故事书</h1><p className="page-description">选择一个开头，每一个决定，都能带故事去不同的地方。</p></div><Icon name="book" size={36}/></div>
          <div className="story-list">{characters.filter(c => `${c.story}${c.name}${c.storyDescription}`.includes(query.trim())).map((c, i) => { const conversation = journey.conversations.find(s => s.characterId === c.id); return <button className="story-row" key={c.id} onClick={() => launch(c)}><span className="story-number">0{i + 1}</span><img src={c.art} alt=""/><span className="story-row-copy"><span className="eyebrow">{c.category} · {c.duration}</span><strong>{c.story}</strong><span>{c.storyDescription}</span>{conversation && <small><Icon name="leaf" size={13}/>{c.scenes[conversation.node]?.chapter ?? "故事进行中"}</small>}</span><span className="story-row-action">{conversation ? "继续故事" : "翻开故事"}<Icon name="arrow" size={18}/></span></button>; })}</div>
          {query && !characters.some(c => `${c.story}${c.name}${c.storyDescription}`.includes(query.trim())) && <div className="empty-state"><h3>没有找到这个故事</h3><p>试试花店、海风或星星。</p></div>}
          <div className="section-heading custom-heading"><h2>我创作的伙伴<span>{journey.custom.length} 位私人伙伴</span></h2><button className="text-button" onClick={() => setModal("create")}><Icon name="plus" size={16}/> 新建伙伴</button></div>
          {journey.custom.length > 0 ? <div className="custom-list">{journey.custom.map(c => { const base = getCharacter(c.baseId)!; return <button key={c.id} onClick={() => launch(base, c)}><img src={base.art} alt=""/><span><strong>{c.name}</strong><small>{c.description}</small></span><Icon name="arrow" size={18}/></button>; })}</div> : <div className="creator-empty"><Icon name="leaf" size={23}/><p>这里还空着，留给你的第一个小小灵感。</p><button className="text-button" onClick={() => setModal("create")}>从一个安心模板开始 <Icon name="arrow" size={16}/></button></div>}
        </div>}
        {view === "chat" && <div className="chat-layout page-enter"><aside className="conversation-list"><div className="conversation-heading"><h1>消息</h1><button className="icon-button" aria-label="认识新伙伴" onClick={() => navigate("discover")}><Icon name="plus"/></button></div><p className="conversation-description">故事，接着上次的地方。</p>{[...journey.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(c => { const character = getCharacter(c.characterId)!; const custom = journey.custom.find(d => d.id === c.customId); return <button className={`conversation-item ${active?.id === c.id ? "selected" : ""}`} key={c.id} onClick={() => { if (!busy) { setActiveId(c.id); setDraft(""); setChatError(""); } }} aria-pressed={active?.id === c.id} disabled={busy}><img src={character.art} alt=""/><span><strong>{custom?.name ?? character.name}<small>{c.mode === "demo" ? "故事" : "AI"}</small></strong><small>{c.messages.at(-1)?.content.replace(/\n/g, " ")}</small></span></button>; })}{journey.conversations.length === 0 && <p className="list-empty">你的第一段故事，<br/>从一次相遇开始。</p>}</aside>
          {active && activeCharacter ? <section className="chat-workspace"><header className="chat-heading"><img src={activeCharacter.art} alt=""/><div><h2>{activeName}</h2><p>{active.mode === "demo" ? activeCharacter.scenes[active.node]?.chapter : "AI 虚构角色 · 全年龄故事"}</p></div><button className="icon-button" aria-label="查看伙伴介绍" onClick={() => setDetail(activeCharacter)}><Icon name="book"/></button></header><div className="messages" aria-live="polite"><p className="chat-disclosure"><Icon name="leaf" size={14}/>{active.mode === "demo" ? "这是预先创作的分支故事，选择不同，下一页也不同。" : "这是 AI 虚构角色。消息会经过内容检查，再传给模型。"}</p>{active.messages.map(m => <div className={`message ${m.role}`} key={m.id}>{m.role === "assistant" && <img src={activeCharacter.art} alt=""/>}<div><span className="message-name">{m.role === "assistant" ? activeName : "你"}</span><div className="bubble">{m.content}</div></div></div>)}{busy && <div className="typing"><span/><span/><span/><small>故事正在继续…</small></div>}<div ref={endRef}/></div><div className="composer">{chatError && <p className="form-error" role="alert">{chatError}</p>}{active.mode === "demo" ? <><p className="composer-label">你想怎么回应？</p><div className="choices">{activeCharacter.scenes[active.node]?.choices.map(c => <button key={c.id} className="choice" disabled={busy || status === "offline" || !!storageError} onClick={() => send(c.id)}>{c.label}<Icon name="arrow" size={16}/></button>)}</div><small className="composer-note">你的选择与故事进度，仅保存在当前浏览器。</small></> : <form onSubmit={e => { e.preventDefault(); send(); }}><label className="sr-only" htmlFor="message">给伙伴的消息</label><textarea id="message" value={draft} maxLength={1200} onChange={e => setDraft(e.target.value)} placeholder={`和${activeName}说说话…`} disabled={busy} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (draft.trim()) send(); } }}/><button className="send-button" type="submit" disabled={busy || !draft.trim() || !!storageError} aria-label="发送消息"><Icon name="send" size={19}/></button><small className="composer-note">Enter 发送 · Shift + Enter 换行 · 内容检查通过后保存</small></form>}</div></section> : <div className="chat-empty"><img src="/art/island.webp" alt="宁静的故事小岛"/><h2>有人在故事里，等你说声你好。</h2><p>先认识一位伙伴，再一起翻开下一页。</p><button className="primary" onClick={() => navigate("discover")}>去认识新伙伴 <Icon name="arrow" size={17}/></button></div>}
        </div>}
      </main>
      {view !== "chat" && <footer className="footer"><span><Icon name="leaf" size={14}/> 故事可以天马行空，相遇始终温柔。</span><button onClick={() => setModal("about")}>关于晴屿 <span>↗</span></button></footer>}
    </div>
    <nav className="mobile-nav" aria-label="手机主导航">{navItems.map(n => <button key={n.id} className={view === n.id ? "active" : ""} onClick={() => navigate(n.id)} aria-current={view === n.id ? "page" : undefined}><Icon name={n.icon} size={20}/><span>{n.label}</span></button>)}<button onClick={() => { setCreateError(""); setModal("create"); }}><Icon name="plus" size={20}/><span>创作</span></button></nav>
    {detail && <Modal title={`认识${detail.name}`} wide onClose={() => setDetail(null)}><div className="character-detail"><img className="detail-portrait" src={detail.art} alt={detail.name}/><div className="detail-copy"><span className="eyebrow">{detail.category} · 小岛伙伴</span><h3>{detail.name}</h3><p className="detail-subtitle">{detail.subtitle}</p><p>{detail.description}</p><div className="detail-story"><Icon name="book" size={21}/><div><strong>{detail.story}</strong><small>{detail.duration} · 由你的选择展开</small></div></div><div className="detail-actions"><button className="primary" onClick={() => launch(detail)} disabled={!loaded}>和 TA 开始故事 <Icon name="arrow" size={17}/></button><button className={`secondary ${journey.favorites.includes(detail.id) ? "is-saved" : ""}`} onClick={() => favorite(detail.id)}><Icon name="heart" size={17} filled={journey.favorites.includes(detail.id)}/>{journey.favorites.includes(detail.id) ? "已收藏" : "收藏"}</button></div><small className="fine-print">原创虚构角色 · 全年龄内容</small></div></div></Modal>}
    {modal === "create" && <Modal title="创作一位新伙伴" onClose={() => !creating && setModal(null)}><p className="modal-description">先选一个故事原型，再慢慢赋予 TA 你的灵感。</p><form className="creator-form" onSubmit={create}><label>故事原型</label><div className="template-picker">{characters.map(c => <button type="button" key={c.id} className={baseId === c.id ? "selected" : ""} aria-pressed={baseId === c.id} onClick={() => { setBaseId(c.id); setCreatorName(c.name); setCreatorDescription(c.description); }}><img src={c.art} alt=""/><span>{c.name}</span>{baseId === c.id && <span className="template-check"><Icon name="check" size={12}/></span>}</button>)}</div><label htmlFor="creator-name">伙伴的名字</label><input id="creator-name" value={creatorName} onChange={e => setCreatorName(e.target.value)} maxLength={16} required readOnly={status !== "live"}/><label htmlFor="creator-description">关于 TA</label><textarea id="creator-description" value={creatorDescription} onChange={e => setCreatorDescription(e.target.value)} maxLength={600} required rows={4} readOnly={status !== "live"}/><p className="form-hint"><Icon name="leaf" size={16}/>{status === "live" ? "角色设定检查通过后，将保存为你的私人伙伴。" : "当前使用安心模板。连接 AI 与内容检查服务后，可以自由编辑名字和设定。"}</p>{createError && <p className="form-error" role="alert">{createError}</p>}<button type="submit" className="primary full" disabled={creating || !!storageError}>{creating ? "正在检查并保存…" : "加入我的故事书"}<Icon name="plus" size={17}/></button><small className="fine-print">仅保存在此浏览器，不会公开发布。</small></form></Modal>}
    {modal === "about" && <Modal title="你好，这里是晴屿。" onClose={() => setModal(null)}><div className="about-art"><img src="/art/island.webp" alt="晴屿的海边小书屋"/></div><p className="about-lead">留一座小岛，给想象与温柔。</p><p className="modal-description">晴屿 Qingyu 是一个全年龄的角色与故事空间。在这里，可以认真说话，也可以一起开始一场小小冒险。</p><div className="about-rules"><p><Icon name="check" size={17}/> 只有适合全年龄的故事与角色</p><p><Icon name="check" size={17}/> 不提供成人内容、成人模式或露骨媒体</p><p><Icon name="check" size={17}/> 角色是虚构的，生活由你自己决定</p></div><div className="service-state"><span className="eyebrow">当前体验</span><strong>{statusLabel}</strong><p>{status === "live" ? "自由输入与角色设定会发送给独立配置的模型和内容检查服务。输入与回复均检查通过后才保存。" : "预先写好的分支故事可以直接体验。自由聊天需单独配置模型和内容检查服务，未连接时不会调用 AI。"}</p><button className="text-button" onClick={refreshStatus}>重新检查连接 <Icon name="arrow" size={15}/></button></div><button className="text-button" onClick={() => { setConfirmClear(false); setModal("settings"); }}>管理我的本地旅程 <Icon name="settings" size={16}/></button></Modal>}
    {modal === "settings" && <Modal title="我的小岛旅程" onClose={() => setModal(null)}><p className="modal-description">收藏、伙伴和故事进度保存在这个浏览器中。清理浏览器数据会让它们消失，记得给故事留一份备份。</p><dl className="journey-stats"><div><dt>收藏伙伴</dt><dd>{journey.favorites.length}</dd></div><div><dt>进行的故事</dt><dd>{journey.conversations.length}</dd></div><div><dt>创作伙伴</dt><dd>{journey.custom.length}</dd></div></dl><button className="secondary full" onClick={exportJourney}><Icon name="download" size={17}/> 导出旅程备份</button><div className="clear-data">{!confirmClear ? <button className="text-button" onClick={() => setConfirmClear(true)}>清空这个浏览器中的晴屿旅程</button> : <><p>这会删除晴屿的收藏、伙伴和对话，无法撤销。建议先导出备份。</p><div><button className="secondary" onClick={() => setConfirmClear(false)}>先保留</button><button className="danger-button" onClick={() => { try { localStorage.removeItem(STORAGE_KEY); setStorageError(""); setJourney(emptyJourney()); setActiveId(null); setConfirmClear(false); setModal(null); navigate("discover"); setNotice("已清空晴屿旅程，可以重新出发了。"); } catch { setNotice("浏览器不允许清理数据，请检查浏览器设置。"); } }}>确认清空晴屿数据</button></div></>}</div><small className="fine-print">此操作仅涉及晴屿，不影响其他应用的数据。</small></Modal>}
    {notice && <div className="toast" role="status"><Icon name="check" size={17}/>{notice}</div>}
  </div>;
}
