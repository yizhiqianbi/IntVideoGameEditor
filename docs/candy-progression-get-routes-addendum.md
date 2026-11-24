# Candy.ai character progression: GET-only route findings (2026-10-14)

Scope: public GET requests and static HTML/JavaScript only. No Candy business POST/PATCH/DELETE was sent.

## Lazy frame and injection boundary

The captured public chat DOM contains a lazy profile frame:

```html
<turbo-frame loading="lazy" data-tab-panel-host="true" id="profile-partial-turbo"
  src="https://candy.ai/conversations/helena-miller/profile_panel"></turbo-frame>
```

GET `/conversations/helena-miller/profile_panel` returned 200 and a `profile-partial-turbo` frame with role attributes only. It did not contain `memory-form`, `auto-memory-badge`, a progression dialog, memory modal, or form action. The parent page has an empty `<div id="memory-modals"></div>` slot.

The same public chat DOM does expose a separate lazy modal frame:

```html
<turbo-frame id="become-premium-video-modal-frame"
  src="/conversations/helena-miller/modal_fragments/become_premium_video"></turbo-frame>
```

This shows that dialog/modal fragments are server-injected through lazy Turbo frame `src` values. It is a premium video fragment, not the memory/progression source.

## Character progression controller

The exported bundle defines a generic lazy loader (`$s`, approximately offset 713,229) with `data-*-url-value` and `data-*-target="frame"`. On `character-progression:open`, `progression-dialog` calls `ensureLoaded()`, removes the frame `src`, then assigns `frame.src = urlValue`. After `turbo:frame-load`, it looks up the injected `dialogId`, opens the `<dialog>`, and selects `[data-tab-id="memories"]` when requested.

The `character-progression-indicator` controller emits:

```js
{ dialogId: this.dialogIdValue, tab: "memories", handled: false }
```

The indicator itself does not fetch or save memory data. The actual `urlValue`, `dialogId`, and dialog/form markup are server-provided attributes/HTML.

## Public route probes

A direct GET-only REA probe of `/conversations/helena-miller/character_progression` returned 404 (`ev_2199f939a03751efec097f607b18425e48c3a6bc4c0e47f789d9b535d489e00f`). It rendered the generic 404 page and no memory/progression markup.

Additional direct GET checks (outside the REA capture, no writes) produced these unauthenticated results:

- `/conversations/helena-miller/progression`, `/progression_dialog`, `/character_progression_dialog`, `/memory`, `/character_progression_panel`, `/dialogs`, `/profile`, `/character_progression`, `/character-progression`, `/relationship_progression`: 302 → `/`.
- `/conversations/helena-miller/memories`: 302 → `/users/sign_in`.
- `/conversations/helena-miller/profile_panel`: 200.

These redirects indicate that guessed progression/memory routes are either protected, nonexistent, or routed through the guest guard. They are not evidence of the authenticated endpoint.

## Conclusion

For the public guest surface, the service-side injection chain is now bounded as:

```text
GET /ai-girlfriend/helena-miller
  -> lazy GET /conversations/helena-miller/profile_panel (200; public profile only)
  -> empty #memory-modals slot
  -> progression-dialog lazy loader (URL/dialog ID supplied only in authenticated HTML)
  -> server-injected dialog containing memory tab/form (not exposed publicly)
```

The memory modal/form action remains unknown because the required authenticated `progression-dialog` frame markup is not present in public HTML and the JavaScript bundle contains no literal endpoint. Continue reproducing this branch only with a local fixture; do not infer a Candy write endpoint from the redirect probes.

Evidence and sanitized HTML:

- `ev_2199f939a03751efec097f607b18425e48c3a6bc4c0e47f789d9b535d489e00f`
- `/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/progression-get-route-bundle-20261014.json`
- `/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-chat-helena-live-sanitized-20261014.html`
- `/Users/pencil/Documents/IntVideoGameEditor/output/rea-candy/public-profile-panel-20261014.html`
