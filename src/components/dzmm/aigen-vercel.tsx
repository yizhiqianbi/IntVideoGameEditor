"use client";

import { useEffect, useRef, useState } from "react";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import "./aigen-vercel.css";

type View = "home" | "video" | "image" | "face" | "coat" | "novel";
type Props = { locale?: XumengLocale; onRoute: (route: string) => void; onBack: () => void };

const MODULE_ART: Record<string, string> = {
  video: "/assets/xumeng/content-covers/create-generate.webp",
  image: "/assets/xumeng/content-covers/create-girlfriend.webp",
  face: "/assets/xumeng/content-covers/create-role.webp",
  coat: "/assets/xumeng/content-covers/create-scenario.webp",
  novel: "/assets/xumeng/content-covers/create-novel.webp",
};

const MODULES = [
  { id: "video", label: "图生视频", line: "将图片转为动态视频", mark: "动" },
  { id: "image", label: "AI生图", line: "输入文字，生成专属画面", mark: "图" },
  { id: "face", label: "AI换脸", line: "上传图片，生成换脸作品", mark: "脸" },
  { id: "coat", label: "脱衣服", line: "一键脱掉衣服", mark: "衣" },
  { id: "novel", label: "AI小说", line: "一键创作你的故事", mark: "文" },
] as const;

const COMMON_NOTES = [
  "只生成虚构的成年角色。",
  "生成过程通常需要几十秒，请勿关闭页面。",
  "参考图要清晰，主体明确。",
];

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读不了。"));
    reader.readAsDataURL(file);
  });
}

function Lead({ title, line }: { title: string; line: string }) {
  return <p className="lead"><strong>{title}</strong><span>{line}</span></p>;
}

function Guide({ steps }: { steps: string[] }) {
  return <aside className="guide"><p className="guide-kicker">新手教程</p><p className="guide-title">三步轻创作</p><ol>{steps.map(step => <li key={step}>{step}</li>)}</ol></aside>;
}

function Notes({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return <div className="notes"><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>注意事项</button>{open ? <ul>{items.map(item => <li key={item}>{item}</li>)}</ul> : null}</div>;
}

function Upload({ title, hint, preview, onFile, disabled }: { title: string; hint: string; preview: string; onFile: (file: File | undefined) => void; disabled: boolean }) {
  return <label className={preview ? "drop has-file" : "drop"}>
    <input className="file" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
    {preview ? <img src={preview} alt="" /> : <><span className="plus" aria-hidden="true">+</span><strong>{title}</strong><span>{hint}</span></>}
  </label>;
}

function Prompt({ value, onChange, placeholder, disabled }: { value: string; onChange: (value: string) => void; placeholder: string; disabled: boolean }) {
  return <div className="prompt-box">
    <div className="field-head"><p className="meta">画面描述 <em>必填</em></p><span className="meta">{value.trim().length} / 800</span></div>
    <textarea value={value} maxLength={800} rows={4} disabled={disabled} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
  </div>;
}

function Choices({ label, value, options, onChange, disabled }: { label: string; value: string; options: Array<{ id: string; label: string }>; onChange: (value: string) => void; disabled: boolean }) {
  return <div><p className="meta">{label}</p><div className="choices" role="radiogroup" aria-label={label}>{options.map(option => <button type="button" key={option.id} role="radio" aria-checked={value === option.id} disabled={disabled} onClick={() => onChange(option.id)}>{option.label}</button>)}</div></div>;
}

function useTaskPoll() {
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  return async function poll(taskId: string, onPending?: () => void): Promise<Blob | null> {
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (!alive.current) return null;
      const response = await fetch(`/api/backend/v1/aigen/image-task/${encodeURIComponent(taskId)}`, { credentials: "same-origin", cache: "no-store" });
      if (response.status === 202) { onPending?.(); continue; }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "生成失败，请重试。");
      }
      return await response.blob();
    }
    throw new Error("生成超时，请重试。");
  };
}

function Result({ url, kind, busy }: { url: string; kind: "image" | "video"; busy: boolean }) {
  return <aside className="preview" id="result" aria-label="预览">
    {busy ? <p className="hint" role="status">{kind === "video" ? "正在生成视频…" : "正在生成图片…"}</p> : null}
    {!busy && url && kind === "image" ? <img src={url} alt="生成结果" /> : null}
    {!busy && url && kind === "video" ? <video src={url} controls playsInline /> : null}
    {!busy && !url ? <p className="hint">{kind === "video" ? "视频会显示在这里。" : "图片会显示在这里。"}</p> : null}
  </aside>;
}

