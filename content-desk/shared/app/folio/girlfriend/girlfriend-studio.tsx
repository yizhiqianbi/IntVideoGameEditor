import { useEffect, useState, type ChangeEvent } from "react";
import {
  deleteGirlfriend,
  emptyGirlfriendDraft,
  girlfriendDraftFromPersona,
  girlfriendFromDraft,
  girlfriendIssue,
  GIRLFRIEND_ALBUM_LIMIT,
  GIRLFRIEND_FIELD_LIMIT,
  listGirlfriends,
  readGirlfriendImage,
  saveGirlfriend,
  type GirlfriendDraft,
  type GirlfriendPersona,
} from "./girlfriend-persona";
import styles from "./girlfriend-studio.module.css";

export default function GirlfriendStudio({ userId, isGuest, initialId, onRequireAccount, onBack, onOpen, onSaved, onDeleted, onDirtyChange }: {
  userId: string | null;
  isGuest: boolean;
  initialId?: string;
  onRequireAccount: () => void;
  onBack: () => void;
  onOpen: (id: string) => void;
  onSaved: (person: GirlfriendPersona) => void;
  onDeleted?: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [library, setLibrary] = useState<GirlfriendPersona[]>([]);
  const [editing, setEditing] = useState(initialId === "new" || Boolean(initialId && initialId !== "library"));
  const [draft, setDraft] = useState<GirlfriendDraft>(emptyGirlfriendDraft);
  const [saved, setSaved] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(initialId && initialId !== "new" ? initialId : null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => { onDirtyChange?.(editing && JSON.stringify(draft) !== saved); }, [draft, editing, onDirtyChange, saved]);
  useEffect(() => {
    if (!userId || isGuest) { setLibrary([]); return; }
    let alive = true;
    void listGirlfriends(userId).then(people => {
      if (!alive) return;
      setLibrary(people);
      if (initialId && initialId !== "new") {
        const person = people.find(item => item.id === initialId);
        if (!person) { setError("这台设备上没有这个女友。"); setEditing(false); return; }
        const next = girlfriendDraftFromPersona(person);
        setDraft(next); setSaved(JSON.stringify(next)); setCurrentId(person.id); setEditing(true);
      }
    }).catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : "女友列表没有打开。"); });
    return () => { alive = false; };
  }, [initialId, isGuest, userId]);
  function patch(partial: Partial<GirlfriendDraft>) { setDraft(current => ({ ...current, ...partial })); setNotice(""); }
  async function useFiles(files: FileList | null, album: boolean) {
    if (!files?.length) return;
    setError("");
    try {
      const urls = await Promise.all([...files].slice(0, album ? GIRLFRIEND_ALBUM_LIMIT : 1).map(readGirlfriendImage));
      if (album) patch({ album: [...draft.album, ...urls.map(url => ({ id: crypto.randomUUID(), url }))].slice(0, GIRLFRIEND_ALBUM_LIMIT) });
      else patch({ cover: urls[0] ?? "" });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "图片没有读出来。"); }
  }
  function onFile(album: boolean) {
    return (event: ChangeEvent<HTMLInputElement>) => { const files = event.target.files; event.target.value = ""; void useFiles(files, album); };
  }
  async function save() {
    const issue = girlfriendIssue(draft);
    if (issue) { setError(issue); return; }
    if (isGuest || !userId) { onRequireAccount(); return; }
    setWorking(true); setError("");
    try {
      const person = girlfriendFromDraft(userId, currentId || crypto.randomUUID(), draft);
      await saveGirlfriend(person);
      setCurrentId(person.id); setSaved(JSON.stringify(girlfriendDraftFromPersona(person))); setNotice("已保存在这台设备。"); setLibrary(people => [person, ...people.filter(item => item.id !== person.id)]);
      onDirtyChange?.(false);
      onSaved(person);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "没有保存。"); }
    finally { setWorking(false); }
  }
  async function remove(person: GirlfriendPersona) {
    if (!userId || !window.confirm(`删除${person.nickname}？这台设备上的照片和人设会一起去掉。`)) return;
    setWorking(true); setError("");
    try {
      await deleteGirlfriend(userId, person.id);
      setLibrary(people => people.filter(item => item.id !== person.id));
      onDeleted?.(person.id);
      if (currentId === person.id) { setEditing(false); setCurrentId(null); setDraft(emptyGirlfriendDraft()); setSaved(""); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "没有删除。"); }
    finally { setWorking(false); }
  }
  function startNew() { setEditing(true); setCurrentId(null); setDraft(emptyGirlfriendDraft()); setSaved(JSON.stringify(emptyGirlfriendDraft())); setError(""); setNotice(""); }
  return <main className={styles.studio}>
    <header className={styles.header}>
      <div className={styles.row}>
        <button className={styles.back} aria-label={editing && library.length ? "返回女友列表" : "返回"} onClick={() => editing && library.length ? setEditing(false) : onBack()}>{editing && library.length ? "列表" : "返回"}</button>
        <div><p className={styles.eyebrow}>女友</p><h1>{editing ? draft.nickname.trim() || "新的女友" : "我的女友"}</h1><p className={styles.status}>封面、相册，人设按 MaiBot 的身份、行为、说法和私聊来写。</p></div>
      </div>
      <div className={styles.actions}>
        {editing ? <button className={styles.primary} disabled={working} onClick={() => void save()}>保存</button> : <button className={styles.primary} onClick={startNew}>新建女友</button>}
      </div>
    </header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {!editing ? <section className={styles.library} aria-label="我的女友">
      {isGuest || !userId ? <p>登录后可以保存封面、相册和人设。</p> : library.length ? <div className={styles.cards}>{library.map(person => <article key={person.id} className={styles.card}>
        <img src={person.cover} alt="" />
        <strong>{person.nickname}</strong>
        <span>{person.age}岁 · {person.lines[0]}</span>
        <div className={styles.photoActions}><button onClick={() => onOpen(person.id)}>聊天</button><button onClick={() => { const next = girlfriendDraftFromPersona(person); setDraft(next); setSaved(JSON.stringify(next)); setCurrentId(person.id); setEditing(true); }}>编辑</button><button onClick={() => void remove(person)}>删除</button></div>
      </article>)}</div> : <p>还没有自己的女友。上传一张照片，再写身份、行为、说法和私聊。</p>}
    </section> : <div className={styles.layout}>
      <section className={styles.photos} aria-label="照片">
        <div className={styles.row}><h2>照片</h2><div className={styles.photoActions}><label className={styles.quiet}>上传封面<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFile(false)} /></label></div></div>
        {draft.cover ? <img className={styles.cover} src={draft.cover} alt="" /> : <div className={`${styles.cover} ${styles.coverEmpty}`}>封面</div>}
        <div className={styles.row} style={{ marginTop: 12 }}><h2>相册</h2><label className={styles.quiet}>添加图片<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onFile(true)} /></label></div>
        <div className={styles.album}>{draft.album.map(photo => <figure key={photo.id}><img src={photo.url} alt="" /><button type="button" aria-label="移出相册" onClick={() => patch({ album: draft.album.filter(item => item.id !== photo.id) })}>×</button></figure>)}</div>
      </section>
      <section className={styles.persona} aria-label="人设">
        <h2>人设</h2>
        <p>对应 MaiBot 的 nickname、alias、lines、personality、behavior_style、reply_style、private_chat_prompts。</p>
        <div className={styles.fields}>
          <div className={styles.split}>
            <label>名字<input value={draft.nickname} maxLength={24} onChange={event => patch({ nickname: event.target.value })} /></label>
            <label>年龄<input inputMode="numeric" value={draft.age} maxLength={2} onChange={event => patch({ age: event.target.value.replace(/\D/g, "") })} /></label>
          </div>
          <label>别名<input value={draft.aliasNames} placeholder="用顿号分开" onChange={event => patch({ aliasNames: event.target.value })} /></label>
          <label>开场<textarea value={draft.line} maxLength={80} onChange={event => patch({ line: event.target.value })} /></label>
          <label>第二句开场，可以空着<textarea value={draft.line2} maxLength={80} onChange={event => patch({ line2: event.target.value })} /></label>
          <label>身份 personality<textarea value={draft.personality} maxLength={GIRLFRIEND_FIELD_LIMIT} placeholder="她是谁，多大，眼下在做什么。" onChange={event => patch({ personality: event.target.value })} /><small>{draft.personality.trim().length}/{GIRLFRIEND_FIELD_LIMIT}</small></label>
          <label>行为 behavior_style<textarea value={draft.behaviorStyle} maxLength={GIRLFRIEND_FIELD_LIMIT} placeholder="她怎么待你。你说停，这一轮怎么收。" onChange={event => patch({ behaviorStyle: event.target.value })} /><small>{draft.behaviorStyle.trim().length}/{GIRLFRIEND_FIELD_LIMIT}</small></label>
          <label>说法 reply_style<textarea value={draft.replyStyle} maxLength={GIRLFRIEND_FIELD_LIMIT} placeholder="句子长短、口癖。不写旁白。" onChange={event => patch({ replyStyle: event.target.value })} /><small>{draft.replyStyle.trim().length}/{GIRLFRIEND_FIELD_LIMIT}</small></label>
          <label>私聊 private_chat_prompts<textarea value={draft.privateChatPrompts} maxLength={GIRLFRIEND_FIELD_LIMIT} placeholder="这一对一聊天先接哪一句。" onChange={event => patch({ privateChatPrompts: event.target.value })} /><small>{draft.privateChatPrompts.trim().length}/{GIRLFRIEND_FIELD_LIMIT}</small></label>
        </div>
      </section>
    </div>}
  </main>;
}
