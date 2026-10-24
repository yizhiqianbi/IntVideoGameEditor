"use client";

import type { ComponentType } from "react";

export type MiniGameRenderProps = {
  onFinish: (score: number, summary: string) => void;
};

export type MiniGameDefinition = {
  slug: string;
  title: string;
  subtitle: string;
  durationLabel: string;
  instructions: string;
  component: ComponentType<MiniGameRenderProps>;
};