function ImageForm({ mode }: { mode: "image" | "face" | "coat" }) {
  const [files, setFiles] = useState<Array<{ data: string; preview: string } | null>>(mode === "face" ? [null, null] : [null]);
  const [prompt, setPrompt] = useState(mode === "face" ? "把第二张图的人脸换到第一张图的人物脸上，保持画面、服装、光线和背景不变，只替换面部，自然真实。" : mode === "coat" ? "把人物身上的衣服脱掉，保留面部、发型、姿势和背景，自然真实。" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const poll = useTaskPoll();
  const leadTitle = mode === "face" ? "只替换面部" : mode === "coat" ? "脱掉衣服" : "用文字描绘你的画面";
  const lead = mode === "face" ? "上传画面图 + 脸部图，保留原画面、服装和光线" : mode === "coat" ? "上传人物图，一键去掉衣服" : "参考图可选，写清主体、场景和风格";
  const needed = mode === "face" ? 2 : mode === "coat" ? 1 : 0;

  async function pick(index: number, file: File | undefined) {
    if (!file) return;
    try {
      const data = await dataUrl(file);
      setFiles(current => current.map((item, position) => position === index ? { data, preview: data } : item));
      setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "图片读不了。"); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (needed > 0 && files.slice(0, needed).some(item => !item)) { setError(mode === "face" ? "先上传画面图和脸部图。" : "先上传一张图片。"); return; }
    if (prompt.trim().length < 5) { setError("先描述想生成的内容。"); return; }
    setBusy(true); setError(""); setResult("");
    try {
      const images = files.filter(Boolean).slice(0, needed || 1).map(item => item!.data);
      const response = await fetch("/api/backend/v1/aigen/image-task", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images, prompt }) });
      const payload = await response.json().catch(() => null) as { taskId?: string; error?: string } | null;
      if (!response.ok || !payload?.taskId) throw new Error(payload?.error || "提交失败，请稍后重试。");
      const blob = await poll(payload.taskId);
      if (blob) setResult(URL.createObjectURL(blob));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "生成失败，请重试。"); }
    finally { setBusy(false); }
  }

  return <>
    <form className="form" onSubmit={event => void submit(event)}>
      <Lead title={leadTitle} line={lead} />
      <div className="stage">
        <div className="upload-row">
          {Array.from({ length: mode === "face" ? 2 : 1 }, (_, index) => <Upload key={index} title={index === 1 ? "上传脸部图" : mode === "coat" ? "上传人物图" : mode === "face" ? "上传画面图" : "上传参考图（选填）"} hint="JPG、PNG、WEBP" preview={files[index]?.preview ?? ""} disabled={busy} onFile={file => void pick(index, file)} />)}
        </div>
        <Guide steps={mode === "face" ? ["上传画面图", "再上传一张脸部图", "开始换脸"] : mode === "coat" ? ["上传一张人物图", "一键去掉衣服", "开始生成"] : ["参考图可选", "输入想生成的画面", "开始生成"]} />
      </div>
      <Prompt value={prompt} onChange={setPrompt} disabled={busy} placeholder={mode === "face" ? "只替换面部，保持原画面" : mode === "coat" ? "脱掉衣服，自然真实" : "例如：月光下的樱花树旁，电影质感"} />
      <Notes items={COMMON_NOTES} />
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <button className="primary wide" type="submit" disabled={busy || prompt.trim().length < 5}>{busy ? "处理中…" : "开始生成"}</button>
    </form>
    <Result url={result} kind="image" busy={busy} />
  </>;
}

