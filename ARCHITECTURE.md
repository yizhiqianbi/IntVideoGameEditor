# Fun-X-Studio Architecture

## 1. Product Surfaces

Fun-X-Studio is split into two product surfaces inside one repository.

- `Public Platform`
  - player-facing content discovery and play surface
  - routes:
    - `/`
    - `/play`
    - `/film`
    - `/video`
    - `/play/[slug]`
    - `/film/[slug]`
    - `/video/[slug]`
- `Creator Studio`
  - project library, editor, agent, export, template workflow
  - routes:
    - `/projects`
    - `/pencil-studio-vid`
    - `/pencil-studio-vid/agent`
    - `/pencil-studio-vid/play-agent`

The public platform is not a marketing homepage. It is a content surface. The homepage should always prioritize playable or watchable content over product explanation.
The homepage should behave like a content portal, with cover-first shelves and minimal metadata.
The homepage should read more like a 4399-style content shelf than a marketing landing page: title and cover are primary, copy is suppressed.

## 2. Public Platform Information Architecture

The public platform is organized around three content lanes:

- `Play`
  - playable interactive experiences
  - lightweight minigames and fast interactive content
- `互动影游`
  - narrative interactive film/game hybrids
- `视频`
  - linear watch-only content

Homepage responsibilities:

1. expose recent play and ranked content immediately, but keep the hot zone visually compressed so lane shelves appear earlier
2. expose the three lanes immediately
3. expose a lightweight search entry for fast retrieval across public content
4. show content shelves, not feature cards or product explanations
5. route visitors into the correct lane or detail page

Lane page responsibilities:

1. show lane identity
2. reuse the same shelf-first catalog shell across `Play`, `互动影游`, and `视频`
3. list many entries efficiently
4. support future filters, ranking, and pagination without redesigning the page shell

Detail page responsibilities:

1. go directly into the runtime surface when the content is playable
2. keep metadata secondary and lightweight
3. support fullscreen runtime play/viewing from the unified stage shell
4. leave room for future related-content and recommendation modules

## 3. Core Content Model

Public platform pages should be driven by a unified publishable content entity.

```ts
type PublicContentType = "play" | "film" | "video";

type PublicContentEntry = {
  id: string;
  slug: string;
  type: PublicContentType;
  title: string;
  subtitle: string;
  summary: string;
  coverImageUrl?: string;
  thumbnailImageUrl?: string;
  tags: string[];
  featured: boolean;
  status: "published" | "coming-soon";
  updatedAt: string;
  primaryActionLabel: string;
  runtime: {
    durationLabel?: string;
    playerMode: "play" | "film" | "watch";
  };
};
```

Rules:

- the homepage and lane pages should only depend on this model
- future backend publishing should produce this model
- creator-side project records should not leak directly into public UI

## 3.1 Play Lane Runtime

The `Play` lane is implemented as a shared mini-game platform, not as one-off detail pages.

- route model:
  - `/play`
  - `/play/[slug]`
- runtime model:
  - `MiniGameRegistry`
  - `MiniGameHost`
  - one React component per mini-game

Each mini-game is registered by slug and rendered inside the same runtime shell.
This keeps interaction, restart behavior, scoring summary, and future analytics hooks consistent while allowing many independent games to coexist.
The same shell can host both arcade rounds and chapter-based narrative simulators, as long as they remain single-session, cover-first public entries.

Implementation rule:

- each mini-game lives in `src/components/public/minigames/games/`
- shared chrome lives in `src/components/public/minigames/`
- public catalog entries in the `play` lane must map cleanly to registry slugs
- public game discovery should prioritize cover density over descriptive copy
- home and `/play` should keep titles short and avoid explanatory paragraphs
- runtime stage interactions such as fullscreen should be implemented once in the shared public runtime shell, not per lane
- the `Play` lane should expose:
  - leaderboard
  - recent play
  - lane-local search
  - dense cover grid

## 4. Creator Studio Model

Creator-side work remains project-first.

- `ProjectRecord`
  - source of truth for editable work
- `TemplateLibrary`
  - reusable starting points
- `ProjectPackage`
  - import/export package for continued editing
- `RecoveryDraft`
  - crash recovery and autosave

Agent output should write back into the active project, not into a transient session-only state.

