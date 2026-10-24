import { composePlayAgentPrompt, buildPlayAgentPlanInput } from "./prompts";
import type {
  PlayAgentArtifactBundle,
  PlayAgentEvent,
  PlayAgentPlan,
  PlayAgentPlanInput,
  PlayAgentProviderAdapter,
  PlayAgentRunInput,
} from "./types";

function slugifyTitle(value: string) {
  const matched = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");

  return matched || "play-draft";
}

function buildConceptTitle(input: PlayAgentPlanInput) {
  const prompt = input.prompt.replace(/\s+/g, " ").trim();

  if (prompt.length <= 18) {
    return prompt;
  }

  return `${prompt.slice(0, 18)}…`;
}

export function createMockPlayAgentPlan(input: PlayAgentPlanInput): PlayAgentPlan {
  const concept = buildConceptTitle(input);
  const hasRetention = input.skills.some((skill) => skill.kind === "retention");
  const hasSocial = input.skills.some((skill) => skill.kind === "social");

  return {
    concept,
    loop: "观察局面 → 做出一次核心操作 → 立刻获得反馈 → 决定是否继续冲分",
    controls: ["点击", "拖拽"],
    progression: hasRetention ? "每次成功都会提高难度或追加一个新目标。" : "随着分数提升，节奏逐步加快。",
    winCondition: hasSocial ? "在时限内达成目标并刷新榜单名次。" : "在时限内完成目标并达成更高分数。",
    failCondition: "操作失误次数超限，或倒计时归零。",
    coverConcept: `封面聚焦“${concept}”的一个决定性瞬间，构图干净，标题清楚，适合封面流。`,
    filesToGenerate: ["src/game.ts", "src/config.ts", "README.md"],
  };
}

function buildMockFiles(plan: PlayAgentPlan, input: PlayAgentRunInput) {
  const title = plan.concept || "新小游戏";

  return [
    {
      path: "src/game.ts",
      content: `export const gameSpec = {
  title: ${JSON.stringify(title)},
  coreLoop: ${JSON.stringify(plan.loop)},
  winCondition: ${JSON.stringify(plan.winCondition)},
  failCondition: ${JSON.stringify(plan.failCondition)},
  controls: ${JSON.stringify(plan.controls)},
  prompt: ${JSON.stringify(input.prompt)},
};
`,
    },
    {
      path: "src/config.ts",
      content: `export const gameConfig = {
  templateId: ${JSON.stringify(input.templateId)},
  skillIds: ${JSON.stringify(input.skillIds)},
  durationSec: 45,
  viewport: { width: 720, height: 1280 },
};
`,
    },
    {
      path: "README.md",
      content: `# ${title}

## Loop

${plan.loop}

## Win

${plan.winCondition}

## Fail

${plan.failCondition}
`,
    },
  ];
}

function buildEvents(sessionId: string, plan: PlayAgentPlan, files: Array<{ path: string; content: string }>): PlayAgentEvent[] {
  const timestamp = new Date().toISOString();

  return [
    {
      type: "planning_started",
      sessionId,
      message: "开始生成游戏计划。",
      timestamp,
    },
    {
      type: "planning_ready",
      sessionId,
      message: `计划已生成：${plan.concept}`,
      timestamp,
    },
    {
      type: "run_started",
      sessionId,
      message: "开始生成代码与预览资产。",
      timestamp,
    },
    ...files.map((file) => ({
      type: "file_created" as const,
      sessionId,
      message: `已生成 ${file.path}`,
      path: file.path,
      timestamp,
    })),
    {
      type: "run_ready",
      sessionId,
      message: "Agent 产物已准备完成。",
      timestamp,
    },
  ];
}

export const MOCK_PLAY_AGENT_ADAPTER: PlayAgentProviderAdapter = {
  name: "mock-play-agent",
  async plan(input) {
    return createMockPlayAgentPlan(input);
  },
  async run(input) {
    const planInput = buildPlayAgentPlanInput({
      projectId: input.projectId,
      prompt: input.prompt,
      templateId: input.templateId,
      skillIds: input.skillIds,
    });
    const plan = createMockPlayAgentPlan(planInput);
    const files = buildMockFiles(plan, input);
    const bundle: PlayAgentArtifactBundle = {
      sessionId: input.sessionId,
      plan,
      files,
      coverPrompt: `${composePlayAgentPrompt(planInput)}\n封面要求：${plan.coverConcept}`,
      previewEntry: "src/game.ts",
    };

    return {
      events: buildEvents(input.sessionId, plan, files),
      bundle,
    };
  },
};

export async function runMockPlayAgent(input: PlayAgentRunInput) {
  const sessionId = `mock-${slugifyTitle(input.prompt)}-${Date.now()}`;
  const result = await MOCK_PLAY_AGENT_ADAPTER.run({
    ...input,
    sessionId,
  });

  return result.bundle;
}
