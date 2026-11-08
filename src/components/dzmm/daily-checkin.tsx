"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { claimDzmmTask, fetchDzmmTasks, type DzmmTaskCenter } from "../../lib/dzmm-tasks";
import { fetchDzmmPaymentConfig, type DzmmPaymentConfig } from "../../lib/dzmm-payments";
import Icon from "./icons";
import { SubscriptionCenter } from "./subscription-center";
import s from "./recharge.module.css";

type Props = { userId: string; isGuest: boolean; onRequireAccount: () => void; onBack?: () => void; onTasks: () => void };
const points = (value: number) => value.toLocaleString("zh-CN");
const errorText = (error: unknown) => error instanceof Error ? error.message : "签到服务暂时不可用，请稍后再试。";

export function DailyCheckin({ userId, isGuest, onRequireAccount, onBack, onTasks }: Props) {
  const [data, setData] = useState<DzmmTaskCenter | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<DzmmPaymentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const generation = useRef(0);
  const account = useRef(userId);
  account.current = userId;

  const reload = useCallback(async () => {
    const epoch = ++generation.current;
    setLoading(true); setError("");
    try {
      const [tasks, config] = await Promise.all([fetchDzmmTasks(), fetchDzmmPaymentConfig().catch(() => null)]);
      if (!mounted.current || epoch !== generation.current || account.current !== userId) return;
      if (tasks.accountId !== userId) throw new Error("账户已切换，请刷新页面。");
      setData(tasks); setPaymentConfig(config); setRefreshKey(value => value + 1);
    } catch (failure) { if (mounted.current && epoch === generation.current) setError(errorText(failure)); }
    finally { if (mounted.current && epoch === generation.current) setLoading(false); }
  }, [userId]);
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; }; }, [reload]);

  async function claim() {
    if (claiming || loading) return;
    if (isGuest) { onRequireAccount(); return; }
    setClaiming(true); setError(""); setNotice("");
    const id = userId;
    try {
      const result = await claimDzmmTask("daily_checkin", id);
      if (!mounted.current || account.current !== id) return;
      setData(result); setNotice(`签到成功，已领取 ${points(result.claim.points)} Credit。`);
    } catch (failure) {
      if (mounted.current && account.current === id) { setError(errorText(failure)); void reload(); }
    } finally { if (mounted.current) setClaiming(false); }
  }

  const task = data?.tasks.find(entry => entry.id === "daily_checkin");
  return <main className={s.page}>
    <header className={s.header}>
      <div>
        {onBack && <button type="button" className={s.back} onClick={onBack}><Icon name="back" size={15} />返回</button>}
        <h1>每日签到</h1>
        <p>每天签到领取 Credit，北京时间 00:00 重置，当天未签不能补签。</p>
      </div>
      <button type="button" className={s.outline} disabled={loading || claiming} onClick={() => void reload()}>{loading ? "读取中…" : "刷新"}</button>
    </header>

    <section className={s.balance} aria-label="可用 Credit">
      <span>可用 Credit</span>
      <strong>{data && !isGuest ? points(data.points.balance) : "—"}<small>Credit</small></strong>
      <p>签到、任务奖励和会员每日领取都计入同一余额。</p>
    </section>

    {error && <p className={s.error} role="alert">{error}</p>}
    {notice && <p className={s.notice} role="status">{notice}</p>}

    <section className={s.guest} aria-label="每日签到" id="daily-checkin">
      <div>
        <strong>{task?.claimed ? "今日已签到" : "今日签到"}{task ? ` · +${points(task.rewardPoints)} Credit` : ""}</strong>
        <p>{isGuest ? "注册或登录后签到，Credit 保存在你的账户里。" : task?.claimed ? "明天再来领取。" : "每天一次，当天未签到不补发。"}</p>
      </div>
      {isGuest ? <button type="button" className={s.primary} onClick={onRequireAccount}>登录签到</button>
        : task?.claimed ? <span className={s.paid}><Icon name="check" size={14} /> 已领取</span>
        : <button type="button" className={s.primary} disabled={loading || claiming || !task?.claimable} onClick={() => void claim()}>{claiming ? "签到中…" : "签到领取"}</button>}
    </section>

    {!isGuest && <SubscriptionCenter checkinOnly userId={userId} isGuest={isGuest} paymentConfig={paymentConfig} refreshKey={refreshKey}
      onRequireAccount={onRequireAccount} onCreditChanged={() => { void reload(); }} />}

    <section className={s.guest}>
      <div><strong>新手任务</strong><p>完善资料、第一次聊天等任务还能领取更多 Credit。</p></div>
      <button type="button" className={s.outline} onClick={onTasks}>查看任务<Icon name="chevron" size={13} /></button>
    </section>
  </main>;
}
