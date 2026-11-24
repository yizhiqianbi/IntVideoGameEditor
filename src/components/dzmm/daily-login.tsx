"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { claimDzmmTask, fetchDzmmTasks, type DzmmTaskCenter } from "../../lib/dzmm-tasks";
import { checkinRewards } from "../../lib/daily-checkin";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage, xumengPageFill } from "../../lib/xumeng-page-copy";
import Icon, { CoinIcon } from "./icons";
import s from "./daily-login.module.css";

type Props = {
  userId: string; isGuest: boolean; locale?: XumengLocale;
  onRequireAccount: () => void; onCreditChanged?: () => void; onViewAll?: () => void;
  compact?: boolean;
};

const points = (value: number) => value.toLocaleString("zh-CN");

/** Tipsy-style seven-day login streak card: claim today's Coins in one tap. */
export function DailyLogin({ userId, isGuest, locale = "zh-Hans", onRequireAccount, onCreditChanged, onViewAll, compact = false }: Props) {
  const copy = xumengPage(locale);
  const [data, setData] = useState<DzmmTaskCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  const account = useRef(userId);
  account.current = userId;

  const load = useCallback(async () => {
    if (isGuest) { setLoading(false); setError(""); setData(null); return; }
    setLoading(true); setError("");
    try {
      const tasks = await fetchDzmmTasks();
      if (!active.current || account.current !== userId) return;
      if (tasks.accountId !== userId) throw new Error(copy.accountSwitched);
      setData(tasks);
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : copy.checkinUnavailable);
    } finally { if (active.current) setLoading(false); }
  }, [isGuest, userId, copy.accountSwitched, copy.checkinUnavailable]);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
  useEffect(() => {
    const reload = () => { void load(); };
    window.addEventListener("xumeng:checkin-claimed", reload);
    return () => window.removeEventListener("xumeng:checkin-claimed", reload);
  }, [load]);

  const checkin = data?.checkin;
  const task = data?.tasks.find(entry => entry.id === "daily_checkin");
  const claimed = Boolean(checkin?.claimedToday ?? task?.claimed);
  const day = checkin?.day ?? 1;
  const rewards = checkin?.rewards ?? checkinRewards();
  const todayReward = checkin?.todayReward ?? task?.rewardPoints ?? 0;

  async function claim() {
    if (claiming || loading) return;
    if (isGuest) { onRequireAccount(); return; }
    setClaiming(true); setError(""); setNotice("");
    try {
      const result = await claimDzmmTask("daily_checkin", userId);
      if (!active.current || account.current !== userId) return;
      setData(result);
      setNotice(xumengPageFill(copy.checkinDoneNotice, { points: points(result.claim.points) }));
      onCreditChanged?.();
    } catch (failure) {
      if (active.current) { setError(failure instanceof Error ? failure.message : copy.checkinUnavailable); void load(); }
    } finally { if (active.current) setClaiming(false); }
  }

  return <section className={`${s.card} ${compact ? s.compact : ""}`} aria-label={copy.dailyLoginTitle}>
    <header className={s.head}>
      <div className={s.title}>
        <span className={s.sun} aria-hidden="true"><Icon name="sun" size={17} /></span>
        <div>
          <h2>{copy.dailyLoginTitle}</h2>
          <p>{isGuest ? copy.dailyLoginGuest : xumengPageFill(copy.dailyLoginStreak, { days: checkin?.streak ?? 0 })}</p>
        </div>
      </div>
      {onViewAll && <button type="button" className={s.more} onClick={onViewAll}>{copy.dailyLoginViewAll}<Icon name="chevron" size={13} /></button>}
    </header>

    <ol className={s.days} aria-label={copy.dailyLoginTitle}>
      {Array.from({ length: 7 }, (_, index) => {
        const dayNumber = index + 1;
        const reward = rewards[index] ?? 0;
        const isToday = dayNumber === day;
        const done = isToday ? claimed : dayNumber < day;
        return <li key={dayNumber} className={`${s.day} ${isToday ? s.today : ""} ${done ? s.done : ""}`}>
          <span className={s.dayLabel}>{xumengPageFill(copy.dailyLoginDay, { day: dayNumber })}</span>
          <strong className={s.reward}><CoinIcon size={14} />+{reward}</strong>
          <span className={s.mark}>{done ? <Icon name="check" size={12} /> : isToday ? copy.today : ""}</span>
        </li>;
      })}
    </ol>

    {error && <p className={s.error} role="alert">{error}</p>}
    {notice && <p className={s.notice} role="status">{notice}</p>}

    <div className={s.actions}>
      {isGuest
        ? <button type="button" className={s.primary} onClick={onRequireAccount}>{copy.loginCheckin}</button>
        : claimed
          ? <span className={s.claimed}><Icon name="check" size={14} />{copy.dailyLoginClaimed}</span>
          : <button type="button" className={s.primary} disabled={loading || claiming || !todayReward} onClick={() => void claim()}>
            {claiming ? copy.checkingIn : xumengPageFill(copy.dailyLoginClaim, { points: points(todayReward) })}
          </button>}
    </div>
  </section>;
}

export default DailyLogin;
