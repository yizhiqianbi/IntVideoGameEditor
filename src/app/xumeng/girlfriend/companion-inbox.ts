"use client";

import { useEffect, useMemo, useState } from "react";
import { COMPANION_MEDIA_PLACEHOLDER, sameCompanionUtterance } from "./companion-thread-items";
import { SALES_CUES } from "./sales-style";

export const CHAT_INBOX_EVENT = "xumeng-chat-inbox";

export type InboxSourceMessage = { id: string; role: string; text?: string; createdAt: string; requestId?: string; media?: unknown };
export type InboxSourcePhoto = { id: string; createdAt: string };
export type InboxEntry = { id: string; role: "user" | "assistant" | "photo"; text: string; at: number };
export type InboxView = { preview: string; at: number | null; unread: number };

const STYLE_BLOCK = /^\[XUMENG_PRIVATE_STYLE v1\][\s\S]*?\[\/XUMENG_PRIVATE_STYLE\]\n?/;
const OPENING_BLOCK = /\[XUMENG_OPENING v1\][\s\S]*?\[\/XUMENG_OPENING\]\n?/g;

export function companionLane(person: { variant: string; castId?: string }) {
  return person.variant === "cast" && person.castId ? `cast-${person.castId}` : person.variant;
}

export function chatListStamp(at: number, now = Date.now()): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  const current = new Date(now);
  if (date.toDateString() === current.toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  if (current.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) return `周${"日一二三四五六"[date.getDay()]}`;
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function visibleText(value: string) {
  return value.replace(STYLE_BLOCK, "").replace(OPENING_BLOCK, "").replace(/\s+/g, " ").trim();
}

function previewText(message: InboxSourceMessage) {
  const text = visibleText(message.text || "");
  const media = clipMedia(message.media);
  const spoken = text && !(media.length && COMPANION_MEDIA_PLACEHOLDER.test(text)) ? text : "";
  if (spoken) return spoken;
  const first = media[0];
  if (!first) return "";
  if (first.kind === "audio") return "[语音]";
  if (first.kind === "image") return "[图片]";
  return first.text || "[表情]";
}

/** Messages and photos in send order, with hidden sales cues left out. */
export function inboxEntries(messages: readonly InboxSourceMessage[], photos: readonly InboxSourcePhoto[] = []): InboxEntry[] {
  const entries: InboxEntry[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = previewText(message);
    if (!text || (message.role === "user" && SALES_CUES.has(visibleText(message.text || "")))) continue;
    const at = Date.parse(message.createdAt);
    if (!message.id || !Number.isFinite(at)) continue;
    entries.push({ id: message.id, role: message.role, text, at });
  }
  for (const photo of photos) {
    const at = Date.parse(photo.createdAt);
    if (!photo.id || !Number.isFinite(at)) continue;
    entries.push({ id: photo.id, role: "photo", text: "[图片]", at });
  }
  return entries.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
}

/** Unread counts her messages after the last one the list has already treated as seen. */
export function inboxView(entries: readonly InboxEntry[], seenId: string | null): InboxView {
  const last = entries.at(-1);
  if (!last) return { preview: "", at: null, unread: 0 };
  const seen = seenId ? entries.findIndex(entry => entry.id === seenId) : -1;
  const unread = seen < 0 ? 0 : entries.slice(seen + 1).filter(entry => entry.role !== "user").length;
  return { preview: last.text, at: last.at, unread };
}

function seenKey(accountId: string, lane: string) {
  return `xumeng-chat-seen:${accountId}:${lane}`;
}

function previewKey(accountId: string, lane: string) {
  return `xumeng-companion-preview:${accountId}:${lane}`;
}

function transcriptKey(accountId: string, lane: string, sessionId: string) {
  return `xumeng-companion-transcript:${accountId}:${lane}:${sessionId}`;
}

function personKey(accountId: string, lane: string) {
  return `xumeng-companion-person:${accountId}:${lane}`;
}

type BrowserStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function browserStore(store?: BrowserStore): BrowserStore | null {
  if (store) return store;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const TRANSCRIPT_LIMIT = 200;
const MEDIA_URL_LIMIT = 1_500_000;
const TRANSCRIPT_BUDGET = 2_500_000;

export type StoredMedia = {
  kind: "image" | "audio" | "emoji";
  url?: string;
  text?: string;
  alt?: string;
  label?: string;
  mimeType?: string;
  durationMs?: number;
};
export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  requestId?: string;
  media?: StoredMedia[];
};

function storedKind(value: unknown): StoredMedia["kind"] | null {
  const kind = typeof value === "string" ? value.toLowerCase() : "";
  if (["image", "photo", "picture", "img"].includes(kind)) return "image";
  if (["audio", "voice", "sound", "voice_message"].includes(kind)) return "audio";
  if (["emoji", "sticker", "emoticon"].includes(kind)) return "emoji";
  return null;
}

function storedMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || url.length > MEDIA_URL_LIMIT || /[\u0000-\u001f\u007f]/.test(url) || url.startsWith("blob:")) return null;
  if (/^data:/i.test(url)) return /^data:(?:image|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(url) ? url : null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") && !url.includes(" ")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return null;
    if (parsed.protocol === "https:") return parsed.toString();
    if (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return parsed.toString();
  } catch { /* Drop anything that is not a plain media URL. */ }
  return null;
}

