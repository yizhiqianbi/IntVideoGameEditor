# Fun-X-Studio Dual Surface UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public platform and creator-side studio UI into two clearly different visual surfaces without breaking existing routes, data models, or generation workflows.

**Architecture:** Keep all current route boundaries and product responsibilities intact, but replace the shared “dark AI panel” look with two visual systems: a cover-first content platform for public pages and a workspace-first build studio for creator pages. Implement in phases so public pages ship first, then Play Agent Studio, then Projects, and finally light visual cleanup of the interactive film editor.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS Modules, existing local state/storage layers, existing content/runtime components

---

## File Structure

### Shared visual system files

- Modify: `src/app/globals.css`
  - Remove the old purple/cyan accent-heavy token set
  - Introduce calmer surface, line, text, accent, and spacing tokens
- Modify: `src/components/top-nav.tsx`
  - Simplify navigation structure and CTA emphasis
- Modify: `src/components/top-nav.module.css`
  - Make the nav thinner, calmer, and less tool-like

### Public platform files

- Modify: `src/app/page.tsx`
  - Recompose homepage into a denser, more elegant cover-first content homepage
- Modify: `src/app/page.module.css`
  - Replace current panel-heavy layout with thinner rails and cleaner spacing
- Modify: `src/components/public/content-card.tsx`
  - Tighten card structure around cover + title
- Modify: `src/components/public/content-card.module.css`
  - Make cards feel like content thumbnails, not dashboard cards
- Modify: `src/components/public/catalog-page.tsx`
  - Unify `Play`, `互动影游`, and `视频` lane pages under one denser shelf-first layout
- Modify: `src/components/public/catalog-page.module.css`
  - Reduce sidebar weight and increase cover density
- Modify: `src/components/public/detail-page.tsx`
  - Keep runtime-first composition but reduce chrome and metadata noise
- Modify: `src/components/public/detail-page.module.css`
  - Make runtime stage feel more premium and less boxed
- Modify: `src/components/public/public-search-panel.tsx`
  - Collapse search into a lighter, utility-style shelf search
- Modify: `src/components/public/public-search-panel.module.css`
  - Remove oversized panel styling
- Modify: `src/components/public/leaderboard-panel.tsx`
  - Keep compact leaderboard structure
- Modify: `src/components/public/leaderboard-panel.module.css`
  - Reduce sidebar/card heaviness
- Modify: `src/components/public/recent-play-strip.tsx`
  - Keep as a lightweight strip only where needed
- Modify: `src/components/public/recent-play-strip.module.css`
  - Align with new platform density

### Creator studio files

- Modify: `src/components/studio/play-agent/play-agent-studio.tsx`
  - Rebuild as a workspace-first build studio
- Modify: `src/components/studio/play-agent/play-agent-studio.module.css`
  - Replace equal-weight three-column form layout with a dominant work surface
- Modify: `src/app/projects/page.tsx`
  - Reduce hero panel feel and make it a project flow page
- Modify: `src/app/projects/page.module.css`
  - Give projects more editorial/work cover hierarchy
- Modify: `src/components/editor/editor-shell.module.css`
  - Only light cleanup in this phase

### Documentation

- Modify: `ARCHITECTURE.md`
  - Update visual system and dual-surface implementation status after the redesign is done

---

### Task 1: Replace the global visual tokens

