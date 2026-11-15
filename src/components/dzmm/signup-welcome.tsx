"use client";

import { useEffect, useRef, useState } from "react";
import { fetchDzmmTasks, type DzmmTaskCenter } from "../../lib/dzmm-tasks";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage, xumengPageFill } from "../../lib/xumeng-page-copy";
import Icon from "./icons";
import s from "./account-modal.module.css";

type Props = { accountId: string; characterName: string; locale?: XumengLocale; onStart: () => void; onTasks: () => void; onClose: () => void };
const points = (value: number) => value.toLocaleString("zh-CN");

export function SignupWelcome({ accountId, characterName, locale = "zh-Hans", onStart, onTasks, onClose }: Props) {
  const copy = xumengPage(locale);
  const [gift, setGift] = useState<number | null>(null);
  const [data, setData] = useState<DzmmTaskCenter | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void fetch("/api/backend/v1/auth/signup/config", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = response.ok ? await response.json() : null;
      if (mounted.current && value?.enabled === true && Number.isSafeInteger(value.credits)) setGift(value.credits);
    }).catch(() => { /* The welcome still works without the gift amount. */ });
    dialog.current?.querySelector<HTMLButtonElement>("button[data-primary]")?.focus();
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  async function claim() {
    if (claiming) return;
    setClaiming(true); setError("");
    try {
      const result = await fetchDzmmTasks();
      if (!mounted.current) return;
      if (result.accountId !== accountId || result.isGuest) throw new Error(copy.syncingAccount);
      setData(result);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : copy.claimFailed);
    } finally { if (mounted.current) setClaiming(false); }
  }

  const starters = data?.tasks.filter(task => task.repeat === "once" && !task.claimed).slice(0, 3) ?? [];
  return <div className={s.overlay}>
    <div className={s.dialog} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="signup-welcome-title">
      <header><h2 id="signup-welcome-title">{copy.welcomeTitle}</h2><button type="button" onClick={onClose} aria-label={copy.closeWelcome}><Icon name="close" /></button></header>
      {!data ? <>
        <p className={s.intro}>{gift === null ? copy.welcomeReady : xumengPageFill(copy.welcomeGift, { gift: `${points(gift)} ` })}</p>
        <p className={s.hint}>{xumengPageFill(copy.welcomeHint, { name: characterName })}</p>
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.form}><button type="button" data-primary className={s.submit} disabled={claiming} onClick={() => void claim()}>{claiming ? copy.claiming : copy.claimSignup}</button></div>
      </> : <>
        <p className={s.intro}>{xumengPageFill(copy.claimedBalance, { balance: points(data.points.balance) })}</p>
        {starters.length > 0 && <>
          <p className={s.hint}>{copy.moreStarter}</p>
          <ul className={s.welcomeTasks}>{starters.map(task => <li key={task.id}><span>{task.title}</span><strong>+{task.rewardPoints}</strong></li>)}</ul>
        </>}
        <div className={s.form}>
          <button type="button" data-primary className={s.submit} onClick={onStart}>{xumengPageFill(copy.startWith, { name: characterName })}</button>
        </div>
        <footer><button type="button" onClick={onTasks}>{copy.viewAllTasks}<Icon name="chevron" size={13} /></button></footer>
      </>}
    </div>
  </div>;
}
