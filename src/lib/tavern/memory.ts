/**
 * SillyTavern-style memory configuration.
 *
 * The summarizer profile controls how detailed the rolling summary is and where
 * the summary is injected. Absent config keeps the legacy behaviour (summary
 * merged in front of the recent history).
 */

export const TAVERN_MEMORY_PROFILES = ["balanced", "compact", "detailed"] as const;
export type TavernMemoryProfile = (typeof TAVERN_MEMORY_PROFILES)[number];
export const DEFAULT_TAVERN_MEMORY_PROFILE: TavernMemoryProfile = "balanced";

export type TavernMemoryConfig = {
  /** 0 injects after the latest message; N injects N messages from the end. */
  depth: number;
  role: "system";
};

export const TAVERN_MEMORY_DEPTH_LIMIT = 20;

export function parseTavernMemoryProfile(value: unknown): TavernMemoryProfile | undefined {
  return typeof value === "string" && (TAVERN_MEMORY_PROFILES as readonly string[]).includes(value)
    ? value as TavernMemoryProfile : undefined;
}

export function parseTavernMemoryConfig(value: unknown): TavernMemoryConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => !["depth", "role"].includes(key))) return undefined;
  if (source.role !== undefined && source.role !== "system") return undefined;
  const depth = source.depth;
  if (depth === undefined) return undefined;
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0 || depth > TAVERN_MEMORY_DEPTH_LIMIT) return undefined;
  return { depth, role: "system" };
}

/** Extra instructions appended to the summarizer prompt per profile. */
export function tavernMemoryProfileInstruction(profile: TavernMemoryProfile | undefined): string {
  switch (profile) {
    case "compact":
      return "摘要要更短：summary不超过400字，列表最多4项，每项不超过80字；只保留会直接影响接下来两三轮的因果与约定。";
    case "detailed":
      return "摘要可以更完整：summary可到1600字，列表最多10项；保留重要场景氛围、关系变化和伏笔，但仍不得编造未发生的事。";
    default:
      return "";
  }
}

/** Render the summary block injected into the prompt. */
export function tavernMemoryPromptContent(summary: unknown): string {
  return JSON.stringify(summary);
}
