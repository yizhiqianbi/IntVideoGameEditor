# Fun-X-Studio Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the home page into a three-column Fun-X-Studio product gateway with a lightweight featured-cases section.

**Architecture:** Move homepage product-line and featured-case content into a small data module so the UI stays declarative and testable. Update the top navigation brand to Fun-X-Studio, then rebuild the homepage layout around one hero and one featured-case section.

**Tech Stack:** Next.js App Router, React Server Components, CSS Modules, Node test runner (`tsx --test`)

---

### Task 1: Extract homepage catalog data

**Files:**
- Create: `src/lib/homepage-catalog.ts`
- Create: `src/lib/homepage-catalog.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/homepage-catalog.test.mts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { FEATURED_CASES, PRODUCT_LINES, getPrimaryProductLine } from "./homepage-catalog";

test("homepage exposes exactly one active primary product line", () => {
  const primary = getPrimaryProductLine();

  assert.equal(primary.slug, "interactive-film-game");
  assert.equal(primary.href, "/projects");
  assert.equal(primary.status, "active");
});

test("homepage exposes three product lines and at least three featured cases", () => {
  assert.equal(PRODUCT_LINES.length, 3);
  assert.ok(FEATURED_CASES.length >= 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/homepage-catalog.test.mts
```

Expected: FAIL because `src/lib/homepage-catalog.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/homepage-catalog.ts`:

```ts
export type ProductLineStatus = "active" | "coming-soon";

export type ProductLine = {
  slug: string;
  title: string;
  subtitle: string;
  status: ProductLineStatus;
  href?: string;
  accent: "primary" | "muted";
};

export type FeaturedCase = {
  id: string;
  title: string;
  category: string;
  status: string;
  image: string;
};

export const PRODUCT_LINES: ProductLine[] = [
  {
    slug: "mv",
    title: "MV",
    subtitle: "音乐叙事与视觉短片",
    status: "coming-soon",
    accent: "muted",
  },
  {
    slug: "interactive-film-game",
    title: "互动影游",
    subtitle: "节点式剧情、角色场景与互动交付",
    status: "active",
    href: "/projects",
    accent: "primary",
  },
  {
    slug: "interactive-game-generator",
    title: "互动游戏生成器",
    subtitle: "规则、剧情与玩法生成",
    status: "coming-soon",
    accent: "muted",
  },
];

export const FEATURED_CASES: FeaturedCase[] = [
  {
    id: "case-fog-port",
    title: "雾港回声",
    category: "互动影游",
    status: "精选案例",
    image: "/demo/featured-fog-port.png",
  },
  {
    id: "case-no-signal",
    title: "未接来电",
    category: "互动影游",
    status: "案例占坑",
    image: "/demo/featured-no-signal.png",
  },
  {
    id: "case-last-tape",
    title: "最后一盘录像带",
    category: "互动影游",
    status: "案例占坑",
    image: "/demo/featured-last-tape.png",
  },
];

export function getPrimaryProductLine() {
  return PRODUCT_LINES.find((item) => item.status === "active") ?? PRODUCT_LINES[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --import tsx --test src/lib/homepage-catalog.test.mts
```

Expected: PASS.

### Task 2: Rebuild the home page around product lines and featured cases

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.module.css`

- [ ] **Step 1: Update the page component to render the new structure**

Replace the homepage body with:

```tsx
import Link from "next/link";
import styles from "./page.module.css";
import { TopNav } from "@/components/top-nav";
import { FEATURED_CASES, PRODUCT_LINES } from "@/lib/homepage-catalog";

export default function Home() {
  return (
    <main className={styles.page}>
      <TopNav />
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Fun-X-Studio</span>
            <h1 className={styles.title}>Fun-X-Studio</h1>
            <p className={styles.subtitle}>用 AI 做可玩的故事。</p>
          </div>

          <div className={styles.productGrid}>
            {PRODUCT_LINES.map((line) =>
              line.href ? (
                <Link key={line.slug} href={line.href} className={`${styles.productCard} ${line.accent === "primary" ? styles.productCardPrimary : ""}`}>
                  <div className={styles.productMeta}>
                    <span className={styles.productStatus}>{line.status === "active" ? "Available" : "Coming Soon"}</span>
                    <span className={styles.productArrow}>→</span>
                  </div>
                  <h2 className={styles.productTitle}>{line.title}</h2>
                  <p className={styles.productSubtitle}>{line.subtitle}</p>
                  <span className={styles.productAction}>立即进入</span>
                </Link>
              ) : (
                <article key={line.slug} className={styles.productCard}>
                  <div className={styles.productMeta}>
                    <span className={styles.productStatus}>Coming Soon</span>
                  </div>
                  <h2 className={styles.productTitle}>{line.title}</h2>
                  <p className={styles.productSubtitle}>{line.subtitle}</p>
                </article>
              ),
            )}
          </div>
        </div>
      </section>

      <section className={styles.featuredSection}>
        <div className={styles.featuredHeader}>
          <span className={styles.eyebrow}>Featured Cases</span>
          <h2 className={styles.featuredTitle}>精选案例</h2>
        </div>
        <div className={styles.featuredGrid}>
          {FEATURED_CASES.map((item) => (
            <article key={item.id} className={styles.featuredCard}>
              <div className={styles.featuredVisual}>
                <div className={styles.featuredGlow} />
              </div>
              <div className={styles.featuredBody}>
                <span className={styles.featuredTag}>{item.category}</span>
                <h3>{item.title}</h3>
                <p>{item.status}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Update the CSS module to match the new composition**

Rewrite `src/app/page.module.css` to support:
- hero as a poster-like top section
- three large product cards
- one highlighted primary card
- a second featured-case section below
- mobile stacking under 900px

- [ ] **Step 3: Run build to verify the page compiles**

Run:

```bash
npm run build
```

Expected: PASS.

### Task 3: Rebrand the top navigation

**Files:**
- Modify: `src/components/top-nav.tsx`
- Modify: `src/components/top-nav.module.css`

- [ ] **Step 1: Update the top nav brand label**

Change:

```tsx
<span className={styles.logoText}>Pencil Studio</span>
```

to:

```tsx
<span className={styles.logoText}>Fun-X-Studio</span>
```

- [ ] **Step 2: Keep the CTA focused on the current active product**

Retain:

```tsx
<Link href="/projects?new=1" className={styles.ctaButton}>
  + 新建项目
</Link>
```

but ensure the nav layout still fits the new brand without overflow.

- [ ] **Step 3: Re-run the build**

Run:

```bash
npm run build
```

Expected: PASS.

### Task 4: Verify the real page in a browser

**Files:**
- Modify: none

- [ ] **Step 1: Open the home page**

Run:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" open http://localhost:3000/
```

- [ ] **Step 2: Snapshot the page**

Run:

```bash
"$PWCLI" snapshot
```

Expected:
- `Fun-X-Studio` is the main headline
- three product cards are visible
- only `互动影游` is a live entry
- `精选案例` section is visible below