**Files:**
- Modify: `src/app/globals.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing visual checklist**

Create a short checklist in your notes before editing:

```text
Expected failures in current UI:
- purple/cyan gradients dominate too many surfaces
- public platform looks like a tool dashboard
- navigation CTA is too bright and loud
- cards use heavy borders and panel styling
- public runtime/detail pages still feel boxed and admin-like
```

- [ ] **Step 2: Update the root tokens**

Replace the old root token block in `src/app/globals.css` with a calmer system:

```css
:root {
  --color-background: #0a0b0d;
  --color-surface: rgba(17, 18, 22, 0.96);
  --color-surface-strong: #15171b;
  --color-surface-elevated: #1a1d22;
  --color-line: rgba(255, 255, 255, 0.07);
  --color-line-strong: rgba(255, 255, 255, 0.12);
  --color-text: #f3f1eb;
  --color-muted: rgba(243, 241, 235, 0.52);

  --color-accent: #d6c3a1;
  --color-accent-strong: #f1dfbf;
  --color-success: #63c88d;
  --color-warning: #d5aa56;
  --color-danger: #e66e72;

  --shadow-panel: 0 16px 40px rgba(0, 0, 0, 0.32);
  --shadow-card: 0 10px 24px rgba(0, 0, 0, 0.24);
  --shadow-card-hover: 0 20px 36px rgba(0, 0, 0, 0.28);

  --nav-height: 56px;
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --transition-fast: 140ms var(--ease-out);
  --transition-med: 240ms var(--ease-out);
}
```

- [ ] **Step 3: Remove decorative page gradients**

In `src/app/globals.css`, replace the `body` background with a simpler layered dark background:

```css
body {
  color: var(--color-text);
  background:
    radial-gradient(circle at top center, rgba(255, 255, 255, 0.035), transparent 24%),
    linear-gradient(180deg, #090a0c 0%, #0c0e11 100%);
  font-family: var(--font-display), sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 4: Neutralize React Flow accents**

In `src/app/globals.css`, replace the strongest remaining purple/cyan usages:

```css
.react-flow__edge.selected .react-flow__edge-path {
  stroke: rgba(214, 195, 161, 0.78);
  stroke-width: 2;
}

.react-flow__connection-path {
  stroke: rgba(214, 195, 161, 0.88);
  stroke-width: 2;
  stroke-dasharray: 6 4;
}

.react-flow__handle {
  width: 10px;
  height: 10px;
  background: #d8c6aa;
  border: 2px solid var(--color-surface-strong);
}
```

- [ ] **Step 5: Run build to verify global CSS still compiles**

Run: `npm run build`  
Expected: build succeeds with no CSS syntax errors

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "style: reset global visual tokens"
```

### Task 2: Rebuild the shared top navigation

**Files:**
- Modify: `src/components/top-nav.tsx`
- Modify: `src/components/top-nav.module.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing structure expectation**

```text
Top nav should:
- feel thinner and more premium
- reduce CTA dominance
- support content-first public platform
- still provide a route to creator studio
```

- [ ] **Step 2: Simplify CTA hierarchy in `src/components/top-nav.tsx`**

Keep the same route set, but reduce emphasis of the right CTA:

```tsx
<Link
  href={isProjectsSurface ? "/projects?new=1" : "/projects"}
  className={styles.studioLink}
>
  {isProjectsSurface ? "新建项目" : "创作后台"}
</Link>
```

Replace old `ctaButton` references with `studioLink`.

- [ ] **Step 3: Thin out the nav chrome**

In `src/components/top-nav.module.css`, replace the top-level shell with:

```css
.topNav {
  position: sticky;
  top: 0;
  z-index: 100;
  width: 100%;
  height: var(--nav-height);
  background: rgba(9, 10, 12, 0.84);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.inner {
  display: flex;
  align-items: center;
  gap: 22px;
  width: min(1440px, calc(100vw - 40px));
  margin: 0 auto;
  height: 100%;
}
```

- [ ] **Step 4: Make the logo and links calmer**

Adjust these rules in `src/components/top-nav.module.css`:

```css
.logoMark {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: #16181d;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 13px;
}

.navLink {
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  color: rgba(243, 241, 235, 0.48);
}

.navLinkActive {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.045);
}
```

- [ ] **Step 5: Replace the bright CTA with a quiet utility link**

Add this rule in `src/components/top-nav.module.css`:

```css
.studioLink {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(243, 241, 235, 0.86);
  font-size: 12px;
  font-weight: 600;
}

.studioLink:hover {
  background: rgba(255, 255, 255, 0.06);
}
```

- [ ] **Step 6: Run build**

Run: `npm run build`  
Expected: nav compiles; no `ctaButton` reference remains

- [ ] **Step 7: Commit**

```bash
git add src/components/top-nav.tsx src/components/top-nav.module.css
git commit -m "style: refine shared navigation shell"
```

### Task 3: Rebuild the homepage into a denser content portal

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.module.css`
- Modify: `src/components/public/content-card.tsx`
- Modify: `src/components/public/content-card.module.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing homepage rule**

```text
Homepage should:
- read as a content portal, not a product dashboard
- show more covers earlier
- keep hot zone thin
- reduce card chrome
```

- [ ] **Step 2: Compress the homepage structure in `src/app/page.tsx`**

Recompose the home page sections so the order stays:

```tsx
<PublicSearchPanel ... />
<section className={styles.topStrip}>...</section>
<section className={styles.sectionStack}>...</section>
```

but change the `hotEntries` count and the cards:

```tsx
const leaderboardEntries = topPlay.slice(0, 8);
const hotEntries = topPlay.slice(0, 4);
```

and in the hot rail use:

```tsx
<ContentCard
  key={entry.id}
  entry={entry}
  href={`/${entry.type}/${entry.slug}`}
  wide
  minimal
/>
```

Also pass `minimal` to shelf cards:

```tsx
<ContentCard
  key={entry.id}
  entry={entry}
  href={`/${entry.type}/${entry.slug}`}
  compact
  minimal
/>
```

- [ ] **Step 3: Add a minimal card mode in `src/components/public/content-card.tsx`**

Extend the component signature:

```tsx
type ContentCardProps = {
  entry: PublicContentEntry;
  href: string;
  large?: boolean;
  compact?: boolean;
  wide?: boolean;
  minimal?: boolean;
};
```

Apply the class:

```tsx
className={`${styles.card} ${large ? styles.cardLarge : ""} ${compact ? styles.cardCompact : ""} ${wide ? styles.cardWide : ""} ${minimal ? styles.cardMinimal : ""}`}
```

And when `minimal` is true, suppress the large overlay meta:

```tsx
{large && !minimal ? (
  <div className={styles.visualOverlay}>
    <span className={styles.visualMeta}>{entry.type}</span>
    <h2 className={styles.visualTitle}>{entry.title}</h2>
  </div>
) : null}
```

- [ ] **Step 4: Rework the homepage shell spacing**

In `src/app/page.module.css`, replace the layout with:

```css
.page {
  min-height: 100vh;
  background: transparent;
}

.shell {
  width: min(1480px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 14px 0 88px;
  display: grid;
  gap: 16px;
}

.topStrip {
  display: grid;
  grid-template-columns: 184px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.hotRail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.sectionStack {
  display: grid;
  gap: 16px;
}
```

- [ ] **Step 5: Make content cards feel like covers, not panels**

In `src/components/public/content-card.module.css`, replace the core styles:

```css
.card {
  display: grid;
  gap: 0;
  overflow: hidden;
  border-radius: 18px;
  background: transparent;
  color: inherit;
  text-decoration: none;
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.card:hover {
  transform: translateY(-2px);
  opacity: 0.95;
}

.cardMinimal .visual {
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 16px;
}

.body {
  display: grid;
  gap: 4px;
  padding: 6px 2px 0;
}

.title {
  margin: 0;
  font-size: 13px;
  line-height: 1.3;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 6: Make section headers lighter**

Update `src/app/page.module.css`:

```css
.sectionHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 2px;
}

.sectionTitle {
  margin: 0;
  font-size: 15px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.sectionLink {
  min-height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(243, 241, 235, 0.62);
  font-size: 11px;
  font-weight: 700;
}
```

- [ ] **Step 7: Run build**

Run: `npm run build`  
Expected: homepage compiles; cards render with minimal chrome

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx src/app/page.module.css src/components/public/content-card.tsx src/components/public/content-card.module.css
git commit -m "style: rebuild homepage as content-first portal"
```

### Task 4: Unify and simplify the lane pages

**Files:**
- Modify: `src/components/public/catalog-page.tsx`
- Modify: `src/components/public/catalog-page.module.css`
- Modify: `src/components/public/public-search-panel.tsx`
- Modify: `src/components/public/public-search-panel.module.css`
- Modify: `src/components/public/leaderboard-panel.module.css`
- Modify: `src/components/public/recent-play-strip.module.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing lane-page rule**

```text
Lane pages should:
- look like high-density shelves
- share the same visual family across play/film/video
- keep sidebar lighter than the main cover grid
```

- [ ] **Step 2: Keep the same component responsibilities but reduce chrome**

In `src/components/public/catalog-page.tsx`, keep:

```tsx
<PublicSearchPanel ... />
<div className={styles.portalGrid}>...</div>
```

but ensure all cards are rendered as:

```tsx
<ContentCard
  key={entry.id}
  entry={entry}
  href={`/${entry.type}/${entry.slug}`}
  compact
  minimal
/>
```

- [ ] **Step 3: Rebuild the lane page layout**

In `src/components/public/catalog-page.module.css`, replace the page shell with:

```css
.page {
  min-height: 100vh;
  background: transparent;
}

.shell {
  width: min(1480px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 14px 0 72px;
  display: grid;
  gap: 16px;
}

.portalHeader {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.portalGrid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 18px;
  align-items: start;
}

.mainShelf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(146px, 1fr));
  gap: 10px;
}

.sidebar {
  display: grid;
  gap: 14px;
}
```

- [ ] **Step 4: Make search a utility control, not a panel**

In `src/components/public/public-search-panel.module.css`, replace the panel styles:

```css
.panel {
  display: grid;
  gap: 6px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
}

.searchBar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(14, 15, 18, 0.92);
}
```

- [ ] **Step 5: Make search results look like an overlay shelf**

In `src/components/public/public-search-panel.tsx`, wrap the results in a smaller secondary heading only when there is a query:

```tsx
{hasQuery ? (
  <div className={styles.resultsShell}>
    {results.length > 0 ? (
      <div className={styles.results}>
        ...
      </div>
    ) : (
      <div className={styles.empty}>没有找到匹配内容</div>
    )}
  </div>
) : null}
```

and add in CSS:

```css
.resultsShell {
  display: grid;
  gap: 6px;
}

