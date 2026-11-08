"use client";
import { useEffect, useMemo, useState } from "react";
import type { Character } from "@/lib/dzmm-characters";
import { fetchDzmmNovels } from "@/lib/dzmm-novels-client";
import { fetchXumengGames } from "@/lib/xumeng-games-client";
import { xumengPerformanceFromCard, xumengPerformanceFromNovel, type XumengPerformanceCharacter, type XumengLiveSource } from "@/lib/xumeng-performance-character";

/** Private novels are loaded only while the user opens a performance workspace. */
export function usePerformanceCharacters(accountId: string | undefined, isGuest: boolean, cards: Character[], enabled: boolean, includeGames = false) {
  const [novels, setNovels] = useState<{ accountId: string; revision: number; includeGames: boolean; characters: XumengPerformanceCharacter[]; sources: XumengLiveSource[]; error: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || !accountId || isGuest) return;
    const abort = new AbortController(); let alive = true;
    void Promise.allSettled([fetchDzmmNovels(accountId, abort.signal), includeGames ? fetchXumengGames(accountId, abort.signal) : Promise.resolve(null)]).then(([novelResult, gameResult]) => {
      if (!alive || abort.signal.aborted) return;
      const characters = novelResult.status === "fulfilled" ? novelResult.value.works.flatMap(work => (work.characters ?? []).map(character => xumengPerformanceFromNovel(character, work))) : [];
      const sources: XumengLiveSource[] = novelResult.status === "fulfilled" ? novelResult.value.works.map(work => ({ key: `novel:${work.id}`, kind: "novel", sourceId: work.id, label: work.title || "未命名小说", reference: work.synopsis.slice(0, 2000), characterKeys: characters.filter(character => character.sourceId === work.id).map(character => character.key) })) : [];
      if (gameResult.status === "fulfilled" && gameResult.value) sources.push(...gameResult.value.games.map(game => ({ key: `game:${game.id}`, kind: "game" as const, sourceId: game.id, label: game.title, reference: game.synopsis.slice(0, 2000), characterKeys: [] })));
      const errors = [novelResult, gameResult].filter(result => result.status === "rejected").map(result => result.reason instanceof Error ? result.reason.message : "作品加载失败，请重试。");
      setNovels({ accountId, revision, includeGames, characters, sources, error: errors.join(" ") });
    });
    return () => { alive = false; abort.abort(); };
  }, [accountId, isGuest, enabled, includeGames, revision]);
  const characters = useMemo(() => [...cards.map(xumengPerformanceFromCard), ...(!isGuest && novels && novels.accountId === accountId ? novels.characters : [])], [cards, novels, isGuest, accountId]);
  const sources = useMemo<XumengLiveSource[]>(() => [{ key: "character-library", kind: "character", sourceId: "character-library", label: "角色库", reference: "", characterKeys: cards.map(card => `character:${card.id}`) }, ...(!isGuest && novels && novels.accountId === accountId ? novels.sources : [])], [cards, novels, isGuest, accountId]);
  const settled = Boolean(novels && novels.accountId === accountId && novels.revision === revision && novels.includeGames === includeGames);
  return { characters, sources, error: enabled && settled ? novels!.error : "", loading: enabled && !isGuest && Boolean(accountId) && !settled, refresh: () => setRevision(value => value + 1) };
}
