"use client";

/* eslint-disable @next/next/no-img-element -- This component also ships in the standalone Vite Worker; its local PNG is already sized. */

import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { xumengPage } from "../../lib/xumeng-page-copy";
import styles from "./install-app.module.css";

type Platform = "ios" | "android" | "desktop";
type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type BrowserInstallPrompt = Event & {
  prompt: () => Promise<unknown>;
  userChoice: Promise<InstallChoice>;
};
type InstallState = {
  standalone: boolean;
  installedInSession: boolean;
  promptAvailable: boolean;
  platform: Platform;
};

const serverState: InstallState = {
  standalone: false, installedInSession: false, promptAvailable: false, platform: "ios",
};
let state = serverState;
let deferredPrompt: BrowserInstallPrompt | null = null;
const listeners = new Set<() => void>();

function updateState(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Capture the browser event when this module loads, including before this page
// is opened. Routing away and back must not lose a still-available prompt.
if (typeof window !== "undefined") {
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const appleStandalone = () => Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  const userAgent = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(userAgent)
    || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  state = {
    ...state,
    standalone: displayMode.matches || appleStandalone(),
    platform: ios ? "ios" : /Android/.test(userAgent) ? "android" : "desktop",
  };
  displayMode.addEventListener("change", () => {
    updateState({ standalone: displayMode.matches || appleStandalone() });
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BrowserInstallPrompt;
    updateState({ promptAvailable: true, installedInSession: false });
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    updateState({ promptAvailable: false, installedInSession: true });
  });
}

function Icon({ type }: { type: "back" | "install" | "check" | "phone" | "desktop" }) {
  const paths = {
    back: "m14 5-7 7 7 7",
    install: "M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4",
    check: "m5 12 4 4L19 6",
    phone: "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm3 17h4",
    desktop: "M3 3h18v13H3V3Zm5 18h8m-4-5v5",
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type]} /></svg>;
}

const guides: Record<Platform, { title: string; steps: string[]; note: string }> = {
  ios: {
    title: "iPhone / iPad",
    steps: ["用 Safari 打开本站。", "点击浏览器的分享按钮，选择“添加到主屏幕”。", "如果看到“作为 Web App 打开”，保持开启，再点击“添加”。"],
    note: "没有看到该选项时，请退出应用内置浏览器，在 Safari 中打开。",
  },
  android: {
    title: "Android",
    steps: ["用 Chrome 或支持安装网页应用的浏览器打开本站。", "打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。", "按浏览器提示确认，再从主屏幕打开叙梦。"],
    note: "菜单名称因浏览器而异；部分浏览器只会创建网页快捷方式。",
  },
  desktop: {
    title: "电脑",
    steps: ["在 Chrome 或 Edge 中打开本站。", "点击地址栏的安装图标，或在浏览器菜单中选择安装此网站为应用。", "确认后，从桌面或系统应用列表打开叙梦。"],
    note: "Mac 的 Safari（macOS Sonoma 14 或更新版本）也可通过“文件 → 添加到程序坞”添加本站。",
  },
};

