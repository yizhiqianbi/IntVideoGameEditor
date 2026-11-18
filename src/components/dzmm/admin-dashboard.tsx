"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { DzmmCloudUser } from "@/lib/dzmm-cloud";
import {
  adjustDzmmAdminCredits, changeDzmmAdminRole, deleteDzmmAdminBanner, DzmmAdminError, fetchDzmmAdminAudit, fetchDzmmAdminBanners, fetchDzmmAdminCheckin,
  fetchDzmmAdminOrders, fetchDzmmAdminOverview, fetchDzmmAdminSubscriptions, fetchDzmmAdminUsage, fetchDzmmAdminUsers, saveDzmmAdminBanner, saveDzmmAdminCheckin,
  type DzmmAdminBanner,
  type DzmmAdminAudit, type DzmmAdminOrder, type DzmmAdminOverview, type DzmmAdminPage,
  type DzmmAdminRole, type DzmmAdminSubscription, type DzmmAdminUsage, type DzmmAdminUser,
} from "@/lib/dzmm-admin-client";
import type { XumengLocale } from "@/lib/xumeng-i18n";
import { xumengStudio, xumengStudioFill } from "@/lib/xumeng-studio-copy";
import Icon, { type IconName } from "./icons";
import FeedbackInbox from "./feedback-inbox";
import OpsConsole from "./ops-console";
import s from "./admin-dashboard.module.css";

type Tab = "overview" | "users" | "subscriptions" | "orders" | "usage" | "audit" | "publishing" | "forum" | "feedback" | "ops";
export type AdminSection = "users" | "subscriptions" | "usage" | "audit";
type Data = { kind: "overview"; value: DzmmAdminOverview } | { kind: "users"; value: DzmmAdminPage<DzmmAdminUser> }
  | { kind: "subscriptions"; value: DzmmAdminPage<DzmmAdminSubscription> } | { kind: "orders"; value: DzmmAdminPage<DzmmAdminOrder> }
  | { kind: "usage"; value: DzmmAdminPage<DzmmAdminUsage> } | { kind: "audit"; value: DzmmAdminPage<DzmmAdminAudit> };
type Remote = { accountId: string; tab: Tab; loading: boolean; error: string; data: Data | null; fetchedAt: number | null };
type Action = { accountId: string; kind: "credits" | "role"; user: DzmmAdminUser; requestId: string; delta: string; role: DzmmAdminRole; reason: string; confirmed: boolean; attempted: boolean };
export type AdminDashboardProps = {
  user: DzmmCloudUser | null; onRequireAccount: () => void;
  publishingReview?: ReactNode; forumModeration?: ReactNode;
  onAccountChanged?: () => void;
  section?: AdminSection;
  onOpenSection?: (section: AdminSection) => void;
  locale?: XumengLocale;
};
const TABS: { id: Tab; label: string; icon: IconName; description: string }[] = [
  { id: "overview", label: "概览", icon: "grid", description: "当日访问、游客占比、Credit 与待处理事项" },
  { id: "users", label: "用户与权限", icon: "users", description: "查找账号，调整 Credit 或 Super 权限" },
  { id: "subscriptions", label: "VIP 会员", icon: "crown", description: "查看会员有效期和 Credit 领取记录" },
  { id: "orders", label: "支付订单", icon: "wallet", description: "查看充值与 VIP 订单状态" },
  { id: "usage", label: "模型用量", icon: "sparkles", description: "查看 Token 用量、Credit 消费与供应商成本" },
  { id: "audit", label: "操作记录", icon: "book", description: "核对管理员权限与 Credit 调整" },
  { id: "publishing", label: "角色审核", icon: "check", description: "审核用户提交的公开角色" },
  { id: "forum", label: "论坛管理", icon: "chat", description: "处理主题、回复与举报" },
  { id: "feedback", label: "群反馈", icon: "chat", description: "查看 Telegram 群里的反馈，保存你的处理判断" },
  { id: "ops", label: "运营", icon: "sliders", description: "套餐、单价、标签、官方角色、充值与看板" },
];
const LIMIT = 20;
const number = (v: number) => v.toLocaleString("zh-CN");
function shanghaiInput(value: string) {
  if (!value) return undefined;
  const parsed = Date.parse(`${value}:00+08:00`);
  return Number.isFinite(parsed) ? parsed : undefined;
}
const date = (v: number | null) => v === null ? "—" : new Date(v).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const money = (v: number, currency: string, amountScale?: 2 | 6) => currency === "usdt"
  ? amountScale === 6 ? `${number(Math.floor(v / 1_000_000))}.${String(v % 1_000_000).padStart(6, "0")} USDT` : "—"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency.toUpperCase() }).format(v / 100);
const roleLabel = (role: DzmmAdminRole) => role === "super" ? "Super" : "普通用户";
const provider = (v: string) => ({ zpay: "Z-Pay", stripe: "Stripe", subscription: "VIP 订阅", nowpayments: "NOWPayments" }[v] ?? v);
const statusLabel = (v: string) => ({ active: "生效中", scheduled: "等待生效", expired: "已到期", revoked: "已撤销", pending: "待处理", paid: "已支付", failed: "失败", refunded: "已退款", partially_refunded: "部分退款", reserved: "已预留", settled: "已结算", released: "已释放" }[v] ?? v);
const errorMessage = (v: unknown, fallback: string) => v instanceof Error ? v.message : fallback;

