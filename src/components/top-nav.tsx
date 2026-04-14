"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./top-nav.module.css";

export function TopNav() {
  const pathname = usePathname();
  const isProjectsSurface = pathname.startsWith("/projects");

  const navItems = [
    { href: "/play", label: "Play" },
    { href: "/film", label: "互动影游" },
    { href: "/video", label: "视频" },
    { href: "/projects", label: "创作后台" },
  ];

  return (
    <header className={styles.topNav}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoMark}>F</span>
          <span className={styles.logoText}>Fun-X-Studio</span>
        </Link>

        <nav className={styles.navLinks}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navLink} ${pathname.startsWith(item.href) ? styles.navLinkActive : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href={isProjectsSurface ? "/projects?new=1" : "/projects"}
          className={styles.ctaButton}
        >
          {isProjectsSurface ? "+ 新建项目" : "进入创作后台"}
        </Link>
      </div>
    </header>
  );
}
