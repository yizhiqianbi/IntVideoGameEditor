"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDzmmCheckout, DzmmPaymentError, fetchDzmmPaymentConfig, fetchDzmmPaymentOrder,
  fetchDzmmPaymentWallet, isDzmmCheckoutUrl, type DzmmPaymentConfig,
  type DzmmPaymentMethod, type DzmmPaymentOrder, type DzmmPaymentStatus, type DzmmPaymentWallet,
} from "../../lib/dzmm-payments";
import Icon, { CoinIcon } from "./icons";
import { SubscriptionCenter } from "./subscription-center";
import { BillingCenter } from "./billing-center";
import { DailyLogin } from "./daily-login";
import { DreamCoinPanel } from "./dream-coin-panel";
import s from "./recharge.module.css";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage } from "../../lib/xumeng-page-copy";

export type RechargeProps = {
  userId: string; isGuest: boolean; onRequireAccount: () => void;
  returnOrderId?: string; cancelled?: boolean; onBack?: () => void; focusVip?: boolean; locale?: XumengLocale;
  onCheckin?: () => void;
};
const STATUS: Record<DzmmPaymentStatus, string> = {
  pending: "待支付确认", paid: "已到账", partially_refunded: "部分退款", refunded: "已退款", expired: "已过期", failed: "未完成支付",
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "充值服务暂时不可用，请稍后再试。";
const points = (value: number) => value.toLocaleString("zh-CN");
function money(amountMinor: number, currency: string) {
  const formatter = new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency.toUpperCase(), currencyDisplay: currency === "cny" ? "symbol" : "code" });
  return formatter.format(amountMinor / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function Recharge({ userId, isGuest, locale = "zh-Hans", onRequireAccount, returnOrderId, cancelled = false, onBack, focusVip = false, onCheckin }: RechargeProps) {
  const copy = xumengPage(locale);
  const statusText = (status: DzmmPaymentStatus) => status === "pending" ? copy.payPending : status === "paid" ? copy.payPaid : status === "partially_refunded" ? copy.payPartial : status === "refunded" ? copy.payRefunded : status === "expired" ? copy.payExpired : copy.payFailed;
  const [config, setConfig] = useState<DzmmPaymentConfig | null>(null);
  const [wallet, setWallet] = useState<DzmmPaymentWallet | null>(null);
  const [selected, setSelected] = useState("");
  const [customYuan, setCustomYuan] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<DzmmPaymentMethod | "">("");
  const [loading, setLoading] = useState(true);
  const [billingRefresh, setBillingRefresh] = useState(0);
  const [pane, setPane] = useState<"points" | "vip">(focusVip ? "vip" : "points");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState("");
  const [inspectedOrderId, setInspectedOrderId] = useState<string | null>(null);
  const [order, setOrder] = useState<DzmmPaymentOrder | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verificationTimedOut, setVerificationTimedOut] = useState(false);
  const [verificationRetry, setVerificationRetry] = useState(0);
  const mounted = useRef(false);
  const account = useRef("");
  const generation = useRef(0);
  const walletRead = useRef(0);
  const walletApplied = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const checkoutController = useRef<AbortController | null>(null);
  const verificationController = useRef<AbortController | null>(null);
  const paymentContext = useRef("");
  const pending = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const accountKey = `${userId}:${isGuest}`;
  account.current = accountKey;

  useEffect(() => { setPane(focusVip ? "vip" : "points"); }, [focusVip]);

  const subscriptionReturnId = returnOrderId?.startsWith("sp_") ? returnOrderId : undefined;
  const activeOrderId = inspectedOrderId ?? (subscriptionReturnId ? undefined : returnOrderId);
  const paymentKey = config ? `${accountKey}:${config.provider}:${config.mode}` : "";
  const configuredMode = config?.mode;
  const configuredProvider = config?.provider;
  const currentWallet = !isGuest && config && wallet?.accountId === userId && wallet.mode === config.mode && wallet.provider === config.provider ? wallet : null;
  const currentOrder = !isGuest && config && order?.accountId === userId && order.mode === config.mode && order.id === activeOrderId ? order : null;
  const custom = config?.customAmount;
  const bestBonusId = (config?.packages ?? []).reduce((best, item) => {
    const bonus = item.bonusCredits ?? 0;
    const ratio = item.credits > 0 ? bonus / item.credits : 0;
    return ratio > best.ratio ? { id: item.id, ratio } : best;
  }, { id: "", ratio: 0 }).id;
  const popularId = config && config.packages.length >= 3
    ? config.packages[Math.min(2, config.packages.length - 1)]?.id ?? ""
    : config?.packages[0]?.id ?? "";
  const defaultPackageId = popularId || bestBonusId || config?.packages[0]?.id || "";
  const packageId = config?.packages.some(item => item.id === selected) || (custom && selected === custom.id)
    ? selected
    : defaultPackageId;
  const maxBonusPct = (config?.packages ?? []).reduce((max, item) => {
    const bonus = item.bonusCredits ?? 0;
    const base = item.credits - bonus;
    if (bonus <= 0 || base <= 0) return max;
    return Math.max(max, Math.round((bonus / base) * 100));
  }, 0);
  const customMinor = /^\d{1,6}$/.test(customYuan) ? Number(customYuan) * 100 : NaN;
  const customValid = !!custom && customMinor >= custom.minMinor && customMinor <= custom.maxMinor && customMinor % custom.stepMinor === 0;
  const selectedPackage = custom && packageId === custom.id
    ? customValid ? { id: custom.id, amountMinor: customMinor, currency: config?.currency ?? "cny", credits: customMinor } : undefined
    : config?.packages.find(item => item.id === packageId);
  const cnyCheckout = config?.provider === "guagua";
  const wechatMethods = config?.methods.filter(item => item.id === "wxpay") ?? [];
  const wechatReady = cnyCheckout && wechatMethods.length > 0;
  const methodId = wechatMethods.some(item => item.id === selectedMethod) ? selectedMethod : wechatMethods[0]?.id ?? "";
  const firstHalf = currentWallet?.firstRechargeHalfAvailable === true;
  /** 首单半价只作用于固定档位，自定义金额不参与；与后端按分取整保持一致。 */
  const payAmount = (item: { id: string; amountMinor: number }) =>
    firstHalf && item.id !== "cny_custom" ? Math.max(100, Math.round(item.amountMinor / 2)) : item.amountMinor;
  const canResume = (entry: DzmmPaymentOrder) => XUMENG_PAYMENTS_ENABLED && !!config?.enabled && entry.provider === "guagua"
    && entry.provider === config.provider && entry.mode === config.mode && entry.status === "pending" && !!entry.checkoutUrl
    && entry.method === "wxpay" && config.methods.some(item => item.id === entry.method);

  const refresh = useCallback(async () => {
    const epoch = ++generation.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setLoading(true); setError(""); setBillingRefresh(value => value + 1);
    try {
      const configuration = await fetchDzmmPaymentConfig(controller.signal);
      if (!mounted.current || account.current !== accountKey || generation.current !== epoch) return;
      const nextContext = `${accountKey}:${configuration.provider}:${configuration.mode}`;
      if (paymentContext.current !== nextContext) {
        paymentContext.current = nextContext;
        checkoutController.current?.abort(); checkoutController.current = null;
        verificationController.current?.abort();
        pending.current = false; requestIds.current.clear();
        setCheckoutBusy(false); setWallet(null); setOrder(null); setInspectedOrderId(null); setSelected(""); setSelectedMethod("");
        setVerifying(false); setVerificationError(""); setVerificationTimedOut(false);
      }
      setConfig(configuration);
      const walletEpoch = ++walletRead.current;
      const balance = isGuest ? null : await fetchDzmmPaymentWallet(controller.signal, { accountId: userId, mode: configuration.mode, provider: configuration.provider });
      if (!mounted.current || account.current !== accountKey || generation.current !== epoch || paymentContext.current !== nextContext) return;
      if (walletEpoch > walletApplied.current) { walletApplied.current = walletEpoch; setWallet(balance); }
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current && account.current === accountKey && generation.current === epoch) setError(errorText(failure));
    } finally {
      if (mounted.current && account.current === accountKey && generation.current === epoch) setLoading(false);
    }
  }, [accountKey, isGuest, userId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false; generation.current += 1;
      refreshController.current?.abort(); checkoutController.current?.abort(); verificationController.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (isGuest || !activeOrderId || !configuredMode || !configuredProvider || paymentContext.current !== paymentKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    verificationController.current = controller;
    const mode = configuredMode;
    const provider = configuredProvider;
    const deadline = Date.now() + 60_000;
    const cancellation = cancelled && activeOrderId === returnOrderId;
    const active = () => !stopped && !controller.signal.aborted && mounted.current && account.current === accountKey && paymentContext.current === paymentKey;
    async function verify() {
      setVerifying(true); setVerificationError(""); setVerificationTimedOut(false);
      try {
        const walletEpoch = ++walletRead.current;
        const result = await fetchDzmmPaymentOrder(activeOrderId as string, controller.signal, { accountId: userId, mode, provider });
        if (!active()) return;
        if (result.accountId !== userId) throw new Error("账户已切换，请登录订单所属账号后查看。");
        setOrder(result.order);
        if (walletEpoch > walletApplied.current) { walletApplied.current = walletEpoch; setWallet(result); }
        if (result.order.status === "pending" && !cancellation && Date.now() < deadline) {
          timer = setTimeout(() => { void verify(); }, 3000);
          return;
        }
        setVerificationTimedOut(result.order.status === "pending" && !cancellation);
      } catch (failure) {
        if (!active() || controller.signal.aborted) return;
        if (failure instanceof DzmmPaymentError && failure.status >= 500 && !cancellation && Date.now() < deadline) {
          timer = setTimeout(() => { void verify(); }, 3000);
          return;
        }
        setVerificationError(errorText(failure));
      }
      if (active()) setVerifying(false);
    }
    void verify();
    return () => { stopped = true; controller.abort(); if (verificationController.current === controller) verificationController.current = null; if (timer) clearTimeout(timer); };
  }, [accountKey, activeOrderId, cancelled, configuredMode, configuredProvider, isGuest, paymentKey, returnOrderId, userId, verificationRetry]);

  async function checkout() {
    if (!XUMENG_PAYMENTS_ENABLED || pending.current || loading || checkoutBusy) return;
    if (isGuest) { onRequireAccount(); return; }
    if (!config?.enabled || config.provider !== "guagua" || !selectedPackage || methodId !== "wxpay" || paymentContext.current !== paymentKey) return;
    pending.current = true; setCheckoutBusy(true); setError("");
    const captured = accountKey;
    const capturedContext = paymentKey;
    const requestKey = `${capturedContext}:${methodId}:${packageId}:${selectedPackage.amountMinor}`;
    let redirecting = false;
    const controller = new AbortController();
    checkoutController.current = controller;
    try {
      let requestId = requestIds.current.get(requestKey);
      if (!requestId) { requestId = crypto.randomUUID(); requestIds.current.set(requestKey, requestId); }
      const body = { packageId, ...(custom && packageId === custom.id ? { amountMinor: selectedPackage.amountMinor } : {}), accountId: userId, requestId, mode: config.mode, provider: "guagua" as const, method: methodId as DzmmPaymentMethod };
      const result = await createDzmmCheckout(body, controller.signal, selectedPackage);
      if (controller.signal.aborted || !mounted.current || account.current !== captured || paymentContext.current !== capturedContext) return;
      if (result.order.status !== "pending") {
        requestIds.current.delete(requestKey);
        setInspectedOrderId(result.order.id); setVerificationRetry(previous => previous + 1);
        return;
      }
      if (!isDzmmCheckoutUrl(result.checkoutUrl, config.provider, result.order.id)) throw new Error("支付地址未通过验证，请重新读取订单。");
      window.location.assign(result.checkoutUrl);
      redirecting = true;
    } catch (failure) {
      if (failure instanceof DzmmPaymentError && failure.status === 409) { requestIds.current.delete(requestKey); void refresh(); }
      if (!controller.signal.aborted && mounted.current && account.current === captured && paymentContext.current === capturedContext) setError(errorText(failure));
    } finally {
      if (!redirecting && checkoutController.current === controller) {
        checkoutController.current = null;
        pending.current = false;
        if (mounted.current && account.current === captured && paymentContext.current === capturedContext) setCheckoutBusy(false);
      }
    }
  }

  async function resumePayment(entry: DzmmPaymentOrder) {
    if (!XUMENG_PAYMENTS_ENABLED) return;
    if (isGuest) { onRequireAccount(); return; }
    if (pending.current || checkoutBusy || loading || !config?.enabled || paymentContext.current !== paymentKey
      || entry.accountId !== userId || !canResume(entry)) return;
    if (!isDzmmCheckoutUrl(entry.checkoutUrl, entry.provider, entry.id)) { setError("该订单暂时不能继续支付，请刷新订单状态。"); return; }
    pending.current = true; setCheckoutBusy(true); setError("");
    const capturedContext = paymentKey;
    const controller = new AbortController();
    checkoutController.current = controller;
    let redirecting = false;
    try {
      const latestConfig = await fetchDzmmPaymentConfig(controller.signal);
      if (latestConfig.mode !== entry.mode || latestConfig.provider !== entry.provider || !latestConfig.enabled
        || ((entry.provider === "zpay" || entry.provider === "guagua") && !latestConfig.methods.some(item => item.id === entry.method))) {
        throw new DzmmPaymentError(409, latestConfig.enabled ? "支付渠道或方式已变更，请刷新余额与套餐后重试。" : "支付暂未开放，请刷新套餐后再试。");
      }
      const result = await fetchDzmmPaymentOrder(entry.id, controller.signal, { accountId: userId, mode: entry.mode, provider: entry.provider });
      if (controller.signal.aborted || !mounted.current || account.current !== accountKey || paymentContext.current !== capturedContext) return;
      if (result.order.status !== "pending") {
        setInspectedOrderId(result.order.id); setOrder(result.order); setVerificationRetry(previous => previous + 1);
        return;
      }
      if (result.order.provider !== entry.provider || result.order.method !== entry.method
        || !isDzmmCheckoutUrl(result.order.checkoutUrl, entry.provider, entry.id)) throw new Error("该订单暂时不能继续支付，请刷新订单状态。");
      window.location.assign(result.order.checkoutUrl);
      redirecting = true;
    } catch (failure) {
      if (failure instanceof DzmmPaymentError && failure.status === 409) void refresh();
      if (!controller.signal.aborted && mounted.current && account.current === accountKey && paymentContext.current === capturedContext) setError(errorText(failure));
    } finally {
      if (!redirecting && checkoutController.current === controller) {
        checkoutController.current = null; pending.current = false;
        if (mounted.current && account.current === accountKey && paymentContext.current === capturedContext) setCheckoutBusy(false);
      }
    }
  }

  const working = loading || checkoutBusy;
  const dueLabel = selectedPackage ? money(payAmount(selectedPackage), selectedPackage.currency) : "";
  const checkoutLabel = checkoutBusy ? "正在创建订单…" : !config?.enabled
    ? "微信支付暂未开通"
    : isGuest ? "登录后充值" : dueLabel ? `微信支付 ${dueLabel}` : "立即支付";
  const cancelledReturn = cancelled && activeOrderId === returnOrderId;
  let orderMessage = verifying ? "正在向服务器核对订单，支付返回链接本身不会增加余额。" : "订单状态以服务器记录为准。";
  if (currentOrder?.status === "paid") orderMessage = `已确认到账 ${points(currentOrder.credits)} 充值点数。余额已读取服务器最新记录。`;
  else if (currentOrder?.status === "partially_refunded") orderMessage = `订单已部分退款，已退回 ${points(currentOrder.refundedCredits)} 点对应的款项，余额已更新。`;
  else if (currentOrder?.status === "refunded") orderMessage = "订单已退款，充值余额已按服务器记录更新。";
  else if (currentOrder?.status === "expired") orderMessage = XUMENG_PAYMENTS_ENABLED ? "该订单已过期，可以重新选择套餐充值。" : "该订单已过期。收款暂时关闭，历史记录仍保留。";
  else if (currentOrder?.status === "failed") orderMessage = "该订单尚未完成付款，请查看订单状态后重新操作。";
  else if (cancelledReturn && !verifying) orderMessage = XUMENG_PAYMENTS_ENABLED ? "你已退出支付页面。订单尚未确认到账，可继续支付或稍后核对。" : "你已返回本站。收款暂时关闭，已付款可稍后核对原订单。";
  else if (verificationTimedOut) orderMessage = "暂未收到到账确认，请稍后重新核对订单。充值余额以服务器记录为准。";

  const granted = (item: { credits: number; bonusCredits?: number }) => {
    const bonus = item.bonusCredits ?? 0;
    const base = bonus > 0 && bonus < item.credits ? item.credits - bonus : item.credits;
    const pct = bonus > 0 && base > 0 ? Math.round((bonus / base) * 100) : 0;
    return { base, bonus: bonus > 0 && bonus < item.credits ? bonus : 0, total: item.credits, pct };
  };
  const playEstimate = (totalCredits: number) => {
    const rounds = Math.max(15, Math.round(totalCredits / 15));
    const pics = Math.max(4, Math.round(totalCredits / 50));
    const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
    return `约深聊 ${fmt(rounds)} 轮 · 生图 ${fmt(pics)} 张`;
  };

  const channelName = (provider: string, method: string | null) => method === "wxpay" || provider === "guagua" ? "微信支付" : provider === "nowpayments" ? "USDT" : "历史订单";
  const membership = <SubscriptionCenter embedded userId={userId} isGuest={isGuest} paymentConfig={config} returnOrderId={subscriptionReturnId}
    refreshKey={billingRefresh}
    cancelled={cancelled && !!subscriptionReturnId} onRequireAccount={onRequireAccount} onCreditChanged={() => { void refresh(); }} />;
  const selectedOffer = selectedPackage ? granted(selectedPackage) : null;
  const savedMinor = selectedPackage && firstHalf && selectedPackage.id !== "cny_custom"
    ? selectedPackage.amountMinor - payAmount(selectedPackage)
    : 0;

  return <main className={s.page}>
    <header className={s.header}>
      <div>
        {onBack && <button type="button" className={s.back} onClick={onBack}><Icon name="back" size={16} />{copy.rechargeCenter}</button>}
        {!onBack && <h1>{copy.rechargeCenter}</h1>}
      </div>
      <div className={s.headerBadges}>
        <span className={s.secureBadge}><Icon name="shield" size={13} />官方直充 · 余额永久有效</span>
      </div>
    </header>

    <section className={s.walletHero} aria-label={copy.walletGold}>
      <div className={s.walletMain}>
        <div className={s.walletEyebrow}>
          <span className={s.walletLabel}><CoinIcon size={20} />{copy.walletGold}余额</span>
          {(firstHalf || isGuest) && <span className={s.firstHalfChip}><Icon name="gift" size={12} />首充 5 折特惠</span>}
        </div>
        <strong className={currentWallet ? undefined : s.walletEmpty}>
          {currentWallet ? points(currentWallet.balance) : "登录后解锁首充 5 折"}
        </strong>
        <small>{currentWallet ? `可用于长记忆模型深聊、剧情生图、视频动效与角色语音` : copy.walletGoldHint}</small>
      </div>
      <div className={s.walletSide}>
        {onCheckin && (
          <button type="button" className={s.freeCoinBtn} onClick={onCheckin}>
            <Icon name="sun" size={14} />
            <span>每日签到领免费金币</span>
          </button>
        )}
        <div className={s.walletMetaRow}>
          <span className={s.walletPill}><Icon name="zap" size={12} />微信支付秒到账</span>
        </div>
      </div>
    </section>

    <ul className={s.valueStrip} aria-label="充值权益保障">
      <li><span className={s.valueIcon}><Icon name="zap" size={15} /></span><div><strong>微信秒到账</strong><small>即刻继续剧情</small></div></li>
      <li><span className={s.valueIcon}><Icon name="sparkles" size={15} /></span><div><strong>全顶级模型</strong><small>长记忆沉浸深聊</small></div></li>
      <li><span className={s.valueIcon}><Icon name="image" size={15} /></span><div><strong>多模态通用</strong><small>生图 · 视频 · 语音</small></div></li>
      <li><span className={s.valueIcon}><Icon name="shield" size={15} /></span><div><strong>永不过期</strong><small>按实耗透明结算</small></div></li>
    </ul>

    {firstHalf && <div className={s.promoBanner} role="status">
      <div className={s.promoBannerLeft}>
        <span className={s.promoIcon}><Icon name="gift" size={18} /></span>
        <div><strong>首单半价特权已激活</strong><p>本账号首笔固定档位立享 5 折，全额金币含加赠完整到账，仅限一次。</p></div>
      </div>
      <span>限时 5 折</span>
    </div>}

    <div className={s.tabs} role="tablist" aria-label={copy.rechargeType}>
      <button type="button" role="tab" aria-selected={pane === "vip"} className={pane === "vip" ? s.tabOn : ""} onClick={() => setPane("vip")}>
        <Icon name="crown" size={15} />
        <span>{copy.member}</span>
        <em className={s.tabTag}>每日领币</em>
      </button>
      <button type="button" role="tab" aria-selected={pane === "points"} className={pane === "points" ? s.tabOn : ""} onClick={() => setPane("points")}>
        <Icon name="gem" size={15} />
        <span>{copy.pointTopUp}</span>
        {maxBonusPct > 0 && <em className={s.tabTag}>最高 +{maxBonusPct}%</em>}
      </button>
    </div>

    {!XUMENG_PAYMENTS_ENABLED && <p className={s.notice} role="note">{copy.paymentsClosed}</p>}
    {XUMENG_PAYMENTS_ENABLED && config && !config.enabled && <p className={s.notice} role="note">{config.note || "微信支付暂未开通。已有余额和订单仍可查看。"}</p>}

    {error && <div className={s.errorBox} role="alert"><p>{error}</p><button type="button" className={s.errorRetry} disabled={working} onClick={() => void refresh()}>重试</button></div>}
    {activeOrderId && <section className={s.returnState} aria-live="polite" aria-label="支付返回订单状态">
      <div className={s.returnTitle}><h2>{currentOrder ? statusText(currentOrder.status) : cancelledReturn ? copy.back : copy.confirming}</h2>{verifying && <span className={s.polling}>{copy.confirming}</span>}</div>
      <p>{isGuest ? "登录订单所属账号后，可以核对是否到账。" : orderMessage}</p>
      <details className={s.orderId}><summary>订单编号</summary><code>{activeOrderId}</code></details>
      {verificationError && <p className={s.error} role="alert">{verificationError}</p>}
      <div className={s.returnActions}>
        {!isGuest && <button type="button" className={s.outline} disabled={verifying || checkoutBusy} onClick={() => setVerificationRetry(previous => previous + 1)}>重新核对</button>}
        {currentOrder && canResume(currentOrder) && <button type="button" className={s.primary} disabled={working || verifying} onClick={() => void resumePayment(currentOrder)}>继续支付</button>}
        {isGuest && <button type="button" className={s.outline} onClick={onRequireAccount}>登录查看</button>}
      </div>
    </section>}

    {pane === "vip" && <section className={s.vipPane} aria-label="会员">{membership}</section>}

    {XUMENG_PAYMENTS_ENABLED && pane === "points" && <section className={s.purchase} aria-labelledby="recharge-packages-title">
      <div className={s.purchaseHead}>
        <div>
          <h2 id="recharge-packages-title">选择金币充值档位</h2>
          <p>充值档位越高加赠越丰厚，金币永不过期，全站角色与模板通用。</p>
        </div>
        {firstHalf && <span className={s.purchasePromoNote}><Icon name="sparkles" size={13} />已自动应用首单 5 折</span>}
      </div>
      {config ? config.packages.length ? <>
        <fieldset className={s.packages} disabled={working}>
          <legend className={s.srOnly}>金币购买档位</legend>
          {config.packages.map(item => {
            const offer = granted(item);
            const isSelected = packageId === item.id;
            const isBest = item.id === bestBonusId;
            const isPopular = item.id === popularId && !isBest;
            const due = payAmount(item);
            const save = firstHalf && item.id !== "cny_custom" ? item.amountMinor - due : 0;
            return <label className={`${s.package} ${isSelected ? s.selected : ""} ${isPopular ? s.packagePopular : ""} ${isBest ? s.packageBest : ""}`} key={item.id}>
              <input type="radio" name="recharge-package" value={item.id} checked={isSelected} onChange={() => setSelected(item.id)} />
              <div className={s.packageTopRow}>
                {isBest ? (
                  <em className={`${s.badge} ${s.badgeBest}`}><Icon name="crown" size={11} />至臻满赠</em>
                ) : isPopular ? (
                  <em className={`${s.badge} ${s.badgePopular}`}><Icon name="flame" size={11} />热门首选</em>
                ) : offer.pct > 0 ? (
                  <em className={s.bonusPctBadge}>+{offer.pct}% 加赠</em>
                ) : (
                  <em className={s.tierHintBadge}>轻享体验</em>
                )}
                <span className={`${s.selectRing} ${isSelected ? s.selectRingOn : ""}`} aria-hidden="true">
                  {isSelected && <Icon name="check" size={11} />}
                </span>
              </div>
              <span className={s.packageCredits}><CoinIcon size={20} />{points(offer.total)}</span>
              <span className={`${s.packageSplit} ${offer.bonus ? s.packageSplitBonus : ""}`}>
                {offer.bonus ? <>含加赠 <b>+{points(offer.bonus)}</b> 金币</> : "1,000 金币入门体验"}
              </span>
              <span className={s.packageUsage}>{playEstimate(offer.total)}</span>
              <div className={s.priceRow}>
                <span className={s.pricePill}>{save > 0
                  ? <><s>{money(item.amountMinor, item.currency)}</s>{money(due, item.currency)}</>
                  : money(item.amountMinor, item.currency)}</span>
                {save > 0 && <em className={s.promoTag}>省 {money(save, item.currency)}</em>}
              </div>
            </label>;
          })}
          {custom && <div className={`${s.customCard} ${packageId === custom.id ? s.selected : ""}`} role="radio" aria-checked={packageId === custom.id} tabIndex={0}
            onClick={() => setSelected(custom.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(custom.id); } }}>
            <div className={s.customHead}>
              <span><strong>自定义充值金额</strong><small>按需灵活补充（1 元 = 100 金币，不参与加赠与首单 5 折）</small></span>
              {customValid && <em className={s.customValue}><CoinIcon size={14} />{points(customMinor)} 金币</em>}
            </div>
            <div className={s.customChips}>
              {[10, 30, 50, 100, 200].filter(value => value * 100 >= custom.minMinor && value * 100 <= custom.maxMinor).map(value =>
                <button type="button" key={value} className={customYuan === String(value) ? s.chipOn : ""} onClick={event => { event.stopPropagation(); setCustomYuan(String(value)); setSelected(custom.id); }}>¥{value}</button>)}
            </div>
            <label className={s.customField}>¥<input inputMode="numeric" aria-label="自定义充值金额（元）" placeholder={`${custom.minMinor / 100}–${custom.maxMinor / 100}`}
              value={customYuan} onFocus={() => setSelected(custom.id)}
              onChange={event => { setCustomYuan(event.target.value.trim().slice(0, 8)); setSelected(custom.id); }} /></label>
            {packageId === custom.id && !customValid && <p className={s.customHint}>请输入 {custom.minMinor / 100}–{custom.maxMinor / 100} 元之间的金额</p>}
          </div>}
        </fieldset>
        <div className={s.paybar}>
          <div className={s.payInfo}>
            <span className={s.payTotalLine}>
              到账 <em><CoinIcon size={15} />{selectedPackage ? `${points(selectedPackage.credits)} 金币` : "请选择档位"}</em>
              {selectedOffer && selectedOffer.bonus > 0 && <b className={s.payBonusPill}>已含赠 {points(selectedOffer.bonus)}</b>}
            </span>
            {savedMinor > 0 && selectedPackage
              ? <span className={s.promoOld}>首单 5 折已立省 {money(savedMinor, selectedPackage.currency)}（原价 {money(selectedPackage.amountMinor, selectedPackage.currency)}）</span>
              : <span><Icon name="shield" size={12} />微信安全收银台 · 支付成功即刻自动到账</span>}
          </div>
          <button type="button" className={`${s.primary} ${s.payCta}`} disabled={working || !wechatReady || !config.enabled || !selectedPackage} onClick={() => void checkout()}>
            <Icon name="zap" size={16} />
            <span>{checkoutLabel}</span>
          </button>
        </div>
        <button type="button" className={s.vipHint} onClick={() => setPane("vip")}>
          <span className={s.vipHintLeft}>
            <span className={s.vipHintCrown}><Icon name="crown" size={16} /></span>
            <span><strong>高频畅聊推荐开通 VIP</strong><small>每天领最高 800 金币 + 每日语音/生图额度 + 全站短剧免费看</small></span>
          </span>
          <strong className={s.vipHintAction}>查看 VIP 特权 <Icon name="chevron" size={14} /></strong>
        </button>
      </> : <p className={s.empty}>目前没有可购买的档位。</p> : <p className={s.empty}>{loading ? "正在读取档位…" : "暂时无法读取档位。"}</p>}
    </section>}

    <DailyLogin userId={userId} isGuest={isGuest} locale={locale} onRequireAccount={onRequireAccount}
      onCreditChanged={() => { void refresh(); }} onViewAll={onCheckin} />

    {pane === "points" && <BillingCenter key={accountKey} userId={userId} isGuest={isGuest} modelBillingLinked={config?.modelBillingLinked ?? false} refreshKey={billingRefresh} onRequireAccount={onRequireAccount} />}

    {!isGuest && <section className={s.currencies} aria-labelledby="recharge-currencies-title">
      <h2 id="recharge-currencies-title">金币与梦币</h2>
      <div className={s.currencyRow}>
        <div className={s.currencyCard}>
          <span className={s.currencyName}><CoinIcon size={18} />{copy.walletGold}</span>
          <strong>{currentWallet ? points(currentWallet.balance) : "—"}</strong>
          <p>{copy.walletGoldHint}</p>
          <small>每日登录、任务奖励、充值获得。</small>
        </div>
        <div className={s.currencyCard}>
          <span className={s.currencyName}><Icon name="sparkles" size={15} />{copy.walletDream}</span>
          <strong>{copy.creatorIncentive}</strong>
          <p>{copy.walletDreamHint}</p>
          <small>作品被游玩、被收藏产生的分成，按人民币记账。</small>
        </div>
      </div>
      <DreamCoinPanel userId={userId} compact />
    </section>}

    <section className={s.history} aria-labelledby="recharge-orders-title">
      <div className={s.sectionHeading}><h2 id="recharge-orders-title">订单</h2><span>{currentWallet ? `${currentWallet.orders.length}` : ""}</span></div>
      {isGuest ? <p className={s.empty}>登录后查看订单。</p> : currentWallet ? currentWallet.orders.length ? <ul>{currentWallet.orders.map(entry => <li className={s.order} key={entry.id}>
        <div className={s.orderMain}>
          <strong>{money(entry.amountMinor, entry.currency)}<span>{points(entry.credits)} 金币</span></strong>
          <time dateTime={new Date(entry.createdAt).toISOString()}>{date(entry.createdAt)} · {channelName(entry.provider, entry.method)}</time>
        </div>
        <div className={s.orderAction}>
          <span className={entry.status === "paid" ? s.paid : s.orderStatus}>{statusText(entry.status)}</span>
          <button type="button" className={s.textButton} disabled={checkoutBusy} onClick={() => { setInspectedOrderId(entry.id); setVerificationRetry(previous => previous + 1); }}>核对</button>
          {canResume(entry) && <button type="button" className={s.outline} disabled={working} onClick={() => void resumePayment(entry)}>继续支付</button>}
        </div>
      </li>)}</ul> : <p className={s.empty}>还没有订单。</p> : <p className={s.empty}>{loading ? "正在读取订单…" : "暂时无法读取订单。"}</p>}
    </section>
  </main>;
}
