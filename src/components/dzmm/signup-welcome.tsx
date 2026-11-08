"use client";

import { useEffect, useRef, useState } from "react";
import { fetchDzmmTasks, type DzmmTaskCenter } from "../../lib/dzmm-tasks";
import Icon from "./icons";
import s from "./account-modal.module.css";

type Props = { accountId: string; characterName: string; onStart: () => void; onTasks: () => void; onClose: () => void };
const points = (value: number) => value.toLocaleString("zh-CN");

export function SignupWelcome({ accountId, characterName, onStart, onTasks, onClose }: Props) {
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
      if (result.accountId !== accountId || result.isGuest) throw new Error("账号还在同步，请稍后再领取。");
      setData(result);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "领取失败，请稍后重试。");
    } finally { if (mounted.current) setClaiming(false); }
  }

  const starters = data?.tasks.filter(task => task.repeat === "once" && !task.claimed).slice(0, 3) ?? [];
  return <div className={s.overlay}>
    <div className={s.dialog} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="signup-welcome-title">
      <header><h2 id="signup-welcome-title">欢迎加入叙梦</h2><button type="button" onClick={onClose} aria-label="关闭欢迎窗口"><Icon name="close" /></button></header>
      {!data ? <>
        <p className={s.intro}>注册奖励 {gift === null ? "" : `${points(gift)} `}Credit 已为你准备好</p>
        <p className={s.hint}>领取后即可开始和「{characterName}」聊天。到账后长期有效。</p>
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.form}><button type="button" data-primary className={s.submit} disabled={claiming} onClick={() => void claim()}>{claiming ? "正在领取…" : "领取注册奖励"}</button></div>
      </> : <>
        <p className={s.intro}>已领取，当前可用 {points(data.points.balance)} Credit</p>
        {starters.length > 0 && <>
          <p className={s.hint}>新手任务还能继续领 Credit：</p>
          <ul className={s.welcomeTasks}>{starters.map(task => <li key={task.id}><span>{task.title}</span><strong>+{task.rewardPoints}</strong></li>)}</ul>
        </>}
        <div className={s.form}>
          <button type="button" data-primary className={s.submit} onClick={onStart}>开始使用「{characterName}」</button>
        </div>
        <footer><button type="button" onClick={onTasks}>查看全部新手任务<Icon name="chevron" size={13} /></button></footer>
      </>}
    </div>
  </div>;
}
