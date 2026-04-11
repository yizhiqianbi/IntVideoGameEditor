import { redirect } from "next/navigation";
import { EditorShell } from "@/components/editor/editor-shell";

export default async function PencilStudioVidPage({
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

  return <EditorShell workspace="editor" projectId={projectId} />;
}
