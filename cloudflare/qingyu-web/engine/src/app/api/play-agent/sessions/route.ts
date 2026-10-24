import { NextResponse } from "next/server";
import playAgentSessionsModule from "@/lib/play-agent/sessions";

const { createPlayAgentSession } =
  playAgentSessionsModule as typeof import("@/lib/play-agent/sessions");

type CreateSessionBody = {
  projectId?: string;
  templateId?: string;
  skillIds?: string[];
  prompt?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateSessionBody;
    const projectId = body.projectId?.trim() ?? "";

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId 不能为空。" },
        { status: 400 },
      );
    }

    const session = createPlayAgentSession({
      projectId,
      templateId: body.templateId?.trim() || undefined,
      skillIds: Array.isArray(body.skillIds) ? body.skillIds : [],
      prompt: body.prompt?.trim() ?? "",
    });

    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "创建 Play Agent 会话失败。",
      },
      { status: 500 },
    );
  }
}
