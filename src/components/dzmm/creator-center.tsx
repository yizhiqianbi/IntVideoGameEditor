"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "@/lib/dzmm-characters";
import type { DzmmCloudUser } from "@/lib/dzmm-cloud";
import { getDzmmCharacterCardBlurb } from "@/lib/dzmm-character-presentation";
import { fetchDzmmNovels } from "@/lib/dzmm-novels-client";
import { fetchXumengGames } from "@/lib/xumeng-games-client";
import { fetchXumengScenarios } from "@/lib/xumeng-scenarios-client";
import { loadCreatorSections } from "@/lib/xumeng-creator-load";
import { XUMENG_GENERATION_WORKSPACE_ENABLED } from "@/lib/xumeng-feature-availability";
import { useCharacterCreateCost } from "@/lib/dzmm-scene-prices";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { xumengPage } from "@/lib/xumeng-page-copy";
import PublishingCenter from "./publishing-center";
import Icon, { type IconName } from "./icons";
import s from "./creator-center.module.css";

type Kind = "character" | "novel" | "story" | "game" | "scenario";
type Work = { id: string; kind: Kind; title: string; synopsis: string; updatedAt: number; detail: string };
const KINDS: Record<Kind, { label: string; icon: IconName }> = {
  character: { label: "角色", icon: "user" }, novel: { label: "小说", icon: "book" }, story: { label: "故事", icon: "book" },
  game: { label: "游戏", icon: "play" }, scenario: { label: "团本", icon: "users" },
};
export type CreatorCenterProps = {
  user: DzmmCloudUser | null; drafts: Character[]; section?: "home" | "roles";
  onCreate: () => void; onEdit: (card: Character) => void; onCharacter: (card: Character) => void;
  onRequireAccount: () => void; onCatalogChanged: () => Promise<void>;
  onRoute: (route: string) => void;
  locale?: XumengLocale;
};
export default function CreatorCenter({ user, drafts, section = "home", locale = "zh-Hans", onCreate, onEdit, onCharacter, onRequireAccount, onCatalogChanged, onRoute }: CreatorCenterProps) {
  const copy = xumengPage(locale);
  const createCost = useCharacterCreateCost();
  const [remote, setRemote] = useState<{ accountId: string; works: Work[] } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const scope = useRef(0);
  const activeAccount = useRef(user?.id);
  activeAccount.current = user?.isGuest ? undefined : user?.id;
  const registered = Boolean(user && !user.isGuest);
  useEffect(() => {
    setRemote(null); setErrors([]);
    if (!user || user.isGuest) { setLoading(false); return; }
    const accountId = user.id, abort = new AbortController(), generation = ++scope.current;
    const current = () => !abort.signal.aborted && scope.current === generation && activeAccount.current === accountId;
    const sections: Work[][] = [[], [], []], failures = new Map<number, string>();
    const labels = ["小说和故事", "游戏", "团本"];
    setLoading(true);
    void loadCreatorSections<Work[]>([
      async signal => (await fetchDzmmNovels(accountId, signal)).works.map(work => ({ id: work.id, kind: work.type, title: work.title, synopsis: work.synopsis, updatedAt: work.updatedAt, detail: `${work.chapterCount} 章 · ${work.wordCount.toLocaleString()} 字` })),
      async signal => (await fetchXumengGames(accountId, signal)).games.map(work => ({ id: work.id, kind: "game", title: work.title, synopsis: work.synopsis, updatedAt: work.updatedAt, detail: "私人 HTML 项目" })),
      async signal => (await fetchXumengScenarios(accountId, signal)).scenarios.map(work => ({ id: work.id, kind: "scenario", title: work.title, synopsis: work.synopsis, updatedAt: work.updatedAt, detail: "私人团本剧本" })),
    ], abort.signal, ({ index, result, pending }) => {
      if (!current()) return;
      if (result.status === "fulfilled") sections[index] = result.value;
      else failures.set(index, labels[index]);
      setRemote({ accountId, works: sections.flat() });
      setErrors([...failures.entries()].sort(([a], [b]) => a - b).map(([, label]) => label));
      setLoading(pending > 0);
    });
    return () => { abort.abort(); };
  }, [user?.id, user?.isGuest, revision]);
  const works = useMemo(() => {
    const list: Work[] = drafts.map(card => ({ id: card.id, kind: "character", title: card.name, synopsis: getDzmmCharacterCardBlurb(card), updatedAt: Date.parse(card.createdAt) || 0, detail: "私人角色草稿" }));
    if (remote && remote.accountId === user?.id && registered) list.push(...remote.works);
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [drafts, remote, user?.id, registered]);
  const filtered = works.filter(work => (kind === "all" || work.kind === kind) && `${work.title}\n${work.synopsis}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function open(work: Work) {
    if (work.kind === "character") { const card = drafts.find(card => card.id === work.id); if (card) onEdit(card); }
    else onRoute(work.kind === "game" ? `studio/games/${encodeURIComponent(work.id)}` : work.kind === "scenario" ? `studio/scenarios/${encodeURIComponent(work.id)}` : `novels/${encodeURIComponent(work.id)}`);
  }
  const start = (route: string) => registered ? onRoute(route) : onRequireAccount();
  return <main className={s.workspace}>
    <section className={s.content}>
      <header className={s.header}><div><p>{copy.creatorEyebrow}</p><h1>{section === "roles" ? copy.rolesAndPosts : copy.startCreating}</h1><span>{section === "roles" ? copy.rolesLead : copy.createLead}</span></div><div className={s.headerActions}>{section === "roles" && <button onClick={() => onRoute("studio")}><Icon name="back" size={16}/>{copy.workbench}</button>}<button onClick={() => onRoute("characters")}><Icon name="back" size={16}/>{copy.backToSite}</button></div></header>
      {section === "roles" ? <PublishingCenter locale={locale} embedded user={user} drafts={drafts} onCreate={onCreate} onEdit={onEdit} onCharacter={onCharacter} onRequireAccount={onRequireAccount} onCatalogChanged={onCatalogChanged} onNovels={() => onRoute("novels")}/> : <>
        <section className={s.starts} aria-label={copy.beginCreate}>
          <button className={s.primaryStart} onClick={onCreate} title={copy.personaOpeningBook}><span className={s.mark}><Icon name="user" size={16}/></span><strong>{copy.createRole}</strong>{createCost ? <small className={s.price}>· {createCost} Credit</small> : null}<span className={s.hint}>{copy.personaOpeningBook}</span></button>
          <button onClick={() => start("novels/new/novel")} title={copy.peopleOutlineChapters}><span className={s.mark}><Icon name="book" size={16}/></span><strong>{copy.novelsStories}</strong><span className={s.hint}>{copy.peopleOutlineChapters}</span></button>
          <button onClick={() => onRoute("studio/girlfriends/new")} title={copy.coverAlbumPersona}><span className={s.mark}><Icon name="upload" size={16}/></span><strong>{copy.uploadGirlfriend}</strong><span className={s.hint}>{copy.coverAlbumPersona}</span></button>
          <button onClick={() => onRoute("studio/games")} title={copy.importGameHint}><span className={s.mark}><Icon name="play" size={16}/></span><strong>{copy.uploadGame}</strong><span className={s.hint}>{copy.importGameHint}</span></button>
          <button onClick={() => start("studio/scenarios/new")} title={copy.scenarioHint}><span className={s.mark}><Icon name="users" size={16}/></span><strong>{copy.createScenario}</strong><span className={s.hint}>{copy.scenarioHint}</span></button>
          {XUMENG_GENERATION_WORKSPACE_ENABLED && <button onClick={() => onRoute("generation")} title={copy.generateHint}><span className={s.mark}><Icon name="image" size={16}/></span><strong>{copy.generate}</strong><span className={s.hint}>{copy.generateHint}</span></button>}
        </section>
        <section className={s.library} aria-label={copy.myWorks}><header className={s.libraryHead}><h2>{copy.myWorks}</h2><button className={s.toolIcon} onClick={() => setRevision(value => value + 1)} disabled={loading} title={loading ? copy.loadingFrame : copy.refreshWorks} aria-label={loading ? copy.loadingFrame : copy.refreshWorks}><Icon name="refresh" size={16}/></button></header>
          <div className={s.toolbar}><div className={s.filters} aria-label={copy.workKinds}><button aria-pressed={kind === "all"} onClick={() => setKind("all")}>{copy.all}</button>{(["character", "novel", "story", "game", "scenario"] as const).map((key) => <button key={key} aria-pressed={kind === key} onClick={() => setKind(key)}>{{ character: copy.roles, novel: copy.novel, story: copy.story, game: copy.gamesTab, scenario: copy.scenario }[key]}</button>)}</div><label className={s.search}><Icon name="search" size={15}/><input aria-label={copy.searchMyWorks} placeholder={copy.findWorks} value={query} onChange={event => setQuery(event.target.value)} maxLength={120}/></label></div>
          {errors.length > 0 && <p className={s.error} role="alert">{errors.join("、")}暂时加载失败。其他作品仍可使用，请点击刷新重试。</p>}
          {!registered && <p className={s.guest}>登录后可查看云端作品并保存游戏、小说和团本。<button onClick={onRequireAccount}>登录 / 注册</button></p>}
          {filtered.length ? <div className={s.works}>{filtered.map(work => <button key={`${work.kind}:${work.id}`} className={s.work} onClick={() => open(work)}><span className={s.workIcon}><Icon name={KINDS[work.kind].icon}/></span><div><strong>{work.title || "未命名作品"}</strong><p>{work.synopsis || "还没有填写简介"}</p><small>{KINDS[work.kind].label} · {work.detail}{work.updatedAt > 0 ? ` · ${new Date(work.updatedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}</small></div><span className={s.continue} title={copy.continueWork}><Icon name="edit" size={15}/><span className={s.hint}>{copy.continueWork}</span></span></button>)}</div> : <div className={s.empty}><Icon name={query || kind !== "all" ? "search" : "edit"} size={32}/><h3>{loading ? "正在加载作品" : query || kind !== "all" ? "没有匹配的已加载作品" : errors.length ? "暂时未能载入作品" : "你的第一部作品，从这里开始"}</h3><p>{query || kind !== "all" ? "换个词或选择其他类型。" : "从上方选择一种创作方式。保存后可在这里继续。"}</p></div>}
        </section>
      </>}
    </section>
  </main>;
}
