#!/usr/bin/env node

import assert from 'node:assert/strict';
import http from 'node:http';
import { URL } from 'node:url';

const HOST = '127.0.0.1';
const CSRF = 'local-fixture-csrf';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stream(action, target, template) {
  return `<turbo-stream action="${action}" target="${target}"><template>${template}</template></turbo-stream>`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply the small Turbo subset used by this fixture to an HTML string.
 *
 * This deliberately avoids jsdom or a browser: the goal is to make the state
 * transition inspectable and deterministic in a local Node replay. The
 * implementation supports the two actions observed in this fixture (`remove`
 * and `replace`) and fails loudly for any other action.
 */
function findElementBounds(html, target) {
  const escapedTarget = escapeRegExp(target);
  const openingPattern = new RegExp(`<([A-Za-z][\\w:-]*)\\b[^>]*\\bid=(['"])${escapedTarget}\\2[^>]*>`, 'i');
  const opening = openingPattern.exec(html);
  if (!opening) return null;

  const tagName = opening[1];
  const openingEnd = opening.index + opening[0].length;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  if (voidTags.has(tagName.toLowerCase()) || opening[0].endsWith('/>')) {
    return { start: opening.index, end: openingEnd };
  }

  const tagPattern = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = openingEnd;
  let depth = 1;
  let match;
  while ((match = tagPattern.exec(html))) {
    const isClosing = match[0].startsWith('</');
    const isSelfClosing = match[0].endsWith('/>');
    if (isClosing) depth -= 1;
    else if (!isSelfClosing) depth += 1;
    if (depth === 0) return { start: opening.index, end: match.index + match[0].length };
  }
  throw new Error(`Unclosed fixture element: ${target}`);
}

function applyTurboStream(html, turboStream) {
  const streamPattern = /<turbo-stream\b[^>]*\baction="([^"]+)"[^>]*\btarget="([^"]+)"[^>]*>\s*<template>([\s\S]*?)<\/template>\s*<\/turbo-stream>/gi;
  let result = html;
  let applied = 0;
  let match;
  while ((match = streamPattern.exec(turboStream))) {
    const [, action, target, template] = match;
    const bounds = findElementBounds(result, target);
    if (!bounds) throw new Error(`Turbo target not found: ${target}`);
    if (action === 'remove') result = result.slice(0, bounds.start) + result.slice(bounds.end);
    else if (action === 'replace') result = result.slice(0, bounds.start) + template + result.slice(bounds.end);
    else throw new Error(`Unsupported fixture Turbo action: ${action}`);
    applied += 1;
  }
  if (applied === 0) throw new Error('No Turbo Stream action found');
  return result;
}

function applyTurboFrame(html, frameHtml, target = 'character-progression') {
  const sourceBounds = findElementBounds(frameHtml, target);
  const targetBounds = findElementBounds(html, target);
  if (!sourceBounds) throw new Error(`Turbo frame response missing target: ${target}`);
  if (!targetBounds) throw new Error(`Turbo frame target not found: ${target}`);
  const replacement = frameHtml.slice(sourceBounds.start, sourceBounds.end);
  return html.slice(0, targetBounds.start) + replacement + html.slice(targetBounds.end);
}

function createState() {
  return {
    markVisited: false,
    memories: [],
    requestLog: [],
  };
}

function renderMemoryModal(state) {
  const memories = state.memories.length
    ? `<ul id="memory-list">${state.memories.map((memory) => `<li data-memory-id="${memory.id}">${escapeHtml(memory.body)}</li>`).join('')}</ul>`
    : '<p id="memory-empty">No memories saved.</p>';

  return `<turbo-frame id="memory-modal" target="_top">
    <section role="dialog" aria-label="Memories">
      <h2>Memories</h2>
      <div id="memory-content">${memories}</div>
      <form id="memory-form" action="/fixture/memories" method="post" data-turbo-frame="memory-modal">
        <input type="hidden" name="authenticity_token" value="${CSRF}">
        <label for="memory-body">Memory</label>
        <textarea id="memory-body" name="memory[body]" maxlength="250"></textarea>
        <output id="memory-counter">0/250</output>
        <p id="memory-error" role="alert"></p>
        <button type="submit">Save memory</button>
        <button type="button" data-memory-back>Back</button>
      </form>
    </section>
  </turbo-frame>`;
}

function renderProgressionFrame(variant = 'full') {
  if (variant === 'empty') {
    return `<turbo-frame id="character-progression" data-variant="empty" data-guest="true">
      <section id="progression-empty" aria-label="Character progression">
        <p>No memory controls are available for this guest frame.</p>
      </section>
    </turbo-frame>`;
  }

  return `<turbo-frame id="character-progression" data-variant="full" data-dialog-id="memory-dialog-1">
    <section id="memory-dialog-1" data-dialog-id="memory-dialog-1" aria-label="Character progression">
      <nav role="tablist">
        <button id="memories-tab" role="tab" data-tab="memories" aria-controls="memory-dialog-1">Memories</button>
      </nav>
      <form id="progression-memory-form" data-controller="memory-form" action="/fixture/memories" method="post" data-turbo-frame="memory-modal">
        <input type="hidden" name="authenticity_token" value="${CSRF}">
        <label for="progression-memory-body">Memory</label>
        <textarea id="progression-memory-body" name="memory[body]" maxlength="250"></textarea>
        <button type="submit">Save memory</button>
      </form>
    </section>
  </turbo-frame>`;
}

function renderPage(state) {
  const badge = state.markVisited
    ? ''
    : `<button id="memory-badge" data-mark-visited-url="/fixture/memories/mark-visited">New memory controls</button>`;
  return `<!doctype html>
<html><head><meta name="csrf-token" content="${CSRF}"><title>Local memory fixture</title></head>
<body data-fixture="candy-memory-turbo">
  <main>
    <h1>Local role page</h1>
    ${badge}
    <turbo-frame id="character-progression" src="/fixture/progression-frame?variant=full" loading="lazy">Loading progression…</turbo-frame>
    <div id="memory-modals">${renderMemoryModal(state)}</div>
    <pre id="fixture-state">${escapeHtml(JSON.stringify({ markVisited: state.markVisited, memories: state.memories }))}</pre>
  </main>
</body></html>`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

function createServer(state) {
  return http.createServer(async (request, response) => {
    const parsed = new URL(request.url, `http://${HOST}`);
    const method = request.method ?? 'GET';
    state.requestLog.push({ method, path: parsed.pathname, host: request.headers.host ?? '' });

    if (request.headers.host && !request.headers.host.startsWith(`${HOST}:`) && request.headers.host !== HOST && request.headers.host !== 'localhost') {
      send(response, 400, 'local fixture only');
      return;
    }

    if (method === 'GET' && parsed.pathname === '/fixture') {
      send(response, 200, renderPage(state));
      return;
    }

    if (method === 'GET' && parsed.pathname === '/fixture/progression-frame') {
      const variant = parsed.searchParams.get('variant') === 'empty' ? 'empty' : 'full';
      send(response, 200, renderProgressionFrame(variant), {
        'content-type': 'text/html; charset=utf-8',
      });
      return;
    }

    if (method === 'PATCH' && parsed.pathname === '/fixture/memories/mark-visited') {
      if (request.headers['x-csrf-token'] !== CSRF) {
        send(response, 403, 'missing local CSRF token');
        return;
      }
      state.markVisited = true;
      send(response, 200, stream('remove', 'memory-badge', ''), {
        'content-type': 'text/vnd.turbo-stream.html; charset=utf-8',
      });
      return;
    }

    if (method === 'POST' && parsed.pathname === '/fixture/memories') {
      const body = await readBody(request);
      const params = new URLSearchParams(body);
      if (params.get('authenticity_token') !== CSRF) {
        send(response, 403, 'missing local CSRF token');
        return;
      }

      const memoryBody = (params.get('memory[body]') ?? '').trim();
      if (!memoryBody) {
        const error = '<p id="memory-error" role="alert">Memory cannot be blank.</p>';
        send(response, 422, stream('replace', 'memory-modal', `${renderMemoryModal(state).replace('<p id="memory-error" role="alert"></p>', error)}`), {
          'content-type': 'text/vnd.turbo-stream.html; charset=utf-8',
        });
        return;
      }

      const memory = { id: state.memories.length + 1, body: memoryBody };
      state.memories.push(memory);
      send(response, 200, stream('replace', 'memory-modal', renderMemoryModal(state)), {
        'content-type': 'text/vnd.turbo-stream.html; charset=utf-8',
      });
      return;
    }

    send(response, 404, 'not found');
  });
}

async function startFixture() {
  const state = createState();
  const server = createServer(state);
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://${HOST}:${address.port}`;
  return { state, server, baseUrl };
}

async function replay() {
  const { state, server, baseUrl } = await startFixture();
  try {
    const page = await fetch(`${baseUrl}/fixture`);
    let domHtml = await page.text();
    assert.equal(page.status, 200);
    assert.match(domHtml, /id="memory-modals"/);
    assert.match(domHtml, /id="memory-form" action="\/fixture\/memories"/);
    assert.match(domHtml, /data-mark-visited-url="\/fixture\/memories\/mark-visited"/);
    assert.match(domHtml, /id="character-progression" src="\/fixture\/progression-frame\?variant=full" loading="lazy"/);
    console.log('GET  /fixture                         -> 200 (server-injected modal + action)');

    const progressionFrame = await fetch(`${baseUrl}/fixture/progression-frame?variant=full`);
    const progressionHtml = await progressionFrame.text();
    assert.equal(progressionFrame.status, 200);
    assert.match(progressionHtml, /id="character-progression" data-variant="full"/);
    assert.match(progressionHtml, /data-dialog-id="memory-dialog-1"/);
    assert.match(progressionHtml, /data-tab="memories"/);
    assert.match(progressionHtml, /data-controller="memory-form" action="\/fixture\/memories"/);
    domHtml = applyTurboFrame(domHtml, progressionHtml);
    assert.match(domHtml, /id="character-progression" data-variant="full"/);
    assert.match(domHtml, /data-dialog-id="memory-dialog-1"/);
    assert.match(domHtml, /id="memories-tab"[^>]*data-tab="memories"/);
    assert.match(domHtml, /id="progression-memory-form"[^>]*action="\/fixture\/memories"/);
    console.log('GET  /fixture/progression-frame   -> 200 + DOM lazy frame/full dialog injected');

    const markVisited = await fetch(`${baseUrl}/fixture/memories/mark-visited`, {
      method: 'PATCH',
      headers: {
        accept: 'text/vnd.turbo-stream.html',
        'x-requested-with': 'XMLHttpRequest',
        'x-csrf-token': CSRF,
      },
    });
    const markStream = await markVisited.text();
    assert.equal(markVisited.status, 200);
    assert.match(markStream, /action="remove" target="memory-badge"/);
    assert.equal(state.markVisited, true);
    domHtml = applyTurboStream(domHtml, markStream);
    assert.doesNotMatch(domHtml, /id="memory-badge"/);
    assert.match(domHtml, /id="memory-modal"/);
    console.log('PATCH /fixture/memories/mark-visited -> 200 + DOM remove #memory-badge');

    const empty = await fetch(`${baseUrl}/fixture/memories`, {
      method: 'POST',
      headers: {
        accept: 'text/vnd.turbo-stream.html',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ authenticity_token: CSRF, 'memory[body]': '' }),
    });
    const emptyStream = await empty.text();
    assert.equal(empty.status, 422);
    assert.match(emptyStream, /Memory cannot be blank/);
    assert.equal(state.memories.length, 0);
    domHtml = applyTurboStream(domHtml, emptyStream);
    assert.match(domHtml, /id="memory-modal"/);
    assert.match(domHtml, /Memory cannot be blank/);
    assert.match(domHtml, /id="memory-form" action="\/fixture\/memories"/);
    console.log('POST /fixture/memories (blank)     -> 422 + DOM replace modal/error');

    const save = await fetch(`${baseUrl}/fixture/memories`, {
      method: 'POST',
      headers: {
        accept: 'text/vnd.turbo-stream.html',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ authenticity_token: CSRF, 'memory[body]': 'Likes jasmine tea' }),
    });
    const saveStream = await save.text();
    assert.equal(save.status, 200);
    assert.match(saveStream, /action="replace" target="memory-modal"/);
    assert.match(saveStream, /Likes jasmine tea/);
    assert.deepEqual(state.memories, [{ id: 1, body: 'Likes jasmine tea' }]);
    domHtml = applyTurboStream(domHtml, saveStream);
    assert.match(domHtml, /id="memory-list"/);
    assert.match(domHtml, /Likes jasmine tea/);
    assert.doesNotMatch(domHtml, /Memory cannot be blank/);
    console.log('POST /fixture/memories (save)      -> 200 + DOM replace modal/saved memory');

    const emptyFrame = await fetch(`${baseUrl}/fixture/progression-frame?variant=empty`);
    const emptyFrameHtml = await emptyFrame.text();
    assert.equal(emptyFrame.status, 200);
    assert.match(emptyFrameHtml, /data-variant="empty" data-guest="true"/);
    assert.doesNotMatch(emptyFrameHtml, /data-controller="memory-form"/);
    domHtml = applyTurboFrame(domHtml, emptyFrameHtml);
    assert.match(domHtml, /id="character-progression" data-variant="empty" data-guest="true"/);
    assert.match(domHtml, /id="progression-empty"/);
    assert.doesNotMatch(domHtml, /id="progression-memory-form"/);
    assert.doesNotMatch(domHtml, /data-dialog-id="memory-dialog-1"/);
    assert.match(domHtml, /Likes jasmine tea/);
    console.log('GET  /fixture/progression-frame?variant=empty -> 200 + DOM guest/empty frame');

    const persisted = await fetch(`${baseUrl}/fixture`);
    const persistedHtml = await persisted.text();
    assert.doesNotMatch(persistedHtml, /id="memory-badge"/);
    assert.match(persistedHtml, /Likes jasmine tea/);
    assert.doesNotMatch(domHtml, /id="memory-badge"/);
    assert(state.requestLog.every(({ host }) => host.startsWith(`${HOST}:`) || host === HOST || host === 'localhost'));
    console.log('GET  /fixture (persisted state)     -> server + DOM state agree');
    console.log(`Local requests replayed: ${state.requestLog.length}; external requests: 0`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  replay().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { applyTurboFrame, applyTurboStream, createServer, createState, replay, renderPage, renderProgressionFrame };
