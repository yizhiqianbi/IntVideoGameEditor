import { notFound } from "next/navigation";
import { GameEditorWorkbench } from "@/components/studio/game-editor/game-editor-workbench";

const VALID_TYPES = [
  "text-choice",
  "click-reaction",
  "memory",
  "physics",
  "puzzle",
  "rhythm",
] as const;

type GameType = (typeof VALID_TYPES)[number];

export default async function GameEditorPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;

  if (!VALID_TYPES.includes(type as GameType)) {
    notFound();
  }

  return <GameEditorWorkbench gameType={type as GameType} />;
}
