"use client";

/* eslint-disable @next/next/no-img-element -- Public role cover assets are shared with the Vite frontend. */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  TASK_MARKET_CATEGORIES, TASK_MARKET_HOURS, TASK_MARKET_REWARDS, TaskMarketError,
  fetchTaskMarket, fetchTaskMarketReviewQueue, fetchTaskMarketDetail, publishTaskMarketTask,
  claimTaskMarketTask, hideTaskMarketTask, cancelTaskMarketTask, withdrawTaskMarketAssignment,
  submitTaskMarketWork, reviewTaskMarketWork, reviewTaskMarketTask,
  readTaskMarketDraft, saveTaskMarketDraft, composeTaskMarketInstructions,
  type TaskMarketCategory, type TaskMarketFilter, type TaskMarketReward, type TaskMarketTask,
  type TaskMarketListing, type TaskMarketDetail, type TaskMarketPublish, type TaskMarketMutation,
  type TaskMarketComposeDraft, type TaskMarketWorkDraft,
} from "../../lib/dzmm-task-market";
import { emptyTaskMarketInstructions, hasTaskMarketInstructions, TASK_INSTRUCTION_LIMITS, type TaskMarketInstructions } from "../../lib/dzmm-task-instructions";
import { xumengImageUrl } from "../../lib/xumeng-routes";
import Icon from "./icons";
import s from "./task-market.module.css";

export type TaskMarketCharacter = { id: string; name: string; cover?: string };
type Props = {
  userId: string; isGuest: boolean; isSuper?: boolean; characters?: TaskMarketCharacter[];
  onRequireAccount: () => void; onCharacter?: (character: TaskMarketCharacter) => void;
  onPointsChanged?: () => void;
};
type Tab = TaskMarketFilter | "review";
type Draft = TaskMarketComposeDraft;
type WorkDraft = TaskMarketWorkDraft;
type Operation = { owner: string; epoch: number; target: string | null; label: string };
const TABS: { id: Tab; label: string }[] = [
  { id: "open", label: "进行中" }, { id: "joined", label: "我领取的" }, { id: "my", label: "我发布的" },
  { id: "completed", label: "已完成" }, { id: "all", label: "全部" }, { id: "hidden", label: "已隐藏" },
];
const STATUS = { pending: "待平台审核", open: "进行中", completed: "已完成", cancelled: "已撤回", rejected: "未通过审核" };
const ASSIGNMENT_STATUS = { claimed: "已领取", submitted: "待发布者验收", returned: "已退回，请修改", approved: "已验收", withdrawn: "已放弃领取" };
const initialDraft = (): Draft => ({ title: "", description: "", requirements: "", category: "roleplay", characterId: "", rewardPoints: 5, slots: 1, hours: 24, instructions: emptyTaskMarketInstructions() });
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const errorText = (error: unknown) => error instanceof Error ? error.message : "任务请求失败，请稍后重试。";
const categoryName = (value: TaskMarketCategory) => TASK_MARKET_CATEGORIES.find(category => category.id === value)?.label ?? "玩家委托";
function deadline(value: number, now: number) {
  const hours = Math.ceil((value - now) / 3600000);
  return hours <= 0 ? "已到期" : hours < 24 ? `${hours} 小时内截止` : `${Math.ceil(hours / 24)} 天内截止`;
}

