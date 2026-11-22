/**
 * Server-side kill switches for the SillyTavern-compatible features.
 *
 * Every flag defaults to enabled; setting the Worker variable to the string
 * "false" disables the feature without a deploy. Flags are intentionally
 * independent so a single feature can be rolled back (for example group chat
 * only) while the rest keeps running.
 */

export type TavernFeatureFlags = {
  /** tavern prompt assembly, world-book engine, @depth injection */
  engine: boolean;
  group: boolean;
  sampler: boolean;
  imagePresets: boolean;
  memory: boolean;
};

const FLAG_ENV = {
  engine: "TAVERN_ENGINE",
  group: "TAVERN_GROUP",
  sampler: "TAVERN_SAMPLER",
  imagePresets: "TAVERN_IMAGE_PRESETS",
  memory: "TAVERN_MEMORY",
} as const;

function readFlag(env: Record<string, string | undefined>, name: string): boolean {
  const value = env[name];
  return value === undefined || value.trim().toLowerCase() !== "false";
}

export function readTavernFlags(env: Record<string, string | undefined> | undefined | null): TavernFeatureFlags {
  const source = env ?? {};
  return {
    engine: readFlag(source, FLAG_ENV.engine),
    group: readFlag(source, FLAG_ENV.group),
    sampler: readFlag(source, FLAG_ENV.sampler),
    imagePresets: readFlag(source, FLAG_ENV.imagePresets),
    memory: readFlag(source, FLAG_ENV.memory),
  };
}

export const TAVERN_FLAG_ENV = FLAG_ENV;
