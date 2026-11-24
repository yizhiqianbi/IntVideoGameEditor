"use client";

import { useEffect, useMemo, useState } from "react";
import { STUDIO_IMAGE_GROUPS, STUDIO_IMAGE_TEMPLATES, VIDEO_TEMPLATES, noteError, type ImageTemplate, type VideoTemplate } from "@/lib/catalog";
import { findChannelModule, type ChannelField, type ResultKind } from "@/lib/channel-catalog";
import { PRESET_VOICES } from "@/lib/voice-options";
import { findWorkTool, presentField, type MediaId, type WorkEngine } from "@/lib/workbench";

const ASSETS = "https://xumengchat.top";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const REFERENCE_BYTES = 3_200_000;

type ListedImage = ImageTemplate & { cover?: string };
type LiveVideo = VideoTemplate & { cover?: string };
type LiveGroup = { id: string; label: string };
type Packed = { type: string; data: string };
type Outcome = { kind: ResultKind; url: string; text: string; type: string };

const VOICE_MODULES = new Set(["generate-audio", "generate-ttsv2"]);

const ACCEPT: Record<ChannelField["kind"], string> = {
  text: "",
  prompt: "",
  image: "image/png,image/jpeg,image/webp",
  images: "image/png,image/jpeg,image/webp",
  video: "video/mp4",
  audio: "audio/mpeg,audio/wav,audio/mp4,.mp3,.wav,.m4a",
  file: ".txt,.md,text/plain,text/markdown",
};

type Props = {
  toolId: string;
  group: string;
  videoId: string;
  onGroup: (id: string) => void;
  onVideo: (id: string) => void;
};

function acceptedImage(file: File): boolean {
  return IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("这张参考图无法读取。"));
    reader.readAsDataURL(file);
  });
}

async function encodedJpeg(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > edge ? edge / longest : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("这张参考图无法读取。");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("这张参考图无法读取。");
  return blob;
}

async function referenceDataUrl(file: File): Promise<string> {
  if (file.size > 0 && file.size <= REFERENCE_BYTES) return readFile(file);
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("这张参考图无法读取。");
  try {
    let edge = 1920;
    let quality = 0.92;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const blob = await encodedJpeg(bitmap, edge, quality);
      if (blob.size <= REFERENCE_BYTES) return readFile(blob);
      if (quality > 0.55) quality -= 0.12;
      else edge = Math.round(edge * 0.75);
    }
    throw new Error("这张参考图无法读取。");
  } finally {
    bitmap.close();
  }
}

function shownError(failure: unknown, fallback: string): string {
  if (failure instanceof TypeError || (failure instanceof Error && failure.message === "Failed to fetch")) {
    return "页面连不上服务。刷新后再试一次。";
  }
  return failure instanceof Error && failure.message ? failure.message : fallback;
}

function isListedImage(value: unknown): value is ListedImage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ListedImage>;
  return typeof item.id === "string" && /^[a-z0-9-]{1,80}$/i.test(item.id)
    && typeof item.label === "string"
    && typeof item.englishLabel === "string"
    && typeof item.group === "string"
    && typeof item.aspectRatio === "string"
    && typeof item.frame === "string"
    && (item.cover === undefined || typeof item.cover === "string");
}

function isLiveVideo(value: unknown): value is LiveVideo {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LiveVideo>;
  return typeof item.id === "string" && /^[a-z0-9-]{1,80}$/i.test(item.id)
    && typeof item.label === "string"
    && typeof item.englishLabel === "string"
    && typeof item.description === "string"
    && typeof item.action === "string"
    && (item.cover === undefined || typeof item.cover === "string");
}

function isLiveGroup(value: unknown): value is LiveGroup {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LiveGroup>;
  return typeof item.id === "string" && typeof item.label === "string";
}

function imageCover(item: ListedImage): string {
  return item.cover || `${ASSETS}/assets/xumeng/krea2-actions/${item.id}.webp`;
}

function videoCover(item: LiveVideo): string {
  return item.cover || `${ASSETS}/assets/xumeng/h3-actions/${item.id}.webp`;
}

function pack(file: File): Promise<Packed> {
  return file.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return { type: file.type || "application/octet-stream", data: btoa(binary) };
  });
}

