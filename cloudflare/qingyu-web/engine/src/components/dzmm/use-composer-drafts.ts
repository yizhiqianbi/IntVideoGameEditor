"use client";

import { useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { dzmmComposerStorageKey, parseDzmmComposerDrafts, writeDzmmComposerDrafts, type DzmmComposerDrafts } from "../../lib/dzmm-composer-drafts";

type Snapshot = { owner: string | null; drafts: DzmmComposerDrafts; warning: string; unreadable: boolean; originalCache?: string };
const empty = (): Snapshot => ({ owner: null, drafts: {}, warning: "", unreadable: false });
function load(id: string | null): Snapshot {
  if (!id) return empty();
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(dzmmComposerStorageKey(id)); return { owner: id, drafts: parseDzmmComposerDrafts(raw, id), warning: "", unreadable: false }; }
  catch { return { owner: id, drafts: {}, warning: "输入草稿缓存无法读取，原缓存已保留。新输入请先导出，避免刷新后丢失。", unreadable: true,
    ...(raw !== null ? { originalCache: raw } : {}) }; }
}

export function useDzmmComposerDrafts(accountId: string | null) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => load(accountId));
  const current = useRef(snapshot);
  const owner = useRef(accountId);
  // Reset state for the new owner before committing its controls. Do not let an
  // old asynchronous reply write another account's cache during a passive effect.
  if (snapshot.owner !== accountId) setSnapshot(load(accountId));
  useLayoutEffect(() => {
    owner.current = accountId;
    current.current = snapshot;
  }, [accountId, snapshot]);

  function setDrafts(action: SetStateAction<DzmmComposerDrafts>) {
    const id = owner.current;
    if (!id) return;
    const previous = current.current.owner === id ? current.current : load(id);
    const drafts = typeof action === "function" ? action(previous.drafts) : action;
    let warning = previous.warning;
    if (!previous.unreadable) {
      try { writeDzmmComposerDrafts(sessionStorage, id, drafts); warning = ""; }
      catch { warning = "输入草稿未能保存到浏览器。当前文字仍在，请先导出后再刷新或关闭页面。"; }
    }
    const next = { ...previous, drafts, warning };
    current.current = next; setSnapshot(next);
  }

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      const value = current.current;
      if (value.owner !== owner.current || !value.warning || !Object.values(value.drafts).some(draft => draft.text.length || draft.failed.length || draft.pending)) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  return { drafts: snapshot.owner === accountId ? snapshot.drafts : {}, setDrafts,
    warning: snapshot.owner === accountId ? snapshot.warning : "", originalCache: snapshot.owner === accountId ? snapshot.originalCache : undefined };
}
