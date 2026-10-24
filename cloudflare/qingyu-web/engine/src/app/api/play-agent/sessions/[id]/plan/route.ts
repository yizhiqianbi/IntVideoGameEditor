import { NextResponse } from "next/server";
import playAgentSessionsModule from "@/lib/play-agent/sessions";

const { generatePlanForPlayAgentSession } =
  playAgentSessionsModule as typeof import("@/lib/play-agent/sessions");

type PlanBody = {
  templateId?: string;
  skillIds?: string[];
  prompt?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as PlanBody;

    if (!body.templateId?.trim()) {
      return NextResponse.json({ error: "templateId 不能为空。" }, { status: 400 });
    }

    const plan = await generatePlanForPlayAgentSession(id, {
      templateId: body.templateId.trim(),
      skillIds: Array.isArray(body.skillIds) ? body.skillIds : [],
      prompt: body.prompt?.trim() ?? "",
    });

    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "生成 Play 计划失败。",
      },
      { status: 500 },
    );
  }
}
