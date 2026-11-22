"use client";

import { useEffect, useRef, useState } from "react";
import { claimDzmmTask, fetchDzmmTasks, type DzmmTaskCenter } from "../../lib/dzmm-tasks";
import { checkinRewards } from "../../lib/daily-checkin";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage, xumengPageFill } from "../../lib/xumeng-page-copy";
import Icon, { CoinIcon } from "./icons";
import s from "./checkin-modal.module.css";

type Props = {
  userId: string; locale?: XumengLocale;
  onClose: () => void; onClaimed: (points: number) => void;
};

const points = (value: number) => value.toLocaleString("zh-CN");

/**
 * Daily login reward sheet. Opens once per Beijing day for signed-in accounts
 * that have not claimed yet; claiming updates the coin wallet in place.
 */
export function CheckinModal({ userId, locale = "zh-Hans", onClose, onClaimed }: Props) {
  const copy = xumengPage(locale);
  const [data, setData] = useState<DzmmTaskCenter | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [claimedPoints, setClaimedPoints] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const closed = useRef(false);
  useEffect(() => { close.current = onClose; }, [onClose]);

  const finish = () => {
    if (closed.current) return;
    closed.current = true;
    close.current();
  };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const original = body.style.overflow;
    body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") finish();
      if (event.key !== "Tab" || !dialog.current) return;
      const controls = dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]");
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      body.style.overflow = original;
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    void fetchDzmmTasks().then(tasks => {
      if (!live) return;
      setData(tasks);
      if (tasks.checkin?.claimedToday) {
        // Nothing to claim: close instead of showing a dead-end dialog.
        closed.current = true;
        close.current();
        return;
      }
    }).catch(failure => {
      if (live) setError(failure instanceof Error ? failure.message : copy.checkinUnavailable);
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [copy.checkinUnavailable]);

  async function claim() {
    if (claiming) return;
    setClaiming(true); setError("");
    try {
      const result = await claimDzmmTask("daily_checkin", userId);
      if (result.accountId !== userId) return;
      setData(result);
      setClaimedPoints(result.claim.points);
      setClaimed(true);
      onClaimed(result.claim.points);
      window.dispatchEvent(new CustomEvent("xumeng:checkin-claimed", { detail: { points: result.claim.points } }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.checkinUnavailable);
    } finally { setClaiming(false); }
  }

  const checkin = data?.checkin;
  const rewards = checkin?.rewards ?? checkinRewards();
  const day = checkin?.day ?? 1;
  const streak = checkin?.streak ?? 0;
  const todayReward = checkin?.todayReward ?? rewards[0];

  return <div className={s.overlay} role="presentation" onClick={event => { if (event.target === event.currentTarget) finish(); }}>
    <div className={s.sheet} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="checkin-modal-title" aria-describedby="checkin-modal-desc">
      <div className={s.aurora} aria-hidden="true" />
      <button type="button" className={s.close} onClick={finish} aria-label={copy.close}><Icon name="close" size={16} /></button>
      <header className={s.header}>
        <span className={s.eyebrow}><Icon name="sun" size={13} />{copy.dailyCheckin}</span>
        <h2 id="checkin-modal-title">{claimed ? copy.checkinModalTitleDone : copy.checkinModalTitle}</h2>
        <p id="checkin-modal-desc">
          {streak > 0 ? xumengPageFill(copy.checkinModalStreak, { days: streak }) : ""}
          {claimed ? copy.checkinModalDescDone : copy.checkinModalDesc}
        </p>
      </header>

      <ol className={s.days} aria-label={copy.dailyLoginViewAll}>
        {rewards.map((reward, index) => {
          const dayNumber = index + 1;
          const isToday = dayNumber === day;
          const done = dayNumber < day || isToday && claimed;
          return <li key={dayNumber} className={`${s.day} ${isToday ? s.today : ""} ${done ? s.done : ""} ${dayNumber === 7 ? s.final : ""}`}>
            <span className={s.dayLabel}>{xumengPageFill(copy.dailyLoginDay, { day: dayNumber })}</span>
            <span className={s.coin} aria-hidden="true"><CoinIcon size={16} /></span>
            <strong className={s.amount}>+{reward}</strong>
            {done ? <span className={s.tick}><Icon name="check" size={11} /></span> : isToday ? <span className={s.todayTag}>{copy.today}</span> : <span className={s.future} />}
          </li>;
        })}
      </ol>

      {error && <p className={s.error} role="alert">{error}</p>}

      {claimed ? <div className={s.success} role="status">
        <div className={s.burst} aria-hidden="true"><span /><span /><span /></div>
        <strong className={s.gained}>+{points(claimedPoints)}</strong>
        <span className={s.gainedLabel}>{copy.checkinModalSaved}</span>
        <p>{xumengPageFill(copy.checkinModalNext, { day: (day % 7) + 1 })}</p>
        <button type="button" className={s.primary} onClick={finish}>{copy.checkinContinue}</button>
      </div> : <div className={s.footer}>
        <button type="button" className={s.primary} disabled={loading || claiming || !todayReward} onClick={() => void claim()}>
          {claiming ? copy.checkingIn : loading ? copy.reading : xumengPageFill(copy.dailyLoginClaim, { points: points(todayReward) })}
        </button>
        <p>{copy.checkinModalFooter}</p>
      </div>}
    </div>
  </div>;
}

export default CheckinModal;
