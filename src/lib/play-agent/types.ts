export type PlayAgentTemplateCategory =
  | "arcade"
  | "puzzle"
  | "sim"
  | "narrative";

export type PlayAgentOutputShape =
  | "single-screen"
  | "level-based"
  | "chapter-based";

export type PlayAgentSkillKind =
  | "gameplay"
  | "retention"
  | "social"
  | "cover";

export type PlayAgentSessionStatus =
  | "idle"
  | "planning"
  | "running"
  | "ready"
  | "failed";

export type PlayAgentTemplate = {
  id: string;
  name: string;
  category: PlayAgentTemplateCategory;
  starterPrompt: string;
  starterConstraints: string[];
  outputShape: PlayAgentOutputShape;
};

export type PlayAgentSkillRef = {
  id: string;
  name: string;
  kind: PlayAgentSkillKind;
  promptFrame: string;
};

export type PlayAgentSession = {
  id: string;
  projectId: string;
  templateId?: string;
  skillIds: string[];
  prompt: string;
  status: PlayAgentSessionStatus;
  createdAt: string;
  updatedAt: string;
};

export type PlayAgentPlan = {
  concept: string;
  loop: string;
  controls: string[];
  progression?: string;
  winCondition: string;
  failCondition: string;
  coverConcept: string;
  filesToGenerate: string[];
};

export type PlayAgentArtifactFile = {
  path: string;
  content: string;
};

export type HtmlGameArtifact = {
  html: string;
  meta: {
    title: string;
    description: string;
    coverPrompt?: string;
    durationSec?: number;
  };
  runtime: {
    width: number;
    height: number;
    orientation: "portrait" | "landscape";
  };
};

export type PlayAgentArtifactBundle = {
  sessionId: string;
  plan: PlayAgentPlan;
  files: PlayAgentArtifactFile[];
  htmlGame?: HtmlGameArtifact;
  coverPrompt?: string;
  coverAssetUrl?: string;
  previewEntry?: string;
};

export type PlayAgentApplyPayload = {
  projectId: string;
  sessionId: string;
  draftName: string;
  slug: string;
  templateId?: string;
  skillIds: string[];
  prompt: string;
  bundle: PlayAgentArtifactBundle;
};

export type PlayAgentPlanInput = {
  projectId: string;
  prompt: string;
  template: PlayAgentTemplate;
  skills: PlayAgentSkillRef[];
};

export type PlayAgentRunInput = {
  projectId: string;
  templateId: string;
  skillIds: string[];
  prompt: string;
};

export type PlayAgentEvent =
  | {
      type: "planning_started" | "planning_ready" | "run_started" | "run_ready";
      sessionId: string;
      message: string;
      timestamp: string;
    }
  | {
      type: "file_created";
      sessionId: string;
      message: string;
      path: string;
      timestamp: string;
    }
  | {
      type: "failed";
      sessionId: string;
      message: string;
      timestamp: string;
    };

export type PlayAgentProviderAdapter = {
  name: string;
  plan(input: PlayAgentPlanInput): Promise<PlayAgentPlan>;
  run(input: PlayAgentRunInput & { sessionId: string }): Promise<{
    events: PlayAgentEvent[];
    bundle: PlayAgentArtifactBundle;
  }>;
};
