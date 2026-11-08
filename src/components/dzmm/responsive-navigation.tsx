"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon, { type IconName } from "./icons";
import styles from "./tavern.module.css";
import { xumengTranslate, type XumengLocale } from "@/lib/xumeng-i18n";

type NavigationItem<T extends string> = { view: T; label: string; icon: IconName };

export default function ResponsiveNavigation<T extends string>({
  items, tools, currentView, onNavigate, onHome, footer,
  locale = "zh-Hans",
}: {
  items: NavigationItem<T>[];
  tools: NavigationItem<T>[];
  currentView: string;
  onNavigate: (target: T) => boolean;
  onHome?: () => boolean;
  footer?: ReactNode;
  locale?: XumengLocale;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const inside = (node: Node | null) => Boolean(node && (root.current?.contains(node) || portal.current?.contains(node)));
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !inside(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const focusedInside = inside(document.activeElement);
      setOpen(false);
      if (focusedInside) { event.preventDefault(); trigger.current?.focus(); }
    };
    const wide = window.matchMedia("(min-width: 1280px)");
    const resize = () => { if (wide.matches) setOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    wide.addEventListener("change", resize);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      wide.removeEventListener("change", resize);
    };
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const links = (entries: NavigationItem<T>[]) => entries.map(item => (
    <a key={item.view} href={`#${item.view}`} aria-current={currentView === item.view ? "page" : undefined}
      onClick={event => {
        event.preventDefault();
        if (onNavigate(item.view)) close();
      }}>
      <Icon name={item.icon} size={22} /><span>{item.label}</span>
    </a>
  ));

  return <div className={styles.navDisclosure} ref={root}>
    <button type="button" ref={trigger} className={styles.navTrigger}
      aria-label={open ? xumengTranslate(locale, "closeNavigation") : xumengTranslate(locale, "mobileMenu")}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => setOpen(value => !value)}>
      <span className={styles.navBurger} aria-hidden="true"><i /><i /><i /></span>
      <span className={styles.navTriggerLabel}>{xumengTranslate(locale, "mobileMenu")}</span>
    </button>
    {open && createPortal(
      <div ref={portal} className={styles.navOverlay}>
        <button type="button" className={styles.navBackdrop} tabIndex={-1} aria-label={xumengTranslate(locale, "closeNavigation")} onClick={close} />
        <div id={panelId} className={styles.navDrawer} role="dialog" aria-modal="true" aria-label={xumengTranslate(locale, "allFeatures")}>
          <button type="button" ref={closeButton} className={styles.navClose} aria-label={xumengTranslate(locale, "closeNavigation")} onClick={close}>
            <Icon name="close" size={18} />
          </button>
          <a className={styles.navBrand} href="#characters" onClick={event => {
            event.preventDefault();
            if (!onHome || onHome()) close();
          }}>
            <img src="/assets/xumeng/brand/xumeng-mark.svg" width="36" height="36" alt="" />
            <span>叙梦<small>XUMENG</small></span>
          </a>
          <nav className={styles.navList} aria-label={xumengTranslate(locale, "allFeatures")}>
            {links(items)}
            <div className={styles.navDivider} role="separator" />
            {links(tools)}
          </nav>
          {footer && <div className={styles.navDrawerFooter}>{footer}</div>}
        </div>
      </div>,
      document.body,
    )}
  </div>;
}
