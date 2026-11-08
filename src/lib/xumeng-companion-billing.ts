/** Fixed companion-turn pricing. Amounts are always selected by the backend. */
export const COMPANION_CREDITS_PER_MESSAGE = 2 as const;
export const COMPANION_PRICE_REVISION = 1 as const;
export const COMPANION_RESERVATION_TTL_MS = 600_000;

export type CompanionTurnReceipt = {
  id: string;
  accountId: string;
  requestId: string;
  sessionId: string;
  status: "reserved" | "settled" | "released";
  priceRevision: 1;
  creditsPerMessage: 2;
  reservedCredits: number;
  chargedCredits: number;
  returnedCredits: number;
  billingExempt: false;
  createdAt: number;
  expiresAt: number;
  finalizedAt: number | null;
  outcome: "completed" | "failed" | "expired" | null;
};
export type CompanionReserveInput = {
  sessionToken: string;
  accountId: string;
  requestId: string;
  sessionId: string;
  requestFingerprint: string;
};
export type CompanionClaimInput = { accountId: string; reservationId: string; claimToken: string };
export type CompanionFinalizeInput = CompanionClaimInput & { outcome: "completed" | "failed" };
export type CompanionBillingError = { error: { status: number; message: string; code?: string } };
export type CompanionReserveResult = { enabled: true; receipt: CompanionTurnReceipt; created: boolean; claimToken?: string };
export type CompanionBillingOverview = {
  enabled: boolean;
  priceRevision: 1;
  creditsPerMessage: 2;
  balance: number;
  reservedCredits: number;
  receipts: CompanionTurnReceipt[];
};
/** Named service binding only. Claim tokens must never reach the browser. */
export type CompanionBillingRpcBinding = {
  companionReserve(input: CompanionReserveInput): Promise<CompanionReserveResult | CompanionBillingError>;
  companionFinalize(input: CompanionFinalizeInput): Promise<{ receipt: CompanionTurnReceipt } | CompanionBillingError>;
  companionGet(input: CompanionClaimInput): Promise<{ receipt: CompanionTurnReceipt } | CompanionBillingError>;
  companionReleaseExpired(limit?: number): Promise<{ released: number } | CompanionBillingError>;
};
