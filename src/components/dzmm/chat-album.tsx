"use client";

import { useEffect, useState } from "react";
import { groupRelationshipAlbum, parseRelationshipAlbum, relationshipAlbumAssetUrl, type RelationshipAlbumItem } from "@/lib/relationship-album";
import s from "./tavern.module.css";

export default function ChatAlbum({ characterId, open, onClose }: { characterId: string; open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<RelationshipAlbumItem[] | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setItems(null);
    void fetch(`/api/backend/v1/relationship-album?characterId=${encodeURIComponent(characterId)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => response.ok ? response.json() : { items: [] })
      .then(body => { if (!controller.signal.aborted) setItems(parseRelationshipAlbum(body)); })
      .catch(() => { if (!controller.signal.aborted) setItems([]); });
    return () => controller.abort();
  }, [characterId, open]);
  if (!open) return null;
  const groups = items ? groupRelationshipAlbum(items) : [];
  return <div className={s.chatAlbum} role="region" aria-label="对话相册">
    <div className={s.chatAlbumHead}><strong>对话相册</strong><button type="button" onClick={onClose}>收起</button></div>
    {items === null ? <p>正在整理相册…</p> : groups.length === 0 ? <p>还没有一起生成的画面。聊天里生成的图片会留在这里。</p> : groups.map(group => (
      <section key={group.day}>
        <h3>{group.label}</h3>
        <div className={s.chatAlbumGrid}>{group.items.map(item => item.kind === "video"
          ? <video key={item.id} src={relationshipAlbumAssetUrl(item.id)} controls playsInline preload="metadata" aria-label="对话相册视频" />
          : <img key={item.id} src={relationshipAlbumAssetUrl(item.id)} alt="对话相册图片" />)}</div>
      </section>
    ))}
  </div>;
}
