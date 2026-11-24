"use client";

import { useEffect, useRef, useState } from "react";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage, xumengPageFill } from "../../lib/xumeng-page-copy";
import Icon from "./icons";
import s from "./account-modal.module.css";

type Props = { accountId: string; characterName: string; locale?: XumengLocale; onStart: () => void; onTasks: () => void; onClose: () => void };
const points = (value: number) => value.toLocaleString("zh-CN");

export function SignupWelcome({ characterName, locale = "zh-Hans", onStart, onTasks, onClose }: Props) {
  const copy = xumengPage(locale);
  const [gift, setGift] = useState<number | null>(null);
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

  return <div className={s.overlay}>
    <div className={s.dialog} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="signup-welcome-title">
      <header><h2 id="signup-welcome-title">{copy.welcomeTitle}</h2><button type="button" onClick={onClose} aria-label={copy.closeWelcome}><Icon name="close" /></button></header>
      <p className={s.intro}>{xumengPageFill(copy.welcomeStart, { name: characterName })}</p>
      {gift !== null && <p className={s.hint}>{xumengPageFill(copy.welcomeGiftLanded, { gift: points(gift) })}</p>}
      <div className={s.form}>
        <button type="button" data-primary className={s.submit} onClick={onStart}>{xumengPageFill(copy.startWith, { name: characterName })}</button>
      </div>
      <footer><button type="button" onClick={onTasks}>{copy.moreCoins}<Icon name="chevron" size={13} /></button></footer>
    </div>
  </div>;
}
