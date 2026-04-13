"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./top-nav.module.css";

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className={styles.topNav}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark}>F</span>
          <span className={styles.logoText}>Fun-X-Studio</span>
        </Link>

        <nav className={styles.navLinks}>
          <Link
            href="/projects"
            className={`${styles.navLink} ${pathname.startsWith("/projects") ? styles.navLinkActive : ""}`}
          >
            我的项目
          </Link>
        </nav>

        <Link href="/projects?new=1" className={styles.ctaButton}>
          + 新建项目
        </Link>
      </div>
    </header>
  );
}
