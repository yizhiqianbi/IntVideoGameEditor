# Fun-X Public Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the public surface into a cover-first content portal with a denser Play shelf, mandatory game covers, leaderboard, recent-play, and the documented `template + skill + prompt` creation direction.

**Architecture:** Keep one repository with two surfaces. Public platform pages consume a shallow public catalog, a shared minigame host, local recent-play storage, and local leaderboard mock data. Creator-side logic stays separate but the architecture and creator-skill docs are updated so future template/skill/prompt creation can attach cleanly.

**Tech Stack:** Next.js App Router, TypeScript, CSS Modules, local browser storage, static catalog data

---

### Task 1: Strengthen public content model for cover-first publishing

**Files:**
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-catalog.ts`
- Test: `/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-catalog.ts`

- [ ] **Step 1: Add mandatory cover fields and ranking/recent metadata to the content type**

Replace the `PublicContentEntry` type with a version that includes:

```ts
export type PublicContentEntry = {
  id: string;
  slug: string;
  type: PublicContentType;
  title: string;
  subtitle: string;
  summary: string;
  tags: string[];
  featured: boolean;
  status: "published" | "coming-soon";
  updatedAt: string;
  durationLabel?: string;
  coverTone: "slate" | "violet" | "cyan" | "amber";
  coverImageUrl: string;
  thumbnailImageUrl?: string;
  primaryActionLabel: string;
  rankScore?: number;
  recentPlayAt?: string;
};
```

- [ ] **Step 2: Add cover assets to every `play` entry**

For every play entry in `PUBLIC_CONTENT`, include:

```ts
coverImageUrl: "/covers/play/<slug>.svg",
thumbnailImageUrl: "/covers/play/<slug>.svg",
rankScore: <number>,
```

Use the existing 10 minigame slugs and assign distinct rank scores.

- [ ] **Step 3: Run build validation**

Run: `npm run build`

Expected: the catalog type compiles and all public content entries remain valid.

- [ ] **Step 4: Commit**

```bash
git add /Users/pencil/Documents/IntVideoGameEditor/src/lib/public-catalog.ts
git commit -m "feat: add cover-first public content fields"
```

### Task 2: Add generated placeholder cover assets for every minigame

**Files:**
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/click-chase.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/memory-flip.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/lane-dodge.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/signal-sequence.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/crate-sort.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/truth-judge.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/route-planner.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/rhythm-gate.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/harbor-match.svg`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/code-breaker.svg`
- Test: `/Users/pencil/Documents/IntVideoGameEditor/public/covers/play/*.svg`

- [ ] **Step 1: Create a reusable visual language for minigame covers**

Use SVG composition rules:

```svg
<svg width="900" height="1200" viewBox="0 0 900 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="1200" fill="#101318"/>
  <rect x="48" y="48" width="804" height="1104" rx="56" fill="#171B22"/>
  <text x="72" y="1050" fill="#F5F7FB" font-size="88" font-weight="700">TITLE</text>
</svg>
```

Each cover must visually communicate the core mechanic with 1-2 bold shapes and one short title.

- [ ] **Step 2: Generate 10 distinct covers**

Create one SVG per slug with unique composition:
- click-chase: target + cursor rhythm
- memory-flip: card grid
- lane-dodge: lanes + obstacle
- signal-sequence: colored pads
- crate-sort: crates + bays
- truth-judge: true/false split
- route-planner: grid path
- rhythm-gate: moving bar + gate
- harbor-match: two-column matching
- code-breaker: keypad + hint dots

- [ ] **Step 3: Sanity check file existence**

Run: `ls public/covers/play`

Expected: all 10 `.svg` files present.

- [ ] **Step 4: Commit**

```bash
git add /Users/pencil/Documents/IntVideoGameEditor/public/covers/play
git commit -m "feat: add minigame cover assets"
```

### Task 3: Upgrade content cards to real cover cards

**Files:**
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/components/public/content-card.tsx`
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/components/public/content-card.module.css`
- Test: `/Users/pencil/Documents/IntVideoGameEditor/src/components/public/content-card.tsx`

- [ ] **Step 1: Render real cover art in cards**

Update the component to render a cover image:

```tsx
<div className={styles.visual}>
  <img
    src={entry.thumbnailImageUrl ?? entry.coverImageUrl}
    alt={entry.title}
    className={styles.coverImage}
  />
</div>
```

Keep the body minimal:

```tsx
<div className={styles.body}>
  <h3 className={styles.title}>{entry.title}</h3>
</div>
```

Remove subtitle from regular cards.

- [ ] **Step 2: Update styles for dense shelf behavior**

Add styles:

```css
.coverImage {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.visual {
  aspect-ratio: 3 / 4;
  min-height: 0;
}

.body {
  padding: 10px 10px 14px;
}
```

Keep cards compact and cover-first.

- [ ] **Step 3: Run build validation**

Run: `npm run build`

Expected: content cards compile and render with real covers.

- [ ] **Step 4: Commit**

```bash
git add /Users/pencil/Documents/IntVideoGameEditor/src/components/public/content-card.tsx /Users/pencil/Documents/IntVideoGameEditor/src/components/public/content-card.module.css
git commit -m "feat: make public cards cover-first"
```

### Task 4: Rebuild homepage as a shelf-first content portal

**Files:**
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/app/page.tsx`
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/app/page.module.css`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-recent-play.ts`
- Create: `/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-leaderboard.ts`
- Test: `/Users/pencil/Documents/IntVideoGameEditor/src/app/page.tsx`

- [ ] **Step 1: Add leaderboard and recent-play helpers**

Create `/src/lib/public-leaderboard.ts`:

```ts
import { PUBLIC_CONTENT } from "@/lib/public-catalog";

export function getTopRankedPlayEntries(limit = 8) {
  return PUBLIC_CONTENT
    .filter((entry) => entry.type === "play")
    .sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0))
    .slice(0, limit);
}
```

Create `/src/lib/public-recent-play.ts` with browser-safe helpers:

```ts
export const RECENT_PLAY_KEY = "funx-public-recent-play";

export function readRecentPlaySlugs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PLAY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Rebuild homepage structure**

Replace the current home layout with shelves in this order:

```tsx
<main>
  <TopNav />
  <div className={styles.shell}>
    <section className={styles.heroShelf}>...</section>
    <section className={styles.rankShelf}>...</section>
    <section className={styles.recentShelf}>...</section>
    <section className={styles.laneShelf}>Play ...</section>
    <section className={styles.laneShelf}>互动影游 ...</section>
    <section className={styles.laneShelf}>纯视频 ...</section>
  </div>
</main>
```

Do not render long subtitles or intro paragraphs.

- [ ] **Step 3: Add dense shelf styles**

In `page.module.css`, create:

```css
.shelfRow {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(180px, 240px);
  gap: 14px;
  overflow-x: auto;
}
```

Use shelves instead of large section descriptions.

- [ ] **Step 4: Run build validation**

Run: `npm run build`

Expected: homepage builds and shelves render.

- [ ] **Step 5: Commit**

```bash
git add /Users/pencil/Documents/IntVideoGameEditor/src/app/page.tsx /Users/pencil/Documents/IntVideoGameEditor/src/app/page.module.css /Users/pencil/Documents/IntVideoGameEditor/src/lib/public-recent-play.ts /Users/pencil/Documents/IntVideoGameEditor/src/lib/public-leaderboard.ts
git commit -m "feat: rebuild public homepage as content shelves"
```

### Task 5: Rebuild Play page as a true game portal

**Files:**
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/components/public/catalog-page.tsx`
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/components/public/catalog-page.module.css`
- Test: `/Users/pencil/Documents/IntVideoGameEditor/src/components/public/catalog-page.tsx`

- [ ] **Step 1: Special-case the Play page layout**

In `CatalogPage`, if `type === "play"`, render:

```tsx
const rankedEntries = getTopRankedPlayEntries();

return (
  <main className={styles.page}>
    <TopNav />
    <div className={styles.shell}>
      <section className={styles.portalHeader}>...</section>
      <section className={styles.portalGrid}>
        <div className={styles.mainShelf}>...all play entries...</div>
        <aside className={styles.sidebar}>
          ...leaderboard...
          ...recent play...
        </aside>
      </section>
    </div>
  </main>
);
```

- [ ] **Step 2: Add portal-specific CSS**

Add:

```css
.portalGrid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
}

.mainShelf {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
```

Fallback to 3 / 2 / 1 columns responsively.

- [ ] **Step 3: Keep film/video pages simpler**

Only `play` gets the heavier portal treatment. `film` and `video` keep the lighter lane-page shell.

- [ ] **Step 4: Run build validation**

Run: `npm run build`

Expected: `/play` compiles with leaderboard and recent play sidebar.

- [ ] **Step 5: Commit**

```bash
git add /Users/pencil/Documents/IntVideoGameEditor/src/components/public/catalog-page.tsx /Users/pencil/Documents/IntVideoGameEditor/src/components/public/catalog-page.module.css
git commit -m "feat: turn play into a game portal"
```

### Task 6: Record recent-play on game entry

**Files:**
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/components/public/detail-page.tsx`
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/src/lib/public-recent-play.ts`
- Test: `/Users/pencil/Documents/IntVideoGameEditor/src/components/public/detail-page.tsx`

- [ ] **Step 1: Add write helper**

In `public-recent-play.ts`, add:

```ts
export function writeRecentPlaySlug(slug: string) {
  if (typeof window === "undefined") return;
  const current = readRecentPlaySlugs().filter((item) => item !== slug);
  const next = [slug, ...current].slice(0, 12);
  window.localStorage.setItem(RECENT_PLAY_KEY, JSON.stringify(next));
}
```

- [ ] **Step 2: Record slug when a play detail page opens**

Wrap a client subcomponent or effect so that `/play/[slug]` writes:

```tsx
useEffect(() => {
  writeRecentPlaySlug(slug);
}, [slug]);
```

- [ ] **Step 3: Run build validation**

Run: `npm run build`

Expected: recent-play state is tracked without SSR breakage.

- [ ] **Step 4: Commit**

```bash
git add /Users/pencil/Documents/IntVideoGameEditor/src/components/public/detail-page.tsx /Users/pencil/Documents/IntVideoGameEditor/src/lib/public-recent-play.ts
git commit -m "feat: track recent public play"
```

### Task 7: Update creator-skill and architecture docs

**Files:**
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/ARCHITECTURE.md`
- Modify: `/Users/pencil/Documents/IntVideoGameEditor/docs/game-creator-skills.md`

- [ ] **Step 1: Expand architecture rules**

Add explicit rules:

```md
- homepage modules: recent play, leaderboard, play shelf, film shelf, video shelf
- every public mini-game requires a cover asset
- public cards are cover-first and text-light
```

- [ ] **Step 2: Expand creator-skill doc**

Add a short section:

```md
## 创作端后续入口

未来小游戏创作入口统一为：
- 模板
- skill
- prompt
```

- [ ] **Step 3: Run content sanity check**

Run:

```bash
sed -n '1,260p' /Users/pencil/Documents/IntVideoGameEditor/ARCHITECTURE.md
sed -n '1,260p' /Users/pencil/Documents/IntVideoGameEditor/docs/game-creator-skills.md
```

Expected: both docs reflect the same rules.

- [ ] **Step 4: Commit**

```bash
git add /Users/pencil/Documents/IntVideoGameEditor/ARCHITECTURE.md /Users/pencil/Documents/IntVideoGameEditor/docs/game-creator-skills.md
git commit -m "docs: update public portal and creator skill architecture"
```
