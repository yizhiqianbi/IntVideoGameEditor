import { newAsset, type AssetCard } from "./drama-assets";
import { isLtxFamily } from "./drama-models";
import { shotChildren } from "./drama-tree";
import type { Shot } from "./drama";

/** Flux T5 is ~512 tokens; keep I2V stills short so long shot prompts still generate. */
const FLUX_STILL_LIMIT = 1500;

export function usesImageToVideo(
  shot: Pick<Shot, "mode" | "videoModel">,
) {
  return shot.mode === "i2v" || shot.videoModel === "ltx-10eros";
}

export function usesLtxFamily(
  shot: Pick<Shot, "videoModel" | "taskVideoModel">,
) {
  return isLtxFamily(shot.videoModel) || isLtxFamily(shot.taskVideoModel);
}

export function shotStillPrompt(shot: Shot, assets: AssetCard[]) {
  const fields = shot.promptFields || {};
  const start =
    fields.start?.trim() ||
    (fields.action || shot.prompt || "").trim().slice(0, 600);
  const linked = (shot.assetIds || [])
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is AssetCard => !!a);
  const context = linked.map((a) => {
    const desc = a.description.trim().slice(0, 180);
    return `${a.kind === "scene" ? "场景" : "角色"}「${a.title}」${
      desc ? `：${desc}` : ""
    }`;
  });
  return [
    "这是该镜头开始瞬间的静止首帧：只画开始时的姿势、服装、人物位置和空间，不要画后续动作。保持角色外观、道具与场景一致，构图稳定，无文字。",
    [shot.title.trim(), start].filter(Boolean).join("。"),
    ...context,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, FLUX_STILL_LIMIT);
}

export function applyStartFrameMaterial(input: {
  shot: Shot;
  shots: Shot[];
  assets: AssetCard[];
  imageUrl: string;
}): { shots: Shot[]; assets: AssetCard[] } {
  const existing = input.shot.startFrameAssetId
    ? input.assets.find((a) => a.id === input.shot.startFrameAssetId)
    : undefined;
  const asset = existing
    ? { ...existing, imageUrl: input.imageUrl }
    : {
        ...newAsset("reference", input.assets.length),
        title: `${input.shot.title} · 首帧`,
        description: `镜头「${input.shot.title}」开始瞬间，供 I2V 使用。`,
        imageUrl: input.imageUrl,
      };
  return {
    assets: existing
      ? input.assets.map((a) => (a.id === asset.id ? asset : a))
      : [...input.assets, asset],
    shots: input.shots.map((s) =>
      s.id === input.shot.id
        ? {
            ...s,
            firstFrame: input.imageUrl,
            startFrameAssetId: asset.id,
            assetIds: Array.from(new Set([...(s.assetIds || []), asset.id])),
          }
        : s,
    ),
  };
}

export function applyLastFrameMaterial(input: {
  shot: Shot;
  shots: Shot[];
  assets: AssetCard[];
  imageUrl: string;
}): { shots: Shot[]; assets: AssetCard[] } {
  const childIds = new Set(
    shotChildren(input.shots, input.shot.id).map((s) => s.id),
  );
  const existing = input.shot.endFrameAssetId
    ? input.assets.find((a) => a.id === input.shot.endFrameAssetId)
    : undefined;
  const asset = existing
    ? { ...existing, imageUrl: input.imageUrl }
    : {
        ...newAsset("reference", input.assets.length),
        title: `${input.shot.title} · 尾帧`,
        description: `镜头「${input.shot.title}」结束后的最后一帧，默认留作素材，也可作为下一镜首帧。`,
        imageUrl: input.imageUrl,
      };
  const oldStill = input.shot.endStill;
  return {
    assets: existing
      ? input.assets.map((a) => (a.id === asset.id ? asset : a))
      : [...input.assets, asset],
    shots: input.shots.map((s) => {
      if (s.id === input.shot.id)
        return {
          ...s,
          endStill: input.imageUrl,
          endFrameAssetId: asset.id,
          assetIds: Array.from(new Set([...(s.assetIds || []), asset.id])),
        };
      if (
        childIds.has(s.id) &&
        usesImageToVideo(s) &&
        (!s.firstFrame || s.firstFrame === oldStill)
      )
        return {
          ...s,
          firstFrame: input.imageUrl,
          assetIds: Array.from(new Set([...(s.assetIds || []), asset.id])),
        };
      return s;
    }),
  };
}

export function extractLastFrameFromVideo(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const fail = () => reject(new Error("无法读取视频尾帧"));
    video.onerror = fail;
    video.onloadedmetadata = () => {
      const time = Math.max(0, (video.duration || 0) - 0.08);
      video.currentTime = Number.isFinite(time) ? time : 0;
    };
    video.onseeked = () => {
      const width = video.videoWidth || 480;
      const height = video.videoHeight || 864;
      const scale = Math.min(1, 896 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return fail();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
      video.removeAttribute("src");
      video.load();
    };
    video.src = src;
  });
}
