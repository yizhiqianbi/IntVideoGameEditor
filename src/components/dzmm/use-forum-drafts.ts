"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type SetStateAction } from "react";
import { dzmmForumDraftStorageKey, emptyDzmmForumDrafts, exportDzmmForumDrafts, hasDzmmForumDrafts, parseDzmmForumDrafts, writeDzmmForumDrafts, type DzmmForumDrafts } from "../../lib/dzmm-forum-drafts";

type Snapshot = { owner: string | null; drafts: DzmmForumDrafts; warning: string; unreadable: boolean; originalCache?: string; exported?: string };
const empty = (): Snapshot => ({ owner: null, drafts: emptyDzmmForumDrafts(), warning: "", unreadable: false });
function load(id: string | null): Snapshot {
  if (!id) return empty();
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(dzmmForumDraftStorageKey(id)); return { owner: id, drafts: parseDzmmForumDrafts(raw, id), warning: "", unreadable: false }; }
  catch { return { owner: id, drafts: emptyDzmmForumDrafts(), warning: "论坛草稿缓存无法读取，原缓存已保留。新输入请先导出备份后再离开。", unreadable: true,
    ...(raw !== null ? { originalCache: raw } : {}) }; }
}
const unsafe = (snapshot: Snapshot) => Boolean(snapshot.warning && hasDzmmForumDrafts(snapshot.drafts)
  && snapshot.exported !== exportDzmmForumDrafts(snapshot.owner ?? "", snapshot.drafts, snapshot.originalCache));

export function useDzmmForumDrafts(accountId: string | null, root: RefObject<HTMLElement | null>) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => load(accountId));
  const current = useRef(snapshot);
  const owner = useRef(accountId);
  if (snapshot.owner !== accountId) setSnapshot(load(accountId));
  useLayoutEffect(() => { owner.current = accountId; current.current = snapshot; }, [accountId, snapshot]);

  function setDrafts(action: SetStateAction<DzmmForumDrafts>, requirePersistence = false): boolean {
    const id = accountId;
    if (!id || owner.current !== id) return false;
    const previous = current.current.owner === id ? current.current : load(id);
    const drafts = typeof action === "function" ? action(previous.drafts) : action;
    let warning = previous.warning;
    if (!previous.unreadable) {
      try { writeDzmmForumDrafts(sessionStorage, id, drafts); warning = ""; }
      catch { warning = "论坛草稿未能保存到此标签页。当前文字仍在，请导出备份后再离开、刷新或关闭页面。"; }
    }
    const persisted = !previous.unreadable && !warning;
    const next = { ...previous, drafts: requirePersistence && !persisted ? previous.drafts : drafts, warning };
    current.current = next; setSnapshot(next);
    return persisted;
  }

  const canLeave = () => !unsafe(current.current);
  function exportDrafts() {
    const value = current.current;
    if (!value.owner || value.owner !== accountId) return;
    const content = exportDzmmForumDrafts(value.owner, value.drafts, value.originalCache);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
    try {
      const link = document.createElement("a"); link.href = url; link.download = "论坛草稿备份.json";
      document.body.append(link); link.click(); link.remove();
      const next = { ...value, exported: content }; current.current = next; setSnapshot(next);
    } finally { URL.revokeObjectURL(url); }
  }

  function discardUnreadableCache() {
    const value = current.current;
    if (!value.owner || value.owner !== accountId || !value.unreadable) return;
    try {
      // Only an explicit discard may remove corrupt bytes. Current new input is
      // still retained; a subsequent quota failure keeps the navigation guard.
      sessionStorage.removeItem(dzmmForumDraftStorageKey(value.owner));
      const next = { ...value, unreadable: false, originalCache: undefined, warning: "" };
      current.current = next; setSnapshot(next); setDrafts(value.drafts);
    } catch {
      const next = { ...value, warning: "原草稿缓存无法清理。当前文字仍在，请导出完整备份。" };
      current.current = next; setSnapshot(next);
    }
  }

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (unsafe(current.current)) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!unsafe(current.current) || !target || root.current?.contains(target) || target.closest("a[download]")) return;
      if (target.closest("a,button")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (unsafe(current.current) && event.key === "Enter" && target && !root.current?.contains(target)
        && target.closest("input,a,button")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const hashchange = (event: HashChangeEvent) => {
      if (!unsafe(current.current)) return;
      const oldHash = new URL(event.oldURL).hash, nextHash = new URL(event.newURL).hash;
      // Internal topic navigation keeps this mounted draft owner. Leaving the
      // current forum/admin route would otherwise lose unpersisted input.
      const internal = oldHash.startsWith("#forum") && (nextHash === "#forum" || nextHash.startsWith("#forum/post/"));
      if (internal || oldHash === nextHash) return;
      event.stopImmediatePropagation(); history.replaceState(null, "", event.oldURL);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true); document.addEventListener("keydown", keydown, true);
    window.addEventListener("hashchange", hashchange, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", keydown, true); window.removeEventListener("hashchange", hashchange, true); };
  }, [root]);

  return { drafts: snapshot.owner === accountId ? snapshot.drafts : emptyDzmmForumDrafts(), setDrafts, canLeave, exportDrafts, discardUnreadableCache,
    warning: snapshot.owner === accountId ? snapshot.warning : "", unreadable: snapshot.owner === accountId && snapshot.unreadable };
}
