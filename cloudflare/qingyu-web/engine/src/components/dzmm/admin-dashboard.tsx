"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { DzmmCloudUser } from "@/lib/dzmm-cloud";
import {
  adjustDzmmAdminCredits, changeDzmmAdminRole, DzmmAdminError, fetchDzmmAdminAudit,
  fetchDzmmAdminOrders, fetchDzmmAdminOverview, fetchDzmmAdminSubscriptions, fetchDzmmAdminUsage, fetchDzmmAdminUsers,
  type DzmmAdminAudit, type DzmmAdminOrder, type DzmmAdminOverview, type DzmmAdminPage,
  type DzmmAdminRole, type DzmmAdminSubscription, type DzmmAdminUsage, type DzmmAdminUser,
} from "@/lib/dzmm-admin-client";
import { XUMENG_PAYMENTS_ENABLED } from "@/lib/xumeng-feature-availability";
import Icon, { type IconName } from "./icons";
import FeedbackInbox from "./feedback-inbox";
import s from "./admin-dashboard.module.css";

type Tab = "overview" | "users" | "subscriptions" | "orders" | "usage" | "audit" | "publishing" | "forum" | "feedback";
type Data = { kind: "overview"; value: DzmmAdminOverview } | { kind: "users"; value: DzmmAdminPage<DzmmAdminUser> }
  | { kind: "subscriptions"; value: DzmmAdminPage<DzmmAdminSubscription> } | { kind: "orders"; value: DzmmAdminPage<DzmmAdminOrder> }
  | { kind: "usage"; value: DzmmAdminPage<DzmmAdminUsage> } | { kind: "audit"; value: DzmmAdminPage<DzmmAdminAudit> };
type Remote = { accountId: string; tab: Tab; loading: boolean; error: string; data: Data | null; fetchedAt: number | null };
type Action = { accountId: string; kind: "credits" | "role"; user: DzmmAdminUser; requestId: string; delta: string; role: DzmmAdminRole; reason: string; confirmed: boolean; attempted: boolean };
export type AdminDashboardProps = {
  user: DzmmCloudUser | null; onRequireAccount: () => void;
  publishingReview?: ReactNode; forumModeration?: ReactNode;
  onAccountChanged?: () => void;
};
const TABS: { id: Tab; label: string; icon: IconName; description: string }[] = [
  { id: "overview", label: "概览", icon: "grid", description: "账户、Credit 与待处理事项" },
  { id: "users", label: "用户与权限", icon: "users", description: "查找账号，调整 Credit 或 Super 权限" },
  { id: "subscriptions", label: "VIP 会员", icon: "crown", description: "查看会员有效期和 Credit 领取记录" },
  { id: "orders", label: "支付订单", icon: "wallet", description: "查看充值与 VIP 订单状态" },
  { id: "usage", label: "模型用量", icon: "sparkles", description: "查看 Token 用量、Credit 消费与供应商成本" },
  { id: "audit", label: "操作记录", icon: "book", description: "核对管理员权限与 Credit 调整" },
  { id: "publishing", label: "角色审核", icon: "check", description: "审核用户提交的公开角色" },
  { id: "forum", label: "论坛管理", icon: "chat", description: "处理主题、回复与举报" },
  { id: "feedback", label: "群反馈", icon: "chat", description: "查看 Telegram 群里的反馈，保存你的处理判断" },
];
const LIMIT = 20;
const number = (v: number) => v.toLocaleString("zh-CN");
const date = (v: number | null) => v === null ? "—" : new Date(v).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const money = (v: number, currency: string, amountScale?: 2 | 6) => currency === "usdt"
  ? amountScale === 6 ? `${number(Math.floor(v / 1_000_000))}.${String(v % 1_000_000).padStart(6, "0")} USDT` : "—"
  : new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency.toUpperCase() }).format(v / 100);
const roleLabel = (role: DzmmAdminRole) => role === "super" ? "Super" : "普通用户";
const provider = (v: string) => ({ zpay: "Z-Pay", stripe: "Stripe", subscription: "VIP 订阅", nowpayments: "NOWPayments" }[v] ?? v);
const statusLabel = (v: string) => ({ active: "生效中", scheduled: "等待生效", expired: "已到期", revoked: "已撤销", pending: "待处理", paid: "已支付", failed: "失败", refunded: "已退款", partially_refunded: "部分退款", reserved: "已预留", settled: "已结算", released: "已释放" }[v] ?? v);
const errorMessage = (v: unknown) => v instanceof Error ? v.message : "操作失败，请重试。";

