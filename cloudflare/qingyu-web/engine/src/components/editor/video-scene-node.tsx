"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import styles from "./video-scene-node.module.css";
import {
  VIDEO_SCENE_SOURCE_HANDLE_ID,
  VIDEO_SCENE_TARGET_HANDLE_ID,
  type EditorFlowNode,
} from "./project";

function getStatusLabel(node: EditorFlowNode) {
  if (node.data.assetStatus === "generating") return "生成中";
  if (node.data.assetStatus === "generated") return "已生成";
  if (node.data.assetStatus === "failed") return "失败";
  if (node.data.assetStatus === "ready") return "本地";
  if (node.data.assetStatus === "missing") return "待重绑";
  if (node.data.assetStatus === "unsupported") return "不可预览";
  return "未绑定";
}

function getPlaceholderCopy(node: EditorFlowNode) {
  if (node.data.assetStatus === "missing") {
    return {
      title: "素材引用已恢复",
      body: "重新绑定本地视频或重新生成后，这里会显示预览。",
    };
  }

  if (node.data.assetStatus === "unsupported") {
    return {
      title: "当前文件不可预览",
      body:
        node.data.assetError ??
        "当前浏览器无法解码这个视频文件，建议换成 H.264 MP4 或 WebM。",
    };
  }

  if (node.data.assetStatus === "generating") {
    if (node.data.generationTask?.rawStatus === "succeeded") {
      return {
        title: "正在同步生成结果",
        body: "任务已经完成，编辑器正在拉取最终的视频播放地址。",
      };
    }
    return {
      title: "正在生成视频",
      body:
        node.data.generationTask?.rawStatus ??
        "任务已提交到模型供应商，右侧面板会持续轮询状态。",
    };
  }

  if (node.data.assetStatus === "failed") {
    return {
      title: "生成任务失败",
      body:
        node.data.generationTask?.errorMessage ??
        "供应商没有成功返回视频结果，请检查 API 凭证或提示词。",
    };
  }

  return {
    title: "未绑定视频",
    body: "在右侧属性面板里生成视频，或绑定一个本地预览视频。",
  };
}

const STATUS_CLASS: Record<string, string> = {
  ready: styles.ready,
  generated: styles.generated,
  generating: styles.generating,
  missing: styles.missing,
  unsupported: styles.unsupported,
  failed: styles.failed,
  empty: styles.empty,
};

export function VideoSceneNode({
  id,
  data,
  selected,
}: NodeProps<EditorFlowNode>) {
  const node = {
    id,
    type: "videoScene",
    position: { x: 0, y: 0 },
    data,
  } as EditorFlowNode;

  const placeholderCopy = getPlaceholderCopy(node);
  const statusClass = STATUS_CLASS[data.assetStatus] ?? styles.empty;

  return (
    <article
      className={[styles.node, selected ? styles.selected : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle
        id={VIDEO_SCENE_TARGET_HANDLE_ID}
        type="target"
        position={Position.Top}
        className={styles.handle}
      />
      <Handle
        id={VIDEO_SCENE_SOURCE_HANDLE_ID}
        type="source"
        position={Position.Bottom}
        className={styles.handle}
      />

      {/* ── Video / image area — full bleed, 16:9 ── */}
      <div className={styles.videoFrame}>
        {data.previewUrl ? (
          <video
            key={data.previewUrl}
            className={`nodrag nopan ${styles.video}`}
            src={data.previewUrl}
            muted
            autoPlay
            loop
            playsInline
            preload="auto"
          />
        ) : (
          <div className={styles.placeholder}>
            <div className={styles.placeholderText}>
              <p className={styles.placeholderTitle}>{placeholderCopy.title}</p>
              <p className={styles.placeholderBody}>{placeholderCopy.body}</p>
            </div>
          </div>
        )}

        {/* Status badge — overlaid on frame */}
        <span className={`${styles.status} ${statusClass}`}>
          {getStatusLabel(node)}
        </span>
      </div>

      {/* ── Info bar below frame ── */}
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>Video Scene</span>
          <h3 className={styles.title}>{data.title || "未命名节点"}</h3>
        </div>
      </header>

      <div className={styles.metaStrip}>
        <span>{data.actions.length} 个动作</span>
        <span>
          {data.generation.providerId === "auto"
            ? "按优先级"
            : data.generation.providerId}
        </span>
      </div>
    </article>
  );
}
