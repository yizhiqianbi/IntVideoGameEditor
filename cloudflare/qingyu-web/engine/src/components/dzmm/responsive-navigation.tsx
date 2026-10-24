"use client";

import { useEffect, useId, useRef, useState } from "react";
import Icon, { type IconName } from "./icons";
import styles from "./tavern.module.css";
import { xumengTranslate, type XumengLocale } from "@/lib/xumeng-i18n";

type NavigationItem<T extends string> = { view: T; label: string; icon: IconName };

export default function ResponsiveNavigation<T extends string>({
  items, tools, currentView, onNavigate,
  locale = "zh-Hans",
}: {
  items: NavigationItem<T>[];
  tools: NavigationItem<T>[];
  currentView: string;
  onNavigate: (target: T) => boolean;
  locale?: XumengLocale;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const focusedInside = root.current?.contains(document.activeElement);
      setOpen(false);
      if (focusedInside) { event.preventDefault(); trigger.current?.focus(); }
    };
    const wide = window.matchMedia("(min-width: 1280px)");
    const resize = () => { if (wide.matches) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    wide.addEventListener("change", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      wide.removeEventListener("change", resize);
    };
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const links = (entries: NavigationItem<T>[]) => entries.map(item => (
    <a key={item.view} href={`#${item.view}`} aria-current={currentView === item.view ? "page" : undefined}
      className={currentView === item.view ? styles.navActive : ""}
      onClick={event => {
        event.preventDefault();
        if (onNavigate(item.view)) close();
      }}>
      <Icon name={item.icon} size={19} /><span>{item.label}</span>
    </a>
  ));

  return <div className={styles.navDisclosure} ref={root}
    onBlur={event => {
      if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
    <button type="button" ref={trigger} className={styles.navTrigger} aria-label={open ? xumengTranslate(locale, "closeNavigation") : xumengTranslate(locale, "mobileMenu")}
      aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(previous => !previous)}>
      <Icon name={open ? "close" : "grid"} size={18} /><span>{xumengTranslate(locale, "mobileMenu")}</span>
    </button>
    {open && <div id={panelId} className={styles.navPanel}>
      <div className={styles.navPanelHeading}><strong>{xumengTranslate(locale, "allFeatures")}</strong><button type="button" aria-label={xumengTranslate(locale, "closeNavigation")} onClick={close}><Icon name="close" size={18} /></button></div>
      <nav aria-label={xumengTranslate(locale, "allFeatures")}>
        <p className={styles.navGroupLabel}>{xumengTranslate(locale, "mainFeatures")}</p><div className={styles.navGrid}>{links(items)}</div>
        <p className={styles.navGroupLabel}>{xumengTranslate(locale, "moreTools")}</p><div className={styles.navGrid}>{links(tools)}</div>
      </nav>
    </div>}
  </div>;
}
