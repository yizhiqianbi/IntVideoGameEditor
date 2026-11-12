import { useEffect, useState } from "react";
import { OUTERWEAR_COPY, fileToDataUrl, submitRemoveOuterwear } from "./remove-outerwear-client.js";
import { NOVEL_COPY, defaultCount, submitNovel } from "./novel-client.js";
import { submitAnimeFace, submitImageVideo, submitTextImage } from "./studio-client.js";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif|avif|tiff?)$/i;

function usePreview(file) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setUrl("");
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function acceptedImage(file) {
  return (typeof file.type === "string" && file.type.startsWith("image/")) || IMAGE_EXT.test(file.name);
}

function readImage(file, setFile, setError) {
  if (!file) return;
  if (!acceptedImage(file)) {
    setError("请上传图片。");
    return;
  }
  setError("");
  setFile(file);
}

function PictureField({ title, hint, url, tall, onFile }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={["drop", url ? "has-file" : "", tall ? "solo" : "", over ? "is-over" : ""].filter(Boolean).join(" ")}
      onDragOver={event => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={event => {
        event.preventDefault();
        setOver(false);
        onFile(event.dataTransfer.files?.[0] ?? null);
      }}
    >
      <input
        className="file"
        type="file"
        accept="image/*,.heic,.heif,.avif"
        onChange={event => onFile(event.target.files?.[0] ?? null)}
      />
      {url ? <img src={url} alt="" /> : (
        <>
          <strong>{title}</strong>
          <span>{hint}</span>
        </>
      )}
    </label>
  );
}