function fileLimit(kind: ChannelField["kind"]): number {
  switch (kind) {
    case "image":
    case "images": return 4_500_000;
    case "video":
    case "audio": return 8_000_000;
    case "file": return 1_000_000;
    case "text":
    case "prompt": return 0;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function defaults(moduleId: string): Record<string, string> {
  const module = findChannelModule(moduleId);
  const next: Record<string, string> = {};
  if (!module) return next;
  for (const field of module.fields) {
    if (field.key === "source_language") next[field.key] = "zh";
    if (field.key === "spk_id" && VOICE_MODULES.has(moduleId)) next[field.key] = PRESET_VOICES[0];
    if (field.key === "language") next[field.key] = "Chinese";
    if (field.key === "continuation_type") next[field.key] = "continue_chapter";
    if (field.key === "output_format") next[field.key] = "video";
    if (field.key === "count" && moduleId === "generate-novel") next[field.key] = "4000";
    if (field.key === "count" && moduleId === "continue-novel") next[field.key] = "2000";
  }
  return next;
}

function placeholder(field: ChannelField): string {
  switch (field.key) {
    case "model": return "留空用接口默认";
    case "scene_name": return "场景名。标了可选就可以留空";
    case "method": return "留空用接口默认";
    case "spk_id": return "音色编号";
    case "source_language": return "zh";
    case "continuation_type": return "continue_chapter 或 new_chapters";
    case "count": return field.label.includes("新增") ? "默认 2000，范围 500–2000" : "默认 4000 字，为目标准则，不保证精确";
    case "character_setting": return "可不填。人物是谁，性格如何。";
    case "location_scene": return "可不填。故事发生在哪里。";
    case "details": return "可不填。语气、节奏等其他要求。";
    case "cues": return "字幕条目";
    default: return field.required ? "必填" : "可不填";
  }
}

function actionLabel(media: MediaId, busy: boolean): string {
  if (busy) return "正在提交…";
  switch (media) {
    case "image": return "生成这张图";
    case "video": return "生成这条视频";
    case "audio": return "生成这段音频";
    case "text": return "开始生成";
    default: {
      const unreachable: never = media;
      return unreachable;
    }
  }
}

function downloadName(outcome: Outcome): string {
  if (outcome.type.includes("mp4")) return "xumeng-video.mp4";
  if (outcome.type.startsWith("audio/")) return "xumeng-audio";
  if (outcome.type.includes("jpeg")) return "xumeng-image.jpg";
  if (outcome.type.includes("webp")) return "xumeng-image.webp";
  if (outcome.kind === "text") return "xumeng-text.txt";
  return "xumeng-image.png";
}

export default function Workbench({ toolId, group, videoId, onGroup, onVideo }: Props) {
  const tool = findWorkTool(toolId) ?? findWorkTool("template-image")!;
  const [engineId, setEngineId] = useState(tool.engines[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [imageTemplate, setImageTemplate] = useState<ImageTemplate | null>(null);
  const [previewing, setPreviewing] = useState("");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [referenceName, setReferenceName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [catalogImages, setCatalogImages] = useState<ListedImage[] | null>(null);
  const [catalogGroups, setCatalogGroups] = useState<LiveGroup[] | null>(null);
  const [videos, setVideos] = useState<LiveVideo[]>(VIDEO_TEMPLATES);
  const [voices, setVoices] = useState<string[]>([...PRESET_VOICES]);

  const engine = tool.engines.find(item => item.id === engineId) ?? tool.engines[0];
  const videoTemplate = videos.find(item => item.id === videoId) ?? videos[0] ?? null;
  const groups = catalogGroups ?? STUDIO_IMAGE_GROUPS;
  const gallery = engine?.kind === "studio" && (engine.studio === "image" || engine.studio === "video");

  useEffect(() => () => { if (outcome?.url.startsWith("blob:")) URL.revokeObjectURL(outcome.url); }, [outcome]);
  useEffect(() => {
    const next = findWorkTool(toolId);
    const first = next?.engines[0];
    setEngineId(first?.id ?? "");
    setValues(first?.kind === "channel" ? defaults(first.moduleId) : {});
    setFiles({});
    setError("");
  }, [toolId]);
  useEffect(() => {
    if (!imageTemplate || group === "all" || imageTemplate.group === group) return;
    setImageTemplate(null);
  }, [group, imageTemplate]);
  useEffect(() => {
    let cancel = false;
    const load = () => {
      fetch("/api/templates")
        .then(response => response.ok ? response.json() : null)
        .then(payload => {
          if (cancel || !payload || typeof payload !== "object") return;
          const body = payload as { images?: unknown; videos?: unknown; groups?: unknown };
          if (Array.isArray(body.images)) setCatalogImages(body.images.filter(isListedImage));
          if (Array.isArray(body.groups)) setCatalogGroups(body.groups.filter(isLiveGroup));
          if (Array.isArray(body.videos)) setVideos(body.videos.filter(isLiveVideo));
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      cancel = true;
      window.removeEventListener("focus", load);
    };
  }, []);
  useEffect(() => {
    let cancel = false;
    fetch("/api/voices")
      .then(response => response.ok ? response.json() : null)
      .then(payload => {
        if (cancel || !payload || typeof payload !== "object" || !Array.isArray((payload as { voices?: unknown }).voices)) return;
        const next = (payload as { voices: unknown[] }).voices.filter((item): item is string => typeof item === "string" && item.length > 0);
        if (next.length) setVoices(next);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  const images = useMemo(() => {
    const text = query.trim().toLowerCase();
    const seen = new Set<string>();
    return (catalogImages ?? STUDIO_IMAGE_TEMPLATES).filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return (group === "all" || item.group === group)
        && (!text || `${item.label} ${item.englishLabel}`.toLowerCase().includes(text));
    });
  }, [catalogImages, group, query]);

  function pickEngine(next: WorkEngine) {
    setEngineId(next.id);
    setValues(next.kind === "channel" ? defaults(next.moduleId) : {});
    setFiles({});
    setError("");
  }

  async function chooseReference(file: File | undefined) {
    if (!file) return;
    if (!acceptedImage(file)) {
      setError("请选择 PNG、JPG 或 WebP。");
      return;
    }
    try {
      setReference(await referenceDataUrl(file));
      setReferenceName(file.name);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "这张参考图无法读取。");
    }
  }

  async function submitStudio() {
    if (!engine || engine.kind !== "studio") return;
    const rejected = noteError(note);
    if (rejected) { setError(rejected); return; }
    if (engine.studio === "draw" || engine.studio === "clip") {
      if (!note.trim()) {
        setError(engine.studio === "draw" ? "先写一句想画的内容。" : "先写一句想看的动作。");
        return;
      }
      await runStudio(engine.studio === "draw" ? "/api/draw" : "/api/clip", { prompt: note }, engine.studio === "draw" ? "image" : "video");
      return;
    }
    const templateId = engine.studio === "image" ? imageTemplate?.id : videoTemplate?.id;
    if (!templateId) {
      setError(engine.studio === "image" ? "先选一个画面模板。" : "先选一个动作模板。");
      return;
    }
    if (!reference) { setError("请先上传角色图。"); return; }
    await runStudio(engine.studio === "image" ? "/api/generate" : "/api/video", {
      templateId,
      note,
      image: reference.slice(reference.indexOf(",") + 1),
    }, engine.studio === "image" ? "image" : "video");
  }

  async function runStudio(path: string, body: Record<string, string>, kind: ResultKind) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "没有完成。");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setOutcome(previous => {
        if (previous?.url.startsWith("blob:")) URL.revokeObjectURL(previous.url);
        return { kind, url, text: "", type: response.headers.get("Content-Type") ?? "" };
      });
    } catch (failure) {
      setError(shownError(failure, "没有完成。"));
    } finally {
      setBusy(false);
    }
  }

  async function submitChannel() {
    if (!engine || engine.kind !== "channel") return;
    const module = findChannelModule(engine.moduleId);
    if (!module) { setError("没有这个做法。"); return; }
    const rejected = noteError(Object.values(values).join("\n"));
    if (rejected) { setError(rejected); return; }
    const payload: Record<string, string> = {};
    const uploads: Record<string, Packed | Packed[]> = {};
    for (const field of module.fields) {
      const chosen = files[field.key] ?? [];
      const limit = fileLimit(field.kind);
      if (chosen.length) {
        if (chosen.some(file => file.size > limit)) {
          setError(`${presentField(field)}太大。图片 4.5MB 以内，视频和音频 8MB 以内，更大的请贴 https 链接。`);
          return;
        }
        const packed = await Promise.all(chosen.map(pack));
        uploads[field.key] = field.kind === "images" ? packed : packed[0];
        continue;
      }
      const value = (values[field.key] ?? "").trim();
      if (field.kind === "images" && value) {
        payload[field.key] = JSON.stringify(value.split(/\s+/).filter(Boolean));
        continue;
      }
      if (value) payload[field.key] = value;
      else if (field.required) { setError(`请填写${presentField(field)}。`); return; }
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: module.id, values: payload, files: uploads }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(failure?.error || "没有完成。");
      }
      const type = response.headers.get("Content-Type") ?? "";
      if (type.startsWith("text/") || type.includes("json")) {
        const text = await response.text();
        setOutcome(previous => {
          if (previous?.url.startsWith("blob:")) URL.revokeObjectURL(previous.url);
          return { kind: "text", url: "", text, type };
        });
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setOutcome(previous => {
          if (previous?.url.startsWith("blob:")) URL.revokeObjectURL(previous.url);
          return { kind: module.result, url, text: "", type };
        });
      }
    } catch (failure) {
      setError(shownError(failure, "没有完成。"));
    } finally {
      setBusy(false);
    }
  }

  function mediaField(moduleId: string, field: ChannelField) {
    const chosen = files[field.key] ?? [];
    const inputId = `work-${moduleId}-${field.key}`;
    return <>
      <input className="file" id={inputId} type="file" accept={ACCEPT[field.kind]} multiple={field.kind === "images"} onChange={event => {
        const list = [...(event.target.files ?? [])];
        event.target.value = "";
        setFiles(previous => ({ ...previous, [field.key]: list }));
      }} />
      <button type="button" className="upload" onClick={() => document.getElementById(inputId)?.click()}>
        {chosen.length ? chosen.map(file => file.name).join("、") : field.kind === "images" ? "上传 1 到 9 张图" : "上传文件"}
      </button>
      <input value={values[field.key] ?? ""} placeholder="或粘贴 https 链接" aria-label={`${presentField(field)}链接`} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} />
    </>;
  }

  function control(moduleId: string, field: ChannelField) {
    const label = presentField(field);
    switch (field.kind) {
      case "prompt":
      case "text":
        if (field.key === "spk_id" && VOICE_MODULES.has(moduleId)) {
          const selected = voices.includes(values[field.key] ?? "") ? values[field.key] : voices[0];
          return <select value={selected} aria-label={label} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))}>
            {voices.map(voice => <option key={voice} value={voice}>{voice}</option>)}
          </select>;
        }
        if (field.kind === "prompt" || field.key === "cues") {
          return <textarea className="note" rows={4} maxLength={4000} value={values[field.key] ?? ""} placeholder={placeholder(field)} aria-label={label} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} />;
        }
        return <input value={values[field.key] ?? ""} placeholder={placeholder(field)} aria-label={label} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} />;
      case "image":
      case "images":
      case "video":
      case "audio":
      case "file":
        return mediaField(moduleId, field);
      default: {
        const unreachable: never = field.kind;
        return unreachable;
      }
    }
  }

  const module = engine?.kind === "channel" ? findChannelModule(engine.moduleId) : undefined;
  const studioPrompt = engine?.kind === "studio" && (engine.studio === "draw" || engine.studio === "clip");
  const needsReference = engine?.kind === "studio" && (engine.studio === "image" || engine.studio === "video");

  return <section className="studio" id="studio">
    <div className="studio-head">
      <h2>{tool.label}</h2>
      <p>{tool.engines.length > 1 ? `${tool.detail} 不同做法在左边选。` : tool.detail}</p>
    </div>
    <div className="layout">
      <section className="panel" aria-label="做法">
        {gallery && engine.kind === "studio" && engine.studio === "image" ? <>
          <div className="toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索画面模板" aria-label="搜索画面模板" /></div>
          <div className="groups" role="group" aria-label="生图分类">
            <button type="button" aria-pressed={group === "all"} onClick={() => onGroup("all")}>全部</button>
            {groups.map(item => <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => onGroup(item.id)}>{item.label}</button>)}
          </div>
          <div className="grid">
            {images.map(item => <button type="button" className="card" key={item.id} aria-pressed={imageTemplate?.id === item.id} onClick={() => setImageTemplate(item)}>
              <img src={imageCover(item)} alt="" />
              <span>{item.label}</span>
            </button>)}
            {images.length === 0 && <p className="empty">这一类没有画面模板。</p>}
          </div>
        </> : gallery && engine.kind === "studio" && engine.studio === "video" ? <div className="grid">
          {videos.map(item => <button type="button" className="card" key={item.id} aria-pressed={videoTemplate?.id === item.id} onClick={() => onVideo(item.id)}
            onPointerEnter={() => setPreviewing(item.id)} onPointerLeave={() => setPreviewing(current => current === item.id ? "" : current)}
            onFocus={() => setPreviewing(item.id)} onBlur={() => setPreviewing(current => current === item.id ? "" : current)}>
            <div className="thumb">
              <img src={videoCover(item)} alt="" />
              {previewing === item.id && <video src={`${ASSETS}/assets/xumeng/h3-actions/${item.id}.mp4`} poster={videoCover(item)} autoPlay muted loop playsInline preload="auto" />}
            </div>
            <span>{item.label}</span>
          </button>)}
        </div> : tool.engines.length > 1 ? <div className="models engine-list">
          {tool.engines.map(item => <button type="button" key={item.id} aria-pressed={item.id === engine?.id} onClick={() => pickEngine(item)}>
            <span>{item.label}</span>
            <small>{item.detail}</small>
          </button>)}
        </div> : <p className="meta">{engine?.detail}</p>}
      </section>
      <aside className="side">
        <section className="panel">
          <h2>{tool.label}</h2>
          <p className="meta">{engine && tool.engines.length > 1 ? engine.detail : tool.detail}</p>
          {needsReference && engine.kind === "studio" && <>
            <input className="file" id="reference" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void chooseReference(file); }} />
            {reference ? <div className="reference"><img src={reference} alt="" /><div><strong>{referenceName}</strong><div><button type="button" className="secondary" onClick={() => document.getElementById("reference")?.click()}>更换</button></div></div></div>
              : <button type="button" className="upload" onClick={() => document.getElementById("reference")?.click()}>上传角色图</button>}
            <p className="hint">{engine.studio === "image"
              ? `当前模板：${imageTemplate?.label ?? "还没选"}。真人照片上的脸不会留下来。`
              : `当前动作：${videoTemplate?.label ?? "还没选"}。真人照片上的脸不会留下来。`}</p>
            <label>补充要求<textarea className="note" rows={3} maxLength={400} value={note} onChange={event => setNote(event.target.value)} placeholder="可不填。想改服装或光线时再写。" /></label>
          </>}
          {studioPrompt && engine.kind === "studio" && <label>{engine.studio === "draw" ? "提示词" : "动作"}<textarea className="note" rows={4} maxLength={400} value={note} onChange={event => setNote(event.target.value)} placeholder={engine.studio === "draw" ? "例如：成年角色，站在雨夜的车站。" : "例如：成年角色，转身看向镜头。"} /></label>}
          {module?.fields.map(field => <label key={field.key}>{presentField(field)}{field.required || (field.key === "spk_id" && VOICE_MODULES.has(module.id)) ? "" : "（可选）"}{control(module.id, field)}</label>)}
          {error && <div className="alert" role="alert">{error}</div>}
          <button type="button" className="primary wide" disabled={busy || !engine} onClick={() => void (engine?.kind === "studio" ? submitStudio() : submitChannel())}>{actionLabel(tool.media, busy)}</button>
        </section>
        <section className="panel">
          <div className="result">
            {outcome?.kind === "text" ? <pre className="novel">{outcome.text}</pre>
              : outcome?.type.startsWith("audio/") ? <audio src={outcome.url} controls />
              : outcome?.kind === "image" ? <img src={outcome.url} alt="生成结果" />
              : outcome?.url ? <video src={outcome.url} controls playsInline />
              : <p className="empty">{busy ? "请稍等，生成通常要几分钟。" : "结果会显示在这里。"}</p>}
          </div>
          {outcome?.url && <a className="secondary" href={outcome.url} download={downloadName(outcome)}>下载</a>}
          {outcome?.kind === "text" && outcome.text && <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(outcome.text)}>复制文本</button>}
        </section>
      </aside>
    </div>
  </section>;
}
