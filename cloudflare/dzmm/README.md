# DZMM Cloudflare backend

This package runs the DZMM business API on Cloudflare Workers, stores user-owned records and a writable forum in D1, and stores uploaded covers in private R2. D1 and R2 are enabled in production and simulated locally for development. The separate `../dzmm-web` package publishes the DZMM frontend and model chat Worker, while local Next.js routes remain available and share the same chat implementation.

The deployed business API is [dzmm-backend.850587960.workers.dev](https://dzmm-backend.850587960.workers.dev/health). The live deployment binds `DB` to the APAC D1 database `dzmm-db` and `MEDIA` to the dedicated Standard R2 bucket `dzmm-media`, created with the APAC location hint. The R2 subscription is active. On 2026-10-04 the user activated Workers Paid to enable native email sending; its domain, configuration and verified login are recorded in [叙梦邮箱验证码登录](../../docs/xumeng-email-login.md).

The public frontend is [xumengchat.top/dzmm](https://xumengchat.top/dzmm), with [dzmm-web.850587960.workers.dev/dzmm](https://dzmm-web.850587960.workers.dev/dzmm) still available. Both origins use the existing backend through the same Service Binding; publishing or binding them did not recreate or clear the existing database or bucket.

Guest sessions, D1 writes/reads, guest registration, logout, and subsequent password login have been verified against the live Worker. A real 45,358-byte WebP cover was uploaded and downloaded through the Next.js same-origin proxy with identical bytes; image security headers were preserved, another guest received `404` for both read and delete, and the owner could still read the object. Registration and saving the uploaded cover URL in an owned character's D1 record also passed. The logged-in browser displayed the R2 image at its natural 640 × 640 size. An independent owner session then deleted it (`200`), and the next read returned `404`. Upload validation used the media API directly; the page's upload button has not been tested.

## Local development

```sh
cd cloudflare/dzmm
npm ci
npm run db:migrate:local
npm run dev
```

The Worker listens at `http://127.0.0.1:8787`. Wrangler simulates D1 and R2 locally and persists development records under `.wrangler/state`. No Cloudflare account or remote resource is required for these commands. The Next.js proxy should point to this origin through `DZMM_BACKEND_URL`.

```sh
npm run check
npm test
npm run deploy:dry-run
```

`npm test` runs migrations and starts the actual Worker runtime on a free loopback port. Tests use a disposable directory for D1 and R2; they never reset normal development data or a remote database. The test runner removes the directory and stops its own Worker after the tests finish. The earlier 38-test feature pass covered persistence, guest-to-account upgrade, password changes and session revocation, user isolation, record ownership, optimistic concurrency, extended preferences, forum CRUD/replies/votes/reports, Super permissions, request validation, and origin checks. The latest task-center increment passed 61 backend integration tests; its scope and deployment IDs are recorded below.

## Configuration

`wrangler.jsonc` is the local development and test configuration. It contains:

- `DB`: D1 database `dzmm-db` with an all-zero local placeholder UUID. Keep this local config separate from the production resource ID.
- `MEDIA`: R2 bucket `dzmm-media`.
- `APP_ORIGINS`: comma-separated application origins permitted to mutate API data. The checked-in value allows the local Next.js development origins. A proxy that preserves the browser's Origin needs that origin in this list. The dedicated Cloudflare frontend validates browser origins itself and uses the backend's own Origin internally, so it does not need an additional entry. The raw Worker does not allow cross-site credentialed CORS requests.

The compatibility date is `2026-10-02`; `nodejs_compat` enables the server-side password hashing implementation. Secrets must be set with Wrangler secrets or an ignored `.dev.vars` file, never checked into the config.

`wrangler.production.jsonc` is the live configuration. It binds `DB` to D1 database ID `c466b70a-1d70-4e98-9a22-c5e19e20bb06` and `MEDIA` to R2 bucket `dzmm-media`. All formal deployment and remote migration commands must use this config.

## Production deployment

```sh
cd cloudflare/dzmm
npx wrangler whoami --json
npm run deploy:production:dry-run
npm run db:migrate:remote
npm run deploy:production
```

The production scripts expand to:

```sh
npx wrangler deploy --dry-run --config wrangler.production.jsonc --outdir .wrangler/production-dry-run
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
npx wrangler deploy --config wrangler.production.jsonc
```

Confirm the authenticated account is the one owning the existing D1 database before running the remote commands. The dry-run command builds the bundle without publishing it or creating remote resources. The remote migration and deployment commands update the live database and Worker respectively. Do not deploy the local placeholder config.

To connect Next.js to the live API, set this server-side environment variable:

```dotenv
DZMM_BACKEND_URL=https://dzmm-backend.850587960.workers.dev
```

Browsers continue to call `/api/dzmm/backend/...` on their own frontend origin. For a Next.js proxy that forwards the browser's original Origin, add that exact origin to `APP_ORIGINS` before deployment. The dedicated Cloudflare gateway below uses a Service Binding and does not require this backend configuration change.

### Accounts when publishing a new frontend origin

The browser's session cookie and local backups belong to its frontend origin. A new `workers.dev` frontend does not inherit the session or localStorage from `http://127.0.0.1:3010`; its first visit can create a separate guest. Publishing another frontend leaves the existing D1 records and private R2 objects in place.

To continue with the original local guest's records, first register that guest from the local profile page and wait for synchronization, then log in with the same email on the new site. Guest registration preserves the user ID, so the existing characters, conversations, favorites, preferences, and owned R2 covers remain accessible. Existing registered users can log in directly.

The profile page supports a full backup export and restoration of the current account's local recovery copy. It does not provide a full cross-origin backup import. Individual character and conversation imports do not migrate a guest session or give a different account access to the original owner's private covers.

### Independent Cloudflare frontend

The separate frontend package is `../dzmm-web`, deployed with its own `wrangler.jsonc`. Its 2026-10-03 33-role expansion build contained 59 regular files: HTML and JS/CSS plus 56 allowlisted static files (3 brand files, 51 covers, and 2 public catalog JSON files). The first 8-role import produced 26 files and 23 allowlisted assets, while the initial deployment produced 17 files with 14 allowlisted assets. It does not publish source maps, the unrelated root editor, `.env.local`, local output files, or source evidence files. It connects to this existing Worker through a `BACKEND` Service Binding without creating or resetting D1 or R2 resources. Both `/` and `/dzmm` serve the frontend; existing hash links and the `?character=ID` and permitted `?view=` entry links are supported.

The first public-introduction import, published on 2026-10-02, contained 8 imported public introductions and 10 original rewritten samples, for 18 roles. The imported `description` values preserve the visible Lumivale introduction verbatim and retain the author, source page, SHA-256, and `promptOrigin: "public-verbatim"`; unknown independent prompt fields remain empty. The frontend uses each introduction as the chat setting, labels its source, and includes source information in exported `creator_notes`. Eight newly downloaded WebP covers are public static assets. This first import was published as backend version `d8f66cce-4746-4b2c-9cf4-38d7c60cb22d` and frontend version `2ab121f1-c7e0-40b3-8d89-218d70217187`. Its browser checks displayed the catalog and role `3021605` with the unchanged 743-character introduction and a loaded cover. All 7 checks in `../../output/dzmm/lumivale-import-verification.json` passed: the published 8-role JSON matched the local text and metadata, introduction SHA-256 values remained intact, all 8 cover images matched their local bytes and hashes, backend/D1 health passed, and all 18 catalog covers loaded without horizontal overflow. This first import performed no test writes to production D1. Public catalog imports do not insert public roles into private D1 tables or change private records or R2 objects.

#### 2026-10-03 published expansion

The new batch adds 33 previously unimported public introductions from four real SFW category views: popular, newest, highest rated, and this month's popular. Its full source text totals 24,292 JS UTF-16 code units. The current shared catalog contains 41 public introductions totaling 30,347 code units and the unchanged 10 original rewritten samples, for 51 roles. This batch added 33 covers, bringing the total to 51 local covers. The four views overlap and do not establish all-site coverage; no complete original card, hidden system prompt, or worldbook entry text was obtained.

Source evidence is `../../output/dzmm/lumivale-expansion-2026-10-03.json`, cover records are `../../output/dzmm/lumivale-expansion-covers-2026-10-03.json`, and independent runtime-text evidence is `../../src/lib/dzmm-public-introductions-evidence.json`. The published JSON mirror matches the shared runtime data byte for byte. Source pages, authors, introduction hashes, and empty unknown prompt fields remain attached to each public record.

Both Workers are published for this batch: backend version `ba895ae4-301b-4902-b790-adace79ec808` and frontend version `f4fbc187-5345-4d0a-ba75-a3108739c4a8`. All 8 production checks in `../../output/dzmm/lumivale-expansion-verification-2026-10-03.json` passed. The public JSON matches local bytes and independent introduction evidence, both existing original-sample datasets remain unchanged, all 51 deployed covers match local bytes and SHA-256, and backend/D1 health passes through the gateway. The live browser displays 51 role articles and 51 loaded covers without horizontal overflow, preserves role `3691277`'s complete 3,739-code-unit introduction and source/author display, and puts new roles first in the newest view. Screenshots are `../../output/dzmm/lumivale-expansion-production-detail-2026-10-03.png` and `../../output/dzmm/lumivale-expansion-production-latest-2026-10-03.png`.

All 34 shared module tests (11 character, 12 storage, 11 chat/context), 23 isolated D1 backend tests, and 18 web Worker tests passed, together with both packages' type checks, ESLint, frontend build, and dry-run. Production verification made no database test writes. This catalog update ran no D1 migration, inserted no public roles into private tables, and did not change LLM configuration. The first import's version IDs and passed checks above remain historical evidence only.

The frontend gateway validates the original browser Origin before proxying same-origin `/api/dzmm/backend/*` requests. The internal request uses the backend's own Origin, so this path does not require changing the backend's existing `APP_ORIGINS`. The gateway forwards only permitted headers and the `dzmm_session` cookie, preserves Set-Cookie and image security headers, and passes the trusted edge client IP for the backend's authentication rate limits.

The public site's model credential has been configured as a `DZMM_API_KEY` Worker Secret through standard input. Keep it out of Vite variables, static browser bundles, and plaintext Wrangler variables. The public chat Worker calls OpenRouter; its default model is `qwen/qwen3-30b-a3b-instruct-2507`, with optional `DZMM_FAST_MODEL`, `DZMM_BALANCED_MODEL`, and `DZMM_STORY_MODEL` overrides. `GET /api/dzmm/chat` exposes configuration status and model names. POST requires a server session; guests are valid users and an absent session returns `401`. `CHAT_RATE_LIMITER` separately limits each user and client IP to 6 chat requests per 60 seconds, returning `429` and `Retry-After: 60` when limited. [Cloudflare rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy) is local to an edge location and eventually consistent. It is not an exact billing quota or a global spending cap.

Publish the frontend without changing the backend database or bucket:

```sh
cd ../dzmm-web
npm ci
npm run check
npm run test:web
npm run deploy:dry-run
npx wrangler secret put DZMM_API_KEY --config wrangler.jsonc
npm run deploy
```

Enter the model credential at Wrangler's prompt; do not put its value in a command or config file. Once the Secret is configured, ordinary subsequent deployments reuse it. `npm run secrets:sync` can also pass the selected local model key to Wrangler through standard input; it does not create a secret file or upload the root `.env.local`. Other model settings remain explicit Worker variables. The frontend deploy script publishes only its Worker and static assets; it does not apply D1 migrations. The `dev` and `preview` scripts run the Vite page only. Use the deployed Worker, or `dev:worker` connected to the business Worker, to exercise complete account, proxy, and model flows.

The initial deployment passed 38 shared DZMM tests, 22 backend integration tests, and 18 frontend gateway tests. Frontend type checks, ESLint, and the deployment dry-run also passed. The gateway tests cover Origin validation, cookie and trusted IP forwarding, media bytes and security headers, request limits, invalid sessions, both rate limit keys, sanitized errors, SSE/UTF-8 chunks, output truncation, and provider cancellation. A real local two-Worker smoke test passed account, D1, and owner-isolated R2 flows using temporary storage; model protocol tests use a simulated provider. These historical results do not establish verification of the subsequent 8-role import.

For the 8-role import, both packages passed type checks and the frontend passed ESLint, build, and dry-run. All 23 catalog/storage tests, 11 shared chat/context tests, and 23 isolated backend tests passed. The separate `../../output/dzmm/lumivale-import-verification.json` report records 7 passed checks for this published import, without test writes to production D1.

The initial deployment's frontend verification script passed 13 checks, including HTML/logo delivery, model configuration, anonymous chat `401`, foreign Origin `403`, JSON API `404`, secure guest cookies, exact R2 upload/download bytes and owner isolation, D1 persistence and `409`, guest upgrade preserving the user ID, another client's login restoring records, invalid chat `400`, and logout. A browser login restored the separate test account's 1 character and 1 favorite and displayed its private R2 cover at 640 × 853. These results verify the new site's test-account flow; the original local guest still requires its owner to register before logging in on the new origin.

The initial deployment's browser also received a real 70-character `x-ai/grok-4.6` reply through the chat Worker. Reloading the conversation from D1 and refreshing the browser preserved all 3 messages: the opening, user input, and model response. The profile and chat screenshots are `../../output/dzmm/frontend-cloudflare-profile.png` and `../../output/dzmm/frontend-cloudflare-chat.png`. The initial deployment's character catalog loaded all 11 image elements with no broken images or horizontal overflow, recorded in `../../output/dzmm/frontend-cloudflare-characters.png`. Production cancellation has not been tested separately; local and simulated-provider cancellation checks passed.

The initial deployment's final report, `../../output/dzmm/frontend-cloudflare-verification.json`, contains 16 passed checks and `cleanupCompleted: true`. The 2 synthetic users and their D1 records were removed, with 0 matching users remaining. The owner deleted the test R2 image (`200`), its next read returned `404`, and the temporary test credential file was removed. The browser signed out of the test account and returned to an ordinary guest. Existing user data and objects were preserved.

From `../dzmm-web`, use these commands to repeat the live checks and clean up their fixtures:

```sh
npm run verify:production -- https://dzmm-web.850587960.workers.dev
# Perform any desired browser checks with the temporary synthetic test account.
npm run verify:cleanup
```

The verification script creates synthetic accounts, records, and an uploaded image and temporarily stores test credentials for browser verification. Cleanup is limited to the accounts and image identified by that report; the cleanup command is safe to repeat. `npm run secrets:sync` updates only the selected local model key in the frontend Worker Secret.

Production cover uploads use the existing backend `MEDIA` binding. Uploaded objects are private and served through the authenticated backend and the frontend's same-origin proxy; the bucket does not need a public URL. Sample covers are included in the dedicated frontend assets and remain available from local Next.js. A backend deployment that omits `MEDIA` returns `503` for the media API.

The current live registration/login flow passes with the existing scrypt parameters. When deploying to a different account, verify the Workers plan and CPU telemetry if password operations return resource-limit errors. Workers Free and Paid have different CPU budgets; consult the [official CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Local tests and request wall time do not establish the deployed CPU budget, and changing password hash parameters is not a substitute for checking the platform limits.

## API contract

Private endpoints authenticate through the server session cookie. Call `POST /v1/auth/guest` for a guest session, or use the register/login endpoints for an account. Guest registration retains the same owned records. Forum reads also accept a guest session; forum writes require a registered account. The session cookie is HttpOnly; API state and backups contain no session token or password hash. The returned user includes a server-assigned `role` of `user` or `super`.

- `GET /v1/session`: current user.
- `POST /v1/auth/guest`, `/register`, `/login`, `/logout`: session lifecycle. Register/login accept an email and password; registration also accepts a nickname.
- `POST /v1/auth/password`: registered users submit `{ accountId, currentPassword, newPassword }`. The account ID must match the current session. The current password must match; a verified email account without a password may submit an empty current password to set its first password. Success returns the same account ID and revokes other sessions while retaining the requesting session. Guest accounts cannot change a password before registering.

Email code login adds `/v1/auth/email/config`, `/request`, and `/verify`, together with additive migration `0010_email_auth.sql`. Native Cloudflare Email Sending, expiry, single use, request limits, account pins and legacy mailbox ownership checks are documented in [叙梦邮箱验证码登录](../../docs/xumeng-email-login.md). Missing provider configuration keeps the feature disabled; local acceptance tests simulate only the mail provider, with real disposable transactional D1. Production mail delivery must be verified separately.
- `GET /v1/state`: `{ state, version, initialized, user }`.
- `PUT /v1/state`: `{ state, version, accountId }` atomically replaces the current user's application state. `accountId` must match the server session so an old browser tab cannot write into a newly signed-in account. A stale revision returns `409` with the current state.
- `/v1/characters`: list/search and owner create; `/:id` edits or deletes an owned character.
- `/v1/conversations`: owner list/create; `/:id` reads, edits or deletes a conversation; `/:id/messages` replaces its messages.
- `/v1/favorites/:id`: add/remove a favorite.
- `PATCH /v1/preferences`: update the current user's settings.
- `POST /v1/media`: upload a PNG, JPEG or WebP cover as a raw binary request with its image Content-Type. Maximum size is 5 MB; the file signature must match the type. The result contains an owner-scoped key and a same-origin proxy URL.
- `GET` / `DELETE /v1/media/:userId/:filename`: read or remove an owned cover. Other users receive `404`.
- `GET` / `POST /v1/forum/posts`: paginated topic listing/search and topic creation. Query filters include `category`, `q` (up to 120 characters), and `tag`.
- `GET` / `PATCH` / `DELETE /v1/forum/posts/:id`: topic detail with paginated replies, topic editing, and deletion. Editing/deletion requires the author or Super.
- `POST /v1/forum/posts/:id/replies`, `DELETE /v1/forum/replies/:id`: reply creation and author/Super deletion.
- `PUT /v1/forum/posts/:id/vote`: `{ value: -1 | 0 | 1 }`; one current vote per account, with `0` removing it.
- `POST /v1/forum/posts/:id/report`: `{ reason }`; a repeated report by the same account is idempotent.
- `GET /v1/forum/reports`, `PATCH /v1/forum/reports/:id/status`: Super-only report listing and review. Reviews accept `resolved` or `dismissed`.

The schema version inside `state.version` is separate from the top-level database revision `version`. State replacement requires the database revision to prevent lost updates. Individual record mutations can also provide a revision.

JSON requests are capped at 2 MiB. One state synchronization may change up to 500 entity rows; unchanged messages do not count toward that limit. Large initial imports need to be split into smaller changes. Authentication and cover uploads are rate limited by the server.

The bundled public character catalog is read-only. The first published catalog combined 8 sourced public introductions with 10 original rewritten samples; the verified 2026-10-03 expansion contains 41 sourced introductions plus the same 10 samples, for 51 roles. `sourceKind: "public-summary"` describes the public metadata source; `promptOrigin` distinguishes `public-verbatim` introductions from `original` prompts. A user can create an owned copy with a new ID. Private import and D1 serialization continue to treat owned copies as editable original records rather than trusting provenance asserted by arbitrary JSON. Catalog API results contain the public catalog plus the authenticated user's private characters. They never expose another user's private roles or chats.

The final feature-pass deployment is frontend version `a4238908-0335-4eda-b4f4-06874675ab78` and backend version `50afd219-e3f2-477b-8f3e-88846d82ff26`. All 9 checks in `../../output/dzmm/feature-replica-verification-2026-10-03.json` passed, including exact public manifests/client build, 41 introduction hashes, unchanged 10 samples, 37 verified author IDs, all 68 deployed role/gallery/category image bytes, the rendered opening, backend/D1/model health, 9 Super authorization/session checks, and 99 automated tests. The production resource audit is read-only and creates no forum test posts; authorized additive migrations and Super provisioning are recorded separately. The browser report is `../../output/dzmm/feature-replica-browser-verification-2026-10-03.json`. Source exploration records 17 page snapshots; `fullSiteCoverage` remains `false`.

## Extended preferences and administration

Migration `0002_preferences_extras.sql` adds `preferences.extra_json`; `0003_forum.sql` adds topics, tags, replies, votes, and reports; `0004_super_accounts.sql` adds the account role. These are additive migrations against the existing database. Forum content is separate from private account state replacement, so saving a profile or restoring a backup does not replace public forum records.

The shared validator and backend enforce the optional preferences below. Existing nickname, persona, model, and active preset fields retain their original contract.

| Field | Accepted values / limit |
| --- | --- |
| `bio`, `gender` | Up to 500 characters; `male`, `female`, or `other` |
| `theme`, `homeLayout` | `light` / `dark` / `system`; `single` / `double` |
| `showFloatingChat`, `floatingSize`, `floatingOpacity` | Boolean; `small` / `medium` / `large`; 20–100 |
| `blockedTags` | Up to 50 full tags, each up to 40 characters |
| `followedAuthors` | Up to 200 author IDs, each up to 120 characters |
| `presets` | Up to 30 `{ id, name, content }` records; name up to 80 and content up to 8,000 characters |
| `maxTokens` | Integer from 128 through 4,096; chat defaults to 2,048 |

Guest and public registration requests containing `role` are rejected. Registration always creates an ordinary user, and saving state/preferences cannot grant administrative permissions. A trusted operator assigns Super through the Cloudflare CLI to a verified specific account. `scripts/provision-super.mjs --check` checks the existing configuration; `--provision` explicitly provisions/verifies the account and assigns its role through the production D1 CLI. Its credential file is outside the repository, with mode `0600`; passwords, hashes, and cookies are omitted from logs and public docs. The production Super account has been created and its temporary management session revoked; the non-secret verification report is `../../output/dzmm/super-account-verification-2026-10-03.json`.

Super can edit/delete forum topics, delete replies, and review reports; ordinary users can edit/delete their own topics and delete their own replies. This is a working manual moderation path. Forum records and counters are real D1 data, with no demonstration posts or invented votes/replies.

The preceding source-exploration run passed 99 tests: 38 backend, 43 shared module/chat-route, and 18 web Worker tests, including configurable reply-token/UTF-8 context budgets. Earlier test counts and deployment IDs in this README describe their historical batches. Current page coverage and source evidence are in `../../docs/dzmm-feature-coverage.md`.

This package does not implement email verification/recovery, paid subscriptions or billing, source-site accounts/social synchronization, voice, image generation, novels, or every source-site professional worldbook extension. Historical daily/weekly/monthly/competition rankings have not been imported. Group chat is excluded at the user's request.

## 2026-10-03 character creation and publishing increment

`0005_character_context.sql` adds `characters.context_json` for validated, user-supplied advanced fields: system prompt, post-history instructions, message examples, alternate greetings, multiple user/assistant opening messages, character book, display introduction, gallery, and suggested replies. The same shared parser preserves these through imports/exports, backups, D1 serialization, and chat requests. Display-only introduction and suggested replies are not inserted as character instructions; enabled/triggered worldbook entries are included within the existing context byte/character budgets. The collected 51-role catalog is unchanged.

`0006_character_publishing.sql` adds publications and immutable submission revisions. Private drafts are still private; an explicit registered-user submission creates a pending snapshot, and only Super approval lists that revision. New pending edits keep the old approved revision online. Authors can withdraw pending updates; an owner or Super can unpublish, which also withdraws pending updates. Rejection requires a reason. Every publication change uses an expected `version`; a stale action returns `409`. Browser callers provide `accountId`; a supplied ID differing from the server session returns `401`. Public source claims, reserved public IDs, and caller-supplied publication identity are rejected.

The `handlePublishingApi(request, env, user?)` router runs before ordinary session routing. Only the approved catalog and approved image GETs are anonymous; remaining routes require a session, and writes require a registered user. `readPublishedCharacters(env, { offset?, limit? })` returns only listed approved cards (default/maximum helper batch 100); `readPublishedCharacter(env, id)` resolves one currently listed revision. Private state cannot shadow a `published-` ID. Published characters use a new ID and server-assigned author identity, with no private chat, credential, or source draft ID exposed.

| Publishing endpoint | Contract / permission |
| --- | --- |
| `GET /v1/publishing/catalog`, `/catalog/:id` | Anonymous approved catalog, default page 20, maximum 50, or one approved card |
| `GET /v1/publishing/media/:publicationId/:revision/:slot` | Anonymous access to the currently listed approved revision's copied `cover` / `gallery-N` asset |
| `GET /v1/publishing/mine` | Current user's publication statuses, versions, and latest submission; paginated |
| `POST /v1/publishing/submissions` | Registered author submits `{ character, publicationId?, version?, accountId? }`; direct normalized snapshot avoids background-sync races; existing publications require the current version |
| `GET /v1/publishing/submissions?status=...` | Super-only latest-revision review queue; paginated |
| `GET /v1/publishing/submissions/:id` | Author/Super reads the submitted snapshot and review reason |
| `GET /v1/publishing/submissions/:id/media/:slot` | Author/Super-only uploaded image preview; approved snapshots use their copied assets even after the private original is deleted |
| `POST /v1/publishing/submissions/:id/withdraw` | Author withdraws pending latest revision with `{ version, accountId? }` |
| `PATCH /v1/publishing/submissions/:id/review` | Super submits `{ version, decision: approved/rejected, reason?, accountId? }` |
| `POST /v1/publishing/publications/:id/unpublish` | Author/Super takedown with `{ version, accountId? }` |

A submitted character needs an AI main opening and at least one prompt-bearing description/personality/scenario/system instruction. Incomplete private drafts can still be saved. Snapshots are capped at 256 KiB, page sizes are bounded, and registered-user writes are rate limited.

Uploaded cover/gallery references must belong to the submitting user. Approval copies those R2 objects into a separate publication namespace before the conditional approval transaction. Public URLs resolve only the active approved revision, while original private media remains owner-only. Losing concurrent approvals clean up only their own uniquely named copies; deleting an original private object does not delete an approved copy. Takedown or revision replacement makes the previous public image route return `404`.

The creation UI provides quick/professional steps, rich openings/worldbook editing, uploads, private draft save/test, and import/export. Voice, automatic AI image/card generation, paid publishing, public preset markets, account recovery, and every source worldbook extension remain outside the current implementation.

Production migrations `0005` and `0006` are applied. This creation/publishing batch used backend deployment `d0789721-60f4-4278-a380-cdee02518a89`, paired with frontend `d4b26ccd-4531-4912-b86d-d2e26becf575`. This increment passed **118 automated tests: 52 backend, 48 shared module/chat-route, and 18 web Worker tests**. The backend's 12 publishing cases include concurrent/stale transitions, ownership and account binding, snapshot completeness, published character favorites/conversations, private-ID shadow rejection, and copied-image isolation/preview after deletion of originals. The five production API smoke checks passed; results are in `../../output/dzmm/studio-production-api-smoke-2026-10-03.json`.

The complete increment report is `../../output/dzmm/studio-replica-verification-2026-10-03.json`. All 13 production browser checks passed for save/reload of advanced fields and worldbook, ordered openings, alternate greetings/suggestions, unsaved navigation, creator center, and the registered-account publishing gate. The 721px viewport had no horizontal overflow or broken images. Temporary private cards/conversations were deleted and synchronized, with no public production submission created. Full publication transitions and copied-media behavior were tested using isolated local D1/R2; this browser pass did not issue a paid model generation request. The 99-test feature-exploration report above remains historical evidence for that previous pass.

## 2026-10-03 task center and browser installation increment

The latest deployed backend version is `d768cfe1-62e7-4c40-b81c-874a97620dc7`, paired with frontend `c10865b6-70e0-4cad-8d7b-2db7132476f4`. Production migration `0007_task_claims.sql` is applied. It adds an account-scoped community reward ledger without changing saved character context or the original static datasets. The user purchased `xumengchat.top`, registered through 2027-10-03, and its bare domain is now bound to `dzmm-web` Production with an active Cloudflare zone and Universal certificate. The earlier one-year Porkbun cart displayed US$1.63 total and US$4.63 renewal; that remains an observed historical quote. No `www` binding was added, and the original `workers.dev` frontend remains available. Current evidence is in `../../docs/dzmm-custom-domain.md`.

`GET /v1/tasks` returns the current session's actual progress, current reward balance, expired/expiring points, and up to 20 recent claims. Guest sessions can read their own progress; an absent session returns `401`. `POST /v1/tasks/:id/claim` requires a registered user and a body containing only `{ accountId }`, matching the server session. Conditions are queried from D1 and rechecked in the insertion statement. The unique `(user_id, task_id, period)` key prevents duplicate or concurrent awards; an already claimed reward returns `409`, incomplete conditions return `400`, and a guest claim returns `403`. The existing Origin checks and claim rate limits apply.

| Task ID | Server-side condition | Community reward |
| --- | --- | --- |
| `daily_checkin` | Registered account; one claim per UTC calendar day | 5 points, expiring exactly 30 days after the claim |
| `first_conversation` | At least one owned, persisted message with role `user` | 5 points, once |
| `publish_character` | At least one owned publication whose approved revision is currently listed | 20 points, once |
| `follow_authors` | At least five distinct authors in validated saved preferences | 5 points, once |
| `complete_profile` | Saved profile `bio` contains non-whitespace text | 5 points, once |
| `forum_reply` | At least one existing forum reply belonging to this user | 5 points, once |

Daily periods reset at UTC 00:00 / China Standard Time 08:00. One-time rewards have no expiry and cannot be earned again after deleting the qualifying record or taking down a publication. The balance excludes rewards whose expiry is at or before the server time. Responses explicitly state `pointsKind: "community"` and `modelBillingLinked: false`: these points do not pay for, deduct from, or control LLM requests, and no source-site credit balance is imported. The client contract is `../../src/lib/dzmm-tasks.ts`; the backend router is `src/tasks.ts`.

Source evidence `../../output/dzmm/source-extra-pages-2026-10-03.json` records 10 newly observed UI states, including the 21-task source center, app download page, quest tabs/empty states, drawing controls, novel directory, and community/advertising outlines. This implementation provides six tasks supported by this site's data; it does not claim all 21 source tasks or source credit/Telegram/VIP integration. Quests, novels, and image generation have been explored but are not fully implemented.

The frontend's installation page provides real browser PWA/manual installation guidance for iPhone/iPad, Android, and desktop. A browser-supplied install prompt is used only when available. `/dzmm/manifest.webmanifest` declares standalone launch and serves actual 192px/512px PNG icons. There is no native APK or app-store package; cloud records and model conversations require network access.

This batch passed **61/61 isolated Worker/D1/R2 integration tests**, including nine new task cases for actual conditions, account binding, forged inputs, guest upgrades, deletion/takedown behavior, expiry, isolation, and 20 concurrent daily claims awarding exactly one ledger entry. The read-only production task/PWA API report `../../output/dzmm/extra-pages-production-api-2026-10-03.json` passed **6/6 checks**: temporary Super login, task-center read with six tasks, anonymous task rejection, manifest, and both icon assets. No production task state was mutated, and the temporary login session was revoked. Earlier test counts and deployment IDs above remain records of their own batches.

The final batch report `../../output/dzmm/extra-pages-replica-verification-2026-10-03.json` records **8/8 production browser checks** for six real guest tasks and refresh, the registration gate preserving guest records, install/manual guides and keyboard platform switching, manifest, and a 742px layout with no broken images or horizontal overflow. The in-app browser did not expose a native `beforeinstallprompt`; this pass verified the manual guidance and published resources, not completion of a device's native installation. No production reward was claimed.

Subsequent custom-domain verification passed **19/19 API checks** in `../../output/dzmm/custom-domain-api-verification-2026-10-03.json` and **6/6 browser checks** in `../../output/dzmm/custom-domain-binding-2026-10-03.json`. HTTP redirects preserve path/query and use HTTPS; cookies are Secure and host-only, and foreign-Origin mutations return `403`. Signing into both origins with the same existing Super account returned identical account identity, state hash and revision. Both temporary login sessions were revoked. No private business records were written, no private media read, and no paid model request made. Binding the new frontend origin did not require redeploying application code or changing backend `APP_ORIGINS`.

## Cloudflare references

- [Wrangler configuration and bindings](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 local development and persistence](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [D1 migrations commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Wrangler whoami](https://developers.cloudflare.com/workers/wrangler/commands/general/#whoami)

These official docs confirm that `--local` simulates the resources, `--persist-to` controls the local data directory, and local R2 bindings write to local storage rather than the deployed bucket.