function VideoForm() {
  const [file, setFile] = useState<{ data: string; preview: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function pick(selected: File | undefined) {
    if (!selected) return;
    try { const data = await dataUrl(selected); setFile({ data, preview: data }); setError(""); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "图片读不了。"); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!file) { setError("先上传一张图片。"); return; }
    if (prompt.trim().length < 5) { setError("先描述想生成的视频内容。"); return; }
    setBusy(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/backend/v1/aigen/video-task", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: file.data, prompt, seconds: Number(seconds) }) });
      const payload = await response.json().catch(() => null) as { taskId?: string; error?: string } | null;
      if (!response.ok || !payload?.taskId) throw new Error(payload?.error || "提交失败，请稍后重试。");
      for (let i = 0; i < 120; i++) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        if (!alive.current) return;
        const poll = await fetch(`/api/backend/v1/aigen/video-task/${encodeURIComponent(payload.taskId)}`, { credentials: "same-origin", cache: "no-store" });
        if (poll.status === 202) continue;
        if (!poll.ok) { const body = await poll.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error || "视频生成失败。"); }
        const blob = await poll.blob();
        if (!alive.current) return;
        setResult(URL.createObjectURL(blob));
        return;
      }
      throw new Error("生成超时，请重试。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "视频生成失败。"); }
    finally { if (alive.current) setBusy(false); }
  }

  return <>
    <form className="form" onSubmit={event => void submit(event)}>
      <Lead title="上传一张图，让它动起来" line="描述动作和镜头，选择时长" />
      <div className="stage">
        <Upload title="点击上传图片" hint="支持 JPG、PNG" preview={file?.preview ?? ""} disabled={busy} onFile={selected => void pick(selected)} />
        <Guide steps={["上传一张清晰图片", "输入想生成的视频内容", "选择时长，开始生成"]} />
      </div>
      <Prompt value={prompt} onChange={setPrompt} disabled={busy} placeholder="例如：人物微笑着缓缓转身，微风吹动头发，镜头逐渐拉近。" />
      <Choices label="视频时长" value={seconds} options={[{ id: "5", label: "5 秒" }, { id: "10", label: "10 秒" }]} onChange={setSeconds} disabled={busy} />
      <Notes items={["上传图片需清晰，主体明确。", "描述人物动作、场景变化或镜头效果。", ...COMMON_NOTES]} />
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <button className="primary wide" type="submit" disabled={busy || !file || prompt.trim().length < 5}>{busy ? "处理中…" : "开始生成"}</button>
    </form>
    <Result url={result} kind="video" busy={busy} />
  </>;
}

function NovelIntro({ onCreate }: { onCreate: () => void }) {
  return <form className="form" onSubmit={event => { event.preventDefault(); onCreate(); }}>
    <Lead title="让灵感成为故事" line="进入站内小说工作台，写人物、写情节、连续创作" />
    <div className="stage">
      <Guide steps={["写下人物设定", "描述想要的情节", "进入小说工作台生成"]} />
    </div>
    <div className="notes">
      <ul>
        <li>支持人物设定、剧情大纲与章节生成</li>
        <li>小说会保存在「我的作品」里，可继续续写</li>
        <li>只生成虚构的成年角色</li>
      </ul>
    </div>
    <button className="primary wide" type="submit">进入小说工作台</button>
  </form>;
}

function HubCard({ id, feature, onOpen }: { id: View; feature?: boolean; onOpen: (view: View) => void }) {
  const item = MODULES.find(module => module.id === id)!;
  return <button type="button" className={feature ? "tech-feature" : "tech-card"} data-id={id} onClick={() => onOpen(id)}>
    <img className="tech-art" src={MODULE_ART[id]} alt="" loading="lazy" />
    <span className="tech-art-shade" aria-hidden="true" />
    <span className="banner-copy"><strong>{item.label}</strong><small>{item.line}</small></span>
  </button>;
}

export function AigenVercel({ onRoute, onBack }: Props) {
  const [view, setView] = useState<View>("home");
  const title = view === "home" ? "AI生成" : MODULES.find(module => module.id === view)?.label ?? "AI生成";
  const back = () => view === "home" ? onBack() : setView("home");
  return <div className="xmgen">
    <header className={view === "home" ? "top top-home" : "top"}>
      <button type="button" className="brand" onClick={back}>{view === "home" ? "← 返回创作" : "返回"}</button>
      {view === "home" ? <span /> : <h1 className="top-title">{title}</h1>}
      <span />
    </header>
    {view === "home" ? <section className="home" aria-label="创作模块">
      <header className="tech-hero"><p className="tech-kicker">AI科技</p><h1>把想象变成作品</h1><p>影像 · 故事 · 创意</p></header>
      <HubCard id="video" feature onOpen={setView} />
      <div className="tech-grid">{(["image", "face", "coat", "novel"] as const).map(id => <HubCard id={id} key={id} onOpen={setView} />)}</div>
    </section> : <section className="studio">
      {view === "video" ? <VideoForm /> : view === "novel" ? <NovelIntro onCreate={() => onRoute("novels/new/novel")} /> : <ImageForm mode={view} />}
    </section>}
  </div>;
}

export default AigenVercel;
