"use client";

import { useRef, useState } from "react";
import Icon from "./icons";
import s from "./studio-lab.module.css";

export type StudioLabTool = "face" | "coat" | "prompt";

const TOOLS: Record<StudioLabTool, { title: string; lead: string; accept?: string; prompt?: string }> = {
  face: { title: "换脸", lead: "上传一张人物照片，把脸重新绘制成插画风，身体和背景保持不变。", accept: "image/*", prompt: "可选。例如：更精致的二次元插画脸，气质清冷。" },
  coat: { title: "去衣", lead: "上传一张人物照片，去掉最外层衣物，脸、姿势和背景保持不变。", accept: "image/*", prompt: "可选。例如：只去掉外套，保留里面的吊带。" },
  prompt: { title: "提示词优化", lead: "把一句想法扩写成模型能按句执行的提示词。" },
};

const KINDS: { id: "image" | "video" | "story" | "character"; label: string }[] = [
  { id: "image", label: "生图" },
  { id: "video", label: "视频" },
  { id: "story", label: "故事" },
  { id: "character", label: "人物" },
];

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("这张图片读不了。"));
    reader.onerror = () => reject(new Error("这张图片读不了。"));
    reader.readAsDataURL(file);
  });
}

export default function StudioLab({ tool, guest, onBack, onRequireAccount }: {
  tool: StudioLabTool;
  guest: boolean;
  onBack: () => void;
  onRequireAccount: () => void;
}) {
  const copy = TOOLS[tool];
  const [image, setImage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"image" | "video" | "story" | "character">("image");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [text, setText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(""); setResult("");
    if (!file.type.startsWith("image/")) { setError("请上传图片。"); return; }
    if (file.size > 8 * 1024 * 1024) { setError("图片请小于 8 MB。"); return; }
    try { setImage(await readFile(file)); } catch (failure) { setError(failure instanceof Error ? failure.message : "这张图片读不了。"); }
  }

  async function runEdit() {
    if (guest) { onRequireAccount(); return; }
    if (!image) { setError("先上传一张图片。"); return; }
    if (!adult) { setError("请先确认你已满 18 岁。"); return; }
    setBusy(true); setError(""); setResult("");
    try {
      const response = await fetch(`/api/lab/${tool}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-adult-confirmed": "1" },
        body: JSON.stringify({ image, prompt }),
      });
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof payload?.error === "string" ? payload.error : "没有完成，请再试一次。");
      }
      setResult(URL.createObjectURL(await response.blob()));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "没有完成，请再试一次。");
    } finally { setBusy(false); }
  }

  async function runPrompt() {
    if (guest) { onRequireAccount(); return; }
    if (text.trim().length < 2) { setError("先写一句想表达的内容。"); return; }
    setBusy(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/lab/optimize-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, kind }) });
      const payload = await response.json().catch(() => null) as { prompt?: unknown; error?: unknown } | null;
      if (!response.ok || typeof payload?.prompt !== "string") throw new Error(typeof payload?.error === "string" ? payload.error : "提示词没有优化完。");
      setResult(payload.prompt);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "提示词没有优化完。");
    } finally { setBusy(false); }
  }

  return <main className={s.page}>
    <header className={s.head}>
      <div><p>创作工具</p><h1>{copy.title}</h1><span>{copy.lead}</span></div>
      <button type="button" className={s.back} onClick={onBack}><Icon name="back" size={16} />返回创作</button>
    </header>

    {tool === "prompt" ? <section className={s.panel}>
      <label className={s.field}>想表达的内容<textarea rows={5} maxLength={800} value={text} disabled={busy} placeholder="例如：雨夜的便利店门口，她抬头看你。" onChange={event => setText(event.target.value)} /></label>
      <div className={s.kinds} role="radiogroup" aria-label="优化类型">{KINDS.map(item => <button key={item.id} type="button" role="radio" aria-checked={kind === item.id} className={kind === item.id ? s.kindOn : ""} onClick={() => setKind(item.id)}>{item.label}</button>)}</div>
      {error && <p className={s.error} role="alert">{error}</p>}
      <button type="button" className={s.primary} disabled={busy} onClick={() => void runPrompt()}>{busy ? "正在优化…" : guest ? "登录后使用" : "优化提示词"}</button>
      {result && <div className={s.result}><textarea readOnly rows={8} value={result} aria-label="优化结果" /><div className={s.resultActions}><button type="button" className={s.secondary} onClick={() => void navigator.clipboard?.writeText(result).catch(() => {})}>复制</button></div></div>}
    </section> : <section className={s.panel}>
      <button type="button" className={`${s.drop} ${image ? s.dropFilled : ""}`} onClick={() => fileInput.current?.click()}>
        {image ? <img src={image} alt="待处理的图片" /> : <><Icon name="image" size={22} /><span>点这里上传图片</span><small>JPG / PNG / WebP，小于 8 MB</small></>}
      </button>
      <input ref={fileInput} type="file" accept={copy.accept} hidden onChange={event => void pick(event.target.files?.[0])} />
      <label className={s.field}>补充要求（选填）<textarea rows={3} maxLength={600} value={prompt} disabled={busy} placeholder={copy.prompt} onChange={event => setPrompt(event.target.value)} /></label>
      <label className={s.adult}><input type="checkbox" checked={adult} disabled={busy} onChange={event => setAdult(event.target.checked)} />我确认已满 18 岁，并上传的是虚构成年人的图片。</label>
      {error && <p className={s.error} role="alert">{error}</p>}
      <button type="button" className={s.primary} disabled={busy || !image} onClick={() => void runEdit()}>{busy ? "正在处理…" : guest ? "登录后使用" : `开始${copy.title}`}</button>
      {result && <div className={s.result}><img src={result} alt={`${copy.title}结果`} /><div className={s.resultActions}><a className={s.secondary} href={result} download={`xumeng-${tool}.png`}>下载</a></div></div>}
    </section>}
  </main>;
}
