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

const PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' fill='none'%3E%3Crect width='200' height='200' rx='12' fill='%23252530'/%3E%3Ccircle cx='100' cy='72' r='32' stroke='%23666' stroke-width='2'/%3E%3Cpath d='M52 160c0-26.5 21.5-48 48-48s48 21.5 48 48' stroke='%23666' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E";

export function CharacterReferenceNode({
  data,
}: NodeProps<CharacterReferenceNodeType>) {
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
            alt={data.name || data.characterId}
            width={420}
            height={420}
            unoptimized
          />
        ) : (
          <div className={styles.avatarPlaceholder}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="18" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
              <path d="M8 42c0-8.84 7.16-16 16-16s16 7.16 16 16" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" />
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
          <span className={styles.eyebrow}>Character</span>
          <span className={styles.id}>@{data.characterId}</span>
        </div>
        <strong className={styles.name}>{data.name || data.characterId}</strong>
        {data.bio.trim().length > 0 && (
          <p className={styles.bio}>{data.bio}</p>
        )}
      </div>
    </article>
  );
}
