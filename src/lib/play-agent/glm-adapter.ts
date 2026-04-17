import { composePlayAgentPrompt } from "./prompts";
import type {
  PlayAgentArtifactBundle,
  PlayAgentEvent,
  PlayAgentPlan,
  PlayAgentPlanInput,
  PlayAgentProviderAdapter,
  PlayAgentRunInput,
} from "./types";

type GlmCodingConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

type GlmChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export function normalizeGlmCodingErrorMessage(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "object" &&
    (payload as { error?: Record<string, unknown> }).error
  ) {
    const errorRecord = (payload as { error: Record<string, unknown> }).error;
    if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
      return errorRecord.message;
    }
  }

  return "GLM Coding Plan 调用失败。";
}

function extractTextFromGlmResponse(payload: unknown) {
  const response = payload as GlmChatResponse;
  return response.choices?.[0]?.message?.content?.trim() ?? "";
}

function extractJsonBlock(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("GLM 返回内容中没有可解析的 JSON。");
}

function parseJsonObject<T>(text: string) {
  const jsonBlock = extractJsonBlock(text);
  return JSON.parse(jsonBlock) as T;
}

function normalizePlan(value: Partial<PlayAgentPlan>): PlayAgentPlan {
  return {
    concept: value.concept?.trim() || "未命名 Play 方案",
    loop: value.loop?.trim() || "观察 → 操作 → 反馈 → 再挑战",
    controls:
      Array.isArray(value.controls) && value.controls.length > 0
        ? value.controls.map((item) => String(item))
        : ["点击"],
    progression: value.progression?.trim() || undefined,
    winCondition: value.winCondition?.trim() || "达到目标分数。",
    failCondition: value.failCondition?.trim() || "时限结束或失误超限。",
    coverConcept: value.coverConcept?.trim() || "封面突出一个清楚的玩法瞬间。",
    filesToGenerate:
      Array.isArray(value.filesToGenerate) && value.filesToGenerate.length > 0
        ? value.filesToGenerate.map((item) => String(item))
        : ["src/game.ts", "src/config.ts", "README.md"],
  };
}

function normalizeFiles(
  value: unknown,
): Array<{ path: string; content: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const path = typeof record.path === "string" ? record.path : null;
      const content = typeof record.content === "string" ? record.content : null;

      if (!path || !content) {
        return null;
      }

      return { path, content };
    })
    .filter((item): item is { path: string; content: string } => Boolean(item));
}

async function callGlmCoding(config: GlmCodingConfig, messages: Array<{ role: "system" | "user"; content: string }>) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      messages,
    }),
  });

  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(normalizeGlmCodingErrorMessage(payload));
  }

  return extractTextFromGlmResponse(payload);
}

function buildPlanPrompt(input: PlayAgentPlanInput) {
  return [
    "你是 Fun-X-Studio 的 Web H5 小游戏策划代理。",
    "请基于给定模板、skills 和用户 prompt，输出严格 JSON。",
    "JSON schema:",
    JSON.stringify({
      concept: "string",
      loop: "string",
      controls: ["string"],
      progression: "string",
      winCondition: "string",
      failCondition: "string",
      coverConcept: "string",
      filesToGenerate: ["string"],
    }),
    "",
    composePlayAgentPrompt(input),
  ].join("\n");
}

function buildRunPrompt(input: PlayAgentRunInput & { sessionId: string }, plan: PlayAgentPlan) {
  return [
    "你是 Fun-X-Studio 的 Web H5 小游戏代码生成代理。",
    "请基于给定计划输出严格 JSON，不要输出解释。",
    "JSON schema:",
    JSON.stringify({
      files: [{ path: "string", content: "string" }],
      coverPrompt: "string",
      previewEntry: "string",
    }),
    "",
    `sessionId: ${input.sessionId}`,
    `projectId: ${input.projectId}`,
    `templateId: ${input.templateId}`,
    `skillIds: ${input.skillIds.join(", ")}`,
    `prompt: ${input.prompt}`,
    `plan: ${JSON.stringify(plan)}`,
  ].join("\n");
}

export function createGlmCodingPlanAdapter(
  config: GlmCodingConfig,
): PlayAgentProviderAdapter {
  return {
    name: "glm-coding-plan",
    async plan(input) {
      const text = await callGlmCoding(config, [
        {
          role: "system",
          content: "You generate structured H5 game plans as strict JSON.",
        },
        {
          role: "user",
          content: buildPlanPrompt(input),
        },
      ]);

      return normalizePlan(parseJsonObject<Partial<PlayAgentPlan>>(text));
    },
    async run(input) {
      const planInput: PlayAgentPlanInput = {
        projectId: input.projectId,
        prompt: input.prompt,
        template: {
          id: input.templateId,
          name: input.templateId,
          category: "arcade",
          starterPrompt: "",
          starterConstraints: [],
          outputShape: "single-screen",
        },
        skills: [],
      };
      const draftPlan = await this.plan(planInput);
      const text = await callGlmCoding(config, [
        {
          role: "system",
          content: "You generate structured H5 game artifact bundles as strict JSON.",
        },
        {
          role: "user",
          content: buildRunPrompt(input, draftPlan),
        },
      ]);
      const parsed = parseJsonObject<{
        files?: unknown;
        coverPrompt?: string;
        previewEntry?: string;
      }>(text);
      const files = normalizeFiles(parsed.files);
      const timestamp = new Date().toISOString();
      const bundle: PlayAgentArtifactBundle = {
        sessionId: input.sessionId,
        plan: draftPlan,
        files,
        coverPrompt:
          typeof parsed.coverPrompt === "string" && parsed.coverPrompt.trim()
            ? parsed.coverPrompt
            : draftPlan.coverConcept,
        previewEntry:
          typeof parsed.previewEntry === "string" && parsed.previewEntry.trim()
            ? parsed.previewEntry
            : files[0]?.path,
      };
      const events: PlayAgentEvent[] = [
        {
          type: "planning_started",
          sessionId: input.sessionId,
          message: "GLM 开始生成 Play 计划。",
          timestamp,
        },
        {
          type: "planning_ready",
          sessionId: input.sessionId,
          message: `GLM 计划已生成：${draftPlan.concept}`,
          timestamp,
        },
        {
          type: "run_started",
          sessionId: input.sessionId,
          message: "GLM 开始生成代码产物。",
          timestamp,
        },
        ...files.map((file) => ({
          type: "file_created" as const,
          sessionId: input.sessionId,
          message: `GLM 已生成 ${file.path}`,
          path: file.path,
          timestamp,
        })),
        {
          type: "run_ready",
          sessionId: input.sessionId,
          message: "GLM 产物已准备完成。",
          timestamp,
        },
      ];

      return { events, bundle };
    },
  };
}
