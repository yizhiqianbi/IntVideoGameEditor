"use client";

import { DZMM_OFFERED_MODEL_OPTIONS, normalizeDzmmModelSelection, type DzmmModelPreset } from "../../lib/dzmm-models";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DzmmSavedConversation, DzmmPreferences } from "../../lib/dzmm-storage";
import { parseStoryState, type DzmmStoryState } from "../../lib/dzmm-story-memory";
import type { DzmmWorldClockMode } from "../../lib/dzmm-world-state";
import Icon from "./icons";
import styles from "./chat-settings.module.css";

type Props = {
  conversation: DzmmSavedConversation; preferences: DzmmPreferences;
  onPreferences: (next: DzmmPreferences) => void; onRename: (title: string) => void;
  onBranch: () => void; onDelete: () => void; onExport: () => void; onPresets: () => void;
  onClose: () => void; busy: boolean;
  onMemory: (next: DzmmStoryState | undefined) => void;
  onWorldClockMode: (mode: DzmmWorldClockMode) => void;
};
type Section = "conversation" | "persona" | "model" | "memory" | "world";
const SECTIONS: { id: Section; name: string; icon: "chat" | "user" | "sliders" }[] = [
  { id: "conversation", name: "会话管理", icon: "chat" },
  { id: "persona", name: "我的人设", icon: "user" },
  { id: "model", name: "模型与预设", icon: "sliders" },
  { id: "memory", name: "剧情记忆", icon: "chat" },
  { id: "world", name: "世界与时间", icon: "sliders" },
];
const MEMORY_FIELDS = [
  ["summary", "剧情摘要"], ["scene", "当前场景"], ["completed", "已完成的事"],
  ["pending", "未解决的线索"], ["relationships", "人物关系"], ["items", "物品变化"],
] as const;

