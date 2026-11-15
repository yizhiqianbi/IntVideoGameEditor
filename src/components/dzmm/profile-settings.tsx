"use client";

import { DZMM_OFFERED_MODEL_OPTIONS, normalizeDzmmModelSelection } from "../../lib/dzmm-models";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";

/* eslint-disable @next/next/no-img-element -- Character covers are imported media assets. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getDzmmCharacterCardBlurb } from "@/lib/dzmm-character-presentation";
import type { Character } from "@/lib/dzmm-characters";
import { DZMM_PERSONA_LIMIT, type DzmmChatFont, type DzmmChatFontSize, type DzmmPreferences, type DzmmSavedConversation, type DzmmSavedPersona, type DzmmSavedPreset } from "@/lib/dzmm-storage";
import { dzmmChatDisplayStyle } from "@/lib/dzmm-chat-display";
import type { DzmmAuthor } from "@/lib/dzmm-discovery";
import { XUMENG_LOCALES, xumengLocaleLabel, type XumengLocale } from "@/lib/xumeng-i18n";
import { changeDzmmPassword, requestDzmmEmailBind, verifyDzmmEmailBind } from "@/lib/dzmm-account";
import { fetchDzmmReferral, type DzmmReferralInfo } from "@/lib/dzmm-referral";
import { posterShareLocation, XUMENG_POSTERS } from "@/lib/xumeng-acquisition";
import { fetchDzmmPaymentWallet } from "@/lib/dzmm-payments";
import { xumengCardCoverUrl } from "@/lib/xumeng-routes";
import { DreamCoinPanel } from "./dream-coin-panel";
import { UserMark } from "./user-mark";
import { characterCreateLabel, useCharacterCreateCost } from "@/lib/dzmm-scene-prices";
import { xumengTranslate } from "@/lib/xumeng-i18n";
import { xumengPage, xumengPageFill } from "@/lib/xumeng-page-copy";
import Icon from "./icons";
import s from "./profile-settings.module.css";

export type DzmmProfileUser = {
  id: string; nickname?: string; email?: string | null; isGuest: boolean;
  role?: string; createdAt?: string | number;
  passwordSetupRequired?: boolean;
};

function dateLabel(value: string | number | undefined) {
  if (value === undefined || !Number.isFinite(new Date(value).getTime())) return "";
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric" });
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]");
    controls()?.[0]?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const elements = controls();
      if (!elements?.length) { event.preventDefault(); ref.current?.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  return <div className={s.overlay} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={s.dialog} ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header className={s.dialogHeader}><h2>{title}</h2><button type="button" className={s.iconButton} aria-label="关闭弹窗" onClick={onClose}><Icon name="close" /></button></header>{children}</div></div>;
}

function Empty({ children }: { children: ReactNode }) { return <div className={s.empty}><Icon name="book" size={30} /><p>{children}</p></div>; }

export type ProfileViewProps = {
  user: DzmmProfileUser | null; characters: Character[]; custom: Character[];
  favorites: string[]; conversations: DzmmSavedConversation[]; authors: DzmmAuthor[];
  preferences: DzmmPreferences; onCharacter: (character: Character) => void;
  onAuthor: (author: DzmmAuthor) => void; onConversation: (conversation: DzmmSavedConversation) => void;
  onEditCharacter: (character: Character) => void; onCreateCharacter: () => void;
  onEditProfile: () => void; onSettings: () => void; onPresets: () => void; onRecharge?: () => void; onVip?: () => void;
  onInvite?: () => void;
  onLogin?: () => void; onRegister?: () => void; onBrowse?: () => void;
  onDeleteCharacter?: (character: Character) => void; onAdmin?: () => void;
};

export function ProfileView({ user, characters, custom, favorites, conversations, authors, preferences, onCharacter, onAuthor, onConversation, onEditCharacter, onCreateCharacter, onEditProfile, onSettings, onPresets, onRecharge, onVip, onInvite, onLogin, onRegister, onBrowse, onDeleteCharacter, onAdmin }: ProfileViewProps) {
  const copy = xumengPage(preferences.locale ?? "zh-Hans");
  const createLabel = characterCreateLabel(useCharacterCreateCost(), copy.createRole);
  const [tab, setTab] = useState<"timeline" | "characters" | "favorites" | "conversations" | "following">("characters");
  const [credits, setCredits] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [deleting, setDeleting] = useState<Character | null>(null);
  const followedIds = preferences.followedAuthors ?? [];
  const followed = followedIds.map((id) => authors.find((author) => author.id === id) ?? { id, name: copy.followedAuthor, sourceUrl: "", characterIds: [] });
  const favoriteRoles = characters.filter((character) => favorites.includes(character.id));
  const events = [
    ...custom.map((character) => ({ id: `role-${character.id}`, text: xumengPageFill(copy.createdRole, { name: character.name }), date: Date.parse(character.createdAt), action: () => onCharacter(character) })),
    ...conversations.map((conversation) => ({ id: `chat-${conversation.id}`, text: xumengPageFill(copy.continuedWith, { name: conversation.title }), date: conversation.updatedAt, action: () => onConversation(conversation) })),
  ].filter((event) => Number.isFinite(event.date)).sort((a, b) => b.date - a.date);
  useEffect(() => {
    if (!user || user.isGuest) return;
    const abort = new AbortController();
    void fetchDzmmPaymentWallet(abort.signal).then(wallet => {
      if (!abort.signal.aborted && wallet.accountId === user.id) setCredits(wallet.balance);
    }).catch(() => { if (!abort.signal.aborted) setCredits(null); });
    return () => abort.abort();
  }, [user]);
  async function copyId() { if (!user) return; try { await navigator.clipboard.writeText(user.id); setCopyStatus(copy.userCopied); } catch { setCopyStatus(copy.copyFailedSelect); } }
  if (!user || user.isGuest) {
    return <main className={`${s.page} ${s.guestPage}`}>
      <header className={s.pageTopline}>
        <div className={s.guestIdentity}><span className={s.avatar}><UserMark /></span><div><h1>{xumengTranslate(preferences.locale ?? "zh-Hans", "guestName")}</h1><p>{copy.notSignedIn}</p></div></div>
        <span className={s.guestPill}><span className={s.guestDot} />{copy.guestMode}</span>
      </header>
      <section className={s.accountSummary} aria-label={copy.accountInfo}>
        <div className={s.balanceBlock}><span>{copy.creditBalance}</span><strong>—</strong><small>{copy.loginToView}</small></div>
        <div className={s.authActions}><button type="button" className={s.primary} onClick={onLogin}>{copy.login}</button><button type="button" className={s.outline} onClick={onRegister}>{copy.registerAccount}</button></div>
      </section>
      <section className={s.compactStats} aria-label={copy.accountContents}>
        <button type="button" onClick={onRegister}><strong>{custom.length}</strong><span>{copy.roles}</span></button>
        <button type="button" onClick={onRegister}><strong>{favorites.length}</strong><span>{copy.saved}</span></button>
        <button type="button" onClick={onRegister}><strong>{conversations.length}</strong><span>{copy.sessions}</span></button>
        <button type="button" onClick={onRegister}><strong>{followedIds.length}</strong><span>{copy.follow}</span></button>
      </section>
      <section className={s.accountMenu} aria-label={copy.accountActions}>
        <button type="button" onClick={onSettings}><span><Icon name="sliders" size={17} /><b>{copy.settings}</b></span><Icon name="chevron" size={16} /></button>
        {onRecharge && <button type="button" onClick={onRecharge}><span><Icon name="wallet" size={17} /><b>{copy.rechargeVip}</b></span><Icon name="chevron" size={16} /></button>}
        {onInvite && <button type="button" onClick={onInvite}><span><Icon name="users" size={17} /><b>{copy.inviteFriends}</b></span><Icon name="chevron" size={16} /></button>}
        <button type="button" onClick={onBrowse}><span><Icon name="compass" size={17} /><b>{copy.characterSquare}</b></span><Icon name="chevron" size={16} /></button>
      </section>
    </main>;
  }
  const openVip = onVip ?? onRecharge;
  return <main className={`${s.page} ${s.signedInPage} ${s.minePage}`}>
    <header className={s.mineHead}>
      <span className={`${s.avatar} ${s.mineAvatar}`}><UserMark /></span>
      <div className={s.profileInfo}>
        <h1>{preferences.nickname}</h1>
        <button className={s.idButton} onClick={() => void copyId()} aria-label={copy.copyUserId}>ID {user.id}<Icon name="copy" size={13} /></button>
        <p>{user.email || copy.noEmailYet}{dateLabel(user.createdAt) && ` · ${xumengPageFill(copy.joinedOn, { date: dateLabel(user.createdAt) })}`}</p>
        {preferences.bio && <p className={s.bio}>{preferences.bio}</p>}
      </div>
      <button type="button" className={s.mineGear} aria-label={copy.settings} onClick={onSettings}><Icon name="sliders" size={18} /></button>
    </header>
    {copyStatus && <p className={s.status} role="status">{copyStatus}</p>}
    <div className={s.mineAssets}>
      <button type="button" className={s.mineVip} onClick={openVip} disabled={!openVip}>
        <span className={s.mineAssetIcon}><Icon name="crown" size={18} /></span>
        <span><small>{copy.membership}</small><strong>{copy.viewPerks}</strong></span>
        <Icon name="chevron" size={16} />
      </button>
      <button type="button" className={s.mineWallet} onClick={onRecharge} disabled={!onRecharge}>
        <span className={s.mineAssetIcon}><Icon name="wallet" size={18} /></span>
        <span><small>Credit</small><strong>{credits === null ? "…" : credits.toLocaleString("zh-CN")}</strong></span>
        <Icon name="chevron" size={16} />
      </button>
    </div>
    {openVip && <button type="button" className={s.minePromo} onClick={openVip}>
      <span><strong>{copy.memberOffer}</strong><small>{copy.memberOfferBody}</small></span>
      <b>{copy.joinNow}</b>
    </button>}
    <div className={s.mineShortcuts} aria-label={copy.myContent}>
      <button type="button" className={tab === "characters" ? s.mineOn : ""} onClick={() => setTab("characters")}><Icon name="user" size={18} /><span>{copy.roles}</span><strong>{custom.length}</strong></button>
      <button type="button" className={tab === "favorites" ? s.mineOn : ""} onClick={() => setTab("favorites")}><Icon name="heart" size={18} /><span>{copy.saved}</span><strong>{favorites.length}</strong></button>
      <button type="button" className={tab === "conversations" ? s.mineOn : ""} onClick={() => setTab("conversations")}><Icon name="chat" size={18} /><span>{copy.sessions}</span><strong>{conversations.length}</strong></button>
      <button type="button" className={tab === "following" ? s.mineOn : ""} onClick={() => setTab("following")}><Icon name="users" size={18} /><span>{copy.follow}</span><strong>{followedIds.length}</strong></button>
    </div>
    {onInvite && <section className={`${s.referralCard} ${s.inviteBanner} ${s.mineInvite}`}><div className={s.referralHeading}><div><span className={s.referralEyebrow}>{copy.inviteFriends}</span><h2>{copy.inviteTogether}</h2></div><button type="button" className={s.outline} onClick={onInvite}>{copy.inviteNow} <Icon name="chevron" size={14} /></button></div></section>}
    <nav className={s.accountMenu} aria-label={copy.accountActions}>
      <button type="button" onClick={onEditProfile}><span><Icon name="edit" size={17} /><b>{copy.editProfile}</b></span><Icon name="chevron" size={16} /></button>
      <button type="button" onClick={onCreateCharacter}><span><Icon name="plus" size={17} /><b>{createLabel}</b></span><Icon name="chevron" size={16} /></button>
      <button type="button" onClick={onPresets}><span><Icon name="book" size={17} /><b>{copy.myPresets}</b></span><Icon name="chevron" size={16} /></button>
      {onRecharge && <button type="button" onClick={onRecharge}><span><Icon name="wallet" size={17} /><b>{XUMENG_PAYMENTS_ENABLED ? copy.rechargeVip : copy.balancePerks}</b></span><Icon name="chevron" size={16} /></button>}
      <button type="button" onClick={onSettings}><span><Icon name="sliders" size={17} /><b>{copy.settings}</b></span><Icon name="chevron" size={16} /></button>
      {user.role === "super" && onAdmin && <button type="button" onClick={onAdmin}><span><Icon name="grid" size={17} /><b>{copy.admin}</b></span><Icon name="chevron" size={16} /></button>}
    </nav>
    {!user.isGuest && <DreamCoinPanel userId={user.id} compact />}
    <div className={`${s.tabs} ${s.contentTabs}`} role="tablist" aria-label={copy.myContent}>{([{ id: "timeline", label: copy.timeline }, { id: "characters", label: copy.roles }, { id: "favorites", label: copy.saved }, { id: "conversations", label: copy.sessions }, { id: "following", label: copy.follow }] as const).map((item) => <button role="tab" aria-selected={tab === item.id} key={item.id} className={tab === item.id ? s.activeTab : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {tab === "timeline" && (events.length ? <div className={s.timeline}>{events.map((event) => <button key={event.id} onClick={event.action}><span className={s.timelineDot} /><span><time>{dateLabel(event.date)}</time><strong>{event.text}</strong></span><Icon name="chevron" size={16} /></button>)}</div> : <Empty>{copy.noActivity}</Empty>)}
    {(tab === "characters" || tab === "favorites") && ((tab === "characters" ? custom : favoriteRoles).length ? <div className={s.roleList}>{(tab === "characters" ? custom : favoriteRoles).map((character) => <article key={character.id} className={s.roleRow}><button className={s.roleCover} onClick={() => onCharacter(character)} aria-label={xumengPageFill(copy.viewNamed, { name: character.name })}><img src={xumengCardCoverUrl(character.cover)} alt={character.name} /></button><button className={s.roleText} onClick={() => onCharacter(character)}><h2>{character.name}</h2><p>{getDzmmCharacterCardBlurb(character, preferences.nickname)}</p><small>{character.author}</small></button>{tab === "characters" && <div className={s.roleActions}><button className={s.iconButton} onClick={() => onEditCharacter(character)} aria-label={xumengPageFill(copy.editNamed, { name: character.name })}><Icon name="edit" size={17} /></button>{onDeleteCharacter && <button className={s.deleteButton} onClick={() => setDeleting(character)} aria-label={xumengPageFill(copy.deleteNamed, { name: character.name })}>{copy.deleteWord}</button>}</div>}</article>)}</div> : <Empty>{tab === "characters" ? copy.noRolesYet : copy.noSavesYet}</Empty>)}
    {tab === "conversations" && (conversations.length ? <div className={s.conversations}>{conversations.map((conversation) => <button key={conversation.id} onClick={() => onConversation(conversation)}><Icon name="chat" size={20} /><span><strong>{conversation.title}</strong><small>{conversation.messages.at(-1)?.content || copy.noMessagesYet}</small></span><time>{dateLabel(conversation.updatedAt)}</time></button>)}</div> : <Empty>{copy.noSessionsYet}</Empty>)}
    {tab === "following" && (followed.length ? <div className={s.authorList}>{followed.map((author) => <button key={author.id} onClick={() => onAuthor(author)}><span className={s.smallAvatar}><UserMark /></span><span><strong>{author.name}</strong><small>{xumengPageFill(copy.worksCount, { count: author.characterIds.length })}</small></span><Icon name="chevron" size={16} /></button>)}</div> : <Empty>{copy.noFollowsYet}</Empty>)}
    {deleting && <Dialog title={copy.deleteRoleTitle} onClose={() => setDeleting(null)}><p className={s.confirmText}>{xumengPageFill(copy.deleteRoleBody, { name: deleting.name })}</p><div className={s.dialogActions}><button className={s.outline} onClick={() => setDeleting(null)}>{copy.cancel}</button><button className={s.danger} onClick={() => { onDeleteCharacter?.(deleting); setDeleting(null); }}>{copy.deleteRole}</button></div></Dialog>}
  </main>;
}

export function InviteCenter({ user, locale = "zh-Hans", onBack, onRegister, onWallet }: {
  user: DzmmProfileUser | null; locale?: XumengLocale; onBack: () => void; onRegister: () => void; onWallet: () => void;
}) {
  const copy = xumengPage(locale);
  const [referral, setReferral] = useState<DzmmReferralInfo | null>(null);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    let active = true;
    if (!user || user.isGuest) return () => { active = false; };
    void fetchDzmmReferral().then(value => { if (active && value.accountId === user.id) setReferral(value); }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : copy.inviteLoadFailed);
    });
    return () => { active = false; };
  }, [user]);
  const reward = referral?.rewardPoints ?? 20;
  const activityReward = referral?.activityRewardPoints ?? 500;
  const activityDays = referral?.activityRewardDays ?? 3;
  async function copyText(value: string, success: string) {
    try { await navigator.clipboard.writeText(value); setCopyStatus(success); }
    catch { setCopyStatus(xumengPageFill(copy.copyFailedValue, { value })); }
  }
  return <main className={s.page}>
    <header className={s.pageHeading}>
      <button type="button" className={s.outline} onClick={onBack}>{copy.back}</button>
      <div><h1>{copy.inviteFriends}</h1><p className={s.lead}>{copy.inviteStep1}</p></div>
    </header>
    <section className={s.referralCard} aria-label={copy.inviteHow}>
      <div className={s.referralHeading}><div><span className={s.referralEyebrow}>{copy.howItWorks}</span><h2>{copy.inviteHeadline}</h2></div><strong>+{reward} / +{activityReward}</strong></div>
      <ol className={s.steps}>
        <li>{copy.inviteStep1}</li>
        <li>{xumengPageFill(copy.inviteStep2, { reward, activity: activityReward, days: activityDays })}</li>
        <li>{xumengPageFill(copy.inviteStep3, { percent: referral?.rebatePercent ?? "…" })}</li>
      </ol>
    </section>
    {!user || user.isGuest ? <section className={s.referralCard}><h2>{copy.inviteAfterRegister}</h2><p>{copy.guestNoCode}</p><button type="button" className={s.primary} onClick={onRegister}>{copy.registerForCode}</button></section>
      : error ? <p className={s.error} role="alert">{error}</p>
      : referral ? <section className={s.referralCard} aria-label={copy.myInvites}>
        <div className={s.referralHeading}><div><span className={s.referralEyebrow}>{copy.myInvites}</span><h2>{copy.linkAndCode}</h2></div></div>
        <div className={s.referralCode}><span>{copy.inviteLink}</span><code className={s.referralLink}>{referral.inviteUrl}</code><button type="button" className={s.outline} disabled={!referral.inviteUrl} onClick={() => referral.inviteUrl && void copyText(referral.inviteUrl, copy.linkCopied)}><Icon name="copy" size={14} />{copy.copyLink}</button></div>
        <div className={s.referralCode}><span>{copy.inviteCode}</span><code>{referral.inviteCode}</code><button type="button" className={s.outline} disabled={!referral.inviteCode} onClick={() => referral.inviteCode && void copyText(referral.inviteCode, copy.codeCopied)}><Icon name="copy" size={14} />{copy.copyCode}</button></div>
        <div className={s.referralStats}><span>{xumengPageFill(copy.invitedPeople, { count: referral.invitedCount })}</span><span>{xumengPageFill(copy.earnedCredit, { count: referral.earnedPoints })}</span></div>
        <div className={s.referralStats}><span>{xumengPageFill(copy.opens, { count: referral.opens ?? 0 })}</span><span>{xumengPageFill(copy.registrations, { count: referral.registrations ?? 0 })}</span><span>{xumengPageFill(copy.startedChats, { count: referral.startedChats ?? 0 })}</span></div>
        {XUMENG_POSTERS.map((poster) => {
          const label = poster === "catch" ? copy.posterCatch : poster === "waiting" ? copy.posterWaiting : copy.posterStare;
          const url = `${window.location.origin}${posterShareLocation(poster, referral.inviteCode)}`;
          return <div className={s.referralCode} key={poster}><span>{xumengPageFill(copy.posterLabel, { label })}</span><code className={s.referralLink}>{url}</code><button type="button" className={s.outline} onClick={() => void copyText(url, copy.posterCopied)}><Icon name="copy" size={14} />{copy.copyLink}</button></div>;
        })}
      </section> : <p className={s.lead}>{copy.loadingCode}</p>}
    {copyStatus && <p className={s.status} role="status">{copyStatus}</p>}
    <p className={s.lead}>{copy.dreamCoinNote}<button type="button" className={s.textLink} onClick={onWallet}>{copy.viewDreamCoin}</button></p>
  </main>;
}

export type ProfileSettingsProps = {
  user: DzmmProfileUser | null; preferences: DzmmPreferences;
  onPreferences: (preferences: DzmmPreferences) => void; onBack: () => void;
  onPasswordChanged?: (accountId: string) => void;
  onEmailBound?: (account: { id: string; email: string | null; passwordSetupRequired?: boolean }) => void;
};

function BindEmailForm({ accountId, onBound }: { accountId: string; onBound?: ProfileSettingsProps["onEmailBound"] }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const account = useRef(accountId);
  useEffect(() => { account.current = accountId; return () => { account.current = ""; }; }, [accountId]);
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  async function sendCode() {
    if (busy || resendSeconds > 0) return;
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.includes("\0")) { setError("请输入有效的邮箱。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestDzmmEmailBind(accountId, address);
      if (account.current !== accountId) return;
      setChallengeId(result.challengeId);
      setResendAt(Date.now() + Math.max(1, result.resendAfter || 60) * 1000);
      setNotice("验证码已发送，请查收邮件。");
    } catch (failure) {
      if (account.current === accountId) setError(failure instanceof Error ? failure.message : "验证码发送失败，请重试。");
    } finally { if (account.current === accountId) setBusy(false); }
  }
  async function bind(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!challengeId) { await sendCode(); return; }
    const address = email.trim().toLowerCase();
    if (!/^\d{6}$/.test(code)) { setError("请输入邮件中的 6 位验证码。"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const bound = await verifyDzmmEmailBind(accountId, address, challengeId, code);
      if (account.current !== accountId) return;
      onBound?.(bound);
    } catch (failure) {
      if (account.current === accountId) setError(failure instanceof Error ? failure.message : "邮箱绑定失败，请重试。");
    } finally { if (account.current === accountId) setBusy(false); }
  }
  return <form className={s.settingsForm} onSubmit={(event) => void bind(event)}>
    <p className={s.muted}>当前账号还没有邮箱。绑定后可以用邮箱验证码或密码在其他设备登录。</p>
    <label>邮箱<input type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={(event) => { setEmail(event.target.value); setChallengeId(""); setCode(""); setError(""); setNotice(""); }} /></label>
    <div className={s.bindRow}>
      <label>验证码<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} disabled={busy || !challengeId} value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))} /></label>
      <button type="button" className={s.outline} disabled={busy || resendSeconds > 0} onClick={() => void sendCode()}>{busy && !challengeId ? "正在发送…" : resendSeconds > 0 ? `${resendSeconds} 秒后重发` : challengeId ? "重新发送" : "获取验证码"}</button>
    </div>
    {error && <p className={s.error} role="alert">{error}</p>}
    {notice && <p className={s.status} role="status">{notice}</p>}
    <button type="submit" className={s.outline} disabled={busy || !challengeId || code.length !== 6}>{busy && challengeId ? "正在绑定…" : "绑定邮箱"}</button>
  </form>;
}

export function ProfileSettings({ user, preferences, onPreferences, onBack, onPasswordChanged, onEmailBound }: ProfileSettingsProps) {
  const [form, setForm] = useState(preferences);
  const [blockedText, setBlockedText] = useState((preferences.blockedTags ?? []).join("\n"));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const needsPassword = user?.passwordSetupRequired === true;
  const passwordAccount = useRef(user?.id);
  useEffect(() => {
    passwordAccount.current = user?.id;
    return () => { passwordAccount.current = undefined; };
  }, [user?.id]);
  function update<K extends keyof DzmmPreferences>(key: K, value: DzmmPreferences[K]) { setForm((previous) => ({ ...previous, [key]: value })); setNotice(""); }
  function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    const nickname = form.nickname.trim();
    const blockedTags = [...new Set(blockedText.split(/[\n,，]/).map((tag) => tag.trim()).filter(Boolean))];
    if (!nickname || nickname.length > 30 || nickname.includes("\0")) { setError("昵称应为 1–30 个字符。"); return; }
    if ((form.bio?.length ?? 0) > 500 || form.bio?.includes("\0")) { setError("个人简介不能超过 500 个字符。"); return; }
    if (form.persona.length > 4000 || form.persona.includes("\0")) { setError("我的身份不能超过 4000 个字符或包含无效字符。"); return; }
    if (form.preset.length > 8000 || form.preset.includes("\0")) { setError("对话预设不能超过 8000 个字符或包含无效字符。"); return; }
    if (form.maxTokens !== undefined && (!Number.isInteger(form.maxTokens) || form.maxTokens < 128 || form.maxTokens > 4096)) { setError("回复长度上限应为 128–4096 的整数。"); return; }
    if (blockedTags.length > 50 || blockedTags.some((tag) => tag.length > 40 || tag.includes("\0"))) { setError("最多屏蔽 50 个标签，每个标签不超过 40 个字符。"); return; }
    const theme = form.theme ?? (form.dark ? "dark" : "light");
    const dark = theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
    onPreferences({ ...form, nickname, blockedTags, dark, theme, model: normalizeDzmmModelSelection(form.model), locale: form.locale ?? "zh-Hans" }); setNotice("设置已保存。");
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault(); if (passwordBusy || !user || user.isGuest) return;
    setPasswordError(""); setPasswordNotice("");
    if (passwords.next.length < 12 || passwords.next.length > 256) { setPasswordError("新密码应为 12–256 个字符。"); return; }
    if (passwords.next !== passwords.confirm) { setPasswordError("两次输入的新密码不一致。"); return; }
    const accountId = user.id;
    setPasswordBusy(true);
    try {
      await changeDzmmPassword(accountId, needsPassword ? "" : passwords.current, passwords.next);
      if (passwordAccount.current !== accountId) return;
      setPasswords({ current: "", next: "", confirm: "" }); onPasswordChanged?.(accountId);
      setPasswordNotice(needsPassword ? "密码已设置，下次可使用邮箱与密码登录。" : "密码已修改，其他设备需要重新登录。");
    }
    catch (failure) { if (passwordAccount.current === accountId) setPasswordError(failure instanceof Error ? failure.message : "密码修改失败，请重试。"); }
    finally { if (passwordAccount.current === accountId) setPasswordBusy(false); }
  }
  return <main className={`${s.page} ${s.settingsPage}`}>
    <div className={s.pageHeading}><button className={s.back} onClick={onBack}><Icon name="back" size={18} />返回</button><h1>设置</h1></div>
    <form className={s.settingsForm} onSubmit={save}>
      <section className={s.settingsSection}><h2>个人资料</h2><label>昵称<input required maxLength={30} value={form.nickname} onChange={(event) => update("nickname", event.target.value)} autoComplete="nickname" /></label><label>个人简介<textarea maxLength={500} rows={3} placeholder="介绍一下你自己" value={form.bio ?? ""} onChange={(event) => update("bio", event.target.value)} /><small>{form.bio?.length ?? 0}/500</small></label><label>性别<select value={form.gender ?? ""} onChange={(event) => update("gender", event.target.value ? event.target.value as DzmmPreferences["gender"] : undefined)}><option value="">未设置</option><option value="male">男</option><option value="female">女</option><option value="other">其他</option></select></label></section>
      <section className={s.settingsSection}><h2>外观</h2><label>主题<select aria-label="主题" value={form.theme ?? (form.dark ? "dark" : "light")} onChange={(event) => update("theme", event.target.value as DzmmPreferences["theme"])}><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></label><label>首页布局<select aria-label="首页布局" value={form.homeLayout ?? "double"} onChange={(event) => update("homeLayout", event.target.value as DzmmPreferences["homeLayout"])}><option value="single">单列</option><option value="double">双列</option></select></label><label className={s.checkboxRow}><span>显示悬浮聊天按钮</span><input type="checkbox" checked={form.showFloatingChat ?? true} onChange={(event) => update("showFloatingChat", event.target.checked)} /></label><label>悬浮按钮大小<select value={form.floatingSize ?? "medium"} disabled={form.showFloatingChat === false} onChange={(event) => update("floatingSize", event.target.value as DzmmPreferences["floatingSize"])}><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label><label>悬浮按钮透明度 <span>{form.floatingOpacity ?? 100}%</span><input aria-label="悬浮按钮透明度" type="range" min={20} max={100} step={5} value={form.floatingOpacity ?? 100} disabled={form.showFloatingChat === false} onChange={(event) => update("floatingOpacity", Number(event.target.value))} /></label></section>
      <section className={s.settingsSection}><h2>对话显示</h2><p className={s.muted}>对话模型、回复长度、语言和人设在「我的预设」里设置。</p>
        <label>字号<select aria-label="聊天字号" value={form.chatFontSize ?? "medium"} onChange={(event) => update("chatFontSize", event.target.value as DzmmChatFontSize)}><option value="small">小</option><option value="medium">标准</option><option value="large">大</option><option value="xlarge">特大</option></select></label>
        <label>字体<select aria-label="聊天字体" value={form.chatFont ?? "system"} onChange={(event) => update("chatFont", event.target.value as DzmmChatFont)}><option value="system">系统默认</option><option value="serif">宋体</option><option value="kai">楷体</option></select></label>
        <div className={s.colorRow}><span>我的消息气泡</span><input type="color" aria-label="我的消息气泡颜色" value={form.userBubbleColor || "#5a2338"} onChange={(event) => update("userBubbleColor", event.target.value)} /><button type="button" className={s.textButton} disabled={!form.userBubbleColor} onClick={() => update("userBubbleColor", "")}>恢复默认</button></div>
        <div className={s.colorRow}><span>角色消息气泡</span><input type="color" aria-label="角色消息气泡颜色" value={form.assistantBubbleColor || "#2a2a2e"} onChange={(event) => update("assistantBubbleColor", event.target.value)} /><button type="button" className={s.textButton} disabled={!form.assistantBubbleColor} onClick={() => update("assistantBubbleColor", "")}>恢复默认</button></div>
        <label>气泡不透明度 <span>{form.bubbleOpacity ?? 80}%</span><input aria-label="气泡不透明度" type="range" min={20} max={100} step={5} value={form.bubbleOpacity ?? 80} onChange={(event) => update("bubbleOpacity", Number(event.target.value))} /></label>
        <label>聊天背景<select aria-label="聊天背景" value={form.chatBackground ?? "cover"} onChange={(event) => update("chatBackground", event.target.value as "site" | "cover" | "plain")}><option value="cover">当前角色</option><option value="site">默认壁纸</option><option value="plain">纯色</option></select></label>
        <label>回车键<select aria-label="回车键" value={form.enterKey ?? "auto"} onChange={(event) => update("enterKey", event.target.value as "auto" | "send" | "newline")}><option value="auto">自动（手机换行，电脑发送）</option><option value="send">回车发送</option><option value="newline">回车换行，用发送键发送</option></select><small>电脑上 Shift+Enter 始终换行。</small></label>
        <div className={s.bubblePreview} style={dzmmChatDisplayStyle(form)} aria-hidden="true"><p data-role="assistant">她抬眼看你，笑了一下。“你来得正好。”</p><p data-role="user">我在她对面坐下。</p></div>
      </section>
      <section className={s.settingsSection}><h2>内容屏蔽</h2><label>屏蔽标签<textarea aria-label="屏蔽标签" rows={4} maxLength={2050} placeholder="每行一个标签，例如：某个题材" value={blockedText} onChange={(event) => { setBlockedText(event.target.value); setNotice(""); }} /><small>目录和搜索会隐藏包含这些标签的角色。最多 50 个，每个最多 40 字。</small></label></section>
      {error && <p className={s.error} role="alert">{error}</p>}{notice && <p className={s.status} role="status">{notice}</p>}<div className={s.saveRow}><button type="submit" className={s.primary}><Icon name="check" size={16} />保存设置</button></div>
    </form>
    <section className={s.settingsSection}><h2>账号安全</h2>{!user || user.isGuest ? <p className={s.muted}>注册一个名字后，可以在这里绑定邮箱并设置密码。</p> : !user.email ? <BindEmailForm accountId={user.id} onBound={onEmailBound} /> : <form className={s.settingsForm} onSubmit={(event) => void changePassword(event)}>{needsPassword && <p className={s.muted}>邮箱已验证，当前账号尚未设置密码。设置后可使用邮箱与密码登录。</p>}{!needsPassword && <label>当前密码<input type="password" autoComplete="current-password" required maxLength={256} disabled={passwordBusy} value={passwords.current} onChange={(event) => setPasswords((previous) => ({ ...previous, current: event.target.value }))} /></label>}<label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={passwordBusy} value={passwords.next} onChange={(event) => setPasswords((previous) => ({ ...previous, next: event.target.value }))} /><small>至少 12 个字符。</small></label><label>确认新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={passwordBusy} value={passwords.confirm} onChange={(event) => setPasswords((previous) => ({ ...previous, confirm: event.target.value }))} /></label>{passwordError && <p className={s.error} role="alert">{passwordError}</p>}{passwordNotice && <p className={s.status} role="status">{passwordNotice}</p>}<button type="submit" className={s.outline} disabled={passwordBusy}>{passwordBusy ? "正在保存…" : needsPassword ? "设置密码" : "修改密码"}</button></form>}</section>
  </main>;
}

function downloadPresets(presets: DzmmSavedPreset[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, presets }, null, 2)], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "dzmm-presets.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type PresetLibraryProps = {
  preferences: DzmmPreferences; onPreferences: (preferences: DzmmPreferences) => void; onBack: () => void;
};

export function PresetLibrary({ preferences, onPreferences, onBack }: PresetLibraryProps) {
  const presets = preferences.presets ?? [];
  const mounted = useRef(true);
  const preferencesRef = useRef(preferences);
  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [editing, setEditing] = useState<DzmmSavedPreset | "new" | null>(null);
  const [form, setForm] = useState({ name: "", content: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<DzmmSavedPreset | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const personas = preferences.personas ?? [];
  const [chatForm, setChatForm] = useState(() => ({ locale: preferences.locale ?? "zh-Hans", model: normalizeDzmmModelSelection(preferences.model), maxTokens: preferences.maxTokens ?? 2048, persona: preferences.persona }));
  const [chatNotice, setChatNotice] = useState("");
  const [chatError, setChatError] = useState("");
  const [editingPersona, setEditingPersona] = useState<DzmmSavedPersona | "new" | null>(null);
  const [personaForm, setPersonaForm] = useState({ name: "", content: "" });
  const [personaError, setPersonaError] = useState("");
  const [deletingPersona, setDeletingPersona] = useState<DzmmSavedPersona | null>(null);
  const personaUsage = (id: string) => Object.values(preferences.conversationPersonas ?? {}).filter(value => value === id).length;
  function saveChatSettings(event: FormEvent) {
    event.preventDefault(); setChatError(""); setChatNotice("");
    if (chatForm.persona.length > 4000 || chatForm.persona.includes("\0")) { setChatError("默认人设不能超过 4000 个字符。"); return; }
    onPreferences({ ...preferencesRef.current, locale: chatForm.locale, model: chatForm.model, maxTokens: chatForm.maxTokens, persona: chatForm.persona });
    setChatNotice("对话设置已保存，下次回复会使用。");
  }
  function editPersona(persona: DzmmSavedPersona | "new") { setPersonaForm(persona === "new" ? { name: "", content: "" } : { name: persona.name, content: persona.content }); setPersonaError(""); setEditingPersona(persona); }
  function savePersona(event: FormEvent) {
    event.preventDefault(); if (!editingPersona) return;
    const name = personaForm.name.trim(), content = personaForm.content.trim();
    if (!name || name.length > 80 || name.includes("\0") || content.length > 4000 || content.includes("\0")) { setPersonaError("请填写人设名称：名称最多 80 字，内容最多 4000 字。"); return; }
    if (editingPersona === "new" && personas.length >= DZMM_PERSONA_LIMIT) { setPersonaError(`最多保存 ${DZMM_PERSONA_LIMIT} 个人设，请先删除一个。`); return; }
    const persona = { id: editingPersona === "new" ? crypto.randomUUID() : editingPersona.id, name, content };
    const latest = preferencesRef.current, list = latest.personas ?? [];
    onPreferences({ ...latest, personas: editingPersona === "new" ? [...list, persona] : list.map(item => item.id === persona.id ? persona : item) });
    setEditingPersona(null); setNotice("人设已保存。");
  }
  function removePersona(persona: DzmmSavedPersona) {
    const latest = preferencesRef.current;
    const conversationPersonas = Object.fromEntries(Object.entries(latest.conversationPersonas ?? {}).filter(([, id]) => id !== persona.id));
    onPreferences({ ...latest, personas: (latest.personas ?? []).filter(item => item.id !== persona.id), conversationPersonas });
    setDeletingPersona(null); setNotice("人设已删除，使用它的对话改用默认人设。");
  }
  function edit(preset: DzmmSavedPreset | "new") { setForm(preset === "new" ? { name: "", content: "" } : { name: preset.name, content: preset.content }); setError(""); setEditing(preset); }
  function save(event: FormEvent) {
    event.preventDefault(); if (!editing) return;
    const name = form.name.trim(), content = form.content.trim();
    if (!name || name.length > 80 || name.includes("\0") || content.length > 8000 || content.includes("\0")) { setError("请填写预设名称：名称最多 80 字，内容最多 8000 字。"); return; }
    if (editing === "new" && presets.length >= 30) { setError("最多保存 30 个预设，请先删除一个。"); return; }
    const preset = { id: editing === "new" ? crypto.randomUUID() : editing.id, name, content };
    const next = editing === "new" ? [...presets, preset] : presets.map((item) => item.id === preset.id ? preset : item);
    const wasActive = editing !== "new" && editing.content === preferences.preset;
    onPreferences({ ...preferences, presets: next, preset: wasActive ? content : preferences.preset }); setEditing(null); setNotice("预设已保存。");
  }
  async function importFile(file?: File) {
    if (!file) return; setNotice("");
    try {
      if (!file.size || file.size > 1_000_000) throw new Error("预设文件应为不超过 1 MB 的 JSON。");
      const text = await file.text();
      if (!mounted.current) return;
      const latestPreferences = preferencesRef.current;
      const latestPresets = latestPreferences.presets ?? [];
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("预设文件格式无效。");
      const record = value as { version?: unknown; presets?: unknown };
      if (record.version !== 1 || !Array.isArray(record.presets) || !record.presets.length || latestPresets.length + record.presets.length > 30) throw new Error("文件应包含 version: 1 和 presets 列表，导入后最多 30 个预设。");
      const imported = record.presets.map((entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("预设内容格式无效。");
        const item = entry as { name?: unknown; content?: unknown };
        if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || item.name.includes("\0") || typeof item.content !== "string" || item.content.length > 8000 || item.content.includes("\0")) throw new Error("每个预设必须包含不超过 80 字的名称与不超过 8000 字的内容。");
        return { id: crypto.randomUUID(), name: item.name.trim(), content: item.content.trim() };
      });
      onPreferences({ ...latestPreferences, presets: [...latestPresets, ...imported] }); setNotice(`已导入 ${imported.length} 个预设。`);
    } catch (failure) { if (mounted.current) setNotice(failure instanceof Error ? failure.message : "导入失败，请检查文件。"); }
    finally { if (input.current) input.current.value = ""; }
  }
  return <main className={`${s.page} ${s.presetsPage}`}>
    <div className={s.pageHeading}><button className={s.back} onClick={onBack}><Icon name="back" size={18} />返回</button><h1>我的预设</h1></div>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
    {notice && <p className={s.status} role="status">{notice}</p>}
    <form className={s.settingsGroup} onSubmit={saveChatSettings} aria-labelledby="preset-chat-settings"><h2 id="preset-chat-settings">对话设置</h2>
      <label>回复语言<select aria-label="回复语言" value={chatForm.locale} onChange={(event) => { setChatForm(previous => ({ ...previous, locale: event.target.value as NonNullable<DzmmPreferences["locale"]> })); setChatNotice(""); }}>{XUMENG_LOCALES.map(locale => <option key={locale} value={locale}>{xumengLocaleLabel(locale)}</option>)}</select><small>界面标签和角色回复会使用此语言；角色卡原文与用户输入保持不变。</small></label>
      <label>对话模型<select aria-label="对话模型" value={chatForm.model} onChange={(event) => { setChatForm(previous => ({ ...previous, model: normalizeDzmmModelSelection(event.target.value as DzmmPreferences["model"]) })); setChatNotice(""); }}>{DZMM_OFFERED_MODEL_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.description}</option>)}</select></label>
      <label>回复长度上限<select aria-label="回复长度上限" value={chatForm.maxTokens} onChange={(event) => { setChatForm(previous => ({ ...previous, maxTokens: Number(event.target.value) })); setChatNotice(""); }}>{[256, 512, 1024, 2048, 4096].map((amount) => <option key={amount} value={amount}>{amount} tokens</option>)}{![256, 512, 1024, 2048, 4096].includes(chatForm.maxTokens) && <option value={chatForm.maxTokens}>{chatForm.maxTokens} tokens</option>}</select><small>模型回复可提前结束；这里只限制最长回复。</small></label>
      <label>默认人设<textarea rows={3} maxLength={4000} placeholder="角色如何称呼你？你的身份和背景是什么？" value={chatForm.persona} onChange={(event) => { setChatForm(previous => ({ ...previous, persona: event.target.value })); setChatNotice(""); }} /><small>没有单独选择人设的对话都使用它。单个对话可以在聊天设置的「我的人设」里换成人设库中的其他人设。</small></label>
      {chatError && <p className={s.error} role="alert">{chatError}</p>}{chatNotice && <p className={s.status} role="status">{chatNotice}</p>}
      <div className={s.saveRow}><button type="submit" className={s.primary}><Icon name="check" size={16} />保存对话设置</button></div>
    </form>
    <section className={s.settingsGroup} aria-labelledby="preset-personas"><div className={s.groupHeading}><h2 id="preset-personas">人设库 <span className={s.muted}>{personas.length}/{DZMM_PERSONA_LIMIT}</span></h2><button type="button" className={s.outline} disabled={personas.length >= DZMM_PERSONA_LIMIT} onClick={() => editPersona("new")}><Icon name="plus" size={16} />新建人设</button></div>
      {personas.length ? <div className={s.presetGrid}>{personas.map(persona => <article className={s.presetCard} key={persona.id}><div className={s.presetTitle}><Icon name="user" size={20} /><h2>{persona.name}</h2>{personaUsage(persona.id) > 0 && <span className={s.activeBadge}>{personaUsage(persona.id)} 个对话在用</span>}</div><p>{persona.content || "（空白人设）"}</p><div className={s.presetActions}><button className={s.iconButton} onClick={() => editPersona(persona)} aria-label={`编辑人设 ${persona.name}`}><Icon name="edit" size={17} /></button><button className={s.deleteButton} onClick={() => setDeletingPersona(persona)} aria-label={`删除人设 ${persona.name}`}>删除</button></div></article>)}</div>
        : <p className={s.muted}>还没有保存人设。为不同的故事准备不同的身份，在聊天设置里按对话选用。</p>}
    </section>
    <h2 className={s.sectionTitle}>写作预设 <span className={s.muted}>{presets.length}/30</span></h2>
    <div className={s.presetToolbar}><button className={s.primary} onClick={() => edit("new")} disabled={presets.length >= 30}><Icon name="plus" size={16} />创建预设</button><button className={s.outline} onClick={() => input.current?.click()}><Icon name="upload" size={16} />导入</button><button className={s.outline} onClick={() => downloadPresets(presets)} disabled={!presets.length}><Icon name="download" size={16} />导出</button></div>
    <section className={s.currentPreset}><span className={s.currentLabel}>当前对话预设</span><p>{preferences.preset || "尚未设置对话预设"}</p>{preferences.preset && !presets.some((preset) => preset.content === preferences.preset) && <button className={s.textButton} disabled={presets.length >= 30} onClick={() => { edit("new"); setForm({ name: "我的对话预设", content: preferences.preset }); }}>保存到预设库 <Icon name="plus" size={14} /></button>}</section>
    {presets.length ? <div className={s.presetGrid}>{presets.map((preset) => <article className={s.presetCard} key={preset.id}><div className={s.presetTitle}><Icon name="book" size={20} /><h2>{preset.name}</h2>{preset.content === preferences.preset && <span className={s.activeBadge}>使用中</span>}</div><p>{preset.content}</p><div className={s.presetActions}><button className={preset.content === preferences.preset ? s.textButton : s.primary} aria-pressed={preset.content === preferences.preset} onClick={() => { onPreferences({ ...preferences, preset: preset.content }); setNotice(`已使用「${preset.name}」。`); }}>{preset.content === preferences.preset ? "当前使用" : "使用预设"}</button><button className={s.iconButton} onClick={() => edit(preset)} aria-label={`编辑预设 ${preset.name}`}><Icon name="edit" size={17} /></button><button className={s.deleteButton} onClick={() => setDeleting(preset)} aria-label={`删除预设 ${preset.name}`}>删除</button></div></article>)}</div> : <Empty>还没有保存预设，创建一个描述你喜欢的叙事方式。</Empty>}
    {editing && <Dialog title={editing === "new" ? "创建预设" : "编辑预设"} onClose={() => setEditing(null)}><form className={s.presetEditor} onSubmit={save}><label>预设名称<input autoFocus required maxLength={80} value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} placeholder="例如：细腻的冒险叙事" /></label><label>预设内容<textarea maxLength={8000} rows={9} value={form.content} onChange={(event) => setForm((previous) => ({ ...previous, content: event.target.value }))} placeholder="写下叙事风格、角色回应方式和你希望遵守的规则" /><small>{form.content.length}/8000</small></label>{error && <p className={s.error} role="alert">{error}</p>}<div className={s.dialogActions}><button type="button" className={s.outline} onClick={() => setEditing(null)}>取消</button><button type="submit" className={s.primary}>保存预设</button></div></form></Dialog>}
    {editingPersona && <Dialog title={editingPersona === "new" ? "新建人设" : "编辑人设"} onClose={() => setEditingPersona(null)}><form className={s.presetEditor} onSubmit={savePersona}><label>人设名称<input autoFocus required maxLength={80} value={personaForm.name} onChange={(event) => setPersonaForm((previous) => ({ ...previous, name: event.target.value }))} placeholder="例如：新来的下属" /></label><label>人设内容<textarea maxLength={4000} rows={8} value={personaForm.content} onChange={(event) => setPersonaForm((previous) => ({ ...previous, content: event.target.value }))} placeholder="你的名字、身份、性格，以及与角色的关系…" /><small>{personaForm.content.length}/4000</small></label>{personaError && <p className={s.error} role="alert">{personaError}</p>}<div className={s.dialogActions}><button type="button" className={s.outline} onClick={() => setEditingPersona(null)}>取消</button><button type="submit" className={s.primary}>保存人设</button></div></form></Dialog>}
    {deletingPersona && <Dialog title="删除人设" onClose={() => setDeletingPersona(null)}><p className={s.confirmText}>删除「{deletingPersona.name}」？{personaUsage(deletingPersona.id) > 0 && `正在使用它的 ${personaUsage(deletingPersona.id)} 个对话会改用默认人设。`}</p><div className={s.dialogActions}><button className={s.outline} onClick={() => setDeletingPersona(null)}>取消</button><button className={s.danger} onClick={() => removePersona(deletingPersona)}>删除人设</button></div></Dialog>}
    {deleting && <Dialog title="删除预设" onClose={() => setDeleting(null)}><p className={s.confirmText}>删除「{deleting.name}」？{deleting.content === preferences.preset && "当前对话预设仍会保留，已有会话不受影响。"}</p><div className={s.dialogActions}><button className={s.outline} onClick={() => setDeleting(null)}>取消</button><button className={s.danger} onClick={() => { onPreferences({ ...preferences, presets: presets.filter((preset) => preset.id !== deleting.id) }); setDeleting(null); setNotice("预设已删除。"); }}>删除预设</button></div></Dialog>}
  </main>;
}
