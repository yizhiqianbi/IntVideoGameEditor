import { NextResponse } from "next/server";
import { resolvePlayAgentProviderAdapter } from "@/lib/play-agent/provider";
import { buildFallbackHtmlGame } from "@/lib/play-agent/html-prompts";
import { getPlayAgentTemplateById, listPlayAgentTemplates } from "@/lib/play-agent/templates";
import { getPlayAgentSkillById } from "@/lib/play-agent/skills";
import type { HtmlGameArtifact } from "@/lib/play-agent/types";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "请求体必须是 JSON。" },
      { status: 400 },
    );
  }

  const input = body as {
    prompt?: unknown;
    templateId?: unknown;
    skillIds?: unknown;
  };
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json(
      { ok: false, error: "prompt 不能为空。" },
      { status: 400 },
    );
  }

  const defaultTemplate = listPlayAgentTemplates()[0];
  const templateId =
    typeof input.templateId === "string"
      ? input.templateId
      : defaultTemplate?.id ?? "single-screen-arcade";
  const template = getPlayAgentTemplateById(templateId) ?? defaultTemplate;
  if (!template) {
    return NextResponse.json(
      { ok: false, error: "找不到可用模板。" },
      { status: 500 },
    );
  }

  const skillIds = Array.isArray(input.skillIds)
    ? (input.skillIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const skills = skillIds
    .map((id) => getPlayAgentSkillById(id))
    .filter((s): s is NonNullable<ReturnType<typeof getPlayAgentSkillById>> =>
      Boolean(s),
    );

  const adapter = resolvePlayAgentProviderAdapter();
  const sessionId = `html-${Date.now().toString(36)}`;

  try {
    const { bundle } = await adapter.run({
      projectId: "studio-html",
      templateId: template.id,
      skillIds: skills.map((s) => s.id),
      prompt,
      sessionId,
    });

    const artifact: HtmlGameArtifact =
      bundle.htmlGame ?? buildFallbackHtmlGame(bundle.plan.concept, bundle.plan.loop);

    return NextResponse.json({
      ok: true,
      artifact,
      plan: bundle.plan,
      provider: adapter.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
