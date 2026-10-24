"use client";
/* eslint-disable @next/next/no-img-element -- User-selected character avatars. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchXumengCharacterVoice, generateXumengCharacterVoice, type XumengCharacterVoiceAsset, type XumengCharacterVoiceOverview } from "../../lib/xumeng-character-voice";
import type { XumengPerformanceCharacter } from "../../lib/xumeng-performance-character";
import { splitDzmmCharacterPresentation } from "../../lib/dzmm-character-presentation";
import { XUMENG_SPEECH_VOICES, getXumengSpeechVoice, type XumengSpeechVoiceId } from "../../lib/xumeng-voices";
import s from "./voice-studio.module.css";

type Props = { userId?: string; isGuest: boolean; characters: XumengPerformanceCharacter[]; initialCharacter?: XumengPerformanceCharacter;
  onRequireAccount: () => void; onBack: () => void; onBusyChange?: (busy: boolean) => void; onInitialConsumed?: () => void };
const defaultText = (character?: XumengPerformanceCharacter) => character ? splitDzmmCharacterPresentation(character.dialogue).body
  .replace(/\{\{char\}\}/gi, character.name).replace(/\{\{user\}\}/gi, "你") : "";
const message = (error: unknown) => error instanceof Error && error.message ? error.message : "朗读生成失败，请稍后重试。";

export default function VoiceStudio(props: Props) {
  // A new account gets its own editor and audio element before effects run.
  return <VoiceStudioSession key={`${props.userId ?? "anonymous"}:${props.isGuest}`} {...props} />;
}
function VoiceStudioSession({ userId, isGuest, characters, initialCharacter, onRequireAccount, onBack, onBusyChange, onInitialConsumed }: Props) {
  const first = initialCharacter ?? characters[0];
  const [selected, setSelected] = useState(first?.key ?? ""), [imported, setImported] = useState(initialCharacter);
  const [text, setText] = useState(defaultText(first));
  const [voiceId, setVoiceId] = useState<XumengSpeechVoiceId>(first?.speechVoice ?? "melotts");
  const [overview, setOverview] = useState<XumengCharacterVoiceOverview | null>(null), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [result, setResult] = useState<{ asset: XumengCharacterVoiceAsset; text: string } | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const epoch = useRef(0), mounted = useRef(true), operation = useRef<AbortController | null>(null), working = useRef(false);
  const consumed = useRef<string | null>(null), busyCallback = useRef(onBusyChange);
  const voiceEdited = useRef(false);
  busyCallback.current = onBusyChange;
  const choices = imported && !characters.some(item => item.key === imported.key) ? [imported, ...characters] : characters;
  const character = choices.find(item => item.key === selected);
  const chars = Array.from(text).length;
  const voice = getXumengSpeechVoice(voiceId)!;
  const voiceAvailable = Boolean(overview?.speechVoices.includes(voiceId));
  const entitled = Boolean(overview?.vip.active || overview?.vip.adminPreview);
  const canGenerate = Boolean(userId && !isGuest && character && text.trim() && chars <= 800 && overview?.enabled && entitled && voiceAvailable);
  useEffect(() => {
    const accountEpoch = epoch; mounted.current = true;
    return () => { mounted.current = false; accountEpoch.current++; operation.current?.abort(); busyCallback.current?.(false); };
  }, []);
  useEffect(() => { busyCallback.current?.(busy); }, [busy]);
  useEffect(() => {
    if (!initialCharacter || busy || consumed.current === initialCharacter.key) return;
    consumed.current = initialCharacter.key; setImported(initialCharacter); setSelected(initialCharacter.key);
    voiceEdited.current = false;
    setText(defaultText(initialCharacter)); setVoiceId(initialCharacter.speechVoice ?? "melotts"); setResult(null); setError(""); setNotice(`已载入「${initialCharacter.name}」的台词。`); onInitialConsumed?.();
  }, [initialCharacter, busy, onInitialConsumed]);
  useEffect(() => {
    if (busy || character) return;
    const next = choices[0];
    if (!next) { if (selected) setSelected(""); return; }
    setSelected(next.key);
    // Late-arriving catalog data should not discard text already typed.
    setText(previous => previous || defaultText(next));
    if (!voiceEdited.current) setVoiceId(next.speechVoice ?? "melotts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters, imported, character, busy]);
  async function refresh(signal?: AbortSignal) {
    if (!userId || isGuest) return;
    const version = epoch.current;
    const value = await fetchXumengCharacterVoice(userId, signal);
    if (mounted.current && version === epoch.current && !signal?.aborted) setOverview(value);
  }
  useEffect(() => {
    if (!userId || isGuest) return;
    const abort = new AbortController(); setLoading(true);
    void refresh(abort.signal).catch(failure => { if (!abort.signal.aborted) setError(message(failure)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
    // The wrapper remounts on every account change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function applySelection(key: string) {
    const next = choices.find(item => item.key === key);
    if (!next || working.current) return;
    voiceEdited.current = false;
    setSelected(key); setText(defaultText(next)); setVoiceId(next.speechVoice ?? "melotts"); setResult(null); setCandidate(null); setError(""); setNotice("");
  }
  function select(key: string) {
    if (key === selected || working.current) return;
    if ((text.trim() && text !== defaultText(character)) || voiceId !== (character?.speechVoice ?? "melotts")) setCandidate(key);
    else applySelection(key);
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!userId || isGuest) { onRequireAccount(); return; }
    if (!canGenerate || !character || working.current) return;
    const version = ++epoch.current, abort = new AbortController(), submitted = text;
    operation.current = abort; working.current = true; setBusy(true); setError(""); setNotice("");
    const current = () => mounted.current && version === epoch.current && !abort.signal.aborted;
    try {
      const asset = await generateXumengCharacterVoice(userId, character.name, character.key, submitted, abort.signal, voiceId);
      if (!current()) return;
      setResult({ asset, text: submitted }); setNotice("朗读已完成，可播放或下载音频。");
      try { await refresh(abort.signal); } catch { if (current()) setNotice("朗读已完成；额度状态暂未更新，可稍后刷新。"); }
    } catch (failure) {
      if (current()) { setError(message(failure)); void refresh(abort.signal).catch(() => {}); }
    } finally {
      if (current()) { working.current = false; operation.current = null; setBusy(false); }
    }
  }
  const access = !userId || isGuest ? "登录正式账户后可生成朗读。" : loading ? "正在读取会员与语音额度…"
    : !overview ? "请刷新状态后生成朗读。" : !overview.enabled ? "角色朗读暂未启用。" : !entitled ? "角色朗读需要有效 VIP 会员。" : "";
  return <section className={s.studio} aria-labelledby="voice-studio-title">
    <header className={s.header}><div><button type="button" className={s.back} onClick={onBack} disabled={busy}>← 返回</button>
      <h1 id="voice-studio-title">角色朗读</h1><p>选择人物，编辑台词，生成一段中文音频。</p></div>
      <div className={s.quota}><span>今日语音</span><strong>{overview ? overview.quotaUnlimited ? "Super 不限量" : `${overview.usage.audio} / ${overview.limits.audio}` : "—"}</strong>
        <small>与聊天消息朗读共用额度</small></div></header>
    {access && <div className={s.access}><span>{access}</span>{(!userId || isGuest) && <button type="button" onClick={onRequireAccount}>登录 / 注册</button>}</div>}
    {error && <p className={s.error} role="alert">{error}</p>}{notice && <p className={s.notice} role="status">{notice}</p>}
    <div className={s.workspace}>
      <aside className={s.character}><label htmlFor="voice-character">朗读人物</label><select id="voice-character" value={selected} onChange={event => select(event.target.value)} disabled={busy || !choices.length}>
        {!choices.length && <option value="">暂无人物</option>}{choices.map(item => <option key={item.key} value={item.key}>{item.name} · {item.sourceLabel}</option>)}</select>
        {character ? <><div className={s.portrait}>{character.avatar ? <img key={character.avatar} src={character.avatar} alt={`${character.name}的形象`} onError={event => { event.currentTarget.style.display = "none"; }} /> : <span>{Array.from(character.name)[0] ?? ""}</span>}</div>
          <h2>{character.name}</h2><p className={s.source}>{character.sourceLabel}</p>{character.personality && <p className={s.description}>{character.personality}</p>}</>
          : <p className={s.empty}>先在角色库或小说人物中创建人物，再来朗读台词。</p>}
        <div className={s.engine}><strong>让声音贴近人物</strong><p>御姐、软萌、甜美、成熟，还有不同风格的男声。</p><small>可在小说人物档案中保存常用音色。朗读与直播分别选择。</small></div>
      </aside>
      <main className={s.editor}>{candidate && <div className={s.selectionConfirm} role="alert"><p>切换人物会载入新台词和音色，替换当前编辑的内容。</p><div className={s.actions}><button type="button" className={s.secondary} onClick={() => setCandidate(null)}>保留当前台词</button><button type="button" className={s.primary} onClick={() => applySelection(candidate)}>切换并载入台词</button></div></div>}<form onSubmit={generate}>
        <div className={s.voiceChoice}><label htmlFor="speech-voice">朗读音色</label><select id="speech-voice" value={voiceId} onChange={event => { voiceEdited.current = true; setVoiceId(event.target.value as XumengSpeechVoiceId); setError(""); setNotice(""); }} disabled={busy}>
          {["默认", "女声", "男声"].map(group => <optgroup key={group} label={group}>{XUMENG_SPEECH_VOICES.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}{overview && !overview.speechVoices.includes(item.id) ? " · 暂不可用" : ""}</option>)}</optgroup>)}
        </select><p>{voice.description}</p>{"previewUrl" in voice && <div className={s.preview}><span>官方试听样例 · 不使用语音额度</span><audio key={voice.id} controls preload="none" src={voice.previewUrl} /></div>}
          {overview && !voiceAvailable && <p role="status">这款音色暂未接通，可选择其他音色或刷新状态。</p>}</div>
        <div className={s.fieldHead}><label htmlFor="voice-text">朗读台词</label><span className={chars > 800 ? s.overLimit : ""}>{chars} / 800 字</span></div>
        <textarea id="voice-text" value={text} onChange={event => setText(event.target.value)} disabled={busy} rows={12} placeholder="输入人物要说的话，只会朗读这里的正文。" aria-describedby="voice-text-help" />
        <p className={s.help} id="voice-text-help">可编辑载入的台词。超过 800 字时请分段；链接和排版标记会在朗读时省略。</p>
        <div className={s.actions}><button className={s.primary} type="submit" disabled={busy || (!canGenerate && Boolean(userId && !isGuest))}>{busy ? "正在生成朗读…" : !userId || isGuest ? "登录后生成朗读" : "生成朗读"}</button>
          <button type="button" className={s.secondary} disabled={busy || loading || !userId || isGuest} onClick={() => { setLoading(true); setError(""); void refresh().catch(failure => { if (mounted.current) setError(message(failure)); }).finally(() => { if (mounted.current) setLoading(false); }); }}>刷新状态</button>
          <span>相同人物、台词与音色复用已有音频</span></div></form>
        <section className={s.output} aria-labelledby="voice-result-title"><h2 id="voice-result-title">朗读结果</h2>
          {result ? <><div className={s.resultHead}><strong>{result.asset.name}</strong><a href={result.asset.url} download={`${result.asset.name}.${result.asset.mimeType === "audio/wav" ? "wav" : "mp3"}`}>下载音频</a></div>
            <audio key={result.asset.id} controls preload="none" src={result.asset.url} onError={() => setError("音频暂时无法播放，请检查登录状态并重新生成；台词已保留。")} />
            <p className={s.help}>已朗读 {result.asset.audioTextChars} 字 · {getXumengSpeechVoice(result.asset.voiceId)?.label ?? "自然中文"}{result.text !== text || result.asset.voiceId !== voiceId ? " · 此为上次生成的结果" : ""}</p>
            <p className={s.transcript}>{result.text}</p></> : <p className={s.empty}>生成后，音频会显示在这里。失败时保留已填写的台词和上一份结果。</p>}
        </section>
      </main>
    </div>
  </section>;
}
