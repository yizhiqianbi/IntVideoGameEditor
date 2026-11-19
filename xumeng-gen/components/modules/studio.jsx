"use client";

import { useEffect, useState } from "react";
import { OUTERWEAR_COPY, fileToDataUrl, submitRemoveOuterwear } from "./remove-outerwear-client.js";
import { NOVEL_COPY, defaultCount, submitNovel } from "./novel-client.js";
import { DEFAULT_PROMPTS } from "./prompt-defaults.js";
import { optimizePrompt, optimizeVideoPrompt, submitAnimeFace, submitFaceVideo, submitImageVideo, submitTextImage, uploadFaceVideo } from "./studio-client.js";
import {
  FACE_VIDEO_HINT,
  FACE_VIDEO_PROMPT,
  FACE_VIDEO_WAITING,
  isVideoFile,
  videoFileProblem,
  videoSecondsProblem,
} from "../../lib/face-video.mjs";

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

function PictureField({ title, hint, mark, url, tall, onFile, accept = "image/*,.heic,.heif,.avif", video = false }) {
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
        accept={accept}
        onChange={event => onFile(event.target.files?.[0] ?? null)}
      />
      {url ? (video ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt="" />) : (
        <>
          <span className="plus" aria-hidden="true">+</span>
          <strong>{title}</strong>
          <span>{hint}</span>
        </>
      )}
      {url && mark ? <em className="ref-mark">{mark}</em> : null}
    </label>
  );
}

// 参考图卡位：内部持有预览 URL，方便同时放两张可选参考图。
function ReferenceSlot({ title, hint, file, onFile }) {
  const url = usePreview(file);
  return <PictureField title={title} hint={hint} url={url} onFile={onFile} />;
}

// 从本地视频里读时长，用来挡住过长的素材。
function videoSeconds(file) {
  const url = URL.createObjectURL(file);
  return new Promise(resolve => {
    const element = document.createElement("video");
    element.preload = "metadata";
    element.onloadedmetadata = () => resolve(Number.isFinite(element.duration) ? element.duration : 0);
    element.onerror = () => resolve(0);
    element.src = url;
  }).finally(() => URL.revokeObjectURL(url));
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

function Lead({ title, line }) {
  return (
    <p className="lead">
      <strong>{title}</strong>
      <span>{line}</span>
    </p>
  );
}

function Guide({ steps }) {
  return (
    <aside className="guide">
      <p className="guide-kicker">新手教程</p>
      <p className="guide-title">三步轻创作</p>
      <ol>
        {steps.map(step => <li key={step}>{step}</li>)}
      </ol>
    </aside>
  );
}

function Notes({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="notes">
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>注意事项</button>
      {open ? <ul>{items.map(item => <li key={item}>{item}</li>)}</ul> : null}
    </div>
  );
}

function ExampleBar({ text, onUse }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="example-bar" onClick={() => setOpen(true)}>生成效果示例</button>
      {open ? (
        <div className="sheet" role="dialog" aria-label="生成效果示例">
          <p>{text}</p>
          {onUse ? <button type="button" className="primary" onClick={() => { onUse(text); setOpen(false); }}>使用这段描述</button> : null}
          <button type="button" className="ghost" onClick={() => setOpen(false)}>关闭</button>
        </div>
      ) : null}
    </>
  );
}

function RatioCards({ value, onChange }) {
  const options = [
    { id: "square", label: "正方形" },
    { id: "landscape", label: "横版" },
    { id: "portrait", label: "竖版" },
  ];
  return (
    <div>
      <p className="meta">图片比例</p>
      <div className="choices" role="radiogroup" aria-label="图片比例">
        {options.map(option => (
          <button type="button" key={option.id} role="radio" aria-checked={value === option.id} onClick={() => onChange(option.id)}>{option.label}</button>
        ))}
      </div>
    </div>
  );
}

function DurationCards({ value, onChange }) {
  return (
    <div>
      <p className="meta">视频时长</p>
      <div className="choices" role="radiogroup" aria-label="视频时长">
        {["5", "10", "15"].map(item => (
          <button type="button" key={item} role="radio" aria-checked={value === item} onClick={() => onChange(item)}>{item} 秒</button>
        ))}
      </div>
    </div>
  );
}

