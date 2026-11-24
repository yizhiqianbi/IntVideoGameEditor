"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type Group = { id: string; label: string };
type Row = {
  id: string;
  label: string;
  group: string;
  groupLabel: string;
  kind: "image" | "video";
  source: "library" | "upload";
  content: string;
  prompt: string;
  listed: boolean;
  cover: string;
};

type Draft = {
  id: string;
  kind: Row["kind"];
  source: Row["source"];
  label: string;
  group: string;
  content: string;
  prompt: string;
  listed: boolean;
  fileName: string;
};

export default function AdminPage() {
  const [phase, setPhase] = useState<"loading" | "login" | "ready">("loading");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [templates, setTemplates] = useState<Row[]>([]);
  const [kind, setKind] = useState<Row["kind"]>("image");
  const [shelfGroup, setShelfGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState("");
  const [frame, setFrame] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<"" | "upload" | "remove" | "save">("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch("/api/admin/templates");
    if (response.status === 401) {
      setPhase("login");
      return;
    }
    const payload = await response.json().catch(() => null) as { error?: string; groups?: Group[]; templates?: Row[] } | null;
    if (!response.ok || !payload?.templates || !payload.groups) {
      setError(payload?.error || "后台没有打开。");
      setPhase("login");
      return;
    }
    setGroups(payload.groups);
    setTemplates(payload.templates);
    setPhase("ready");
    setError("");
  }

  useEffect(() => { void load().catch(() => { setError("页面连不上服务。刷新后再试一次。"); setPhase("login"); }); }, []);

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return templates.filter(item => item.kind === kind
      && (kind !== "image" || shelfGroup === "all" || item.group === shelfGroup)
      && (!text || `${item.label} ${item.groupLabel}`.toLowerCase().includes(text)));
  }, [templates, kind, query, shelfGroup]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "口令不对。");
      setPassword("");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "口令不对。");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending("upload");
    setError("");
    try {
      const response = await fetch("/api/admin/templates", { method: "POST", body: form });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "模板没有存上。");
      setLabel("");
      setFrame("");
      setFileName("");
      formElement.reset();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "模板没有存上。");
    } finally {
      setPending("");
    }
  }

  function openEditor(item: Row) {
    setNotice("");
    setDraft({
      id: item.id,
      kind: item.kind,
      source: item.source,
      label: item.label,
      group: item.group,
      content: item.content,
      prompt: item.prompt,
      listed: item.listed,
      fileName: "",
    });
    requestAnimationFrame(() => document.getElementById("template-editor")?.scrollIntoView({ block: "start" }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const form = new FormData(event.currentTarget);
    form.set("id", draft.id);
    form.set("kind", draft.kind);
    form.set("label", draft.label);
    form.set("group", draft.group);
    form.set("content", draft.content);
    form.set("prompt", draft.prompt);
    if (draft.listed) form.set("listed", "1");
    setPending("save");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/templates", { method: "PATCH", body: form });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "模板没有存上。");
      setDraft({ ...draft, fileName: "" });
      setNotice("已保存。前台画廊和生成会用这份封面、内容和 Prompt。");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "模板没有存上。");
    } finally {
      setPending("");
    }
  }

  async function remove(item: Row) {
    if (!window.confirm(`删除「${item.label}」？自带模板不受影响。`)) return;
    setPending("remove");
    setError("");
    try {
      const response = await fetch(`/api/admin/templates?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "没有删掉。");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "没有删掉。");
    } finally {
      setPending("");
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setTemplates([]);
    setPhase("login");
  }

  if (phase === "loading") return <main className="boot" />;
  if (phase === "login") return <main className="gate">
    <form className="gate-card" onSubmit={event => void login(event)}>
      <p className="kicker">模板后台</p>
      <h1>登录</h1>
      <p>改已经上线的封面、模板内容和 Prompt，也可以上传新的画面模板。</p>
      <label>口令<input className="note" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      {error && <div className="alert" role="alert">{error}</div>}
      <button className="primary" type="submit" disabled={busy || !password}>{busy ? "正在核对…" : "进入"}</button>
    </form>
  </main>;

  return <main className="admin">
    <header className="admin-head">
      <div>
        <p className="kicker">模板后台</p>
        <h1>上线内容</h1>
      </div>
      <div className="admin-actions">
        <a className="secondary" href="/api/admin/catalog">下载清单</a>
        <button type="button" className="secondary" onClick={() => void logout()}>退出</button>
        <a className="text-link" href="/">回前台</a>
      </div>
    </header>
    <p className="meta">每条模板都能改名称、封面、模板内容和 Prompt，并决定前台是否显示。画面的 Prompt 和模板内容一样时，生成用模板内容。动作的 Prompt 是实际发给模型的句子。</p>
    {notice && <p className="meta" role="status">{notice}</p>}
    {error && <div className="alert" role="alert">{error}</div>}
    <form className="panel" onSubmit={event => void upload(event)}>
      <h2>上传画面模板</h2>
      <label>名称<input className="note" name="label" maxLength={40} value={label} onChange={event => setLabel(event.target.value)} required /></label>
      <div className="groups" role="group" aria-label="生图分类">
        {groups.map(item => <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>{item.label}</button>)}
      </div>
      <label>这张模板在画什么<textarea className="note" name="frame" rows={3} maxLength={500} value={frame} onChange={event => setFrame(event.target.value)} placeholder="例如：侧躺，单手撑头，室内暖光。" required /></label>
      <label>模板图<input name="file" type="file" accept="image/png,image/jpeg,image/webp" required onChange={event => setFileName(event.target.files?.[0]?.name ?? "")} /></label>
      <button className="primary" type="submit" disabled={pending !== "" || !label.trim() || !group || !frame.trim() || !fileName}>{pending === "upload" ? "正在保存…" : "上传"}</button>
    </form>
    {draft && <form className="panel" id="template-editor" onSubmit={event => void save(event)}>
      <h2>编辑「{draft.label || "模板"}」</h2>
      <p className="meta">{draft.source === "upload" ? "上传的模板" : "自带模板"} · {draft.kind === "image" ? "画面" : "动作"}</p>
      <label>名称<input className="note" maxLength={40} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} required /></label>
      {draft.kind === "image" && <div className="groups" role="group" aria-label="生图分类">
        {groups.map(item => <button type="button" key={item.id} aria-pressed={draft.group === item.id} onClick={() => setDraft({ ...draft, group: item.id })}>{item.label}</button>)}
      </div>}
      <label>模板内容<textarea className="note" rows={3} maxLength={500} value={draft.content} onChange={event => setDraft(current => current && ({ ...current, content: event.target.value, prompt: current.prompt === current.content ? event.target.value : current.prompt }))} required /></label>
      <label>Prompt<textarea className="note" rows={4} maxLength={500} value={draft.prompt} onChange={event => setDraft({ ...draft, prompt: event.target.value })} placeholder={draft.kind === "image" ? "留空就用模板内容。" : "这个动作实际发给模型的句子。"} required={draft.kind === "video"} /></label>
      <label>封面<input name="file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setDraft({ ...draft, fileName: event.target.files?.[0]?.name ?? "" })} /></label>
      {draft.fileName ? <p className="meta">将换成 {draft.fileName}</p> : <p className="meta">不选文件就保持现在的封面。</p>}
      <label className="admin-check"><input type="checkbox" checked={draft.listed} onChange={event => setDraft({ ...draft, listed: event.target.checked })} />前台显示</label>
      <button className="primary" type="submit" disabled={pending !== "" || !draft.label.trim() || !draft.content.trim() || (draft.kind === "image" && !draft.group) || (draft.kind === "video" && !draft.prompt.trim())}>{pending === "save" ? "正在保存…" : "保存到前台"}</button>
    </form>}
    <div className="tabs" role="group" aria-label="模板类型">
      <button type="button" aria-pressed={kind === "image"} onClick={() => { setKind("image"); setShelfGroup("all"); }}>图片</button>
      <button type="button" aria-pressed={kind === "video"} onClick={() => { setKind("video"); setShelfGroup("all"); }}>视频</button>
    </div>
    {kind === "image" && <div className="groups" role="group" aria-label="生图分类">
      <button type="button" aria-pressed={shelfGroup === "all"} onClick={() => setShelfGroup("all")}>全部</button>
      {groups.map(item => <button type="button" key={item.id} aria-pressed={shelfGroup === item.id} onClick={() => setShelfGroup(item.id)}>{item.label}</button>)}
    </div>}
    <div className="toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={kind === "image" ? "搜索画面模板" : "搜索动作模板"} aria-label="搜索模板" /></div>
    <div className="admin-list">
      {shown.map(item => <article className="admin-row" key={`${item.kind}-${item.id}`}>
        <img src={item.cover} alt="" loading="lazy" />
        <div>
          <strong>{item.label}</strong>
          <small>{item.groupLabel} · {item.source === "upload" ? "上传" : "自带"} · {item.listed ? "前台显示" : "未上线"}</small>
        </div>
        <div className="row-actions">
          <button type="button" className="secondary" onClick={() => openEditor(item)}>编辑</button>
          <a className="secondary" href={`/api/admin/file?id=${encodeURIComponent(item.id)}&kind=${item.kind}`}>下载</a>
          {item.source === "upload" ? <button type="button" className="secondary" disabled={pending !== ""} onClick={() => void remove(item)}>{pending === "remove" ? "正在删除…" : "删除"}</button> : null}
        </div>
      </article>)}
      {shown.length === 0 && <p className="empty">没有符合的模板。</p>}
    </div>
  </main>;
}
