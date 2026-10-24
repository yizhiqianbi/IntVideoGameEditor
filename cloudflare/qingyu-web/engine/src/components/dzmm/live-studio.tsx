"use client";
import { XUMENG_GENERATION_WORKSPACE_ENABLED } from "../../lib/xumeng-feature-availability";

/* eslint-disable @next/next/no-img-element -- Local uploads and provider media previews. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createXumengLiveLease, fetchXumengLiveAvailability, parseXumengLiveSession, parseXumengLiveStatus, parseXumengLiveTask,
  readXumengLiveImage, readXumengCharacterLiveImage, releaseXumengLiveLease, requestXumengLive, XumengLiveRequestError, xumengLiveHttpsUrl, xumengLiveLeasePath,
  type XumengLiveAvailability, type XumengLiveEvent, type XumengLiveReference,
  type XumengLiveLease, type XumengLiveRtc, type XumengLiveSession, type XumengLiveTask,
} from "@/lib/xumeng-live-client";
import { XUMENG_PHONE_DEFAULT_PERSONA, XUMENG_PHONE_DEFAULT_VOICE, buildXumengManualPhonePersona, createXumengManualPhoneContact, getXumengPhoneCallReference, getXumengPhoneSourceReference } from "@/lib/xumeng-phone-contact";
import Icon from "./icons";
import s from "./live-studio.module.css";
import { hasXumengLiveVideoFrame, isXumengLivePublisher, readXumengLiveAudioEvidence, XumengLiveRtcJoinGate, type XumengLiveAudioEvidence } from "@/lib/xumeng-live-rtc";
import { buildXumengLivePersona, type XumengPerformanceCharacter, type XumengLiveSource } from "@/lib/xumeng-performance-character";
import { buildXumengLiveStartPersona, createXumengLiveScene, XumengLiveDialogueHistory, type XumengLiveScene } from "@/lib/xumeng-live-scene";
import { XUMENG_LIVE_VOICE_OPTIONS, getXumengLiveVoice } from "@/lib/xumeng-voices";
import { buildXumengMiniCpmPrompt, fetchXumengMiniCpmStatus, XumengMiniCpmPhone, type XumengMiniCpmEvent } from "@/lib/xumeng-minicpm-phone";

type Props = { userId?: string; isGuest: boolean; isSuper: boolean; userName?: string; onRequireAccount: () => void; onBack: () => void; onBusyChange?: (busy: boolean) => void;
  preferVideo?: boolean;
  characters?: XumengPerformanceCharacter[]; sources?: XumengLiveSource[]; initialCharacter?: XumengPerformanceCharacter; onVoice?: (character: XumengPerformanceCharacter) => void };
type RtcEngine = {
  on: (name: string, listener: (...args: unknown[]) => void) => void;
  publishLocalAudioStream: (enabled: boolean) => Promise<void>; publishLocalVideoStream: (enabled: boolean) => Promise<void>;
  startAudioCapture?: () => Promise<void>; stopAudioCapture?: () => Promise<void>;
  joinChannel: (token: string, userId: string) => Promise<void>; leaveChannel: () => Promise<void>; destroy: () => Promise<void>;
  setRemoteViewConfig: (video: HTMLVideoElement, userId: string, track: number) => void;
  muteAllRemoteAudioPlaying: (mute: boolean) => void; resumeRemoteAudioStream: (userId: string) => void; resumeRemoteMediaStream: (userId: string, track: number) => void;
  setDefaultSubscribeAllRemoteAudioStreams: (enabled: boolean) => void; setDefaultSubscribeAllRemoteVideoStreams: (enabled: boolean) => void;
};
type RtcSdk = { isSupported: (direction?: "recvonly") => Promise<{ support: boolean }>; createInstance: () => RtcEngine };
type StudioWindow = Window & { AliRtcEngine?: RtcSdk };
type Message = { id: string; name: string; text: string; delivery: string; time: number };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const string = (value: unknown, max = 2000) => typeof value === "string" ? value.slice(0, max) : "";
async function compactCallPortrait(dataUrl: string) {
  if (!dataUrl.startsWith("data:image/") || dataUrl.length < 180_000) return dataUrl;
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); } catch { return dataUrl; }
  const scale = Math.min(1, 768 / Math.max(image.width, image.height));
  const width = Math.max(128, Math.round(image.width * scale));
  const height = Math.max(128, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, width, height);
  const compact = canvas.toDataURL("image/jpeg", 0.82);
  return compact.startsWith("data:image/jpeg") && compact.length < dataUrl.length ? compact : dataUrl;
}
const friendly = (value: unknown) => {
  const message = value instanceof Error ? value.message : string(value) || "请求失败，请刷新状态后重试。";
  return /failed to connect qwen realtime websocket/i.test(message) ? "实时语音服务暂时无法连接，请结束本轮后稍后重试。" : message;
};
const TASK_LABEL: Record<string, string> = { created: "已提交", queueing: "排队中", pending: "排队中", processing: "生成中", running: "生成中", success: "已完成", failed: "失败" };
let rtcLoading: Promise<RtcSdk> | null = null;
let rtcCleanup: Promise<void> = Promise.resolve();
function loadRtc(): Promise<RtcSdk> {
  const current = (window as StudioWindow).AliRtcEngine;
  if (current) return Promise.resolve(current);
  if (rtcLoading) return rtcLoading;
  rtcLoading = new Promise<RtcSdk>((resolve, reject) => {
    const script = document.createElement("script"); script.src = "/assets/qingyu/live/rtc.js"; script.async = true;
    const deadline = window.setTimeout(() => fail(), 20000);
    const fail = () => { clearTimeout(deadline); script.remove(); rtcLoading = null; reject(new Error("视频播放器加载失败，请检查网络后重试。")); };
    script.onload = () => {
      clearTimeout(deadline); const sdk = (window as StudioWindow).AliRtcEngine;
      if (sdk) resolve(sdk); else fail();
    };
    script.onerror = fail; document.head.append(script);
  });
  return rtcLoading;
}
function time(value: number) { return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }
type CapturableVideo = HTMLVideoElement & { captureStream?: (frameRate?: number) => MediaStream };
function callRecordingMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1.4D401E,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find(type => MediaRecorder.isTypeSupported(type)) ?? "";
}
function callRecordingStream(video: CapturableVideo) {
  const captured = video.captureStream?.(30);
  const stream = new MediaStream();
  const picture = captured?.getVideoTracks().find(track => track.readyState === "live")
    ?? (video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks().find(track => track.readyState === "live") : undefined);
  if (!picture) return null;
  stream.addTrack(picture);
  const sources: MediaStream[] = [];
  if (captured) sources.push(captured);
  if (video.srcObject instanceof MediaStream) sources.push(video.srcObject);
  document.querySelectorAll("audio").forEach(audio => { if (audio.srcObject instanceof MediaStream) sources.push(audio.srcObject); });
  const seen = new Set<string>();
  for (const source of sources) for (const track of source.getAudioTracks()) {
    if (track.readyState !== "live" || seen.has(track.id)) continue;
    seen.add(track.id);
    try { stream.addTrack(track); } catch { /* The track is already in this recording. */ }
  }
  return stream;
}

