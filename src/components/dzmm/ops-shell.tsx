"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { dzmmCloudRequest, type DzmmCloudUser } from "@/lib/dzmm-cloud";
import AdminDashboard, { type AdminSection } from "./admin-dashboard";
import FeedbackInbox from "./feedback-inbox";
import ForumView from "./forum-view";
import OpsConsole, { type OpsView } from "./ops-console";
import s from "./ops-shell.module.css";

const SECTIONS = ["analytics", "users", "recharges", "packages", "subscriptions", "banners", "characters", "reviews", "forum", "orientations", "subtags", "voices", "usage", "prices", "audit", "feedback"] as const;
type Section = typeof SECTIONS[number];
type Ready = { status: "ready"; user: DzmmCloudUser; preview: boolean };
type Phase = { status: "loading" } | { status: "login"; error: string } | { status: "forbidden"; nickname: string } | Ready;
type Entry = { id: Section; label: string; group: string; sub: boolean; eyebrow: string; description: string };

const ENTRIES: Entry[] = [
  { id: "analytics", label: "数据看板", group: "", sub: false, eyebrow: "OVERVIEW", description: "按日期查看已有的访问、对话和积分。缺打点的格子留空。" },
  { id: "users", label: "用户列表", group: "", sub: false, eyebrow: "USERS", description: "查找账号，调整积分或 Super 权限。" },
  { id: "recharges", label: "充值记录", group: "资金管理", sub: true, eyebrow: "FINANCE", description: "查看用户实付的充值订单。手续费尚未配置。" },
  { id: "packages", label: "充值套餐", group: "资金管理", sub: true, eyebrow: "FINANCE", description: "维护前台可购买的充值套餐。" },
  { id: "subscriptions", label: "VIP 会员", group: "资金管理", sub: true, eyebrow: "FINANCE", description: "查看会员有效期和积分领取记录。" },
  { id: "banners", label: "Banner 管理", group: "", sub: false, eyebrow: "CONTENT", description: "管理首页横幅的文案、链接和图片。" },
  { id: "characters", label: "官方角色", group: "角色管理", sub: true, eyebrow: "ROLES", description: "新建、编辑和上下架叙梦官方角色。" },
  { id: "reviews", label: "公开审核", group: "角色管理", sub: true, eyebrow: "ROLES", description: "处理用户公开角色。通过和拒绝走原来的审核接口。" },
  { id: "forum", label: "论坛", group: "角色管理", sub: true, eyebrow: "ROLES", description: "处理论坛主题、回复和举报。" },
  { id: "orientations", label: "性向", group: "标签管理", sub: true, eyebrow: "TAGS", description: "维护角色使用的性向。" },
  { id: "subtags", label: "子标签", group: "标签管理", sub: true, eyebrow: "TAGS", description: "维护性向下的子标签。" },
  { id: "voices", label: "语音", group: "标签管理", sub: true, eyebrow: "TAGS", description: "查看和启停可选音色。" },
  { id: "usage", label: "语言模型", group: "积分消耗设置", sub: true, eyebrow: "CREDITS", description: "查看模型用量、积分消费和供应商成本。" },
  { id: "prices", label: "功能单价", group: "积分消耗设置", sub: true, eyebrow: "CREDITS", description: "设置功能积分和模型单价。" },
  { id: "audit", label: "操作记录", group: "", sub: false, eyebrow: "AUDIT", description: "核对管理员的积分调整和权限变更。" },
  { id: "feedback", label: "群反馈", group: "", sub: false, eyebrow: "FEEDBACK", description: "查看 Telegram 群里的反馈和处理判断。" },
];

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}
function readSection(): Section {
  const name = window.location.hash.replace(/^#/, "").split("/")[0] ?? "";
  return isSection(name) ? name : "analytics";
}
function readUser(value: unknown): DzmmCloudUser | null {
  if (!value || typeof value !== "object") return null;
  const session = value as { user?: unknown; authenticated?: unknown };
  if (session.user === null && session.authenticated === false) return null;
  if (!session.user || typeof session.user !== "object") return null;
  const user = session.user as Partial<DzmmCloudUser>;
  if (typeof user.id !== "string" || typeof user.nickname !== "string" || typeof user.isGuest !== "boolean") return null;
  if (user.role !== "user" && user.role !== "super") return null;
  if (user.email !== null && typeof user.email !== "string") return null;
  return { id: user.id, email: user.email ?? null, nickname: user.nickname, isGuest: user.isGuest, role: user.role };
}
function isOps(section: Section): section is OpsView {
  return section === "analytics" || section === "recharges" || section === "packages" || section === "banners" || section === "characters" || section === "reviews" || section === "orientations" || section === "subtags" || section === "voices" || section === "prices";
}
function isAdmin(section: Section): section is AdminSection {
  return section === "users" || section === "subscriptions" || section === "usage" || section === "audit";
}

export default function OpsShell() {
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [section, setSection] = useState<Section>("analytics");
  const [postId, setPostId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const requireLogin = useCallback((error = "账号会话已失效，请重新登录。") => {
    setPhase({ status: "login", error });
  }, []);

  useEffect(() => {
    const apply = () => {
      const next = readSection();
      if (window.location.hash !== `#${next}`) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${next}`);
      setSection(next);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  useEffect(() => {
    let alive = true;
    void dzmmCloudRequest<unknown>("/session").then(value => {
      if (!alive) return;
      const user = readUser(value);
      if (import.meta.env.DEV && user?.id === "local-preview-guest") {
        setPhase({ status: "ready", user: { id: user.id, email: null, nickname: "本地预览", isGuest: false, role: "super" }, preview: true });
        return;
      }
      if (!user || user.isGuest) { setPhase({ status: "login", error: "" }); return; }
      if (user.role !== "super") { setPhase({ status: "forbidden", nickname: user.nickname }); return; }
      setPhase({ status: "ready", user, preview: false });
    }).catch(error => {
      if (!alive) return;
      setPhase({ status: "login", error: error instanceof Error ? error.message : "账号状态暂时读不出来。" });
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (section !== "forum") setPostId(null); }, [section]);

  function open(id: Section) {
    if (window.location.hash === `#${id}`) setSection(id);
    else window.location.hash = id;
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await dzmmCloudRequest("/auth/login", "POST", { email: email.trim(), password });
      const user = readUser(await dzmmCloudRequest<unknown>("/session"));
      if (!user || user.isGuest) { setPhase({ status: "login", error: "登录没有完成，请再试一次。" }); return; }
      if (user.role !== "super") { setPhase({ status: "forbidden", nickname: user.nickname }); return; }
      setPassword("");
      setPhase({ status: "ready", user, preview: false });
    } catch (error) {
      setPhase({ status: "login", error: error instanceof Error ? error.message : "登录失败，请重试。" });
    } finally { setBusy(false); }
  }

  if (phase.status === "loading") return <main className={s.gate}><p>正在确认账号…</p></main>;
  if (phase.status === "login") return <main className={s.gate}><form className={s.card} onSubmit={login}><div className={s.mark} aria-hidden="true">叙</div><h1>叙梦</h1><p>运营管理中心。使用 Super 账号登录。</p>{phase.error ? <p className={s.error} role="alert">{phase.error}</p> : null}<label>邮箱<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label><button className={s.submit} type="submit" disabled={busy}>{busy ? "正在登录…" : "登录"}</button></form></main>;
  if (phase.status === "forbidden") return <main className={s.gate}><section className={s.card}><h1>需要 Super 权限</h1><p>{phase.nickname} 可以浏览叙梦，还不能进入运营管理中心。</p><a className={s.link} href="/">回前台</a></section></main>;
  return <Console phase={phase} section={section} postId={postId} onPost={setPostId} onOpen={open} onRequireLogin={() => requireLogin()} />;
}

function Console({ phase, section, postId, onPost, onOpen, onRequireLogin }: { phase: Ready; section: Section; postId: string | null; onPost: (id: string | null) => void; onOpen: (id: Section) => void; onRequireLogin: () => void }) {
  const entry = ENTRIES.find(item => item.id === section) ?? ENTRIES[0];
  const initial = Array.from(phase.user.nickname)[0] ?? "叙";
  let shownGroup = "";
  return <div className={s.shell}>
    <aside className={s.sidebar}>
      <div className={s.brand}><span className={s.mark}>叙</span><div>叙梦<small>运营管理中心</small></div></div>
      <nav className={s.nav} aria-label="运营栏目">{ENTRIES.map(item => {
        const label = item.group && item.group !== shownGroup ? item.group : "";
        if (item.group) shownGroup = item.group;
        return <span key={item.id}>{label ? <div className={s.group}>{label}</div> : null}<button type="button" className={item.sub ? s.sub : s.item} aria-current={item.id === section ? "page" : undefined} onClick={() => onOpen(item.id)}>{item.label}</button></span>;
      })}</nav>
      <div className={s.foot}><span className={s.avatar}>{initial}</span><div>{phase.user.nickname}<small>叙梦运营</small></div></div>
    </aside>
    <div className={s.workspace}>
      <header className={s.topbar}><div className={s.crumb}>工作空间 / <b>{entry.label}</b></div><a className={s.back} href="/">回前台</a></header>
      <main className={s.content}>
        <div className={s.heading}><div><p className={s.eyebrow}>{entry.eyebrow}</p><h1>{entry.label}</h1><p>{entry.description}</p></div></div>
        {phase.preview ? <p className={s.preview}>本地预览没有 Super 会话，栏目里会提示账号无效。在线上登录 Super 后打开 /ops，这里就是真实数据。</p> : null}
        <SectionBody section={section} user={phase.user} postId={postId} onPost={onPost} onOpen={onOpen} onRequireLogin={phase.preview ? () => undefined : onRequireLogin} />
      </main>
    </div>
  </div>;
}

function SectionBody({ section, user, postId, onPost, onOpen, onRequireLogin }: { section: Section; user: DzmmCloudUser; postId: string | null; onPost: (id: string | null) => void; onOpen: (id: Section) => void; onRequireLogin: () => void }) {
  if (isOps(section)) return <OpsConsole accountId={user.id} view={section} onUnauthorized={onRequireLogin} />;
  if (isAdmin(section)) return <AdminDashboard user={user} section={section} onRequireAccount={onRequireLogin} onOpenSection={onOpen} />;
  if (section === "forum") return <ForumView userId={user.id} isGuest={false} isSuper nickname={user.nickname} postId={postId ?? undefined} onPostChange={onPost} onRequireAccount={onRequireLogin} characters={[]} onCharacter={character => { window.location.assign(`/#character/${encodeURIComponent(character.id)}`); }} />;
  if (section === "feedback") return <FeedbackInbox accountId={user.id} onRequireAccount={onRequireLogin} />;
  const unreachable: never = section;
  return unreachable;
}