function PromptBox({ label, value, onChange, max, min, ideas, placeholder, polish }) {
  const [polishing, setPolishing] = useState(false);
  const count = value.trim().length;
  async function runPolish() {
    if (!polish || polishing) return;
    setPolishing(true);
    try { await polish(value); } finally { setPolishing(false); }
  }
  return (
    <div className="prompt-box">
      <div className="field-head">
        <p className="meta">{label} <em>必填</em></p>
        <button type="button" disabled={polishing} onClick={polish ? runPolish : () => onChange(ideas[Math.floor(Math.random() * ideas.length)])}>{polishing ? "优化中…" : "提示词优化"}</button>
        {value ? <button type="button" onClick={() => onChange("")}>清空</button> : null}
      </div>
      <textarea maxLength={max} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
      <span className="count">{count}/{max}</span>
      {count > 0 && count < min ? <p className="warn">请至少输入 {min} 个字符</p> : null}
    </div>
  );
}

const COMMON_NOTES = [
  "描述越具体，结果越接近预期。",
  "生成结果会有差异，以实际画面为准。",
  "请使用你有权使用的图片和文字。",
];

function FaceForm() {
  const [face, setFace] = useState(null);
  const [scene, setScene] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resultVideo, setResultVideo] = useState(false);
  const faceUrl = usePreview(face);
  const sceneUrl = usePreview(scene);
  const sceneIsVideo = scene ? isVideoFile(scene.name, scene.type) : false;

  useEffect(() => () => {
    if (resultUrl.startsWith("blob:")) URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

  function clearResult() {
    if (resultUrl.startsWith("blob:")) URL.revokeObjectURL(resultUrl);
    setResultUrl("");
    setResultVideo(false);
  }

  function takeScene(file) {
    if (!file) return;
    setError("");
    clearResult();
    if (isVideoFile(file.name, file.type)) {
      const problem = videoFileProblem(file.name, file.type, file.size);
      if (problem) {
        setError(problem);
        return;
      }
      setScene(file);
      return;
    }
    readImage(file, setScene, setError);
  }

  function takeFace(file) {
    if (!file) return;
    setError("");
    clearResult();
    readImage(file, setFace, setError);
  }

  async function submit(event) {
    event.preventDefault();
    if (!face || !scene) {
      setError("脸和画面都要上传。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (sceneIsVideo) {
        const seconds = await videoSeconds(scene);
        const problem = videoSecondsProblem(seconds);
        if (problem) {
          setError(problem);
          return;
        }
        const uploaded = await uploadFaceVideo(scene);
        if (!uploaded.ok) {
          clearResult();
          setError(uploaded.error || "视频没有传上去。");
          return;
        }
        const result = await submitFaceVideo(await fileToDataUrl(face), uploaded.url, FACE_VIDEO_PROMPT, seconds);
        if (!result.ok) {
          clearResult();
          setError(result.error);
          return;
        }
        clearResult();
        setResultVideo(true);
        setResultUrl(result.url);
        return;
      }
      const result = await submitAnimeFace(await fileToDataUrl(face), await fileToDataUrl(scene), DEFAULT_PROMPTS.face);
      if (!result.ok) {
        clearResult();
        setError(result.error);
        return;
      }
      const next = URL.createObjectURL(result.blob);
      clearResult();
      setResultVideo(false);
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
        <Lead title="AI 换脸" line="一键替换人脸，图片和视频都行" />
        <div className="pair">
          <PictureField
            title="选择素材"
            hint="原始画面，图片或视频"
            accept="image/*,.heic,.heif,.avif,video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v"
            mark={sceneIsVideo ? "视频" : ""}
            video={sceneIsVideo}
            url={sceneUrl}
            onFile={takeScene}
          />
          <PictureField title="选择素材" hint="目标人脸，JPG、PNG" url={faceUrl} onFile={takeFace} />
        </div>
        <Guide steps={["上传原始画面，可以是图片或视频", "上传目标人脸", "开始生成"]} />
        <ExampleBar text="把参考脸换进原来的画面或视频，保留姿势、服装和背景。" />
        <Notes items={["原始画面可以用清晰图片，也可以用 MP4、MOV 视频。", FACE_VIDEO_HINT, "视频换脸保留原视频画面，只替换人脸；完成后自动超清放大。", "请使用清晰、无遮挡的单人图片。", "多人脸可能无法识别。", ...COMMON_NOTES]} />
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy || !face || !scene}>{busy ? (sceneIsVideo ? "正在换脸…" : "处理中…") : "开始生成"}</button>
      </form>
      <aside className="preview" id="result" aria-label="预览" hidden={!busy && !resultUrl}>
        {busy ? <p className="hint" role="status">{sceneIsVideo ? FACE_VIDEO_WAITING : "处理中…"}</p> : null}
        {!busy && resultUrl ? (resultVideo ? <video src={resultUrl} controls playsInline /> : <img src={resultUrl} alt="换脸结果" />) : null}
      </aside>
    </>
  );
}

function CoatForm() {
  const [file, setFile] = useState(null);
  const [references, setReferences] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [referencePreviews, setReferencePreviews] = useState([]);
  const url = usePreview(file);

  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);
  useEffect(() => {
    const urls = references.map(item => URL.createObjectURL(item));
    setReferencePreviews(urls);
    return () => urls.forEach(item => URL.revokeObjectURL(item));
  }, [references]);

  function takeReferences(list) {
    const incoming = list instanceof File ? [list] : [...(list || [])].filter(item => item instanceof File);
    if (!incoming.length) return;
    setError("");
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl("");
    setReferences(current => [...current, ...incoming].slice(0, 2));
  }

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
      const extras = [];
      for (const item of references) extras.push(await fileToDataUrl(item));
      const result = await submitRemoveOuterwear(image, { adultConfirmed: true, prompt: DEFAULT_PROMPTS.coat, references: extras });
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
        <Lead title="上传一张人物图" line="按原图尺寸直接开始生成" />
        <div className="stage">
        <PictureField
          title="点击上传图片"
          hint="人物图，JPG、PNG"
          url={url}
          onFile={next => {
            setError("");
            if (resultUrl) URL.revokeObjectURL(resultUrl);
            setResultUrl("");
            readImage(next, setFile, setError);
          }}
        />
        <Guide steps={["上传人物图片", "开始生成"]} />
        </div>
        <Notes items={COMMON_NOTES} />
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy || !file}>{busy ? "处理中…" : "开始生成"}</button>
      </form>
      <aside className="preview" id="result" aria-label="预览">
        {resultUrl ? <img src={resultUrl} alt="移除外套后的结果" /> : <p className="hint">{OUTERWEAR_COPY.hint}</p>}
      </aside>
    </>
  );
}