.results {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(146px, 168px);
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
```

- [ ] **Step 6: Reduce leaderboard and recent-play panel weight**

In `src/components/public/leaderboard-panel.module.css` and `src/components/public/recent-play-strip.module.css`, remove heavy panel backgrounds and borders. Convert them to lighter stacked blocks using:

```css
background: rgba(14, 15, 18, 0.72);
border: 1px solid rgba(255, 255, 255, 0.06);
border-radius: 18px;
```

and reduce internal padding by 2-4px from current values.

- [ ] **Step 7: Run build**

Run: `npm run build`  
Expected: `/play`, `/film`, `/video` pages still compile and share the new denser shelf shell

- [ ] **Step 8: Commit**

```bash
git add src/components/public/catalog-page.tsx src/components/public/catalog-page.module.css src/components/public/public-search-panel.tsx src/components/public/public-search-panel.module.css src/components/public/leaderboard-panel.module.css src/components/public/recent-play-strip.module.css
git commit -m "style: unify public lane pages as dense shelf layouts"
```

### Task 5: Rebuild detail pages as runtime-first pages

**Files:**
- Modify: `src/components/public/detail-page.tsx`
- Modify: `src/components/public/detail-page.module.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing rule**

```text
Detail pages should:
- drop users into the runtime immediately
- minimize metadata and chrome
- keep related content secondary
```

- [ ] **Step 2: Keep runtime-first composition but reduce non-essential controls**

In `src/components/public/detail-page.tsx`, keep the structure:

```tsx
<div className={styles.runtimeActions}>...</div>
<RuntimeStageShell ... />
<section className={styles.relatedSection}>...</section>
```

but reduce related entries from 3 to 2:

```tsx
const relatedEntries = getEntriesByType(type)
  .filter((item) => item.slug !== slug)
  .slice(0, 2);
```

- [ ] **Step 3: Thin out the shell**

In `src/components/public/detail-page.module.css`, replace shell spacing:

```css
.shell {
  width: min(1480px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 14px 0 72px;
  display: grid;
  gap: 18px;
}

.runtimeActions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
```

- [ ] **Step 4: Make the runtime stage feel less boxed**

Replace the runtime stage shell:

```css
.runtimeStage {
  min-height: calc(100vh - 150px);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
  display: grid;
  place-items: center;
  padding: 10px;
  position: relative;
}

.runtimeStagePlay {
  place-items: stretch;
  background: #0e1013;
}
```

- [ ] **Step 5: Reduce ghost button styling**

Use:

```css
.ghostButton {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(243, 241, 235, 0.8);
  font-size: 12px;
  font-weight: 600;
}
```

- [ ] **Step 6: Shrink related-content importance**

Use:

```css
.relatedSection {
  display: grid;
  gap: 12px;
}

.relatedTitle {
  margin: 0;
  font-size: 15px;
  line-height: 1;
  font-weight: 700;
}

.relatedGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
```

- [ ] **Step 7: Run build**

Run: `npm run build`  
Expected: runtime pages still compile and fullscreen remains intact

- [ ] **Step 8: Commit**

```bash
git add src/components/public/detail-page.tsx src/components/public/detail-page.module.css
git commit -m "style: simplify runtime detail pages"
```

### Task 6: Rebuild Play Agent Studio as a build workspace

**Files:**
- Modify: `src/components/studio/play-agent/play-agent-studio.tsx`
- Modify: `src/components/studio/play-agent/play-agent-studio.module.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing rule**

```text
Play Agent Studio should:
- feel like a build workspace
- have one dominant center surface
- make input secondary and drafts tertiary
- stop looking like three equal admin panels
```

- [ ] **Step 2: Keep the existing logic, change the information hierarchy**

Do not change API calls or business logic.
Reorganize the JSX structure inside `PlayAgentStudio` to:

```tsx
<main className={styles.page}>
  <TopNav />
  <div className={styles.shell}>
    <header className={styles.header}>...</header>
    {notice ? ... : null}
    <div className={styles.workspace}>
      <aside className={styles.composerPanel}>...</aside>
      <section className={styles.workSurface}>...</section>
      <aside className={styles.contextPanel}>...</aside>
    </div>
  </div>
</main>
```

Map the old sections like this:

- old `configPanel` -> `composerPanel`
- old `outputPanel` -> `workSurface`
- old `draftsPanel` -> `contextPanel`

- [ ] **Step 3: Rewrite the top shell**

In `src/components/studio/play-agent/play-agent-studio.module.css`, replace the main shell:

```css
.page {
  min-height: 100vh;
  background: #090a0c;
  color: #f3f1eb;
}

.shell {
  width: min(1520px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 72px 0 40px;
  display: grid;
  gap: 16px;
}

.header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-end;
  margin-bottom: 8px;
}
```

- [ ] **Step 4: Replace equal columns with a dominant work surface**

Use:

```css
.workspace {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr) 280px;
  gap: 16px;
  align-items: start;
}

