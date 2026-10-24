import { apiFetch } from "./client";
import type {
  ProviderCredentialState,
  UnifiedVideoCreateResponse,
  UnifiedVideoStatusResponse,
} from "@/lib/video-generation";

export interface CreateVideoTaskInput {
  providerId: string;
  providerPriority: string[];
  credentials: ProviderCredentialState;
  request: Record<string, unknown>;
}

export interface PollVideoStatusInput {
  providerId: string;
  taskId: string;
  credentials: ProviderCredentialState;
}

export function createVideoTask(body: CreateVideoTaskInput) {
  return apiFetch<UnifiedVideoCreateResponse>("/api/video/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function pollVideoStatus(body: PollVideoStatusInput) {
  return apiFetch<UnifiedVideoStatusResponse>("/api/video/status", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
