# Fun-X-Studio Design System

## 1. Visual Theme & Atmosphere

Fun-X-Studio is a creative tool, not a generic SaaS admin panel and not a loud gamer UI. The product should feel like a **cinematic creation studio with disciplined tooling**.

Three reference influences define the visual direction:

- **Vercel** for shell precision, sparse navigation, strong typography, and calm spacing discipline
- **RunwayML** for cinematic dark presentation, media-led surfaces, and product pages that feel like creative technology
- **Linear** for tool density, panel hierarchy, interaction clarity, and restrained productivity UI

Use them as design DNA, not as a collage. The final result should feel like one product:

- homepage = cinematic product gateway
- project library = focused creation lobby
- editor and agent = calm dark workspace with clear hierarchy

The product mood should be:

- dark, crisp, controlled
- creative but not chaotic
- premium without looking luxurious for its own sake
- technically confident, not playful or cute

## 2. Product Surface Modes

Fun-X-Studio has three main UI surfaces. Each surface uses the same tokens, but with different emphasis.

### 2.1 Brand Surface

Used for `/`.

Purpose:

- introduce the brand
- route users into product lines
- highlight featured work

Emphasis:

- larger typography
- wider spacing
- stronger gradients and hero atmosphere
- media-first cards

### 2.2 Library Surface

Used for `/projects`.

Purpose:

- manage and resume work
- quickly create or open projects

Emphasis:

- clear primary actions
- strong cover-card structure
- less explanation, more content

### 2.3 Studio Surface

Used for `/pencil-studio-vid` and `/pencil-studio-vid/agent`.

Purpose:

- focused editing and planning
- dense interaction without visual chaos

Emphasis:

- tighter spacing
- stronger panel hierarchy
- subtle accent use
- utility over spectacle

## 3. Color Palette & Roles

Use a dark-first system with one primary gradient and disciplined semantic roles.

### 3.1 Core Surfaces

- `bg.canvas`: `#0b0b11`
- `bg.base`: `#0e0e12`
- `bg.panel`: `#15161d`
- `bg.panel-strong`: `#1b1d25`
- `bg.panel-elevated`: `#232633`
- `line.soft`: `rgba(255,255,255,0.08)`
- `line.strong`: `rgba(255,255,255,0.14)`

### 3.2 Text

- `text.primary`: `#f4f6fb`
- `text.secondary`: `rgba(244,246,251,0.72)`
- `text.tertiary`: `rgba(244,246,251,0.48)`
- `text.disabled`: `rgba(244,246,251,0.32)`

### 3.3 Brand / Accent

- `accent.violet`: `#7c4dff`
- `accent.cyan`: `#09c4d9`
- `accent.gradient`: `linear-gradient(135deg, #6b3cff 0%, #7c4dff 42%, #09c4d9 100%)`

Accent usage rules:

- the gradient is for primary CTAs, selected focus states, and hero highlights
- violet is the dominant interaction color
- cyan is a supporting highlight, not a second equal brand
- never spray accent color across the whole interface

### 3.4 Status

- `success`: `#10c96b`
- `warning`: `#f4c247`
- `danger`: `#ff5a78`
- `info`: `#3ca9ff`

## 4. Typography Rules

Current project fonts are already correct and should remain the baseline:

- **Space Grotesk** = display and UI headings
- **IBM Plex Mono** = labels, metadata, tags, pills, timing, state markers

### 4.1 Hierarchy

- `hero.display`: Space Grotesk, 72-112, 800, tight tracking
- `section.title`: Space Grotesk, 28-40, 700
- `card.title`: Space Grotesk, 18-28, 700
- `body`: Space Grotesk, 14-18, 500
- `meta`: IBM Plex Mono, 11-13, 500-600

### 4.2 Rules

- headings should be tight and assertive
- body copy should be short and direct
- metadata should feel mechanical and calm
- avoid long paragraphs on product surfaces
- do not introduce decorative serif type

## 5. Component Stylings

### 5.1 Navigation

Top navigation should feel Vercel-like in discipline:

- thin, dark, lightly translucent bar
- minimal links
- one clear CTA
- no crowded menus

Logo behavior:

- keep the mark simple
- avoid mascot-like or playful iconography

### 5.2 Primary Cards

There are three major card families:

- product-line cards on the homepage
- project cards in the library
- tool panels in the editor

