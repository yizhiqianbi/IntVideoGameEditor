"use client";

import { useEffect, useRef, useState } from "react";
import { companionStillPrompt } from "../../../lib/companion-still-prompt";
import { xumengImageUrl } from "../../../lib/xumeng-routes";
import { requestCompanionAlbumStill } from "../../../lib/xumeng-krea2-bridge";
import { rememberRelationshipStill } from "../../../lib/relationship-album";

export type GirlfriendPhoto = { id: string; url: string; createdAt: string };
const SAVED_PHOTO = /^\/api\/backend\/v1\/media\/[A-Za-z0-9-]+\/[a-f0-9-]+\.(?:png|jpe?g|webp)$/;
const PHOTO_LIMIT = 24;

export function readGirlfriendPhotos(key: string): GirlfriendPhoto[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const url = typeof item.url === "string" ? item.url : "";
      const id = typeof item.id === "string" ? item.id : "";
      const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
      if (!id || !SAVED_PHOTO.test(url) || !Number.isFinite(Date.parse(createdAt))) return [];
      return [{ id, url, createdAt }];
    }).slice(-PHOTO_LIMIT);
  } catch {
    return [];
  }
}

function writeGirlfriendPhotos(key: string, photos: GirlfriendPhoto[]) {
  localStorage.setItem(key, JSON.stringify(photos.slice(-PHOTO_LIMIT)));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function referenceBase64(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
  if (!response.ok) throw new Error("封面读不出来，这次没有出图。");
  const blob = await response.blob();
  let encoded = blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("封面读不出来，这次没有出图。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    encoded = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("封面读不出来，这次没有出图。")), "image/jpeg", 0.86));
  } catch (failure) {
    if (failure instanceof Error && failure.message.includes("封面")) throw failure;
  }
  return blobToBase64(encoded);
}

export function useGirlfriendPhotos(storageKey: string | null, adoptKey: string | null = null, characterId: string | null = null) {
  const [photos, setPhotos] = useState<GirlfriendPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const busyRef = useRef(false);
  useEffect(() => {
    if (!storageKey) { setPhotos([]); setNote(""); return; }
    let next = readGirlfriendPhotos(storageKey);
    if (adoptKey && adoptKey !== storageKey) {
      const extra = readGirlfriendPhotos(adoptKey);
      if (extra.length) {
        const ids = new Set(next.map(photo => photo.id));
        next = [...next, ...extra.filter(photo => !ids.has(photo.id))].slice(-PHOTO_LIMIT);
        try { writeGirlfriendPhotos(storageKey, next); localStorage.removeItem(adoptKey); } catch { /* The pictures stay visible for this visit. */ }
      }
    }
    setPhotos(next);
    setNote("");
  }, [adoptKey, storageKey]);
  async function shoot(coverUrl: string, scene: string) {
    if (!storageKey || busyRef.current) return;
    const prompt = companionStillPrompt(scene);
    if (!prompt) { setNote("这句不能出图。"); return; }
    busyRef.current = true;
    setBusy(true);
    setNote("");
    try {
      const image = await referenceBase64(coverUrl);
      const still = await requestCompanionAlbumStill({ templateId: "krea2-free", prompt, image, style: "photo" });
      const url = xumengImageUrl(still.url);
      if (!SAVED_PHOTO.test(url)) throw new Error("相册保存失败，这次没有扣 Credit。");
      const photo = { id: crypto.randomUUID(), url, createdAt: new Date().toISOString() };
      if (characterId) void rememberRelationshipStill(characterId, url).catch(() => undefined);
      setPhotos(current => {
        const next = [...current, photo].slice(-PHOTO_LIMIT);
        try { writeGirlfriendPhotos(storageKey, next); }
        catch { setNote("图已经出来了，但这张没能记在这台设备上。"); }
        return next;
      });
    } catch (failure) {
      setNote(failure instanceof Error ? failure.message : "出图没有完成。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return { photos, busy, note, shoot };
}
