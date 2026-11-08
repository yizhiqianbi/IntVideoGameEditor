"use client";
import { useState } from "react";
import { uploadReferenceMedia, validateReferenceMedia, type ReferenceMedia } from "@/lib/drama-reference-media";
import { tokenForSource } from "@/lib/drama-mentions";
import { needsTranscode, transcodeVideo, MAX_INPUT_BYTES } from "@/lib/video-transcode";
import styles from "./studio.module.css";

const VIDEO_EXTS = /\.(mp4|mov|avi|mkv|webm|flv|wmv|ts|m4v|3gp|hevc|mts|m2ts)$/i;
const AUDIO_EXTS = /\.(wav|mp3|aac|m4a|ogg|flac)$/i;
const ACCEPT_ATTRS =
  "video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,video/x-flv,video/x-ms-wmv,video/mp2t,video/3gpp,audio/mpeg,audio/wav,audio/aac,audio/mp4,audio/ogg,audio/flac,.mp4,.mov,.avi,.mkv,.webm,.flv,.wmv,.ts,.m4v,.3gp,.mts,.m2ts,.wav,.mp3,.aac,.m4a,.ogg,.flac";

export function ReferenceMediaEditor({items, bindings, disabled, onChange, onBusy, onError}: {
  items:ReferenceMedia[];
  bindings?: Record<string, string>;
  disabled:boolean;
  onChange:(items:ReferenceMedia[])=>void;
  onBusy:(busy:boolean)=>void;
  onError:(message:string)=>void;
}) {
  const [progress, setProgress] = useState<string>("");

  async function upload(files: File[]) {
    if (disabled || progress) return;
    onBusy(true);
    let next = [...items];
    try {
      for (const file of files) {
        const isVideo = VIDEO_EXTS.test(file.name) || file.type.startsWith("video/");
        const isAudio = AUDIO_EXTS.test(file.name) || file.type.startsWith("audio/");
        const kind: "video" | "audio" | null = isVideo ? "video" : isAudio ? "audio" : null;
        if (!kind) throw new Error("不支持的格式，请选择视频或音频文件");
        if (next.filter(m => m.kind === kind).length >= 3) throw new Error("每类参考最多 3 段");

        let uploadFile = file;
        let uploadName = file.name;

        if (kind === "video") {
          if (file.size > MAX_INPUT_BYTES)
            throw new Error(`视频文件过大（${(file.size / 1024 / 1024).toFixed(0)} MB），上限 500 MB`);

          if (needsTranscode(file)) {
            const result = await transcodeVideo(file, msg => setProgress(`🔄 转码 ${file.name}：${msg}`));
            uploadFile = result.file;
            uploadName = result.file.name;
          }
        } else {
          if (file.size > 15 * 1024 * 1024)
            throw new Error("音频不能超过 15MB");
        }

        setProgress(`上传 ${uploadName} · 0%`);
        const media = await uploadReferenceMedia(
          uploadFile,
          uploadName,
          kind,
          n => setProgress(`上传 ${uploadName} · ${n}%${n === 100 ? " · 校验中" : ""}`),
        );
        next = validateReferenceMedia([...next, { ...media, slotId: media.slotId || media.id }]);
        onChange(next);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "参考素材上传失败");
    } finally {
      setProgress("");
      onBusy(false);
    }
  }

  return (
    <section className={styles.mediaReferences}>
      <strong>视频 / 音频参考</strong>
      <small>每类最多 3 段，每段 2–15 秒，同类总长 ≤15 秒。</small>
      <label
        className={styles.mediaDrop}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); void upload(Array.from(e.dataTransfer.files)); }}
      >
        {progress || "＋ 选择文件或拖入此处"}
        <input
          type="file"
          aria-label="上传音视频参考"
          accept={ACCEPT_ATTRS}
          multiple
          disabled={disabled || !!progress}
          onChange={e => { void upload(Array.from(e.target.files || [])); e.target.value = ""; }}
        />
      </label>
      {items.map((m) => {
        const token =
          tokenForSource(`media:${m.slotId || m.id}`, bindings) ||
          `${m.kind === "video" ? "Video" : "Audio"}${
            items.filter((item) => item.kind === m.kind).indexOf(m) + 1
          }`;
        return (
        <div key={m.slotId || m.id} className={styles.mediaReference}>
          <div>
            <strong>@{token}</strong>
            <span>{m.duration.toFixed(1)}s</span>
            <button type="button" disabled={disabled || !!progress} aria-label={`移除 ${m.name}`} onClick={() => onChange(items.filter(x => x.id !== m.id))}>×</button>
          </div>
          {m.kind === "video"
            ? <video src={m.url} controls preload="metadata" />
            : <audio src={m.url} controls preload="metadata" />}
          <label>
            {m.kind === "audio" ? "音频用法" : "视频用法"}
            <textarea
              value={m.prompt || ""}
              maxLength={500}
              disabled={disabled || !!progress}
              placeholder={m.kind === "audio" ? `例如：用 @${token} 的呼吸与呻吟节奏，对白保持原句` : `例如：用 @${token} 的体位和运镜，不要复制原片人脸`}
              onChange={e => onChange(items.map(item => item.id === m.id ? { ...item, prompt: e.target.value } : item))}
            />
          </label>
          <small>{m.name}</small>
        </div>
        );
      })}
      <small>用 @Video1 指定动作或运镜，用 @Audio1 指定声音参考。视频仅参考画面；需要原音轨时请另传音频。</small>
      <small>视频支持 MP4/MOV/AVI/MKV/WebM 等格式，最长 15 秒，非 MP4 或超过 30 MB 会自动转码至 24fps/512px。音频 ≤15 MB。</small>
    </section>
  );
}
