"use client";

import type { HtmlGameArtifact } from "../play-agent/types";

const STORAGE_KEY = "funx-html-game-drafts-v1";

export type HtmlGameDraft = {
  id: string;
  slug: string;
  prompt: string;
  artifact: HtmlGameArtifact;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  published: boolean;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readAll(): HtmlGameDraft[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HtmlGameDraft[];
  } catch {
    return [];
  }
}

function writeAll(drafts: HtmlGameDraft[]) {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

function slugify(value: string) {
  const base = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "game") + "-" + Math.random().toString(36).slice(2, 6);
}

export function listHtmlGameDrafts(): HtmlGameDraft[] {
  return readAll().sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function getHtmlGameDraft(id: string): HtmlGameDraft | null {
  return readAll().find((d) => d.id === id) ?? null;
}

export function getHtmlGameDraftBySlug(slug: string): HtmlGameDraft | null {
  return readAll().find((d) => d.slug === slug) ?? null;
}

export function saveHtmlGameDraft(input: {
  id?: string;
  prompt: string;
  artifact: HtmlGameArtifact;
}): HtmlGameDraft {
  const drafts = readAll();
  const now = new Date().toISOString();

  if (input.id) {
    const idx = drafts.findIndex((d) => d.id === input.id);
    if (idx >= 0) {
      const updated: HtmlGameDraft = {
        ...drafts[idx],
        prompt: input.prompt,
        artifact: input.artifact,
        updatedAt: now,
      };
      drafts[idx] = updated;
      writeAll(drafts);
      return updated;
    }
  }

  const id = "draft-" + Date.now().toString(36);
  const draft: HtmlGameDraft = {
    id,
    slug: slugify(input.artifact.meta.title || input.prompt || "game"),
    prompt: input.prompt,
    artifact: input.artifact,
    createdAt: now,
    updatedAt: now,
    published: false,
  };
  drafts.unshift(draft);
  writeAll(drafts);
  return draft;
}

export function deleteHtmlGameDraft(id: string) {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function publishHtmlGameDraft(id: string): HtmlGameDraft | null {
  const drafts = readAll();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  drafts[idx] = { ...drafts[idx], published: true, publishedAt: now, updatedAt: now };
  writeAll(drafts);
  return drafts[idx];
}
