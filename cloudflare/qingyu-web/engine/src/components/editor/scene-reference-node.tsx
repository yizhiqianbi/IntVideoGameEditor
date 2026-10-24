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
  const hasImage = data.previewUrl && !data.previewUrl.includes("placeholder");

  return (
    <article
      className={[styles.node, data.isActive ? styles.selected : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.media}>
        {hasImage ? (
          <Image
            className={styles.image}
            src={data.previewUrl}
            alt={data.name || data.sceneId}
            width={420}
            height={260}
            unoptimized
          />
        ) : (
          <div className={styles.scenePlaceholder}>
            <svg width="48" height="36" viewBox="0 0 48 36" fill="none">
              <rect x="2" y="4" width="44" height="28" rx="4" stroke="rgba(112,214,255,0.3)" strokeWidth="1.5" />
              <circle cx="14" cy="14" r="4" stroke="rgba(112,214,255,0.3)" strokeWidth="1.5" />
              <path d="M2 26l12-10 8 6 10-8 14 12" stroke="rgba(112,214,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        <div className={styles.overlay}>
          <span className={styles.badge}>
            {data.referenceCount > 0
              ? `${data.referenceCount} refs`
              : "No refs"}
          </span>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.eyebrow}>Scene</span>
          <span className={styles.id}>#{data.sceneId}</span>
        </div>
        <strong className={styles.name}>{data.name || data.sceneId}</strong>
        {data.description.trim().length > 0 && (
          <p className={styles.description}>{data.description}</p>
        )}
      </div>
    </article>
  );
}
