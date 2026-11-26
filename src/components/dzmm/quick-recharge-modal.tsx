"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDzmmCheckout,
  DzmmPaymentError,
  fetchDzmmPaymentConfig,
  fetchDzmmPaymentOrder,
  fetchDzmmPaymentWallet,
  isDzmmCheckoutUrl,
  type DzmmPaymentConfig,
  type DzmmPaymentMethod,
  type DzmmPaymentOrder,
  type DzmmPaymentWallet,
} from "../../lib/dzmm-payments";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage } from "../../lib/xumeng-page-copy";
import Icon, { CoinIcon } from "./icons";
import s from "./quick-recharge-modal.module.css";

type Props = {
  userId?: string;
  isGuest: boolean;
  locale?: XumengLocale;
  message?: string;
  onClose: () => void;
  onRequireAccount: (mode: "register" | "login") => void;
  onPaid: () => void;
  onOpenFullRecharge: (focusVip?: boolean) => void;
  onCheckin: () => void;
  onInvite: () => void;
};

type QuickTier = {
  key: string;
  packageId: string;
  amountMinor: number;
  credits: number;
  bonusCredits: number;
  currency: string;
  badge: string;
  badgeTone: "icebreaker" | "popular" | "best" | "plain";
  isCustom?: boolean;
};

const ICEBREAKER_MINOR = 600;
const points = (value: number) => value.toLocaleString("zh-CN");

function money(amountMinor: number, currency: string) {
  const formatter = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency.toUpperCase(),
    currencyDisplay: currency === "cny" ? "symbol" : "code",
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  });
  return formatter.format(amountMinor / 100);
}

function playHint(credits: number) {
  const rounds = Math.max(1, Math.floor(credits / 8));
  const images = Math.max(1, Math.floor(credits / 100));
  return `微光约 ${rounds >= 1000 ? `${(rounds / 1000).toFixed(1).replace(/\.0$/, "")}k` : rounds} 轮 / ${images} 张剧情图`;
}

