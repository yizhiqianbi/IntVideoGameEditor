"use client";

import type { Character } from "@/lib/dzmm-characters";
import type { DzmmCloudUser } from "@/lib/dzmm-cloud";
import { XUMENG_GENERATION_WORKSPACE_ENABLED } from "@/lib/xumeng-feature-availability";
import { useCharacterCreateCost } from "@/lib/dzmm-scene-prices";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { xumengPage } from "@/lib/xumeng-page-copy";
import PublishingCenter from "./publishing-center";
import Icon from "./icons";
import s from "./creator-center.module.css";

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
  const registered = Boolean(user && !user.isGuest);
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
      </>}
    </section>
  </main>;
}
