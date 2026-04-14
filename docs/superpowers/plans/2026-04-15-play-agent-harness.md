# Play Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first usable creator-side Play Agent Harness for browser-native H5 game creation, with project-scoped drafts, API routes, a studio UI, and a stubbed execution adapter.

**Architecture:** Keep the harness decoupled from public runtime pages and the existing interactive-film editor model. Use a pure TypeScript core for templates/skills/plans/artifacts, a thin Next API layer for session orchestration, and a project-local draft store for apply-to-project so the system stays local-first and ready for later external provider integration.

**Tech Stack:** Next.js App Router, React 19, TypeScript, IndexedDB project storage, Node test runner (`tsx --test`)

---

### Task 1: Add plan and spec artifacts

**Files:**
- Modify: `ARCHITECTURE.md`
- Create: `docs/superpowers/specs/2026-04-15-play-agent-harness-design.md`
- Create: `docs/superpowers/plans/2026-04-15-play-agent-harness.md`

- [ ] **Step 1: Confirm design scope in repo docs**

Check that the spec and architecture both describe:
- creator-side only
- `template + skill + prompt`
- decoupled provider adapter
- project-local apply behavior

- [ ] **Step 2: Save the implementation plan**

This file is the execution plan for the first implementation slice.

### Task 2: Build play-agent core types and registries

**Files:**
- Create: `src/lib/play-agent/types.ts`
- Create: `src/lib/play-agent/templates.ts`
- Create: `src/lib/play-agent/skills.ts`
- Create: `src/lib/play-agent/prompts.ts`
- Create: `src/lib/play-agent/mock-adapter.ts`
- Create: `src/lib/play-agent/index.ts`
- Test: `src/lib/play-agent/core.test.mts`

- [ ] **Step 1: Write the failing core test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlayAgentPlanInput,
  composePlayAgentPrompt,
  getPlayAgentTemplateById,
  getPlayAgentSkillById,
  runMockPlayAgent,
} from "./index";

test("builds a plan input from template, skills, and prompt", async () => {
  const template = getPlayAgentTemplateById("single-screen-arcade");
  const skills = [
    getPlayAgentSkillById("funx-instant-arcade"),
    getPlayAgentSkillById("funx-cover-director"),
  ];

  assert.ok(template);
  assert.equal(skills.length, 2);

  const planInput = buildPlayAgentPlanInput({
    projectId: "project-1",
    prompt: "做一个 20 秒内能结束、适合排行榜传播的 H5 小游戏",
    templateId: template!.id,
    skillIds: skills.map((skill) => skill!.id),
  });

  assert.equal(planInput.template.id, "single-screen-arcade");
  assert.equal(planInput.skills.length, 2);
  assert.match(composePlayAgentPrompt(planInput), /20 秒内能结束/);
});

