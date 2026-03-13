"use client";

import type { ChangeEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import styles from "./video-scene-node.module.css";
import type { EditorFlowNode } from "./project";

function getStatusLabel(node: EditorFlowNode) {
  if (node.data.assetStatus === "generating") {
    return "生成中";
  }

  if (node.data.assetStatus === "generated") {
    return "已生成";
  }

  if (node.data.assetStatus === "failed") {
    return "生成失败";
  }

  if (node.data.assetStatus === "ready") {
    return "本地预览";
  }

  if (node.data.assetStatus === "missing") {
    return "待重绑";
  }

  if (node.data.assetStatus === "unsupported") {
    return "不可预览";
  }

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

export function VideoSceneNode({
  id,
  data,
  selected,
}: NodeProps<EditorFlowNode>) {
  const placeholderCopy = getPlaceholderCopy({
    id,
    type: "videoScene",
    position: { x: 0, y: 0 },
    data,
  } as EditorFlowNode);

  function handleTitleChange(event: ChangeEvent<HTMLInputElement>) {
    data.onTitleChange?.(id, event.target.value);
  }

  return (
    <article
      className={[styles.node, selected ? styles.selected : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={styles.handle}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={styles.handle}
      />

      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>Video Scene</span>
          <input
            className={`nodrag nopan ${styles.titleInput}`}
            value={data.title}
            onChange={handleTitleChange}
            placeholder="输入节点标题"
          />
        </div>
        <span
          className={[
            styles.status,
            data.assetStatus === "ready" ? styles.ready : "",
            data.assetStatus === "generated" ? styles.generated : "",
            data.assetStatus === "generating" ? styles.generating : "",
            data.assetStatus === "missing" ? styles.missing : "",
            data.assetStatus === "unsupported" ? styles.unsupported : "",
            data.assetStatus === "failed" ? styles.failed : "",
            data.assetStatus === "empty" ? styles.empty : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {getStatusLabel({
            id,
            type: "videoScene",
            position: { x: 0, y: 0 },
            data,
          } as EditorFlowNode)}
        </span>
      </header>

      <div className={styles.metaStrip}>
        <span>{data.actions.length} 个动作</span>
        <span>{data.generation.providerId === "auto" ? "按优先级" : data.generation.providerId}</span>
      </div>

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
      </div>
    </article>
  );
}
