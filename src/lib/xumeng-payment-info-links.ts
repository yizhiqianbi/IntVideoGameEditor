/** Lightweight footer links for payment info pages so main bundle avoids full policy copy. */
export const XUMENG_PAYMENT_INFO_DRAFT = true;

export const XUMENG_PAYMENT_INFO_LINKS = [
  { path: "/pricing", label: "方案与价格" },
  { path: "/terms", label: "服务条款" },
  { path: "/privacy", label: "隐私政策" },
  { path: "/refund-policy", label: "退款说明" },
  { path: "/support", label: "联系支持" },
] as const;