function Chips({ label, value, options, onChange }) {
  return (
    <div>
      <p className="meta">{label}</p>
      <div className="chips" role="radiogroup" aria-label={label}>
        {options.map(option => (
          <button
            type="button"
            key={option.id}
            role="radio"
            aria-checked={value === option.id}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FaceForm() {
  const [face, setFace] = useState(null);
  const [scene, setScene] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const faceUrl = usePreview(face);
  const sceneUrl = usePreview(scene);

  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  async function submit(event) {
    event.preventDefault();
    if (!face || !scene) {
      setError("脸和画面都要上传。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await submitAnimeFace(await fileToDataUrl(face), await fileToDataUrl(scene));
      if (!result.ok) {
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl("");
        setError(result.error);
        return;
      }
      const next = URL.createObjectURL(result.blob);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(next);
    } catch {
      setError("换脸没有完成。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        <div className="pair">
          <PictureField title="脸" hint="成年二次元" url={faceUrl} onFile={file => { setError(""); if (resultUrl) URL.revokeObjectURL(resultUrl); setResultUrl(""); readImage(file, setFace, setError); }} />
          <PictureField title="画面" hint="成年二次元" url={sceneUrl} onFile={file => { setError(""); if (resultUrl) URL.revokeObjectURL(resultUrl); setResultUrl(""); readImage(file, setScene, setError); }} />
        </div>
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy}>{busy ? "核验中…" : "开始换脸"}</button>
      </form>
      <aside className="preview" aria-label="预览">
        {busy ? <p className="hint" role="status">先核验两张图是不是成年二次元，通过后才换脸。</p> : null}
        {!busy && resultUrl ? <img src={resultUrl} alt="换脸结果" /> : null}
        {!busy && !resultUrl ? <p className="hint">换好的画面会显示在这里。</p> : null}
      </aside>
    </>
  );
}

function CoatForm() {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const url = usePreview(file);

  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  async function submit(event) {
    event.preventDefault();
    if (!file) {
      setError(OUTERWEAR_COPY.needImage);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const image = await fileToDataUrl(file);
      const result = await submitRemoveOuterwear(image, { adultConfirmed: true });
      if (!result.ok) {
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl("");
        setError(result.error);
        return;
      }
      const next = URL.createObjectURL(result.image);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(next);
    } catch {
      setError("去外套没有完成。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        <PictureField
          title="上传人物图"
          hint="点击或把图片拖到这里"
          url={url}
          tall
          onFile={next => {
            setError("");
            if (resultUrl) URL.revokeObjectURL(resultUrl);
            setResultUrl("");
            readImage(next, setFile, setError);
          }}
        />
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy}>{busy ? "处理中…" : OUTERWEAR_COPY.button}</button>
      </form>
      <aside className="preview" aria-label="预览">
        {resultUrl ? <img src={resultUrl} alt="移除外套后的结果" /> : <p className="hint">{OUTERWEAR_COPY.hint}</p>}
      </aside>
    </>
  );
}

function VideoForm() {
  const [file, setFile] = useState(null);
  const [action, setAction] = useState("");
  const [seconds, setSeconds] = useState("8");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const url = usePreview(file);

  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  async function submit(event) {
    event.preventDefault();
    if (!file) {
      setError("先上传一张图。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const image = await fileToDataUrl(file);
      const result = await submitImageVideo(image, action, seconds);
      if (!result.ok) {
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl("");
        setError(result.error);
        return;
      }
      const next = URL.createObjectURL(result.blob);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(next);
    } catch {
      setError("视频没有完成。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        <PictureField title="首帧" hint="点击或拖入一张图" url={url} onFile={next => { setError(""); if (resultUrl) URL.revokeObjectURL(resultUrl); setResultUrl(""); readImage(next, setFile, setError); }} />
        <label>
          这一镜的动作
          <textarea value={action} placeholder="例如：转过身，看向镜头。" onChange={event => { setResultUrl(""); setAction(event.target.value); }} />
        </label>
        <Chips
          label="时长"
          value={seconds}
          options={[{ id: "8", label: "8 秒" }, { id: "20", label: "20 秒" }]}
          onChange={id => { setResultUrl(""); setSeconds(id); }}
        />
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy}>{busy ? "生成中…" : "生成视频"}</button>
      </form>
      <aside className="preview" aria-label="预览">
        {busy ? <p className="hint" role="status">正在生成视频…</p> : null}
        {!busy && resultUrl ? <video src={resultUrl} controls /> : null}
        {!busy && !resultUrl ? <p className="hint">视频会显示在这里。</p> : null}
      </aside>
    </>
  );
}

const IMAGE_STYLES = [
  { id: "anime", label: "二次元" },
  { id: "photo", label: "写实" },
  { id: "comic", label: "动漫" },
];
const IMAGE_CLARITY = [
  { id: "sd", label: "标清" },
  { id: "hd", label: "高清" },
  { id: "uhd", label: "超清" },
];

function ImageForm() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("anime");
  const [clarity, setClarity] = useState("hd");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");

  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  async function submit(event) {
    event.preventDefault();
    if (!prompt.trim()) {
      setError("先写下要画的画面。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await submitTextImage(prompt, style, clarity);
      if (!result.ok) {
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        setResultUrl("");
        setError(result.error);
        return;
      }
      const next = URL.createObjectURL(result.blob);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(next);
    } catch {
      setError("图片没有完成。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        <label>
          画面
          <textarea value={prompt} placeholder="人物、服装、场景、光线。" onChange={event => { setResultUrl(""); setPrompt(event.target.value); }} />
        </label>
        <Chips label="风格" value={style} options={IMAGE_STYLES} onChange={id => { setResultUrl(""); setStyle(id); }} />
        <Chips label="清晰度" value={clarity} options={IMAGE_CLARITY} onChange={id => { setResultUrl(""); setClarity(id); }} />
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy}>{busy ? "生成中…" : "生成图片"}</button>
      </form>
      <aside className="preview" aria-label="预览">
        {busy ? <p className="hint" role="status">正在生成图片…</p> : null}
        {!busy && resultUrl ? <img src={resultUrl} alt="生成的图片" /> : null}
        {!busy && !resultUrl ? <p className="hint">图片会显示在这里。</p> : null}
      </aside>
    </>
  );
}

function NovelForm() {
  const [mode, setMode] = useState("new");
  const [text, setText] = useState("");
  const [character, setCharacter] = useState("");
  const [scene, setScene] = useState("");
  const [details, setDetails] = useState("");
  const [count, setCount] = useState(defaultCount("new"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  function changeMode(next) {
    setMode(next);
    setError("");
    setResult("");
    setCount(defaultCount(next));
  }

  async function submit(event) {
    event.preventDefault();
    if (mode === "new" && !text.trim()) {
      setError(NOVEL_COPY.needPlot);
      return;
    }
    if (mode === "continue" && !text.trim()) {
      setError(NOVEL_COPY.needSource);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const outcome = await submitNovel({
        mode,
        description: mode === "new" ? text : "",
        source: mode === "continue" ? text : "",
        character_setting: character,
        location_scene: scene,
        details,
        count,
      }, { adultConfirmed: true });
      if (!outcome.ok) {
        setResult("");
        setError(outcome.error);
        return;
      }
      setResult(outcome.text || "");
    } catch {
      setResult("");
      setError("小说没有完成。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form" onSubmit={submit}>
        <Chips
          label="写法"
          value={mode}
          options={[{ id: "new", label: "新写" }, { id: "continue", label: "续写" }]}
          onChange={changeMode}
        />
        <label>
          {mode === "new" ? NOVEL_COPY.plot : NOVEL_COPY.source}
          <textarea
            value={text}
            placeholder={mode === "new" ? NOVEL_COPY.plotHint : NOVEL_COPY.sourceHint}
            onChange={event => { setResult(""); setText(event.target.value); }}
          />
        </label>
        <label>
          {NOVEL_COPY.character}
          <input value={character} placeholder={NOVEL_COPY.optional} onChange={event => { setResult(""); setCharacter(event.target.value); }} />
        </label>
        <label>
          {NOVEL_COPY.scene}
          <input value={scene} placeholder={NOVEL_COPY.optional} onChange={event => { setResult(""); setScene(event.target.value); }} />
        </label>
        <label>
          {NOVEL_COPY.details}
          <textarea
            value={details}
            placeholder={NOVEL_COPY.optional}
            onChange={event => { setResult(""); setDetails(event.target.value); }}
          />
        </label>
        <label>
          {mode === "new" ? NOVEL_COPY.count : NOVEL_COPY.continueCount}
          <input
            type="number"
            inputMode="numeric"
            min={mode === "continue" ? 500 : 1}
            max={mode === "continue" ? 2000 : 20000}
            value={count}
            onChange={event => { setResult(""); setCount(event.target.value); }}
          />
        </label>
        <p className="hint">{mode === "new" ? NOVEL_COPY.countHint : NOVEL_COPY.continueCountHint}</p>
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy}>{busy ? NOVEL_COPY.waiting : (mode === "new" ? NOVEL_COPY.write : NOVEL_COPY.continue)}</button>
      </form>
      <aside className="preview preview-text" aria-label="预览">
        {busy ? <p className="hint" role="status">{NOVEL_COPY.waiting}</p> : null}
        {!busy && result ? <pre>{result}</pre> : null}
        {!busy && !result ? <p className="hint">正文会显示在这里。</p> : null}
      </aside>
    </>
  );
}

const DETAIL = {
  face: "脸和画面都要是成年二次元。",
  coat: OUTERWEAR_COPY.detail,
  video: "上传一张图，再写一句这一镜的动作。",
  image: "只写画面。不上传图片。",
  novel: NOVEL_COPY.detail,
};

export default function Studio({ item }) {
  return (
    <section className={item.id === "coat" ? "studio single" : "studio"} aria-labelledby="module-title">
      <div className="intro">
        <h1 id="module-title">{item.label}</h1>
        <p>{DETAIL[item.id]}</p>
      </div>
      {item.id === "face" ? <FaceForm /> : null}
      {item.id === "coat" ? <CoatForm /> : null}
      {item.id === "video" ? <VideoForm /> : null}
      {item.id === "image" ? <ImageForm /> : null}
      {item.id === "novel" ? <NovelForm /> : null}
    </section>
  );
}
