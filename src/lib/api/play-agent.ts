import { apiFetch } from "./client";
import type {
  PlayAgentApplyPayload,
  PlayAgentArtifactBundle,
  PlayAgentPlan,
  PlayAgentSession,
} from "@/lib/play-agent/types";

export type PlayAgentSessionSummary = {
  session: PlayAgentSession;
  plan: PlayAgentPlan | null;
  hasBundle: boolean;
  eventCount: number;
};

export type CreatePlayAgentSessionBody = {
  projectId: string;
  templateId?: string;
  skillIds?: string[];
  prompt?: string;
};

export type PlanPlayAgentSessionBody = {
  templateId: string;
  skillIds: string[];
  prompt: string;
};

export function createPlayAgentSession(body: CreatePlayAgentSessionBody) {
  return apiFetch<PlayAgentSession>("/api/play-agent/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getPlayAgentSession(sessionId: string) {
  return apiFetch<PlayAgentSessionSummary>(
    `/api/play-agent/sessions/${sessionId}`,
  );
}

export function generatePlayAgentPlan(
  sessionId: string,
  body: PlanPlayAgentSessionBody,
) {
  return apiFetch<PlayAgentPlan>(`/api/play-agent/sessions/${sessionId}/plan`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function runPlayAgent(sessionId: string) {
  return apiFetch<PlayAgentArtifactBundle>(
    `/api/play-agent/sessions/${sessionId}/run`,
    {
      method: "POST",
    },
  );
}

export function listPlayAgentEvents(sessionId: string) {
  return apiFetch<Array<Record<string, unknown>>>(
    `/api/play-agent/sessions/${sessionId}/events`,
  );
}

export function getPlayAgentArtifacts(sessionId: string) {
  return apiFetch<PlayAgentArtifactBundle>(
    `/api/play-agent/sessions/${sessionId}/artifacts`,
  );
}

export function applyPlayAgentArtifacts(sessionId: string) {
  return apiFetch<PlayAgentApplyPayload>(
    `/api/play-agent/sessions/${sessionId}/apply`,
    {
      method: "POST",
    },
  );
}
