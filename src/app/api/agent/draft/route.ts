import { NextResponse } from "next/server";
import {
  createLocalAgentDraft,
  normalizeAgentDraft,
  normalizeAgentDraftFromText,
} from "../../../../lib/agent-mode";
import {
  DRAFT_SYSTEM_PROMPT,
  buildDraftUserPrompt,
  buildDraftUserPromptWithImage,
} from "../../../../lib/agent-prompts";

type RequestBody = {
  storyText?: string;
  feedback?: string;
  imageUrl?: string;
  apiKey?: string;
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
    const imageUrl = body.imageUrl?.trim() ?? "";

    if (storyText.length === 0 && imageUrl.length === 0) {
      return NextResponse.json(
        { message: "故事内容或图片不能为空。" },
        { status: 400 },
      );
    }

    const apiKey =
      body.apiKey?.trim() ??
      process.env.AGENT_API_KEY?.trim() ??
      process.env.NEXT_PUBLIC_VOLCENGINE_API_KEY?.trim() ??
      "";
    const model =
      process.env.AGENT_API_MODEL?.trim() ?? "doubao-seed-2-0-pro-260215";

    if (!apiKey) {
      return NextResponse.json(createLocalAgentDraft({ storyText, feedback }));
    }

    const systemPrompt = DRAFT_SYSTEM_PROMPT;

    // 根据是否有图片来构建不同的 prompt
    const hasImage = imageUrl.length > 0;
    const userPrompt = hasImage
      ? buildDraftUserPromptWithImage(storyText, feedback, imageUrl)
      : buildDraftUserPrompt(storyText, feedback);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000); // 增加超时时间以处理图像

    let response: Response;

    try {
      // 构建 user content
      const userContent: unknown[] = [];

      if (hasImage) {
        // 有图像时，先添加图像，再添加文本
        userContent.push({
          type: "input_image",
          image_url: imageUrl,
        });
      }

      userContent.push({
        type: "input_text",
        text: userPrompt,
      });

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
              content: userContent,
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