.composerPanel,
.contextPanel {
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 22px;
  background: rgba(14, 15, 18, 0.92);
  padding: 18px;
}

.workSurface {
  display: grid;
  gap: 14px;
  min-height: 720px;
}
```

- [ ] **Step 5: Turn plan, files, cover, events into stacked work artifacts**

Reuse the existing cards but unify them visually:

```css
.templateIntro,
.planCard,
.filesCard,
.coverCard,
.eventCard {
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 22px;
  background: #111318;
  padding: 18px;
}
```

Add a more dominant preview/summary block at the top of `workSurface`:

```tsx
<section className={styles.heroArtifact}>
  <div>
    <span className={styles.eyebrow}>Build Surface</span>
    <h2 className={styles.heroTitle}>
      {plan ? plan.concept : "先生成计划，再运行 Agent"}
    </h2>
  </div>
  <p className={styles.heroSummary}>
    {plan ? plan.loop : "模板、skills 和 prompt 会在这里汇合成可执行的小游戏计划与代码产物。"}
  </p>
</section>
```

- [ ] **Step 6: Make buttons calmer and more tool-like**

Replace button styles:

```css
.primaryButton,
.applyButton {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(243, 241, 235, 0.08);
  color: #f3f1eb;
  font-weight: 600;
}

.primaryButton:hover,
.applyButton:hover {
  background: rgba(243, 241, 235, 0.12);
}
```

Keep only one visually stronger button at a time by adding a modifier for the main action:

```css
.primaryButtonMain {
  background: #f3f1eb;
  color: #0b0c0e;
}
```

Apply `primaryButtonMain` only to the current dominant action in JSX.

- [ ] **Step 7: Make the layout responsive**

Update the media query:

```css
@media (max-width: 1280px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .workSurface {
    order: 2;
  }

  .composerPanel {
    order: 1;
  }

  .contextPanel {
    order: 3;
  }
}
```

- [ ] **Step 8: Run build**

Run: `npm run build`  
Expected: `Play Agent Studio` compiles and current logic still works

- [ ] **Step 9: Commit**

```bash
git add src/components/studio/play-agent/play-agent-studio.tsx src/components/studio/play-agent/play-agent-studio.module.css
git commit -m "style: rebuild play agent studio as build workspace"
```

### Task 7: Simplify the projects page into a project flow surface

**Files:**
- Modify: `src/app/projects/page.tsx`
- Modify: `src/app/projects/page.module.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing rule**