export function TaskMarket({ userId, isGuest, isSuper = false, characters = [], onRequireAccount, onCharacter, onPointsChanged }: Props) {
  const [tab, setTab] = useState<Tab>("open");
  const [category, setCategory] = useState<TaskMarketCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [listing, setListing] = useState<TaskMarketListing | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskMarketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [publishUnconfirmed, setPublishUnconfirmed] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const [workDrafts, setWorkDrafts] = useState<Record<string, WorkDraft>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [confirmation, setConfirmation] = useState<"cancel" | "withdraw" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const account = useRef(userId);
  const accountEpoch = useRef(0);
  const listSequence = useRef(0);
  const nextListOffset = useRef(0);
  const detailSequence = useRef(0);
  const listPending = useRef(false);
  const operation = useRef<Operation | null>(null);
  const publishAttempt = useRef<TaskMarketPublish | null>(null);
  const storageOwner = useRef<string | null>(null);
  const skipDraftWrite = useRef(false);
  const pointsCallback = useRef(onPointsChanged);
  const listKey = JSON.stringify([userId, isSuper, tab, category, query]);
  const currentListKey = useRef(listKey);
  const loadedListKey = useRef<string | null>(null);
  const currentDetail = useRef(detailId);
  if (account.current !== userId) { account.current = userId; accountEpoch.current++; }
  currentListKey.current = listKey; currentDetail.current = detailId; pointsCallback.current = onPointsChanged;

  useEffect(() => {
    const accountGeneration = accountEpoch, listGeneration = listSequence, detailGeneration = detailSequence;
    mounted.current = true;
    return () => { mounted.current = false; accountGeneration.current++; listGeneration.current++; detailGeneration.current++; };
  }, []);
  useEffect(() => {
    setListing(null); setDetailId(null); setDetail(null); setPublishing(false); setDraft(initialDraft());
    setWorkDrafts({}); setReviewing(null); setReviewReason(""); setConfirmation(null); setError(""); setNotice("");
    publishAttempt.current = null; setPublishUnconfirmed(false); operation.current = null; setBusy("");
    storageOwner.current = null; skipDraftWrite.current = true; setStorageWarning("");
    try {
      const saved = readTaskMarketDraft(userId);
      if (saved) {
        setDraft(saved.form); setWorkDrafts(saved.workDrafts); publishAttempt.current = saved.attempt;
        setPublishUnconfirmed(saved.attempt !== null); setPublishing(saved.publishing || saved.attempt !== null);
      }
      storageOwner.current = userId;
    } catch (failure) { setStorageWarning(`${errorText(failure)} 当前编辑原文不会覆盖该浏览器记录。`); }
    if (!isSuper) setTab(previous => previous === "review" ? "open" : previous);
  }, [userId, isSuper]);
  const persistDraft = useCallback((attempt = publishAttempt.current, showPublishing = publishing) => {
    if (storageOwner.current !== userId) return;
    try { saveTaskMarketDraft({ schemaVersion: 1, accountId: userId, form: draft, workDrafts, attempt, publishing: showPublishing }); setStorageWarning(""); }
    catch { setStorageWarning("浏览器暂时无法保存任务草稿。离开或刷新前，请手动保留当前原文。"); }
  }, [userId, draft, workDrafts, publishing]);
  useEffect(() => {
    if (skipDraftWrite.current) { skipDraftWrite.current = false; return; }
    persistDraft();
  }, [persistDraft, publishUnconfirmed, busy]);
  useEffect(() => {
    if (!storageWarning && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [storageWarning, busy]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);

  const loadList = useCallback(async (append = false) => {
    if (append && listPending.current) return;
    const sequence = ++listSequence.current, ownerEpoch = accountEpoch.current;
    const offset = append ? nextListOffset.current : 0;
    listPending.current = true;
    if (append) setLoadingMore(true); else { setLoading(true); if (loadedListKey.current !== listKey) setListing(null); }
    setError("");
    const isCurrent = () => mounted.current && account.current === userId && accountEpoch.current === ownerEpoch
      && currentListKey.current === listKey && listSequence.current === sequence;
    try {
      const filters = { category, q: query, offset, limit: 20 };
      const result = tab === "review" ? await fetchTaskMarketReviewQueue(userId, filters)
        : await fetchTaskMarket(userId, { ...filters, filter: tab });
      if (!isCurrent()) return;
      loadedListKey.current = listKey;
      nextListOffset.current = result.offset + result.tasks.length;
      setListing(previous => append && previous ? { ...result, tasks: [...previous.tasks, ...result.tasks.filter(task => !previous.tasks.some(item => item.id === task.id))] } : result);
    } catch (failure) { if (isCurrent()) setError(errorText(failure)); }
    finally { if (isCurrent()) { listPending.current = false; setLoading(false); setLoadingMore(false); } }
  }, [userId, listKey, tab, category, query]);
  const loadListRef = useRef(loadList); loadListRef.current = loadList;
  useEffect(() => { listPending.current = false; setLoadingMore(false); void loadListRef.current(); }, [listKey, revision]);

  const loadDetail = useCallback(async (id: string, quiet = false) => {
    const sequence = ++detailSequence.current, ownerEpoch = accountEpoch.current;
    if (!quiet) { setDetailLoading(true); setDetail(null); }
    const isCurrent = () => mounted.current && account.current === userId && accountEpoch.current === ownerEpoch
      && currentDetail.current === id && detailSequence.current === sequence;
    try {
      const result = await fetchTaskMarketDetail(userId, id);
      if (isCurrent()) setDetail(result);
    } catch (failure) { if (isCurrent()) setError(errorText(failure)); }
    finally { if (isCurrent()) setDetailLoading(false); }
  }, [userId]);
  useEffect(() => { setError(""); setNotice(""); setReviewing(null); setReviewReason(""); setConfirmation(null); if (detailId) void loadDetail(detailId); else { detailSequence.current++; setDetail(null); setDetailLoading(false); } }, [detailId, loadDetail]);

  const currentOperation = (token: Operation) => mounted.current && operation.current === token
    && account.current === token.owner && accountEpoch.current === token.epoch;
  async function run(label: string, action: () => Promise<TaskMarketMutation>) {
    if (operation.current) return;
    if (isGuest) { onRequireAccount(); return; }
    const token = { owner: userId, epoch: accountEpoch.current, target: detailId, label };
    operation.current = token; setBusy(label); setError(""); setNotice("");
    try {
      const result = await action();
      if (!currentOperation(token)) return;
      setListing(previous => previous ? { ...previous, tasks: previous.tasks.map(task => task.id === result.task.id ? result.task : task) } : previous);
      if (currentDetail.current === result.task.id) {
        setDetail(previous => previous ? {
          ...previous, task: result.task,
          assignment: result.assignment?.userId === userId ? result.assignment : previous.assignment,
          submissions: previous.submissions.map(item => result.assignment?.id === item.assignmentId ? { ...item, assignment: result.assignment } : item),
        } : previous);
        void loadDetail(result.task.id, true);
      }
      setRevision(previous => previous + 1);
      try { pointsCallback.current?.(); } catch { /* A parent refresh must not change an acknowledged operation. */ }
      return result;
    } catch (failure) {
      if (currentOperation(token)) {
        setError(errorText(failure));
        if (label === "publish" && (!(failure instanceof TaskMarketError) || failure.uncertain)) setPublishUnconfirmed(true);
        else if (label === "publish") { publishAttempt.current = null; setPublishUnconfirmed(false); }
        if (token.target && currentDetail.current === token.target) void loadDetail(token.target, true);
      }
    } finally { if (operation.current === token) { operation.current = null; if (mounted.current && account.current === token.owner) setBusy(""); } }
  }
  const refresh = () => { if (operation.current) return; setError(""); setNotice(""); setNow(Date.now()); setRevision(previous => previous + 1); if (detailId) void loadDetail(detailId, true); };
  const navigateTab = (next: Tab) => { if (operation.current) return; setTab(next); setDetailId(null); setPublishing(false); setError(""); setNotice(""); };
  const openTask = (id: string) => { if (!operation.current) { setPublishing(false); setDetailId(id); } };
  const openPublish = () => { if (operation.current) return; if (isGuest) { onRequireAccount(); return; } setDetailId(null); setPublishing(true); setError(""); setNotice(""); };
  const search = (event: FormEvent) => { event.preventDefault(); if (operation.current) return; setQuery(queryInput.trim()); setDetailId(null); setPublishing(false); };
  const formLocked = !!busy || publishUnconfirmed;
  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => { if (!formLocked) setDraft(previous => ({ ...previous, [key]: value })); };
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (operation.current) return;
    if (!publishAttempt.current) {
      if (!draft.title.trim() || !draft.description.trim() || !draft.requirements.trim()) { setError("请填写标题、任务说明和验收标准。"); return; }
      let instructions: TaskMarketInstructions;
      try { instructions = composeTaskMarketInstructions(draft.instructions); }
      catch (failure) { setError(errorText(failure)); return; }
      publishAttempt.current = {
        accountId: userId, requestId: crypto.randomUUID(), title: draft.title.trim(), description: draft.description.trim(), requirements: draft.requirements.trim(),
        category: draft.category, characterId: draft.characterId || null, rewardPoints: draft.rewardPoints, slots: draft.slots,
        deadlineAt: Date.now() + draft.hours * 3600000,
        ...(hasTaskMarketInstructions(instructions) ? { instructions } : {}),
      };
    }
    const submitted = publishAttempt.current;
    persistDraft(submitted, true);
    const result = await run("publish", () => publishTaskMarketTask(submitted));
    if (!result || account.current !== submitted.accountId || !mounted.current) return;
    publishAttempt.current = null; setPublishUnconfirmed(false); setDraft(initialDraft()); setPublishing(false); setTab("my"); setDetailId(result.task.id);
    setNotice("委托已提交，待平台审核；审核通过后才会开放领取。");
  }
  async function hide(task: TaskMarketTask) {
    const result = await run("hide", () => hideTaskMarketTask(userId, task.id, !task.hidden));
    if (result) setNotice(task.hidden ? "已恢复到任务列表。" : "已从你的任务列表隐藏，领取和成果记录仍然保留。");
  }
  async function claim(task: TaskMarketTask) {
    const result = await run("claim", () => claimTaskMarketTask(userId, task.id));
    if (result) setNotice("已领取委托。请在截止时间前提交原创文字成果。");
  }
  async function submitWork(event: FormEvent) {
    event.preventDefault();
    if (!detail?.assignment || !detailId) return;
    const target = detailId, input = workDrafts[target];
    if (!input?.text.trim()) { setError("请写下你的原创成果后再提交。"); return; }
    const result = await run("submit", () => submitTaskMarketWork(userId, target, detail.assignment!.version, input.text));
    if (result) {
      setWorkDrafts(previous => previous[target]?.revision === input.revision ? { ...previous, [target]: { text: "", revision: input.revision + 1 } } : previous);
      setNotice("成果已提交，等待发布者验收；此时不会发放奖励。");
    }
  }
  async function confirm() {
    if (!detail || !confirmation) return;
    const kind = confirmation;
    const result = kind === "cancel" ? await run("cancel", () => cancelTaskMarketTask(userId, detail.task.id, detail.task.version))
      : detail.assignment ? await run("withdraw", () => withdrawTaskMarketAssignment(userId, detail.task.id, detail.assignment!.version)) : undefined;
    if (result) { setConfirmation(null); setNotice(kind === "cancel" ? "已撤回委托，停止新的领取；已领取者仍可在原期限内提交。" : "已放弃本次领取。你的历史成果记录仍会保留。"); }
  }
  async function reviewWork(assignmentId: string, version: number, decision: "approved" | "returned") {
    if (!detail || (decision === "returned" && !reviewReason.trim())) { setError("退回成果时，请说明需要修改的内容。"); return; }
    const result = await run("reviewWork", () => reviewTaskMarketWork(userId, detail.task.id, assignmentId, version, decision, decision === "returned" ? reviewReason.trim() : undefined));
    if (result) { setReviewing(null); setReviewReason(""); setNotice(decision === "approved" ? "验收通过，Credit 以服务器发放记录为准。" : "成果已退回，修改理由已保存。"); }
  }
  async function reviewTask(decision: "approved" | "rejected") {
    if (!detail || (decision === "rejected" && !reviewReason.trim())) { setError("驳回委托时，请填写审核理由。"); return; }
    const result = await run("reviewTask", () => reviewTaskMarketTask(userId, detail.task.id, detail.task.version, decision, decision === "rejected" ? reviewReason.trim() : undefined));
    if (result) { setReviewing(null); setReviewReason(""); setNotice(decision === "approved" ? "委托已通过平台审核。" : "委托已驳回，审核理由已保存。"); }
  }

  const task = detail?.task;
  const explicitGoal = task?.instructions?.goal;
  const hasExplicitGoal = Boolean(explicitGoal?.trim());
  const assignment = detail?.assignment;
  const isOwner = task?.owner.id === userId;
  const publicCharacter = task?.characterId ? characters.find(character => character.id === task.characterId) : undefined;
  const canSubmit = !!assignment && ["claimed", "returned"].includes(assignment.status) && !!task && task.deadlineAt > now;
  const canWithdraw = !!assignment && ["claimed", "returned"].includes(assignment.status);
  const canCancel = isOwner && !!task && ["pending", "open"].includes(task.status);
  const canReviewTask = isSuper && !isGuest && !!task && task.status === "pending";
  const latestSubmissions = detail?.submissions.filter(item => !detail.submissions.some(other => other.assignmentId === item.assignmentId && other.revision > item.revision)) ?? [];
  const previousOwnSubmission = latestSubmissions.find(item => item.userId === userId);
  const working = !!busy;

  return <main className={s.page} aria-label="任务广场">
    <header className={s.header}><div><h1>任务广场</h1><p>领取玩家委托，提交原创成果，验收后获得聊天 Credit。</p></div><div className={s.headerActions}>
      <button type="button" className={s.outline} disabled={working || loading || detailLoading} onClick={refresh}><Icon name="refresh" size={16} />刷新</button>
      <button type="button" className={s.primary} disabled={working} onClick={openPublish}><Icon name="plus" size={16} />发布委托</button>
    </div></header>
    <div className={s.tabs} role="tablist" aria-label="任务状态">{[...TABS, ...(isSuper ? [{ id: "review" as const, label: "待平台审核" }] : [])].map(item => <button type="button" key={item.id} role="tab" aria-selected={tab === item.id} className={`${s.tab} ${tab === item.id ? s.selected : ""}`} disabled={working} onClick={() => navigateTab(item.id)}>{item.label}</button>)}</div>
    {isGuest && <div className={s.information}>游客可浏览委托。<button type="button" className={s.quiet} onClick={onRequireAccount}>注册或登录后领取与发布</button></div>}
    {storageWarning && <p className={s.error} role="alert">{storageWarning}</p>}
    {error && <div className={s.error} role="alert"><span>{error}</span><button type="button" disabled={working || loading || detailLoading} onClick={refresh}>刷新状态</button></div>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {publishing ? <section className={s.form} aria-labelledby="task-publish-heading">
      <button type="button" className={`${s.quiet} ${s.back}`} disabled={working} onClick={() => setPublishing(false)}><Icon name="back" size={16} />返回广场</button>
      <h2 id="task-publish-heading">发布委托</h2><p className={s.muted}>填写明确的工作内容和验收标准。提交后待平台审核，奖励为聊天 Credit。</p>
      {publishUnconfirmed && <p className={s.information}>上次发布结果尚未确认。请重试原委托；重试使用相同编号和内容，避免重复发布。</p>}
      <form onSubmit={event => void publish(event)}>
        <div className={s.fields}>
          <label><span className={s.fieldHeading}>标题<small>{draft.title.length}/80</small></span><input value={draft.title} required maxLength={80} disabled={formLocked} onChange={event => updateDraft("title", event.target.value)} placeholder="例如：体验一段海港角色开场" /></label>
          <label><span className={s.fieldHeading}>任务说明<small>{draft.description.length}/4000</small></span><textarea value={draft.description} required maxLength={4000} rows={6} disabled={formLocked} onChange={event => updateDraft("description", event.target.value)} placeholder="说明任务背景、希望完成的内容和提交方式。" /></label>
          <TaskInstructionsEditor value={draft.instructions ?? emptyTaskMarketInstructions()} disabled={formLocked} onChange={value => updateDraft("instructions", value)} />
          <label><span className={s.fieldHeading}>验收标准<small>{draft.requirements.length}/2000</small></span><textarea value={draft.requirements} required maxLength={2000} rows={4} disabled={formLocked} onChange={event => updateDraft("requirements", event.target.value)} placeholder="例如：提交原创体验记录，指出一处场景衔接问题并提出改进建议。" /></label>
          <div className={s.fieldPair}><label>任务类别<select value={draft.category} disabled={formLocked} onChange={event => updateDraft("category", event.target.value as TaskMarketCategory)}>{TASK_MARKET_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>关联公开角色（可选）<select value={draft.characterId} disabled={formLocked} onChange={event => updateDraft("characterId", event.target.value)}><option value="">不关联角色</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label></div>
          <div className={s.fieldPair}><label>每人奖励<select value={draft.rewardPoints} disabled={formLocked} onChange={event => updateDraft("rewardPoints", Number(event.target.value) as TaskMarketReward)}>{TASK_MARKET_REWARDS.map(points => <option key={points} value={points}>{points} Credit</option>)}</select></label><label>名额<input type="number" min={1} max={20} step={1} required value={draft.slots} disabled={formLocked} onChange={event => updateDraft("slots", Number(event.target.value))} /></label></div>
          <label>任务时限<select value={draft.hours} disabled={formLocked} onChange={event => updateDraft("hours", Number(event.target.value) as Draft["hours"])}>{TASK_MARKET_HOURS.map(hours => <option key={hours} value={hours}>{hours} 小时</option>)}</select></label>
        </div>
        <p className={s.information}>奖励预算共 {draft.rewardPoints * draft.slots} Credit，以平台审核结果为准。奖励会直接计入聊天余额。</p>
        <div className={s.formActions}><button type="button" className={s.outline} disabled={working} onClick={() => setPublishing(false)}>稍后继续填写</button><button type="submit" className={s.primary} disabled={working}>{busy === "publish" ? "正在提交…" : publishUnconfirmed ? "重试原委托" : "提交平台审核"}</button></div>
      </form>
    </section> : detailId ? <>
      <button type="button" className={`${s.quiet} ${s.back}`} disabled={working} onClick={() => setDetailId(null)}><Icon name="back" size={16} />返回任务列表</button>
      {detailLoading && !detail ? <div className={s.empty} role="status">正在读取委托…</div> : !task || !detail ? <div className={s.empty}><strong>暂时无法读取这项委托</strong><p>可以刷新重试，或返回任务列表。</p></div> : <div className={s.detail}>
        <div className={s.detailMain}>
          <header className={s.detailHeading}><div className={s.actions}><span className={s.tag}>{categoryName(task.category)}</span><span className={`${s.status} ${task.status === "open" ? s.live : ""}`}>{STATUS[task.status]}</span>{task.hidden && <span className={s.status}>已在你的列表隐藏</span>}</div><h2>{task.title}</h2><div className={s.byline}><span>发布者 {task.owner.nickname}</span><span>{date(task.createdAt)} 发布</span></div></header>
          {task.status === "pending" && <p className={s.information}>这项委托待平台审核，暂不开放领取。</p>}
          {task.status === "cancelled" && assignment && ["claimed", "returned"].includes(assignment.status) && task.deadlineAt > now && <p className={s.information}>发布者已停止新的领取。你仍可在原截止时间前提交成果，领取记录保留在“我领取的”。</p>}
          {task.reviewReason && <p className={s.information}>平台审核说明：{task.reviewReason}</p>}
          <section className={s.section} aria-label="任务目标"><h3><Icon name="compass" size={18} />任务目标</h3><p className={s.body}>{hasExplicitGoal ? explicitGoal : task.description}</p></section>
          {hasExplicitGoal && explicitGoal !== task.description && <section className={s.section}><h3>任务背景</h3><p className={s.body}>{task.description}</p></section>}
          {!!task.instructions && (task.instructions.constraints.length > 0 || task.instructions.rules.length > 0) && <section className={s.section} aria-label="约束条件"><h3><Icon name="sliders" size={18} />约束条件</h3>
            {task.instructions.constraints.length > 0 && <ul className={s.constraintTags} aria-label="约束标签">{task.instructions.constraints.map((text, index) => <li key={index}>{text}</li>)}</ul>}
            {task.instructions.rules.length > 0 && <ol className={s.ruleList} aria-label="编号规则">{task.instructions.rules.map((text, index) => <li key={index}>{text}</li>)}</ol>}
          </section>}
          <section className={s.section}><h3>验收标准</h3><p className={`${s.body} ${s.requirements}`}>{task.requirements}</p></section>
          {task.characterId && <section className={s.section}><h3>关联角色</h3>{publicCharacter && onCharacter ? <button type="button" className={s.character} disabled={working} onClick={() => onCharacter(publicCharacter)}>{publicCharacter.cover && <img src={xumengImageUrl(publicCharacter.cover)} alt="" />}<span>{publicCharacter.name}<small>查看公开角色</small></span><Icon name="chevron" size={15} /></button> : <p className={s.muted}>{task.characterName || "关联角色"} · 当前无法打开公开角色</p>}</section>}
          {assignment && <section className={s.section} aria-label="我的领取记录"><div className={s.submissionHead}><h3>我的领取记录</h3><span className={`${s.status} ${assignment.status === "approved" ? s.live : ""}`}>{ASSIGNMENT_STATUS[assignment.status]}</span></div>
            <p className={s.muted}>{date(assignment.createdAt)} 领取{assignment.submittedAt ? ` · ${date(assignment.submittedAt)} 提交` : ""}{assignment.reviewedAt ? ` · ${date(assignment.reviewedAt)} 验收` : ""}</p>
            {assignment.reviewReason && <p className={s.information}>发布者反馈：{assignment.reviewReason}</p>}
            {assignment.status === "approved" && <p className={s.information}>成果已通过验收。奖励 {assignment.rewardPoints} Credit，领取记录已保存在你的账户。</p>}
            {canSubmit ? <form className={s.submission} onSubmit={event => void submitWork(event)}><label htmlFor="task-work-body">提交原创文字成果</label>{assignment.status === "returned" && previousOwnSubmission && !workDrafts[task.id]?.text.length && <button type="button" className={s.outline} disabled={working} onClick={() => setWorkDrafts(previous => ({ ...previous, [task.id]: { text: previousOwnSubmission.body, revision: (previous[task.id]?.revision ?? 0) + 1 } }))}>载入上次成果后修改</button>}<textarea id="task-work-body" required maxLength={12000} value={workDrafts[task.id]?.text ?? ""} disabled={working} onChange={event => { const text = event.target.value; setWorkDrafts(previous => ({ ...previous, [task.id]: { text, revision: (previous[task.id]?.revision ?? 0) + 1 } })); }} placeholder="写下你的原创内容、体验过程或反馈，与验收标准逐项对应。" /><p className={s.muted}>正文最多 12,000 字；截止时间 {date(task.deadlineAt)}。提交后由发布者验收。</p><div className={s.actions}><button type="submit" className={s.primary} disabled={working || !workDrafts[task.id]?.text.trim()}>{busy === "submit" ? "正在提交…" : assignment.status === "returned" ? "提交修改成果" : "提交成果"}</button>{canWithdraw && <button type="button" className={s.quiet} disabled={working} onClick={() => setConfirmation("withdraw")}>放弃领取</button>}</div></form>
              : assignment.status === "submitted" ? <p className={s.information}>成果已提交，请等待发布者验收。即使任务到期，也可继续验收本次成果。</p>
                : ["claimed", "returned"].includes(assignment.status) && task.deadlineAt <= now ? <p className={s.information}>任务已到期，不能再提交或修改成果；已有领取和提交记录保留。</p> : null}
          </section>}
          {latestSubmissions.length > 0 && <section className={s.section} aria-label={isOwner ? "收到的成果" : "提交记录"}><h3>{isOwner ? "收到的成果" : "提交记录"}</h3>{latestSubmissions.map(item => <article key={item.id} className={s.submissionCard}><div className={s.submissionMeta}><strong>{item.nickname}</strong><span>第 {item.revision} 次提交 · {date(item.createdAt)}</span><span className={s.status}>{ASSIGNMENT_STATUS[item.assignment.status]}</span></div><p className={s.body}>{item.body}</p>{item.assignment.reviewReason && <p className={s.muted}>验收反馈：{item.assignment.reviewReason}</p>}
            {isOwner && !isGuest && item.assignment.status === "submitted" && <div className={s.actions}><button type="button" className={s.primary} disabled={working} onClick={() => void reviewWork(item.assignmentId, item.assignment.version, "approved")}>{busy === "reviewWork" ? "正在处理…" : "验收通过"}</button><button type="button" className={s.outline} disabled={working} onClick={() => { setReviewing(item.assignmentId); setReviewReason(""); }}>退回修改</button></div>}
            {reviewing === item.assignmentId && isOwner && item.assignment.status === "submitted" && <div className={s.review}><label htmlFor={`task-return-${item.assignmentId}`}>退回理由</label><textarea id={`task-return-${item.assignmentId}`} required maxLength={2000} value={reviewReason} disabled={working} onChange={event => setReviewReason(event.target.value)} /><div className={s.actions}><button type="button" className={s.primary} disabled={working || !reviewReason.trim()} onClick={() => void reviewWork(item.assignmentId, item.assignment.version, "returned")}>保存理由并退回</button><button type="button" className={s.outline} disabled={working} onClick={() => setReviewing(null)}>取消</button></div><p className={s.muted}>退回后需要在原截止时间前重新提交；请写明具体修改要求。</p></div>}
          </article>)}</section>}
          {canReviewTask && <section className={s.section} aria-label="平台审核"><h3>平台审核</h3><p className={s.muted}>核对委托内容、验收标准和 Credit 奖励预算。</p><div className={s.actions}><button type="button" className={s.primary} disabled={working} onClick={() => void reviewTask("approved")}>批准委托</button><button type="button" className={s.outline} disabled={working} onClick={() => { setReviewing("task"); setReviewReason(""); }}>驳回委托</button></div>{reviewing === "task" && <div className={s.review}><label htmlFor="task-reject-reason">驳回理由</label><textarea id="task-reject-reason" maxLength={2000} value={reviewReason} disabled={working} onChange={event => setReviewReason(event.target.value)} /><div className={s.actions}><button type="button" className={s.primary} disabled={working || !reviewReason.trim()} onClick={() => void reviewTask("rejected")}>保存理由并驳回</button><button type="button" className={s.outline} disabled={working} onClick={() => setReviewing(null)}>取消</button></div></div>}</section>}
          {confirmation && <section className={s.confirmation} role="alertdialog" aria-labelledby="task-confirm-heading"><h3 id="task-confirm-heading">{confirmation === "cancel" ? "撤回这项委托？" : "放弃本次领取？"}</h3><p>{confirmation === "cancel" ? "撤回后将停止新的领取。已领取者仍可在原截止时间前提交；已提交成果仍需验收，历史记录保留。" : "尚未提交或已退回的领取可以放弃；已提交或已验收的成果不能在这里撤回。"}</p><div className={s.actions}><button type="button" className={`${s.outline} ${s.danger}`} disabled={working} onClick={() => void confirm()}>{working ? "正在处理…" : "确认"}</button><button type="button" className={s.outline} disabled={working} onClick={() => setConfirmation(null)}>保留当前状态</button></div></section>}
        </div>
        <aside className={s.detailAside} aria-label="委托奖励与进度"><h3>每人奖励</h3><div className={s.reward}>+{task.rewardPoints}<small>Credit</small></div><dl><div><dt>剩余名额</dt><dd>{task.remainingSlots} / {task.slots}</dd></div><div><dt>已验收</dt><dd>{task.approvedCount} 人</dd></div><div><dt>已提交</dt><dd>{task.submissionCount} 份</dd></div><div><dt>截止时间</dt><dd>{date(task.deadlineAt)}</dd></div></dl>
          {isGuest ? <button type="button" className={s.primary} onClick={onRequireAccount}>登录后领取</button> : !isOwner && task.canClaim && !assignment && task.deadlineAt > now ? <button type="button" className={s.primary} disabled={working} onClick={() => void claim(task)}>{busy === "claim" ? "正在领取…" : "领取委托"}</button> : <p className={s.muted}>{isOwner ? "不能领取自己的委托。" : assignment ? "领取与提交进度已保存在你的账户。" : task.status !== "open" ? "这项委托当前不开放领取。" : task.deadlineAt <= now ? "已超过领取截止时间。" : task.hidden ? "请先恢复到列表后再领取。" : task.remainingSlots === 0 ? "名额已满，暂时无法领取。" : "当前无法领取，请刷新状态后再试。"}</p>}
          {!isGuest && <button type="button" className={s.outline} disabled={working} onClick={() => void hide(task)}>{task.hidden ? "恢复到我的列表" : "在我的列表隐藏"}</button>}
          {canCancel && <button type="button" className={s.quiet} disabled={working} onClick={() => setConfirmation("cancel")}>撤回委托</button>}
          <p className={s.muted}>奖励 Credit 由任务系统记录，并在验收通过后计入聊天余额。验收前不会领取奖励。</p>
        </aside>
      </div>}
    </> : <>
      <div className={s.filters}><div className={s.categories} aria-label="任务类别">{[{ id: "all" as const, label: "全部类别" }, ...TASK_MARKET_CATEGORIES].map(item => <button type="button" key={item.id} className={`${s.category} ${category === item.id ? s.categoryActive : ""}`} aria-pressed={category === item.id} disabled={working} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div><form className={s.search} onSubmit={search}><Icon name="search" size={17} /><input aria-label="搜索任务" maxLength={120} disabled={working} value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder="搜索标题或任务说明" /><button type="submit" disabled={working}>搜索</button></form></div>
      <div className={s.summary}><span>{tab === "review" ? "待平台审核的委托" : TABS.find(item => item.id === tab)?.label} · {listing ? `${listing.total} 项` : "读取中"}</span><span>奖励为聊天 Credit</span></div>
      {loading && !listing ? <div className={s.empty} role="status">正在读取任务…</div> : !listing && error ? <div className={s.empty}><strong>任务暂时不可用</strong><p>请刷新状态后重试。</p></div> : !listing?.tasks.length ? <div className={s.empty}><Icon name="trophy" size={28} /><strong>{query || category !== "all" ? "没有找到匹配的委托" : tab === "joined" ? "还没有领取委托" : tab === "my" ? "还没有发布委托" : tab === "hidden" ? "没有隐藏的委托" : tab === "review" ? "暂无待审核委托" : "暂无这类委托"}</strong><p>{query || category !== "all" ? "试试其他关键词或类别。" : tab === "joined" ? "在“进行中”领取委托后，可在这里继续提交和查看验收进度；隐藏的委托可在“已隐藏”找回。" : "刷新可读取最新状态。"}</p>{(query || category !== "all") && <button type="button" className={s.outline} disabled={working} onClick={() => { setQuery(""); setQueryInput(""); setCategory("all"); }}>清除筛选</button>}</div> : <div className={s.list} aria-label="玩家委托列表">{listing.tasks.map(item => <article key={item.id} className={s.card}>
        <div className={s.cardTop}><span className={s.tag}>{categoryName(item.category)}</span><span className={`${s.status} ${item.status === "open" ? s.live : ""}`}>{STATUS[item.status]}</span></div><button type="button" className={s.title} disabled={working} onClick={() => openTask(item.id)}>{item.title}</button><p className={s.excerpt}>{item.description}</p><div className={s.rewardRow}><div className={s.reward}>+{item.rewardPoints}<small>Credit / 人</small></div><span>剩余 {item.remainingSlots}/{item.slots} 名额<br />{deadline(item.deadlineAt, now)}</span></div><div className={s.cardMeta}><span className={s.owner}><span className={s.avatar}><Icon name="user" size={13} /></span>{item.owner.nickname}</span><span>{date(item.createdAt)}</span></div><div className={s.cardActions}><span className={s.participating}>{item.owner.id === userId ? "我发布的委托" : item.participating ? "我已参与" : `${item.approvedCount} 人已验收`}</span>{!isGuest && <button type="button" className={s.quiet} disabled={working} onClick={() => void hide(item)}>{item.hidden ? "恢复" : "隐藏"}</button>}</div><button type="button" className={`${s.outline} ${s.cardCta}`} disabled={working} onClick={() => openTask(item.id)}>{item.owner.id === userId ? "查看委托" : item.participating ? "查看进度" : item.canClaim ? "查看并领取" : "查看委托"}<Icon name="chevron" size={14} /></button>
      </article>)}</div>}
      {listing?.hasMore && <button type="button" className={`${s.outline} ${s.loadMore}`} disabled={working || loadingMore || loading} onClick={() => void loadList(true)}>{loadingMore ? "正在加载…" : "加载更多委托"}</button>}
    </>}
  </main>;
}

export default TaskMarket;


function TaskInstructionsEditor({ value, disabled, onChange }: { value: TaskMarketInstructions; disabled: boolean; onChange: (value: TaskMarketInstructions) => void }) {
  const updateRow = (key: "constraints" | "rules", index: number, text: string) => onChange({ ...value, [key]: value[key].map((item, row) => row === index ? text : item) });
  const removeRow = (key: "constraints" | "rules", index: number) => onChange({ ...value, [key]: value[key].filter((_, row) => row !== index) });
  const moveRule = (index: number, direction: -1 | 1) => {
    const rules = [...value.rules]; [rules[index], rules[index + direction]] = [rules[index + direction], rules[index]];
    onChange({ ...value, rules });
  };
  return <fieldset className={s.instructionsEditor} disabled={disabled}><legend>任务目标与约束（可选）</legend>
    <p className={s.muted}>目标描述最终要完成什么，约束说明过程中的要求。留空时使用任务说明作为目标；成果由发布者验收。</p>
    <label htmlFor="task-instruction-goal"><span className={s.fieldHeading}>任务目标<small>{value.goal.length}/{TASK_INSTRUCTION_LIMITS.goal}</small></span></label>
    <textarea id="task-instruction-goal" value={value.goal} rows={4} maxLength={TASK_INSTRUCTION_LIMITS.goal} onChange={event => onChange({ ...value, goal: event.target.value })} placeholder="例如：修复海港灯塔，并完成一次夜间巡航。" />
    <div className={s.editorHeading}><h3>约束标签</h3><small>{value.constraints.length}/{TASK_INSTRUCTION_LIMITS.constraintCount}</small></div>
    <div className={s.editorRows}>{value.constraints.map((text, index) => <div className={s.editorRow} key={index}><label htmlFor={`task-constraint-${index}`}>约束 {index + 1}</label><input id={`task-constraint-${index}`} value={text} maxLength={TASK_INSTRUCTION_LIMITS.constraintLength} onChange={event => updateRow("constraints", index, event.target.value)} placeholder="例如：保持角色一致" /><button type="button" className={s.quiet} aria-label={`删除约束 ${index + 1}`} onClick={() => removeRow("constraints", index)}>删除</button></div>)}</div>
    <button type="button" className={s.outline} disabled={disabled || value.constraints.length >= TASK_INSTRUCTION_LIMITS.constraintCount} onClick={() => onChange({ ...value, constraints: [...value.constraints, ""] })}><Icon name="plus" size={14} />添加约束</button>
    <div className={s.editorHeading}><h3>编号规则</h3><small>{value.rules.length}/{TASK_INSTRUCTION_LIMITS.ruleCount}</small></div>
    <div className={s.editorRows}>{value.rules.map((text, index) => <div className={`${s.editorRow} ${s.editorRule}`} key={index}><label htmlFor={`task-rule-${index}`}>规则 {index + 1}</label><textarea id={`task-rule-${index}`} value={text} rows={2} maxLength={TASK_INSTRUCTION_LIMITS.ruleLength} onChange={event => updateRow("rules", index, event.target.value)} placeholder="例如：先调查灯塔故障，再寻找修复材料。" /><div className={s.rowActions}><button type="button" className={s.quiet} disabled={disabled || index === 0} aria-label={`上移规则 ${index + 1}`} onClick={() => moveRule(index, -1)}>上移</button><button type="button" className={s.quiet} disabled={disabled || index === value.rules.length - 1} aria-label={`下移规则 ${index + 1}`} onClick={() => moveRule(index, 1)}>下移</button><button type="button" className={s.quiet} aria-label={`删除规则 ${index + 1}`} onClick={() => removeRow("rules", index)}>删除</button></div></div>)}</div>
    <button type="button" className={s.outline} disabled={disabled || value.rules.length >= TASK_INSTRUCTION_LIMITS.ruleCount} onClick={() => onChange({ ...value, rules: [...value.rules, ""] })}><Icon name="plus" size={14} />添加规则</button>
    <p className={s.muted}>每条约束最多 120 字，每条规则最多 500 字，目标与条目合计最多 12,000 字。空白条目不会发布。</p>
  </fieldset>;
}
