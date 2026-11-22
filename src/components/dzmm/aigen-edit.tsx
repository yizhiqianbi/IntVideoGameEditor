"use client";

import { useEffect, useRef, useState } from "react";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage } from "../../lib/xumeng-page-copy";
import Icon from "./icons";
import s from "./aigen-edit.module.css";

type Kind = "face" | "coat";
type Props = { kind: Kind; locale?: XumengLocale; onBack: () => void };

const FACE_PROMPT = "把第二张参考图里的人脸换到第一张参考图的人物脸上，保持第一张图的画面、构图、服装、光线和背景完全不变，只替换面部，自然真实，高清。";
const COAT_PROMPT = "把第一张参考图里人物最外层的衣服去掉一层，保留人物面部、发型、姿势和背景，自然真实，高清。";

async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读不了。"));
    reader.readAsDataURL(file);
  });
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("图片处理失败。");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.9);
}

export function AigenEdit({ kind, locale = "zh-Hans", onBack }: Props) {
  const copy = xumengPage(locale);
  const [scene, setScene] = useState<{ name: string; data: string; preview: string } | null>(null);
  const [face, setFace] = useState<{ name: string; data: string; preview: string } | null>(null);
  const [prompt, setPrompt] = useState(kind === "face" ? FACE_PROMPT : COAT_PROMPT);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function pick(file: File | undefined, useFace: boolean) {
    if (!file || busy) return;
    setError("");
    try {
      const data = await fileToDataUrl(file);
      if (!alive.current) return;
      const entry = { name: file.name, data, preview: data };
      if (useFace) setFace(entry); else setScene(entry);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "图片读不了。"); }
  }

  async function submit() {
    if (busy) return;
    setError("");
    if (!scene) { setError(kind === "face" ? "先上传画面图。" : "先上传一张人物图。"); return; }
    if (kind === "face" && !face) { setError("再上传一张人脸图。"); return; }
    setBusy(true); setProgress("正在提交…"); setResult("");
    try {
      const images = kind === "face" ? [scene.data, face!.data] : [scene.data];
      const response = await fetch("/api/backend/v1/aigen/image-task", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, prompt }),
      });
      const payload = await response.json().catch(() => null) as { taskId?: string; error?: string } | null;
      if (!response.ok || !payload?.taskId) throw new Error(payload?.error || "提交失败，请稍后重试。");
      setProgress("正在生成，通常需要 20–90 秒…");
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (!alive.current) return;
        const poll = await fetch(`/api/backend/v1/aigen/image-task/${encodeURIComponent(payload.taskId)}`, { credentials: "same-origin", cache: "no-store" });
        if (poll.status === 202) continue;
        if (!poll.ok) {
          const body = await poll.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || "生成失败，请重试。");
        }
        const blob = await poll.blob();
        if (!alive.current) return;
        setResult(URL.createObjectURL(blob));
        setProgress("");
        return;
      }
      throw new Error("生成超时，请重试。");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "生成失败，请重试。");
      setProgress("");
    } finally { if (alive.current) setBusy(false); }
  }

  const needsFace = kind === "face";
  return <main className={s.page}>
    <header className={s.header}>
      <button type="button" className={s.back} onClick={onBack} disabled={busy}><Icon name="back" size={16} />{copy.back}</button>
      <div><h1>{needsFace ? "AI 换脸" : "换造型"}</h1><p>{needsFace ? "上传画面图和脸部图，只替换脸，保留原画面" : "上传一张图，按提示词换掉外层造型"}</p></div>
    </header>
    <section className={s.panel}>
      <div className={s.uploads}>
        <label className={s.drop}>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { void pick(event.target.files?.[0], false); event.target.value = ""; }} />
          {scene ? <img src={scene.preview} alt="" /> : <span><Icon name="image" size={22} />{needsFace ? "上传画面图" : "上传人物图"}</span>}
        </label>
        {needsFace && <label className={s.drop}>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { void pick(event.target.files?.[0], true); event.target.value = ""; }} />
          {face ? <img src={face.preview} alt="" /> : <span><Icon name="user" size={22} />上传人脸图</span>}
        </label>}
      </div>
      <label className={s.field}>提示词
        <textarea value={prompt} maxLength={1200} rows={3} disabled={busy} onChange={event => setPrompt(event.target.value)} />
      </label>
      {error && <p className={s.error} role="alert">{error}</p>}
      {progress && <p className={s.progress} role="status">{progress}</p>}
      <button type="button" className={s.primary} disabled={busy || !scene || (needsFace && !face)} onClick={() => void submit()}>
        {busy ? "生成中…" : needsFace ? "开始换脸" : "开始换造型"}
      </button>
      {result && <div className={s.result}>
        <img src={result} alt="生成结果" />
        <div className={s.resultActions}>
          <a href={result} download={`xumeng-${kind}.png`}><Icon name="download" size={15} />保存图片</a>
          <button type="button" onClick={() => { setResult(""); setProgress(""); }}>再生成一张</button>
        </div>
      </div>}
    </section>
    <p className={s.note}>生成会使用站内 AI 图像通道；首次使用请先登录。只生成虚构的成年角色。</p>
  </main>;
}

export default AigenEdit;