```text
Projects should look like a project flow page, not a hero explainer with admin cards.
```

- [ ] **Step 2: Keep the logic, simplify the content hierarchy**

In `src/app/projects/page.tsx`, preserve:
- create
- import
- rename
- delete
- open

But visually demote:
- oversized hero framing
- count badges
- explanatory copy beyond one sentence

- [ ] **Step 3: Replace page shell styling**

In `src/app/projects/page.module.css`, replace the page shell:

```css
.page {
  min-height: calc(100vh - var(--nav-height));
  background: transparent;
}

.shell {
  width: min(1480px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 18px 0 80px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.libraryHero {
  display: grid;
  grid-template-columns: minmax(320px, 0.86fr) minmax(0, 1.14fr);
  gap: 16px;
  align-items: stretch;
}
```

- [ ] **Step 4: Remove decorative gradients and panel excess**

Replace `.libraryIntro` and `.recentProjectCard`/`.recentProjectCardEmpty` backgrounds with calmer surfaces:

```css
.libraryIntro,
.recentProjectCard,
.recentProjectCardEmpty,
.renameCard {
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 24px;
  background: rgba(16, 18, 22, 0.92);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
}
```

Remove the radial gradient-heavy intro background.

- [ ] **Step 5: Shrink the title and subtitle hierarchy**