function VideoForm() {
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState("first");
  const [action, setAction] = useState("");
  const [seconds, setSeconds] = useState("5");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [previews, setPreviews] = useState([]);

  useEffect(() => () => { if (resultUrl.startsWith("blob:")) URL.revokeObjectURL(resultUrl); }, [resultUrl]);
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);

  function clearResult() {
    if (resultUrl.startsWith("blob:")) URL.revokeObjectURL(resultUrl);
    setResultUrl("");
  }

  function takeFiles(list) {
    const incoming = list instanceof File ? [list] : [...(list || [])].filter(item => item instanceof File);
    if (!incoming.length) return;
    setError("");
    clearResult();
    setFiles(current => (mode === "first" ? incoming.slice(0, 1) : [...current, ...incoming]).slice(0, 10));
  }

  function chooseMode(next) {
    setMode(next);
    if (next === "first") setFiles(current => current.slice(0, 1));
  }

  async function submit(event) {
    event.preventDefault();
    if (!files.length) {
      setError(mode === "reference" ? "先上传至少一张参考图。" : "先上传一张图。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const images = [];
      for (const file of files) images.push(await fileToDataUrl(file));
      const result = await submitImageVideo(images, action, seconds, mode);
      if (!result.ok) {
        clearResult();
        setError(result.error);
        return;
      }
      const next = typeof result.url === "string" ? result.url : URL.createObjectURL(result.blob);
      clearResult();
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
        <Lead title="把图片变成一段视频" line="上传一张清晰图片，再描述想看到的动作。" />
        <div className="stage">
          <PictureField title="点击上传图片" hint="支持 JPG、PNG" url={previews[0] || ""} onFile={file => takeFiles(file)} />
          <Guide steps={["上传一张清晰图片", "输入想生成的视频内容", "选择时长，开始生成"]} />
        </div>
        <ExampleBar text="人物微笑着缓缓转身，微风吹动头发，镜头逐渐拉近。" onUse={value => { setResultUrl(""); setAction(value); }} />
        <Notes items={["上传图片需清晰，主体明确。", "描述人物动作、场景变化或镜头效果。", ...COMMON_NOTES]} />
        <PromptBox
          label="视频内容描述"
          value={action}
          max={800}
          min={5}
          placeholder="例如：人物微笑着缓缓转身，微风吹动头发，镜头逐渐拉近。"
          onChange={value => { setResultUrl(""); setAction(value); }}
          polish={async text => {
            setError("");
            const result = await optimizeVideoPrompt(text);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (resultUrl) URL.revokeObjectURL(resultUrl);
            setResultUrl("");
            setAction(result.prompt);
          }}
        />
        <DurationCards value={seconds} onChange={value => { setResultUrl(""); setSeconds(value); }} />
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy || !files.length || action.trim().length < 5}>{busy ? "处理中…" : "开始生成"}</button>
      </form>
      <aside className="preview" id="result" aria-label="预览">
        {busy ? <p className="hint" role="status">正在生成视频…</p> : null}
        {!busy && resultUrl ? <video src={resultUrl} controls /> : null}
        {!busy && !resultUrl ? <p className="hint">视频会显示在这里。</p> : null}
      </aside>
    </>
  );
}

