"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchXumengGame, fetchXumengGames } from "@/lib/xumeng-games-client";
import { parseXumengGameId, type XumengGame, type XumengGameSummary } from "@/lib/xumeng-games";

export type GamePlaySelection = { kind: "private"; id: string };
export type RecentGamePlay = GamePlaySelection & { title: string; note: string; updatedAt: number };
const recentKey = (accountId: string) => `qingyu:game-recent:v1:${encodeURIComponent(accountId)}`;
function readRecent(accountId: string): RecentGamePlay[] {
  const raw = localStorage.getItem(recentKey(accountId)); if (!raw) return [];
  if (raw.length > 60000) throw new Error("游戏记录缓存异常，原记录已保留。");
  const value = JSON.parse(raw);
  if (value?.version !== 1 || value.accountId !== accountId || !Array.isArray(value.rows) || value.rows.length > 50) throw new Error("游戏记录缓存异常，原记录已保留。");
  const used = new Set<string>();
  return value.rows.map((row: RecentGamePlay) => {
    if (!row || !["builtin", "private"].includes(row.kind) || typeof row.title !== "string" || row.title.length > 120 || typeof row.note !== "string" || row.note.length > 160 || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw new Error("游戏记录缓存异常，原记录已保留。");
    parseXumengGameId(row.id); const key = `${row.kind}:${row.id}`;
    if (used.has(key)) throw new Error("游戏记录缓存异常，原记录已保留。"); used.add(key);
    return { kind: row.kind, id: row.id, title: row.title, note: row.note, updatedAt: row.updatedAt };
  }).filter((row: RecentGamePlay) => row.kind === "private");
}
/** Read own metadata only. A game body is requested after selecting that private game. */
export function useGamePlayLibrary(accountId: string | undefined, isGuest: boolean, enabled: boolean, selected: GamePlaySelection | null) {
  const identity = useRef(accountId); identity.current = accountId;
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<{accountId: string; games: XumengGameSummary[]; loading: boolean; error: string} | null>(null);
  const [detail, setDetail] = useState<{accountId: string; id: string; game: XumengGame | null; loading: boolean; error: string} | null>(null);
  const [recent, setRecent] = useState<{accountId: string; rows: RecentGamePlay[]; error: string} | null>(null);
  useEffect(() => {
    if (!accountId) return;
    const refresh = () => { try { setRecent({accountId, rows: readRecent(accountId), error: ""}); } catch { setRecent({accountId, rows: [], error: "游戏记录无法读取，原缓存已保留。"}); } };
    refresh();
    const changed = (event: StorageEvent) => { if (event.key === recentKey(accountId)) refresh(); };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, [accountId]);
  const record = useCallback((row: RecentGamePlay) => {
    if (!accountId || isGuest || identity.current !== accountId) return;
    try {
      const rows = [row, ...readRecent(accountId).filter(item => item.kind !== row.kind || item.id !== row.id)].slice(0, 50);
      const raw = JSON.stringify({version: 1, accountId, rows}); localStorage.setItem(recentKey(accountId), raw);
      if (localStorage.getItem(recentKey(accountId)) !== raw) throw new Error("记录写入未确认");
      setRecent({accountId, rows, error: ""});
    } catch { setRecent(previous => ({accountId, rows: previous?.accountId === accountId ? previous.rows : [], error: "游玩记录未保存到本机，原缓存已保留；请检查浏览器存储。"})); }
  }, [accountId, isGuest]);
  useEffect(() => {
    if (!enabled || !accountId || isGuest) return;
    const abort = new AbortController(); let alive = true;
    setList({accountId, games: [], loading: true, error: ""});
    fetchXumengGames(accountId, abort.signal).then(value => { if (alive && identity.current === accountId) setList({accountId, games: value.games, loading: false, error: ""}); }).catch(error => { if (alive && identity.current === accountId) setList({accountId, games: [], loading: false, error: error instanceof Error ? error.message : "私人游戏暂时无法加载。"}); });
    return () => { alive = false; abort.abort(); };
  }, [accountId, isGuest, enabled, revision]);
  useEffect(() => {
    if (!enabled || !accountId || !selected || selected.kind !== "private") return;
    if (isGuest) { setDetail({accountId, id: selected.id, game: null, loading: false, error: "登录后才能打开自己的私人游戏。"}); return; }
    const id = selected.id, abort = new AbortController(); let alive = true;
    setDetail({accountId, id, game: null, loading: true, error: ""});
    fetchXumengGame(accountId, id, abort.signal).then(value => {
      if (alive && identity.current === accountId) { setDetail({accountId, id, game: value.game, loading: false, error: ""}); record({kind: "private", id, title: value.game.title, note: "私人游戏 · 最近打开", updatedAt: Date.now()}); }
    }).catch(error => { if (alive && identity.current === accountId) setDetail({accountId, id, game: null, loading: false, error: error instanceof Error ? error.message : "游戏暂时无法打开。"}); });
    return () => { alive = false; abort.abort(); };
  }, [accountId, isGuest, enabled, selected?.kind, selected?.id, revision, record]);
  const matchedList = enabled && !isGuest && list?.accountId === accountId ? list : null;
  const matchedDetail = selected?.kind === "private" && detail && detail.accountId === accountId && detail.id === selected.id ? detail : null;
  return { games: matchedList?.games ?? [], loading: matchedList?.loading ?? false, error: matchedList?.error ?? "",
    privateGame: enabled && !isGuest ? matchedDetail?.game ?? null : null, privateLoading: enabled && !isGuest && selected?.kind === "private" && (!matchedDetail || matchedDetail.loading), privateError: selected?.kind === "private" && isGuest ? "登录后才能打开自己的私人游戏。" : matchedDetail?.error ?? "",
    recent: !isGuest && recent && recent.accountId === accountId ? recent.rows : [], recentError: !isGuest && recent && recent.accountId === accountId ? recent.error : "", record, refresh: () => setRevision(value => value + 1) };
}
