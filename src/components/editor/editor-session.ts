import type { ProviderCredentialState } from "../../lib/video-generation";
import type { AgentDraft, AgentScreenplay } from "../../lib/agent-mode";
import type {
  AssetKind,
  CharacterDefinition,
  EditorFlowEdge,
  EditorFlowNode,
  ProjectSettings,
  SceneDefinition,
} from "./project";

export type RuntimeAsset = {
  file: File;
  objectUrl: string;
  kind: AssetKind;
};

export type EditorSessionSnapshot = {
  currentProjectId: string | null;
  currentProjectName: string;
  currentProjectDescription: string;
  nodes: EditorFlowNode[];
  edges: EditorFlowEdge[];
  characters: CharacterDefinition[];
  scenes: SceneDefinition[];
  settings: ProjectSettings;
  providerCredentials: ProviderCredentialState;
  assetRuntimeMap: Record<string, RuntimeAsset>;
  agentStoryText: string;
  agentFeedbackText: string;
  agentImageUrl: string;
  agentDraft: AgentDraft | null;
  agentScreenplay: AgentScreenplay | null;
  activeTemplateId: string | null;
  templateSaveName: string;
  templateSaveDescription: string;
};

let cachedEditorSession: EditorSessionSnapshot | null = null;
const PENDING_EDITOR_SESSION_STORAGE_KEY =
  "int-video-game-editor.pending-editor-session.v1";

export function getCachedEditorSession() {
  return cachedEditorSession;
}

export function setCachedEditorSession(snapshot: EditorSessionSnapshot) {
  cachedEditorSession = snapshot;
}

export function queuePendingEditorSession(snapshot: EditorSessionSnapshot) {
  cachedEditorSession = snapshot;

  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    PENDING_EDITOR_SESSION_STORAGE_KEY,
    JSON.stringify({
      ...snapshot,
      assetRuntimeMap: {},
    }),
  );
}

export function consumePendingEditorSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(PENDING_EDITOR_SESSION_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  window.sessionStorage.removeItem(PENDING_EDITOR_SESSION_STORAGE_KEY);

  try {
    const parsed = JSON.parse(rawValue) as Omit<
      EditorSessionSnapshot,
      "assetRuntimeMap"
    > & {
      assetRuntimeMap?: Record<string, RuntimeAsset>;
    };

    const snapshot: EditorSessionSnapshot = {
      ...parsed,
      assetRuntimeMap: {},
    };

    cachedEditorSession = snapshot;

    return snapshot;
  } catch {
    return null;
  }
}
