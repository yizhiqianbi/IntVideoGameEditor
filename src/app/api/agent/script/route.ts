import { NextResponse } from "next/server";
import {
  createLocalAgentScreenplay,
  normalizeAgentScreenplay,
  normalizeAgentScreenplayFromText,
  type AgentDraft,
} from "../../../../lib/agent-mode";
import {
  SCRIPT_SYSTEM_PROMPT,
  buildScriptUserPrompt,
} from "../../../../lib/agent-prompts";

type RequestBody = {
  storyText?: string;
  feedback?: string;
  draft?: AgentDraft | null;
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

    if (storyText.length === 0) {
      return NextResponse.json({ message: "故事内容不能为空。" }, { status: 400 });
    }

    const apiKey =
      body.apiKey?.trim() ??
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

    const systemPrompt = SCRIPT_SYSTEM_PROMPT;

    const userPrompt = buildScriptUserPrompt(
      storyText,
      feedback,
      body.draft ?? null,
    );
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
