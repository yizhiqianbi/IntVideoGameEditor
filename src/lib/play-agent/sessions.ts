import {
  MOCK_PLAY_AGENT_ADAPTER,
  buildPlayAgentPlanInput,
} from "./index";
import type {
  PlayAgentApplyPayload,
  PlayAgentArtifactBundle,
  PlayAgentEvent,
  PlayAgentPlan,
  PlayAgentSession,
} from "./types";

type SessionStoreRecord = {
  session: PlayAgentSession;
  plan?: PlayAgentPlan;
  bundle?: PlayAgentArtifactBundle;
  events: PlayAgentEvent[];
  lastError?: string;
};

type CreatePlayAgentSessionInput = {
  projectId: string;
  templateId?: string;
  skillIds?: string[];
  prompt?: string;
};

type UpdateSessionPlanInput = {
  templateId: string;
  skillIds: string[];
  prompt: string;
};

const globalStore = globalThis as typeof globalThis & {
  __funxPlayAgentSessions?: Map<string, SessionStoreRecord>;
};

function getSessionStore() {
  if (!globalStore.__funxPlayAgentSessions) {
    globalStore.__funxPlayAgentSessions = new Map<string, SessionStoreRecord>();
  }

  return globalStore.__funxPlayAgentSessions;
}

function nowIso() {
  return new Date().toISOString();
}

function updateSessionRecord(
  record: SessionStoreRecord,
  patch: Partial<PlayAgentSession>,
) {
  record.session = {
    ...record.session,
    ...patch,
    updatedAt: nowIso(),
  };
}

function slugifyDraftName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "play-draft";
}

export function resetPlayAgentSessionsForTest() {
  getSessionStore().clear();
}

export function createPlayAgentSession(input: CreatePlayAgentSessionInput) {
  const session: PlayAgentSession = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    templateId: input.templateId,
    skillIds: input.skillIds ?? [],
    prompt: input.prompt ?? "",
    status: "idle",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const record: SessionStoreRecord = {
    session,
    events: [],
  };

  getSessionStore().set(session.id, record);

  return session;
}

export function getPlayAgentSessionRecord(sessionId: string) {
  return getSessionStore().get(sessionId) ?? null;
}

export async function generatePlanForPlayAgentSession(
  sessionId: string,
  input: UpdateSessionPlanInput,
) {
  const record = getPlayAgentSessionRecord(sessionId);

  if (!record) {
    throw new Error("未找到对应的 Play Agent 会话。");
  }

  updateSessionRecord(record, {
    status: "planning",
    templateId: input.templateId,
    skillIds: input.skillIds,
    prompt: input.prompt,
  });

  const planInput = buildPlayAgentPlanInput({
    projectId: record.session.projectId,
    prompt: input.prompt,
    templateId: input.templateId,
    skillIds: input.skillIds,
  });
  const plan = await MOCK_PLAY_AGENT_ADAPTER.plan(planInput);

  record.plan = plan;
  record.events.push({
    type: "planning_ready",
    sessionId,
    message: `计划已生成：${plan.concept}`,
    timestamp: nowIso(),
  });
  updateSessionRecord(record, {
    status: "idle",
  });

  return plan;
}

export async function runPlayAgentSession(sessionId: string) {
  const record = getPlayAgentSessionRecord(sessionId);

  if (!record) {
    throw new Error("未找到对应的 Play Agent 会话。");
  }

  if (!record.session.templateId || record.session.skillIds.length === 0) {
    throw new Error("请先选择模板和 Skill。");
  }

  if (!record.plan) {
    await generatePlanForPlayAgentSession(sessionId, {
      templateId: record.session.templateId,
      skillIds: record.session.skillIds,
      prompt: record.session.prompt,
    });
  }

  updateSessionRecord(record, {
    status: "running",
  });

  const result = await MOCK_PLAY_AGENT_ADAPTER.run({
    sessionId,
    projectId: record.session.projectId,
    templateId: record.session.templateId,
    skillIds: record.session.skillIds,
    prompt: record.session.prompt,
  });

  record.bundle = result.bundle;
  record.events.push(...result.events);
  updateSessionRecord(record, {
    status: "ready",
  });

  return result.bundle;
}

export function getPlayAgentArtifacts(sessionId: string) {
  const record = getPlayAgentSessionRecord(sessionId);

  if (!record?.bundle) {
    throw new Error("当前会话还没有可用产物。");
  }

  return record.bundle;
}

export function getPlayAgentEvents(sessionId: string) {
  const record = getPlayAgentSessionRecord(sessionId);

  if (!record) {
    throw new Error("未找到对应的 Play Agent 会话。");
  }

  return record.events;
}

export function buildPlayAgentApplyPayload(
  sessionId: string,
): PlayAgentApplyPayload {
  const record = getPlayAgentSessionRecord(sessionId);

  if (!record?.bundle || !record.plan) {
    throw new Error("当前会话还没有可应用的产物。");
  }

  const draftName = record.plan.concept || "未命名 Play 草案";

  return {
    projectId: record.session.projectId,
    sessionId,
    draftName,
    slug: slugifyDraftName(draftName),
    templateId: record.session.templateId,
    skillIds: record.session.skillIds,
    prompt: record.session.prompt,
    bundle: record.bundle,
  };
}

const playAgentSessionsModule = {
  resetPlayAgentSessionsForTest,
  createPlayAgentSession,
  getPlayAgentSessionRecord,
  generatePlanForPlayAgentSession,
  runPlayAgentSession,
  getPlayAgentArtifacts,
  getPlayAgentEvents,
  buildPlayAgentApplyPayload,
};

export default playAgentSessionsModule;
