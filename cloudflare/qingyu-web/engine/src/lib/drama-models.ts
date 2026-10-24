export const GPU_VIDEO_MODELS = [
  { id: "h3", label: "H3 · 自部署", available: true },
  
  
  { id: "ltx-pinkcherry25", label: "PinkCherry · LTX-2.5 T2V/I2V", available: true },
] as const;
// Keep archive/model adapters intact; retired specialized checkpoints are not
// offered in the general-purpose studio's model picker.
export const STUDIO_VIDEO_MODELS: readonly (typeof GPU_VIDEO_MODELS)[number][] =
  GPU_VIDEO_MODELS.filter((model) => model.id === "h3");
/** Archived projects may retain these IDs; validators and pickers never offer them. */
export type GpuVideoModel = (typeof GPU_VIDEO_MODELS)[number]["id"] | "ltx-10eros" | "ltx-sulphur";
export type LtxVideoModel = "ltx-10eros" | "ltx-sulphur" | "ltx-pinkcherry25";
export function validateGpuModel(value: unknown): GpuVideoModel {
  if (value === undefined || value === "h3") return "h3";
  if (value === "ltx-pinkcherry") return "ltx-pinkcherry25";
  if (
    value === "ltx-pinkcherry25"
  )
    return value;
  throw new Error("不支持的视频模型");
}
export function isLtxFamily(value: unknown): value is LtxVideoModel {
  return (
    value === "ltx-pinkcherry25"
  );
}
export function ltxCheckpoint(value: unknown) {
  return value === "ltx-pinkcherry25" ? "pinkcherry25" : "10eros";
}
export function prefersPinkCherry(_ltx?: {
  ready?: boolean;
  pinkcherry?: boolean;
}) {
  return false;
}
export function ltxSupportsRi2v(_value: unknown) {
  return false;
}
export const LTX_DURATION_MIN = 3;
export const LTX_DURATION_MAX = 15;
export function parseShotDuration(value: unknown) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < LTX_DURATION_MIN) return 15;
  if (n > LTX_DURATION_MAX) return LTX_DURATION_MAX;
  return n;
}
export function clampLtxDuration(value: unknown) {
  return parseShotDuration(value);
}
export function h3Duration(value: unknown) {
  return parseShotDuration(value);
}
export function ltxFrameCount(value: unknown) {
  return parseShotDuration(value) * 24 + 1;
}
export function h3FrameCount(value: unknown) {
  return parseShotDuration(value) * 24 + 2;
}
export function gpuModelLabel(id: unknown) {
  return GPU_VIDEO_MODELS.find((model) => model.id === id)?.label ?? "MiniMax H3";
}
export function studioVideoDefaults() {
  return { modelPick: "auto" as const };
}
