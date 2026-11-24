# Character Chat contract · 2026-10-11

Local, text-only, zero dependencies, Node >=22, port3227. Original adult Yume/Nari; no claim to recover a proprietary prompt. Atomic private local storage in `.data/sessions`. Parent project changes are out of scope.

## Engine

`createSession({characterId,mode='ai',now})`: UUID session, revision0, authored assistant opening, locale auto/zh, independent messages/memories/state/style/receipts. `characterBeat` optionally records the opening's fictional current focus/feeling/want with `scope:'fictional-character'`, runtime age and an actual assistant source ID. It is not user memory or a reasoning trace.

`prepareTurn(session,text,{locale,now})`: clone; nonblank text<=4000; resolve language/style, temporary request scope and topic closure without a disk mutation. Explicit current requests beat old preferences. Generic current-topic closure also retires current character material.

`buildMessages(prepared,text)`: private character → runtime/background state → 1–2 relevant independent named system examples → attributed real history → actual user input → short current writer instruction / JSON contract. Never append a fake user turn for proactive generation. No relationship label gates the voice. Background focus need not appear in every reply; runtime age/retired focus helps stop stalled scenes. Recent history uses the last12 user exchanges under a12000-character budget; older source excerpts are bounded. Storage retains<=400 messages.

`conversation-direction.mjs`: recent actual assistant parts are grouped by their turn IDs (authored opening excluded). Open/choice/switch/extend/affection/initiative writing hints softly downweight recent broad topic families, speech acts and copied examples. Request-stable seed avoids random changes on retries; independent sessions can differ. No optional random direction is added to concrete grounded input, brief/quiet/task/arrival. Explicit subject and style requests override novelty; switch must contribute actual new content. These derived hints are not persisted, user facts, model reasoning or quality scores. Lexical matching is approximate. Emotion and message count remain model choices within the response contract.

`parseResponse(content,{currentUserText,allowEmpty=false})`: accepts structured `{messages:[string],emotion,beat?,followUp?}`. Foreground1–3 nonempty strings, <=600 chars each, <=1800 total; initiative permits[]. `beat` has3 nonempty<=120-character strings `{focus,feeling,want}`; model cannot set runtime age or source. `beat:null` means no new creative state, just like omission; it does not clear or reset the prior beat. `followUp:null` ends the current chain; object `{intent,delaySeconds}` requires nonempty intent<=140 and a finite number clamped12..120; absent means runtime default. JSON is validated before any persisted commit. Legacy reply<=3000, sourced memory/delta fields remain compatible.

`commitTurn(prepared,text,result,{requestId,now})`: one user plus1–3 assistant parts; shared turn attribution/part indices; one revision/receipt/memory/relation settlement. Exact current-user quotes only for persistent facts; manual corrections override previous statements; conservative extraction may miss complex facts. Style commands never become identity facts. New user replaces old initiative plan and resets its budget; quiet/leave pauses it. Nonempty replies update character fiction with an assistant source; its age is application-managed. Repeated/stalled focus is retired into a bounded archive; closed/retired material cannot be reintroduced as an active focus unless explicitly reopened.

`initiativeEligibility(session,{now})` => `{eligible,reason,anchorId,planId,waitMs,nextAt?}`. Opening or latest actual user can anchor a plan. No mutation during eligibility reads. Initiative defaults enabled, respects quiet/disabled/budget/expiry. First opportunity>=12sec, subsequent>=35sec; plan TTL<=5min, maximum3 model attempts until new user input. An empty valid result also spends budget.

`rearmInitiative(session,{now,force?})`: visible-page presence may replace an expired/missing plan with a fresh reconsideration; never execute stale intent, reset budget or clear quiet. Revision increases only when a new plan is created. Legacy derived fresh plan is returned with stable ID without a disk write/revision increase.

`buildInitiativeMessages(session,{now})`: real history, private character, current intent and background fiction; may contribute an actual new thought, small progress/emotion or stay quiet. Prior complete reply does not prohibit initiating. No coercive check-ins or fake new user.

