import type { PlayAgentApplyPayload } from "./types";

const STORAGE_KEY = "funx-play-agent-project-drafts.v1";

export type PlayAgentProjectDraftRecord = {
  id: string;
  projectId: string;
  sessionId: string;
  name: string;
  slug: string;
  templateId?: string;
  skillIds: string[];
  prompt: string;
  createdAt: string;
  updatedAt: string;
  bundle: PlayAgentApplyPayload["bundle"];
};

type StoredDraftMap = Record<string, PlayAgentProjectDraftRecord[]>;

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function readDraftMap(): StoredDraftMap {
  const storage = getStorage();

  if (!storage) {
    return {};
  }

  const raw = storage.getItem(STORAGE_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as StoredDraftMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDraftMap(value: StoredDraftMap) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function listProjectPlayDrafts(projectId: string) {
  const allDrafts = readDraftMap();
  const drafts = allDrafts[projectId] ?? [];

  return [...drafts].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function saveProjectPlayDraft(input: PlayAgentApplyPayload) {
  const allDrafts = readDraftMap();
  const projectDrafts = allDrafts[input.projectId] ?? [];
  const now = new Date().toISOString();
  const existingDraft = projectDrafts.find(
    (draft) => draft.sessionId === input.sessionId,
  );

  const nextDraft: PlayAgentProjectDraftRecord = existingDraft
    ? {
        ...existingDraft,
        name: input.draftName,
        slug: input.slug,
        templateId: input.templateId,
        skillIds: [...input.skillIds],
        prompt: input.prompt,
        updatedAt: now,
        bundle: input.bundle,
      }
    : {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        sessionId: input.sessionId,
        name: input.draftName,
        slug: input.slug,
        templateId: input.templateId,
        skillIds: [...input.skillIds],
        prompt: input.prompt,
        createdAt: now,
        updatedAt: now,
        bundle: input.bundle,
      };

  const nextDrafts = existingDraft
    ? projectDrafts.map((draft) =>
        draft.sessionId === input.sessionId ? nextDraft : draft,
      )
    : [nextDraft, ...projectDrafts];

  writeDraftMap({
    ...allDrafts,
    [input.projectId]: nextDrafts,
  });

  return nextDraft;
}
