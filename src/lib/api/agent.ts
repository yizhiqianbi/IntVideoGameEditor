import { apiFetch } from "./client";
import type { AgentDraft, AgentScreenplay } from "@/lib/agent-mode";

export interface TestApiKeyResult {
  success: boolean;
  message: string;
  result?: string;
  configured: boolean;
}

export function generateDraft(body: {
  storyText?: string;
  feedback?: string;
  imageUrl?: string;
  apiKey?: string;
}) {
  return apiFetch<AgentDraft>("/api/agent/draft", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function generateScript(body: {
  storyText: string;
  feedback?: string;
  draft?: AgentDraft;
  apiKey?: string;
}) {
  return apiFetch<AgentScreenplay>("/api/agent/script", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function testApiKey(apiKey?: string) {
  return apiFetch<TestApiKeyResult>("/api/agent/test", {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}