export function QuickRechargeModal({
  userId,
  isGuest,
  locale = "zh-Hans",
  message,
  onClose,
  onRequireAccount,
  onPaid,
  onOpenFullRecharge,
  onCheckin,
  onInvite,
}: Props) {
  const copy = xumengPage(locale);
  const [config, setConfig] = useState<DzmmPaymentConfig | null>(null);
  const [wallet, setWallet] = useState<DzmmPaymentWallet | null>(null);
  const [loading, setLoading] = useState(!isGuest);
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<DzmmPaymentMethod | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pendingOrder, setPendingOrder] = useState<{ order: DzmmPaymentOrder; checkoutUrl: string; popupBlocked: boolean } | null>(null);
  const [paidOrder, setPaidOrder] = useState<DzmmPaymentOrder | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyTick, setVerifyTick] = useState(0);

  const mounted = useRef(true);
  const requestIds = useRef(new Map<string, string>());
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  useEffect(() => {
    mounted.current = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const loadData = useCallback(async () => {
    if (isGuest || !userId || !XUMENG_PAYMENTS_ENABLED) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const controller = new AbortController();
    try {
      const cfg = await fetchDzmmPaymentConfig(controller.signal);
      if (!mounted.current) return;
      setConfig(cfg);
      const w = await fetchDzmmPaymentWallet(controller.signal, { accountId: userId, mode: cfg.mode, provider: cfg.provider });
      if (!mounted.current) return;
      setWallet(w);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "暂时无法读取充值档位，请稍后再试。");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [isGuest, userId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Build quick-select tiers: ¥6 icebreaker (via legal cny_custom) + server fixed packages
  const tiers: QuickTier[] = [];
  if (config) {
    const custom = config.customAmount;
    const hasSmallFixed = config.packages.some(item => item.amountMinor <= 1000);
    if (custom && !hasSmallFixed && custom.minMinor <= ICEBREAKER_MINOR && custom.maxMinor >= ICEBREAKER_MINOR && ICEBREAKER_MINOR % custom.stepMinor === 0) {
      tiers.push({
        key: "__icebreaker_6",
        packageId: custom.id,
        amountMinor: ICEBREAKER_MINOR,
        credits: ICEBREAKER_MINOR,
        bonusCredits: 0,
        currency: config.currency,
        badge: "破冰首试",
        badgeTone: "icebreaker",
        isCustom: true,
      });
    }
    const fixed = config.packages.slice(0, 3);
    fixed.forEach((item, idx) => {
      const bonus = item.bonusCredits ?? Math.max(0, item.credits - item.amountMinor);
      const isLast = idx === fixed.length - 1 && fixed.length >= 3;
      const isMid = idx === Math.min(1, fixed.length - 1) && !isLast;
      tiers.push({
        key: item.id,
        packageId: item.id,
        amountMinor: item.amountMinor,
        credits: item.credits,
        bonusCredits: bonus,
        currency: item.currency,
        badge: isLast ? "满赠超值" : isMid ? "最多人选" : "首充热选",
        badgeTone: isLast ? "best" : isMid ? "popular" : "plain",
      });
    });
  }

  const firstHalf = wallet?.firstRechargeHalfAvailable === true;
  const dueMinor = (tier: QuickTier) =>
    firstHalf && !tier.isCustom ? Math.max(100, Math.round(tier.amountMinor / 2)) : tier.amountMinor;

  const defaultTierKey =
    tiers.find(t => t.badgeTone === "popular")?.key
    ?? tiers.find(t => !t.isCustom)?.key
    ?? tiers[0]?.key
    ?? "";
  const activeTierKey = tiers.some(t => t.key === selectedKey) ? selectedKey : defaultTierKey;
  const activeTier = tiers.find(t => t.key === activeTierKey);

  const availableMethods = config?.provider === "guagua"
    ? config.methods.filter(item => item.id === "wxpay")
    : (config?.methods ?? []);
  const methodId = availableMethods.some(item => item.id === selectedMethod) ? selectedMethod : availableMethods[0]?.id ?? "";
  const activeMethodLabel = availableMethods.find(item => item.id === methodId)?.label ?? "微信支付";
  const canPay = XUMENG_PAYMENTS_ENABLED && !isGuest && Boolean(config?.enabled && (config.provider === "guagua" || config.provider === "zpay") && activeTier && methodId);

  // Poll pending order in place without leaving chat/studio
  useEffect(() => {
    if (!pendingOrder || !config || !userId || isGuest) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const deadline = Date.now() + 90_000;
    const orderId = pendingOrder.order.id;

    async function poll() {
      if (stopped) return;
      setVerifying(true);
      try {
        const res = await fetchDzmmPaymentOrder(orderId, controller.signal, {
          accountId: userId!,
          mode: config!.mode,
          provider: config!.provider,
        });
        if (stopped || !mounted.current) return;
        setWallet(res);
        if (res.order.status === "paid") {
          setPaidOrder(res.order);
          setPendingOrder(null);
          setVerifying(false);
          onPaidRef.current();
          return;
        }
        if (res.order.status === "expired" || res.order.status === "failed") {
          setError("该订单已失效或未完成付款，可以重新发起支付。");
          setPendingOrder(null);
          setVerifying(false);
          return;
        }
        if (Date.now() < deadline) {
          timer = setTimeout(() => { void poll(); }, 3000);
          return;
        }
      } catch {
        if (!stopped && Date.now() < deadline) {
          timer = setTimeout(() => { void poll(); }, 3500);
          return;
        }
      }
      if (!stopped && mounted.current) setVerifying(false);
    }

    void poll();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [pendingOrder?.order.id, config, userId, isGuest, verifyTick]);

  async function handleCheckout() {
    if (!canPay || submitting || !config || !activeTier || !userId) return;
    if (config.provider !== "guagua" && config.provider !== "zpay") return;
    setSubmitting(true);
    setError("");
    const requestKey = `${userId}:${config.provider}:${methodId}:${activeTier.packageId}:${activeTier.amountMinor}`;
    try {
      let requestId = requestIds.current.get(requestKey);
      if (!requestId) {
        requestId = crypto.randomUUID();
        requestIds.current.set(requestKey, requestId);
      }
      const result = await createDzmmCheckout(
        {
          packageId: activeTier.packageId,
          ...(activeTier.isCustom ? { amountMinor: activeTier.amountMinor } : {}),
          accountId: userId,
          requestId,
          mode: config.mode,
          provider: config.provider,
          method: methodId as DzmmPaymentMethod,
        },
        undefined,
        { id: activeTier.packageId, amountMinor: activeTier.amountMinor, currency: activeTier.currency, credits: activeTier.credits },
      );
      if (!mounted.current) return;
      if (result.order.status === "paid") {
        requestIds.current.delete(requestKey);
        setPaidOrder(result.order);
        onPaidRef.current();
        return;
      }
      if (!isDzmmCheckoutUrl(result.checkoutUrl, config.provider, result.order.id)) {
        throw new Error("支付收银台地址校验未通过，请重试。");
      }
      const opened = window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
      setPendingOrder({
        order: result.order,
        checkoutUrl: result.checkoutUrl,
        popupBlocked: !opened,
      });
    } catch (failure) {
      if (failure instanceof DzmmPaymentError && failure.status === 409) {
        requestIds.current.delete(requestKey);
      }
      if (mounted.current) {
        setError(failure instanceof Error ? failure.message : "创建订单失败，请稍后再试。");
      }
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <div className={s.overlay} role="presentation" onClick={onClose}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="quick-recharge-title" onClick={event => event.stopPropagation()}>
        <button type="button" className={s.closeBtn} aria-label="关闭充值窗口" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>

        <header className={s.head}>
          <div className={s.headTop}>
            <span className={s.promoPill}>
              <Icon name="gift" size={12} />
              {firstHalf ? "首充 5 折已生效 · 永不过期" : "原位直充 · 剧情不断档"}
            </span>
            {!isGuest && wallet && (
              <span className={s.balanceChip}>
                <CoinIcon size={13} />
                余额 {points(wallet.balance)}
              </span>
            )}
          </div>
          <h2 id="quick-recharge-title">{paidOrder ? "充值已到账" : copy.lowBalance}</h2>
          <p className={s.subtitle}>
            {paidOrder
              ? `已成功到账 ${points(paidOrder.credits)} 金币，关闭弹窗即可原位继续体验。`
              : (message || copy.lowBalanceBody) + (isGuest ? copy.guestCreditsUsed : "")}
          </p>
        </header>

        {isGuest ? (
          <div className={s.guestBody}>
            <ul className={s.perks}>
              <li><Icon name="gift" size={14} />新账号注册即领免费金币，立享首单 5 折</li>
              <li><Icon name="sparkles" size={14} />解锁长记忆深聊、剧情高清生图与动态视频</li>
            </ul>
            <div className={s.guestActions}>
              <button type="button" className={s.primaryCta} onClick={() => { onClose(); onRequireAccount("register"); }}>
                <Icon name="gift" size={15} />
                <span>{copy.registerGift}</span>
              </button>
              <button type="button" className={s.secondaryCta} onClick={() => { onClose(); onRequireAccount("login"); }}>
                {copy.haveAccount}
              </button>
            </div>
          </div>
        ) : paidOrder ? (
          <div className={s.paidBox}>
            <div className={s.paidIcon}><Icon name="check" size={24} /></div>
            <strong>+{points(paidOrder.credits)} 金币已入账</strong>
            {wallet && <span>当前可用余额：{points(wallet.balance)} 金币</span>}
            <button type="button" className={s.primaryCta} onClick={onClose}>
              <Icon name="sparkles" size={15} />
              <span>立即返回继续</span>
            </button>
          </div>
        ) : pendingOrder ? (
          <div className={s.pendingBox} role="status" aria-live="polite">
            <div className={s.pendingHead}>
              <span className={s.spinner} aria-hidden="true" />
              <div>
                <strong>{pendingOrder.popupBlocked ? "请点击下方按钮前往收银台付款" : "已打开支付收银台，等待到账确认…"}</strong>
                <p>付款完成后本窗口将自动刷新余额，无需离开当前剧情页面。</p>
              </div>
            </div>
            <div className={s.pendingActions}>
              <a className={s.primaryCta} href={pendingOrder.checkoutUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="zap" size={15} />
                <span>{pendingOrder.popupBlocked ? "打开收银台付款" : "重新打开收银台"}</span>
              </a>
              <div className={s.pendingSubRow}>
                <button type="button" className={s.secondaryCta} disabled={verifying} onClick={() => setVerifyTick(t => t + 1)}>
                  <Icon name="refresh" size={14} />
                  <span>{verifying ? "正在核对…" : "我已支付，刷新余额"}</span>
                </button>
                <button type="button" className={s.ghostBtn} onClick={() => { setPendingOrder(null); setError(""); }}>
                  更换档位
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={s.body}>
            {error && <p className={s.error} role="alert">{error}</p>}

            {!XUMENG_PAYMENTS_ENABLED ? (
              <p className={s.notice}>{copy.paymentsClosed}</p>
            ) : loading ? (
              <div className={s.loadingRow} role="status">正在读取专属充值档位…</div>
            ) : tiers.length > 0 ? (
              <>
                <div className={s.tierGrid} role="radiogroup" aria-label="快捷充值档位">
                  {tiers.map(tier => {
                    const selected = tier.key === activeTierKey;
                    const due = dueMinor(tier);
                    const save = tier.amountMinor - due;
                    return (
                      <button
                        type="button"
                        key={tier.key}
                        role="radio"
                        aria-checked={selected}
                        className={`${s.tierCard} ${selected ? s.tierSelected : ""} ${tier.badgeTone === "icebreaker" ? s.tierIcebreaker : ""} ${tier.badgeTone === "popular" ? s.tierPopular : ""}`}
                        onClick={() => setSelectedKey(tier.key)}
                      >
                        <div className={s.tierTop}>
                          <em className={`${s.tierBadge} ${s[`badge_${tier.badgeTone}`]}`}>{tier.badge}</em>
                          {tier.bonusCredits > 0 && <span className={s.tierBonus}>+{points(tier.bonusCredits)}</span>}
                        </div>
                        <strong className={s.tierCredits}>
                          <CoinIcon size={16} />
                          {points(tier.credits)}
                        </strong>
                        <span className={s.tierHint}>{playHint(tier.credits)}</span>
                        <div className={s.tierPrice}>
                          {save > 0 ? (
                            <>
                              <s>{money(tier.amountMinor, tier.currency)}</s>
                              <b>{money(due, tier.currency)}</b>
                            </>
                          ) : (
                            <b>{money(due, tier.currency)}</b>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {availableMethods.length > 1 && (
                  <div className={s.methodRow} role="radiogroup" aria-label="支付方式">
                    <span>支付方式</span>
                    <div className={s.methodPills}>
                      {availableMethods.map(item => (
                        <button
                          type="button"
                          key={item.id}
                          role="radio"
                          aria-checked={methodId === item.id}
                          className={`${s.methodPill} ${methodId === item.id ? s.methodPillOn : ""}`}
                          onClick={() => setSelectedMethod(item.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className={s.primaryCta}
                  disabled={!canPay || submitting}
                  onClick={() => void handleCheckout()}
                >
                  <Icon name="zap" size={16} />
                  <span>
                    {submitting
                      ? "正在创建订单…"
                      : !config?.enabled
                        ? "充值通道暂未开放"
                        : activeTier
                          ? `${activeMethodLabel} ${money(dueMinor(activeTier), activeTier.currency)} · 得 ${points(activeTier.credits)} 金币`
                          : "立即支付"}
                  </span>
                </button>
              </>
            ) : (
              <button type="button" className={s.primaryCta} onClick={() => { onClose(); onOpenFullRecharge(false); }}>
                <Icon name="gem" size={15} />
                <span>{copy.topUp}</span>
              </button>
            )}

            <button type="button" className={s.vipUpsell} onClick={() => { onClose(); onOpenFullRecharge(true); }}>
              <span className={s.vipUpsellLeft}>
                <Icon name="crown" size={16} />
                <span>
                  <strong>开通 VIP 每天免费领金币</strong>
                  <small>每日 20 条免费语音 + 5 张高清剧情图 + 全站短剧畅看</small>
                </span>
              </span>
              <Icon name="chevron" size={14} />
            </button>

            <div className={s.footRow}>
              <button type="button" className={s.footLink} onClick={() => { onClose(); onCheckin(); }}>
                <Icon name="sun" size={13} />{copy.goCheckin}
              </button>
              <button type="button" className={s.footLink} onClick={() => { onClose(); onInvite(); }}>
                <Icon name="users" size={13} />{copy.goInvite}
              </button>
              <button type="button" className={s.footLink} onClick={() => { onClose(); onOpenFullRecharge(false); }}>
                <Icon name="wallet" size={13} />全部档位
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
