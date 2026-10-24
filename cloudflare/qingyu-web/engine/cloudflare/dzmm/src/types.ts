import type { Ai, D1Database, R2Bucket, SendEmail } from "@cloudflare/workers-types";
import type { DzmmSavedState } from "../../../src/lib/dzmm-storage";

export type ViduVoiceServiceBinding = {
  configured(): Promise<boolean>;
  generate(input: { text: string; voiceId: string }): Promise<{
    bytes: ArrayBuffer; mimeType: string; providerCredits: number; taskId: string;
  }>;
};

export type Env = {
  TELEGRAM_FEEDBACK_ENABLED?: string;
  TELEGRAM_FEEDBACK_BOT_ID?: string;
  TELEGRAM_FEEDBACK_BOT_USERNAME?: string;
  TELEGRAM_FEEDBACK_ALLOWED_CHAT_IDS?: string;
  TELEGRAM_FEEDBACK_WEBHOOK_SECRET?: string;
  GENERATION_ENABLED?: string;
  GENERATION_OPENROUTER_API_KEY?: string;
  GENERATION_USD_TO_CNY?: string;
  DB: D1Database;
  MEDIA?: R2Bucket;
  AI?: Ai;
  VIDU_VOICE?: ViduVoiceServiceBinding;
  CHAT_MEDIA_ENABLED?: string;
  APP_ORIGINS: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PAYMENT_MODE?: string;
  PAYMENTS_RETURN_ORIGIN?: string;
  EMAIL?: SendEmail;
  EMAIL_AUTH_ENABLED?: string;
  EMAIL_FROM?: string;
  EMAIL_OTP_SECRET?: string;
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  PAYMENT_PROVIDER?: string;
  NOWPAYMENTS_ENABLED?: string;
  NOWPAYMENTS_API_KEY?: string;
  NOWPAYMENTS_IPN_SECRET?: string;
  NOWPAYMENTS_PAY_CURRENCY?: string;
  /** Waffo Pancake is opt-in and remains inert until collection is enabled. */
  WAFFO_ENABLED?: string;
  /** Allows only the sandbox Waffo flow while global collection is paused. */
  WAFFO_SANDBOX_ACCEPTANCE_ENABLED?: string;
  /** Exact disposable account allowed to run the sandbox acceptance flow. */
  WAFFO_SANDBOX_ACCOUNT_ID?: string;
  WAFFO_ENVIRONMENT?: string;
  WAFFO_API_BASE_URL?: string;
  WAFFO_MERCHANT_ID?: string;
  WAFFO_PRIVATE_KEY?: string;
  WAFFO_API_KEY?: string;
  WAFFO_PUBLIC_KEY?: string;
  WAFFO_STORE_ID?: string;
  WAFFO_PRODUCT_ID?: string;
  WAFFO_WEBHOOK_TEST_PUBLIC_KEY?: string;
  WAFFO_WEBHOOK_PROD_PUBLIC_KEY?: string;
  /** Opt-in gate for creating new recharge or subscription payment orders. */
  PAYMENTS_ACCEPTING_ENABLED?: string;
  ZPAY_ENABLED?: string;
  ZPAY_PID?: string;
  ZPAY_KEY?: string;
  ZPAY_ALIPAY_CHANNEL_ID?: string;
  ZPAY_WXPAY_CHANNEL_ID?: string;
  /** Guagua CNY checkout. Secrets stay in Worker secrets, not in source. */
  GUAGUA_ENABLED?: string;
  GUAGUA_MID?: string;
  GUAGUA_SECRET?: string;
  GUAGUA_CHANNEL_CODE?: string;
  SUBSCRIPTION_ENABLED?: string;
  SUBSCRIPTION_PLANS_JSON?: string;
  CREDIT_BILLING_ENABLED?: string;
  CREDIT_BILLING_RATES_JSON?: string;
  CREDIT_BILLING_COST_POLICY_JSON?: string;
  /** Fixed companion turns are independently gated and closed by default. */
  COMPANION_BILLING_ENABLED?: string;
};

export type UserRecord = {
  id: string;
  email: string | null;
  nickname: string;
  isGuest: boolean;
  role: "user" | "super";
  version: number;
  emailVerified?: boolean;
  hasPassword?: boolean;
  passwordSetupRequired?: boolean;
};

export type StateEnvelope = {
  state: DzmmSavedState;
  version: number;
  initialized: boolean;
  user: Omit<UserRecord, "version">;
};