function clipMedia(value: unknown): StoredMedia[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: StoredMedia[] = [];
  for (const raw of value.slice(0, 6)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const kind = storedKind(item.kind ?? item.type ?? item.mediaType);
    if (!kind) continue;
    const mimeType = typeof item.mimeType === "string" ? item.mimeType.slice(0, 80) : undefined;
    const base64 = typeof item.base64 === "string" ? item.base64 : null;
    const encoded = base64 && mimeType ? `data:${mimeType};base64,${base64}` : null;
    const url = storedMediaUrl(item.url ?? item.src ?? encoded);
    const text = typeof item.text === "string" ? item.text.trim().slice(0, 240) : typeof item.emoji === "string" ? item.emoji.trim().slice(0, 240) : "";
    if (!url && kind !== "emoji") continue;
    if (!url && !text) continue;
    const key = `${kind}:${url || text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const durationMs = typeof item.durationMs === "number" && Number.isFinite(item.durationMs) ? Math.max(0, Math.min(Math.round(item.durationMs), 30 * 60 * 1000)) : undefined;
    items.push({
      kind,
      ...(url ? { url } : {}),
      ...(text ? { text } : {}),
      ...(typeof item.alt === "string" && item.alt.trim() ? { alt: item.alt.trim().slice(0, 240) } : {}),
      ...(typeof item.label === "string" && item.label.trim() ? { label: item.label.trim().slice(0, 120) } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }
  return items;
}

function mediaScore(media: readonly StoredMedia[] | undefined) {
  return (media ?? []).reduce((score, item) => score + (item.url ? 2 : 1), 0);
}

function foldTranscript(messages: readonly StoredChatMessage[]): StoredChatMessage[] {
  const folded: StoredChatMessage[] = [];
  for (const message of messages) {
    const index = folded.findIndex(existing => sameCompanionUtterance(existing, message));
    if (index < 0) {
      folded.push(message);
      continue;
    }
    const current = folded[index];
    if (!current) continue;
    const media = mediaScore(message.media) >= mediaScore(current.media) && (message.media?.length || !current.media?.length) ? message.media : current.media;
    const currentBlank = !current.text || COMPANION_MEDIA_PLACEHOLDER.test(current.text);
    const incomingBlank = !message.text || COMPANION_MEDIA_PLACEHOLDER.test(message.text);
    let text = !incomingBlank ? message.text : !currentBlank ? current.text : message.text || current.text;
    if (media?.length && COMPANION_MEDIA_PLACEHOLDER.test(text)) text = "";
    folded[index] = {
      ...message,
      id: mediaScore(message.media) >= mediaScore(current.media) ? message.id : current.id,
      text,
      ...(current.requestId || message.requestId ? { requestId: message.requestId || current.requestId } : {}),
      ...(media?.length ? { media } : {}),
    };
  }
  return folded;
}

function lightenTranscript(messages: readonly StoredChatMessage[], dataLimit: number): StoredChatMessage[] {
  return messages.flatMap(message => {
    const media = (message.media ?? []).flatMap(item => {
      if (!item.url?.startsWith("data:") || item.url.length <= dataLimit) return [item];
      const kept = { ...item };
      delete kept.url;
      return kept.text || kept.kind === "emoji" ? [kept] : [];
    });
    if (!message.text && !media.length) return [];
    const next = { ...message };
    if (media.length) next.media = media;
    else delete next.media;
    return [next];
  });
}

function fitTranscript(messages: readonly StoredChatMessage[]): StoredChatMessage[] {
  let fitted = [...messages];
  const bytes = () => JSON.stringify(fitted).length;
  if (bytes() <= TRANSCRIPT_BUDGET) return fitted;
  fitted = lightenTranscript(fitted, 120_000);
  if (bytes() <= TRANSCRIPT_BUDGET) return fitted;
  return lightenTranscript(fitted, 0);
}

/** The lines worth keeping: real user and assistant text, voice and pictures included, newest last. */
export function clipCompanionTranscript(messages: readonly InboxSourceMessage[]): StoredChatMessage[] {
  const seen = new Set<string>();
  const cleaned: StoredChatMessage[] = [];
  for (const message of messages) {
    if ((message.role !== "user" && message.role !== "assistant") || !message.id || seen.has(message.id)) continue;
    const text = visibleText(message.text || "");
    const media = clipMedia(message.media);
    const spoken = media.length && COMPANION_MEDIA_PLACEHOLDER.test(text) ? "" : text;
    if ((!spoken && !media.length) || !Number.isFinite(Date.parse(message.createdAt))) continue;
    seen.add(message.id);
    const requestId = typeof message.requestId === "string" && message.requestId.trim() ? message.requestId.trim().slice(0, 80) : "";
    cleaned.push({
      id: message.id,
      role: message.role,
      text: spoken,
      createdAt: message.createdAt,
      ...(requestId ? { requestId } : {}),
      ...(media.length ? { media } : {}),
    });
  }
  return foldTranscript(cleaned
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)))
    .slice(-TRANSCRIPT_LIMIT);
}

/** Drop browser copies that were not tied to an account. The account transcript stays. */
export function dropUnscopedCompanionCache(lane: string) {
  if (typeof localStorage === "undefined") return;
  for (const key of [
    `xumeng-companion-cache:${lane}`,
    `xumeng-companion-hold:${lane}`,
    `xumeng-companion-photos:${lane}`,
    `xumeng-chat-seen:${lane}`,
  ]) {
    try { localStorage.removeItem(key); } catch { /* A locked store must not block the account-scoped list. */ }
  }
  if (lane === "qwen") {
    try {
      localStorage.removeItem("xumeng-qwen-transcript");
      localStorage.removeItem("xumeng-qwen-photos");
    } catch { /* Same as above. */ }
  }
}

function readJson(store: BrowserStore, key: string): unknown {
  try {
    return JSON.parse(store.getItem(key) || "null");
  } catch {
    return null;
  }
}

function readPhotos(store: BrowserStore, key: string): InboxSourcePhoto[] {
  const value = readJson(store, key);
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const id = "id" in item && typeof item.id === "string" ? item.id : "";
    const createdAt = "createdAt" in item && typeof item.createdAt === "string" ? item.createdAt : "";
    return id && createdAt ? [{ id, createdAt }] : [];
  });
}

export type PersonTranscript = { sessionId: string | null; messages: StoredChatMessage[] };

function parseTranscript(value: unknown): PersonTranscript {
  if (!value || typeof value !== "object") return { sessionId: null, messages: [] };
  const sessionId = "sessionId" in value && typeof value.sessionId === "string" ? value.sessionId : null;
  if ("messages" in value && Array.isArray(value.messages)) return { sessionId, messages: clipCompanionTranscript(value.messages as InboxSourceMessage[]) };
  if ("id" in value && "role" in value && "createdAt" in value) return { sessionId, messages: clipCompanionTranscript([value as InboxSourceMessage]) };
  return { sessionId, messages: [] };
}

function combineTranscripts(groups: readonly StoredChatMessage[][]): StoredChatMessage[] {
  const byId = new Map<string, StoredChatMessage>();
  for (const group of groups) for (const message of group) byId.set(message.id, message);
  return clipCompanionTranscript([...byId.values()]);
}

function legacyTranscripts(store: BrowserStore, accountId: string, lane: string): PersonTranscript[] {
  const prefix = `xumeng-companion-transcript:${accountId}:${lane}:`;
  const found: PersonTranscript[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(prefix)) continue;
    const parsed = parseTranscript(readJson(store, key));
    found.push({ sessionId: parsed.sessionId || key.slice(prefix.length) || null, messages: parsed.messages });
  }
  return found;
}

/** One person's saved dialogue. Older session copies and the list preview fill in anything the person record does not have. */
export function readPersonTranscript(accountId: string, lane: string, store?: BrowserStore): PersonTranscript {
  const memory = browserStore(store);
  if (!accountId || !memory) return { sessionId: null, messages: [] };
  const person = parseTranscript(readJson(memory, personKey(accountId, lane)));
  const preview = parseTranscript(readJson(memory, lane === "qwen" ? `xumeng-qwen-transcript:${accountId}` : previewKey(accountId, lane)));
  const legacy = legacyTranscripts(memory, accountId, lane);
  const sessionId = person.sessionId || preview.sessionId || (legacy.length === 1 ? legacy[0]?.sessionId ?? null : null);
  return {
    sessionId,
    messages: combineTranscripts([legacy.flatMap(item => item.messages), preview.messages, person.messages]),
  };
}

function readMessages(store: BrowserStore, accountId: string, lane: string): InboxSourceMessage[] {
  return readPersonTranscript(accountId, lane, store).messages;
}

export function readInboxEntries(accountId: string, lane: string, store?: BrowserStore): InboxEntry[] {
  const memory = browserStore(store);
  if (!accountId || !memory) return [];
  const photos = [
    ...readPhotos(memory, `xumeng-companion-photos:${accountId}:${lane}`),
    ...(lane === "qwen" ? readPhotos(memory, `xumeng-qwen-photos:${accountId}`) : []),
  ];
  return inboxEntries(readMessages(memory, accountId, lane), photos);
}

export function readInbox(accountId: string, lane: string): InboxView {
  if (!accountId || typeof localStorage === "undefined") return { preview: "", at: null, unread: 0 };
  let seen: string | null = null;
  try { seen = localStorage.getItem(seenKey(accountId, lane)); } catch { /* Private mode keeps the list usable. */ }
  return inboxView(readInboxEntries(accountId, lane), seen);
}

function notifyInbox() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAT_INBOX_EVENT));
}

export function readCompanionTranscript(accountId: string, lane: string, sessionId: string, store?: BrowserStore): StoredChatMessage[] {
  const memory = browserStore(store);
  if (!accountId || !sessionId || !memory) return [];
  return parseTranscript(readJson(memory, transcriptKey(accountId, lane, sessionId))).messages;
}

/** Write this person's dialogue, and point the list at that same record. */
export function publishCompanionTranscript(accountId: string, lane: string, sessionId: string, messages: readonly InboxSourceMessage[], store?: BrowserStore) {
  const memory = browserStore(store);
  if (!accountId || !sessionId || !memory) return;
  const cleaned = fitTranscript(clipCompanionTranscript(messages));
  if (!cleaned.length) return;
  let payload = JSON.stringify({ sessionId, messages: cleaned });
  let changed = false;
  const write = (body: string) => {
    for (const key of [personKey(accountId, lane), transcriptKey(accountId, lane, sessionId), previewKey(accountId, lane)]) {
      if (memory.getItem(key) !== body) { memory.setItem(key, body); changed = true; }
    }
  };
  try {
    write(payload);
    if (changed) dropUnscopedCompanionCache(lane);
  } catch {
    changed = false;
    const lighter = lightenTranscript(cleaned, 0);
    if (lighter.length) {
      payload = JSON.stringify({ sessionId, messages: lighter });
      try {
        write(payload);
        if (changed) dropUnscopedCompanionCache(lane);
      } catch { /* A full disk must not block the open transcript. */ }
    }
  }
  if (changed) notifyInbox();
  markChatSeen(accountId, lane);
}

/** Drop one person's saved dialogue after she explicitly starts a blank chat. */
export function clearPersonTranscript(accountId: string, lane: string, store?: BrowserStore) {
  const memory = browserStore(store);
  if (!accountId || !memory) return;
  const prefix = `xumeng-companion-transcript:${accountId}:${lane}:`;
  const doomed = [personKey(accountId, lane), previewKey(accountId, lane)];
  for (let index = 0; index < memory.length; index += 1) {
    const key = memory.key(index);
    if (key?.startsWith(prefix)) doomed.push(key);
  }
  try {
    for (const key of doomed) memory.removeItem(key);
  } catch { /* A locked store still leaves the blank chat on screen. */ }
  notifyInbox();
}

export function publishCompanionPreview(accountId: string, lane: string, message: InboxSourceMessage) {
  if (!accountId || typeof localStorage === "undefined" || !message.id || !message.createdAt) return;
  try {
    const [stored] = clipCompanionTranscript([message]);
    if (!stored) return;
    localStorage.setItem(previewKey(accountId, lane), JSON.stringify({
      id: stored.id, role: stored.role, text: stored.text, createdAt: stored.createdAt, ...(stored.media ? { media: stored.media } : {}),
    }));
    dropUnscopedCompanionCache(lane);
  } catch { /* A full disk must not block the open transcript. */ }
  markChatSeen(accountId, lane);
}

/** Remember the latest line so older history does not light up as unread. */
export function baselineChatSeen(accountId: string, lane: string) {
  if (!accountId || typeof localStorage === "undefined") return false;
  const key = seenKey(accountId, lane);
  try {
    if (localStorage.getItem(key)) return false;
    const last = readInboxEntries(accountId, lane).at(-1);
    if (!last) return false;
    localStorage.setItem(key, last.id);
    return true;
  } catch {
    return false;
  }
}

/** The open chat has been looked at, so its new lines are not unread. */
export function markChatSeen(accountId: string | undefined, lane: string) {
  if (!accountId || typeof localStorage === "undefined") return;
  const last = readInboxEntries(accountId, lane).at(-1);
  if (!last) return;
  try {
    if (localStorage.getItem(seenKey(accountId, lane)) === last.id) return;
    localStorage.setItem(seenKey(accountId, lane), last.id);
  } catch { return; }
  notifyInbox();
}

export function publishQwenTranscript(accountId: string | undefined, messages: readonly InboxSourceMessage[]) {
  if (!accountId || typeof localStorage === "undefined") return;
  const cleaned = clipCompanionTranscript(messages);
  try {
    localStorage.removeItem("xumeng-qwen-transcript");
    if (!cleaned.length) localStorage.removeItem(`xumeng-qwen-transcript:${accountId}`);
    else localStorage.setItem(`xumeng-qwen-transcript:${accountId}`, JSON.stringify({ sessionId: "qwen", messages: cleaned }));
  } catch { /* A full disk must not block the open transcript. */ }
  if (cleaned.length) markChatSeen(accountId, "qwen");
}

export function useCompanionInbox(lanes: readonly string[], accountId: string | null) {
  const [version, setVersion] = useState(0);
  const key = lanes.join("\0");
  useEffect(() => {
    const refresh = () => setVersion(current => current + 1);
    window.addEventListener("storage", refresh);
    window.addEventListener(CHAT_INBOX_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(CHAT_INBOX_EVENT, refresh);
    };
  }, []);
  useEffect(() => {
    for (const lane of key.split("\0").filter(Boolean)) dropUnscopedCompanionCache(lane);
  }, [key]);
  useEffect(() => {
    if (!accountId) return;
    const names = key.split("\0").filter(Boolean);
    if (names.some(lane => baselineChatSeen(accountId, lane))) setVersion(current => current + 1);
  }, [accountId, key, version]);
  return useMemo(() => {
    const views = new Map<string, InboxView>();
    for (const lane of key.split("\0").filter(Boolean)) views.set(lane, accountId ? readInbox(accountId, lane) : { preview: "", at: null, unread: 0 });
    return views;
  }, [accountId, key, version]);
}
