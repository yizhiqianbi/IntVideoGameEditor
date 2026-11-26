"use client";

import { DZMM_OFFERED_MODEL_OPTIONS, normalizeDzmmModelSelection, type DzmmModelPreset } from "../../lib/dzmm-models";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { DZMM_PERSONA_LIMIT, type DzmmSavedConversation, type DzmmPreferences } from "../../lib/dzmm-storage";
import type { DzmmSamplerRequest } from "../../lib/dzmm-chat";
import { TAVERN_IMAGE_PRESETS } from "../../lib/tavern/image";
import { TAVERN_MEMORY_PROFILES, type TavernMemoryProfile } from "../../lib/tavern/memory";
import { DEFAULT_TAVERN_IMAGE_GENERATION, TAVERN_IMAGE_SIZES, chatImageAutoMode, parseTavernImageGeneration,
  type TavernImageGeneration } from "../../lib/tavern/image-generation";
import { parseStoryState, type DzmmStoryState } from "../../lib/dzmm-story-memory";
import type { DzmmWorldClockMode } from "../../lib/dzmm-world-state";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengModelBlurb, xumengPage } from "../../lib/xumeng-page-copy";
import Icon from "./icons";
import styles from "./chat-settings.module.css";

type Props = {
  conversation: DzmmSavedConversation; preferences: DzmmPreferences;
  onPreferences: (next: DzmmPreferences) => void; onRename: (title: string) => void;
  onBranch: () => void; onDelete: () => void; onExport: () => void; onPresets: () => void;
  onClose: () => void; busy: boolean;
  onMemory: (next: DzmmStoryState | undefined) => void;
  onWorldClockMode: (mode: DzmmWorldClockMode) => void;
  locale?: XumengLocale;
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

export default function ChatSettings({ conversation, preferences, locale = "zh-Hans", onPreferences, onRename, onBranch, onDelete, onExport, onPresets, onClose, busy, onMemory, onWorldClockMode }: Props) {
  const copy = xumengPage(locale);
  const sectionName: Record<Section, string> = { conversation: copy.sectionConversation, persona: copy.sectionPersona, model: copy.sectionModel, memory: copy.sectionMemory, world: copy.sectionWorld };
  const [section, setSection] = useState<Section>("conversation");
  const [title, setTitle] = useState(conversation.title);
  const [nickname, setNickname] = useState(preferences.nickname);
  const personas = preferences.personas ?? [];
  const mappedPersona = preferences.conversationPersonas?.[conversation.id];
  const [personaChoice, setPersonaChoice] = useState(() => personas.some(item => item.id === mappedPersona) ? mappedPersona! : "default");
  const [personaName, setPersonaName] = useState("");
  const [persona, setPersona] = useState(() => personas.find(item => item.id === mappedPersona)?.content ?? preferences.persona);
  const [model, setModel] = useState<DzmmModelPreset>(normalizeDzmmModelSelection(preferences.model));
  const [preset, setPreset] = useState(preferences.preset);
  const [promptStyle, setPromptStyle] = useState(preferences.promptStyle ?? "tavern");
  const [imagePreset, setImagePreset] = useState(preferences.imagePreset ?? "xumeng");
  const [imageGen, setImageGen] = useState<TavernImageGeneration>(() => {
    const stored = preferences.imageGeneration ?? DEFAULT_TAVERN_IMAGE_GENERATION;
    const autoMode = chatImageAutoMode(preferences.imageGeneration);
    return { ...stored, autoMode, autoOptOut: autoMode === "off" };
  });
  const [memoryProfile, setMemoryProfile] = useState<TavernMemoryProfile>(preferences.memoryProfile ?? "balanced");
  const [memoryDepth, setMemoryDepth] = useState(String(preferences.memoryDepth ?? ""));
  const [maxTokens, setMaxTokens] = useState(String(preferences.maxTokens ?? 1024));
  const [samplerDraft, setSamplerDraft] = useState<Record<string, string>>(() => ({
    temperature: preferences.sampler?.temperature?.toString() ?? "",
    topP: preferences.sampler?.topP?.toString() ?? "",
    topK: preferences.sampler?.topK?.toString() ?? "",
    frequencyPenalty: preferences.sampler?.frequencyPenalty?.toString() ?? "",
    presencePenalty: preferences.sampler?.presencePenalty?.toString() ?? "",
  }));
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
    const newName = personaName.trim();
    if (personaChoice === "new" && (!newName || newName.length > 80 || newName.includes("\0"))) { setError("请给新人设起一个 1 至 80 字的名称。"); setSection("persona"); return; }
    if (personaChoice === "new" && personas.length >= DZMM_PERSONA_LIMIT) { setError(`人设库最多保存 ${DZMM_PERSONA_LIMIT} 个人设，请先在我的预设里删除一个。`); setSection("persona"); return; }
    if (preset.length > 8000 || preset.includes("\0")) { setError("全局预设不能超过 8000 个字符。"); setSection("model"); return; }
    const tokens = Number(maxTokens);
    if (!/^\d+$/.test(maxTokens) || !Number.isInteger(tokens) || tokens < 128 || tokens > 4096) { setError("最大回复长度需要是 128 至 4096 的整数。"); setSection("model"); return; }
    const sampler: DzmmSamplerRequest = {};
    const samplerRanges: Array<[keyof DzmmSamplerRequest, number, number]> = [
      ["temperature", 0, 2], ["topP", 0, 1], ["topK", 0, 200], ["frequencyPenalty", -2, 2], ["presencePenalty", -2, 2],
    ];
    for (const [key, min, max] of samplerRanges) {
      const raw = samplerDraft[key as string]?.trim() ?? "";
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < min || value > max) { setError(`${key} 需要在 ${min} 到 ${max} 之间。`); setSection("model"); return; }
      (sampler as Record<string, number>)[key as string] = value;
    }
    const { [conversation.id]: previousChoice, ...otherChoices } = preferences.conversationPersonas ?? {}; void previousChoice;
    let personaPatch: Partial<DzmmPreferences> = { persona, conversationPersonas: otherChoices };
    if (personaChoice === "new") {
      const created = { id: crypto.randomUUID(), name: newName, content: persona };
      personaPatch = { personas: [...personas, created], conversationPersonas: { ...otherChoices, [conversation.id]: created.id } };
      setPersonaChoice(created.id); setPersonaName("");
    } else if (personaChoice !== "default") {
      personaPatch = { personas: personas.map(item => item.id === personaChoice ? { ...item, content: persona } : item), conversationPersonas: { ...otherChoices, [conversation.id]: personaChoice } };
    }
    const imageGeneration = parseTavernImageGeneration(imageGen) ?? DEFAULT_TAVERN_IMAGE_GENERATION;
    onPreferences({ ...preferences, ...personaPatch, nickname: nextNickname, model, preset, maxTokens: tokens, promptStyle,
      imagePreset, imageGeneration, sampler: Object.keys(sampler).length ? sampler : undefined });
    setNotice("设置已保存，下次回复会应用这些设置。"); setError("");
  };
  const library = () => { if (!busy) { onClose(); onPresets(); } };
  const branch = () => { if (!busy) { onBranch(); onClose(); } };
  const remove = () => { if (!busy) { onDelete(); onClose(); } };
  const saveMemoryOptions = () => {
    const depthText = memoryDepth.trim();
    const depth = depthText ? Number(depthText) : undefined;
    if (depth !== undefined && (!Number.isInteger(depth) || depth < 0 || depth > 20)) {
      setError("记忆注入深度需要是 0 至 20 的整数。"); setNotice(""); return false;
    }
    onPreferences({ ...preferences, memoryProfile, ...(depth === undefined ? { memoryDepth: undefined } : { memoryDepth: depth }) });
    return true;
  };
  const saveMemory = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return undefined;
    if (!saveMemoryOptions()) return undefined;
    if (!conversation.storyMemory) { setNotice("记忆设置已保存。"); setError(""); return undefined; }
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
        <nav className={styles.navigation} aria-label={copy.chatSettings}>{SECTIONS.map((item) => <button type="button" key={item.id} className={section === item.id ? styles.selected : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => changeSection(item.id)}><Icon name={item.icon} size={16} />{sectionName[item.id]}</button>)}</nav>
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
            <label className={styles.field} htmlFor="chat-settings-memory-profile">记忆详细程度<select id="chat-settings-memory-profile" disabled={busy} value={memoryProfile} onChange={(event) => { setMemoryProfile(event.target.value as TavernMemoryProfile); setNotice(""); }}>{TAVERN_MEMORY_PROFILES.map(profile => <option key={profile} value={profile}>{profile === "compact" ? "精简" : profile === "detailed" ? "详细" : "均衡"}</option>)}</select><small>影响之后自动整理记忆时的摘要长度。</small></label>
            <label className={styles.field} htmlFor="chat-settings-memory-depth">记忆注入位置<div className={styles.tokenInput}><input id="chat-settings-memory-depth" type="number" inputMode="numeric" min={0} max={20} step={1} disabled={busy} value={memoryDepth} placeholder="默认" onChange={(event) => { setMemoryDepth(event.target.value); setNotice(""); }} /><span>条消息前</span></div><small>0 = 最新消息之后；留空沿用默认（近期历史之前）。保存记忆或发送消息时生效。</small></label>
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
            {section === "persona" ? <section aria-labelledby="chat-settings-persona"><h3 id="chat-settings-persona">我的人设</h3><p className={styles.hint}>告诉角色你希望在故事中扮演谁。</p><label className={styles.field} htmlFor="chat-settings-nickname">昵称<input id="chat-settings-nickname" required maxLength={30} value={nickname} disabled={busy} onChange={(event) => { setNickname(event.target.value); setNotice(""); }} /><small>你的显示昵称。</small></label><label className={styles.field} htmlFor="chat-settings-persona-choice">这个对话使用的人设<select id="chat-settings-persona-choice" disabled={busy} value={personaChoice} onChange={(event) => {
                const next = event.target.value; setPersonaChoice(next); setNotice("");
                setPersona(next === "default" ? preferences.persona : next === "new" ? "" : personas.find(item => item.id === next)?.content ?? "");
              }}><option value="default">默认人设（没有单独设置的对话都用它）</option>{personas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="new" disabled={personas.length >= DZMM_PERSONA_LIMIT}>＋ 为这个对话新建人设</option></select><small>人设库在「我的预设」里管理。<button type="button" className={styles.inlineLink} disabled={busy} onClick={library}>打开人设库</button></small></label>
              {personaChoice === "new" && <label className={styles.field} htmlFor="chat-settings-persona-name">人设名称<input id="chat-settings-persona-name" maxLength={80} value={personaName} disabled={busy} placeholder={`例如：${conversation.title.slice(0, 20)}里的我`} onChange={(event) => { setPersonaName(event.target.value); setNotice(""); }} /></label>}
              <label className={styles.field} htmlFor="chat-settings-persona-text">用户人设<textarea id="chat-settings-persona-text" rows={8} maxLength={4000} value={persona} disabled={busy} placeholder="你的名字、身份、性格，以及与角色的关系…" onChange={(event) => { setPersona(event.target.value); setNotice(""); }} /><small>{personaChoice === "default" ? "修改默认人设会影响所有没有单独设置的对话。" : personaChoice === "new" ? "保存后加入人设库，这个对话会使用它，其他对话也可以选用。" : "这个人设在人设库里，修改会同步到所有使用它的对话。"}<span>{persona.length} / 4000</span></small></label></section>
              : <section aria-labelledby="chat-settings-model"><h3 id="chat-settings-model">模型与预设</h3><p className={styles.hint}>选择对话模型，并调整故事的叙事风格。</p><label className={styles.field} htmlFor="chat-settings-model-select">对话模型<select id="chat-settings-model-select" disabled={busy} value={model} onChange={(event) => { setModel(event.target.value as DzmmModelPreset); setNotice(""); }}>{DZMM_OFFERED_MODEL_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label}（{item.rateMultiplier}× · {item.minCredits}金币起）· {item.description}</option>)}</select></label><label className={styles.field} htmlFor="chat-settings-prompt-style">提示词拼法<select id="chat-settings-prompt-style" disabled={busy} value={promptStyle} onChange={(event) => { setPromptStyle(event.target.value === "tavern" ? "tavern" : "xumeng"); setNotice(""); }}><option value="tavern">酒馆</option><option value="xumeng">叙梦</option></select><small>酒馆按角色卡、世界书、示例和历史的顺序组装。成人描写仍用叙梦现在的写法。下次回复生效。</small></label><label className={styles.field} htmlFor="chat-settings-image-preset">生图风格<select id="chat-settings-image-preset" disabled={busy} value={imagePreset} onChange={(event) => { setImagePreset(event.target.value); setNotice(""); }}>{TAVERN_IMAGE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name} · {preset.description}</option>)}</select><small>用于聊天内「这一幕」生图；切换后下一次生成生效。</small></label>
