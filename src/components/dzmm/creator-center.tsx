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
      <header className={`${s.header} ${section === "roles" ? "" : s.headerCompact}`}>{section === "roles" ? <div><p>{copy.creatorEyebrow}</p><h1>{copy.rolesAndPosts}</h1><span>{copy.rolesLead}</span></div> : <div><h1>{copy.startCreating}</h1></div>}<div className={s.headerActions}>{section === "roles" && <button onClick={() => onRoute("studio")}><Icon name="back" size={16}/>{copy.workbench}</button>}<button onClick={() => onRoute("characters")}><Icon name="back" size={16}/>{copy.backToSite}</button></div></header>
      {section === "roles" ? <PublishingCenter locale={locale} embedded user={user} drafts={drafts} onCreate={onCreate} onEdit={onEdit} onCharacter={onCharacter} onRequireAccount={onRequireAccount} onCatalogChanged={onCatalogChanged} onNovels={() => onRoute("novels")}/> : <>
        <section className={s.tiles} aria-label={copy.beginCreate}>
          {([
            { key: "role", label: copy.createRole, icon: "user" as const, art: "/assets/xumeng/content-covers/tangtang.jpg", primary: true, run: onCreate },
            { key: "novel", label: copy.novelsStories, icon: "book" as const, art: "/assets/xumeng/generation-templates/scene.svg", primary: false, run: () => start("novels/new/novel") },
            { key: "girlfriend", label: copy.uploadGirlfriend, icon: "upload" as const, art: "/assets/xumeng/content-covers/wanning.jpg", primary: false, run: () => onRoute("studio/girlfriends/new") },
            { key: "game", label: copy.uploadGame, icon: "play" as const, art: "/assets/xumeng/categories/rpg.webp", primary: false, run: () => onRoute("studio/games") },
            { key: "scenario", label: copy.createScenario, icon: "users" as const, art: "/assets/xumeng/categories/cultivation-sect.webp", primary: false, run: () => start("studio/scenarios/new") },
            ...(XUMENG_GENERATION_WORKSPACE_ENABLED ? [{ key: "generate", label: copy.generate, icon: "image" as const, art: "/assets/xumeng/generation-templates/cover.svg", primary: false, run: () => onRoute("generation") }] : []),
          ]).map(tile => (
            <button key={tile.key} type="button" className={`${s.tile} ${tile.primary ? s.tilePrimary : ""}`} onClick={tile.run} title={tile.label}>
              <img className={s.tileArt} src={tile.art} alt="" loading="lazy" />
              <span className={s.tileShade} />
              <span className={s.tileIcon}><Icon name={tile.icon} size={16} /></span>
              <span className={s.tileLabel}>{tile.label}{tile.primary && createCost ? <small> · {createCost} Credit</small> : null}</span>
            </button>
          ))}
        </section>
      </>}
    </section>
  </main>;
}
