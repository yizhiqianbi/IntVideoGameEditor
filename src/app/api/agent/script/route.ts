import { NextResponse } from "next/server";
import {
  createLocalAgentScreenplay,
  normalizeAgentScreenplay,
  normalizeAgentScreenplayFromText,
  type AgentDraft,
} from "../../../../lib/agent-mode";

type RequestBody = {
  storyText?: string;
  feedback?: string;
  draft?: AgentDraft | null;
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
      return NextResponse.json({ message: "故事内容不能为空。" }, { status: 400 });
    }

    const apiKey =
      process.env.AGENT_API_KEY?.trim() ??
      process.env.NEXT_PUBLIC_VOLCENGINE_API_KEY?.trim() ??
      "";
    const model =
      process.env.AGENT_API_MODEL?.trim() ?? "doubao-seed-2-0-lite-260215";

    if (!apiKey) {
      return NextResponse.json(
        createLocalAgentScreenplay({
          storyText,
          feedback,
          draft: body.draft ?? null,
        }),
      );
    }

    const systemPrompt = [
      "你是互动影视剧本编剧 Agent。",
      "你的任务是根据故事模板和已有分镜草案，输出一份适合互动影视项目继续制作的剧本。",
      "你必须只输出 JSON，不要输出 markdown，不要输出解释。",
      "JSON 顶层字段必须包含：title, logline, script。",
      "script 必须是完整中文剧本文本，包含角色设定、分镜剧本、分支选择和结果走向。",
      "每个镜头都要明确画面、角色动作、情绪和分支钩子。",
      "如果用户提供了草案，优先沿用草案中的角色、镜头和分支命名，不要随意改名。",
      "整体风格要适合短剧/互动影视制作，不要写小说体。",
    ].join("\n");

    const userPrompt = [
      `故事内容：\n${storyText}`,
      feedback.length > 0 ? `修订意见：\n${feedback}` : "",
      body.draft ? `现有草案：\n${JSON.stringify(body.draft, null, 2)}` : "",
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
        return NextResponse.json(
          createLocalAgentScreenplay({
            storyText,
            feedback,
            draft: body.draft ?? null,
          }),
        );
      }

      throw error;
    }

    clearTimeout(timeoutId);

    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message = isRecord(payload)
        ? pickString(payload, ["message", "error", "code"]) ?? "Agent 剧本生成失败。"
        : "Agent 剧本生成失败。";
      return NextResponse.json({ message }, { status: response.status });
    }

    const outputText = extractResponsesText(payload);

    if (outputText) {
      return NextResponse.json(
        normalizeAgentScreenplayFromText(outputText, {
          storyText,
          feedback,
          draft: body.draft ?? null,
        }),
      );
    }

    return NextResponse.json(
      normalizeAgentScreenplay(payload, {
        storyText,
        feedback,
        draft: body.draft ?? null,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Agent 剧本生成失败。",
      },
      { status: 500 },
    );
  }
}
