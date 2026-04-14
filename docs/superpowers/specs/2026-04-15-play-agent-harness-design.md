# Play Agent Harness Design

## Summary

This document defines the first-pass architecture for a decoupled `Play Agent Harness` inside the current `Fun-X-Studio` repository.

The goal is to add a browser-native AI creation framework for H5/web games without tying the product to a single model vendor, a single agent runtime, or a single terminal implementation.

This system is for creator-side `Play` generation, not public runtime play.

Core goals:

- support `template + skill + prompt` as the main creation input
- allow a future external code agent / API / code plan to plug in without rewriting the studio
- expose a web-native creation surface that can later include a browser terminal / file tree / preview
- keep the public `Play` portal and the creator-side `Play Agent` clearly separated

## Constraints

1. The current repository already has a public `Play` platform and a creator studio. The new system must fit into that split.
2. The current creator flow only supports interactive film/game authoring. `Play` creation is missing.
3. The referenced external repository `claude-code` is currently inaccessible (`403 disabled`), so this design cannot depend on reading its internal Harness implementation.
4. The first version should favor clean boundaries over maximum capability.

## Approaches Considered

### Option A: Directly build around one model provider

Use one provider SDK and wire the Play creator UI directly to it.

Pros:
- fastest first demo
- fewer moving parts

Cons:
- tightly coupled to one vendor
- hard to reuse if you later change API or execution strategy
- weak fit for long-term template/skill/data-flywheel goals

### Option B: Full workflow framework first

Adopt a heavy workflow/agent framework such as LangGraph or Mastra as the primary abstraction.

Pros:
- durable execution
- rich workflow semantics
- stronger orchestration primitives

Cons:
- too much framework gravity for V1
- harder to make feel native to this repo
- increases migration cost if you later want a custom harness

### Option C: Recommended: custom Play Agent Harness with web shell

Build a local-first harness inside this repo, using a clean set of internal interfaces inspired by modern agent stacks and web-native coding surfaces.

Recommended technology direction:

- `Vercel AI SDK` style server streaming and provider abstraction
- `xterm.js` for future browser terminal UX
- `WebContainers` as the preferred future in-browser execution layer

Pros:
- decoupled
- fits Next.js cleanly
- can accept your future API and Code Plan with low rewrite cost
- lets us phase capability in gradually

Cons:
- requires initial framework work before flashy demos

Recommendation:

Choose Option C.

## Product Surface

Add a creator-side `Play` authoring mode to the existing studio stack.

New creator flow:

1. user opens a project in the studio
2. user enters `Play Create`
3. user chooses:
   - template
   - one or more skills
   - freeform prompt
4. harness produces:
   - game concept
   - implementation plan
   - files/artifacts
   - preview bundle
   - cover concept
5. user reviews and applies the generated game into the active project
6. later, the game can be published into the public `Play` lane

This is not the same as the existing public runtime. It is an authoring subsystem.

## System Architecture

The Play Agent Harness should be split into four layers.

### 1. `play-agent-core`

Pure TypeScript domain layer. No React and no direct dependency on Next route handlers.

Responsibilities:

- session model
- template model
- skill model
- prompt composition
- plan model
- artifact bundle model
- validation and normalization
- provider adapter interfaces

This layer should be reusable from API routes, background jobs, and future local runners.

Suggested location:

- `src/lib/play-agent/`

### 2. `play-agent-server`

Next.js API layer that orchestrates agent execution and emits structured events.

Responsibilities:

- create session
- load session
- generate plan
- start run
- stream events
- return artifacts
- apply results back into the active project

Suggested location:

- `src/app/api/play-agent/`

### 3. `play-agent-web-shell`

A browser-native execution shell for future code authoring.

Responsibilities:

- web terminal shell
- file tree shell
- preview pane shell
- execution state display

Preferred future stack:

- `xterm.js`
- `WebContainers`

This shell should remain optional in V1. The architecture must reserve space for it now, even if the first implementation only shows plan/artifacts/preview.

### 4. `play-agent-studio`

Creator-side UI for the Play authoring experience.

Responsibilities:

- template picker
- skill picker
- prompt editor
- plan review
- run status
- artifact preview
- apply-to-project action

Suggested location:

- `src/components/studio/play-agent/`
- route entry under creator studio, not public platform

## Data Model

### Template

```ts
type PlayAgentTemplate = {
  id: string;
  name: string;
  category: "arcade" | "puzzle" | "sim" | "narrative";
  starterPrompt: string;
  starterConstraints: string[];
  outputShape: "single-screen" | "level-based" | "chapter-based";
};
```

### Skill Reference

```ts
type PlayAgentSkillRef = {
  id: string;
  name: string;
  kind: "gameplay" | "retention" | "social" | "cover";
  promptFrame: string;
};
```