function AccountCell({ name, id }: { name: string; id: string }) {
  return <div className={s.accountCell}><strong>{name}</strong><code title={id}>{id}</code></div>;
}
function Status({ value, text }: { value: string; text: string }) { return <span className={s.status} data-status={value}>{text}</span>; }
function Table({ headers, children, label, tableClass }: { headers: string[]; children: ReactNode; label: string; tableClass?: string }) {
  return <div className={s.tableScroll} role="region" aria-label={label} tabIndex={0}><table className={tableClass ? `${s.table} ${tableClass}` : s.table}><thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export default function AdminDashboard({ user, onRequireAccount, publishingReview, forumModeration, onAccountChanged, section, onOpenSection, locale = "zh-Hans" }: AdminDashboardProps) {
  const c = xumengStudio(locale);
  const tabText: Record<Tab, { label: string; description: string }> = {
    overview: { label: c.adOverview, description: c.adOverviewBody },
    users: { label: c.adUsers, description: c.adUsersBody },
    subscriptions: { label: c.adVip, description: c.adVipBody },
    orders: { label: c.adOrders, description: c.adOrdersBody },
    usage: { label: c.adUsage, description: c.adUsageBody },
    audit: { label: c.adAudit, description: c.adAuditBody },
    publishing: { label: c.adReview, description: c.adReviewBody },
    forum: { label: c.adForum, description: c.adForumBody },
    feedback: { label: c.adFeedback, description: c.adFeedbackBody },
    ops: { label: c.adOps, description: c.adOpsBody },
  };
  const statusText = (value: string) => ({ active: c.adActive, scheduled: c.adScheduled, expired: c.adExpired, revoked: c.adRevoked, pending: c.adPending, paid: c.adPaid, failed: c.adFailed, refunded: c.adRefunded, partially_refunded: c.adPartial, reserved: c.adReserved, settled: c.adSettled, released: c.adReleased }[value] ?? value);
  const roleName = (role: DzmmAdminRole) => role === "super" ? "Super" : c.adUserRole;
  const channelName = (v: string) => ({ zpay: "Z-Pay", stripe: "Stripe", subscription: c.adSubscription, nowpayments: "NOWPayments" }[v] ?? v);
  const permitted = Boolean(user && !user.isGuest && user.role === "super");
  const accountId = user?.id ?? "";
  const [tab, setTab] = useState<Tab>(section ?? "overview");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | DzmmAdminRole>("");
  const [userIdInput, setUserIdInput] = useState("");
  const [accountKind, setAccountKind] = useState<"" | "guest" | "registered">("");
  const [exactId, setExactId] = useState("");
  const [inviterId, setInviterId] = useState("");
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [filters, setFilters] = useState({ q: "", role: "" as "" | DzmmAdminRole, userId: "", accountKind: "" as "" | "guest" | "registered", exactId: "", inviterId: "", from: "", to: "" });
  const [offset, setOffset] = useState(0);
  const [remote, setRemote] = useState<Remote>({ accountId, tab: "overview", loading: true, error: "", data: null, fetchedAt: null });
  const [accessError, setAccessError] = useState<{ accountId: string; status: number; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeAccountId, setNoticeAccountId] = useState(accountId);
  const [action, setAction] = useState<Action | null>(null);
  const [actionError, setActionError] = useState("");
  const [working, setWorking] = useState(false);
  const generation = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const accountRef = useRef(accountId);
  const alive = useRef(true);
  const workingRef = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const moderation = tab === "publishing" || tab === "forum" || tab === "feedback" || tab === "ops";
  const dialogOpen = action?.accountId === accountId && permitted;
  const dialogConfirmed = action?.confirmed ?? false;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; readController.current?.abort(); };
  }, []);
  useEffect(() => { if (section) setTab(section); }, [section]);
  useEffect(() => {
    if (section && accessError?.accountId === accountId && accessError.status === 401) onRequireAccount();
  }, [section, accessError, accountId, onRequireAccount]);
  useLayoutEffect(() => { accountRef.current = accountId; }, [accountId]);

  const load = useCallback(async () => {
    readController.current?.abort();
    const run = ++generation.current;
    if (!permitted || tab === "publishing" || tab === "forum" || tab === "feedback" || tab === "ops") return;
    const controller = new AbortController();
    readController.current = controller;
    setRemote({ accountId, tab, loading: true, error: "", data: null, fetchedAt: null });
    const query = { limit: LIMIT, offset, ...(filters.userId ? { userId: filters.userId } : {}) };
    try {
      let data: Data;
      if (tab === "overview") data = { kind: tab, value: await fetchDzmmAdminOverview(accountId, controller.signal) };
      else if (tab === "users") data = { kind: tab, value: await fetchDzmmAdminUsers(accountId, { limit: LIMIT, offset, q: filters.q, ...(filters.role ? { role: filters.role } : {}), ...(filters.accountKind ? { accountKind: filters.accountKind } : {}), ...(filters.exactId ? { exactId: filters.exactId } : {}), ...(filters.inviterId ? { inviterId: filters.inviterId } : {}), ...(shanghaiInput(filters.from) !== undefined ? { from: shanghaiInput(filters.from) } : {}), ...(shanghaiInput(filters.to) !== undefined ? { to: shanghaiInput(filters.to) } : {}) }, controller.signal) };
      else if (tab === "subscriptions") data = { kind: tab, value: await fetchDzmmAdminSubscriptions(accountId, query, controller.signal) };
      else if (tab === "orders") data = { kind: tab, value: await fetchDzmmAdminOrders(accountId, query, controller.signal) };
      else if (tab === "usage") data = { kind: tab, value: await fetchDzmmAdminUsage(accountId, query, controller.signal) };
      else data = { kind: tab, value: await fetchDzmmAdminAudit(accountId, query, controller.signal) };
      if (controller.signal.aborted || run !== generation.current || !alive.current || accountRef.current !== accountId) return;
      setAccessError(null);
      setRemote({ accountId, tab, loading: false, error: "", data, fetchedAt: Date.now() });
    } catch (error) {
      if (controller.signal.aborted || run !== generation.current || !alive.current || accountRef.current !== accountId) return;
      if (error instanceof DzmmAdminError && (error.status === 401 || error.status === 403)) {
        setAccessError({ accountId, status: error.status, message: error.message });
        setAction(null);
      }
      setRemote({ accountId, tab, loading: false, error: errorMessage(error, c.adActionFailed), data: null, fetchedAt: null });
    }
  }, [accountId, permitted, tab, offset, filters]);

  useEffect(() => { void load(); return () => { readController.current?.abort(); }; }, [load]);

  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !workingRef.current) { event.preventDefault(); setAction(null); setActionError(""); void load(); }
      if (event.key !== "Tab") return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
      if (!elements?.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [dialogOpen, load]);

  useEffect(() => {
    if (dialogOpen) dialog.current?.focus();
  }, [dialogOpen, dialogConfirmed]);

  function selectTab(next: Tab) { if (working) return; setTab(next); setOffset(0); setNotice(""); }
  function isAdminSection(next: Tab): next is AdminSection {
    return next === "users" || next === "subscriptions" || next === "usage" || next === "audit";
  }
  function applyFilters(event: FormEvent) {
    event.preventDefault(); setOffset(0); setFilters({ q: search.trim(), role: roleFilter, userId: userIdInput.trim(), accountKind, exactId: exactId.trim(), inviterId: inviterId.trim(), from: registeredFrom, to: registeredTo }); setNotice("");
  }
  function filterUser(target: DzmmAdminUser, next: Tab) {
    if (section && onOpenSection && isAdminSection(next)) { onOpenSection(next); return; }
    setUserIdInput(target.id); setFilters(value => ({ ...value, userId: target.id })); setOffset(0); setTab(next); setNotice("");
  }
  function openAction(kind: Action["kind"], target: DzmmAdminUser) {
    setActionError(""); setNotice("");
    setAction({ accountId, kind, user: target, requestId: crypto.randomUUID(), delta: "", role: target.role === "super" ? "user" : "super", reason: "", confirmed: false, attempted: false });
  }
  function prepareAction(event: FormEvent) {
    event.preventDefault();
    if (!action || action.accountId !== accountId) return;
    const delta = Number(action.delta), reason = action.reason.trim();
    if (!reason || reason.length > 200 || /[\r\n]/.test(reason)) { setActionError(c.adReasonRule); return; }
    if (action.kind === "credits" && (!/^-?\d+$/.test(action.delta) || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000)) {
      setActionError(c.adDeltaRule); return;
    }
    setActionError(""); setAction({ ...action, reason, confirmed: true });
  }
  async function executeAction() {
    if (!action?.confirmed || action.accountId !== accountId || workingRef.current) return;
    const current = action;
    const actingAccountId = accountId;
    workingRef.current = true; setWorking(true); setActionError(""); setAction({ ...current, attempted: true });
    const body = { accountId: actingAccountId, requestId: current.requestId, reason: current.reason };
    try {
      const result = current.kind === "credits"
        ? await adjustDzmmAdminCredits(current.user.id, { ...body, delta: Number(current.delta) })
        : await changeDzmmAdminRole(current.user.id, { ...body, role: current.role });
      if (!alive.current || accountRef.current !== actingAccountId) return;
      setAction(null);
      setNoticeAccountId(actingAccountId);
      setNotice(current.kind === "credits" ? `${xumengStudioFill(c.adCreditDone, { name: result.user.nickname, credits: number(result.user.availableCredits) })}${result.replayed ? c.adReplay : ""}`
        : `${xumengStudioFill(c.adRoleDone, { name: result.user.nickname, role: roleName(result.user.role) })}${result.replayed ? c.adReplay : ""}`);
      onAccountChanged?.();
      await load();
    } catch (error) {
      if (!alive.current || accountRef.current !== actingAccountId) return;
      if (error instanceof DzmmAdminError && (error.status === 401 || error.status === 403)) {
        setAccessError({ accountId: actingAccountId, status: error.status, message: error.message }); setAction(null);
      } else setActionError(errorMessage(error, c.adActionFailed));
    } finally { workingRef.current = false; if (alive.current) setWorking(false); }
  }
  function closeAction() {
    if (workingRef.current) return;
    if (action?.attempted) { setNoticeAccountId(accountId); setNotice(c.adRefreshed); }
    setAction(null); setActionError(""); void load();
  }

  const denied = accessError?.accountId === accountId ? accessError : null;
  if (!permitted || denied) {
    if (section) return <main className={`${s.page} ${s.embeddedPage}`}><section className={s.empty}><h2>{denied?.status === 401 ? c.adRelogin : c.adNeedSuper}</h2><p>{denied?.message ?? c.adNeedSuperBody}</p><button className={s.primary} type="button" onClick={onRequireAccount}>{c.adSignIn}</button></section></main>;
    return <main className={s.page}><header className={s.heading}><p>{c.adEyebrow}</p><h1>{c.adTitle}</h1></header><section className={s.empty}><Icon name="user" size={32} /><h2>{denied?.status === 401 ? c.adRelogin : c.adNeedSuper}</h2><p>{denied?.message ?? c.adNeedSuperBody}</p><div className={s.actions}>{(!user || user.isGuest || denied?.status === 401) && <button className={s.primary} onClick={onRequireAccount}>{c.adLogin}</button>}{permitted && <button className={s.outline} onClick={() => { setAccessError(null); void load(); }}>{c.adRecheck}</button>}</div></section></main>;
  }

  const current = remote.tab === tab && remote.accountId === accountId ? remote : { tab, loading: true, error: "", data: null, fetchedAt: null };
  const data = current.data;
  const page = data && data.kind !== "overview" ? data.value : null;
  return <main className={section ? `${s.page} ${s.embeddedPage}` : s.page}>
    {section ? null : <header className={s.heading}><div><p>{c.adEyebrow}</p><h1>{c.adTitle}</h1><span>{xumengStudioFill(c.adFull, { name: user?.nickname ?? "" })}</span></div><div className={s.headerActions}><span className={s.adminMark}><Icon name="crown" size={15} />Super</span>{!moderation && <button className={s.outline} disabled={current.loading || working} onClick={() => void load()}><Icon name="refresh" size={15} />{c.adRefresh}</button>}</div></header>}
    <div className={s.layout}>
      {section ? null : <nav className={s.navigation} aria-label={c.adNav}>{TABS.filter(item => item.id !== "publishing" || publishingReview).filter(item => item.id !== "forum" || forumModeration).map(item => <button type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} disabled={working} onClick={() => selectTab(item.id)}><Icon name={item.icon} size={17} />{tabText[item.id].label}</button>)}<p className={s.navigationNote}>{c.adNavNote}</p></nav>}
      <section className={s.workspace} aria-label={tabText[tab].label}>
        {section ? null : <div className={s.sectionHeading}><div><h2>{tabText[tab].label}</h2><p>{tabText[tab].description}</p></div>{!moderation && current.fetchedAt && <small>{xumengStudioFill(c.adUpdated, { time: date(current.fetchedAt) })}</small>}</div>}
        {notice && noticeAccountId === accountId && <p className={s.notice} role="status">{notice}</p>}
        {tab === "publishing" ? <div className={s.embedded}>{publishingReview}</div> : tab === "forum" ? <div className={s.embedded}>{forumModeration}</div> : tab === "feedback" ? <FeedbackInbox key={accountId} accountId={accountId} onRequireAccount={onRequireAccount} /> : tab === "ops" ? <OpsConsole accountId={accountId} /> : <>
          {tab !== "overview" && <form className={s.filters} onSubmit={applyFilters}>
            {tab === "users" ? <><label className={s.search}>{c.adFindUser}<input aria-label={c.adFindPh} type="search" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder={c.adFindPh} disabled={working} /></label><label>{c.adAccess}<select value={roleFilter} disabled={working} onChange={event => setRoleFilter(event.target.value as "" | DzmmAdminRole)}><option value="">{c.adAllAccess}</option><option value="user">{c.adUserRole}</option><option value="super">Super</option></select></label><label>{c.adKind}<select value={accountKind} disabled={working} onChange={event => setAccountKind(event.target.value as "" | "guest" | "registered")}><option value="">{c.adAllKinds}</option><option value="registered">{c.adRegistered}</option><option value="guest">{c.adGuest}</option></select></label><label>{c.adFullId}<input value={exactId} maxLength={36} onChange={event => setExactId(event.target.value)} disabled={working} /></label><label>{c.adInviter}<input value={inviterId} maxLength={36} onChange={event => setInviterId(event.target.value)} disabled={working} /></label><label>{c.adFrom}<input type="datetime-local" value={registeredFrom} onChange={event => setRegisteredFrom(event.target.value)} disabled={working} /></label><label>{c.adTo}<input type="datetime-local" value={registeredTo} onChange={event => setRegisteredTo(event.target.value)} disabled={working} /></label></> : <label className={s.search}>{c.adAccountId}<input value={userIdInput} onChange={event => setUserIdInput(event.target.value)} placeholder={c.adAccountPh} maxLength={36} disabled={working} /></label>}
            <button className={s.outline} type="submit" disabled={working || current.loading}><Icon name="search" size={15} />{c.adQuery}</button>{(tab === "users" ? filters.q || filters.role || filters.accountKind || filters.exactId || filters.inviterId || filters.from || filters.to : filters.userId) && <button className={s.text} type="button" disabled={working || current.loading} onClick={() => { setSearch(""); setRoleFilter(""); setUserIdInput(""); setAccountKind(""); setExactId(""); setInviterId(""); setRegisteredFrom(""); setRegisteredTo(""); setFilters({ q: "", role: "", userId: "", accountKind: "", exactId: "", inviterId: "", from: "", to: "" }); setOffset(0); }}>{c.adClearFilters}</button>}
          </form>}
          {current.error && <div className={s.error} role="alert"><p>{current.error}</p><button className={s.outline} disabled={working || current.loading} onClick={() => void load()}>{c.adReload}</button></div>}
          {current.loading && <div className={s.loading} role="status"><Icon name="refresh" size={20} /><p>{xumengStudioFill(c.adLoading, { name: tabText[tab].label })}</p></div>}
          {data?.kind === "overview" && <Overview value={data.value} onTab={selectTab} hasPublishing={Boolean(publishingReview)} hasForum={Boolean(forumModeration)} c={c} />}
          {page && !page.items.length && <div className={s.empty}><Icon name="search" size={28} /><h3>{c.adEmpty}</h3><p>{c.adEmptyBody}</p></div>}
          {data?.kind === "users" && data.value.items.length > 0 && <Table label={c.adWallet} headers={[c.adPerson, c.adKind, c.adParent, c.adAvailable, c.adRechargeTotal, c.adMedia, c.adTasks, c.adLastActive, c.adJoined, c.adManage]}>{data.value.items.map(target => <tr key={target.id}>
            <td><AccountCell name={target.nickname} id={target.id} /><span className={s.secondaryLine}>{target.email ?? c.adGuestAccount}{target.email && <span> · {target.emailVerified ? c.adEmailOn : c.adEmailOff}</span>}</span></td>
            <td><span className={target.role === "super" ? s.superRole : s.status}>{target.isGuest ? c.adGuest : roleName(target.role)}</span><span className={s.secondaryLine}>{target.role === "super" ? c.adFullPowers : target.subscription.active ? xumengStudioFill(c.adVipUntil, { time: date(target.subscription.expiresAt) }) : c.adOrdinary}</span></td>
            <td><code>{target.inviterId ?? "—"}</code><span className={s.secondaryLine}>{xumengStudioFill(c.adInvited, { count: target.inviteCount === null || target.inviteCount === undefined ? "—" : number(target.inviteCount) })}</span></td>
            <td className={s.numeric}><strong>{number(target.availableCredits)}</strong><span className={s.secondaryLine}>{xumengStudioFill(c.adHeld, { count: number(target.reservedCredits), spent: number(target.totalSpentCredits) })}</span>{target.debtCredits > 0 && <span className={s.warning}>{xumengStudioFill(c.adDebt, { count: number(target.debtCredits) })}</span>}</td>
            <td className={s.numeric}>{money(target.rechargeAmountMinor ?? 0, "cny")}<span className={s.secondaryLine}>{xumengStudioFill(c.adTopUpPoints, { count: number(target.rechargeCredits ?? 0) })}</span></td>
            <td className={s.numeric}>{number(target.imageCount ?? 0)} / {number(target.videoCount ?? 0)}</td>
            <td className={s.numeric}>{xumengStudioFill(c.adDays, { count: number(target.checkinDays ?? 0) })}<span className={s.secondaryLine}>{xumengStudioFill(c.adTaskPoints, { count: target.taskCredits === null || target.taskCredits === undefined ? "—" : number(target.taskCredits) })}</span></td>
            <td className={s.dateCell}>{date(target.lastActiveAt ?? null)}</td>
            <td className={s.dateCell}>{date(target.createdAt)}</td>
            <td><div className={s.rowActions}><button className={s.text} disabled={working || target.isGuest} onClick={() => openAction("credits", target)}>{c.adAdjust}</button><button className={s.text} disabled={working || target.isGuest || target.id === accountId} title={target.id === accountId ? c.adNoSelf : undefined} onClick={() => openAction("role", target)}>{c.adChangeRole}</button><button className={s.text} disabled={working} onClick={() => filterUser(target, "usage")}>{c.adSeeUsage}</button></div></td>
          </tr>)}</Table>}
          {data?.kind === "subscriptions" && data.value.items.length > 0 && <Table label={c.adVipLog} headers={[c.adPerson, c.adPlan, c.adStatus, c.adTerm, c.adDailyClaim]}>{data.value.items.map(item => <tr key={item.id}><td><AccountCell name={item.nickname} id={item.userId} /></td><td><strong>{item.label}</strong><span className={s.secondaryLine}>{item.planId}</span><code className={s.recordId}>{item.id}</code></td><td><Status value={item.status} text={statusText(item.status)} /></td><td className={s.dateCell}>{date(item.startsAt)}<span className={s.secondaryLine}>{xumengStudioFill(c.adUntil, { time: date(item.expiresAt) })}</span></td><td className={s.numeric}>{number(item.dailyCredits)} Credit<span className={s.secondaryLine}>{xumengStudioFill(c.adClaimed, { count: item.claimsCount, max: item.maxClaims })}</span></td></tr>)}</Table>}
          {data?.kind === "orders" && data.value.items.length > 0 && <Table label={c.adOrders} headers={[c.adOrderUser, c.adChannel, c.adAmount, "Credit", c.adStatus, c.adPayHeader]}>{data.value.items.map(item => <tr key={item.id}><td><code className={s.recordId}>{item.id}</code><AccountCell name={item.nickname} id={item.userId} /></td><td>{channelName(item.provider)}<span className={s.secondaryLine}>{item.kind === "recharge" ? c.adTopUp : c.adSubscription} · {item.mode === "live" ? c.adLive : c.adTest}</span></td><td className={s.numeric}>{money(item.amountMinor, item.currency, item.amountScale)}</td><td className={s.numeric}>{item.credits === null ? "—" : number(item.credits)}</td><td><Status value={item.status} text={statusText(item.status)} /></td><td className={s.dateCell}>{date(item.createdAt)}<span className={s.secondaryLine}>{xumengStudioFill(c.adPaidAt, { time: date(item.paidAt) })}</span></td></tr>)}</Table>}
          {data?.kind === "usage" && data.value.items.length > 0 && <Table label={c.adUsage} headers={[c.adRequest, c.adModelOp, c.adStatus, c.adTokens, "Credit", c.adProviderCost, c.adCreated]}>{data.value.items.map(item => <tr key={item.id}><td><AccountCell name={item.nickname} id={item.userId} /><code className={s.recordId}>{item.id}</code></td><td><strong>{item.model}</strong><span className={s.secondaryLine}>{item.operation === "chat" ? c.adChat : item.operation === "memory" ? c.adMemory : item.operation}</span></td><td><Status value={item.status} text={statusText(item.status)} /></td><td className={s.numeric}>{item.promptTokens === null ? "—" : number(item.promptTokens)} / {item.completionTokens === null ? "—" : number(item.completionTokens)}</td><td className={s.numeric}>{item.billingExempt ? <span className={s.superRole}>{c.adExempt}</span> : xumengStudioFill(c.adSpent, { count: number(item.chargedCredits) })}<span className={s.secondaryLine}>{xumengStudioFill(c.adHeldOnly, { count: number(item.reservedCredits) })}</span></td><td className={s.numeric}>{item.providerCostUsd === null ? c.adNoCost : `$${item.providerCostUsd.toFixed(6)}`}</td><td className={s.dateCell}>{date(item.createdAt)}</td></tr>)}</Table>}
          {data?.kind === "audit" && data.value.items.length > 0 && <Table label={c.adAuditTable} headers={[c.adTime, c.adAction, c.adTarget, c.adAdmin, c.adReason]}>{data.value.items.map(item => <tr key={item.id}><td className={s.dateCell}>{date(item.createdAt)}<code className={s.recordId}>{item.id}</code></td><td><strong>{item.action === "credit_adjustment" ? `${(item.delta ?? 0) > 0 ? "+" : ""}${number(item.delta ?? 0)} Credit` : `${roleName(item.previousRole!)} → ${roleName(item.role!)}`}</strong><code className={s.recordId}>{item.requestId}</code></td><td><code className={s.accountId}>{item.targetUserId}</code></td><td><code className={s.accountId}>{item.actorId}</code></td><td className={s.reasonCell}>{item.reason}</td></tr>)}</Table>}
          {page && <footer className={s.pagination}><span>{xumengStudioFill(c.adTotal, { count: number(page.total) })}{page.items.length > 0 ? ` · ${number(page.offset + 1)}–${number(page.offset + page.items.length)}` : ""}</span><div><button className={s.outline} disabled={working || current.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{c.adPrev}</button><button className={s.outline} disabled={working || current.loading || !page.hasMore} onClick={() => setOffset(offset + LIMIT)}>{c.adNext}</button></div></footer>}
        </>}
      </section>
    </div>
    {action && action.accountId === accountId && <div className={s.overlay}><div ref={dialog} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="admin-action-title" tabIndex={-1}>
      <header><h2 id="admin-action-title">{action.confirmed ? c.adConfirmTitle : action.kind === "credits" ? c.adAdjust : c.adChangeAccess}</h2><button className={s.iconButton} type="button" aria-label={c.adCloseAction} disabled={working} onClick={closeAction}><Icon name="close" size={19} /></button></header>
      <div className={s.dialogAccount}><AccountCell name={action.user.nickname} id={action.user.id} /><span>{action.user.email}</span></div>
      {action.confirmed ? <div className={s.confirmBody}>
        <dl className={s.confirmFacts}><div><dt>{c.adChangeWhat}</dt><dd>{action.kind === "credits" ? `${Number(action.delta) > 0 ? "+" : ""}${number(Number(action.delta))} Credit` : `${roleName(action.user.role)} → ${roleName(action.role)}`}</dd></div>{action.kind === "credits" && <div><dt>{c.adBefore}</dt><dd>{number(action.user.availableCredits)}</dd></div>}<div><dt>{c.adWhy}</dt><dd>{action.reason}</dd></div></dl>
        <p className={s.dialogNote}>{action.kind === "role" && action.role === "super" ? c.adSuperNote : action.kind === "role" ? c.adUserNote : c.adWalletNote}</p>
        {actionError && <p className={s.mutationError} role="alert">{actionError}</p>}{action.attempted && actionError && <p className={s.dialogNote}>{c.adSameRetry}</p>}
        <footer>{!action.attempted && <button className={s.outline} disabled={working} onClick={() => setAction({ ...action, confirmed: false })}>{c.adBackEdit}</button>}<button className={s.outline} disabled={working} onClick={closeAction}>{c.adClose}</button><button className={s.primary} disabled={working} onClick={() => void executeAction()}>{working ? c.adWorking : action.attempted ? c.adRetrySame : c.adConfirmChange}</button></footer>
      </div> : <form className={s.actionForm} onSubmit={prepareAction}>
        {action.kind === "credits" ? <label>{c.adDelta}<input type="text" inputMode="numeric" value={action.delta} maxLength={9} onChange={event => setAction({ ...action, delta: event.target.value })} placeholder={c.adDeltaPh} required /><small>{xumengStudioFill(c.adAvailableNow, { count: number(action.user.availableCredits) })}</small></label> : <label>{c.adTargetRole}<select value={action.role} onChange={event => setAction({ ...action, role: event.target.value as DzmmAdminRole })}><option value="user">{c.adUserRole}</option><option value="super">{c.adSuperOption}</option></select></label>}
        <label>{c.adWhy}<input value={action.reason} maxLength={200} onChange={event => setAction({ ...action, reason: event.target.value })} placeholder={c.adReasonPh} required /></label>{actionError && <p className={s.mutationError} role="alert">{actionError}</p>}
        <footer><button className={s.outline} type="button" onClick={closeAction}>{c.adCancel}</button><button className={s.primary} type="submit">{c.adContinue}</button></footer>
      </form>}
    </div></div>}
  </main>;
}

