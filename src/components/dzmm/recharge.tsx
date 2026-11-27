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
import { DreamCoinPanel } from "./dream-coin-panel";
import s from "./recharge.module.css";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage } from "../../lib/xumeng-page-copy";

export type RechargeProps = {
  userId: string; isGuest: boolean; onRequireAccount: () => void;
  returnOrderId?: string; cancelled?: boolean; onBack?: () => void; focusVip?: boolean; locale?: XumengLocale;
  onCheckin?: () => void;
  onWalletChanged?: (wallet: DzmmPaymentWallet) => void;
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

export function Recharge({ userId, isGuest, locale = "zh-Hans", onRequireAccount, returnOrderId, cancelled = false, onBack, focusVip = false, onCheckin, onWalletChanged }: RechargeProps) {
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
  const [showCustom, setShowCustom] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
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
  const onWalletChangedRef = useRef(onWalletChanged);
  onWalletChangedRef.current = onWalletChanged;
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
  const ICEBREAKER_ID = "__cny_icebreaker_6";
  const ICEBREAKER_MINOR = 600;
  const hasSmallFixed = (config?.packages ?? []).some(item => item.amountMinor <= 1000);
  const icebreakerAvailable = Boolean(custom && !hasSmallFixed && custom.minMinor <= ICEBREAKER_MINOR && custom.maxMinor >= ICEBREAKER_MINOR && ICEBREAKER_MINOR % custom.stepMinor === 0);
  const bestBonusId = (config?.packages ?? []).reduce((best, item) => {
    const bonus = item.bonusCredits ?? 0;
    const ratio = item.credits > 0 ? bonus / item.credits : 0;
    return ratio > best.ratio ? { id: item.id, ratio } : best;
  }, { id: "", ratio: 0 }).id;
  const popularId = config && config.packages.length >= 3
    ? config.packages[Math.min(2, config.packages.length - 1)]?.id ?? ""
    : config?.packages[0]?.id ?? "";
  const defaultPackageId = popularId || bestBonusId || config?.packages[0]?.id || (icebreakerAvailable ? ICEBREAKER_ID : "");
  const packageId = config?.packages.some(item => item.id === selected)
    || (icebreakerAvailable && selected === ICEBREAKER_ID)
    || (custom && selected === custom.id)
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
  const isIcebreaker = icebreakerAvailable && packageId === ICEBREAKER_ID;
  const selectedPackage = isIcebreaker && custom
    ? { id: custom.id, amountMinor: ICEBREAKER_MINOR, currency: config?.currency ?? "cny", credits: ICEBREAKER_MINOR }
    : custom && packageId === custom.id
      ? customValid ? { id: custom.id, amountMinor: customMinor, currency: config?.currency ?? "cny", credits: customMinor } : undefined
      : config?.packages.find(item => item.id === packageId);
  const cnyCheckout = config?.provider === "guagua" || config?.provider === "zpay";
  const availableMethods = config?.provider === "guagua"
    ? (config.methods.filter(item => item.id === "wxpay"))
    : (config?.methods ?? []);
  const methodReady = cnyCheckout && availableMethods.length > 0;
  const methodId = availableMethods.some(item => item.id === selectedMethod) ? selectedMethod : availableMethods[0]?.id ?? "";
  const activeMethodLabel = availableMethods.find(item => item.id === methodId)?.label ?? "微信支付";
  const firstHalf = currentWallet?.firstRechargeHalfAvailable === true;
  /** 首单半价只作用于固定档位，自定义金额（含破冰体验充）不参与；与后端按分取整保持一致。 */
  const payAmount = (item: { id: string; amountMinor: number }) =>
    firstHalf && item.id !== "cny_custom" ? Math.max(100, Math.round(item.amountMinor / 2)) : item.amountMinor;
  const canResume = (entry: DzmmPaymentOrder) => XUMENG_PAYMENTS_ENABLED && !!config?.enabled
    && (entry.provider === "guagua" || entry.provider === "zpay")
    && entry.provider === config.provider && entry.mode === config.mode && entry.status === "pending" && !!entry.checkoutUrl
    && !!entry.method && availableMethods.some(item => item.id === entry.method);

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
      if (walletEpoch > walletApplied.current) { walletApplied.current = walletEpoch; setWallet(balance); if (balance) onWalletChangedRef.current?.(balance); }
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
        if (walletEpoch > walletApplied.current) { walletApplied.current = walletEpoch; setWallet(result); onWalletChangedRef.current?.(result); }
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
    if (!config?.enabled || (config.provider !== "guagua" && config.provider !== "zpay") || !selectedPackage || !methodId || paymentContext.current !== paymentKey) return;
    pending.current = true; setCheckoutBusy(true); setError("");
    const captured = accountKey;
    const capturedContext = paymentKey;
    const submitPackageId = selectedPackage.id;
    const requestKey = `${capturedContext}:${methodId}:${submitPackageId}:${selectedPackage.amountMinor}`;
    let redirecting = false;
    const controller = new AbortController();
    checkoutController.current = controller;
    try {
      let requestId = requestIds.current.get(requestKey);
      if (!requestId) { requestId = crypto.randomUUID(); requestIds.current.set(requestKey, requestId); }
      const body = { packageId: submitPackageId, ...(custom && submitPackageId === custom.id ? { amountMinor: selectedPackage.amountMinor } : {}), accountId: userId, requestId, mode: config.mode, provider: config.provider, method: methodId as DzmmPaymentMethod };
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
    ? "充值通道暂未开通"
    : isGuest ? "登录后充值" : dueLabel ? `${activeMethodLabel} ${dueLabel}` : "立即支付";
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
    const rounds = Math.max(10, Math.floor(totalCredits / 8));
    const pics = Math.max(1, Math.floor(totalCredits / 100));
    const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
    return `约 ${fmt(rounds)} 轮深聊 · ${fmt(pics)} 张图`;
  };

  const channelName = (provider: string, method: string | null) => method === "wxpay" || provider === "guagua" ? "微信支付" : provider === "nowpayments" ? "USDT" : "历史订单";
  const membership = <SubscriptionCenter embedded userId={userId} isGuest={isGuest} paymentConfig={config} returnOrderId={subscriptionReturnId}
    refreshKey={billingRefresh}
    cancelled={cancelled && !!subscriptionReturnId} onRequireAccount={onRequireAccount} onCreditChanged={() => { void refresh(); }} />;
  const selectedOffer = selectedPackage ? granted(selectedPackage) : null;
  const savedMinor = selectedPackage && firstHalf && selectedPackage.id !== "cny_custom"
    ? selectedPackage.amountMinor - payAmount(selectedPackage)
    : 0;

  const totalFixedCards = (config?.packages.length ?? 0) + (icebreakerAvailable ? 1 : 0);

  return <main className={s.page}>
    <header className={s.header}>
      <div className={s.headerLeft}>
        {onBack ? <button type="button" className={s.back} onClick={onBack}><Icon name="back" size={16} />{copy.rechargeCenter}</button>
          : <h1>{copy.rechargeCenter}</h1>}
      </div>
      <div className={s.headerRight}>
        <div className={s.balancePill} aria-label={copy.walletGold}>
          <CoinIcon size={15} />
          <strong>{currentWallet ? points(currentWallet.balance) : isGuest ? "未登录" : "—"}</strong>
          {currentWallet && <span>金币</span>}
        </div>
        {onCheckin && (
          <button type="button" className={s.iconPillBtn} onClick={onCheckin} title="每日签到领金币">
            <Icon name="sun" size={13} />
            <span>签到</span>
          </button>
        )}
        <button type="button" className={`${s.iconPillBtn} ${showLedger ? s.iconPillBtnOn : ""}`} onClick={() => setShowLedger(v => !v)}>
          <span>账单</span>
        </button>
      </div>
    </header>

    <div className={s.tabWrap}>
      <div className={s.tabs} role="tablist" aria-label={copy.rechargeType}>
        <button type="button" role="tab" aria-selected={pane === "vip"} className={pane === "vip" ? s.tabOn : ""} onClick={() => setPane("vip")}>
          <span>{copy.member}</span>
        </button>
        <button type="button" role="tab" aria-selected={pane === "points"} className={pane === "points" ? s.tabOn : ""} onClick={() => setPane("points")}>
          <span>{copy.pointTopUp}</span>
        </button>
      </div>
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
      <h2 id="recharge-packages-title" className={s.srOnly}>选择金币充值档位</h2>
      {(firstHalf || availableMethods.length > 1) && (
        <div className={s.subStrip}>
          {firstHalf && (
            <p className={s.promoMicro} role="status">
              <Icon name="sparkles" size={12} />
              <span>新客首单立享 5 折 · 含加赠全额到账</span>
            </p>
          )}
          {availableMethods.length > 1 && <div className={s.methodPickerInline} role="radiogroup" aria-label="选择支付方式">
            {availableMethods.map(item => (
              <button type="button" key={item.id} role="radio" aria-checked={methodId === item.id}
                className={`${s.methodPill} ${methodId === item.id ? s.methodPillOn : ""}`}
                onClick={() => setSelectedMethod(item.id)}>
                {item.label}
              </button>
            ))}
          </div>}
        </div>
      )}

      {config ? config.packages.length ? <>
        <fieldset className={`${s.packages} ${totalFixedCards === 4 ? s.packagesFour : ""}`} disabled={working}>
          <legend className={s.srOnly}>金币购买档位</legend>
          {icebreakerAvailable && <label className={`${s.package} ${s.tierGlow0} ${isIcebreaker ? s.selected : ""}`} key={ICEBREAKER_ID}>
            <input type="radio" name="recharge-package" value={ICEBREAKER_ID} checked={isIcebreaker} onChange={() => setSelected(ICEBREAKER_ID)} />
            <div className={s.packageTopRow}>
              <span className={s.tierTag}>尝鲜</span>
              <span className={`${s.selectDot} ${isIcebreaker ? s.selectDotOn : ""}`} aria-hidden="true">
                {isIcebreaker && <Icon name="check" size={10} />}
              </span>
            </div>
            <div className={s.packageBody}>
              <span className={s.packageCredits}><CoinIcon size={18} />{points(ICEBREAKER_MINOR)}</span>
              <span className={s.packageBonus}>低门槛轻体验</span>
              <span className={s.packageUsage}>{playEstimate(ICEBREAKER_MINOR)}</span>
            </div>
            <div className={s.priceRow}>
              <span className={s.priceValue}>{money(ICEBREAKER_MINOR, config.currency)}</span>
            </div>
          </label>}
          {config.packages.map((item, idx) => {
            const offer = granted(item);
            const isSelected = packageId === item.id;
            const isBest = item.id === bestBonusId;
            const isPopular = item.id === popularId && !isBest;
            const due = payAmount(item);
            const save = firstHalf && item.id !== "cny_custom" ? item.amountMinor - due : 0;
            const isLastOdd = totalFixedCards % 2 === 1 && idx === config.packages.length - 1;
            const glowClass = idx === 0 ? s.tierGlow0 : idx === 1 ? s.tierGlow1 : s.tierGlow2;
            return <label className={`${s.package} ${glowClass} ${isLastOdd ? s.packageWideMobile : ""} ${isSelected ? s.selected : ""}`} key={item.id}>
              <input type="radio" name="recharge-package" value={item.id} checked={isSelected} onChange={() => setSelected(item.id)} />
              <div className={s.packageTopRow}>
                {isBest ? (
                  <span className={`${s.tierTag} ${s.tierTagHot}`}>最超值</span>
                ) : isPopular ? (
                  <span className={`${s.tierTag} ${s.tierTagHot}`}>热门</span>
                ) : offer.pct > 0 ? (
                  <span className={s.tierTag}>+{offer.pct}%</span>
                ) : (
                  <span className={s.tierTag}>轻享</span>
                )}
                <span className={`${s.selectDot} ${isSelected ? s.selectDotOn : ""}`} aria-hidden="true">
                  {isSelected && <Icon name="check" size={10} />}
                </span>
              </div>
              <div className={s.packageBody}>
                <span className={s.packageCredits}><CoinIcon size={18} />{points(offer.total)}</span>
                <span className={`${s.packageBonus} ${offer.bonus ? s.packageBonusAccent : ""}`}>
                  {offer.bonus ? `含赠 +${points(offer.bonus)} 金币` : "金币永不过期"}
                </span>
                <span className={s.packageUsage}>{playEstimate(offer.total)}</span>
              </div>
              <div className={s.priceRow}>
                <span className={s.priceValue}>
                  {money(due, item.currency)}
                  {save > 0 && <s>{money(item.amountMinor, item.currency)}</s>}
                </span>
                {save > 0 && <em className={s.saveNote}>5折</em>}
              </div>
            </label>;
          })}
        </fieldset>

        {custom && (
          <div className={`${s.customWrap} ${showCustom || packageId === custom.id ? s.customOpen : ""}`}>
            <button
              type="button"
              className={s.customToggle}
              aria-expanded={showCustom || packageId === custom.id}
              onClick={() => {
                const next = !(showCustom || packageId === custom.id);
                setShowCustom(next);
                if (next) setSelected(custom.id);
                else if (packageId === custom.id) setSelected(defaultPackageId);
              }}
            >
              <span>自定义金额充值</span>
              <span className={s.customToggleRight}>
                {customValid && packageId === custom.id ? `${points(customMinor)} 金币` : "1 元 = 100 金币"}
                <Icon name="chevron" size={14} />
              </span>
            </button>
            {(showCustom || packageId === custom.id) && (
              <div className={`${s.customBody} ${packageId === custom.id ? s.selected : ""}`} onClick={() => setSelected(custom.id)}>
                <div className={s.customChips}>
                  {[6, 10, 30, 50, 100, 200].filter(value => value * 100 >= custom.minMinor && value * 100 <= custom.maxMinor).map(value =>
                    <button type="button" key={value} className={customYuan === String(value) ? s.chipOn : ""} onClick={event => { event.stopPropagation(); setCustomYuan(String(value)); setSelected(custom.id); }}>¥{value}</button>)}
                </div>
                <div className={s.customInputRow}>
                  <label className={s.customField}><span>¥</span><input inputMode="numeric" aria-label="自定义充值金额（元）" placeholder={`${custom.minMinor / 100}–${custom.maxMinor / 100}`}
                    value={customYuan} onFocus={() => setSelected(custom.id)}
                    onChange={event => { setCustomYuan(event.target.value.trim().slice(0, 8)); setSelected(custom.id); }} /></label>
                  {customValid && <span className={s.customPreview}><CoinIcon size={13} />{points(customMinor)} 金币</span>}
                </div>
                {packageId === custom.id && !customValid && <p className={s.customHint}>请输入 {custom.minMinor / 100}–{custom.maxMinor / 100} 元之间的金额</p>}
              </div>
            )}
          </div>
        )}

        <div className={s.paybar}>
          <div className={s.paySummary}>
            <span className={s.payTotalLine}>
              <strong>{selectedPackage ? `${points(selectedPackage.credits)} 金币` : "请选择档位"}</strong>
              {selectedOffer && selectedOffer.bonus > 0 && <em className={s.payBonusText}>含赠 +{points(selectedOffer.bonus)}</em>}
            </span>
            <span className={s.paySubline}>
              {savedMinor > 0 && selectedPackage
                ? `首单 5 折已省 ${money(savedMinor, selectedPackage.currency)} · 永不过期`
                : `${activeMethodLabel} · 秒到账 · 余额永不过期`}
            </span>
          </div>
          <button type="button" className={`${s.primary} ${s.payCta}`} disabled={working || !methodReady || !config.enabled || !selectedPackage} onClick={() => void checkout()}>
            <span>{checkoutLabel}</span>
          </button>
        </div>
      </> : <p className={s.empty}>目前没有可购买的档位。</p> : <p className={s.empty}>{loading ? "正在读取档位…" : "暂时无法读取档位。"}</p>}
    </section>}

    <div className={s.ledgerBar}>
      <button type="button" className={s.ledgerToggle} aria-expanded={showLedger} onClick={() => setShowLedger(v => !v)}>
        <span>{showLedger ? "收起订单与消费明细" : "查看订单记录、消费明细与梦币"}</span>
        <Icon name="chevron" size={14} />
      </button>
    </div>

    {showLedger && <div className={s.ledgerDrawer}>
      {pane === "points" && <BillingCenter key={accountKey} userId={userId} isGuest={isGuest} modelBillingLinked={config?.modelBillingLinked ?? false} refreshKey={billingRefresh} onRequireAccount={onRequireAccount} />}

      {!isGuest && <section className={s.currencies} aria-labelledby="recharge-currencies-title">
        <h2 id="recharge-currencies-title">金币与梦币</h2>
        <div className={s.currencyRow}>
          <div className={s.currencyCard}>
            <span className={s.currencyName}><CoinIcon size={16} />{copy.walletGold}</span>
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
        <div className={s.sectionHeading}><h2 id="recharge-orders-title">订单记录</h2><span>{currentWallet ? `${currentWallet.orders.length} 笔` : ""}</span></div>
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
    </div>}
  </main>;
}
