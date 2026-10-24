import { prisma } from "./prisma";
import {
  getLocalCachedUserById,
  isLocalCachedUserId,
  updateLocalCachedUserCredits,
} from "./local-auth-cache";

export const CREDIT_COSTS = {
  generateScript: 1,
  applyToCanvas: 1,
  generateImage: 2,
  generateVideo: 5,
  generateVideoHQ: 8,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export async function getUserCredits(userId: string): Promise<number> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (user) {
      return user.credits;
    }
  } catch {
    // Fall back to local cached users below.
  }

  const localUser = await getLocalCachedUserById(userId);
  return localUser?.credits ?? 0;
}

export async function deductCredits(
  userId: string,
  action: CreditAction,
): Promise<{ success: boolean; remaining: number; cost: number }> {
  const cost = CREDIT_COSTS[action];

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (user) {
      if (user.credits < cost) {
        return { success: false, remaining: user.credits, cost };
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: cost } },
        select: { credits: true },
      });

      return { success: true, remaining: updated.credits, cost };
    }
  } catch {
    // Fall back to local cached users below.
  }

  if (!isLocalCachedUserId(userId)) {
    return { success: false, remaining: 0, cost };
  }

  const localUser = await getLocalCachedUserById(userId);

  if (!localUser || localUser.credits < cost) {
    return { success: false, remaining: localUser?.credits ?? 0, cost };
  }

  const remaining = localUser.credits - cost;
  await updateLocalCachedUserCredits(userId, remaining);

  return { success: true, remaining, cost };
}
