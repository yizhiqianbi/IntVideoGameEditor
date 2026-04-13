# Fun-X-Studio Design System Direction

## Summary

This document defines the visual baseline for `Fun-X-Studio` so the homepage, project library, editor, and agent workspace stop drifting between unrelated styles. The goal is not to copy one product, but to combine three reference strengths into one coherent system.

Selected reference DNA:

1. **Vercel**
   For shell precision, typographic confidence, sparse navigation, and disciplined spacing.
2. **RunwayML**
   For cinematic dark presentation, media-led product entry, and creative-tech energy.
3. **Linear**
   For dense but calm tooling, panel hierarchy, and interaction clarity.

The product should feel like a creative studio with operational discipline. It must not feel like a generic admin dashboard, and it must not collapse into loud gamer UI.

## Chosen Direction

### Brand Position

`Fun-X-Studio` should present itself as a platform with multiple creative product lines, even though only `互动影游` is active now. The homepage therefore acts as a **product-line gateway**, not a project dashboard and not a long-form marketing page.

Current top-level structure:

- `MV`
- `互动影游`
- `互动游戏生成器`

Only `互动影游` is active. The other two should remain visibly intentional but visually quieter.

### Surface Split

The design system should behave differently across three product surfaces:

- **Homepage**: cinematic gateway, short copy, bold line cards, featured case slots
- **Projects**: project-flow view, strong create/open actions, cover-card emphasis
- **Studio**: dark productivity workspace, canvas-first, restrained accent usage

This split is important. The current product was previously trying to explain, manage, and edit from similar visual language everywhere. That makes the product feel muddy.

## Visual Principles

### 1. Dark-first, but not muddy

Use deep charcoal and blue-black surfaces instead of flat black. Panels should separate through subtle tone and elevation differences, not heavy borders.

### 2. Accent is strategic

The violet-to-cyan gradient is the signature accent, but it must only appear in primary CTAs, active focus, and selected hero states. It should not be sprayed across the whole interface.

### 3. Typography does most of the branding work

Use the existing font stack:

- `Space Grotesk` for display and headings
- `IBM Plex Mono` for metadata, tags, states, and operational labels

This gives the product a clean tech-creative voice without needing ornamental graphics.

### 4. Content over explanation

The homepage should not explain the platform at length. The product lines and featured cases should carry the message. The projects page should not teach the system either; it should help users continue work immediately.

### 5. Workspace calm over chrome

Inside the editor and agent workspace, the user should feel that the canvas and content matter more than the surrounding UI. Side panels need strong hierarchy but low visual noise.

## Page-by-Page Application

### Homepage

The homepage should use the strongest amount of cinematic presentation:

- large hero typography
- three product-line cards
- one visually dominant active card
- featured cases below

It should feel closer to a curated product portal than a software landing page.

### Projects

The projects page should feel closer to Linear than to a marketing page:

- fewer explanation blocks
- more direct action
- larger project covers
- stronger “continue work” rhythm

### Editor

The editor should stay dark and focused:

- quieter sidebars
- obvious panel ownership
- minimal duplicate actions
- the canvas remains the center of gravity

### Agent Workspace

The agent workspace should feel like planning inside the same ecosystem, not like a detached product. It should look like a design review room or story planning table, not like an oversized modal.

## Anti-Goals

The product must avoid these directions:

- generic glassmorphism SaaS cards
- bright neon gaming palette
- over-decorated dark UI
- text-heavy homepage sections
- mixing multiple visual personalities on one page
- heavy explanatory copy where direct action would do

## Immediate Next Use

This design baseline should now drive:

1. homepage refinement
2. project library simplification
3. editor hierarchy cleanup
4. agent workspace alignment

The canonical AI-facing version of this direction lives in the project-root `DESIGN.md`.
