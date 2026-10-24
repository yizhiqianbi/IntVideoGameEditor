import { redirect } from "next/navigation";
import { PlayAgentStudio } from "@/components/studio/play-agent/play-agent-studio";

export default async function PencilStudioVidPlayAgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const rawProjectId = resolvedSearchParams.project;
  const projectId = Array.isArray(rawProjectId) ? rawProjectId[0] : rawProjectId;

  if (!projectId) {
    redirect("/projects");
  }

  return <PlayAgentStudio projectId={projectId} />;
}
