import { prisma } from "./prisma";

export const CREDIT_COSTS = {
  generateScript: 1,
  applyToCanvas: 1,
  generateImage: 2,
  generateVideo: 5,
  generateVideoHQ: 8,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export async function getUserCredits(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });
  return user?.credits ?? 0;
}

export async function deductCredits(
  userId: string,
  action: CreditAction,
): Promise<{ success: boolean; remaining: number; cost: number }> {
  const cost = CREDIT_COSTS[action];
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });

  if (!user || user.credits < cost) {
    return { success: false, remaining: user?.credits ?? 0, cost };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { credits: { decrement: cost } },
    select: { credits: true },
  });

  return { success: true, remaining: updated.credits, cost };
}