`commitInitiative(session,result,{requestId,now})`: validate eligibility; suppress literal repeats/pressure; persist assistant-only `kind:'initiative'` parts with anchor and request turn ID, or a skipped receipt; increment revision/budget once. No new user fact or relation gain, no beat update for silence. New optional follow-up gets a fresh plan ID within remaining budget.

`setLocale`, `setInitiative`, `editMemory`, `removeMemory`: cloned validated revisions; combined settings use one atomic revision. Independent sessions stay independent.

## HTTP

- `GET /api/health`: public model/config/low reasoning + public characters; exclude persona/card/facets/credentials.
- `GET /api/sessions`: <=100 recent metadata records.
- `POST /api/sessions {characterId,mode?}`:201 `{session}`; default AI if configured, explicit demo otherwise.
- `GET /api/sessions/:id`: `{session}`.
- `POST .../messages {text,requestId:UUID,revision,locale?,stream?:boolean}`: standard JSON `{session}` when stream false/absent. If stream true, NDJSON complete part `{type:'message',index,text}` then `{type:'done',session}`. Preview is provisional; errors after headers send `{type:'error',error,code?}` and leave the stored turn untouched. Pre-stream errors use normal non200 JSON. Idempotent streaming replay returns a single done event, with no model call.
- `POST .../presence {revision}`: `{session}` normalized/rearmed plan; save only when revision changes.
- `POST .../initiative {requestId:UUID,revision,planId?}`: `{session,skipped}`. Receipt replay precedes version/plan checks; obsolete supplied plan ID409 STALE. Separate abortable generation allows foreground mutations to proceed. Recheck revision/eligibility before commit.
- `PATCH .../settings {revision,locale?,initiative?}`.
- `PATCH .../memories/:memoryId {revision,text}`, `DELETE .../memories/:memoryId {revision}`.
- `GET .../export`: session JSON download without credentials.

Errors: `{error,code?:'STALE'|'BUSY'|'CANCELLED'}` with400/404/409/502/503/504 etc. Upstream errors sanitized. Loopback Host/same-origin mutations, bounded JSON bodies, explicit static file allowlist, private atomic file replacement.

## Provider and streaming

`createProvider(env,{fetch})` exposes `publicConfig`, `generate(session,text,{signal,onMessage})` and `generateInitiative(session,{signal,now})`. OpenAI-compatible Chat Completions. Grok low/exclude, temperature0.8,max_tokens1800,JSON output. Foreground onMessage opts into upstream SSE; parse only completed top-level message strings. Full response validation precedes commit. SSE EOF/truncation/error/abort cannot manufacture a valid completion. Nonstream compatible responses can still use the callback after validation. Demo is fixed and labeled.

`streaming.mjs`: `extractCompletedMessages(content):string[]`, `readModelStream(response,{onMessage,signal}):Promise<string>`; callbacks `{index,text}` are ordered and awaitable. Never expose metadata, unfinished strings or reasoning tokens.

## Browser

Complete messages arrive immediately as provisional bubbles; final session replaces them, without replaying shown parts. During generation composer remains editable for the next draft, send remains serial. Success/error/version reconciliation preserve newly written drafts. Pending unique IDs allow retry/check-after-disconnect.

Current visible page schedules by pending ID/notBefore/expiry, supports opening/restore/presence and up to3 opportunities. Draft/IME/hidden/dialog/switch/busy gates cancel; aborted candidates can resume after conditions clear; transport failures do not busy-loop. A bounded local page timer is a chat feature, not a Codex optimization automation. No closed-page push or durable background agent.

Inspector shows only character focus as “她刚在想”, public mood, memory/settings; no private prompt/plan intent/reasoning. Warm whitespace-led UI, keyboard controls, responsive drawers and reduced motion are preserved.

## Verification

Use synthetic temporary sessions for unit/HTTP/UI checks. Real model evaluations require explicit `--live`, keep request/output/hash/usage/latency, and do not read user conversations. Report quality failures and intermediate candidates. Tests establish functional contracts; they do not prove cuteness, human likeness or long-term reliability.
