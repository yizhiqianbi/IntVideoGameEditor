"use client";

import { useRef, useState } from "react";
import type { GenerationTemplate } from "../../lib/xumeng-generation-templates";
import s from "./generation-studio.module.css";

export default function GenerationActionPreview({ template }: { template: GenerationTemplate }) {
  const player = useRef<HTMLVideoElement | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!template.demoVideoUrl) return null;
  const failed = failedSource === template.demoVideoUrl;
  return <figure className={s.actionPreview} aria-label={`${template.label}动作示范`}>
    <video ref={player} key={template.demoVideoUrl} controls muted playsInline preload="metadata"
      poster={template.demoPosterUrl} src={template.demoVideoUrl} aria-label={`播放${template.label}动作示范`}
      onError={() => setFailedSource(template.demoVideoUrl!)} />
    <figcaption><strong>动作示范 · {template.label}</strong><span>人物来自你的参考图，动作按这个预览来。</span></figcaption>
    {failed && <p role="status">示范视频暂时无法播放。<button type="button" onClick={() => { setFailedSource(null); player.current?.load(); }}>重新加载</button></p>}
  </figure>;
}
