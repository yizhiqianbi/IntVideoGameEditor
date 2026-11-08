export type DreamCoinEntry = { id: string; amountFen: number; kind: string; note: string; createdAt: number };
export type DreamCoinWithdrawal = { id: string; amountFen: number; payoutAccount: string; status: "pending" | "paid" | "rejected"; createdAt: number; updatedAt: number };
export type DreamCoinWallet = {
  accountId: string; unit: "梦币"; yuanPerCoin: 1; creditsPerYuan: 100; balanceFen: number;
  earlyRebatePercent: number; laterRebatePercent: number; earlyWindowDays: number;
  minExchangeFen: number; minWithdrawFen: number; withdrawIntervalDays: number;
  entries: DreamCoinEntry[]; withdrawals: DreamCoinWithdrawal[];
};

export class DreamCoinError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "DreamCoinError"; }
}

function yuan(fen: number): string { return (fen / 100).toFixed(2); }
export function formatDreamCoin(fen: number): string { return `${yuan(fen)} 梦币`; }

async function request(path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/backend/v1/dream-coin${path}`, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new DreamCoinError(503, "梦币服务暂时无法连接，请稍后重试。"); }
  const value = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) throw new DreamCoinError(response.status, typeof value?.error === "string" ? value.error : "梦币请求失败，请稍后重试。");
  return value;
}

function parseWallet(value: unknown, accountId: string): DreamCoinWallet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DreamCoinError(502, "梦币记录无效，请稍后重试。");
  const wallet = value as DreamCoinWallet;
  if (wallet.accountId !== accountId || wallet.unit !== "梦币" || wallet.yuanPerCoin !== 1 || wallet.creditsPerYuan !== 100
    || !Number.isInteger(wallet.balanceFen) || !Array.isArray(wallet.entries) || !Array.isArray(wallet.withdrawals)) {
    throw new DreamCoinError(502, "梦币记录无效，请稍后重试。");
  }
  return wallet;
}

export function fetchDreamCoin(accountId: string): Promise<DreamCoinWallet> {
  return request("").then(value => parseWallet(value, accountId));
}

export function exchangeDreamCoin(accountId: string, amountFen: number): Promise<DreamCoinWallet> {
  return request("/exchange", { amountFen }).then(value => parseWallet(value, accountId));
}

export function withdrawDreamCoin(accountId: string, amountFen: number, payoutAccount: string): Promise<DreamCoinWallet> {
  return request("/withdrawals", { amountFen, payoutAccount }).then(value => parseWallet(value, accountId));
}