## 5. Storage Layers

### 5.1 Local Browser Storage

Current authoritative local storage layers:

- `Project Library`
- `Project Media`
- `Recovery Drafts`
- `Global Asset Library`
- `Template Library`

These remain local-first and continue to use `IndexedDB`.

### 5.2 Public Content Source

Current implementation can use a local static catalog. This is a staging model for future publishing.

Future expansion path:

1. project in studio
2. export/publish
3. create `PublicContentEntry`
4. surface entry on public platform

## 6. Scaling Principles

The platform must support hundreds or thousands of public entries. To avoid future breakage:

- homepage shelves should only render curated subsets
- lane pages should own full catalog rendering
- keep content metadata normalized and shallow
- do not mix creator-only data into public cards
- reserve room for:
  - sorting
  - filtering
  - pagination or infinite scroll
  - featured curation
  - recommendation rails

## 7. Visual Principles

Public platform:

- simple, content-led, minimal background treatment
- covers do the visual work
- avoid decorative gradients as the main experience
- dark but calm
- closer to a game/media portal or content feed than an AI tool landing page
- card density should resemble a content shelf, not a product dashboard
- public shelves should be cover-first: cover + title are primary, metadata is secondary
- every public-facing game in the `Play` lane must have a cover asset before publication
- every new public mini-game should be published as a pair:
  - one runtime component
  - one dedicated cover asset

Creator studio:

- disciplined dark workspace
- utility over spectacle
- clear hierarchy between canvas, sidebar, and inspector

## 7.1 Creator Skill Layer

Mini-game creation should not rely on ad-hoc prompting alone.

The studio will use a creator-skill layer:

- gameplay skills
- social/retention skills
- cover-direction skills

Current local creator-skill set:

- `funx-instant-arcade`
- `funx-viral-puzzle`
- `funx-meta-retention`
- `funx-social-challenge`
- `funx-browser-inventor`
- `funx-cover-director`

Rule:

- every public mini-game should be created from at least one gameplay skill
- every public mini-game must also pass through a cover-direction skill
- future template-based creation in the studio should allow `template + skill + prompt` composition

## 8. Maintenance Rules

This file must be updated whenever one of these changes:

- route structure
- public content model
- project storage model
- publish/export architecture
- separation of public platform vs creator studio

Architectural decisions that materially change system direction should also get an ADR in `docs/adr/`.

## 9. Play Agent Harness

The repository now includes a creator-side `Play Agent Harness` v1 for browser-native H5 game creation.

This system is split into four layers:

- `play-agent-core`
  - pure TypeScript domain layer
  - templates, skills, plans, artifact bundles, provider contracts
- `play-agent-server`
  - Next.js API routes for session creation, planning, run execution, event fetch, artifact fetch, and apply payload generation
- `play-agent-web-shell`
  - reserved future browser coding shell
  - preferred long-term direction: `xterm.js` + `WebContainers`
- `play-agent-studio`
  - creator-facing route and UI
  - template selection, skill selection, prompt authoring, plan review, run status, preview, apply

Implemented v1 pieces:

- route: `/pencil-studio-vid/play-agent?project=<id>`
- client studio shell under `src/components/studio/play-agent/`
- in-memory server session store under `src/lib/play-agent/sessions.ts`
- stub provider adapter under `src/lib/play-agent/mock-adapter.ts`
- project-local Play draft persistence in browser `localStorage` under `src/lib/play-agent/project-drafts.ts`
- server API surface:
  - `POST /api/play-agent/sessions`
  - `GET /api/play-agent/sessions/[id]`
  - `POST /api/play-agent/sessions/[id]/plan`
  - `POST /api/play-agent/sessions/[id]/run`
  - `GET /api/play-agent/sessions/[id]/events`
  - `GET /api/play-agent/sessions/[id]/artifacts`
  - `POST /api/play-agent/sessions/[id]/apply`

Rules:

- the Play Agent Harness belongs to the creator studio, not the public platform
- it must remain provider-decoupled
- it should accept future external APIs and code plans through adapter interfaces, not direct SDK coupling
- v1 apply writes into project-local Play draft storage instead of mutating the interactive-film editor graph
- it should formalize `template + skill + prompt` as the creation contract for Play generation
