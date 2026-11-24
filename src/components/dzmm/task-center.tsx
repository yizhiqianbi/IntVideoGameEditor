"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { claimDzmmTask, fetchDzmmTasks, type DzmmTask, type DzmmTaskCenter, type DzmmTaskId } from "../../lib/dzmm-tasks";
import { XUMENG_FORUM_ENABLED } from "../../lib/xumeng-feature-availability";
import { xumengFill, xumengHtmlLang, xumengMessage, type XumengLocale, type XumengMessageKey } from "../../lib/xumeng-i18n";
import Icon, { type IconName } from "./icons";
import s from "./task-center.module.css";

type Destination = "chat" | "studio" | "characters" | "profile" | "forum" | "checkin";
type Props = { userId: string; isGuest: boolean; locale: XumengLocale; onNavigate: (view: Destination) => void; onRequireAccount: () => void; beforeRefresh?: () => Promise<void> };
const ROUTES: Record<DzmmTaskId, { view: Destination; icon: IconName; label: XumengMessageKey }> = {
  daily_checkin: { view: "checkin", icon: "sun", label: "taskGoCheckin" },
  first_conversation: { view: "chat", icon: "chat", label: "taskGoChat" },
  publish_character: { view: "studio", icon: "edit", label: "taskGoCreate" },
  follow_authors: { view: "characters", icon: "users", label: "taskGoDiscover" },
  complete_profile: { view: "profile", icon: "user", label: "taskGoProfile" },
  forum_reply: { view: "forum", icon: "compass", label: "taskGoForum" },
};
const TASK_COPY: Record<DzmmTaskId, { title: XumengMessageKey; body: XumengMessageKey }> = {
  daily_checkin: { title: "taskDailyTitle", body: "taskDailyBody" },
  first_conversation: { title: "taskChatTitle", body: "taskChatBody" },
  publish_character: { title: "taskPublishTitle", body: "taskPublishBody" },
  follow_authors: { title: "taskFollowTitle", body: "taskFollowBody" },
  complete_profile: { title: "taskProfileTitle", body: "taskProfileBody" },
  forum_reply: { title: "taskForumTitle", body: "taskForumBody" },
};
const TASK_ORDER: DzmmTaskId[] = ["complete_profile", "first_conversation", "follow_authors", "forum_reply", "publish_character", "daily_checkin"];
const date = (value: number, locale: XumengLocale) => new Date(value).toLocaleString(xumengHtmlLang(locale), { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const errorText = (error: unknown, locale: XumengLocale) => error instanceof Error ? error.message : xumengMessage(locale, "taskFailed");
function taskText(locale: XumengLocale, task: DzmmTask) {
  const copy = TASK_COPY[task.id];
  return {
    title: xumengMessage(locale, copy.title),
    description: xumengFill(locale, copy.body, { points: task.rewardPoints }),
  };
}
function countdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TaskCenter({ userId, isGuest, locale, onNavigate, onRequireAccount, beforeRefresh }: Props) {
  const [data, setData] = useState<DzmmTaskCenter | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<DzmmTaskId | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState({ now: Date.now(), offset: 0 });
  const mounted = useRef(false);
  const generation = useRef(0);
  const account = useRef(userId);
  const pending = useRef(false);
  const before = useRef(beforeRefresh);
  account.current = userId; before.current = beforeRefresh;
  const reload = useCallback(async () => {
    const epoch = ++generation.current;
    setLoading(true); setError("");
    try {
      await before.current?.();
      if (!mounted.current || epoch !== generation.current || account.current !== userId) return;
      const result = await fetchDzmmTasks();
      if (!mounted.current || epoch !== generation.current || account.current !== userId) return;
      if (result.accountId !== userId) throw new Error(xumengMessage(locale, "taskSwitched"));
      setData(result); setClock({ now: Date.now(), offset: result.serverTime - Date.now() });
    } catch (failure) { if (mounted.current && epoch === generation.current) setError(errorText(failure, locale)); }
    finally { if (mounted.current && epoch === generation.current) setLoading(false); }
  }, [userId, locale]);
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; }; }, [reload]);
  useEffect(() => { const timer = setInterval(() => setClock((previous) => ({ ...previous, now: Date.now() })), 1000); return () => clearInterval(timer); }, []);
  async function claim(taskId: DzmmTaskId) {
    if (pending.current || loading || claiming) return;
    if (isGuest) { onRequireAccount(); return; }
    pending.current = true; setClaiming(taskId); setError(""); setNotice("");
    const id = userId;
    try {
      const result = await claimDzmmTask(taskId, id);
      if (!mounted.current || account.current !== id) return;
      if (result.accountId !== id) throw new Error(xumengMessage(locale, "taskSwitched"));
      setData(result); setClock({ now: Date.now(), offset: result.serverTime - Date.now() });
      setNotice(xumengFill(locale, "taskClaimedNotice", { points: result.claim.points }));
    } catch (failure) {
      if (mounted.current && account.current === id) {
        setError(errorText(failure, locale));
        try { const latest = await fetchDzmmTasks(); if (mounted.current && account.current === id && latest.accountId === id) { setData(latest); setClock({ now: Date.now(), offset: latest.serverTime - Date.now() }); } } catch { /* Keep the first meaningful error. */ }
      }
    } finally { pending.current = false; if (mounted.current && account.current === id) setClaiming(null); }
  }
  const working = loading || claiming !== null;
  const orderedTasks = data ? [...data.tasks].filter((task) => XUMENG_FORUM_ENABLED || task.id !== "forum_reply").sort((a, b) => TASK_ORDER.indexOf(a.id) - TASK_ORDER.indexOf(b.id)) : [];
  const available = orderedTasks.filter((task) => task.claimable);
  const claimed = orderedTasks.filter((task) => task.claimed).length;
  const oneTimeTasks = orderedTasks.filter((task) => task.repeat === "once");
  const oneTimeClaimed = oneTimeTasks.filter((task) => task.claimed).length;
  const oneTimeTotal = oneTimeTasks.reduce((sum, task) => sum + task.rewardPoints, 0);
  const dailyTotal = orderedTasks.filter((task) => task.repeat === "daily").reduce((sum, task) => sum + task.rewardPoints, 0);
  const serverNow = clock.now + clock.offset;
  const text = (key: XumengMessageKey) => xumengMessage(locale, key);
  return <main className={s.page}>
    <header className={s.header}><div><span className={s.eyebrow}>{text("taskEyebrow")}</span><h1>{text("taskHeading")}</h1><p>{text("taskLead")}</p></div><button className={s.refresh} disabled={working} onClick={() => void reload()}><Icon name="refresh" size={16} />{loading ? text("taskRefreshing") : text("taskRefresh")}</button></header>
    <section className={s.balance} aria-label={text("taskCreditLabel")}><div className={s.balanceTop}><div><span>{text("taskCreditLabel")}</span><strong>{data ? data.points.balance : "—"}<small>金币</small></strong></div><div className={s.balanceProgress}><span>{text("taskProgressLabel")}</span><strong>{data ? `${oneTimeClaimed} / ${oneTimeTasks.length}` : "—"}</strong><progress value={oneTimeClaimed} max={Math.max(oneTimeTasks.length, 1)} aria-label={text("taskProgressLabel")} /></div></div><p>{xumengFill(locale, "taskOffer", { count: oneTimeTasks.length || "—", total: data ? oneTimeTotal : "—", daily: data ? dailyTotal : "—" })}</p>{data && <div className={s.balanceMeta}><span>{xumengFill(locale, "taskEarned", { earned: data.points.totalEarned })}</span><span>{text("taskEarnedNote")}</span></div>}</section>
    <section className={s.guest} aria-label={text("taskCheckinTitle")}><div><strong>{text("taskCheckinTitle")}</strong><p>{text("taskCheckinBody")}</p></div><button type="button" className={s.outline} onClick={() => onNavigate("checkin")}>{text("taskCheckinAction")}<Icon name="chevron" size={13} /></button></section>
    {isGuest && <section className={s.guest}><div><strong>{text("taskGuestTitle")}</strong><p>{text("taskGuestBody")}</p></div><button className={s.primary} onClick={onRequireAccount}>{text("taskGuestAction")}</button></section>}
    {error && <p className={s.error} role="alert">{error}</p>}{notice && <p className={s.notice} role="status">{notice}</p>}
    <div className={s.stats}><div><span>{text("taskStatAll")}</span><strong>{data ? orderedTasks.length : "—"}</strong></div><div><span>{text("taskStatClaimed")}</span><strong>{data ? claimed : "—"}</strong></div><div><span>{text("taskStatPending")}</span><strong className={s.pink}>{data ? `+${available.reduce((sum, task) => sum + task.rewardPoints, 0)}` : "—"}</strong></div></div>
    {data ? <section className={s.tasks} aria-label={text("taskHeading")}>{orderedTasks.map((task) => {
      const action = ROUTES[task.id];
      const copy = taskText(locale, task);
      return <article key={task.id} className={s.task} id={`task-${task.id}`} data-complete={task.claimed ? "true" : undefined}><div className={s.taskTop}><div className={s.taskIcon}><Icon name={action.icon} size={21} /></div><div className={s.taskTitle}><h2>{copy.title}</h2><span>{task.repeat === "daily" ? text("taskRepeatDaily") : text("taskRepeatOnce")}</span></div></div><div className={s.taskBody}><p>{copy.description}</p>{task.target > 1 && <div className={s.progress}><progress value={Math.min(task.progress, task.target)} max={task.target} aria-label={copy.title} /><span>{Math.min(task.progress, task.target)} / {task.target}</span></div>}</div><div className={s.taskFooter}><div className={s.taskMeta}><span className={s.reward}>+{task.rewardPoints} 金币</span><span>{task.repeat === "daily" ? (serverNow >= data.resetAt ? text("taskResetReady") : xumengFill(locale, "taskResetIn", { time: countdown(data.resetAt - serverNow) })) : text("taskOnceReward")}</span></div><div className={s.taskAction}>{task.claimed ? <span className={s.completed}><Icon name="check" size={14} />{text("taskStatusClaimed")}</span> : isGuest ? <button className={s.outline} onClick={onRequireAccount}>{text("taskLoginClaim")}</button> : task.claimable ? <button className={s.primary} disabled={working} onClick={() => void claim(task.id)}>{claiming === task.id ? text("taskClaiming") : text("taskClaim")}</button> : <button className={s.outline} disabled={working} onClick={() => onNavigate(action.view)}>{text(action.label)}<Icon name="chevron" size={13} /></button>}</div></div></article>;
    })}</section> : <section className={s.empty}><Icon name="trophy" size={28} /><p>{loading ? text("taskLoading") : text("taskUnavailable")}</p></section>}
    {data && <section className={s.history}><h2>{text("taskHistory")}</h2>{data.recentClaims.length ? <ul>{data.recentClaims.map((entry) => {
      const titled = data.tasks.find((task) => task.id === entry.taskId);
      const title = titled ? taskText(locale, titled).title : entry.taskId;
      return <li key={`${entry.taskId}:${entry.period}`}><div><strong>{title}</strong><small>{date(entry.claimedAt, locale)}{entry.expiresAt ? ` · ${xumengFill(locale, "taskExpires", { time: date(entry.expiresAt, locale) })}` : ` · ${text("taskPermanent")}`}</small></div><span>+{entry.points} 金币</span></li>;
    })}</ul> : <p>{text("taskHistoryEmpty")}</p>}</section>}
    <p className={s.resetNote}>{text("taskResetNote")}</p>
  </main>;
}
