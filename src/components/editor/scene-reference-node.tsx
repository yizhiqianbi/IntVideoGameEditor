"use client";

import Image from "next/image";
import type { Node, NodeProps } from "@xyflow/react";
import styles from "./scene-reference-node.module.css";

export type SceneReferenceNodeData = {
  sceneId: string;
  name: string;
  description: string;
  referenceCount: number;
  previewUrl: string;
  isActive?: boolean;
};

export type SceneReferenceNodeType = Node<
  SceneReferenceNodeData,
  "sceneReference"
>;

export function SceneReferenceNode({
  data,
}: NodeProps<SceneReferenceNodeType>) {
  return (
    <article
      className={[styles.node, data.isActive ? styles.selected : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.media}>
        <Image
          className={styles.image}
          src={data.previewUrl}
          alt={data.name || data.sceneId}
          width={420}
          height={420}
          unoptimized
        />
        <div className={styles.overlay}>
          <span className={styles.badge}>
            {data.referenceCount > 0
              ? `${data.referenceCount} 张参考图`
              : "待添加场景参考图"}
          </span>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.eyebrow}>Scene</span>
          <span className={styles.id}>#{data.sceneId}</span>
        </div>
        <strong className={styles.name}>{data.name || data.sceneId}</strong>
        <p className={styles.description}>
          {data.description.trim().length > 0
            ? data.description
            : "点击这个场景卡，在右侧属性面板里补充环境设定和场景参考图。"}
        </p>
      </div>
    </article>
  );
}
