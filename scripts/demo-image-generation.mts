/**
 * Local demo: compose SillyTavern-style prompts from a real character card and
 * render them through the TokenHub image channel (same prompt family used by
 * the site's in-chat stills). Not part of the app runtime.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import generationModule from "../src/lib/tavern/image-generation";
import imageModule from "../src/lib/tavern/image";

const { DEFAULT_TAVERN_IMAGE_GENERATION, composeTavernImagePrompt } = generationModule as typeof import("../src/lib/tavern/image-generation");
const { applyTavernImagePreset } = imageModule as typeof import("../src/lib/tavern/image");

const root = resolve(import.meta.dirname, "..");
const rows = JSON.parse(readFileSync(resolve(root, "output/xumeng/user-backup-20261120/characters.json"), "utf8")) as Array<Record<string, unknown>>;
const card = rows.find((row) => row.name === "顾念") ?? rows[0];
const contextJson = JSON.parse(String(card.context_json ?? "{}")) as Record<string, unknown>;
const context = {
  characterName: String(card.name ?? "角色"),
  userName: "楚曦",
  description: String(card.description ?? ""),
  personality: String(card.personality ?? ""),
  scenario: String(card.scenario ?? ""),
  appearance: typeof contextJson.appearance === "string" ? contextJson.appearance : "",
};
console.log("卡片:", context.characterName, "| 外观:", context.appearance.slice(0, 50), "| 性格:", context.personality.slice(0, 40));

const base = "夜晚的公寓客厅，她穿着黑色吊带长裙坐在沙发边缘，长发垂落，眼神冷淡地看向镜头，暖色落地灯光，近景半身。";
const variants = [
  { key: "realistic", label: "写实电影感", preset: "xumeng", generation: { ...DEFAULT_TAVERN_IMAGE_GENERATION, enabled: true, size: "3:4" as const,
    promptPrefix: "masterpiece, best quality, cinematic lighting, 8k", mainPrompt: "{{char}} 的写实人像，性格：{{personality}}", negativePrompt: "lowres, bad anatomy, bad hands, watermark, text" } },
  { key: "anime", label: "二次元赛璐璐", preset: "anime", generation: { ...DEFAULT_TAVERN_IMAGE_GENERATION, enabled: true, size: "3:4" as const,
    promptPrefix: "masterpiece, best quality", mainPrompt: "{{char}} 的动漫角色插画，{{personality}}", negativePrompt: "photorealistic, 3d render, bad hands, watermark" } },
  { key: "watercolor", label: "水彩插画", preset: "watercolor", generation: { ...DEFAULT_TAVERN_IMAGE_GENERATION, enabled: true, size: "3:4" as const,
    promptPrefix: "best quality, soft watercolor", mainPrompt: "{{char}} 的水彩肖像，{{scenario}}", negativePrompt: "photo, 3d, oversharpened, text" } },
  { key: "noir", label: "暗调胶片", preset: "noir", generation: { ...DEFAULT_TAVERN_IMAGE_GENERATION, enabled: true, size: "3:4" as const,
    promptPrefix: "best quality, film grain, low key", mainPrompt: "{{char}} 的暗调胶片肖像", negativePrompt: "high saturation, cartoon, flat lighting, text" } },
];

const prompts = variants.map((variant) => {
  const composed = composeTavernImagePrompt({ base, generation: variant.generation, context });
  const finalPrompt = applyTavernImagePreset(composed.prompt, variant.preset);
  console.log(`\n[${variant.label}] size=${composed.size} words=${finalPrompt.length}\n${finalPrompt.slice(0, 220)}…`);
  return { ...variant, prompt: finalPrompt, size: composed.size };
});

const env: Record<string, string> = {};
for (const line of readFileSync(resolve(root, "xumeng-gen/.env.local"), "utf8").split("\n")) {
  const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}
const { startImageLite, pollImageLite } = await import("../xumeng-gen/lib/image-lite.mjs");
const outDir = resolve(root, "output/xumeng/image-gen-demo");
mkdirSync(outDir, { recursive: true });
for (const variant of prompts) {
  const taskId = await startImageLite({ prompt: variant.prompt, size: "portrait" }, { env });
  console.log(variant.key, "task", taskId);
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((done) => setTimeout(done, 3000));
    const result = await pollImageLite(taskId, { env });
    if (result) {
      writeFileSync(resolve(outDir, `${variant.key}.png`), result.bytes);
      console.log(variant.key, "done", result.bytes.length);
      break;
    }
  }
}
writeFileSync(resolve(outDir, "prompts.json"), JSON.stringify(prompts.map(({ key, label, prompt, size }) => ({ key, label, size, prompt })), null, 2));
console.log("ALL DONE");
