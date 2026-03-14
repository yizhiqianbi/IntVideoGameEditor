import { NextResponse } from "next/server";
import {
  createLocalAgentDraft,
  normalizeAgentDraft,
  normalizeAgentDraftFromText,
} from "../../../../lib/agent-mode";

type RequestBody = {
  storyText?: string;
  feedback?: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function pickString(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function extractResponsesText(payload: unknown) {
  if (!isRecord(payload)) {
    return undefined;
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  if (Array.isArray(payload.output)) {
    const texts = payload.output
      .flatMap((item) => {
        if (!isRecord(item) || !Array.isArray(item.content)) {
          return [];
        }

        return item.content
          .map((contentItem) => {
            if (!isRecord(contentItem)) {
              return undefined;
            }

            return pickString(contentItem, ["text"]);
          })
          .filter((text): text is string => Boolean(text));
      })
      .join("\n")
      .trim();

    if (texts.length > 0) {
      return texts;
    }
  }

  return undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const storyText = body.storyText?.trim() ?? "";
    const feedback = body.feedback?.trim() ?? "";

    if (storyText.length === 0) {
      return NextResponse.json(
        { message: "故事内容不能为空。" },
        { status: 400 },
      );
    }

    const apiKey =
      process.env.AGENT_API_KEY?.trim() ??
      process.env.NEXT_PUBLIC_VOLCENGINE_API_KEY?.trim() ??
      "";
    const model =
      process.env.AGENT_API_MODEL?.trim() ?? "doubao-seed-2-0-lite-260215";

    if (!apiKey) {
      return NextResponse.json(createLocalAgentDraft({ storyText, feedback }));
    }

    const systemPrompt = [
      "你是互动影视故事拆解 Agent。",
      "你的任务是把用户的故事拆成可直接进入节点编辑器的结构化草案。",
      "你必须只输出 JSON，不要输出 markdown，不要输出解释。",
      "JSON 顶层字段必须包含：storyTitle, summary, characters, branches, scenes, transitions。",
      "characters[].字段必须包含：id, name, bio, appearancePrompt, basePrompt, imageModel。",
      "characters[].bio 必须是可直接用于角色生图的人物设定，不要只写抽象职责。",
      "branches[].字段必须包含：id, name, predictedOutcome, tone。",
      "scenes[].字段必须包含：id, title, summary, branchId, durationSec, involvedCharacterIds, actions, videoPrompt。",
      "actions[].字段必须包含：characterId, action, emotion, dialogue。",
      "transitions[].字段必须包含：id, sourceSceneId, targetSceneId, conditionVariable, choiceLabel。",
      "所有 id 必须稳定、简短、ASCII 可序列化。",
      "每个场景时长控制在 3 到 8 秒。",
      "分支结果要有明显差异；如无明确分支，就只输出单线结构。",
      "整个 scenes + transitions 必须形成单根树结构：只有一个 root，没有断点，没有孤立节点，没有空场景。",
      "线性推进也要输出 transitions，choiceLabel 使用“继续”，不能省略。",
      "角色外观提示词要利于后续生图和图生视频保持一致性。",
    ].join("\n");

    const userPrompt = [
      `故事内容：\n${storyText}`,
      feedback.length > 0 ? `修订意见：\n${feedback}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    let response: Response;

    try {
      response = await fetch("https://ark.cn-beijing.volces.com/api/v3/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: false,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: systemPrompt,
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: userPrompt,
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json(createLocalAgentDraft({ storyText, feedback }));
      }

      throw error;
    }

    clearTimeout(timeoutId);

    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message = isRecord(payload)
        ? pickString(payload, ["message", "error", "code"]) ?? "Agent API 调用失败。"
        : "Agent API 调用失败。";
      return NextResponse.json({ message }, { status: response.status });
    }

    const outputText = extractResponsesText(payload);

    if (outputText) {
      return NextResponse.json(
        normalizeAgentDraftFromText(outputText, {
          storyText,
          feedback,
        }),
      );
    }

    return NextResponse.json(
      normalizeAgentDraft(payload, {
        storyText,
        feedback,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Agent 草案生成失败。",
      },
      { status: 500 },
    );
  }
}