export default function ChatSettings({ conversation, preferences, onPreferences, onRename, onBranch, onDelete, onExport, onPresets, onClose, busy, onMemory, onWorldClockMode }: Props) {
  const [section, setSection] = useState<Section>("conversation");
  const [title, setTitle] = useState(conversation.title);
  const [nickname, setNickname] = useState(preferences.nickname);
  const [persona, setPersona] = useState(preferences.persona);
  const [model, setModel] = useState<DzmmModelPreset>(normalizeDzmmModelSelection(preferences.model));
  const [preset, setPreset] = useState(preferences.preset);
  const [maxTokens, setMaxTokens] = useState(String(preferences.maxTokens ?? 2048));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [memoryDraft, setMemoryDraft] = useState(() => Object.fromEntries(MEMORY_FIELDS.map(([key]) => {
    const value = conversation.storyMemory?.state[key];
    return [key, Array.isArray(value) ? value.join("\n") : value || ""];
  })) as Record<keyof DzmmStoryState, string>);
  const memoryDraftVersion = useRef(JSON.stringify(conversation.storyMemory ?? null));
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const locked = useRef(busy);
  const confirming = useRef(confirmDelete);

  useEffect(() => { close.current = onClose; locked.current = busy; confirming.current = confirmDelete; }, [onClose, busy, confirmDelete]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (locked.current) return;
        if (confirming.current) setConfirmDelete(false);
        else close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
      if (!controls.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === dialog.current || !dialog.current?.contains(current))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (current === last || current === dialog.current || !dialog.current?.contains(current))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    const focusin = (event: FocusEvent) => { if (event.target instanceof Node && !dialog.current?.contains(event.target)) dialog.current?.focus(); };
    document.addEventListener("focusin", focusin);
    return () => { document.removeEventListener("keydown", keydown); document.removeEventListener("focusin", focusin); if (previous?.isConnected) previous.focus(); };
  }, []);

  const changeSection = (next: Section) => { setSection(next); setError(""); setNotice(""); setConfirmDelete(false); };
  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const next = title.trim();
    if (!next || next.length > 160 || next.includes("\0")) { setError("会话标题需要 1 至 160 个字符。"); return; }
    onRename(next); setNotice("会话标题已保存。"); setError("");
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const nextNickname = nickname.trim();
    if (!nextNickname || nextNickname.length > 30 || nextNickname.includes("\0")) { setError("昵称需要 1 至 30 个字符。"); setSection("persona"); return; }
    if (persona.length > 4000 || persona.includes("\0")) { setError("我的人设不能超过 4000 个字符。"); setSection("persona"); return; }
    if (preset.length > 8000 || preset.includes("\0")) { setError("全局预设不能超过 8000 个字符。"); setSection("model"); return; }
    const tokens = Number(maxTokens);
    if (!/^\d+$/.test(maxTokens) || !Number.isInteger(tokens) || tokens < 128 || tokens > 4096) { setError("最大回复长度需要是 128 至 4096 的整数。"); setSection("model"); return; }
    onPreferences({ ...preferences, nickname: nextNickname, persona, model, preset, maxTokens: tokens });
    setNotice("设置已保存，下次回复会应用这些设置。"); setError("");
  };
  const library = () => { if (!busy) { onClose(); onPresets(); } };
  const branch = () => { if (!busy) { onBranch(); onClose(); } };
  const remove = () => { if (!busy) { onDelete(); onClose(); } };
  const saveMemory = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !conversation.storyMemory) return;
    if (memoryDraftVersion.current !== JSON.stringify(conversation.storyMemory)) {
      setError("剧情记忆已更新，请关闭并重新打开聊天设置后再修改。"); setNotice(""); return;
    }
    try {
      const state = parseStoryState(Object.fromEntries(MEMORY_FIELDS.map(([key]) => [key,
        key === "summary" || key === "scene" ? memoryDraft[key] : memoryDraft[key].split("\n").map(line => line.trim()).filter(Boolean)])));
      memoryDraftVersion.current = JSON.stringify({ ...conversation.storyMemory, state });
      onMemory(state); setError(""); setNotice("剧情记忆已保存，下次对话会使用你的修正。");
    } catch { setError("内容过长或格式不正确。摘要最多2400字，场景最多1000字；列表每项最多400字，全部记录总量约6000字。"); }
  };
  const clearMemory = () => {
    if (busy || !conversation.storyMemory) return;
    if (memoryDraftVersion.current !== JSON.stringify(conversation.storyMemory)) {
      setError("剧情记忆已更新，请关闭并重新打开聊天设置后再修改。"); setNotice(""); return;
    }
    memoryDraftVersion.current = "null";
    onMemory(undefined); setNotice("摘要已清除，原始对话仍保留。"); setError("");
  };
  const selectedPreset = preferences.presets?.find((item) => item.content === preset)?.id ?? "";

  return <div className={styles.overlay} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={dialog} className={styles.dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="chat-settings-title">
      <header className={styles.header}><div><h2 id="chat-settings-title">聊天设置</h2><p>{conversation.title}</p></div><button type="button" className={styles.close} disabled={busy} onClick={onClose} aria-label="关闭聊天设置"><Icon name="close" size={19} /></button></header>
      <div className={styles.body}>
        <nav className={styles.navigation} aria-label="聊天设置分类">{SECTIONS.map((item) => <button type="button" key={item.id} className={section === item.id ? styles.selected : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => changeSection(item.id)}><Icon name={item.icon} size={16} />{item.name}</button>)}</nav>
        <div className={styles.content}>
          {section === "conversation" ? <section aria-labelledby="chat-settings-conversation">
            <h3 id="chat-settings-conversation">会话管理</h3><p className={styles.hint}>管理当前聊天，保留你想继续探索的故事。</p>
            <form className={styles.titleForm} onSubmit={rename}><label htmlFor="chat-settings-name">会话标题</label><div className={styles.inline}><input id="chat-settings-name" required maxLength={160} value={title} disabled={busy} onChange={(event) => { setTitle(event.target.value); setNotice(""); }} /><button type="submit" disabled={busy || !title.trim()} className={styles.secondary}>保存标题</button></div></form>
            <div className={styles.actionGroup}><div className={styles.actionRow}><div><h4>创建会话分支</h4><p>复制当前全部 {conversation.messages.length} 条消息，建立独立会话。</p></div><button type="button" className={styles.secondary} disabled={busy} onClick={branch}><Icon name="copy" size={15} />复制分支</button></div><div className={styles.actionRow}><div><h4>导出会话</h4><p>将当前聊天记录保存到文件。</p></div><button type="button" className={styles.secondary} disabled={busy} onClick={onExport}><Icon name="download" size={15} />导出</button></div><div className={`${styles.actionRow} ${styles.deleteRow}`}><div><h4>删除会话</h4><p>删除当前会话及其全部消息。</p></div><button type="button" className={styles.dangerOutline} disabled={busy} onClick={() => { setConfirmDelete(true); setError(""); setNotice(""); }}>删除会话</button></div></div>
            {confirmDelete && <div className={styles.confirmation} role="alertdialog" aria-labelledby="chat-settings-delete-title" aria-describedby="chat-settings-delete-description"><strong id="chat-settings-delete-title">确认删除「{conversation.title}」？</strong><p id="chat-settings-delete-description">这 {conversation.messages.length} 条消息会一并删除，无法通过此操作恢复。需要保留时，请先导出会话。</p><div><button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button><button type="button" className={styles.danger} disabled={busy} onClick={remove}>确认删除</button></div></div>}
          </section> : section === "world" ? <section aria-labelledby="chat-settings-world">
            <h3 id="chat-settings-world">世界与时间</h3>
            <p className={styles.hint}>选择这个故事如何流逝。人物关系、约定和日程会在对话中持续积累。</p>
            <label className={styles.field} htmlFor="chat-settings-clock">时间推进方式
              <select id="chat-settings-clock" disabled={busy} value={conversation.worldClockMode ?? "story"}
                onChange={event => {
                  try { onWorldClockMode(event.target.value as DzmmWorldClockMode); setError(""); setNotice("时间模式已保存，应用于当前会话。"); }
                  catch (failure) { setNotice(""); setError(failure instanceof Error ? failure.message : "时间模式保存失败，请重试。"); }
                }}>
                <option value="story">随对话行动推进</option><option value="realtime">跟随现实时间</option>
              </select>
              <small>{conversation.worldClockMode === "realtime" ? "离开后时间继续流逝，回来时会按经过的时间承接角色日常。重要选择仍由你决定。" : "时间随着故事中的行动与约定推进。离开网站不会让剧情自动跳过。"}</small>
            </label>
            <div className={styles.actionGroup}><div className={styles.actionRow}><div><h4>自然发展的关系</h4><p>好感、信任和紧张程度分别积累，通过角色的态度和行为呈现。</p></div></div>
              <div className={styles.actionRow}><div><h4>有后续的世界</h4><p>角色会记住承诺、目标和日程。已完成的事会收束，尚未解决的线索会继续影响后续。</p></div></div></div>
            <p className={styles.hint}>现实时间参考北京时间；故事中的年代和地点遵循角色设定。模式切换从此刻开始。</p>
          </section> : section === "memory" ? <section aria-labelledby="chat-settings-memory">
            <h3 id="chat-settings-memory">剧情记忆</h3>
            <p className={styles.hint}>较早的剧情会整理成记录，近期对话保留原文。你可以核对并修正遗漏，原始聊天不会被改写。</p>
            {conversation.storyMemory ? <>
              <p className={styles.hint}>已整理前 {conversation.storyMemory.sourceCount} 条消息；后续对话会接着更新这些记录。</p>
              <form id="chat-settings-memory-form" onSubmit={saveMemory}>{MEMORY_FIELDS.map(([key, label]) =>
                <label className={styles.field} key={key} htmlFor={`chat-memory-${key}`}>{label}
                  <textarea id={`chat-memory-${key}`} rows={key === "summary" ? 5 : 3} disabled={busy}
                    maxLength={key === "summary" ? 2400 : key === "scene" ? 1000 : 4800}
                    value={memoryDraft[key]} onChange={event => { setMemoryDraft(previous => ({ ...previous, [key]: event.target.value })); setNotice(""); }} />
                  {key !== "summary" && key !== "scene" && <small>每行一项，最多12项，每项最多400字。</small>}
                </label>)}</form>
              <div className={styles.actionRow}><div><h4>重新整理记忆</h4><p>清除这份摘要，下次对话会从历史重新整理。</p></div>
                <button type="button" className={styles.secondary} disabled={busy} onClick={clearMemory}>清除摘要</button></div>
            </> : <p className={styles.hint}>还没有需要整理的旧剧情。对话变长后，会自动生成记忆。</p>}
          </section> : <form id="chat-settings-preferences" onSubmit={save}>
            {section === "persona" ? <section aria-labelledby="chat-settings-persona"><h3 id="chat-settings-persona">我的人设</h3><p className={styles.hint}>告诉角色你希望在故事中扮演谁。</p><label className={styles.field} htmlFor="chat-settings-nickname">昵称<input id="chat-settings-nickname" required maxLength={30} value={nickname} disabled={busy} onChange={(event) => { setNickname(event.target.value); setNotice(""); }} /><small>你的显示昵称。</small></label><label className={styles.field} htmlFor="chat-settings-persona-text">用户人设<textarea id="chat-settings-persona-text" rows={8} maxLength={4000} value={persona} disabled={busy} placeholder="你的名字、身份、性格，以及与角色的关系…" onChange={(event) => { setPersona(event.target.value); setNotice(""); }} /><small>会在下一次对话请求中作为你的故事身份。<span>{persona.length} / 4000</span></small></label></section>
              : <section aria-labelledby="chat-settings-model"><h3 id="chat-settings-model">模型与预设</h3><p className={styles.hint}>选择对话模型，并调整故事的叙事风格。</p><label className={styles.field} htmlFor="chat-settings-model-select">对话模型<select id="chat-settings-model-select" disabled={busy} value={model} onChange={(event) => { setModel(event.target.value as DzmmModelPreset); setNotice(""); }}>{DZMM_OFFERED_MODEL_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.description}</option>)}</select></label><label className={styles.field} htmlFor="chat-settings-tokens">最大回复长度<div className={styles.tokenInput}><input id="chat-settings-tokens" type="number" inputMode="numeric" min={128} max={4096} step={1} required disabled={busy} value={maxTokens} onChange={(event) => { setMaxTokens(event.target.value); setNotice(""); }} /><span>tokens</span></div><small>128–4096；实际回复可以短于这个上限。</small></label><div className={styles.divider} /><div className={styles.presetHeading}><h4>写作预设</h4><button type="button" disabled={busy} onClick={library}><Icon name="book" size={14} />预设库</button></div><label className={styles.field} htmlFor="chat-settings-saved-preset">选择已保存预设<select id="chat-settings-saved-preset" disabled={busy || !preferences.presets?.length} value={selectedPreset} onChange={(event) => { const saved = preferences.presets?.find((item) => item.id === event.target.value); if (saved) { setPreset(saved.content); setNotice(""); } }}><option value="">{preferences.presets?.length ? "自定义预设" : "还没有保存预设"}</option>{preferences.presets?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className={styles.field} htmlFor="chat-settings-preset">全局预设<textarea id="chat-settings-preset" rows={6} maxLength={8000} value={preset} disabled={busy} placeholder="保持角色性格，用自然对话和适量动作推进故事…" onChange={(event) => { setPreset(event.target.value); setNotice(""); }} /><small>应用于接下来的角色回复。<span>{preset.length} / 8000</span></small></label></section>}
          </form>}
          {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}{busy && <p className={styles.hint} role="status">请等待当前回复结束后再修改设置。</p>}
        </div>
      </div>
      <footer className={styles.footer}><span>{section === "conversation" ? `${conversation.messages.length} 条消息` : section === "world" ? "每个故事可以使用不同时间模式" : "保存后应用到后续回复"}</span><div><button type="button" className={styles.secondary} disabled={busy} onClick={onClose}>关闭</button>{section !== "conversation" && section !== "world" && <button type="submit" form={section === "memory" ? "chat-settings-memory-form" : "chat-settings-preferences"} className={styles.primary} disabled={busy || (section === "memory" && !conversation.storyMemory)}>{section === "memory" ? "保存记忆" : "保存设置"}</button>}</div></footer>
    </div>
  </div>;
}