Use:

```css
.pageTitle h1 {
  font-size: clamp(28px, 3vw, 40px);
  line-height: 0.98;
  letter-spacing: -0.04em;
}

.librarySubtitle {
  margin: 0;
  max-width: 380px;
  color: rgba(243, 241, 235, 0.52);
  font-size: 14px;
  line-height: 1.55;
}
```

- [ ] **Step 6: Make project cards feel more editorial**

Reduce hard card framing and increase image-led emphasis in the recent/open cards:

```css
.recentProjectVisual {
  background: #0d0f12;
}

.recentProjectTitle {
  margin: 0;
  font-size: 24px;
  line-height: 1.02;
  letter-spacing: -0.03em;
}
```

- [ ] **Step 7: Run build**

Run: `npm run build`  
Expected: projects page still compiles and project actions still function

- [ ] **Step 8: Commit**

```bash
git add src/app/projects/page.tsx src/app/projects/page.module.css
git commit -m "style: simplify projects into project-flow surface"
```

### Task 8: Light cleanup for the interactive film editor shell

**Files:**
- Modify: `src/components/editor/editor-shell.module.css`
- Test: `npm run build`

- [ ] **Step 1: Write the failing rule**

```text
Editor should remain functional but lose the remaining flashy accent residue and panel clutter.
```

- [ ] **Step 2: Search for remaining strong purple/cyan accents**

Run: `rg -n "7c4dff|09c4d9|gradient|glow|box-shadow" src/components/editor/editor-shell.module.css`
Expected: list remaining legacy accent styles

- [ ] **Step 3: Replace legacy accent-heavy backgrounds with neutral surfaces**

Where the file uses strong accent backgrounds for sidebar or inspector regions, replace them with:

```css
background: rgba(16, 18, 22, 0.92);
border: 1px solid rgba(255, 255, 255, 0.07);
box-shadow: 0 12px 24px rgba(0, 0, 0, 0.18);
```

Do not change layout or component logic.

- [ ] **Step 4: Reduce over-bright action emphasis**

Any action button that still uses a loud gradient should move to either:

```css
background: rgba(243, 241, 235, 0.08);
color: var(--color-text);
```

or, for a single dominant action only:

```css
background: var(--color-text);
color: #0b0c0e;
```

- [ ] **Step 5: Run build**

Run: `npm run build`  
Expected: editor still builds with unchanged behavior

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/editor-shell.module.css
git commit -m "style: calm interactive editor shell"
```

### Task 9: Update architecture documentation after implementation

**Files:**
- Modify: `ARCHITECTURE.md`
- Test: `git diff -- ARCHITECTURE.md`

- [ ] **Step 1: Add implementation outcomes to the visual principles**

After the redesign is complete, update section `7. Visual Principles` to reflect:

```md
- Public Platform now uses a cover-first, low-copy, shelf-dense visual system
- Creator Studio now uses a workspace-first visual system, with Play Agent Studio as the first fully rebuilt creator surface
```

- [ ] **Step 2: Add a note under maintenance rules**

Append:

```md
- any major visual-system change that alters public vs creator surface differentiation must update this file
```

- [ ] **Step 3: Review the diff**

Run: `git diff -- ARCHITECTURE.md`  
Expected: only visual-system and implementation-status changes

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: update architecture after ui surface redesign"
```

## Self-Review

- Spec coverage:
  - Public platform redesign: covered
  - Play Agent Studio redesign: covered
  - Projects redesign: covered
  - Editor visual cleanup: covered
  - No route/data-model refactor: preserved
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement appropriately” placeholders remain
- Type consistency:
  - `minimal` card mode is introduced in both usage sites and component definition
  - `studioLink` replaces old CTA naming consistently
  - `workspace`/`composerPanel`/`workSurface`/`contextPanel` are named consistently

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-fun-x-dual-surface-ui-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

