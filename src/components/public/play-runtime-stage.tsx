"use client";

import { useEffect } from "react";
import { writeRecentPlaySlug } from "@/lib/public-recent-play";
import { MiniGameHost } from "./minigames/minigame-host";
import { getMiniGameBySlug } from "./minigames/registry";

type PlayRuntimeStageProps = {
  slug: string;
};

export function PlayRuntimeStage({ slug }: PlayRuntimeStageProps) {
  const game = getMiniGameBySlug(slug);

  useEffect(() => {
    writeRecentPlaySlug(slug);
  }, [slug]);

  if (!game) {
    return null;
  }

  return <MiniGameHost game={game} />;
}