export default function LiveStudio({ userId, isGuest, isSuper, userName, onRequireAccount, onBack, onBusyChange, preferVideo = false, characters = [], sources = [], initialCharacter, onVoice }: Props) {
  const [availability, setAvailability] = useState<XumengLiveAvailability | null>(null);
  const [leaseId, setLeaseId] = useState("");
  const [leaseInvalid, setLeaseInvalid] = useState(false);
  const [session, setSession] = useState<XumengLiveSession | null>(null);
  const [loading, setLoading] = useState(false), [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0), [now, setNow] = useState(Date.now());
  const [avatar, setAvatar] = useState("");
  const defaultPersona = XUMENG_PHONE_DEFAULT_PERSONA;
  const [manualName, setManualName] = useState(""), [manualBackground, setManualBackground] = useState("");
  const [manualCandidate, setManualCandidate] = useState(false);
  const manualNameRef = useRef(manualName); manualNameRef.current = manualName;
  const [persona, setPersona] = useState(defaultPersona);
  const [voice, setVoice] = useState(XUMENG_PHONE_DEFAULT_VOICE);
  const [selectedCharacter, setSelectedCharacter] = useState<XumengPerformanceCharacter | null>(initialCharacter ?? null);
  const selectedCharacterRef = useRef(selectedCharacter); selectedCharacterRef.current = selectedCharacter;
  const [characterCandidate, setCharacterCandidate] = useState<XumengPerformanceCharacter | null>(null);
  const [importingCharacter, setImportingCharacter] = useState(false);
  const characterImport = useRef(0), characterAbort = useRef<AbortController | null>(null);
  const characterBaseline = useRef<{ avatar: string; persona: string; voice: string; scene: string } | null>(null);
  const [sourceKey, setSourceKey] = useState("");
  const [scene, setScene] = useState<XumengLiveScene>(() => createXumengLiveScene());
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const dialogueHistory = useRef(new XumengLiveDialogueHistory());
  const [interactionKind, setInteractionKind] = useState<"speech" | "action">("speech"), [interactionText, setInteractionText] = useState("");
  const selectedSource = sources.find(source => source.key === sourceKey);
  const sourceReference = getXumengPhoneSourceReference(selectedCharacter, selectedSource);
  const [references, setReferences] = useState<XumengLiveReference[]>([]);
  const [intent, setIntent] = useState(""), [emotion, setEmotion] = useState(""), [motion, setMotion] = useState("");
  const [audience, setAudience] = useState("观众"), [danmaku, setDanmaku] = useState(""), [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]), [messageCount, setMessageCount] = useState(0);
  const [tasks, setTasks] = useState<XumengLiveTask[]>([]), [logs, setLogs] = useState<{ id: string; text: string; time: number }[]>([]);
  const [overlays, setOverlays] = useState<{ id: string; text: string; top: number }[]>([]);
  const [sheet, setSheet] = useState(false);
  const [clipOn, setClipOn] = useState(false);
  const [clipSeconds, setClipSeconds] = useState(0);
  const [clipFile, setClipFile] = useState<{ url: string; name: string } | null>(null);
  const clip = useRef<MediaRecorder | null>(null);
  const clipChunks = useRef<Blob[]>([]);
  const clipStarted = useRef(0);
  const [mediaStatus, setMediaStatus] = useState("未接通"), [hasVideo, setHasVideo] = useState(false), [recording, setRecording] = useState("");
  const [audioSubscribed, setAudioSubscribed] = useState(false), [audioAllowed, setAudioAllowed] = useState(false);
  const [audioEvidence, setAudioEvidence] = useState<XumengLiveAudioEvidence | null>(null);
  const [videoEvidence, setVideoEvidence] = useState<{ width: number; height: number; track: 1 | 2 } | null>(null);
  const [miniCpmAvailable, setMiniCpmAvailable] = useState(false);
  const [miniCpmConnected, setMiniCpmConnected] = useState(false);
  const [miniCpmMuted, setMiniCpmMuted] = useState(false);
  const mounted = useRef(true), epoch = useRef(0), account = useRef(userId), commandRevision = useRef(0);
  const ownLease = useRef(""), sessionRef = useRef<XumengLiveSession | null>(null), workingRef = useRef<string | null>(null);
  const ownLeaseCredentials = useRef<XumengLiveLease | null>(null);
  const seen = useRef(new Set<string>()), engine = useRef<RtcEngine | null>(null), remoteUsers = useRef(new Set<string>());
  const seenMessageIds = useRef(new Set<string>());
  const pendingRtc = useRef<{ rtc: XumengLiveRtc; generation: number; lease: string; sessionId: string } | null>(null);
  const miniCpm = useRef<XumengMiniCpmPhone | null>(null);
  const rtcJoinGate = useRef(new XumengLiveRtcJoinGate()), frameCallbacks = useRef(new Map<HTMLVideoElement, number>());
  const mediaDeadline = useRef<ReturnType<typeof setTimeout> | null>(null), polling = useRef(false), taskPolling = useRef(new Set<string>());
  const stage = useRef<HTMLDivElement>(null), remote = useRef<HTMLDivElement>(null), history = useRef<HTMLDivElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null), referenceInput = useRef<HTMLInputElement>(null);
  const tasksRef = useRef(tasks); tasksRef.current = tasks;
  const miniCpmMode = !preferVideo && miniCpmAvailable;
  const active = miniCpmMode ? miniCpmConnected : !leaseInvalid && Boolean(session && session.status !== "ended");
  const ready = miniCpmMode ? miniCpmConnected : active && session?.mode === "real" && session.status === "ready";
  const realAllowed = Boolean(!isGuest && availability?.realAllowed), canCall = realAllowed && availability?.configured && !leaseInvalid && Boolean(leaseId), canGenerate = Boolean(isSuper && canCall);
  const elapsed = session ? Math.max(0, Math.floor((now - session.startedAt) / 1000)) : 0;
  const status = loading ? "正在连接" : miniCpmMode ? (active ? "MiniCPM 电话中" : "MiniCPM 已就绪") : leaseInvalid ? "连接已失效" : !leaseId ? "尚未连接" : !active ? session?.reason || "可以设置通话对象" : hasVideo ? "通话中" : ready ? "控制已连接，等待画面" : "正在拨号";
  const current = (generation: number, expectedLease = ownLease.current) => mounted.current && epoch.current === generation && account.current === userId && expectedLease === ownLease.current;
  async function importCharacter(character: XumengPerformanceCharacter) {
    if (active || workingRef.current || importingCharacter || !userId || isGuest) return;
    const revision = ++characterImport.current, accountId = userId;
    characterAbort.current?.abort(); const abort = new AbortController(); characterAbort.current = abort;
    setCharacterCandidate(null); setManualCandidate(false); setManualName(""); setManualBackground(""); setImportingCharacter(true); setError("");
    const nextScene = character.scene ?? { ...createXumengLiveScene("人物初始局势，尚无后续会话"), situation: character.scenario.slice(0, 1500) };
    const nextPersona = buildXumengLivePersona({ ...character, scene: undefined, scenario: "", context: undefined }, userName).slice(0, 2500);
    sceneRef.current = nextScene; setScene(nextScene); setInteractionText("");
    dialogueHistory.current.reset(nextScene.recentDialogue);
    setMessages([]); setMessageCount(0); setOverlays([]); seenMessageIds.current.clear();
    setSourceKey(character.source === "novel" ? `novel:${character.sourceId}` : "character-library");
    setSelectedCharacter(character); setPersona(nextPersona); setVoice(character.liveVoice); setAvatar(""); setReferences([]);
    let nextAvatar = "";
    try {
      if (character.avatar) nextAvatar = await readXumengCharacterLiveImage(character.avatar, abort.signal);
      if (mounted.current && account.current === accountId && characterImport.current === revision) {
        setAvatar(nextAvatar); notify(nextAvatar ? `已导入「${character.name}」，背景已带入，可以拨打电话。` : `已导入「${character.name}」的设定，请添加人物形象。`);
      }
    } catch (failure) {
      if (mounted.current && account.current === accountId && characterImport.current === revision && !abort.signal.aborted) setError(friendly(failure));
    } finally {
      if (mounted.current && account.current === accountId && characterImport.current === revision) {
        characterBaseline.current = { avatar: nextAvatar, persona: nextPersona, voice: character.liveVoice, scene: JSON.stringify(nextScene) }; setImportingCharacter(false);
      }
    }
  }
  function selectCharacter(character: XumengPerformanceCharacter) {
    const baseline = characterBaseline.current;
    const changed = references.length > 0 || (baseline ? avatar !== baseline.avatar || persona !== baseline.persona || voice !== baseline.voice || JSON.stringify(scene) !== baseline.scene : Boolean(avatar) || voice !== XUMENG_PHONE_DEFAULT_VOICE || persona !== defaultPersona || Boolean(scene.situation || scene.goal || scene.relationship || scene.established || scene.ended));
    setManualCandidate(false);
    if (changed || manualName.trim() || manualBackground.trim()) setCharacterCandidate(character); else void importCharacter(character);
  }
  function resetManualContact() {
    if (active || workingRef.current || importingCharacter) return;
    characterImport.current++; characterAbort.current?.abort();
    const contact = createXumengManualPhoneContact();
    setSelectedCharacter(null); selectedCharacterRef.current = null; setSourceKey("");
    setManualName(contact.name); setManualBackground(contact.background); setPersona(contact.persona); setVoice(contact.voice);
    sceneRef.current = contact.scene; setScene(contact.scene); dialogueHistory.current.reset([]);
    setAvatar(""); setReferences([]); setInteractionText(""); setMessages([]); setMessageCount(0); setOverlays([]); seenMessageIds.current.clear();
    setIntent(""); setEmotion(""); setMotion(""); setDanmaku(""); setPrompt("");
    characterBaseline.current = null; setCharacterCandidate(null); setManualCandidate(false); setError(""); setNotice("");
  }
  function selectManualContact() {
    if (!selectedCharacter) return;
    setCharacterCandidate(null); setManualCandidate(true);
  }
  useEffect(() => {
    const revisions = characterImport, abort = characterAbort;
    if (initialCharacter && !isGuest) void importCharacter(initialCharacter);
    return () => { revisions.current++; abort.current?.abort(); };
    // Status refreshes must not overwrite settings edited after the handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCharacter, userId, isGuest]);
  function log(text: string) { if (mounted.current) setLogs(previous => [{ id: crypto.randomUUID(), text: text.slice(0, 2000), time: Date.now() }, ...previous].slice(0, 60)); }
  function notify(text: string) { if (mounted.current) setNotice(text); }
  async function leaveRtc() {
    const generation = epoch.current, lease = ownLease.current, container = remote.current;
    if (mediaDeadline.current) clearTimeout(mediaDeadline.current); mediaDeadline.current = null;
    pendingRtc.current = null;
    for (const [video, id] of frameCallbacks.current) video.cancelVideoFrameCallback?.(id);
    frameCallbacks.current.clear();
    remoteUsers.current.clear(); const old = engine.current; engine.current = null;
    if (old) rtcCleanup = rtcCleanup.then(async () => { try { await old.stopAudioCapture?.(); } catch {} try { await old.leaveChannel(); } catch {} try { await old.destroy(); } catch {} });
    await rtcCleanup;
    if (current(generation, lease) && !engine.current && container === remote.current) {
      container?.replaceChildren(); setHasVideo(false); setMediaStatus("未接通");
    }
  }
  function updateSession(value: XumengLiveSession | null) {
    const previous = sessionRef.current; sessionRef.current = value; setSession(value);
    if (value?.id !== previous?.id) { setError(""); setMessages([]); setMessageCount(0); setOverlays([]); seen.current.clear(); seenMessageIds.current.clear(); dialogueHistory.current.reset(sceneRef.current.recentDialogue); }
    if (value?.status === "ended" && previous?.status !== "ended") setNow(Date.now());
    if (!value || value.status === "ended") void leaveRtc();
    else if (value.status === "ready") connectPendingRtc();
  }
  async function control(action: string, body: Record<string, unknown> = {}, lease = ownLease.current) {
    if (!lease) throw new Error("工作台尚未连接，请刷新状态。");
    if (["stop", "heartbeat", "interaction", "execute", "danmaku", "interrupt", "references"].includes(action)) {
      const owned = sessionRef.current;
      if (!owned) throw new Error("请先拨打电话。");
      body = { ...body, id: owned.id };
    }
    return requestXumengLive(xumengLiveLeasePath(lease, action), { method: "POST", body });
  }
  async function release(lease: XumengLiveLease | null, keepalive = false) { if (lease) await releaseXumengLiveLease(lease, keepalive); }
  function addMessage(value: Message) {
    if (!seenMessageIds.current.has(value.id)) { seenMessageIds.current.add(value.id); setMessageCount(previous => previous + 1); }
    setMessages(previous => { const index = previous.findIndex(message => message.id === value.id); return index >= 0 ? previous.map((message, position) => position === index ? value : message) : [...previous, value].slice(-100); });
  }
  function handleEvent(event: XumengLiveEvent) {
    const owned = sessionRef.current;
    if (event.sessionId && event.sessionId !== owned?.id || owned && !event.sessionId && ["transcript", "interaction", "direction", "danmaku"].includes(event.type) && event.time < owned.startedAt) return;
    const eventKey = `${event.id}:${event.revision ?? 0}`;
    if (seen.current.has(eventKey)) return;
    seen.current.add(eventKey);
    if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value!);
    const data = object(event.data) ? event.data : {};
    if (event.type === "interaction") {
      const text = string(data.text, 1000);
      addMessage({ id: event.id, name: string(data.name, 40) || "玩家", text: data.kind === "action" ? `行动：${text}` : text, delivery: string(data.delivery, 200), time: event.time });
      sceneRef.current = { ...sceneRef.current, recentDialogue: dialogueHistory.current.observe(event.id, "user", data.kind === "action" ? `行动或意向：${text}` : text) }; setScene(sceneRef.current);
    } else if (event.type === "direction") addMessage({ id: event.id, name: "导演", text: [string(data.intent) && `内容：${string(data.intent)}`, string(data.emotion, 100) && `情绪：${string(data.emotion, 100)}`, string(data.motion, 500) && `动作：${string(data.motion, 500)}`].filter(Boolean).join("\n"), delivery: "已发送", time: event.time });
    else if (event.type === "danmaku") {
      const name = string(data.name, 40), text = string(data.text, 500);
      addMessage({ id: event.id, name: name || "观众", text, delivery: string(data.delivery, 200), time: event.time });
      setOverlays(previous => [...previous.slice(-19), { id: event.id, text: `${name}：${text}`, top: 15 + Math.random() * 50 }]);
    } else if (event.type === "transcript" && string(data.text)) {
      const text = string(data.text);
      addMessage({ id: event.id, name: data.role === "主播" ? selectedCharacterRef.current?.name || manualNameRef.current.trim() || "角色" : string(data.role, 40) || "角色", text, delivery: "收到实时字幕", time: event.time });
      if (data.role === "主播") {
        sceneRef.current = { ...sceneRef.current, recentDialogue: dialogueHistory.current.observe(event.id, "character", text) };
        setScene(sceneRef.current);
      }
    }
    else if (event.type === "reference") { const text = data.pending ? string(data.message) : data.success ? "参考图已生效。" : `参考图未生效：${string(data.error_msg) || string(data.error_code) || "请稍后重试。"}`; notify(text); log(text); }
    else if (event.type === "error" || event.type === "start_error") { const text = friendly(event.type === "start_error" ? data.message : event.data); setError(text); log(text); }
  }
  async function refreshStatus(generation = epoch.current, lease = ownLease.current) {
    if (!lease) return;
    const revision = commandRevision.current;
    let value;
    try { value = parseXumengLiveStatus(await requestXumengLive(xumengLiveLeasePath(lease, "status")), userId!); }
    catch (failure) {
      if (failure instanceof XumengLiveRequestError && failure.status === 404 && current(generation, lease) && revision === commandRevision.current) {
        // Invalidate callbacks and local playback, not the provider's end state.
        // Keep the captured lease/token for cleanup when the user reconnects.
        epoch.current++; commandRevision.current++;
        workingRef.current = null; setWorking(null); setLoading(false); polling.current = false; taskPolling.current.clear();
        setLeaseInvalid(true); setLeaseId("");
        setError("工作台连接已失效，请重新连接。这不表示平台已确认结束。");
        setNotice("填写内容已保留。重新连接后需手动拨打电话。");
        void leaveRtc();
        return;
      }
      throw failure;
    }
    if (!current(generation, lease) || revision !== commandRevision.current) return;
    updateSession(value.session); setTasks(value.tasks);
    for (const event of value.events) handleEvent(event);
    if (value.lastStartError && value.lastStartError.time > (value.session?.startedAt ?? 0)) {
      const id = `start-error:${value.lastStartError.time}`;
      if (!seen.current.has(id)) { seen.current.add(id); setError(friendly(value.lastStartError.message)); }
    }
  }
  useEffect(() => {
    const changedAccount = account.current !== userId;
    mounted.current = true; account.current = userId;
    const generation = ++epoch.current;
    commandRevision.current++; workingRef.current = null; setWorking(null); polling.current = false; taskPolling.current.clear();
    ownLease.current = ""; ownLeaseCredentials.current = null; sessionRef.current = null; seen.current.clear(); seenMessageIds.current.clear(); dialogueHistory.current.reset(sceneRef.current.recentDialogue); setLeaseId(""); setLeaseInvalid(false); setSession(null); setAvailability(null);
    setError(""); setNotice(""); setMessages([]); setMessageCount(0); setTasks([]); setLogs([]); setOverlays([]); setRecording("");
    setMiniCpmAvailable(false); setMiniCpmConnected(false); setMiniCpmMuted(false); miniCpm.current?.stop(); miniCpm.current = null;
    pendingRtc.current = null; rtcJoinGate.current.clear(); setAudioSubscribed(false); setAudioAllowed(false); setAudioEvidence(null); setVideoEvidence(null);
    if (changedAccount) { setManualName(""); setManualBackground(""); setManualCandidate(false); setCharacterCandidate(null); setAvatar(""); setReferences([]); setPersona(defaultPersona); setVoice(XUMENG_PHONE_DEFAULT_VOICE); setSelectedCharacter(null); setSourceKey(""); const next = createXumengLiveScene(); sceneRef.current = next; setScene(next); characterBaseline.current = null; setInteractionText(""); setIntent(""); setEmotion(""); setMotion(""); setAudience("观众"); setDanmaku(""); setPrompt(""); }
    if (!userId || isGuest) { setLoading(false); return () => { mounted.current = false; epoch.current = generation + 1; void leaveRtc(); }; }
    let disposed = false;
    setLoading(true);
    void (async () => {
      try {
        // Voice calls use the dedicated phone screen. This studio is the video
        // call, so an available MiniCPM line must not replace the Vidu lease.
        if (!preferVideo) {
          try {
            const mini = await fetchXumengMiniCpmStatus();
            if (mini.available && mini.configured) {
              if (disposed || !current(generation, "")) return;
              setMiniCpmAvailable(true);
              setAvailability({ accountId: userId, available: true, configured: true, realAllowed: true });
              log(`电话音频线路已就绪：${mini.provider || "MiniCPM-o 4.5"}。`);
              return;
            }
          } catch { /* Older/local deployments do not have the phone gateway. */ }
        }
        if (disposed || !current(generation, "")) return;
        const available = await fetchXumengLiveAvailability(userId);
        if (disposed || !current(generation, "")) return;
        setAvailability(available);
        if (!available.available) { setError("实时影像服务暂未启用，请稍后重试。"); return; }
        const credentials = await createXumengLiveLease(userId);
        if (disposed || !current(generation, "")) { void release(credentials, true).catch(() => {}); return; }
        const lease = credentials.leaseId;
        ownLease.current = lease; ownLeaseCredentials.current = credentials; setLeaseId(lease); await refreshStatus(generation, lease);
        if (current(generation, lease)) log("工作台已连接，每个窗口独立控制自己的会话。");
      } catch (failure) { if (!disposed && current(generation)) setError(friendly(failure)); }
      finally { if (!disposed && current(generation)) setLoading(false); }
    })();
    const pagehide = () => { miniCpm.current?.stop(); miniCpm.current = null; const credentials = ownLeaseCredentials.current; if (credentials) void release(credentials, true).catch(() => {}); };
    window.addEventListener("pagehide", pagehide);
    return () => {
      disposed = true; mounted.current = false; epoch.current++; window.removeEventListener("pagehide", pagehide);
      const credentials = ownLeaseCredentials.current; ownLease.current = ""; ownLeaseCredentials.current = null; sessionRef.current = null;
      miniCpm.current?.stop(); miniCpm.current = null; void release(credentials, true).catch(() => {}); void leaveRtc();
    };
    // Every new identity receives its own lease; callbacks are guarded by the captured epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isGuest, reload]);
  useEffect(() => {
    if (!leaseId) return;
    const generation = epoch.current;
    const statusTimer = setInterval(() => {
      if (polling.current || ["start", "stop", "back"].includes(workingRef.current ?? "") || !current(generation, leaseId)) return;
      polling.current = true;
      void refreshStatus(generation, leaseId).catch(failure => { if (current(generation, leaseId)) { setError(`状态读取失败：${friendly(failure)}`); log("状态读取失败，正在等待下一次刷新。"); } }).finally(() => { if (current(generation, leaseId)) polling.current = false; });
    }, 2000);
    const heartbeatTimer = setInterval(() => {
      if (sessionRef.current?.status !== "ended" && sessionRef.current && current(generation, leaseId)) void control("heartbeat", {}, leaseId).catch(failure => { if (current(generation, leaseId)) log(`心跳失败：${friendly(failure)}`); });
    }, 8000);
    const clock = setInterval(() => { if (current(generation, leaseId) && sessionRef.current?.status !== "ended") setNow(Date.now()); }, 1000);
    return () => { clearInterval(statusTimer); clearInterval(heartbeatTimer); clearInterval(clock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseId]);
  useEffect(() => { onBusyChange?.(Boolean(active || working || loading || importingCharacter)); return () => onBusyChange?.(false); }, [active, working, loading, importingCharacter, onBusyChange]);
  useEffect(() => { if (!clipOn) return; const timer = window.setInterval(() => setClipSeconds(Math.floor((Date.now() - clipStarted.current) / 1000)), 500); return () => window.clearInterval(timer); }, [clipOn]);
  useEffect(() => () => { const recorder = clip.current; if (recorder && recorder.state === "recording") recorder.stop(); }, []);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [messages]);
  useEffect(() => { if (!overlays.length) return; const timer = setTimeout(() => setOverlays(previous => previous.slice(1)), 8000); return () => clearTimeout(timer); }, [overlays]);
  useEffect(() => {
    if (!leaseId || !canGenerate) return;
    const generation = epoch.current;
    const timer = setInterval(() => {
      for (const task of tasksRef.current) {
        if (["success", "failed"].includes(task.state) || taskPolling.current.has(task.id) || Date.now() - task.createdAt > 30 * 60 * 1000) continue;
        taskPolling.current.add(task.id);
        void control("task", { id: task.id }, leaseId).then(value => {
          const updated = parseXumengLiveTask(value);
          if (current(generation, leaseId)) setTasks(previous => previous.map(item => item.id === updated.id ? updated : item));
        }).catch(failure => { if (current(generation, leaseId)) log(friendly(failure)); }).finally(() => { if (current(generation, leaseId)) taskPolling.current.delete(task.id); });
      }
    }, 6000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseId, canGenerate]);

  async function action(name: string, operation: (generation: number, lease: string) => Promise<void>) {
    if (workingRef.current) return;
    const generation = epoch.current, lease = ownLease.current;
    workingRef.current = name; setWorking(name); setError(""); setNotice("");
    try { await operation(generation, lease); }
    catch (failure) { if (current(generation, lease)) { setError(friendly(failure)); log(friendly(failure)); } }
    finally { if (current(generation, lease)) { workingRef.current = null; setWorking(null); } }
  }
  async function saveClip(blob: Blob) {
    try {
      const mp4 = blob.type.includes("mp4") ? blob : await (await import("@/lib/video-transcode")).convertRecordingToMp4(blob);
      if (!mp4.size || !mp4.type.includes("mp4")) throw new Error("empty");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const safeName = (selectedCharacterRef.current?.name || "通话").replace(/[\\/:*?"<>|]+/g, "").slice(0, 40) || "通话";
      const name = `${safeName}-${stamp}.mp4`;
      const url = URL.createObjectURL(mp4);
      setClipFile(previous => { if (previous) URL.revokeObjectURL(previous.url); return { url, name }; });
      const link = document.createElement("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    } catch { setError("这次录像没能导出为 MP4，请再录一次。"); }
  }
  function stopClip() {
    const recorder = clip.current;
    if (!recorder || recorder.state !== "recording") return Promise.resolve();
    return new Promise<void>(resolve => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      try { recorder.stop(); } catch { resolve(); }
    });
  }
  function toggleClip() {
    if (clip.current?.state === "recording") { void stopClip(); return; }
    const video = [...(remote.current?.querySelectorAll("video") ?? [])].find(item => item.videoWidth > 0) as CapturableVideo | undefined;
    const mime = callRecordingMime();
    const stream = video ? callRecordingStream(video) : null;
    if (!video || !stream || !mime) { setError("接通画面后再录制。"); return; }
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { mimeType: mime }); }
    catch { setError("当前浏览器不能录制这段视频。"); return; }
    clipChunks.current = [];
    recorder.ondataavailable = event => { if (event.data.size) clipChunks.current.push(event.data); };
    recorder.onerror = () => { clip.current = null; setClipOn(false); setError("录制中断了，请再试一次。"); };
    recorder.onstop = () => {
      const chunks = clipChunks.current; clipChunks.current = []; clip.current = null; setClipOn(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || mime });
      if (!blob.size) { setError("这次没有录到画面。"); return; }
      void saveClip(blob);
    };
    clip.current = recorder; clipStarted.current = Date.now(); setClipSeconds(0); setClipOn(true); setError("");
    recorder.start(1000);
  }
  async function requestStop(generation: number, lease: string) {
    await stopClip();
    commandRevision.current++;
    if (miniCpmMode) {
      miniCpm.current?.stop(); miniCpm.current = null;
      if (current(generation, lease)) { setMiniCpmConnected(false); setSession(null); setHasVideo(false); setMediaStatus("未接通"); }
      return;
    }
    await control("stop", {}, lease);
    if (!current(generation, lease)) return;
    await leaveRtc(); await refreshStatus(generation, lease);
  }
  function connectPendingRtc() {
    const pending = pendingRtc.current;
    if (!pending || !current(pending.generation, pending.lease) || !rtcJoinGate.current.claim(sessionRef.current, pending.sessionId, pending.generation, pending.lease)) return;
    pendingRtc.current = null;
    void joinRtc(pending.rtc, pending.generation, pending.lease, pending.sessionId, commandRevision.current).catch(async failure => {
      if (!current(pending.generation, pending.lease) || sessionRef.current?.id !== pending.sessionId || sessionRef.current.status === "ended") return;
      let message = friendly(failure);
      try { await requestStop(pending.generation, pending.lease); }
      catch (stopFailure) { message += `；结束请求未确认：${friendly(stopFailure)}。请继续点击结束核对。`; }
      if (current(pending.generation, pending.lease)) { setError(message); log(message); }
    });
  }
  async function joinRtc(rtc: XumengLiveRtc, generation: number, lease: string, sessionId: string, revision: number) {
    await rtcCleanup;
    const ownsSession = () => current(generation, lease) && commandRevision.current === revision && sessionRef.current?.id === sessionId && sessionRef.current.status === "ready";
    const sdk = await loadRtc(); if (!ownsSession()) return;
    const support = await sdk.isSupported("recvonly");
    if (!support.support) throw new Error("当前浏览器不支持实时视频，请使用最新版 Chrome。");
    if (!ownsSession()) return;
    const rtcEngine = sdk.createInstance(); engine.current = rtcEngine;
    const ownsEngine = () => ownsSession() && engine.current === rtcEngine;
    let audioLogged = false, videoLogged = false;
    rtcEngine.on("remoteUserOnLineNotify", uid => { if (ownsEngine() && isXumengLivePublisher(uid)) remoteUsers.current.add(uid); });
    rtcEngine.on("remoteUserOffLineNotify", uid => { if (ownsEngine() && isXumengLivePublisher(uid)) remoteUsers.current.delete(uid); });
    rtcEngine.on("remoteAudioAutoPlayFail", uid => { if (ownsEngine() && isXumengLivePublisher(uid)) { remoteUsers.current.add(uid); setAudioAllowed(false); notify("浏览器暂停了声音，请点击「开启声音」。"); } });
    rtcEngine.on("remoteVideoAutoPlayFail", () => { if (ownsEngine()) notify("浏览器暂停了视频，请点击「开启声音」恢复播放。"); });
    rtcEngine.on("audioSubscribeStateChanged", (uid, _oldState, newState) => {
      if (ownsEngine() && isXumengLivePublisher(uid) && newState === 3) { remoteUsers.current.add(uid); setAudioSubscribed(true); }
    });
    rtcEngine.on("rtcRemoteAudioStats", value => {
      if (!ownsEngine()) return;
      const evidence = readXumengLiveAudioEvidence(value);
      if (!evidence) return;
      setAudioEvidence(evidence);
      if (!audioLogged) { audioLogged = true; log(`已接收人物音频数据：${Math.round(evidence.bytes)} 字节、${Math.round(evidence.packets)} 包。声音是否可听请开启播放确认。`); }
    });
    const subscribeVideo = (uid: unknown, newState: unknown, track: 1 | 2) => {
      if (!ownsEngine() || !isXumengLivePublisher(uid)) return;
      if (newState === 3) {
        remoteUsers.current.add(uid);
        let video = [...(remote.current?.querySelectorAll("video") ?? [])].find(item => item.dataset.uid === uid && item.dataset.track === String(track));
        if (!video) { video = document.createElement("video"); video.dataset.uid = uid; video.dataset.track = String(track); video.autoplay = true; video.playsInline = true; video.muted = true; remote.current?.append(video); }
        const rendered = video;
        const markFrame = () => {
          if (!ownsEngine() || !rendered.isConnected || !hasXumengLiveVideoFrame(rendered)) return;
          if (mediaDeadline.current) clearTimeout(mediaDeadline.current); mediaDeadline.current = null;
          setHasVideo(true); setMediaStatus("实时视频已接收");
          if (!videoLogged) { videoLogged = true; setVideoEvidence({ width: rendered.videoWidth, height: rendered.videoHeight, track }); log(`已接收人物视频首帧：${rendered.videoWidth} × ${rendered.videoHeight}，媒体轨 ${track}。`); }
        };
        rendered.onplaying = markFrame; rendered.ontimeupdate = markFrame;
        if (rendered.requestVideoFrameCallback && !frameCallbacks.current.has(rendered)) {
          const firstFrame = () => {
            frameCallbacks.current.delete(rendered);
            markFrame();
            if (ownsEngine() && rendered.isConnected && !videoLogged) frameCallbacks.current.set(rendered, rendered.requestVideoFrameCallback(firstFrame));
          };
          frameCallbacks.current.set(rendered, rendered.requestVideoFrameCallback(firstFrame));
        }
        rtcEngine.setRemoteViewConfig(rendered, uid, track);
        void video.play().catch(() => { if (ownsEngine()) notify("点击「开启声音」开始播放。"); });
      } else if (newState === 1) {
        const video = [...(remote.current?.querySelectorAll("video") ?? [])].find(item => item.dataset.uid === uid && item.dataset.track === String(track));
        if (video) { const frameId = frameCallbacks.current.get(video); if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId); frameCallbacks.current.delete(video); video.remove(); }
        if (!remote.current?.children.length) { setHasVideo(false); setMediaStatus("等待远端视频恢复"); }
      }
    };
    rtcEngine.on("videoSubscribeStateChanged", (uid, _oldState, newState) => subscribeVideo(uid, newState, 1));
    rtcEngine.on("screenShareSubscribeStateChanged", (uid, _oldState, newState) => subscribeVideo(uid, newState, 2));
    const disconnected = (message: string) => { if (!ownsEngine()) return; setError(message); void requestStop(generation, lease).catch(failure => { if (current(generation, lease)) setError(`${message}；结束请求失败：${friendly(failure)}`); }); };
    rtcEngine.on("bye", () => disconnected("实时视频连接已断开，正在结束本轮。"));
    rtcEngine.on("authInfoExpired", () => disconnected("播放器凭证已过期，正在结束本轮。"));
    rtcEngine.setDefaultSubscribeAllRemoteAudioStreams(true); rtcEngine.setDefaultSubscribeAllRemoteVideoStreams(true);
    await rtcEngine.publishLocalAudioStream(false); if (!ownsEngine()) return;
    await rtcEngine.publishLocalVideoStream(false); if (!ownsEngine()) return;
    await rtcEngine.joinChannel(rtc.token, rtc.user_id);
    if (!ownsEngine()) { try { await rtcEngine.leaveChannel(); } catch {} return; }
    let microphone = false;
    try {
      await rtcEngine.startAudioCapture?.();
      await rtcEngine.publishLocalAudioStream(true);
      microphone = true;
    } catch {
      try { await rtcEngine.publishLocalAudioStream(false); } catch { /* Keep receiving the call if the microphone is blocked. */ }
    }
    if (!ownsEngine()) { try { await rtcEngine.stopAudioCapture?.(); await rtcEngine.leaveChannel(); } catch {} return; }
    if (!videoLogged) setMediaStatus("播放器已连接 · 等待首帧");
    log(microphone ? "播放器加入成功，麦克风已打开，对方可以听到你说话。" : "播放器加入成功。麦克风没有打开，对方听不到说话；通话会保持，也可以打字。");
    if (!videoLogged) mediaDeadline.current = setTimeout(() => disconnected("60 秒内未收到视频首帧，正在请求结束，请检查服务权限与网络。"), 60000);
  }
  function handleMiniCpmEvent(event: XumengMiniCpmEvent, generation: number) {
    if (!current(generation, "")) return;
    if (event.type === "ready" || event.type === "session.created") {
      setMiniCpmConnected(true); setMediaStatus("MiniCPM 已接通 · 正在听"); setSession(previous => previous ?? { id: `minicpm-${Date.now()}`, mode: "real", control: "performance", status: "ready", startedAt: Date.now() });
      return;
    }
    if (event.type === "progress" || event.type === "queue") { setMediaStatus(typeof event.phase === "string" ? `MiniCPM · ${event.phase}` : "MiniCPM 正在准备"); return; }
    if (event.type === "text") {
      const text = typeof event.text === "string" ? event.text.slice(0, 4000) : "";
      if (!text) return;
      setMessages(previous => {
        const last = previous[previous.length - 1];
        const row = { id: last?.name === contactName && last.delivery === "MiniCPM" ? last.id : crypto.randomUUID(), name: contactName, text, delivery: "MiniCPM", time: Date.now() };
        return last?.name === contactName && last.delivery === "MiniCPM" ? [...previous.slice(0, -1), row] : [...previous, row];
      });
      setMessageCount(previous => previous + 1); setMediaStatus("MiniCPM 正在回应"); return;
    }
    if (event.type === "voice") { setMediaStatus(`MiniCPM 正在说话 · ${typeof event.audio_seconds === "number" ? event.audio_seconds.toFixed(1) : ""} 秒`); return; }
    if (event.type === "interrupted" || event.type === "cancel_ack") { setMediaStatus("MiniCPM 已回到倾听"); return; }
    if (event.type === "error") {
      const message = typeof event.message === "string" ? event.message : "MiniCPM 电话发生错误。";
      setError(message); log(message); miniCpm.current?.stop(); miniCpm.current = null; setMiniCpmConnected(false); setSession(null); setMediaStatus("未接通");
      return;
    }
    if (event.type === "closed") { setMiniCpmConnected(false); setSession(null); setMediaStatus("电话已结束"); }
  }
  function start() { void action("start", async (generation, lease) => {
    if (importingCharacter) throw new Error("人物形象正在导入，请稍候。");
    if (!selectedCharacter && (!manualName.trim() || !manualBackground.trim())) throw new Error("请填写对方的名字和背景。");
    if (selectedCharacter && !persona.trim()) throw new Error("请填写人物设定。");
    if (miniCpmMode) {
      const livePersona = buildXumengMiniCpmPrompt(selectedCharacter ? persona : buildXumengManualPhonePersona(manualName, manualBackground), contactName, sceneRef.current.situation);
      const phone = new XumengMiniCpmPhone({ systemPrompt: livePersona, onEvent: event => handleMiniCpmEvent(event, generation), onLevel: level => { if (level > 0.022 && current(generation, "")) setMediaStatus("MiniCPM 正在听"); } });
      miniCpm.current = phone;
      await phone.start();
      if (!current(generation, "")) { phone.stop(); return; }
      setMiniCpmConnected(true); setMiniCpmMuted(false); setSession({ id: `minicpm-${Date.now()}`, mode: "real", control: "performance", status: "ready", startedAt: Date.now() }); setMediaStatus("MiniCPM 已接通 · 正在听"); log("MiniCPM-o 4.5 电话已接通；视频工作台保持独立。");
      return;
    }
    if (!avatar) throw new Error("请先上传人物形象。");
    if (!canCall) throw new Error("请先登录后再拨打视频通话。");
    commandRevision.current++;
    const livePersona = buildXumengLiveStartPersona(selectedCharacter ? persona : buildXumengManualPhonePersona(manualName, manualBackground), sceneRef.current, getXumengPhoneCallReference(selectedCharacter, selectedSource));
    const portrait = await compactCallPortrait(avatar);
    const result = await control("start", { mode: "real", avatar: portrait, persona: livePersona, voice, voiceProvider: getXumengLiveVoice(voice)?.provider, control: "performance" }, lease);
    if (!current(generation, lease)) return;
    const started = parseXumengLiveSession(result.session); if (!started) throw new Error("拨号结果缺少会话，请刷新状态核对。");
    updateSession(started); setRecording(""); setNow(Date.now()); setAudioSubscribed(false); setAudioAllowed(false); setAudioEvidence(null); setVideoEvidence(null);
    if (started.mode === "real") {
      try {
        if (started.status === "ended") throw new Error("S2 通话已经结束，请刷新状态核对。");
        if (!object(result.rtc) || !string(result.rtc.token, 20000) || !string(result.rtc.user_id, 300)) throw new Error("服务未返回有效播放器凭证。");
        pendingRtc.current = { rtc: { token: result.rtc.token as string, user_id: result.rtc.user_id as string }, generation, lease, sessionId: started.id };
        setMediaStatus(started.status === "ready" ? "控制已连接 · 正在加入播放器" : "等待 S2 控制就绪");
        connectPendingRtc();
      } catch (failure) {
        try { await requestStop(generation, lease); } catch (stopFailure) { throw new Error(`${friendly(failure)}；结束请求未确认：${friendly(stopFailure)}。请继续点击结束核对。`); }
        throw failure;
      }
    } else {
      await requestStop(generation, lease);
      throw new Error("服务返回的会话不支持实时通话，已请求挂断。请刷新状态后重试。");
    }
  }); }
  function back() { void action("back", async (generation, lease) => {
    const credentials = ownLeaseCredentials.current;
    if (active) await requestStop(generation, lease);
    if (!current(generation, lease)) return;
    await release(credentials); if (!current(generation, lease)) return;
    ownLease.current = ""; ownLeaseCredentials.current = null; sessionRef.current = null; setLeaseId(""); setSession(null); workingRef.current = null; setWorking(null); onBusyChange?.(false); onBack();
  }); }
  async function uploadAvatar(file?: File) {
    if (!file) return; const generation = epoch.current, characterRevision = characterImport.current;
    try { const url = await readXumengLiveImage(file); if (current(generation) && characterRevision === characterImport.current) { setAvatar(url); setError(""); } } catch (failure) { if (current(generation) && characterRevision === characterImport.current) setError(friendly(failure)); }
  }
  async function uploadReferences(files: File[]) {
    const generation = epoch.current, characterRevision = characterImport.current;
    try {
      if (files.length + references.length > 3) throw new Error("最多添加 3 张动态参考图。");
      const urls = await Promise.all(files.map(readXumengLiveImage));
      if (current(generation) && characterRevision === characterImport.current) setReferences(previous => {
        if (previous.length + urls.length > 3) { setError("最多添加 3 张动态参考图。"); return previous; }
        return [...previous, ...urls.map(url => ({ url, kind: "object" as const, description: "" }))];
      });
    } catch (failure) { if (current(generation) && characterRevision === characterImport.current) setError(friendly(failure)); }
  }
  function perform(event: FormEvent) { event.preventDefault(); if (miniCpmMode) { setError("MiniCPM 电话通过麦克风进行实时对话；请直接说话。"); return; } void action("execute", async (generation, lease) => {
    if (!intent.trim() && !emotion.trim() && !motion.trim()) throw new Error("至少填写回应方向、情绪或动作。");
    await control("execute", { intent, emotion, motion }, lease);
    if (current(generation, lease)) { notify("指令已发送，请在通话画面中查看人物回应。"); await refreshStatus(generation, lease); }
  }); }
  function sendDanmaku(event: FormEvent) { event.preventDefault(); if (miniCpmMode) { setError("MiniCPM 电话没有画面弹幕通道。"); return; } void action("danmaku", async (generation, lease) => {
    if (!danmaku.trim()) throw new Error("请填写画面消息内容。");
    const sent = danmaku; await control("danmaku", { name: audience || "观众", text: sent }, lease);
    if (current(generation, lease)) { setDanmaku(previous => previous === sent ? "" : previous); await refreshStatus(generation, lease); }
  }); }
  function interact(event: FormEvent) { event.preventDefault(); if (miniCpmMode) { setError("MiniCPM 电话通过麦克风进行实时对话；请直接说话。"); return; } void action("interaction", async (generation, lease) => {
    if (!interactionText.trim()) throw new Error("请写下你对人物说的话或眼前行动。");
    const sent = interactionText;
    await control("interaction", { kind: interactionKind, text: sent, name: "玩家", scene: sceneRef.current }, lease);
    if (current(generation, lease)) { setInteractionText(previous => previous === sent ? "" : previous); notify("已发送至 S2，等待人物回应。请以字幕和实际画面为准。"); await refreshStatus(generation, lease); }
  }); }
  function editScene(field: "situation" | "goal" | "relationship" | "established" | "ended", value: string) {
    const next = { ...sceneRef.current, [field]: value }; sceneRef.current = next; setScene(next);
  }
  function generate(kind: "image" | "video") { void action(`generate-${kind}`, async (generation, lease) => {
    if (!XUMENG_GENERATION_WORKSPACE_ENABLED) throw new Error("图片与视频生成已暂停开放。");
    if (!prompt.trim()) throw new Error("请填写素材提示词。");
    const result = await control("generate", { kind, prompt, images: references.length ? references.map(item => item.url) : avatar ? [avatar] : [] }, lease);
    const task = parseXumengLiveTask(result);
    if (current(generation, lease)) { setTasks(previous => [task, ...previous.filter(item => item.id !== task.id)].slice(0, 100)); notify("生成任务已提交，可在下方查看状态。"); }
  }); }
  function addGeneratedReference(url: string) {
    if (references.length >= 3) { setError("请先移除一张参考图。"); return; }
    setReferences(previous => [...previous, { url, kind: "object", description: "" }]); notify("已加入动态参考图。");
  }
  const disabled = Boolean(working || loading || importingCharacter);
  const configured = Boolean(availability?.configured);
  const canStart = miniCpmMode
    ? Boolean((selectedCharacter ? persona.trim() : manualName.trim() && manualBackground.trim()) && !active && !disabled && !importingCharacter)
    : Boolean(leaseId && avatar && persona.trim() && canCall && !active && !disabled && !importingCharacter);
  const contactName = selectedCharacter?.name || manualName.trim() || "新的通话对象";
  const contactReady = selectedCharacter ? Boolean(persona.trim()) : Boolean(manualName.trim() && manualBackground.trim());
  const readyToCall = canStart && contactReady;
  const contextLabel = selectedCharacter ? scene.recentDialogue.length ? `已接续 ${scene.recentDialogue.length} 条最近对白` : "已带入人物背景与初始场景" : "不关联故事";
  const missingSetup = importingCharacter ? "正在带入人物形象…" : !contactReady ? "填写名字和背景，认识一下这位通话对象。" : miniCpmMode ? loading ? "正在准备 MiniCPM 电话…" : "" : !avatar ? "添加一张单人形象，即可准备拨号。" : loading ? "正在准备连接…" : leaseInvalid ? "连接已失效，请重新连接。" : !configured ? "通话服务暂未就绪。" : "";
  if (!userId || isGuest) return <section className={s.studio}>
    <header className={s.header}><div className={s.heading}><button className={s.back} onClick={onBack}><Icon name="back" />{preferVideo ? "语音通话" : "返回角色"}</button><h1>{preferVideo ? "视频通话" : "电话"}</h1></div></header>
    <div className={s.accountEmpty}><Icon name="phone" size={38} /><h2>想和谁聊聊？</h2><p>故事里的人物，会带着背景和当前剧情接起电话。<br />也可以认识一位不在故事里的新朋友。</p><button className={s.primary} onClick={onRequireAccount}>登录后选择对象</button><small>登录后即可拨打语音和视频通话。</small></div>
  </section>;
  return <section className={`${s.studio} ${preferVideo ? s.callScreen : ""} ${sheet ? s.sheetOpen : ""}`}>
    <header className={s.header}>
      <div className={s.heading}><button className={s.back} onClick={back} disabled={disabled}><Icon name="back" />{preferVideo ? "语音" : "返回角色"}</button>{preferVideo ? <div className={s.callTitle}><h1>{contactName}</h1><span>{active ? `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}${hasVideo ? " · 已接通" : " · 正在接通"}` : (scene.situation || selectedCharacter?.scenario || "视频通话")}</span></div> : <h1>电话</h1>}</div>
      {preferVideo ? (leaseInvalid ? <button className={s.quiet} disabled={disabled} onClick={() => { if (leaseId) void action("refresh", async (generation, lease) => refreshStatus(generation, lease)); else setReload(previous => previous + 1); }}>重连</button> : <button className={s.quiet} type="button" aria-expanded={sheet} onClick={() => setSheet(open => !open)}>{sheet ? "收起" : "更多"}</button>) : <button className={s.quiet} disabled={disabled} onClick={() => { if (leaseId) void action("refresh", async (generation, lease) => refreshStatus(generation, lease)); else setReload(previous => previous + 1); }}><Icon name="refresh" size={14} />{leaseInvalid ? "重新连接" : "刷新连接"}</button>}
    </header>
    {error && <div className={s.error} role="alert">{error}</div>}
    {notice && <div className={s.notice} role="status">{notice}</div>}
    {!loading && availability && !realAllowed && <div className={s.accessNotice}><Icon name="user" size={15} /><div><strong>登录后即可拨打视频通话</strong><p>通话费用由站点 Vidu 账户结算，不扣本站 Credit。</p></div></div>}
    <div className={s.workspace}>
      <div className={s.callPanel}>
        <label className={preferVideo && characters.length > 0 ? s.pickerHidden : s.contactPicker}>通话对象<select aria-label="通话人物" value={selectedCharacter?.key ?? characters[0]?.key ?? ""} disabled={active || disabled} onChange={event => { const character = characters.find(item => item.key === event.target.value); if (character) selectCharacter(character); }}>
          {selectedCharacter && !characters.some(item => item.key === selectedCharacter.key) && <option value={selectedCharacter.key}>{selectedCharacter.name}</option>}
          {characters.map(character => <option key={character.key} value={character.key}>{character.name}</option>)}
        </select></label>
        {(characterCandidate || manualCandidate) && <div className={s.characterConfirm} role="alert"><p>{manualCandidate ? "新对象将从空白开始，不沿用当前人物的背景和对白。" : `换成「${characterCandidate?.name}」将替换当前背景、形象和音色。`}</p><div className={s.row}><button className={s.secondary} onClick={() => { setCharacterCandidate(null); setManualCandidate(false); }}>保留当前对象</button><button className={s.primary} onClick={() => manualCandidate ? resetManualContact() : characterCandidate && void importCharacter(characterCandidate)}>确认切换</button></div></div>}
        {!selectedCharacter && characters.length === 0 && <div className={s.manualSetup}>
          <label className={s.field}>对方叫什么<input aria-label="通话对象名字" value={manualName} onChange={event => setManualName(event.target.value)} maxLength={120} disabled={active || disabled} placeholder="例如：林知夏" /></label>
          <label className={s.field}>对方的背景<textarea aria-label="通话对象背景" value={manualBackground} onChange={event => setManualBackground(event.target.value)} maxLength={2000} rows={3} disabled={active || disabled} placeholder="例如：你认识多年的朋友，经营一家旧书店，爱开玩笑，今天刚忙完。" /></label>
        </div>}
        <div className={`${s.stage} ${active ? s.activeStage : ""}`} ref={stage}>
          <div className={s.remote} ref={remote} />
          {!hasVideo && <div className={s.placeholder}>
            <button className={s.portrait} onClick={() => avatarInput.current?.click()} disabled={active || disabled} aria-label={avatar || selectedCharacter?.avatar ? "更换人物形象" : "上传人物形象"}>{avatar || selectedCharacter?.avatar ? <img src={avatar || selectedCharacter?.avatar} alt={`${contactName}的通话形象`} /> : <Icon name="user" size={42} />}</button>
            <h2>{contactName}</h2>
            <p>{active ? ready ? "正在接通画面…" : "正在拨号…" : contextLabel}</p>
            {!avatar && !selectedCharacter?.avatar && !active && <button className={s.quiet} disabled={disabled} onClick={() => avatarInput.current?.click()}><Icon name="plus" size={14} />添加人物形象</button>}
          </div>}
          <div className={s.overlays} aria-hidden="true">{overlays.map(item => <span key={item.id} className={s.danmaku} style={{ top: `${item.top}%` }} onAnimationEnd={() => setOverlays(previous => previous.filter(value => value.id !== item.id))}>{item.text}</span>)}</div>
          {active && <div className={s.stageMeta}><span>{mediaStatus}</span><time>{`${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`}</time></div>}
          {clipOn && <div className={s.recordBadge} aria-live="polite"><i />{`${String(Math.floor(clipSeconds / 60)).padStart(2, "0")}:${String(clipSeconds % 60).padStart(2, "0")}`}</div>}
        </div>
        <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { void uploadAvatar(event.target.files?.[0]); event.target.value = ""; }} />
        <div className={preferVideo ? s.lower : undefined}>
        {preferVideo && !active && characters.length > 0 && <div className={s.people} role="listbox" aria-label="通话人物">{characters.map(character => <button type="button" key={character.key} className={character.key === selectedCharacter?.key ? s.personOn : s.person} disabled={disabled} aria-pressed={character.key === selectedCharacter?.key} onClick={() => selectCharacter(character)}><span>{character.avatar ? <img src={character.avatar} alt="" /> : character.name.slice(0, 1)}</span><small>{character.name}</small></button>)}</div>}
        {preferVideo && active && !sheet && <form className={s.quickTalk} onSubmit={interact}><input aria-label="通话说话或行动" maxLength={1000} value={interactionText} onChange={event => setInteractionText(event.target.value)} disabled={disabled} placeholder={interactionKind === "speech" ? "说句话…" : "描述一个动作…"} /><button type="submit" disabled={!ready || disabled || !interactionText.trim()}>{working === "interaction" ? "发送中" : "发送"}</button></form>}
        <div className={s.callControls}>
          <div className={preferVideo ? s.dockRow : undefined}>
          {preferVideo && <button type="button" className={`${s.record} ${clipOn ? s.recordOn : ""}`} aria-pressed={clipOn} onClick={toggleClip}><span /><small>{clipOn ? "停止" : "录制"}</small></button>}
          {active ? <button className={`${s.primary} ${s.hangup}`} aria-label="挂断电话" disabled={disabled} onClick={() => { void action("stop", requestStop); }}><Icon name="phone" size={28} /><span className={preferVideo ? s.visuallyHidden : undefined}>{working === "stop" ? "正在挂断" : "挂断电话"}</span></button> : <button className={s.primary} aria-label="拨打电话" disabled={!readyToCall} onClick={start}><Icon name="phone" size={28} /><span className={preferVideo ? s.visuallyHidden : undefined}>{working === "start" ? "正在拨号" : "拨打电话"}</span></button>}
          </div>
          {preferVideo && clipFile && !clipOn && <a className={s.clipLink} href={clipFile.url} download={clipFile.name}>下载录像</a>}
          {missingSetup && !active && <p className={s.setupLine} role="status">{missingSetup}</p>}
          <small>{miniCpmMode ? "MiniCPM-o 4.5 原生双工音频 · 麦克风只在通话中开启" : "按 Vidu 通话时长结算，当前不扣本站 Credit · 通话保持到挂断或离开页面"}</small>
        </div>
        {active && <div className={s.stageTools}>
          {!miniCpmMode && <button disabled={disabled || !engine.current} onClick={() => { void action("audio", async (generation, lease) => { const rtc = engine.current; if (!rtc) return; rtc.muteAllRemoteAudioPlaying(false); for (const uid of remoteUsers.current) rtc.resumeRemoteAudioStream(uid); for (const video of remote.current?.querySelectorAll("video") ?? []) { if (video.dataset.uid) rtc.resumeRemoteMediaStream(video.dataset.uid, Number(video.dataset.track) === 2 ? 2 : 1); video.muted = false; await video.play(); } if (current(generation, lease) && engine.current === rtc) { setAudioAllowed(true); notify("已允许有声播放，请确认是否听到人物声音。"); } }); }}><Icon name="volume" size={16} />{audioAllowed ? "声音已开启" : "开启声音"}</button>}
          {miniCpmMode && <button disabled={disabled} onClick={() => { miniCpm.current?.mute(!miniCpmMuted); setMiniCpmMuted(value => !value); setMediaStatus(miniCpmMuted ? "MiniCPM 正在听" : "麦克风已静音"); }}>{miniCpmMuted ? "开启麦克风" : "静音麦克风"}</button>}
          <button disabled={disabled} onClick={() => { void action("fullscreen", async () => { if (!stage.current?.requestFullscreen) throw new Error("当前浏览器不支持全屏。"); await stage.current.requestFullscreen(); }); }}><Icon name="grid" size={16} />全屏</button>
          <button disabled={!ready || disabled} onClick={() => { if (miniCpmMode) { miniCpm.current?.interrupt(); setMediaStatus("MiniCPM 已发送打断"); return; } void action("interrupt", async (generation, lease) => { await control("interrupt", {}, lease); if (current(generation, lease)) notify("已发送打断请求。"); }); }}>打断回应</button>
        </div>}
        </div>
      </div>
      <div className={s.extras}>
        {preferVideo && <div className={s.sheetBar}><strong>通话设置</strong><button type="button" className={s.quiet} onClick={() => setSheet(false)}>收起</button></div>}
        <details className={s.contextDetails}>
          <summary>通话背景<span>{contextLabel}</span></summary>
          {selectedCharacter && <><p className={s.contextOrigin}>{selectedCharacter.sourceLabel} · {scene.sourceLabel}</p><label className={s.field}>人物背景<textarea aria-label="人物设定" value={persona} onChange={event => setPersona(event.target.value)} maxLength={2500} rows={5} disabled={active || disabled} /></label></>}
          <label className={s.field}>你们现在的情况<textarea aria-label="当前场景" rows={2} maxLength={1500} value={scene.situation} onChange={event => editScene("situation", event.target.value)} disabled={disabled} placeholder="可选：你在哪里、为何打这通电话，或刚刚发生了什么。" /></label>
          <label className={s.field}>对方现在想做什么<input aria-label="人物当前目标" maxLength={600} value={scene.goal} onChange={event => editScene("goal", event.target.value)} disabled={disabled} placeholder="可选：眼前的目标或未完成的事" /></label>
          <details className={s.continuity}><summary>关系与已知事实</summary>
            <label className={s.field}>关系依据<textarea aria-label="关系依据" rows={2} maxLength={800} value={scene.relationship} onChange={event => editScene("relationship", event.target.value)} disabled={disabled} /></label>
            <label className={s.field}>已确认事实<textarea aria-label="已确认事实" rows={2} maxLength={1200} value={scene.established} onChange={event => editScene("established", event.target.value)} disabled={disabled} /></label>
            <label className={s.field}>已结束的事项<textarea aria-label="已结束事项" rows={2} maxLength={600} value={scene.ended} onChange={event => editScene("ended", event.target.value)} disabled={disabled} /></label>
          </details>
          {scene.recentDialogue.length > 0 && <ol className={s.recentDialogue} aria-label="已带入的最近对白">{scene.recentDialogue.map((row, index) => <li key={index}><b>{row.role === "user" ? "你" : contactName}</b><p>{row.text}</p></li>)}</ol>}
          {(sourceReference || selectedCharacter?.context) && <details className={s.sourceReference}><summary>作品参考</summary><p>{[sourceReference, selectedCharacter?.context].filter(Boolean).join("\n\n")}</p><small>章节参考不代表当前已经发生的事。</small></details>}
          <p className={s.help}>背景在拨号时带入；当前情况和最近对白会随每次互动接续。</p>
        </details>
        <details className={s.settings}>
          <summary>音色与更多设置</summary>
          <label className={s.field}>通话音色<select aria-label="通话音色" value={voice} onChange={event => setVoice(event.target.value)} disabled={active || disabled}>{["默认", "女声", "男声"].map(group => <optgroup key={group} label={group}>{XUMENG_LIVE_VOICE_OPTIONS.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
          <div className={s.row}><button className={s.secondary} onClick={() => avatarInput.current?.click()} disabled={active || disabled}><Icon name="image" size={14} />更换人物形象</button>{selectedCharacter && onVoice && <button className={s.quiet} disabled={active || disabled} onClick={() => onVoice(selectedCharacter)}><Icon name="volume" size={14} />生成角色语音</button>}</div>
          <p className={s.help}>形象使用 PNG / JPG / WebP，5 MB 以内，至少 128 × 128。</p>
        <div className={`${s.sectionHead} ${s.referenceHead}`}><h2>画面参考图</h2><button className={s.quiet} disabled={disabled || references.length >= 3} onClick={() => referenceInput.current?.click()}><Icon name="plus" size={14} />添加</button></div>
        <input ref={referenceInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => { void uploadReferences([...(event.target.files ?? [])]); event.target.value = ""; }} />
        <p className={s.help}>最多 3 张。选择物品、服装或背景，接通后应用。</p>
        <div className={s.references}>
          {!references.length && <p className={s.emptySmall}>暂无参考图</p>}
          {references.map((item, index) => <div key={`${item.url.slice(-30)}:${index}`} className={s.reference}>
            <img src={item.url} alt={`画面参考图 ${index + 1}`} />
            <div><select aria-label={`参考图 ${index + 1} 类型`} value={item.kind} disabled={disabled} onChange={event => setReferences(previous => previous.map((value, i) => i === index ? { ...value, kind: event.target.value as XumengLiveReference["kind"] } : value))}><option value="object">物品</option><option value="garment">服装</option><option value="background">背景</option></select><input aria-label={`参考图 ${index + 1} 说明`} placeholder="例如：换上这件蓝色外套" maxLength={2000} value={item.description} disabled={disabled} onChange={event => setReferences(previous => previous.map((value, i) => i === index ? { ...value, description: event.target.value } : value))} /></div>
            <button className={s.remove} disabled={disabled} aria-label={`移除参考图 ${index + 1}`} onClick={() => setReferences(previous => previous.filter((_, i) => i !== index))}><Icon name="close" size={14} /></button>
          </div>)}
        </div>
        <div className={s.row}><button className={s.secondary} disabled={!ready || disabled || !references.length} onClick={() => { void action("references", async (generation, lease) => { await control("references", { images: references }, lease); if (current(generation, lease)) await refreshStatus(generation, lease); }); }}>应用参考图</button><button className={s.secondary} disabled={!ready || disabled} onClick={() => { void action("references", async (generation, lease) => { await control("references", { remove: true }, lease); if (current(generation, lease)) await refreshStatus(generation, lease); }); }}>还原画面</button></div>

        <details className={s.advanced}><summary>高级互动</summary>
        <form onSubmit={perform}>
          <label className={s.field}>补充回应方向<textarea rows={3} maxLength={1000} value={intent} onChange={event => setIntent(event.target.value)} disabled={disabled} placeholder="给人物补充表演方向，人物仍依据当前场景自行组织表达" /></label>
          <div className={s.directionDetails}><label className={s.field}>情绪<input maxLength={100} value={emotion} onChange={event => setEmotion(event.target.value)} disabled={disabled} placeholder="开心、温柔" /></label><label className={s.field}>动作<input maxLength={500} value={motion} onChange={event => setMotion(event.target.value)} disabled={disabled} placeholder="看向镜头，微笑挥手" /></label></div>
          <button className={`${s.primary} ${s.execute}`} disabled={!ready || disabled} type="submit"><Icon name="send" size={14} />{working === "execute" ? "正在发送" : "发送指令"}</button>
        </form>
        <form className={s.chatForm} onSubmit={sendDanmaku}>
          <label className={s.field}><span>画面消息昵称</span><input aria-label="画面消息昵称" maxLength={40} value={audience} onChange={event => setAudience(event.target.value)} disabled={disabled} /></label>
          <label className={s.field}><span className={s.visuallyHidden}>画面消息内容</span><textarea aria-label="画面消息内容" rows={2} maxLength={500} value={danmaku} onChange={event => setDanmaku(event.target.value)} disabled={disabled} placeholder="发一条画面消息与人物互动" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /></label>
          <div className={s.row}><button className={s.secondary} type="button" disabled={!ready || disabled} onClick={() => { void action("interrupt", async (generation, lease) => { await control("interrupt", {}, lease); if (current(generation, lease)) notify("已发送打断请求。"); }); }}>打断</button><button className={s.primary} disabled={!ready || disabled} type="submit"><Icon name="send" size={14} />发送画面消息</button></div>
        </form>
        </details>

        {(XUMENG_GENERATION_WORKSPACE_ENABLED || tasks.length > 0) && <details className={s.generation}>
          <summary>{XUMENG_GENERATION_WORKSPACE_ENABLED ? "补充素材" : "历史素材"}<span>{XUMENG_GENERATION_WORKSPACE_ENABLED ? "生成参考图与短视频" : "查看已有结果"}</span></summary>
          {XUMENG_GENERATION_WORKSPACE_ENABLED && <>
          <p className={s.help}>{isSuper ? "使用已添加的参考图生成素材，费用由 Vidu 账户结算。" : "素材生成暂限站主账号。"}</p>
          <label className={s.field}><span className={s.visuallyHidden}>素材提示词</span><textarea rows={2} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：简洁的蓝色夹克，白色背景，用作换装参考" disabled={!canGenerate || disabled} /></label>
          <div className={s.generateActions}><button className={s.secondary} disabled={!canGenerate || disabled || !leaseId} onClick={() => generate("image")}><Icon name="image" size={14} />生成参考图</button><button className={s.secondary} disabled={!canGenerate || disabled || !leaseId} onClick={() => generate("video")}><Icon name="play" size={14} />生成 5 秒视频</button></div></>}
          <div className={s.tasks}>{[...tasks].sort((a, b) => b.createdAt - a.createdAt).map(task => <article className={s.task} key={task.id}><div className={s.taskHead}><strong>{task.kind === "image" ? "参考图" : "视频"}</strong><span>{TASK_LABEL[task.state] || task.state}</span></div>{task.error && <p className={s.taskError}>{task.error}</p>}{task.creations.map(creation => <div key={creation.url}>{task.kind === "image" ? <img src={creation.url} alt="生成的参考图" loading="lazy" /> : <video src={creation.url} controls preload="metadata" />}<a href={creation.url} target="_blank" rel="noreferrer">打开原文件 ↗</a>{task.kind === "image" && <div className={s.taskActions}><button className={s.quiet} disabled={disabled || references.length >= 3} onClick={() => addGeneratedReference(creation.url)}>用作参考图</button><button className={s.quiet} disabled={active || disabled} onClick={() => setAvatar(creation.url)}>用作人物形象</button></div>}</div>)}{!["success", "failed"].includes(task.state) && <button className={s.quiet} disabled={!canGenerate || disabled} onClick={() => { void action("task", async (generation, lease) => { const updated = parseXumengLiveTask(await control("task", { id: task.id }, lease)); if (current(generation, lease)) setTasks(previous => previous.map(item => item.id === updated.id ? updated : item)); }); }}><Icon name="refresh" size={12} />刷新任务</button>}</article>)}</div>
        </details>}

          <button className={s.quiet} disabled={disabled || !canCall || session?.mode !== "real"} onClick={() => { void action("recording", async (generation, lease) => { const value = await control("recording", {}, lease); const result = object(value.recording) ? value.recording : {}; const url = xumengLiveHttpsUrl(result.video_url); if (current(generation, lease)) { if (url) setRecording(url); else notify(string(result.error_message) || "录像尚未就绪，挂断约 2 分钟后重试。"); } }); }}><Icon name="download" size={14} />获取本次录像</button>{recording && <a href={recording} target="_blank" rel="noreferrer">打开录像 ↗</a>}
          <details className={s.logs}><summary>连接详情 · Vidu S2</summary><p>{status}。通话保持到你挂断。半小时没有任何说话或文字，平台会结束；刷新或关闭页面会请求挂断。单次最长一小时。</p>
            {session?.mode === "real" && <p aria-live="polite" data-qingyu-live-media="true" data-video-first-frame={Boolean(videoEvidence)} data-video-width={videoEvidence?.width ?? 0} data-video-height={videoEvidence?.height ?? 0} data-video-track={videoEvidence?.track ?? 0} data-audio-received-bytes={audioEvidence?.bytes ?? 0} data-audio-received-packets={audioEvidence?.packets ?? 0} data-audio-playback-permitted={audioAllowed}>画面：{videoEvidence ? `已收到首帧 ${videoEvidence.width} × ${videoEvidence.height}` : "等待首帧"} · 声音：{audioEvidence ? `已收到 ${Math.round(audioEvidence.bytes / 1024)} KB 音频` : audioSubscribed ? "已订阅，等待声音数据" : "等待音频"} · {audioAllowed ? "已允许播放，实际听感待确认" : "尚未允许播放"}</p>}
            <div>{logs.map(item => <p key={item.id}><time>{time(item.time)}</time> {item.text}</p>)}</div>
          </details>
        </details>
      <aside className={s.conversation} aria-label="通话互动">
        <div className={s.sectionHead}><h2>和{contactName === "新的通话对象" ? "对方" : contactName}聊聊</h2><span>{messageCount > 0 ? `${messageCount} 条` : ""}</span></div>
        {selectedCharacter && <p className={s.contextPreview}>{scene.situation || "人物会依据自己的背景与你交谈。"}</p>}
        <div className={s.messages} ref={history} aria-live="polite">{!messages.length && <div className={s.emptyHistory}><Icon name="chat" size={24} /><p>{active ? "等待对方回应" : "电话接通后，聊聊你想说的"}</p><small>{scene.recentDialogue.length ? "之前的对白已带入，不需要从头介绍。" : "对方会带着上面的背景与你交谈。"}</small></div>}{messages.map(message => <article className={s.message} key={message.id}><div><span>{message.name === "玩家" ? "你" : message.name}</span><time>{time(message.time)}</time></div><p>{message.text}</p><small>{message.delivery}</small></article>)}</div>
        <form className={s.interactionForm} onSubmit={interact}>
          <div className={s.interactionKinds}><button type="button" aria-pressed={interactionKind === "speech"} onClick={() => setInteractionKind("speech")} disabled={disabled}>说句话</button><button type="button" aria-pressed={interactionKind === "action"} onClick={() => setInteractionKind("action")} disabled={disabled}>做个动作</button></div>
          <label className={s.field}><span className={s.visuallyHidden}>通话说话或行动</span><textarea aria-label="通话说话或行动" rows={3} maxLength={1000} value={interactionText} onChange={event => setInteractionText(event.target.value)} disabled={disabled} placeholder={interactionKind === "speech" ? "想对 TA 说些什么？" : "描述你此刻想做的动作…"} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /></label>
          <button className={s.primary} type="submit" disabled={!ready || disabled || !interactionText.trim()}><Icon name="send" size={16} />{working === "interaction" ? "正在发送" : "发送"}</button>
          <p className={s.help}>输入文字，对方以语音和画面回应。{active ? "发送后以实际画面和字幕为准。" : "接通后即可发送。"}</p>
        </form>
      </aside>
      </div>
    </div>
  </section>;
}
