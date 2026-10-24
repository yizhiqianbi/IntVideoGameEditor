"use client";

import { DZMM_OFFERED_MODEL_OPTIONS, normalizeDzmmModelSelection } from "../../lib/dzmm-models";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";

/* eslint-disable @next/next/no-img-element -- Character covers are imported media assets. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getDzmmCharacterPreviewText } from "@/lib/dzmm-character-presentation";
import type { Character } from "@/lib/dzmm-characters";
import type { DzmmPreferences, DzmmSavedConversation, DzmmSavedPreset } from "@/lib/dzmm-storage";
import type { DzmmAuthor } from "@/lib/dzmm-discovery";
import { XUMENG_LOCALES, xumengLocaleLabel } from "@/lib/xumeng-i18n";
import { changeDzmmPassword } from "@/lib/dzmm-account";
import { fetchDzmmReferral, type DzmmReferralInfo } from "@/lib/dzmm-referral";
import { DreamCoinPanel } from "./dream-coin-panel";
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
  onEditProfile: () => void; onSettings: () => void; onPresets: () => void; onRecharge?: () => void;
  onInvite?: () => void;
  onDeleteCharacter?: (character: Character) => void; onAdmin?: () => void;
};

export function ProfileView({ user, characters, custom, favorites, conversations, authors, preferences, onCharacter, onAuthor, onConversation, onEditCharacter, onCreateCharacter, onEditProfile, onSettings, onPresets, onRecharge, onInvite, onDeleteCharacter, onAdmin }: ProfileViewProps) {
  const [tab, setTab] = useState<"timeline" | "characters" | "favorites" | "conversations" | "following">("characters");
  const [copyStatus, setCopyStatus] = useState("");
  const [deleting, setDeleting] = useState<Character | null>(null);
  const followed = authors.filter((author) => preferences.followedAuthors?.includes(author.id));
  const favoriteRoles = characters.filter((character) => favorites.includes(character.id));
  const events = [
    ...custom.map((character) => ({ id: `role-${character.id}`, text: `创建了角色「${character.name}」`, date: Date.parse(character.createdAt), action: () => onCharacter(character) })),
    ...conversations.map((conversation) => ({ id: `chat-${conversation.id}`, text: `与「${conversation.title}」继续了故事`, date: conversation.updatedAt, action: () => onConversation(conversation) })),
  ].filter((event) => Number.isFinite(event.date)).sort((a, b) => b.date - a.date);
  async function copyId() { if (!user) return; try { await navigator.clipboard.writeText(user.id); setCopyStatus("用户 ID 已复制。"); } catch { setCopyStatus("复制失败，请选择 ID 手动复制。"); } }
  return <main className={s.page}>
    <header className={s.profileHero}>
      <span className={s.avatar}>{Array.from(preferences.nickname)[0] ?? ""}</span>
      <div className={s.profileInfo}><h1>{preferences.nickname}</h1>{user && <button className={s.idButton} onClick={() => void copyId()} aria-label="复制用户 ID">ID：{user.id}<Icon name="copy" size={13} /></button>}
        <p>{user ? user.isGuest ? "游客账号" : user.email || "已登录" : "本地离线"}{dateLabel(user?.createdAt) && ` · ${dateLabel(user?.createdAt)} 加入`}</p>
        {preferences.bio && <p className={s.bio}>{preferences.bio}</p>}
        {preferences.gender && <span className={s.gender}>{preferences.gender === "male" ? "男" : preferences.gender === "female" ? "女" : "其他"}</span>}
      </div>
      <button className={s.outline} onClick={onEditProfile}><Icon name="edit" size={16} />编辑资料</button>
    </header>
    {copyStatus && <p className={s.status} role="status">{copyStatus}</p>}
    {XUMENG_PAYMENTS_ENABLED && onInvite && <section className={s.referralCard}><div className={s.referralHeading}><div><span className={s.referralEyebrow}>邀请好友</span><h2>分享链接，获得 Credit 和梦币</h2></div></div><p>注册奖励、微信支付返利和邀请码写在邀请页。</p><button type="button" className={s.outline} onClick={onInvite}>打开邀请页</button></section>}
    {XUMENG_PAYMENTS_ENABLED && user && !user.isGuest && <DreamCoinPanel userId={user.id} />}
    <div className={s.stats}><button onClick={() => setTab("characters")}><strong>{custom.length}</strong><span>角色</span></button><button onClick={() => setTab("favorites")}><strong>{favorites.length}</strong><span>收藏</span></button><button onClick={() => setTab("conversations")}><strong>{conversations.length}</strong><span>会话</span></button><button onClick={() => setTab("following")}><strong>{preferences.followedAuthors?.length ?? 0}</strong><span>关注</span></button></div>
    <div className={s.quickLinks}><button onClick={onCreateCharacter}><Icon name="plus" size={17} />创建角色</button><button onClick={onPresets}><Icon name="book" size={17} />我的预设</button>{XUMENG_PAYMENTS_ENABLED && onRecharge && <button onClick={onRecharge}><Icon name="crown" size={17} />{XUMENG_PAYMENTS_ENABLED ? "充值与 VIP" : "余额与权益"}</button>}<button onClick={onSettings}><Icon name="sliders" size={17} />设置</button>{user?.role === "super" && onAdmin && <button onClick={onAdmin}><Icon name="grid" size={17} />管理</button>}</div>
    <div className={s.tabs} role="tablist" aria-label="我的内容">{([{ id: "timeline", label: "时间线" }, { id: "characters", label: "角色" }, { id: "favorites", label: "收藏" }, { id: "conversations", label: "会话" }, { id: "following", label: "关注" }] as const).map((item) => <button role="tab" aria-selected={tab === item.id} key={item.id} className={tab === item.id ? s.activeTab : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {tab === "timeline" && (events.length ? <div className={s.timeline}>{events.map((event) => <button key={event.id} onClick={event.action}><span className={s.timelineDot} /><span><time>{dateLabel(event.date)}</time><strong>{event.text}</strong></span><Icon name="chevron" size={16} /></button>)}</div> : <Empty>还没有活动记录，创建角色或开始一段故事吧。</Empty>)}
    {(tab === "characters" || tab === "favorites") && ((tab === "characters" ? custom : favoriteRoles).length ? <div className={s.roleList}>{(tab === "characters" ? custom : favoriteRoles).map((character) => <article key={character.id} className={s.roleRow}><button className={s.roleCover} onClick={() => onCharacter(character)} aria-label={`查看 ${character.name}`}><img src={character.cover} alt={character.name} /></button><button className={s.roleText} onClick={() => onCharacter(character)}><h2>{character.name}</h2><p>{getDzmmCharacterPreviewText(character, preferences.nickname)}</p><small>{character.author}</small></button>{tab === "characters" && <div className={s.roleActions}><button className={s.iconButton} onClick={() => onEditCharacter(character)} aria-label={`编辑 ${character.name}`}><Icon name="edit" size={17} /></button>{onDeleteCharacter && <button className={s.deleteButton} onClick={() => setDeleting(character)} aria-label={`删除 ${character.name}`}>删除</button>}</div>}</article>)}</div> : <Empty>{tab === "characters" ? "还没有创建角色，把脑海里的故事带到这里。" : "还没有收藏角色，遇见喜欢的角色时点击爱心。"}</Empty>)}
    {tab === "conversations" && (conversations.length ? <div className={s.conversations}>{conversations.map((conversation) => <button key={conversation.id} onClick={() => onConversation(conversation)}><Icon name="chat" size={20} /><span><strong>{conversation.title}</strong><small>{conversation.messages.at(-1)?.content || "还没有发送消息"}</small></span><time>{dateLabel(conversation.updatedAt)}</time></button>)}</div> : <Empty>还没有会话，选一个角色开始对话。</Empty>)}
    {tab === "following" && (followed.length ? <div className={s.authorList}>{followed.map((author) => <button key={author.id} onClick={() => onAuthor(author)}><span className={s.smallAvatar}>{Array.from(author.name)[0] ?? ""}</span><span><strong>{author.name}</strong><small>{author.characterIds.length} 个已收录作品</small></span><Icon name="chevron" size={16} /></button>)}</div> : <Empty>还没有关注作者，进入作者主页即可关注。</Empty>)}
    {deleting && <Dialog title="删除角色" onClose={() => setDeleting(null)}><p className={s.confirmText}>删除「{deleting.name}」及它的收藏和关联会话？此操作无法撤销。</p><div className={s.dialogActions}><button className={s.outline} onClick={() => setDeleting(null)}>取消</button><button className={s.danger} onClick={() => { onDeleteCharacter?.(deleting); setDeleting(null); }}>删除角色</button></div></Dialog>}
  </main>;
}

export function InviteCenter({ user, onBack, onRegister, onWallet }: {
  user: DzmmProfileUser | null; onBack: () => void; onRegister: () => void; onWallet: () => void;
}) {
  const [referral, setReferral] = useState<DzmmReferralInfo | null>(null);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    let active = true;
    if (!user || user.isGuest) return () => { active = false; };
    void fetchDzmmReferral().then(value => { if (active && value.accountId === user.id) setReferral(value); }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : "邀请码暂时无法加载。");
    });
    return () => { active = false; };
  }, [user]);
  const reward = referral?.rewardPoints ?? 500;
  async function copy(value: string, success: string) {
    try { await navigator.clipboard.writeText(value); setCopyStatus(success); }
    catch { setCopyStatus(`复制失败，请手动复制：${value}`); }
  }
  return <main className={s.page}>
    <header className={s.pageHeading}>
      <button type="button" className={s.outline} onClick={onBack}>返回</button>
      <div><h1>邀请好友</h1><p className={s.lead}>把专属链接发给朋友。朋友注册并充值后，奖励记在你的账上。</p></div>
    </header>
    <section className={s.referralCard} aria-label="邀请如何运作">
      <div className={s.referralHeading}><div><span className={s.referralEyebrow}>如何运作</span><h2>三步获得 Credit 和梦币</h2></div><strong>+{reward} Credit/人</strong></div>
      <ol className={s.steps}>
        <li>分享你的专属链接。朋友打开后，注册页会带上邀请码。</li>
        <li>朋友完成注册，你获得 {reward} Credit，记入聊天余额。邀请码不能用于邀请自己。</li>
        <li>朋友之后用微信支付充值或开通会员，实付金额记入梦币：注册后 10 天内按 20%，之后按 10%。梦币可兑换 Credit，也可申请提现。</li>
      </ol>
    </section>
    {!user || user.isGuest ? <section className={s.referralCard}><h2>注册后获得邀请链接</h2><p>游客账号没有邀请码。注册正式账号后，才能把链接发给朋友。</p><button type="button" className={s.primary} onClick={onRegister}>注册并获取邀请码</button></section>
      : error ? <p className={s.error} role="alert">{error}</p>
      : referral ? <section className={s.referralCard} aria-label="我的邀请">
        <div className={s.referralHeading}><div><span className={s.referralEyebrow}>我的邀请</span><h2>链接和邀请码</h2></div></div>
        <div className={s.referralCode}><span>邀请链接</span><code className={s.referralLink}>{referral.inviteUrl}</code><button type="button" className={s.outline} disabled={!referral.inviteUrl} onClick={() => referral.inviteUrl && void copy(referral.inviteUrl, "邀请链接已复制。")}><Icon name="copy" size={14} />复制链接</button></div>
        <div className={s.referralCode}><span>邀请码</span><code>{referral.inviteCode}</code><button type="button" className={s.outline} disabled={!referral.inviteCode} onClick={() => referral.inviteCode && void copy(referral.inviteCode, "邀请码已复制，粘贴到注册表单即可。")}><Icon name="copy" size={14} />复制邀请码</button></div>
        <div className={s.referralStats}><span>已邀请 <strong>{referral.invitedCount}</strong> 人</span><span>累计获得 <strong>{referral.earnedPoints}</strong> Credit</span></div>
      </section> : <p className={s.lead}>正在读取邀请码…</p>}
    {copyStatus && <p className={s.status} role="status">{copyStatus}</p>}
    <p className={s.lead}>梦币余额、兑换和提现记录在个人主页。<button type="button" className={s.textLink} onClick={onWallet}>查看梦币</button></p>
  </main>;
}

export type ProfileSettingsProps = {
  user: DzmmProfileUser | null; preferences: DzmmPreferences;
  onPreferences: (preferences: DzmmPreferences) => void; onBack: () => void;
  onPasswordChanged?: (accountId: string) => void;
};

export function ProfileSettings({ user, preferences, onPreferences, onBack, onPasswordChanged }: ProfileSettingsProps) {
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
      <section className={s.settingsSection}><h2>对话</h2><label>回复语言<select aria-label="回复语言" value={form.locale ?? "zh-Hans"} onChange={(event) => update("locale", event.target.value as DzmmPreferences["locale"])}>{XUMENG_LOCALES.map(locale => <option key={locale} value={locale}>{xumengLocaleLabel(locale)}</option>)}</select><small>界面标签和角色回复会使用此语言；角色卡原文与用户输入保持不变。</small></label><label>我的身份<textarea rows={3} maxLength={4000} placeholder="角色如何称呼你？你的身份和背景是什么？" value={form.persona} onChange={(event) => update("persona", event.target.value)} /></label><label>对话模型<select aria-label="对话模型" value={normalizeDzmmModelSelection(form.model)} onChange={(event) => update("model", event.target.value as DzmmPreferences["model"])}>{DZMM_OFFERED_MODEL_OPTIONS.map(item => <option key={item.id} value={item.id}>{item.label} · {item.description}</option>)}</select></label><label>回复长度上限<select value={form.maxTokens ?? 2048} onChange={(event) => update("maxTokens", Number(event.target.value))}>{[256, 512, 1024, 2048, 4096].map((amount) => <option key={amount} value={amount}>{amount} tokens</option>)}{form.maxTokens && ![256, 512, 1024, 2048, 4096].includes(form.maxTokens) && <option value={form.maxTokens}>{form.maxTokens} tokens</option>}</select><small>模型回复可提前结束；这里只限制最长回复。</small></label><label>当前对话预设<textarea maxLength={8000} rows={5} value={form.preset} onChange={(event) => update("preset", event.target.value)} /></label></section>
      <section className={s.settingsSection}><h2>内容屏蔽</h2><label>屏蔽标签<textarea aria-label="屏蔽标签" rows={4} maxLength={2050} placeholder="每行一个标签，例如：某个题材" value={blockedText} onChange={(event) => { setBlockedText(event.target.value); setNotice(""); }} /><small>目录和搜索会隐藏包含这些标签的角色。最多 50 个，每个最多 40 字。</small></label></section>
      {error && <p className={s.error} role="alert">{error}</p>}{notice && <p className={s.status} role="status">{notice}</p>}<div className={s.saveRow}><button type="submit" className={s.primary}><Icon name="check" size={16} />保存设置</button></div>
    </form>
    <section className={s.settingsSection}><h2>账号安全</h2>{!user || user.isGuest ? <p className={s.muted}>注册并登录正式账号后，可以在这里修改密码。</p> : <form className={s.settingsForm} onSubmit={(event) => void changePassword(event)}>{needsPassword && <p className={s.muted}>邮箱已验证，当前账号尚未设置密码。设置后可使用邮箱与密码登录。</p>}{!needsPassword && <label>当前密码<input type="password" autoComplete="current-password" required maxLength={256} disabled={passwordBusy} value={passwords.current} onChange={(event) => setPasswords((previous) => ({ ...previous, current: event.target.value }))} /></label>}<label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={passwordBusy} value={passwords.next} onChange={(event) => setPasswords((previous) => ({ ...previous, next: event.target.value }))} /><small>至少 12 个字符。</small></label><label>确认新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} disabled={passwordBusy} value={passwords.confirm} onChange={(event) => setPasswords((previous) => ({ ...previous, confirm: event.target.value }))} /></label>{passwordError && <p className={s.error} role="alert">{passwordError}</p>}{passwordNotice && <p className={s.status} role="status">{passwordNotice}</p>}<button type="submit" className={s.outline} disabled={passwordBusy}>{passwordBusy ? "正在保存…" : needsPassword ? "设置密码" : "修改密码"}</button></form>}</section>
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
    <div className={s.pageHeading}><button className={s.back} onClick={onBack}><Icon name="back" size={18} />返回</button><h1>我的预设</h1><span className={s.muted}>{presets.length}/30</span></div>
    <div className={s.presetToolbar}><button className={s.primary} onClick={() => edit("new")} disabled={presets.length >= 30}><Icon name="plus" size={16} />创建预设</button><button className={s.outline} onClick={() => input.current?.click()}><Icon name="upload" size={16} />导入</button><button className={s.outline} onClick={() => downloadPresets(presets)} disabled={!presets.length}><Icon name="download" size={16} />导出</button></div>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
    {notice && <p className={s.status} role="status">{notice}</p>}
    <section className={s.currentPreset}><span className={s.currentLabel}>当前对话预设</span><p>{preferences.preset || "尚未设置对话预设"}</p>{preferences.preset && !presets.some((preset) => preset.content === preferences.preset) && <button className={s.textButton} disabled={presets.length >= 30} onClick={() => { edit("new"); setForm({ name: "我的对话预设", content: preferences.preset }); }}>保存到预设库 <Icon name="plus" size={14} /></button>}</section>
    {presets.length ? <div className={s.presetGrid}>{presets.map((preset) => <article className={s.presetCard} key={preset.id}><div className={s.presetTitle}><Icon name="book" size={20} /><h2>{preset.name}</h2>{preset.content === preferences.preset && <span className={s.activeBadge}>使用中</span>}</div><p>{preset.content}</p><div className={s.presetActions}><button className={preset.content === preferences.preset ? s.textButton : s.primary} aria-pressed={preset.content === preferences.preset} onClick={() => { onPreferences({ ...preferences, preset: preset.content }); setNotice(`已使用「${preset.name}」。`); }}>{preset.content === preferences.preset ? "当前使用" : "使用预设"}</button><button className={s.iconButton} onClick={() => edit(preset)} aria-label={`编辑预设 ${preset.name}`}><Icon name="edit" size={17} /></button><button className={s.deleteButton} onClick={() => setDeleting(preset)} aria-label={`删除预设 ${preset.name}`}>删除</button></div></article>)}</div> : <Empty>还没有保存预设，创建一个描述你喜欢的叙事方式。</Empty>}
    {editing && <Dialog title={editing === "new" ? "创建预设" : "编辑预设"} onClose={() => setEditing(null)}><form className={s.presetEditor} onSubmit={save}><label>预设名称<input autoFocus required maxLength={80} value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} placeholder="例如：细腻的冒险叙事" /></label><label>预设内容<textarea maxLength={8000} rows={9} value={form.content} onChange={(event) => setForm((previous) => ({ ...previous, content: event.target.value }))} placeholder="写下叙事风格、角色回应方式和你希望遵守的规则" /><small>{form.content.length}/8000</small></label>{error && <p className={s.error} role="alert">{error}</p>}<div className={s.dialogActions}><button type="button" className={s.outline} onClick={() => setEditing(null)}>取消</button><button type="submit" className={s.primary}>保存预设</button></div></form></Dialog>}
    {deleting && <Dialog title="删除预设" onClose={() => setDeleting(null)}><p className={s.confirmText}>删除「{deleting.name}」？{deleting.content === preferences.preset && "当前对话预设仍会保留，已有会话不受影响。"}</p><div className={s.dialogActions}><button className={s.outline} onClick={() => setDeleting(null)}>取消</button><button className={s.danger} onClick={() => { onPreferences({ ...preferences, presets: presets.filter((preset) => preset.id !== deleting.id) }); setDeleting(null); setNotice("预设已删除。"); }}>删除预设</button></div></Dialog>}
  </main>;
}
