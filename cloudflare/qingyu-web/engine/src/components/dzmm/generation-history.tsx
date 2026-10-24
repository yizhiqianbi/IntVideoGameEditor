"use client";
/* eslint-disable @next/next/no-img-element -- private generated assets use the authenticated same-origin endpoint. */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGenerationJobs, GenerationError, recoverGeneration, refreshGeneration, type GenerationJob } from "../../lib/xumeng-generation";
import Icon from "./icons";
import s from "./generation-studio.module.css";

type Props = { userId: string; isGuest: boolean; onRequireAccount: () => void };
const names: Record<GenerationJob["status"], string> = { pending: "已提交", processing: "生成中", ready: "已完成", failed: "未完成", unknown: "等待提交核对" };
const running = (job: GenerationJob) => job.finalizedAt === null;
const points = (value: number) => value.toLocaleString("zh-CN");
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const message = (error: unknown) => error instanceof Error ? error.message : "连接中断，请刷新历史任务核对。";

/** Account-keyed remount prevents even a one-render flash of another account's private media. */
export function GenerationHistory(props: Props) {
  return <AccountGenerationHistory key={`${props.isGuest ? "guest" : "account"}:${props.userId}`} {...props} />;
}
export default GenerationHistory;

function AccountGenerationHistory({ userId, isGuest, onRequireAccount }: Props) {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isGuest);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submittedRequest, setSubmittedRequest] = useState<string | null>(null);
  const mounted = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const selected = jobs.find(job => job.id === selectedId) ?? jobs[0];

  const refresh = useCallback(async (poll = false) => {
    if (isGuest || !userId || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const active = () => mounted.current && !controller.signal.aborted && operation.current === controller;
    setBusy(true); setError(""); setNotice("");
    try {
      let list = await fetchGenerationJobs(userId, controller.signal);
      if (!active()) return;
      if (poll) {
        const pending = list.filter(running).slice(0, 5);
        const updated = await Promise.allSettled(pending.map(job => refreshGeneration(userId, job.id, controller.signal)));
        if (!active()) return;
        updated.forEach((result, index) => { if (result.status === "fulfilled") list = list.map(job => job.id === pending[index].id ? result.value : job); });
        if (updated.some(result => result.status === "rejected")) setNotice("部分已有任务暂时未能更新，已保留列表中的状态。可稍后再次核对。");
      }
      if (active()) setJobs(list);
    } catch (failure) { if (active()) setError(message(failure)); }
    finally { if (active()) { operation.current = null; setBusy(false); setLoading(false); } }
  }, [isGuest, userId]);

  useEffect(() => {
    mounted.current = true;
    if (!isGuest && userId) {
      try {
        const value = JSON.parse(sessionStorage.getItem(`qingyu-generation-request:${userId}`) ?? "null");
        if (value?.status === "submitted" && typeof value.fingerprint === "string" && value.fingerprint.length <= 12000
          && JSON.parse(value.fingerprint).accountId === userId && typeof value.requestId === "string"
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)) setSubmittedRequest(value.requestId);
      } catch { /* Read only: invalid or unavailable storage never authorizes a new request. */ }
      void refresh();
    }
    return () => { mounted.current = false; operation.current?.abort(); operation.current = null; };
  }, [isGuest, userId, refresh]);

  async function recoverSubmittedRequest() {
    if (isGuest || !submittedRequest || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const active = () => mounted.current && !controller.signal.aborted && operation.current === controller;
    setBusy(true); setError(""); setNotice("");
    try {
      const job = await recoverGeneration(userId, submittedRequest, controller.signal);
      if (!active()) return;
      setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]); setSelectedId(job.id);
      setNotice("已找到原任务。本次只核对已有请求，没有新建任务或新增预留。");
    } catch (failure) {
      if (active()) setError(failure instanceof GenerationError && failure.code === "generation_request_missing"
        ? "尚未找到原请求对应的任务，原请求记录和草稿仍保留。暂停期间不会重新提交，可稍后再次核对。"
        : message(failure));
    } finally { if (active()) { operation.current = null; setBusy(false); } }
  }

  return <main className={s.workspace} aria-labelledby="generation-history-title">
    <header className={s.header}><div><span className={s.eyebrow}>生成历史</span><h1 id="generation-history-title">生图与视频已暂停开放</h1><p>历史结果和已提交任务仍可查看。</p></div></header>
    {isGuest ? <section className={s.notice}><p>登录后可查看属于你的生成历史。</p><button type="button" className={s.secondary} onClick={onRequireAccount}>登录查看历史</button></section> : <>
      {error && <div className={s.error} role="alert">{error}</div>}
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {submittedRequest && <div className={s.recoveryBanner}><p>本设备有一个已提交的原请求可核对。核对不会重新生成，原草稿保持不变。</p><button type="button" className={s.secondary} disabled={busy} onClick={() => void recoverSubmittedRequest()}>核对原请求</button></div>}
      <div className={s.layout}>
        <section aria-label="历史任务列表"><div className={s.sectionTitle}><h2>历史任务</h2><button type="button" className={s.secondary} disabled={busy} onClick={() => void refresh(true)}><Icon name="refresh" size={14} />{busy ? "正在核对…" : "刷新历史"}</button></div>
          {jobs.length ? <div className={s.history}>{jobs.map(job => <button key={job.id} type="button" aria-pressed={selected?.id === job.id} onClick={() => setSelectedId(job.id)}>
            <Icon name={job.kind === "image" ? "image" : "video"} size={19} /><span><strong>{job.prompt}</strong><small>{date(job.createdAt)} · {job.kind === "image" ? "图片" : "视频"} · {names[job.status]}</small></span><b>{job.status === "ready" ? `${points(job.chargedCredits)} Credit` : running(job) ? `预留 ${points(job.reservedCredits)} Credit` : names[job.status]}</b>
          </button>)}</div> : <p className={s.fine}>{loading ? "正在读取生成历史…" : "还没有生成历史。"}</p>}
          <p className={s.fine}>手动刷新每次最多核对 5 个未结算任务。不会创建新任务。</p>
        </section>
        <section className={s.results} aria-label="历史生成结果"><div className={s.preview}>
          {selected?.status === "ready" && selected.assetUrl ? selected.kind === "image"
            ? <img key={selected.id} src={selected.assetUrl} alt="已完成的历史生成图片" />
            : <video key={selected.id} src={selected.assetUrl} controls playsInline preload="metadata" />
            : <div className={s.empty}><Icon name={selected?.kind === "video" ? "video" : "image"} size={38} /><h3>{selected ? names[selected.status] : "查看历史结果"}</h3><p>{selected ? selected.error || "可手动刷新，核对这个已提交任务的结果。" : "选择历史任务，查看图片、视频及结算状态。"}</p></div>}
        </div>{selected && <div className={s.resultInfo}>
          <p>{selected.prompt}</p><div><span>{date(selected.createdAt)} · {selected.aspectRatio}{selected.duration ? ` · ${selected.duration} 秒` : ""} · {names[selected.status]}</span><strong>{selected.status === "ready" ? `已扣 ${points(selected.chargedCredits)} Credit` : running(selected) ? `预留 ${points(selected.reservedCredits)} Credit` : "本次未扣费"}</strong></div>
          {selected.status === "ready" && <p className={s.fine}>{selected.costBasis === "frozen_sku" ? "供应商未返回独立费用，按任务创建时冻结的官方单价结算。" : "根据供应商返回的费用结算。"}{selected.exceedsReservation ? "本次费用超过预留，扣费已按预留上限封顶。" : ""}</p>}
          {selected.assetUrl && <a className={s.secondary} href={selected.assetUrl} download={`${selected.id}.${selected.mimeType === "image/jpeg" ? "jpg" : selected.mimeType === "image/webp" ? "webp" : selected.kind === "image" ? "png" : "mp4"}`}><Icon name="download" size={15} />下载结果</a>}
        </div>}</section>
      </div>
    </>}
  </main>;
}
