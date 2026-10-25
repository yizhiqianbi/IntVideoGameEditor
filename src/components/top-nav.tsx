"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./top-nav.module.css";

export function TopNav() {
  const pathname = usePathname();
  const isStudioSurface = pathname.startsWith("/studio");

  const navItems = [
    { href: "/play", label: "PLAY", cn: "游戏" },
    { href: "/film", label: "FILM", cn: "影游" },
    { href: "/video", label: "VIDEO", cn: "视频" },
    { href: "/studio", label: "STUDIO", cn: "创作" },
  ];

  return (
    <header className={styles.topNav}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark}>
            <span className={styles.logoMarkLetter}>F</span>
            <span className={styles.logoMarkDot} />
          </span>
          <span className={styles.logoText}>
            <span className={styles.logoBrand}>Fun-X</span>
            <span className={styles.logoSub}>STUDIO</span>
          </span>
        </Link>

        <nav className={styles.navLinks}>
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
              >
                <span className={styles.navLinkEn}>{item.label}</span>
                <span className={styles.navLinkCn}>{item.cn}</span>
              </Link>
            );
          })}
        </nav>

        <Link
          href={isStudioSurface ? "/studio/games/agent" : "/studio"}
          className={styles.ctaButton}
        >
          <span className={styles.ctaIcon} aria-hidden>
            {isStudioSurface ? "✨" : "→"}
          </span>
          <span>{isStudioSurface ? "AI 生成游戏" : "创作游戏"}</span>
        </Link>
      </div>
    </header>
  );
}