Shared rules:

- radius: 20-24px on marketing/library surfaces, 12-18px on studio surfaces
- borders should be subtle and soft
- cards should be separated by tone and shadow, not thick borders
- hover should lift slightly, never bounce or glow excessively

### 5.3 Buttons

- primary buttons: gradient pill or gradient rounded rectangle
- secondary buttons: dark surface with soft border
- destructive buttons: dark red surface, not bright solid red
- tertiary actions: text or ghost button

Button copy should be short:

- good: `立即进入`, `新建项目`, `应用到画布`
- bad: long explanatory labels

### 5.4 Tags and Pills

Tags should use IBM Plex Mono and feel operational:

- `Available`
- `Coming Soon`
- `精选案例`
- node state labels

Keep them small, neutral, and precise.

### 5.5 Editor Panels

Editor panels should read like Linear-style work surfaces:

- stable dark panels
- clear spacing
- section titles with minimal chrome
- no decorative gradients inside every panel

The panel hierarchy should be obvious before any text is read.

## 6. Layout Principles

### 6.1 Homepage

Homepage is a **gateway**, not a brochure.

Structure:

1. top nav
2. hero with brand statement
3. three product-line cards
4. featured cases

Rules:

- keep copy short
- let cards and layout do the work
- the active product line should be visibly dominant
- coming-soon lines should still feel intentional, not disabled junk

### 6.2 Project Library

Project library is a **content flow**, not a feature explanation page.

Rules:

- hero should only establish the main action and context
- project cards are the main content
- recent work should feel like continuation, not documentation

### 6.3 Studio

Studio is a **workspace**.

Rules:

- canvas gets the most visual room
- sidebars should be quieter than the canvas
- actions should be grouped by responsibility, not repeated everywhere
- agent workspace should feel like planning, not like an oversized modal

## 7. Depth & Elevation

Use depth to clarify ownership, not for decoration.

- base page = flat dark field
- primary cards = soft elevated panels
- selected surfaces = stronger edge plus restrained glow
- overlays / modals = heavier blur and stronger shadow

Preferred shadow language:

- broad, soft, low-contrast shadows
- no hard drop shadows
- no bright outer glow except on focused accent elements

## 8. Motion & Interaction

Motion should be purposeful and short.

- hover lift: 2-4px max
- fades and transforms: 160-240ms
- avoid springy overshoot
- loading states should look stable, not frantic

Editor interactions should feel solid:

- dragging must feel anchored
- selected states should lock clearly
- avoid flicker between loading and error states

## 9. Do's and Don'ts

### Do

- use short, strong section headlines
- make active product lines visually dominant
- keep editing surfaces calm
- let media covers and visual blocks carry visual weight
- use gradients surgically

### Don't

- do not design like a dashboard template
- do not flood the editor with explanation copy
- do not make every card glow
- do not mix three visual personalities on one screen
- do not use bright gaming neon as the default tone
- do not use soft pastel SaaS cards

## 10. Responsive Behavior

### Desktop

- homepage product lines should read as a 3-column system
- featured cases can remain 3-up when width allows
- project library cards should prioritize cover visibility
- studio sidebars may stay fixed if the canvas remains comfortable

### Tablet

- product cards can collapse to 2 columns or 1 column
- featured cards should preserve cover-first structure
- side panels in studio may collapse into drawers

### Mobile

- homepage becomes stacked sections
- top nav simplifies aggressively
- studio is secondary; do not force the full desktop editor metaphor

## 11. Agent Prompt Guide

When asking an AI to generate or modify UI for this product, use guidance like:

> Build this page in the Fun-X-Studio style. Use a dark cinematic base, Vercel-like shell discipline, RunwayML-like creative product presentation, and Linear-like workspace hierarchy. Keep copy short, avoid generic SaaS cards, and make the active product line or current workspace visually dominant. Use Space Grotesk for headings and IBM Plex Mono for metadata. Accent color should be a restrained violet-to-cyan gradient used only for primary focus and key CTA states.

Additional page-specific guidance:

- **Homepage:** product gateway, three product-line cards, one active line, featured cases below
- **Project library:** creation lobby, large cover cards, minimal explanation
- **Editor:** quiet chrome, canvas-first, dense but calm, clear panel hierarchy
- **Agent workspace:** planning flow, not marketing, not modal overload