export function InstallApp({ onBack, locale = "zh-Hans" }: { onBack?: () => void; locale?: import("../../lib/xumeng-i18n").XumengLocale }) {
  const copy = xumengPage(locale);
  const installation = useSyncExternalStore(subscribe, () => state, () => serverState);
  const [chosenPlatform, setChosenPlatform] = useState<Platform | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState("");
  const instructions = useRef<HTMLHeadingElement>(null);
  const platform = chosenPlatform ?? installation.platform;
  const localizedGuides = {
    ios: { title: copy.iosTitle, steps: [copy.ios1, copy.ios2, copy.ios3], note: copy.iosNote },
    android: { title: copy.androidTitle, steps: [copy.android1, copy.android2, copy.android3], note: copy.androidNote },
    desktop: { title: copy.desktopTitle, steps: [copy.desktop1, copy.desktop2, copy.desktop3], note: copy.desktopNote },
  };
  const guide = localizedGuides[platform];

  async function install() {
    const prompt = deferredPrompt;
    if (!prompt || installing) return;
    deferredPrompt = null;
    updateState({ promptAvailable: false });
    setInstalling(true);
    setMessage("");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(choice.outcome === "accepted"
        ? copy.installAccepted
        : copy.installDismissed);
    } catch {
      setMessage(copy.installPromptFailed);
    } finally { setInstalling(false); }
  }

  function showInstructions() {
    const heading = instructions.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  function changeTab(event: KeyboardEvent<HTMLButtonElement>, current: Platform) {
    const platforms: Platform[] = ["ios", "android", "desktop"];
    const index = platforms.indexOf(current);
    const target = event.key === "ArrowRight" ? (index + 1) % platforms.length
      : event.key === "ArrowLeft" ? (index + platforms.length - 1) % platforms.length
        : event.key === "Home" ? 0 : event.key === "End" ? platforms.length - 1 : -1;
    if (target < 0) return;
    event.preventDefault();
    setChosenPlatform(platforms[target]);
    document.getElementById(`install-tab-${platforms[target]}`)?.focus();
  }

  const complete = installation.standalone || installation.installedInSession;
  return <section className={styles.page} aria-labelledby="install-page-title">
    <header className={styles.heading}>
      {onBack && <button type="button" className={styles.back} onClick={onBack}><Icon type="back" />{copy.back}</button>}
      <h1 id="install-page-title">{copy.installApp}</h1>
    </header>

    <div className={styles.appSummary}>
      <img className={styles.appIcon} src="/assets/xumeng/brand/xumeng-icon-192.png" width="96" height="96" alt={copy.appIcon} />
      <div className={styles.appInfo}>
        <span className={styles.eyebrow}>{copy.browserApp}</span>
        <h2>叙梦</h2>
        <p>{copy.installLead}</p>
      </div>
    </div>

    <div className={styles.installArea}>
      <div className={styles.availability}>
        <span className={styles.statusIcon}><Icon type={complete ? "check" : "install"} /></span>
        <div>
          <h3>{installation.standalone ? copy.inAppWindow : installation.installedInSession ? copy.browserInstalled : installing ? copy.waitingBrowser : installation.promptAvailable ? copy.browserCanInstall : copy.addViaBrowser}</h3>
          <p>{complete ? copy.openFromIcon : installing ? copy.chooseInPrompt : installation.promptAvailable ? copy.confirmInPrompt : copy.pickDevice}</p>
        </div>
      </div>
      {!complete && <div className={styles.actions}>
        {(installation.promptAvailable || installing) && <button type="button" className={styles.primary} disabled={installing} onClick={() => { void install(); }}><Icon type="install" />{installing ? copy.waitingDots : copy.installXumeng}</button>}
        <button type="button" className={styles.secondary} onClick={showInstructions}>{copy.viewSteps}</button>
      </div>}
      <p className={styles.message} role="status" aria-live="polite">{message}</p>
    </div>

    <div className={styles.instructions}>
      <h2 ref={instructions} tabIndex={-1}>{copy.manualInstall}</h2>
      <div className={styles.tabs} role="tablist" aria-label={copy.installDevice}>
        {(Object.keys(localizedGuides) as Platform[]).map((item) => <button key={item} type="button" role="tab" id={`install-tab-${item}`} aria-selected={platform === item} aria-controls="install-guide" tabIndex={platform === item ? 0 : -1} className={platform === item ? styles.activeTab : undefined} onClick={() => setChosenPlatform(item)} onKeyDown={(event) => changeTab(event, item)}><Icon type={item === "desktop" ? "desktop" : "phone"} />{localizedGuides[item].title}</button>)}
      </div>
      <div id="install-guide" role="tabpanel" aria-labelledby={`install-tab-${platform}`} className={styles.guide}>
        <ol>{guide.steps.map((step) => <li key={step}><span>{step}</span></li>)}</ol>
        <p className={styles.note}>{guide.note}</p>
      </div>
    </div>

    <footer className={styles.details}>
      <h2>{copy.howToUse}</h2>
      <p>{copy.installNote1}</p>
      <p>{copy.installNote2}</p>
    </footer>
  </section>;
}
