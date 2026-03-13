"use client";

import Image from "next/image";
import type { Node, NodeProps } from "@xyflow/react";
import styles from "./character-reference-node.module.css";

export type CharacterReferenceNodeData = {
  characterId: string;
  name: string;
  bio: string;
  referenceCount: number;
  previewUrl: string;
  isActive?: boolean;
};

export type CharacterReferenceNodeType = Node<
  CharacterReferenceNodeData,
  "characterReference"
>;

export function CharacterReferenceNode({
  data,
}: NodeProps<CharacterReferenceNodeType>) {
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
          alt={data.name || data.characterId}
          width={420}
          height={420}
          unoptimized
        />
        <div className={styles.overlay}>
          <span className={styles.badge}>
            {data.referenceCount > 0
              ? `${data.referenceCount} 张参考图`
              : "待上传参考图"}
          </span>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.eyebrow}>Character</span>
          <span className={styles.id}>@{data.characterId}</span>
        </div>
        <strong className={styles.name}>{data.name || data.characterId}</strong>
        <p className={styles.bio}>
          {data.bio.trim().length > 0
            ? data.bio
            : "点击这个角色卡，在右侧属性面板里补充角色设定和参考图。"}
        </p>
      </div>
    </article>
  );
}
