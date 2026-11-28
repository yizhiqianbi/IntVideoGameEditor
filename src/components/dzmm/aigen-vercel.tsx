"use client";

import { useEffect, useRef, useState } from "react";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { prepareReferenceImage } from "../../lib/xumeng-reference-file";
import {
  consumePendingAigenTemplate,
  fetchCoverAsReferenceFile,
  readTemplateBridgeCharacter,
  type PendingAigenTemplate,
} from "../../lib/xumeng-template-bridge";
import "./aigen-vercel.css";

export type AigenTool = "video" | "image" | "face" | "coat" | "novel";
type Props = {
  locale?: XumengLocale;
  initialTool?: AigenTool;
  userId?: string;
  isGuest?: boolean;
  onRequireAccount?: () => void;
  onRoute: (route: string) => void;
  onBack: () => void;
};

const TOOL_TABS: ReadonlyArray<{ id: Exclude<AigenTool, "novel">; label: string; labelEn: string }> = [
  { id: "video", label: "图生视频", labelEn: "Image to Video" },
  { id: "image", label: "AI生图", labelEn: "AI Image" },
  { id: "face", label: "AI换脸", labelEn: "Face Swap" },
  { id: "coat", label: "脱衣服", labelEn: "Undress" },
];

const COMMON_NOTES = [
  "只生成虚构的成年角色。",
  "生成过程通常需要几十秒，请勿关闭页面。",
  "参考图要清晰，主体明确。",
];

async function packedImage(file: File): Promise<string> {
  const prepared = await prepareReferenceImage(file);
  return prepared.dataUrl;
}

function shownError(failure: unknown, fallback: string): string {
  const message = failure instanceof Error ? failure.message : "";
  if (message.includes("请求过大")) return "图片太大，已经没法再压。请换一张较小的 JPG。";
  return message || fallback;
}