function AccountCell({ name, id }: { name: string; id: string }) {
  return <div className={s.accountCell}><strong>{name}</strong><code title={id}>{id}</code></div>;
}
function Status({ value }: { value: string }) { return <span className={s.status} data-status={value}>{statusLabel(value)}</span>; }
function Table({ headers, children, label }: { headers: string[]; children: ReactNode; label: string }) {
  return <div className={s.tableScroll} role="region" aria-label={label} tabIndex={0}><table className={s.table}><thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export default function AdminDashboard({ user, onRequireAccount, publishingReview, forumModeration, onAccountChanged }: AdminDashboardProps) {
  const permitted = Boolean(user && !user.isGuest && user.role === "super");
  const accountId = user?.id ?? "";
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | DzmmAdminRole>("");
  const [userIdInput, setUserIdInput] = useState("");
  const [filters, setFilters] = useState({ q: "", role: "" as "" | DzmmAdminRole, userId: "" });
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
  const activeTab = TABS.find(item => item.id === tab)!;
  const moderation = tab === "publishing" || tab === "forum" || tab === "feedback";
  const dialogOpen = action?.accountId === accountId && permitted;
  const dialogConfirmed = action?.confirmed ?? false;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; readController.current?.abort(); };
  }, []);
  useLayoutEffect(() => { accountRef.current = accountId; }, [accountId]);

  const load = useCallback(async () => {
    readController.current?.abort();
    const run = ++generation.current;
    if (!permitted || tab === "publishing" || tab === "forum" || tab === "feedback") return;
    const controller = new AbortController();
    readController.current = controller;
    setRemote({ accountId, tab, loading: true, error: "", data: null, fetchedAt: null });
    const query = { limit: LIMIT, offset, ...(filters.userId ? { userId: filters.userId } : {}) };
    try {
      let data: Data;
      if (tab === "overview") data = { kind: tab, value: await fetchDzmmAdminOverview(accountId, controller.signal) };
      else if (tab === "users") data = { kind: tab, value: await fetchDzmmAdminUsers(accountId, { limit: LIMIT, offset, q: filters.q, ...(filters.role ? { role: filters.role } : {}) }, controller.signal) };
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
      setRemote({ accountId, tab, loading: false, error: errorMessage(error), data: null, fetchedAt: null });
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
  function applyFilters(event: FormEvent) {
    event.preventDefault(); setOffset(0); setFilters({ q: search.trim(), role: roleFilter, userId: userIdInput.trim() }); setNotice("");
  }
  function filterUser(target: DzmmAdminUser, next: Tab) {
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
    if (!reason || reason.length > 200 || /[\r\n]/.test(reason)) { setActionError("请填写 1 至 200 字的单行操作原因。"); return; }
    if (action.kind === "credits" && (!/^-?\d+$/.test(action.delta) || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000)) {
      setActionError("请输入非零整数，单次最多调整 1,000,000 Credit。"); return;
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
      setNotice(current.kind === "credits" ? `${result.user.nickname} 的 Credit 已调整，当前可用 ${number(result.user.availableCredits)}。${result.replayed ? "已核对之前提交的同一操作。" : ""}`
        : `${result.user.nickname} 的权限已设为${roleLabel(result.user.role)}。${result.replayed ? "已核对之前提交的同一操作。" : ""}`);
      onAccountChanged?.();
      await load();
    } catch (error) {
      if (!alive.current || accountRef.current !== actingAccountId) return;
      if (error instanceof DzmmAdminError && (error.status === 401 || error.status === 403)) {
        setAccessError({ accountId: actingAccountId, status: error.status, message: error.message }); setAction(null);
      } else setActionError(errorMessage(error));
    } finally { workingRef.current = false; if (alive.current) setWorking(false); }
  }
  function closeAction() {
    if (workingRef.current) return;
    if (action?.attempted) { setNoticeAccountId(accountId); setNotice("已刷新账户数据。请核对余额、权限和操作记录后再发起新操作。"); }
    setAction(null); setActionError(""); void load();
  }

  const denied = accessError?.accountId === accountId ? accessError : null;
  if (!permitted || denied) return <main className={s.page}><header className={s.heading}><p>晴屿 · 管理后台</p><h1>Super 管理</h1></header><section className={s.empty}><Icon name="user" size={32} /><h2>{denied?.status === 401 ? "请重新登录" : "需要 Super 管理员权限"}</h2><p>{denied?.message ?? "请使用 Super 账号登录后进入管理后台。"}</p><div className={s.actions}>{(!user || user.isGuest || denied?.status === 401) && <button className={s.primary} onClick={onRequireAccount}>登录账号</button>}{permitted && <button className={s.outline} onClick={() => { setAccessError(null); void load(); }}>重新检查权限</button>}</div></section></main>;

  const current = remote.tab === tab && remote.accountId === accountId ? remote : { tab, loading: true, error: "", data: null, fetchedAt: null };
  const data = current.data;
  const page = data && data.kind !== "overview" ? data.value : null;
  return <main className={s.page}>
    <header className={s.heading}><div><p>晴屿 · 管理后台</p><h1>Super 管理</h1><span>{user?.nickname} · 完整站内管理权限</span></div><div className={s.headerActions}><span className={s.adminMark}><Icon name="crown" size={15} />Super</span>{!moderation && <button className={s.outline} disabled={current.loading || working} onClick={() => void load()}><Icon name="refresh" size={15} />刷新数据</button>}</div></header>
    <div className={s.layout}>
      <nav className={s.navigation} aria-label="后台功能">{TABS.filter(item => XUMENG_PAYMENTS_ENABLED || !["orders", "subscriptions"].includes(item.id)).filter(item => item.id !== "publishing" || publishingReview).filter(item => item.id !== "forum" || forumModeration).map(item => <button type="button" key={item.id} aria-current={tab === item.id ? "page" : undefined} disabled={working} onClick={() => selectTab(item.id)}><Icon name={item.icon} size={17} />{item.label}</button>)}<p className={s.navigationNote}>所有管理员调整均保留操作记录。</p></nav>
      <section className={s.workspace} aria-label={activeTab.label}>
        <div className={s.sectionHeading}><div><h2>{activeTab.label}</h2><p>{activeTab.description}</p></div>{!moderation && current.fetchedAt && <small>更新于 {date(current.fetchedAt)}</small>}</div>
        {notice && noticeAccountId === accountId && <p className={s.notice} role="status">{notice}</p>}
        {tab === "publishing" ? <div className={s.embedded}>{publishingReview}</div> : tab === "forum" ? <div className={s.embedded}>{forumModeration}</div> : tab === "feedback" ? <FeedbackInbox key={accountId} accountId={accountId} onRequireAccount={onRequireAccount} /> : <>
          {tab !== "overview" && <form className={s.filters} onSubmit={applyFilters}>
            {tab === "users" ? <><label className={s.search}>查找用户<input aria-label="邮箱、昵称或账号 ID" type="search" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder="邮箱、昵称或账号 ID" disabled={working} /></label><label>权限<select value={roleFilter} disabled={working} onChange={event => setRoleFilter(event.target.value as "" | DzmmAdminRole)}><option value="">所有权限</option><option value="user">普通用户</option><option value="super">Super</option></select></label></> : <label className={s.search}>账号 ID<input value={userIdInput} onChange={event => setUserIdInput(event.target.value)} placeholder="完整账号 ID，留空查看全部" maxLength={36} disabled={working} /></label>}
            <button className={s.outline} type="submit" disabled={working || current.loading}><Icon name="search" size={15} />查询</button>{(tab === "users" ? filters.q || filters.role : filters.userId) && <button className={s.text} type="button" disabled={working || current.loading} onClick={() => { setSearch(""); setRoleFilter(""); setUserIdInput(""); setFilters({ q: "", role: "", userId: "" }); setOffset(0); }}>清除筛选</button>}
          </form>}
          {current.error && <div className={s.error} role="alert"><p>{current.error}</p><button className={s.outline} disabled={working || current.loading} onClick={() => void load()}>重新加载</button></div>}
          {current.loading && <div className={s.loading} role="status"><Icon name="refresh" size={20} /><p>正在加载{activeTab.label}…</p></div>}
          {data?.kind === "overview" && <Overview value={data.value} onTab={selectTab} hasPublishing={Boolean(publishingReview)} hasForum={Boolean(forumModeration)} />}
          {page && !page.items.length && <div className={s.empty}><Icon name="search" size={28} /><h3>没有符合条件的记录</h3><p>可调整筛选条件或稍后刷新。</p></div>}
          {data?.kind === "users" && data.value.items.length > 0 && <Table label="用户与钱包" headers={["用户", "权限 / VIP", "Credit", "注册时间", "管理"]}>{data.value.items.map(target => <tr key={target.id}>
            <td><AccountCell name={target.nickname} id={target.id} /><span className={s.secondaryLine}>{target.email ?? "游客账号"}{target.email && <span> · {target.emailVerified ? "邮箱已验证" : "邮箱未验证"}</span>}</span></td>
            <td><span className={target.role === "super" ? s.superRole : s.status}>{target.isGuest ? "游客" : roleLabel(target.role)}</span><span className={s.secondaryLine}>{target.role === "super" ? "完整功能权限" : target.subscription.active ? `VIP 至 ${date(target.subscription.expiresAt)}` : "普通权益"}</span></td>
            <td className={s.numeric}><strong>{number(target.availableCredits)}</strong><span className={s.secondaryLine}>预留 {number(target.reservedCredits)} · 消费 {number(target.totalSpentCredits)}</span>{target.debtCredits > 0 && <span className={s.warning}>待补扣 {number(target.debtCredits)}</span>}</td>
            <td className={s.dateCell}>{date(target.createdAt)}</td>
            <td><div className={s.rowActions}>{XUMENG_PAYMENTS_ENABLED && <button className={s.text} disabled={working || target.isGuest} onClick={() => openAction("credits", target)}>调整 Credit</button>}<button className={s.text} disabled={working || target.isGuest || target.id === accountId} title={target.id === accountId ? "不能修改自己的 Super 权限" : undefined} onClick={() => openAction("role", target)}>更改权限</button><button className={s.text} disabled={working} onClick={() => filterUser(target, "usage")}>查看用量</button></div></td>
          </tr>)}</Table>}
          {data?.kind === "subscriptions" && data.value.items.length > 0 && <Table label="VIP 会员记录" headers={["用户", "会员方案", "状态", "有效期", "每日 Credit / 领取"]}>{data.value.items.map(item => <tr key={item.id}><td><AccountCell name={item.nickname} id={item.userId} /></td><td><strong>{item.label}</strong><span className={s.secondaryLine}>{item.planId}</span><code className={s.recordId}>{item.id}</code></td><td><Status value={item.status} /></td><td className={s.dateCell}>{date(item.startsAt)}<span className={s.secondaryLine}>至 {date(item.expiresAt)}</span></td><td className={s.numeric}>{number(item.dailyCredits)} Credit<span className={s.secondaryLine}>已领取 {item.claimsCount} / {item.maxClaims} 次</span></td></tr>)}</Table>}
          {data?.kind === "orders" && data.value.items.length > 0 && <Table label="支付订单" headers={["订单 / 用户", "渠道 / 类型", "金额", "Credit", "状态", "创建 / 支付时间"]}>{data.value.items.map(item => <tr key={item.id}><td><code className={s.recordId}>{item.id}</code><AccountCell name={item.nickname} id={item.userId} /></td><td>{provider(item.provider)}<span className={s.secondaryLine}>{item.kind === "recharge" ? "充值" : "VIP 订阅"} · {item.mode === "live" ? "正式" : "测试"}</span></td><td className={s.numeric}>{money(item.amountMinor, item.currency, item.amountScale)}</td><td className={s.numeric}>{item.credits === null ? "—" : number(item.credits)}</td><td><Status value={item.status} /></td><td className={s.dateCell}>{date(item.createdAt)}<span className={s.secondaryLine}>支付 {date(item.paidAt)}</span></td></tr>)}</Table>}
          {data?.kind === "usage" && data.value.items.length > 0 && <Table label="模型用量" headers={["用户 / 请求", "模型 / 操作", "状态", "Token 输入 / 输出", "Credit", "供应商成本", "创建时间"]}>{data.value.items.map(item => <tr key={item.id}><td><AccountCell name={item.nickname} id={item.userId} /><code className={s.recordId}>{item.id}</code></td><td><strong>{item.model}</strong><span className={s.secondaryLine}>{item.operation === "chat" ? "聊天" : item.operation === "memory" ? "记忆整理" : item.operation}</span></td><td><Status value={item.status} /></td><td className={s.numeric}>{item.promptTokens === null ? "—" : number(item.promptTokens)} / {item.completionTokens === null ? "—" : number(item.completionTokens)}</td><td className={s.numeric}>{item.billingExempt ? <span className={s.superRole}>历史免扣费</span> : `${number(item.chargedCredits)} 已消费`}<span className={s.secondaryLine}>预留 {number(item.reservedCredits)}</span></td><td className={s.numeric}>{item.providerCostUsd === null ? "未返回" : `$${item.providerCostUsd.toFixed(6)}`}</td><td className={s.dateCell}>{date(item.createdAt)}</td></tr>)}</Table>}
          {data?.kind === "audit" && data.value.items.length > 0 && <Table label="管理员操作记录" headers={["时间", "操作", "目标账号", "管理员", "原因"]}>{data.value.items.map(item => <tr key={item.id}><td className={s.dateCell}>{date(item.createdAt)}<code className={s.recordId}>{item.id}</code></td><td><strong>{item.action === "credit_adjustment" ? `${(item.delta ?? 0) > 0 ? "+" : ""}${number(item.delta ?? 0)} Credit` : `${roleLabel(item.previousRole!)} → ${roleLabel(item.role!)}`}</strong><code className={s.recordId}>{item.requestId}</code></td><td><code className={s.accountId}>{item.targetUserId}</code></td><td><code className={s.accountId}>{item.actorId}</code></td><td className={s.reasonCell}>{item.reason}</td></tr>)}</Table>}
          {page && <footer className={s.pagination}><span>共 {number(page.total)} 条{page.items.length > 0 ? ` · ${number(page.offset + 1)}–${number(page.offset + page.items.length)}` : ""}</span><div><button className={s.outline} disabled={working || current.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>上一页</button><button className={s.outline} disabled={working || current.loading || !page.hasMore} onClick={() => setOffset(offset + LIMIT)}>下一页</button></div></footer>}
        </>}
      </section>
    </div>
    {action && action.accountId === accountId && <div className={s.overlay}><div ref={dialog} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="admin-action-title" tabIndex={-1}>
      <header><h2 id="admin-action-title">{action.confirmed ? "确认账户调整" : action.kind === "credits" ? "调整 Credit" : "更改用户权限"}</h2><button className={s.iconButton} type="button" aria-label="关闭调整" disabled={working} onClick={closeAction}><Icon name="close" size={19} /></button></header>
      <div className={s.dialogAccount}><AccountCell name={action.user.nickname} id={action.user.id} /><span>{action.user.email}</span></div>
      {action.confirmed ? <div className={s.confirmBody}>
        <dl className={s.confirmFacts}><div><dt>调整内容</dt><dd>{action.kind === "credits" ? `${Number(action.delta) > 0 ? "+" : ""}${number(Number(action.delta))} Credit` : `${roleLabel(action.user.role)} → ${roleLabel(action.role)}`}</dd></div>{action.kind === "credits" && <div><dt>操作前可用 Credit</dt><dd>{number(action.user.availableCredits)}</dd></div>}<div><dt>操作原因</dt><dd>{action.reason}</dd></div></dl>
        <p className={s.dialogNote}>{action.kind === "role" && action.role === "super" ? "此账号将获得全站功能与完整后台管理权限，Credit 余额和扣费规则保持不变。" : action.kind === "role" ? "此账号将恢复普通用户权限，后续使用按普通账户规则处理。" : "调整直接记入用户钱包，并记录在管理员操作记录中。"}</p>
        {actionError && <p className={s.mutationError} role="alert">{actionError}</p>}{action.attempted && actionError && <p className={s.dialogNote}>重试会核对同一笔操作，不会重复调整。</p>}
        <footer>{!action.attempted && <button className={s.outline} disabled={working} onClick={() => setAction({ ...action, confirmed: false })}>返回修改</button>}<button className={s.outline} disabled={working} onClick={closeAction}>关闭</button><button className={s.primary} disabled={working} onClick={() => void executeAction()}>{working ? "正在处理…" : action.attempted ? "重试同一操作" : "确认调整"}</button></footer>
      </div> : <form className={s.actionForm} onSubmit={prepareAction}>
        {action.kind === "credits" ? <label>调整数量<input type="text" inputMode="numeric" value={action.delta} maxLength={9} onChange={event => setAction({ ...action, delta: event.target.value })} placeholder="增加填正整数，扣减填负整数" required /><small>当前可用 {number(action.user.availableCredits)} Credit</small></label> : <label>目标权限<select value={action.role} onChange={event => setAction({ ...action, role: event.target.value as DzmmAdminRole })}><option value="user">普通用户</option><option value="super">Super · 全站功能与完整管理权限</option></select></label>}
        <label>操作原因<input value={action.reason} maxLength={200} onChange={event => setAction({ ...action, reason: event.target.value })} placeholder="填写本次调整的原因，便于后续核对" required /></label>{actionError && <p className={s.mutationError} role="alert">{actionError}</p>}
        <footer><button className={s.outline} type="button" onClick={closeAction}>取消</button><button className={s.primary} type="submit">继续确认</button></footer>
      </form>}
    </div></div>}
  </main>;
}

function Overview({ value, onTab, hasPublishing, hasForum }: { value: DzmmAdminOverview; onTab: (tab: Tab) => void; hasPublishing: boolean; hasForum: boolean }) {
  const { stats } = value;
  return <div className={s.overview}>
    <dl className={s.metrics}><div><dt>正式用户</dt><dd>{number(stats.registeredUsers)}</dd><span>{number(stats.guestUsers)} 位游客 · {number(stats.superUsers)} 位 Super</span></div><div><dt>活跃 VIP</dt><dd>{number(stats.activeSubscriptions)}</dd><span>当前拥有有效会员的账号</span></div><div><dt>可用 Credit 总额</dt><dd>{number(stats.totalAvailableCredits)}</dd><span>已预留 {number(stats.totalReservedCredits)} · 已消费 {number(stats.totalSpentCredits)}</span></div></dl>
    <section className={s.overviewSection}><h3>待处理</h3><div className={s.queue}>{hasPublishing && <button onClick={() => onTab("publishing")}><span>角色待审核</span><strong>{number(stats.pendingSubmissions)}</strong><Icon name="chevron" size={16} /></button>}<button onClick={() => onTab("usage")}><span>待完成用量结算</span><strong>{number(stats.pendingUsage)}</strong><Icon name="chevron" size={16} /></button>{hasForum && <button onClick={() => onTab("forum")}><span>论坛主题总数</span><strong>{number(stats.forumPosts)}</strong><Icon name="chevron" size={16} /></button>}</div></section>
    <section className={s.overviewSection}><h3>已支付订单</h3><p>按渠道、币种和支付环境统计原支付金额，包含已退款订单。{value.revenue.some(item => item.currency === "usdt") && "USDT 为已确认订单面额，实际结算和手续费需另行核对。"}</p>{value.revenue.length ? <Table label="已支付订单统计" headers={["渠道", "环境", "订单数", "累计支付金额"]}>{value.revenue.map(item => <tr key={`${item.provider}:${item.currency}:${item.mode}`}><td>{provider(item.provider)}</td><td>{item.mode === "live" ? "正式" : "测试"}</td><td className={s.numeric}>{number(item.paidOrders)}</td><td className={s.numeric}>{money(item.amountMinor, item.currency, item.amountScale)}</td></tr>)}</Table> : <p className={s.noRevenue}>暂无已支付订单。</p>}</section>
    <section className={s.overviewSection}><h3>系统状态</h3><dl className={s.systemFacts}><div><dt>聊天 Credit 扣费</dt><dd>{value.billing.enabled ? "已启用" : "未启用"}</dd></div><div><dt>计费规则版本</dt><dd>{value.billing.priceRevision === null ? "—" : value.billing.priceRevision}</dd></div><div><dt>统计时间</dt><dd>{date(value.serverTime)}</dd></div><div><dt>Super 账户权益</dt><dd>全部功能 · 后台管理 · Credit 正常结算</dd></div></dl></section>
  </div>;
}