test("mock adapter returns a runnable artifact bundle", async () => {
  const result = await runMockPlayAgent({
    projectId: "project-1",
    templateId: "single-screen-arcade",
    skillIds: ["funx-instant-arcade", "funx-cover-director"],
    prompt: "做一个关于港口调度的单屏小游戏",
  });

  assert.equal(result.plan.filesToGenerate.length > 0, true);
  assert.equal(result.files.some((file) => file.path.endsWith("game.ts")), true);
  assert.equal(typeof result.coverPrompt, "string");
  assert.equal(typeof result.previewEntry, "string");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/play-agent/core.test.mts
```

Expected: FAIL because the play-agent core modules do not exist yet.

- [ ] **Step 3: Write minimal core implementation**

Implement:
- template registry
- skill registry
- prompt composition
- mock adapter that emits:
  - concept
  - loop
  - win/fail conditions
  - generated file list
  - simple preview entry

- [ ] **Step 4: Run the core test to verify it passes**

Run:

```bash
node --import tsx --test src/lib/play-agent/core.test.mts
```

Expected: PASS

### Task 3: Add project-local Play draft storage

**Files:**
- Modify: `src/lib/projects.ts`
- Test: `src/lib/projects.test.mts`

- [ ] **Step 1: Write the failing project-draft test**

Add a test that verifies:
- a Play draft can be saved for a project
- drafts can be listed by project
- a saved draft can be overwritten by id

Minimal shape to test:

```ts
type SavePlayDraftInput = {
  projectId: string;
  name: string;
  slug: string;
  templateId?: string;
  skillIds: string[];
  prompt: string;
  bundle: {
    plan: { concept: string; loop: string; controls: string[]; winCondition: string; failCondition: string; coverConcept: string; filesToGenerate: string[] };
    files: Array<{ path: string; content: string }>;
    coverPrompt?: string;
    coverAssetUrl?: string;
    previewEntry?: string;
  };
};
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/projects.test.mts
```

Expected: FAIL because Play draft APIs do not exist yet.

- [ ] **Step 3: Add minimal Play draft store implementation**

Extend the project IndexedDB schema with a dedicated `project-play-drafts` store and export:
- `saveProjectPlayDraft`
- `listProjectPlayDrafts`
- `loadProjectPlayDraft`

Keep this separate from `EditorProject`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
node --import tsx --test src/lib/projects.test.mts
```

Expected: PASS

### Task 4: Add Play Agent session server routes

**Files:**
- Create: `src/lib/play-agent/sessions.ts`
- Create: `src/app/api/play-agent/sessions/route.ts`
- Create: `src/app/api/play-agent/sessions/[id]/route.ts`
- Create: `src/app/api/play-agent/sessions/[id]/plan/route.ts`
- Create: `src/app/api/play-agent/sessions/[id]/run/route.ts`
- Create: `src/app/api/play-agent/sessions/[id]/artifacts/route.ts`
- Create: `src/app/api/play-agent/sessions/[id]/apply/route.ts`
- Test: `src/lib/play-agent/server.test.mts`

- [ ] **Step 1: Write the failing session test**

Add tests that verify:
- session creation returns an id and projectId
- plan generation stores a plan on the session
- run creates an artifact bundle
- apply returns a normalized payload for project draft persistence

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/play-agent/server.test.mts
```

Expected: FAIL because session store and routes do not exist yet.

- [ ] **Step 3: Implement minimal in-memory session store and route handlers**

Use a module-local `Map` for V1 server session state. Do not try to persist sessions server-side.

`apply` should return:

```ts
{
  draftName: string;
  slug: string;
  templateId?: string;
  skillIds: string[];
  prompt: string;
  bundle: PlayAgentArtifactBundle;
}
```

This keeps server routes decoupled from browser IndexedDB.

- [ ] **Step 4: Run session tests to verify they pass**

Run:

```bash
node --import tsx --test src/lib/play-agent/server.test.mts
```

Expected: PASS

### Task 5: Add client API wrapper and studio UI

**Files:**
- Create: `src/lib/api/play-agent.ts`
- Create: `src/components/studio/play-agent/play-agent-studio.tsx`
- Create: `src/components/studio/play-agent/play-agent-studio.module.css`
- Create: `src/app/pencil-studio-vid/play-agent/page.tsx`
- Modify: `src/app/projects/page.tsx`
- Modify: `src/components/editor/editor-shell.tsx`

- [ ] **Step 1: Write the failing UI flow test**

Use a focused behavior test around the core helper functions instead of a full browser test:
- form state can call create session
- plan generation response can render
- apply response can be passed into project draft save

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/lib/play-agent/core.test.mts src/lib/play-agent/server.test.mts
```

Expected: missing UI wiring and API client helpers.

- [ ] **Step 3: Implement the studio route and shell**

The studio page should include:
- template picker
- skill picker
- prompt textarea
- `生成计划`
- `运行 Agent`
- artifact file list
- `应用到项目`
- a list of Play drafts already stored for the active project

Also add entry points from:
- project library cards
- editor sidebar

- [ ] **Step 4: Run core and server tests again**

Run:

```bash
node --import tsx --test src/lib/play-agent/core.test.mts src/lib/play-agent/server.test.mts src/lib/projects.test.mts
```

Expected: PASS

### Task 6: Verification and cleanup

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update architecture doc after implementation**

Promote the harness section from “planned” to “implemented V1” and document:
- core
- session routes
- project draft storage
- studio route

- [ ] **Step 2: Run the full verification set**

Run:

```bash
node --import tsx --test src/lib/play-agent/core.test.mts src/lib/play-agent/server.test.mts src/lib/projects.test.mts
npm run build
```

Expected:
- all targeted tests PASS
- build PASS

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md \
  docs/superpowers/specs/2026-04-15-play-agent-harness-design.md \
  docs/superpowers/plans/2026-04-15-play-agent-harness.md \
  src/lib/play-agent \
  src/app/api/play-agent \
  src/components/studio/play-agent \
  src/app/pencil-studio-vid/play-agent/page.tsx \
  src/app/projects/page.tsx \
  src/components/editor/editor-shell.tsx \
  src/lib/projects.ts \
  src/lib/projects.test.mts
git commit -m "feat: add Play Agent Harness v1"
```