### Session

```ts
type PlayAgentSession = {
  id: string;
  projectId: string;
  templateId?: string;
  skillIds: string[];
  prompt: string;
  status: "idle" | "planning" | "running" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
};
```

### Plan

```ts
type PlayAgentPlan = {
  concept: string;
  loop: string;
  controls: string[];
  progression?: string;
  winCondition: string;
  failCondition: string;
  coverConcept: string;
  filesToGenerate: string[];
};
```

### Artifact Bundle

```ts
type PlayAgentArtifactBundle = {
  sessionId: string;
  plan: PlayAgentPlan;
  files: Array<{ path: string; content: string }>;
  coverPrompt?: string;
  coverAssetUrl?: string;
  previewEntry?: string;
};
```

## API Surface

Initial API should be explicit and boring.

### Session creation

- `POST /api/play-agent/sessions`

Creates a session for the active project.

### Session read

- `GET /api/play-agent/sessions/:id`

Returns current session state.

### Plan generation

- `POST /api/play-agent/sessions/:id/plan`

Input:

- selected template
- selected skills
- prompt

Output:

- `PlayAgentPlan`

### Run execution

- `POST /api/play-agent/sessions/:id/run`

Starts agent execution against the configured provider adapter.

### Event stream

- `GET /api/play-agent/sessions/:id/events`

Provides structured event updates such as:

- planning started
- plan ready
- code generation started
- file created
- preview ready
- failed

### Artifact fetch

- `GET /api/play-agent/sessions/:id/artifacts`

Returns current artifact bundle.

### Apply to project

- `POST /api/play-agent/sessions/:id/apply`

Writes resulting game files and metadata back to the active project.

## Provider Decoupling

The harness must not know which model provider is being used.

Define one adapter contract:

```ts
type PlayAgentProviderAdapter = {
  name: string;
  plan(input: PlayPlanRequest): Promise<PlayAgentPlan>;
  run(input: PlayRunRequest): AsyncIterable<PlayAgentEvent>;
};
```

This is where your future API and Code Plan will plug in.

The UI and session model should never talk directly to a provider SDK.

## Web CLI Strategy

The product should support a future browser-side coding shell, but V1 should not make that a hard dependency.

### V1

- no embedded terminal required
- show plan, generated files, and preview
- keep the architecture ready for a terminal/file-tree later

### V2+

- `xterm.js` terminal
- `WebContainers` execution sandbox
- browser-side file tree and preview loop

This keeps the first implementation lighter while preserving a path to a real web coding environment.

## Studio Integration

The creator-side studio should gain a `Play Create` entry.

Suggested route:

- `/pencil-studio-vid/play-agent?project=<id>`

This keeps it inside the current creator product surface instead of mixing it into the public platform.

UI flow:

1. choose template
2. choose skills
3. write prompt
4. generate plan
5. review plan
6. run agent
7. inspect files/preview
8. apply to project

## Relationship to Existing Systems

### Existing public `Play` portal

No direct change to the public runtime architecture.

The public portal remains:

- discovery
- play
- ranking
- recent play

### Existing creator project system

The Play Agent Harness writes into current project records.

It should not create a separate project storage universe.

### Existing template / skill direction

This design formalizes the rule already present in architecture:

- `template + skill + prompt`

Templates and skills are not UI decorations. They are first-class creation inputs.

## Error Handling

Failures should be represented as structured session state, not only thrown exceptions.

Required failure classes:

- invalid prompt/template selection
- adapter unavailable
- provider execution failure
- artifact validation failure
- apply-to-project failure

The session should preserve partial artifacts when safe.

## Testing Strategy

### Core tests

- template normalization
- skill composition
- plan validation
- adapter contract tests

### API tests

- create session
- generate plan
- run session
- apply artifact to project

### UI tests

- template + skill + prompt form state
- event stream rendering
- artifact list rendering
- apply-to-project action

## Phased Delivery

### Phase 1

- core types
- session model
- template registry
- skill registry
- API stubs
- studio route shell

### Phase 2

- plan generation flow
- event streaming
- artifact bundle rendering
- apply-to-project

### Phase 3

- embedded preview pipeline
- terminal/file-tree shell
- real provider integration

## Open Decisions

These are intentionally explicit:

1. Session persistence should probably use local project storage first, not server DB.
2. The first provider adapter should be a stub/mock adapter until your real API is provided.
3. The first `Play Create` UI should favor a structured flow over a terminal-first UX.

## Spec Review

This spec is intentionally scoped to the harness and web framework only.

It does not yet define:

- your final provider protocol
- your final code plan schema
- publication workflow from generated game to public portal

Those should be added once you provide the external API and execution contract.