function Lead({ title, line }: { title: string; line: string }) {
  return <p className="lead"><strong>{title}</strong><span>{line}</span></p>;
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

function Prompt({ value, onChange, placeholder, disabled, polishing, onPolish }: { value: string; onChange: (value: string) => void; placeholder: string; disabled: boolean; polishing?: boolean; onPolish?: () => void }) {
  return <div className="prompt-box">
    <div className="field-head"><p className="meta">画面描述 <em>必填</em></p><span className="meta">{value.trim().length} / 800</span>{onPolish ? <button type="button" disabled={disabled || polishing} onClick={onPolish}>{polishing ? "优化中…" : "提示词优化"}</button> : null}</div>
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

function ActiveTemplateStrip({
  template,
  onChangeTemplate,
  onClear,
}: {
  template: PendingAigenTemplate;
  onChangeTemplate: () => void;
  onClear: () => void;
}) {
  return (
    <div className="active-template-bar" role="status">
      {template.demoPosterUrl ? (
        <img className="active-template-thumb" src={template.demoPosterUrl} alt="" />
      ) : null}
      <div className="active-template-info">
        <span>已选模板</span>
        <strong>{template.label}</strong>
      </div>
      <div className="active-template-actions">
        <button type="button" className="active-template-swap" onClick={onChangeTemplate}>更换模板</button>
        <button type="button" className="active-template-clear" aria-label="清除模板" onClick={onClear}>×</button>
      </div>
    </div>
  );
}

function ImageForm({
  mode,
  template,
  onChangeTemplate,
  onClearTemplate,
  userId,
  isGuest,
  onRequireAccount,
}: {
  mode: "image" | "face" | "coat";
  template?: PendingAigenTemplate | null;
  onChangeTemplate?: () => void;
  onClearTemplate?: () => void;
  userId?: string;
  isGuest?: boolean;
  onRequireAccount?: () => void;
}) {
  const [files, setFiles] = useState<Array<{ data: string; preview: string } | null>>(mode === "face" ? [null, null] : [null]);
  const [prompt, setPrompt] = useState(
    mode === "face"
      ? "把第二张图的人脸换到第一张图的人物脸上，保持画面、服装、光线和背景不变，只替换面部，自然真实。"
      : mode === "coat"
        ? "把人物身上的衣服脱掉，保留面部、发型、姿势和背景，自然真实。"
        : template?.prompt ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const poll = useTaskPoll();
  const leadTitle = mode === "face" ? "AI 换脸" : mode === "coat" ? "脱衣服" : "AI 生图";
  const lead = mode === "face" ? "上传画面图与脸部图" : mode === "coat" ? "上传人物图" : "参考图可选";
  const needed = mode === "face" ? 2 : mode === "coat" ? 1 : 0;

  useEffect(() => {
    if (mode !== "image" || !template) return;
    if (template.prompt) setPrompt(template.prompt);
  }, [mode, template?.id, template?.prompt]);

  useEffect(() => {
    if (mode !== "image" || !template) return;
    const bridge = readTemplateBridgeCharacter();
    if (!bridge) return;
    const controller = new AbortController();
    void fetchCoverAsReferenceFile(bridge.coverUrl, bridge.name, controller.signal)
      .then((file) => packedImage(file))
      .then((data) => {
        if (!controller.signal.aborted) {
          setFiles((current) => (current[0] ? current : [{ data, preview: data }]));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [mode, template?.id]);

  async function pick(index: number, file: File | undefined) {
    if (!file) return;
    try {
      const data = await packedImage(file);
      setFiles(current => current.map((item, position) => position === index ? { data, preview: data } : item));
      setError("");
    } catch (failure) { setError(shownError(failure, "图片读不了。")); }
  }

  async function polish() {
    if (busy || polishing) return;
    setPolishing(true);
    setError("");
    try {
      const response = await fetch("/api/aigen/optimize-prompt", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Adult-Confirmed": "1" },
        body: JSON.stringify({ text: prompt, kind: "image" }),
      });
      const payload = await response.json().catch(() => null) as { prompt?: string; error?: string } | null;
      if ((response.status === 401 || response.status === 403) && (isGuest || !userId)) onRequireAccount?.();
      if (!response.ok || typeof payload?.prompt !== "string") throw new Error(payload?.error || "提示词没有优化完。");
      setPrompt(payload.prompt);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "提示词没有优化完。");
    } finally {
      setPolishing(false);
    }
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
    } catch (failure) { setError(shownError(failure, "生成失败，请重试。")); }
    finally { setBusy(false); }
  }

  return <>
    <form className="form" onSubmit={event => void submit(event)}>
      <Lead title={leadTitle} line={lead} />
      {mode === "image" && template && onChangeTemplate && onClearTemplate ? (
        <ActiveTemplateStrip template={template} onChangeTemplate={onChangeTemplate} onClear={onClearTemplate} />
      ) : null}
      <div className="stage">
        <div className="upload-row">
          {Array.from({ length: mode === "face" ? 2 : 1 }, (_, index) => <Upload key={index} title={index === 1 ? "上传脸部图" : mode === "coat" ? "上传人物图" : mode === "face" ? "上传画面图" : "上传参考图（选填）"} hint="JPG、PNG、WEBP" preview={files[index]?.preview ?? ""} disabled={busy} onFile={file => void pick(index, file)} />)}
        </div>
      </div>
      <Prompt value={prompt} onChange={setPrompt} disabled={busy || polishing} polishing={polishing} onPolish={() => void polish()} placeholder={mode === "face" ? "只替换面部，保持原画面" : mode === "coat" ? "脱掉衣服，自然真实" : "例如：月光下的樱花树旁，电影质感"} />
      <Notes items={COMMON_NOTES} />
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <button className="primary wide" type="submit" disabled={busy || polishing || prompt.trim().length < 5}>{busy ? "处理中…" : "开始生成"}</button>
    </form>
    <Result url={result} kind="image" busy={busy} />
  </>;
}

function VideoForm({
  template,
  onChangeTemplate,
  onClearTemplate,
  userId,
  isGuest,
  onRequireAccount,
}: {
  template?: PendingAigenTemplate | null;
  onChangeTemplate?: () => void;
  onClearTemplate?: () => void;
  userId?: string;
  isGuest?: boolean;
  onRequireAccount?: () => void;
}) {
  const [file, setFile] = useState<{ data: string; preview: string } | null>(null);
  const [prompt, setPrompt] = useState(template?.prompt ?? "");
  const [seconds, setSeconds] = useState("5");
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!template) return;
    if (template.prompt) setPrompt(template.prompt);
  }, [template?.id, template?.prompt]);

  useEffect(() => {
    if (!template) return;
    const bridge = readTemplateBridgeCharacter();
    if (!bridge) return;
    const controller = new AbortController();
    void fetchCoverAsReferenceFile(bridge.coverUrl, bridge.name, controller.signal)
      .then((selected) => packedImage(selected))
      .then((data) => {
        if (!controller.signal.aborted) {
          setFile((current) => current ?? { data, preview: data });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [template?.id]);

  async function pick(selected: File | undefined) {
    if (!selected) return;
    try { const data = await packedImage(selected); setFile({ data, preview: data }); setError(""); }
    catch (failure) { setError(shownError(failure, "图片读不了。")); }
  }

  async function polish() {
    if (busy || polishing) return;
    setPolishing(true);
    setError("");
    try {
      const response = await fetch("/api/aigen/optimize-prompt", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Adult-Confirmed": "1" },
        body: JSON.stringify({ text: prompt, kind: "video" }),
      });
      const payload = await response.json().catch(() => null) as { prompt?: string; error?: string } | null;
      if ((response.status === 401 || response.status === 403) && (isGuest || !userId)) onRequireAccount?.();
      if (!response.ok || typeof payload?.prompt !== "string") throw new Error(payload?.error || "提示词没有优化完。");
      setPrompt(payload.prompt);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "提示词没有优化完。");
    } finally {
      setPolishing(false);
    }
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
    } catch (failure) { setError(shownError(failure, "视频生成失败。")); }
    finally { if (alive.current) setBusy(false); }
  }

  return <>
    <form className="form" onSubmit={event => void submit(event)}>
      <Lead title="图生视频" line="上传参考图并填写动作描述" />
      {template && onChangeTemplate && onClearTemplate ? (
        <ActiveTemplateStrip template={template} onChangeTemplate={onChangeTemplate} onClear={onClearTemplate} />
      ) : null}
      <div className="stage">
        <Upload title="点击上传图片" hint="支持 JPG、PNG" preview={file?.preview ?? ""} disabled={busy} onFile={selected => void pick(selected)} />
      </div>
      <Prompt value={prompt} onChange={setPrompt} disabled={busy || polishing} polishing={polishing} onPolish={() => void polish()} placeholder="例如：人物微笑着缓缓转身，微风吹动头发，镜头逐渐拉近。" />
      <Choices label="视频时长" value={seconds} options={[{ id: "5", label: "5 秒" }, { id: "10", label: "10 秒" }]} onChange={setSeconds} disabled={busy || polishing} />
      <Notes items={["上传图片需清晰，主体明确。", "描述人物动作、场景变化或镜头效果。", ...COMMON_NOTES]} />
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <button className="primary wide" type="submit" disabled={busy || polishing || !file || prompt.trim().length < 5}>{busy ? "处理中…" : "开始生成"}</button>
    </form>
    <Result url={result} kind="video" busy={busy} />
  </>;
}

function NovelIntro({ onCreate }: { onCreate: () => void }) {
  return <form className="form" onSubmit={event => { event.preventDefault(); onCreate(); }}>
    <Lead title="AI 小说" line="人物设定、大纲与章节创作" />
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

export function AigenVercel({
  initialTool = "video",
  onRoute,
  onBack,
  userId,
  isGuest,
  onRequireAccount,
  locale = "zh-Hans",
}: Props) {
  const [activeTemplate, setActiveTemplate] = useState<PendingAigenTemplate | null>(() => consumePendingAigenTemplate());
  const [view, setView] = useState<AigenTool>(() => {
    if (activeTemplate) return activeTemplate.kind === "video" ? "video" : "image";
    return initialTool;
  });
  const isEn = locale === "en";

  useEffect(() => {
    const incoming = consumePendingAigenTemplate();
    if (incoming) {
      setActiveTemplate(incoming);
      setView(incoming.kind === "video" ? "video" : "image");
      return;
    }
    setView(initialTool);
  }, [initialTool]);

  const selectTool = (tool: Exclude<AigenTool, "novel">) => {
    setView(tool);
    if (activeTemplate && activeTemplate.kind !== tool) {
      setActiveTemplate(null);
    }
    onRoute(`aigen/${tool}`);
  };

  const back = () => {
    if (activeTemplate) {
      setActiveTemplate(null);
      onRoute("generation");
      return;
    }
    onBack();
  };

  return (
    <div className="xmgen">
      <header className="top top-tools">
        <button type="button" className="brand" onClick={back}>
          {activeTemplate
            ? (isEn ? "← Templates" : "← 模板广场")
            : (isEn ? "← Create" : "← 返回创作")}
        </button>
        <div className="mode-switch tool-tabs" role="tablist" aria-label={isEn ? "AI Tools" : "AI 工具"}>
          {TOOL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              className={view === tab.id ? "mode-active" : undefined}
              onClick={() => selectTool(tab.id)}
            >
              {isEn ? tab.labelEn : tab.label}
            </button>
          ))}
        </div>
        <span />
      </header>
      <section className="studio">
        {view === "video" ? (
          <VideoForm
            template={activeTemplate?.kind === "video" ? activeTemplate : null}
            onChangeTemplate={() => onRoute("generation")}
            onClearTemplate={() => setActiveTemplate(null)}
            userId={userId}
            isGuest={isGuest}
            onRequireAccount={onRequireAccount}
          />
        ) : view === "novel" ? (
          <NovelIntro onCreate={() => onRoute("novels/new/novel")} />
        ) : (
          <ImageForm
            key={view}
            mode={view}
            template={view === "image" && activeTemplate?.kind === "image" ? activeTemplate : null}
            onChangeTemplate={() => onRoute("generation")}
            onClearTemplate={() => setActiveTemplate(null)}
            userId={userId}
            isGuest={isGuest}
            onRequireAccount={onRequireAccount}
          />
        )}
      </section>
    </div>
  );
}

export default AigenVercel;
