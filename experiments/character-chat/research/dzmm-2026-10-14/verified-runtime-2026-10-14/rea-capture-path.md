# REA capture path audit — 2026-10-14

## Result

Current DZMM guest tab has **no demonstrated compatible passive response-body capture path through REA**. This is a transport/lifecycle limitation, not evidence about the target model. No website request, browser action, credential read, private storage access, or endpoint probe was made by this audit.

The installed REA 6.4.0 `capture_browser_scenario` can retain completed HTTP response bodies. However, it is a controlled replay tool, not a passive attachment to the currently open CUA tab. It needs a known literal-loopback CDP endpoint and exact target ID; none is advertised by the current browser context or observed process debug flags. Moreover, its connect lifecycle navigates and mutates service-worker registration behavior. Do not invoke it on this guest tab as if it were passive.

## Observed endpoint discovery boundary

Read-only process inventory identified ChatGPT.app/Codex processes, then inspected only `--remote-debugging-port`, `--remote-debugging-address`, and `--remote-debugging-pipe` flags. **100 matching process rows, zero matching debug flags** at audit time. The initial `/Applications/Codex.app/` filter had no matches; actual app is under `/Applications/ChatGPT.app/`. No browser-profile files, cookies, environment blocks, auth tokens, remote socket state, or guessed ports were examined. This bounded negative result does not prove CDP is absent; it means no supported endpoint was obtained.

No CUA browser number (such as `2`) or CUA tab number may be substituted for a CDP target ID. A legitimate supplied CDP endpoint would first need `list_browser_targets` and a target selected by its observed URL; current constraints do not justify guessing an endpoint or launching a replacement authenticated browser.

## Passive versus controlled capture

| Operation | Supported evidence | Limitation for this task |
|---|---|---|
| `inspect_web_page` | DOM structure, optional accessibility text and script sources, attach-window network metadata, optional value-free JSON shapes | Raw response text is not exposed; cannot identify provider via an unreturned body |
| `observe_web_session` | Navigation, redirect, lifecycle, failure timeline | Does not collect full generation payloads |
| `observe_web_execution` | Precise JS coverage, script text and request initiators | Does not supply response-body contents; changes instrumentation/optimization state |
| `capture_browser_scenario` | Explicit request/response bytes and optional header values, with hashes and states | Needs CDP or selected executable; performs controlled actions/navigation and environment changes |
| `inspect_web_network_capture` | Analysis of a pre-existing HAR/mitmproxy artifact | No such capture was supplied for this runtime; cannot invent one |

## Exact installed connect lifecycle

Source: `browser/PlaywrightScenarioSession.js` lines 31–52 and 103–110; `browser/PlaywrightScenarioBrowser.js` lines 237–267 and 287–323.

1. `connectOverCDP(cdp_endpoint)` and locate the supplied target ID.
2. Configure viewport metrics, locale, timezone and media emulation.
3. `initializePage` calls `blockAttachedServiceWorkers` for **every connect mode**. It evaluates whether a service worker controls the page; if controlled it throws `target_not_allowed`. Otherwise it evaluates code that unregisters service workers and installs a `ServiceWorkerContainer.prototype.register` rejection, including an init script. This invocation is unconditional on `environment.service_workers` in the inspected version.
4. Install explicitly supplied cookies (empty by default) and any declared storage seeds. Empty storage seed lists do not mean the existing attached profile was cleared.
5. Arm network capture.
6. Always `page.goto(start_url, {waitUntil: "load", timeout: 0})`, even when the only requested action is a wait.
7. Run declared actions and disconnect from the externally owned browser on normal cleanup.

Therefore “connect + wait” is not a read-only listener. No invocation was performed here.

## `capture_browser_scenario` input schema

The machine-readable installed input schema is [capture-browser-scenario.input-schema.json](capture-browser-scenario.input-schema.json). It was produced offline from the package's own Zod input schema. It represents input transforms as their input types; runtime super-refinements still enforce unique IDs and valid declared-secret references.

Required:

- `browser`: either `{mode:"connect", cdp_endpoint:<literal-loopback-endpoint>, target_id:<observed-target-id>}` or `{mode:"launch", executable_path:<absolute-path>, headless?:boolean}`.
- `start_url`: `{url:<HTTP-or-HTTPS-URL>, query?:[{name, value:{source:"literal",value} | {source:"secret",secret_id}}]}`.
- `actions`: nonempty explicit steps. Supported actions: `goto`, `click`, `fill`, `press`, `select_option`, `check`, `uncheck`, `wait_for`, `wait_for_timeout`. Most action types accept optional `timeout_ms`; omitted means no action deadline beyond cancellation.

Optional:

- `environment`: defaults 1280×720, scale 1, en-US, UTC, light, reduced motion, blocked service workers.
- `storage`: cookie/local/session seed arrays; empty by default.
- `secrets`: environment-variable references for user-declared redactions/inputs. Never supply or retrieve secrets merely to make a capture work.
- `capture.after_each_step` and `.at_end`: selected artifacts; default only final URL. Do not request storage artifacts for this investigation.
- `capture.events`: console, page-errors, network, websockets, frames, workers, popups, downloads.
- `capture.network`: independent `request_body`, `response_body`, `header_values` booleans, all false by default. Any true value automatically enables network events. There is **no request URL allowlist** in this input schema. Shared-context capture keeps requests with known selected/descendant page frames and excludes unknown attribution.

A future appropriately scoped capture would normally select response bodies only, omit request bodies, omit storage snapshots, and decide separately whether sanitized header values are needed. This note is not an authorization to switch UI transports, mutate the user's browser, or read unrelated responses.

## Body evidence and SSE limitation

Source: `browser/network/PlaywrightScenarioNetwork.js` lines 34–63, 83–113, 146–167; `PlaywrightNetworkContent.js` lines 34–76; `domain/browserNetworkEvidence.js`.

- On response arrival it stores metadata, but deliberately waits for `requestfinished` before `response.body()`.
- A completed body is stored as canonical base64, byte count, SHA-256, media type, and a redaction flag, with representation `browser-decoded-response-bytes`. These are browser-exposed decoded bytes, not original encrypted/compressed network packets or upstream provider traffic.
- Default completed-body read deadline is 5 seconds.
- If streaming remains open at capture cutoff, it reports `unavailable / response-unfinished`, not partial SSE chunks. Cancellation, request failure and body read timeout are also explicit states; the tool never refetches to fill gaps.
- Credential headers (`authorization`, `proxy-authorization`, `cookie`, `set-cookie`) are removed when header values are requested. Body redaction handles declared secrets; it is not a guarantee that arbitrary credential-like fields in JSON bodies are automatically recognized. Avoid broad body capture on authentication/profile routes.

Even a successful DZMM browser response capture could still contain only DZMM's aliased model and text. It cannot by itself expose server-to-provider traffic, original model IDs, exact tokenizer counts, or the composed upstream system message unless the application explicitly returns those values.

## Provenance

Installed sources and SHA-256 digests: [rea-runtime-source-manifest.json](rea-runtime-source-manifest.json). Skill reference read: `/Users/pencil/.agents/skills/reverse-engineer-anything/references/runtime-observation.md`. This audit did not start a REA target session or produce a target-runtime Evidence ID; all findings above are installed-source observations and bounded local process-flag observations.