<details className={styles.field}><summary>酒馆式生图（模板 / 负面词 / 自动生成）</summary><p className={styles.hint}>提示词支持 {"{{char}}、{{user}}、{{description}}、{{personality}}、{{scenario}}"} 占位符；负面词会以「避免出现」追加。新回复默认就出一张图，每张约 100 金币；选关闭后只在输入 /sd 时生成。模板只在勾选后追加，不改变参考图的画风。</p><label className={styles.field}><input type="checkbox" style={{ width: "auto", marginRight: 8 }} checked={imageGen.enabled} onChange={(event) => { setImageGen({ ...imageGen, enabled: event.target.checked }); setNotice(""); }} />启用自定义提示词模板</label><label className={styles.field}>自动生图<select value={imageGen.autoMode} onChange={(event) => { const autoMode = event.target.value as TavernImageGeneration["autoMode"]; setImageGen({ ...imageGen, autoMode, autoOptOut: autoMode === "off" }); setNotice(""); }}><option value="off">关闭（仅手动 /sd）</option><option value="each">每条回复都生成</option><option value="interval">每隔 N 条回复</option></select></label>{imageGen.autoMode === "interval" && <label className={styles.field}>间隔条数<div className={styles.tokenInput}><input type="number" min={1} max={20} step={1} value={imageGen.interval} onChange={(event) => { setImageGen({ ...imageGen, interval: Math.max(1, Math.min(20, Number(event.target.value) || 1)) }); setNotice(""); }} /><span>条回复</span></div></label>}<label className={styles.field}>画面尺寸<select value={imageGen.size} onChange={(event) => { setImageGen({ ...imageGen, size: event.target.value as TavernImageGeneration["size"] }); setNotice(""); }}>{TAVERN_IMAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label><label className={styles.field}>正面提示词前缀<textarea rows={2} maxLength={400} value={imageGen.promptPrefix} placeholder="masterpiece, best quality, cinematic lighting" onChange={(event) => { setImageGen({ ...imageGen, promptPrefix: event.target.value }); setNotice(""); }} /></label><label className={styles.field}>主提示词<textarea rows={3} maxLength={800} value={imageGen.mainPrompt} placeholder="例如：{{char}} 的艺术写真，柔光，胶片质感" onChange={(event) => { setImageGen({ ...imageGen, mainPrompt: event.target.value }); setNotice(""); }} /></label><label className={styles.field}>负面提示词<textarea rows={2} maxLength={400} value={imageGen.negativePrompt} placeholder="lowres, bad anatomy, bad hands, text, watermark" onChange={(event) => { setImageGen({ ...imageGen, negativePrompt: event.target.value }); setNotice(""); }} /></label><label className={styles.field}><input type="checkbox" style={{ width: "auto", marginRight: 8 }} checked={imageGen.injectCharacter} onChange={(event) => { setImageGen({ ...imageGen, injectCharacter: event.target.checked }); setNotice(""); }} />自动注入角色设定（外观 / 性格 / 描述）</label><label className={styles.field}><input type="checkbox" style={{ width: "auto", marginRight: 8 }} checked={imageGen.injectScenario} onChange={(event) => { setImageGen({ ...imageGen, injectScenario: event.target.checked }); setNotice(""); }} />自动注入场景设定</label></details><label className={styles.field} htmlFor="chat-settings-tokens">最大回复长度<div className={styles.tokenInput}><input id="chat-settings-tokens" type="number" inputMode="numeric" min={128} max={4096} step={1} required disabled={busy} value={maxTokens} onChange={(event) => { setMaxTokens(event.target.value); setNotice(""); }} /><span>tokens</span></div><small>128–4096；实际回复可以短于这个上限。</small></label><details className={styles.field}><summary>采样参数（高级，可选）</summary><p className={styles.hint}>留空使用模型默认值。只影响之后的回复；酒馆拼法下逐步生效。</p>{([["temperature", "温度", "0–2"], ["topP", "Top P", "0–1"], ["topK", "Top K", "0–200"], ["frequencyPenalty", "频率惩罚", "-2–2"], ["presencePenalty", "存在惩罚", "-2–2"]] as const).map(([key, label, range]) => <label className={styles.field} key={key} htmlFor={`chat-settings-sampler-${key}`}>{label}<div className={styles.tokenInput}><input id={`chat-settings-sampler-${key}`} type="number" inputMode="decimal" step="0.05" min={key === "temperature" ? 0 : key === "frequencyPenalty" || key === "presencePenalty" ? -2 : 0} max={key === "temperature" ? 2 : key === "frequencyPenalty" || key === "presencePenalty" ? 2 : key === "topP" ? 1 : 200} disabled={busy} value={samplerDraft[key]} placeholder={range} onChange={(event) => { setSamplerDraft(previous => ({ ...previous, [key]: event.target.value })); setNotice(""); }} /></div></label>)}<button type="button" className={styles.secondary} disabled={busy} onClick={() => { setSamplerDraft({ temperature: "", topP: "", topK: "", frequencyPenalty: "", presencePenalty: "" }); setNotice(""); }}>恢复默认</button></details><div className={styles.divider} /><div className={styles.presetHeading}><h4>写作预设</h4><button type="button" disabled={busy} onClick={library}><Icon name="book" size={14} />预设库</button></div><label className={styles.field} htmlFor="chat-settings-saved-preset">选择已保存预设<select id="chat-settings-saved-preset" disabled={busy || !preferences.presets?.length} value={selectedPreset} onChange={(event) => { const saved = preferences.presets?.find((item) => item.id === event.target.value); if (saved) { setPreset(saved.content); setNotice(""); } }}><option value="">{preferences.presets?.length ? "自定义预设" : "还没有保存预设"}</option>{preferences.presets?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className={styles.field} htmlFor="chat-settings-preset">全局预设<textarea id="chat-settings-preset" rows={6} maxLength={8000} value={preset} disabled={busy} placeholder="保持角色性格，用自然对话和适量动作推进故事…" onChange={(event) => { setPreset(event.target.value); setNotice(""); }} /><small>应用于接下来的角色回复。<span>{preset.length} / 8000</span></small></label></section>}
          </form>}
          {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}{busy && <p className={styles.hint} role="status">请等待当前回复结束后再修改设置。</p>}
        </div>
      </div>
      <footer className={styles.footer}><span>{section === "conversation" ? `${conversation.messages.length} 条消息` : section === "world" ? "每个故事可以使用不同时间模式" : "保存后应用到后续回复"}</span><div><button type="button" className={styles.secondary} disabled={busy} onClick={onClose}>关闭</button>{section !== "conversation" && section !== "world" && <button type="submit" form={section === "memory" ? "chat-settings-memory-form" : "chat-settings-preferences"} className={styles.primary} disabled={busy || (section === "memory" && !conversation.storyMemory)}>{section === "memory" ? "保存记忆" : "保存设置"}</button>}</div></footer>
    </div>
  </div>;
}
