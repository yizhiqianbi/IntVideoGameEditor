"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { claimDzmmTask, fetchDzmmTasks, type DzmmTaskCenter, type DzmmTaskId } from "../../lib/dzmm-tasks";
import Icon, { type IconName } from "./icons";
import s from "./task-center.module.css";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";

type Destination = "chat" | "studio" | "characters" | "profile" | "forum" | "recharge";
type Props = { userId: string; isGuest: boolean; onNavigate: (view: Destination) => void; onRequireAccount: () => void; beforeRefresh?: () => Promise<void> };
const ROUTES: Record<DzmmTaskId, { view: Destination; icon: IconName; label: string }> = {
  daily_checkin: { view: "recharge", icon: "sun", label: "去签到" },
  first_conversation: { view: "chat", icon: "chat", label: "去聊天" },
  publish_character: { view: "studio", icon: "edit", label: "去创作" },
  follow_authors: { view: "characters", icon: "users", label: "去发现" },
  complete_profile: { view: "profile", icon: "user", label: "去完善" },
  forum_reply: { view: "forum", icon: "compass", label: "去论坛" },
};
const TASK_ORDER: DzmmTaskId[] = ["complete_profile", "first_conversation", "follow_authors", "forum_reply", "publish_character", "daily_checkin"];
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const errorText = (error: unknown) => error instanceof Error ? error.message : "任务请求失败，请稍后再试。";
function countdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TaskCenter({ userId, isGuest, onNavigate, onRequireAccount, beforeRefresh }: Props) {
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
      if (result.accountId !== userId) throw new Error("账户已切换，请刷新页面后查看当前任务。");
      setData(result); setClock({ now: Date.now(), offset: result.serverTime - Date.now() });
    } catch (failure) { if (mounted.current && epoch === generation.current) setError(errorText(failure)); }
    finally { if (mounted.current && epoch === generation.current) setLoading(false); }
  }, [userId]);
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
      if (result.accountId !== id) throw new Error("账户已切换，请刷新页面。");
      setData(result); setClock({ now: Date.now(), offset: result.serverTime - Date.now() });
      setNotice(`已领取 ${result.claim.points} Credit。`);
    } catch (failure) {
      if (mounted.current && account.current === id) {
        setError(errorText(failure));
        try { const latest = await fetchDzmmTasks(); if (mounted.current && account.current === id && latest.accountId === id) { setData(latest); setClock({ now: Date.now(), offset: latest.serverTime - Date.now() }); } } catch { /* Keep the first meaningful error. */ }
      }
    } finally { pending.current = false; if (mounted.current && account.current === id) setClaiming(null); }
  }
  const working = loading || claiming !== null;
  const orderedTasks = data ? [...data.tasks].sort((a, b) => TASK_ORDER.indexOf(a.id) - TASK_ORDER.indexOf(b.id)) : [];
  const available = orderedTasks.filter((task) => task.claimable);
  const claimed = orderedTasks.filter((task) => task.claimed).length;
  const oneTimeTasks = orderedTasks.filter((task) => task.repeat === "once");
  const oneTimeClaimed = oneTimeTasks.filter((task) => task.claimed).length;
  const oneTimeTotal = oneTimeTasks.reduce((sum, task) => sum + task.rewardPoints, 0);
  const dailyTotal = orderedTasks.filter((task) => task.repeat === "daily").reduce((sum, task) => sum + task.rewardPoints, 0);
  const serverNow = clock.now + clock.offset;
  return <main className={s.page}>
    <header className={s.header}><div><span className={s.eyebrow}>晴屿 · 新手引导</span><h1>新手任务</h1><p>完成第一次探索，领取 Credit，让故事从第一句话开始。</p></div><button className={s.refresh} disabled={working} onClick={() => void reload()}><Icon name="refresh" size={16} />{loading ? "刷新中…" : "刷新进度"}</button></header>
    <section className={s.balance} aria-label="聊天 Credit 奖励"><div className={s.balanceTop}><div><span>可用聊天 Credit</span><strong>{data ? data.points.balance : "—"}<small>Credit</small></strong></div><div className={s.balanceProgress}><span>新手进度</span><strong>{data ? `${oneTimeClaimed} / ${oneTimeTasks.length}` : "—"}</strong><progress value={oneTimeClaimed} max={Math.max(oneTimeTasks.length, 1)} aria-label="新手任务进度" /></div></div><p>完成 {oneTimeTasks.length || "—"} 项一次性任务可得 <b>+{data ? oneTimeTotal : "—"} Credit</b>，每日签到再领 <b>+{data ? dailyTotal : "—"}</b>。</p>{data && <div className={s.balanceMeta}><span>累计获得 {data.points.totalEarned} Credit</span><span>奖励直接计入聊天余额</span></div>}</section>
    <section className={s.guest} aria-label="订阅 Credit 签到入口"><div><strong>订阅每日 Credit</strong><p>{XUMENG_PAYMENTS_ENABLED ? "月订阅签到发放 Credit，与任务奖励一并计入聊天余额。" : "收款暂时关闭，已有会员仍可查看并领取已生效权益。"}</p></div>{XUMENG_PAYMENTS_ENABLED ? <button type="button" className={s.outline} onClick={() => onNavigate("recharge")}>订阅与 Credit 签到<Icon name="chevron" size={13} /></button> : <button type="button" className={s.outline} onClick={() => onNavigate("recharge")}>查看已有会员权益<Icon name="chevron" size={13} /></button>}</section>
    {isGuest && <section className={s.guest}><div><strong>登录后开启任务奖励</strong><p>游客可以查看任务；注册账号后，完成的进度和 Credit 会保存在你的账户。</p></div><button className={s.primary} onClick={onRequireAccount}>注册或登录</button></section>}
    {error && <p className={s.error} role="alert">{error}</p>}{notice && <p className={s.notice} role="status">{notice}</p>}
    <div className={s.stats}><div><span>全部任务</span><strong>{data?.tasks.length ?? "—"}</strong></div><div><span>已领取</span><strong>{data ? claimed : "—"}</strong></div><div><span>待领取 Credit</span><strong className={s.pink}>{data ? `+${available.reduce((sum, task) => sum + task.rewardPoints, 0)}` : "—"}</strong></div></div>
    {data ? <section className={s.tasks} aria-label="新手任务列表">{orderedTasks.map((task) => {
      const action = ROUTES[task.id];
      return <article key={task.id} className={s.task} id={`task-${task.id}`} data-complete={task.claimed ? "true" : undefined}><div className={s.taskTop}><div className={s.taskIcon}><Icon name={action.icon} size={21} /></div><div className={s.taskTitle}><h2>{task.title}</h2><span>{task.repeat === "daily" ? "每日" : "一次性"}</span></div></div><div className={s.taskBody}><p>{task.description}</p>{task.target > 1 && <div className={s.progress}><progress value={Math.min(task.progress, task.target)} max={task.target} aria-label={`${task.title}进度`} /><span>{Math.min(task.progress, task.target)} / {task.target}</span></div>}</div><div className={s.taskFooter}><div className={s.taskMeta}><span className={s.reward}>+{task.rewardPoints} Credit</span><span>{task.repeat === "daily" ? (serverNow >= data.resetAt ? "已重置，请刷新" : `${countdown(data.resetAt - serverNow)} 后重置`) : "一次性奖励"}</span></div><div className={s.taskAction}>{task.claimed ? <span className={s.completed}><Icon name="check" size={14} />已领取</span> : isGuest ? <button className={s.outline} onClick={onRequireAccount}>登录领取</button> : task.claimable ? <button className={s.primary} disabled={working} onClick={() => void claim(task.id)}>{claiming === task.id ? "领取中…" : "领取奖励"}</button> : <button className={s.outline} disabled={working} onClick={() => onNavigate(action.view)}>{action.label}<Icon name="chevron" size={13} /></button>}</div></div></article>;
    })}</section> : <section className={s.empty}><Icon name="trophy" size={28} /><p>{loading ? "正在读取任务进度…" : "任务暂时不可用，点击刷新重试。"}</p></section>}
    {data && <section className={s.history}><h2>领取记录</h2>{data.recentClaims.length ? <ul>{data.recentClaims.map((entry) => <li key={`${entry.taskId}:${entry.period}`}><div><strong>{data.tasks.find((task) => task.id === entry.taskId)?.title || entry.taskId}</strong><small>{date(entry.claimedAt)}{entry.expiresAt ? ` · ${date(entry.expiresAt)} 到期` : " · 长期有效"}</small></div><span>+{entry.points} Credit</span></li>)}</ul> : <p>还没有领取记录。完成一个任务，开始积累你的 Credit。</p>}</section>}
    <p className={s.resetNote}>每日任务在北京时间 08:00（UTC 00:00）重置。页面显示的奖励以服务器记录为准。</p>
  </main>;
}
