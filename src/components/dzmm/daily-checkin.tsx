"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { claimDzmmTask, fetchDzmmTasks, type DzmmTaskCenter } from "../../lib/dzmm-tasks";
import { fetchDzmmPaymentConfig, type DzmmPaymentConfig } from "../../lib/dzmm-payments";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage, xumengPageFill } from "../../lib/xumeng-page-copy";
import Icon from "./icons";
import { SubscriptionCenter } from "./subscription-center";
import s from "./recharge.module.css";

type Props = { userId: string; isGuest: boolean; locale?: XumengLocale; onRequireAccount: () => void; onBack?: () => void; onTasks: () => void };
const points = (value: number) => value.toLocaleString("zh-CN");

export function DailyCheckin({ userId, isGuest, locale = "zh-Hans", onRequireAccount, onBack, onTasks }: Props) {
  const copy = xumengPage(locale);
  const errorText = (error: unknown) => error instanceof Error ? error.message : copy.checkinUnavailable;
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
      if (tasks.accountId !== userId) throw new Error(copy.accountSwitched);
      setData(tasks); setPaymentConfig(config); setRefreshKey(value => value + 1);
    } catch (failure) { if (mounted.current && epoch === generation.current) setError(errorText(failure)); }
    finally { if (mounted.current && epoch === generation.current) setLoading(false); }
  }, [userId, copy.accountSwitched, copy.checkinUnavailable]);
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; }; }, [reload]);

  async function claim() {
    if (claiming || loading) return;
    if (isGuest) { onRequireAccount(); return; }
    setClaiming(true); setError(""); setNotice("");
    const id = userId;
    try {
      const result = await claimDzmmTask("daily_checkin", id);
      if (!mounted.current || account.current !== id) return;
      setData(result); setNotice(xumengPageFill(copy.checkinDoneNotice, { points: points(result.claim.points) }));
    } catch (failure) {
      if (mounted.current && account.current === id) { setError(errorText(failure)); void reload(); }
    } finally { if (mounted.current) setClaiming(false); }
  }

  const task = data?.tasks.find(entry => entry.id === "daily_checkin");
  return <main className={s.page}>
    <header className={s.header}>
      <div>
        {onBack && <button type="button" className={s.back} onClick={onBack}><Icon name="back" size={15} />{copy.back}</button>}
        <h1>{copy.dailyCheckin}</h1>
        <p>{copy.checkinLead}</p>
      </div>
      <button type="button" className={s.outline} disabled={loading || claiming} onClick={() => void reload()}>{loading ? copy.reading : copy.refresh}</button>
    </header>

    <section className={s.balance} aria-label={copy.availableCredit}>
      <span>{copy.availableCredit}</span>
      <strong>{data && !isGuest ? points(data.points.balance) : "—"}<small>Credit</small></strong>
      <p>{copy.sameBalance}</p>
    </section>

    {error && <p className={s.error} role="alert">{error}</p>}
    {notice && <p className={s.notice} role="status">{notice}</p>}

    <section className={s.guest} aria-label={copy.dailyCheckin} id="daily-checkin">
      <div>
        <strong>{task?.claimed ? copy.checkedToday : copy.checkinToday}{task ? ` · +${points(task.rewardPoints)} Credit` : ""}</strong>
        <p>{isGuest ? copy.checkinGuest : task?.claimed ? copy.comeTomorrow : copy.onceADay}</p>
      </div>
      {isGuest ? <button type="button" className={s.primary} onClick={onRequireAccount}>{copy.loginCheckin}</button>
        : task?.claimed ? <span className={s.paid}><Icon name="check" size={14} /> {copy.claimed}</span>
        : <button type="button" className={s.primary} disabled={loading || claiming || !task?.claimable} onClick={() => void claim()}>{claiming ? copy.checkingIn : copy.claimCheckin}</button>}
    </section>

    {!isGuest && <SubscriptionCenter checkinOnly userId={userId} isGuest={isGuest} paymentConfig={paymentConfig} refreshKey={refreshKey}
      onRequireAccount={onRequireAccount} onCreditChanged={() => { void reload(); }} />}

    <section className={s.guest}>
      <div><strong>{copy.starterTasks}</strong><p>{copy.starterMore}</p></div>
      <button type="button" className={s.outline} onClick={onTasks}>{copy.viewTasks}<Icon name="chevron" size={13} /></button>
    </section>
  </main>;
}