function share(part: number, total: number) {
  if (total <= 0) return "0%";
  const value = Math.round(part * 1000 / total) / 10;
  return `${Number.isInteger(value) ? value.toFixed(0) : value}%`;
}
function CheckinCredits({ accountId, c }: { accountId: string; c: ReturnType<typeof xumengStudio> }) {
  const [credits, setCredits] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    void fetchDzmmAdminCheckin(accountId).then((value) => { if (live) setCredits(String(value.credits)); }).catch((error: unknown) => { if (live) setNotice(error instanceof DzmmAdminError ? error.message : c.adCheckinReadFailed); });
    return () => { live = false; };
  }, [accountId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    const amount = Number(credits);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000) { setNotice(c.adCheckinRule); return; }
    try {
      const saved = await saveDzmmAdminCheckin(accountId, amount);
      setCredits(String(saved.credits));
      setNotice(c.adCheckinSaved);
    } catch (error) { setNotice(error instanceof DzmmAdminError ? error.message : c.adSaveFailed); }
  }
  return <section className={s.overviewSection}><h3>{c.adDaily}</h3><p>{c.adDailyBody}</p><form onSubmit={(event) => void save(event)}><label>{c.adEachClaim}<input value={credits} inputMode="numeric" onChange={(event) => setCredits(event.target.value)} /></label><button type="submit">{c.adSave}</button>{notice ? <p>{notice}</p> : null}</form></section>;
}
function HomeBanners({ accountId, c }: { accountId: string; c: ReturnType<typeof xumengStudio> }) {
  const bannerAudience: Record<DzmmAdminBanner["audience"], string> = { general: c.adGeneral, male: c.adMale, female: c.adFemale };
  const [banners, setBanners] = useState<DzmmAdminBanner[]>([]);
  const [audience, setAudience] = useState<DzmmAdminBanner["audience"]>("general");
  const [position, setPosition] = useState("1");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    void fetchDzmmAdminBanners(accountId).then(setBanners).catch((error: unknown) => setNotice(error instanceof DzmmAdminError ? error.message : c.adBannerReadFailed));
  }, [accountId]);
  useEffect(() => { load(); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    const slot = Number(position);
    if (!Number.isInteger(slot) || slot < 1 || slot > 99 || !title.trim() || !body.trim()) { setNotice(c.adBannerRule); return; }
    const link = href.trim();
    if (link && !link.startsWith("/") && !link.startsWith("#")) { setNotice(c.adBannerLink); return; }
    try {
      await saveDzmmAdminBanner(accountId, { audience, position: slot, title: title.trim(), body: body.trim(), href: link });
      setTitle(""); setBody(""); setHref(""); setNotice(c.adBannerSaved);
      load();
    } catch (error) { setNotice(error instanceof DzmmAdminError ? error.message : c.adSaveFailed); }
  }
  async function remove(id: string) {
    try { await deleteDzmmAdminBanner(accountId, id); setNotice(c.adBannerDeleted); load(); }
    catch (error) { setNotice(error instanceof DzmmAdminError ? error.message : c.adDeleteFailed); }
  }
  return <section className={s.overviewSection}><h3>{c.adBanners}</h3><p>{c.adBannerBody}</p>
    <form onSubmit={(event) => void save(event)}>
      <label>{c.adAudience}<select value={audience} onChange={(event) => setAudience(event.target.value as DzmmAdminBanner["audience"])}><option value="general">{c.adGeneral}</option><option value="male">{c.adMale}</option><option value="female">{c.adFemale}</option></select></label>
      <label>{c.adNumber}<input value={position} inputMode="numeric" onChange={(event) => setPosition(event.target.value)} /></label>
      <label>{c.adBannerTitle}<input value={title} maxLength={40} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>{c.adNote}<input value={body} maxLength={120} onChange={(event) => setBody(event.target.value)} /></label>
      <label>{c.adLink}<input value={href} maxLength={200} placeholder={c.adLinkPh} onChange={(event) => setHref(event.target.value)} /></label>
      <button type="submit">{c.adSaveBanner}</button>
    </form>
    {notice ? <p>{notice}</p> : null}
    <ul>{banners.map((banner) => <li key={banner.id}><strong>{banner.deletedAt ? c.adDeleted : bannerAudience[banner.audience]} · {banner.position}</strong> {banner.title} {banner.body}{banner.deletedAt ? null : <button type="button" onClick={() => void remove(banner.id)}>{c.adDelete}</button>}</li>)}</ul>
  </section>;
}
function Overview({ value, onTab, hasPublishing, hasForum, c }: { value: DzmmAdminOverview; onTab: (tab: Tab) => void; hasPublishing: boolean; hasForum: boolean; c: ReturnType<typeof xumengStudio> }) {
  const { stats, traffic } = value;
  const channelName = (v: string) => ({ zpay: "Z-Pay", stripe: "Stripe", subscription: c.adSubscription, nowpayments: "NOWPayments" }[v] ?? v);
  const accounts = stats.users;
  const todayTotal = traffic.visitors;
  return <div className={s.overview}>
    <section className={s.overviewSection}>
      <h3>{xumengStudioFill(c.adToday, { day: traffic.day })}</h3>
      <p>{c.adTodayBody}</p>
      <dl className={s.traffic}>
        <div><dt>{c.adVisitors}</dt><dd>{number(traffic.visitors)}</dd><span>{xumengStudioFill(c.adReturnNew, { back: number(traffic.returningVisitors), fresh: number(traffic.newGuests + traffic.newRegistered) })}</span></div>
        <div><dt>{c.adGuest}</dt><dd>{number(traffic.guestVisitors)}</dd><span>{xumengStudioFill(c.adGuestShare, { share: share(traffic.guestVisitors, todayTotal), fresh: number(traffic.newGuests) })}</span></div>
        <div><dt>{c.adSigned}</dt><dd>{number(traffic.registeredVisitors)}</dd><span>{xumengStudioFill(c.adSignedShare, { share: share(traffic.registeredVisitors, todayTotal), fresh: number(traffic.newRegistered) })}</span></div>
        <div><dt>{c.adRequests}</dt><dd>{number(traffic.chatRequests)}</dd><span>{xumengStudioFill(c.adRequestMeta, { credits: number(traffic.chargedCredits), orders: number(traffic.paidOrders) })}</span></div>
      </dl>
      <div className={s.ratio} role="img" aria-label={xumengStudioFill(c.adRatio, { guest: share(traffic.guestVisitors, todayTotal), signed: share(traffic.registeredVisitors, todayTotal) })}>
        <span style={{ width: todayTotal ? `${traffic.guestVisitors / todayTotal * 100}%` : "0%" }} />
        <span style={{ width: todayTotal ? `${traffic.registeredVisitors / todayTotal * 100}%` : "0%" }} />
      </div>
      <p className={s.ratioLegend}><span>{xumengStudioFill(c.adGuestLegend, { share: share(traffic.guestVisitors, todayTotal) })}</span><span>{xumengStudioFill(c.adSignedLegend, { share: share(traffic.registeredVisitors, todayTotal) })}</span></p>
      <dl className={s.activityFacts}>
        <div><dt>{c.adStories}</dt><dd>{number(traffic.conversations)}</dd></div>
        <div><dt>{c.adNewPosts}</dt><dd>{number(traffic.forumPosts)}</dd></div>
        <div><dt>{c.adNewReplies}</dt><dd>{number(traffic.forumReplies)}</dd></div>
        <div><dt>{c.adNewLikes}</dt><dd>{number(traffic.likes)}</dd></div>
        <div><dt>{c.adListed}</dt><dd>{number(traffic.listedCharacters)}</dd></div>
      </dl>
    </section>
    <section className={s.overviewSection}>
      <h3>{c.adWeek}</h3>
      <Table label={c.adWeek} tableClass={s.trafficTable} headers={[c.adDate, c.adVisit, c.adGuest, c.adSigned, c.adGuestRatio, c.adNewGuests, c.adNewSignups]}>{traffic.days.map(day => <tr key={day.day} data-current={day.day === traffic.day ? "true" : undefined}><td>{day.day.slice(5)}</td><td className={s.numeric}>{number(day.visitors)}</td><td className={s.numeric}>{number(day.guestVisitors)}</td><td className={s.numeric}>{number(day.registeredVisitors)}</td><td className={s.numeric}>{share(day.guestVisitors, day.visitors)}</td><td className={s.numeric}>{number(day.newGuests)}</td><td className={s.numeric}>{number(day.newRegistered)}</td></tr>)}</Table>
    </section>
    <dl className={s.metrics}><div><dt>{c.adAllAccounts}</dt><dd>{number(accounts)}</dd><span>{xumengStudioFill(c.adAccountSplit, { signed: number(stats.registeredUsers), signedShare: share(stats.registeredUsers, accounts), guest: number(stats.guestUsers), guestShare: share(stats.guestUsers, accounts), super: number(stats.superUsers) })}</span></div><div><dt>{c.adLiveVip}</dt><dd>{number(stats.activeSubscriptions)}</dd><span>{c.adLiveVipBody}</span></div><div><dt>{c.adCreditPool}</dt><dd>{number(stats.totalAvailableCredits)}</dd><span>{xumengStudioFill(c.adCreditPoolBody, { held: number(stats.totalReservedCredits), spent: number(stats.totalSpentCredits) })}</span></div></dl>
    <section className={s.overviewSection}><h3>{c.adPending}</h3><div className={s.queue}>{hasPublishing && <button onClick={() => onTab("publishing")}><span>{c.adPendingCards}</span><strong>{number(stats.pendingSubmissions)}</strong><Icon name="chevron" size={16} /></button>}<button onClick={() => onTab("usage")}><span>{c.adPendingUsage}</span><strong>{number(stats.pendingUsage)}</strong><Icon name="chevron" size={16} /></button>{hasForum && <button onClick={() => onTab("forum")}><span>{c.adOpenReports}</span><strong>{number(traffic.openReports)}</strong><Icon name="chevron" size={16} /></button>}{hasForum && <button onClick={() => onTab("forum")}><span>{c.adForumTotal}</span><strong>{number(stats.forumPosts)}</strong><Icon name="chevron" size={16} /></button>}</div></section>
    <section className={s.overviewSection}><h3>{c.adPaidOrders}</h3><p>{c.adPaidBody}{value.revenue.some(item => item.currency === "usdt") && c.adUsdt}</p>{value.revenue.length ? <Table label={c.adPaidTable} headers={[c.adRoute, c.adEnv, c.adOrderCount, c.adPaidSum]}>{value.revenue.map(item => <tr key={`${item.provider}:${item.currency}:${item.mode}`}><td>{channelName(item.provider)}</td><td>{item.mode === "live" ? c.adLive : c.adTest}</td><td className={s.numeric}>{number(item.paidOrders)}</td><td className={s.numeric}>{money(item.amountMinor, item.currency, item.amountScale)}</td></tr>)}</Table> : <p className={s.noRevenue}>{c.adNoPaid}</p>}</section>
    <CheckinCredits accountId={value.accountId} c={c} />
    <HomeBanners accountId={value.accountId} c={c} />
    <section className={s.overviewSection}><h3>{c.adSystem}</h3><dl className={s.systemFacts}><div><dt>{c.adBilling}</dt><dd>{value.billing.enabled ? c.adOn : c.adOff}</dd></div><div><dt>{c.adPriceRev}</dt><dd>{value.billing.priceRevision === null ? "—" : value.billing.priceRevision}</dd></div><div><dt>{c.adServerTime}</dt><dd>{xumengStudioFill(c.adBeijing, { time: date(value.serverTime) })}</dd></div><div><dt>{c.adSuperPerks}</dt><dd>{c.adSuperPerksBody}</dd></div></dl></section>
  </div>;
}
