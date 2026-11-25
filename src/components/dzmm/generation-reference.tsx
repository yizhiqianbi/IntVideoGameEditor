"use client";
/* eslint-disable @next/next/no-img-element -- authenticated private reference preview. */

import { useEffect, useRef, useState } from "react";
import { deleteGenerationReference, uploadGenerationReference, type GenerationReference } from "../../lib/xumeng-generation";
import { prepareReferenceImage } from "../../lib/xumeng-reference-file";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengStudio, xumengStudioFill } from "../../lib/xumeng-studio-copy";
import Icon from "./icons";
import s from "./generation-studio.module.css";

type Props = {
  locale?: XumengLocale;
  accountId: string; value: GenerationReference | null; disabled: boolean; isGuest: boolean;
  video: boolean; required?: boolean; actionParticipants?: number; onChange: (value: GenerationReference | null) => void;
  onPrepared?: (prepared: { file: File; dataUrl: string; width: number; height: number; byteLength: number }) => void;
  onUploading: (value: boolean) => void; onError: (value: string) => void; onRequireAccount: () => void;
};
export default function GenerationReferenceInput({ locale = "zh-Hans", accountId, value, disabled, isGuest, video, required = false, actionParticipants,
  onChange, onPrepared, onUploading, onError, onRequireAccount }: Props) {
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const [uploading, setUploading] = useState(false);
  const c = xumengStudio(locale);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); onUploading(false); };
  }, [accountId, onUploading]);
  async function upload(file: File | undefined) {
    if (!file || uploading || disabled) return;
    if (isGuest) { onRequireAccount(); return; }
    const next = new AbortController(); controller.current = next;
    setUploading(true); onUploading(true); onError("");
    try {
      const prepared = await prepareReferenceImage(file);
      if (!alive.current || next.signal.aborted) return;
      onPrepared?.({ file: prepared.file, dataUrl: prepared.dataUrl, width: prepared.width, height: prepared.height, byteLength: prepared.file.size });
      const reference = await uploadGenerationReference(accountId, prepared.file, next.signal);
      if (!alive.current || next.signal.aborted) return;
      onChange(reference);
      // Used inputs remain available to their original tasks. Deletion may be
      // rejected while a task runs; that never changes the new selection.
      if (value && value.id !== reference.id) void deleteGenerationReference(accountId, value.id).catch(() => {});
    } catch (error) {
      if (alive.current && !next.signal.aborted) onError(error instanceof Error ? error.message : c.gsRefUploadFailed);
    } finally { if (alive.current) { setUploading(false); onUploading(false); } }
  }
  function remove() {
    if (!value || disabled || uploading) return;
    onChange(null);
    void deleteGenerationReference(accountId, value.id).catch(() => {});
  }
  const accept = "image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif";
  const stopGuest = (event: { preventDefault(): void }) => { if (isGuest) { event.preventDefault(); onRequireAccount(); } };
  const uploadTitle = uploading ? c.gsUploading : c.gsUploadRef;
  const replaceTitle = uploading ? c.gsUploadingShort : c.gsReplaceImage;
  return <section className={s.reference} aria-label={c.gsReference}>
    <div className={s.referenceHeading}><strong>{actionParticipants ? c.gsUploadPerson : video ? c.gsVideoFirst : c.gsReference}</strong><span>{required ? c.gsRequiredPrivate : c.gsOnePrivate}</span>{!value && <label className={s.tool} title={uploadTitle} onClick={stopGuest}><input className={s.fileCover} type="file" accept={accept} aria-label={c.gsPickFile} title={uploadTitle} disabled={disabled || uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} /><Icon name={uploading ? "refresh" : "upload"} size={16}/></label>}</div>
    {value && <div className={s.referenceSelected}><img src={value.assetUrl} alt={xumengStudioFill(c.gsRefAlt, { name: value.name })} /><div><strong>{value.name}</strong><span>{value.width} × {value.height} · {(value.byteLength / 1024).toFixed(0)} KB</span><div className={s.referenceTools}><label className={s.tool} title={replaceTitle} onClick={stopGuest}><input className={s.fileCover} type="file" accept={accept} aria-label={c.gsReplaceFile} title={replaceTitle} disabled={disabled || uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} /><Icon name={uploading ? "refresh" : "upload"} size={16}/></label><button type="button" className={s.tool} aria-label={c.gsRemove} title={c.gsRemove} disabled={disabled || uploading} onClick={remove}><Icon name="close" size={16}/></button></div></div></div>}
    <p>{actionParticipants === 2 ? c.gsTwoPeople : video ? c.gsFirstFrame : c.gsEditImage}{!value && <span className={s.formatHint}> · PNG / JPG / WebP</span>}</p>
  </section>;
}
