"use client";

import { useEffect, useMemo, useState } from "react";
import { SALES_CUES } from "./sales-style";

export const CHAT_INBOX_EVENT = "xumeng-chat-inbox";

export type InboxSourceMessage = { id: string; role: string; text?: string; createdAt: string };
export type InboxSourcePhoto = { id: string; createdAt: string };
export type InboxEntry = { id: string; role: "user" | "assistant" | "photo"; text: string; at: number };
export type InboxView = { preview: string; at: number | null; unread: number };

const STYLE_BLOCK = /^\[XUMENG_PRIVATE_STYLE v1\][\s\S]*?\[\/XUMENG_PRIVATE_STYLE\]\n?/;

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
  return value.replace(STYLE_BLOCK, "").replace(/\s+/g, " ").trim();
}

/** Messages and photos in send order, with hidden sales cues left out. */
export function inboxEntries(messages: readonly InboxSourceMessage[], photos: readonly InboxSourcePhoto[] = []): InboxEntry[] {
  const entries: InboxEntry[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = visibleText(message.text || "");
    if (!text || (message.role === "user" && SALES_CUES.has(text))) continue;
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

function seenKey(lane: string) {
  return `xumeng-chat-seen:${lane}`;
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function readPhotos(key: string): InboxSourcePhoto[] {
  const value = readJson(key);
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const id = "id" in item && typeof item.id === "string" ? item.id : "";
    const createdAt = "createdAt" in item && typeof item.createdAt === "string" ? item.createdAt : "";
    return id && createdAt ? [{ id, createdAt }] : [];
  });
}

function readMessages(lane: string): InboxSourceMessage[] {
  if (lane === "qwen") {
    const value = readJson("xumeng-qwen-transcript");
    return Array.isArray(value) ? value as InboxSourceMessage[] : [];
  }
  const value = readJson(`xumeng-companion-cache:${lane}`);
  if (!value || typeof value !== "object" || !("conversation" in value)) return [];
  const conversation = value.conversation;
  if (!conversation || typeof conversation !== "object" || !("messages" in conversation) || !Array.isArray(conversation.messages)) return [];
  return conversation.messages as InboxSourceMessage[];
}

export function readInboxEntries(lane: string): InboxEntry[] {
  if (typeof localStorage === "undefined") return [];
  const cache = lane === "qwen" ? null : readJson(`xumeng-companion-cache:${lane}`);
  const active = cache && typeof cache === "object" && "active" in cache && typeof cache.active === "string" ? cache.active : "";
  const photos = [
    ...readPhotos(`xumeng-companion-photos:${lane}`),
    ...(active ? readPhotos(`xumeng-companion-cache:${lane}:${active}:photos`) : []),
    ...(lane === "qwen" ? readPhotos("xumeng-qwen-photos") : []),
  ];
  return inboxEntries(readMessages(lane), photos);
}

export function readInbox(lane: string): InboxView {
  if (typeof localStorage === "undefined") return { preview: "", at: null, unread: 0 };
  let seen: string | null = null;
  try { seen = localStorage.getItem(seenKey(lane)); } catch { /* Private mode keeps the list usable. */ }
  return inboxView(readInboxEntries(lane), seen);
}

function notifyInbox() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAT_INBOX_EVENT));
}

/** Remember the latest line so older history does not light up as unread. */
export function baselineChatSeen(lane: string) {
  if (typeof localStorage === "undefined") return false;
  const key = seenKey(lane);
  try {
    if (localStorage.getItem(key)) return false;
    const last = readInboxEntries(lane).at(-1);
    if (!last) return false;
    localStorage.setItem(key, last.id);
    return true;
  } catch {
    return false;
  }
}

/** The open chat has been looked at, so its new lines are not unread. */
export function markChatSeen(lane: string) {
  if (typeof localStorage === "undefined") return;
  const last = readInboxEntries(lane).at(-1);
  if (!last) return;
  try {
    if (localStorage.getItem(seenKey(lane)) === last.id) return;
    localStorage.setItem(seenKey(lane), last.id);
  } catch { return; }
  notifyInbox();
}

export function publishQwenTranscript(messages: readonly InboxSourceMessage[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem("xumeng-qwen-transcript", JSON.stringify(messages.map(message => ({
      id: message.id, role: message.role, text: message.text || "", createdAt: message.createdAt,
    }))));
  } catch { /* A full disk must not block the open transcript. */ }
  markChatSeen("qwen");
}

export function useCompanionInbox(lanes: readonly string[]) {
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
    const names = key.split("\0").filter(Boolean);
    if (names.some(lane => baselineChatSeen(lane))) setVersion(current => current + 1);
  }, [key, version]);
  return useMemo(() => {
    const views = new Map<string, InboxView>();
    for (const lane of key.split("\0").filter(Boolean)) views.set(lane, readInbox(lane));
    return views;
  }, [key, version]);
}