const IMAGE_STYLES = [
  { id: "anime", label: "动漫" },
  { id: "photo", label: "写实" },
  { id: "paint", label: "厚涂" },
  { id: "water", label: "水彩" },
  { id: "guofeng", label: "国风" },
  { id: "render", label: "3D" },
];
const IMAGE_CLARITY = [
  { id: "sd", label: "标清" },
  { id: "hd", label: "高清" },
  { id: "uhd", label: "超清" },
];

function ImageForm() {
  const [files, setFiles] = useState([null, null]);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("portrait");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState("");

  useEffect(() => () => { if (resultUrl.startsWith("blob:")) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  function clearResult() {
    if (resultUrl.startsWith("blob:")) URL.revokeObjectURL(resultUrl);
    setResultUrl("");
  }

  function takeFile(index, file) {
    if (!file) return;
    if (!acceptedImage(file)) {
      setError("请上传图片。");
      return;
    }
    setError("");
    clearResult();
    setFiles(current => current.map((item, position) => (position === index ? file : item)));
  }

  async function submit(event) {
    event.preventDefault();
    if (!prompt.trim()) {
      setError("先写下要画的画面。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const images = [];
      for (const file of files) {
        if (file) images.push(await fileToDataUrl(file));
      }
      const result = await submitTextImage({ prompt, ratio, images });
      if (!result.ok) {
        clearResult();
        setError(result.error);
        return;
      }
      const next = URL.createObjectURL(result.blob);
      clearResult();
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
        <Lead title="用文字描绘你的画面" line="描述主体、场景或风格，可选一张参考图" />
        <div className="stage">
          <ReferenceSlot title="参考图" hint="选填，JPG、PNG" file={files[0]} onFile={file => takeFile(0, file)} />
          <Guide steps={["参考图可选，最多一张", "输入想生成的画面", "选择比例，开始生成"]} />
        </div>
        <PromptBox
          label="画面描述"
          value={prompt}
          max={800}
          min={5}
          placeholder="例如：让参考图里的人物站在月光下的樱花树旁"
          onChange={value => { clearResult(); setPrompt(value); }}
          polish={async value => {
            setError("");
            const outcome = await optimizePrompt(value, "image");
            if (!outcome.ok) {
              setError(outcome.error);
              return;
            }
            clearResult();
            setPrompt(outcome.prompt);
          }}
        />
        <ExampleBar text="将人物置于温暖的夕阳海边，画面自然，具有电影质感。" onUse={value => { clearResult(); setPrompt(value); }} />
        <Notes items={["可以带两张参考图，比如一张人物、一张场景或服装。", "在描述里写清哪张参考图负责什么，生成会更贴近预期。", ...COMMON_NOTES]} />
        <RatioCards value={ratio} onChange={value => { clearResult(); setRatio(value); }} />
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy || prompt.trim().length < 5}>{busy ? "处理中…" : "开始生成"}</button>
      </form>
      <aside className="preview" id="result" aria-label="预览">
        {busy ? <p className="hint" role="status">正在生成图片…</p> : null}
        {!busy && resultUrl ? <img src={resultUrl} alt="生成的图片" /> : null}
        {!busy && !resultUrl ? <p className="hint">图片会显示在这里。</p> : null}
      </aside>
    </>
  );
}

const NOVEL_GENRES = ["都市", "玄幻", "古风", "悬疑", "校园", "科幻"];

function NovelForm() {
  const [character, setCharacter] = useState("");
  const [text, setText] = useState("");
  const [genre, setGenre] = useState("");
  const [count, setCount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const words = Number(count);
  const countOk = Number.isInteger(words) && words >= 1 && words <= 6000;

  async function submit(event) {
    event.preventDefault();
    if (character.trim().length < 2) {
      setError(character.trim() ? "请至少输入 2 个字符。" : "先写下人物设定。");
      return;
    }
    if (text.trim().length < 10) {
      setError(text.trim() ? "请至少输入 10 个字符。" : NOVEL_COPY.needPlot);
      return;
    }
    if (!countOk) {
      setError("请输入 1 到 6000 之间的整数。");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const outcome = await submitNovel({
        mode: "new",
        description: genre ? `题材：${genre}。${text.trim()}` : text.trim(),
        character_setting: character.trim(),
        count: String(words),
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
        <Lead title="让你的灵感成为故事" line="写清人物和情节，AI 为你创作专属小说" />
        <PromptBox
          label="人物设定"
          value={character}
          max={800}
          min={2}
          placeholder="例如：林晚，二十八岁，书店店主，话少。"
          onChange={value => { setResult(""); setCharacter(value); }}
          polish={async value => {
            setError("");
            const outcome = await optimizePrompt(value, "character");
            if (!outcome.ok) {
              setError(outcome.error);
              return;
            }
            setResult("");
            setCharacter(outcome.prompt);
          }}
        />
        <PromptBox
          label="故事描述"
          value={text}
          max={800}
          min={10}
          placeholder="例如：一个三十岁的旅人在雨夜走进旧书店。"
          onChange={value => { setResult(""); setText(value); }}
          polish={async value => {
            setError("");
            const outcome = await optimizePrompt(value, "story");
            if (!outcome.ok) {
              setError(outcome.error);
              return;
            }
            setResult("");
            setText(outcome.prompt);
          }}
        />
        <Notes items={["请尽量写清人物、背景和主要情节。", "篇幅和情节会有差异，以生成结果为准。", "请勿生成违法或侵犯他人权益的内容。"]} />
        <div>
          <p className="meta">故事题材 选填</p>
          <div className="chips" role="radiogroup" aria-label="故事题材">
            {NOVEL_GENRES.map(item => (
              <button type="button" key={item} role="radio" aria-checked={genre === item} onClick={() => setGenre(current => current === item ? "" : item)}>{item}</button>
            ))}
          </div>
        </div>
        <label>
          小说字数 必填
          <input type="number" inputMode="numeric" min="1" max="6000" value={count} placeholder="请输入 1 到 6000" onChange={event => { setResult(""); setCount(event.target.value); }} />
        </label>
        {error ? <p className="alert" role="alert">{error}</p> : null}
        <button className="primary wide" type="submit" disabled={busy || character.trim().length < 2 || text.trim().length < 10 || !countOk}>{busy ? "处理中…" : "开始生成"}</button>
      </form>
      <aside className="preview preview-text" id="result" aria-label="预览">
        {busy ? <p className="hint" role="status">{NOVEL_COPY.waiting}</p> : null}
        {!busy && result ? <pre>{result}</pre> : null}
        {!busy && !result ? <p className="hint">正文会显示在这里。</p> : null}
      </aside>
    </>
  );
}

export default function Studio({ item }) {
  return (
    <section className="studio" aria-labelledby="module-title">
      {item.id === "face" ? <FaceForm /> : null}
      {item.id === "coat" ? <CoatForm /> : null}
      {item.id === "video" ? <VideoForm /> : null}
      {item.id === "image" ? <ImageForm /> : null}
      {item.id === "novel" ? <NovelForm /> : null}
    </section>
  );
}
