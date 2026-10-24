"use client";
/* eslint-disable @next/next/no-img-element -- authenticated private reference preview. */

import { useEffect, useRef, useState } from "react";
import { deleteGenerationReference, uploadGenerationReference, type GenerationReference } from "../../lib/xumeng-generation";
import Icon from "./icons";
import s from "./generation-studio.module.css";

type Props = {
  accountId: string; value: GenerationReference | null; disabled: boolean; isGuest: boolean;
  video: boolean; required?: boolean; actionParticipants?: number; onChange: (value: GenerationReference | null) => void;
  onUploading: (value: boolean) => void; onError: (value: string) => void; onRequireAccount: () => void;
};
export default function GenerationReferenceInput({ accountId, value, disabled, isGuest, video, required = false, actionParticipants,
  onChange, onUploading, onError, onRequireAccount }: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); onUploading(false); };
  }, [accountId, onUploading]);
  async function upload(file: File | undefined) {
    if (!file || uploading || disabled) return;
    if (isGuest) { onRequireAccount(); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size) {
      onError("请选择 PNG、JPG 或 WebP 图片。"); return;
    }
    const next = new AbortController(); controller.current = next;
    setUploading(true); onUploading(true); onError("");
    try {
      const reference = await uploadGenerationReference(accountId, file, next.signal);
      if (!alive.current || next.signal.aborted) return;
      onChange(reference);
      // Used inputs remain available to their original tasks. Deletion may be
      // rejected while a task runs; that never changes the new selection.
      if (value && value.id !== reference.id) void deleteGenerationReference(accountId, value.id).catch(() => {});
    } catch (error) {
      if (alive.current && !next.signal.aborted) onError(error instanceof Error ? error.message : "参考图上传失败，请重新选择。");
    } finally { if (alive.current) { setUploading(false); onUploading(false); } }
  }
  function remove() {
    if (!value || disabled || uploading) return;
    onChange(null);
    void deleteGenerationReference(accountId, value.id).catch(() => {});
  }
  return <section className={s.reference} aria-label="参考图片">
    <div className={s.referenceHeading}><strong>{actionParticipants ? "上传人物参考图" : video ? "视频参考图 · 首帧" : "参考图片"}</strong><span>{required ? "必填 · " : ""}1 张 · 私人素材</span></div>
    <input ref={fileInput} className={s.fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择参考图片文件" disabled={disabled || uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }}/>
    {value ? <div className={s.referenceSelected}><img src={value.assetUrl} alt={`参考图：${value.name}`} /><div><strong>{value.name}</strong><span>{value.width} × {value.height} · {(value.byteLength / 1024).toFixed(0)} KB</span><div><button type="button" disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>{uploading ? "正在上传…" : "更换图片"}</button><button type="button" disabled={disabled || uploading} onClick={remove}>移除</button></div></div></div>
      : <button type="button" className={s.referenceUpload} disabled={disabled || uploading} onClick={() => isGuest ? onRequireAccount() : fileInput.current?.click()}><Icon name={uploading ? "refresh" : "plus"} size={22}/><strong>{uploading ? "正在上传参考图…" : "上传参考图"}</strong><span>PNG / JPG / WebP</span></button>}
    <p>{actionParticipants === 2 ? "请上传两个人同框的图片。沿用图中的人物、服装和场景，完成所选模板动作。" : video ? "以这张图作为第一帧，描述你希望发生的动作和镜头变化。" : "上传你想修改的图片，再描述需要保留的部分和想做的改变。"}</p>
  </section>;
}
