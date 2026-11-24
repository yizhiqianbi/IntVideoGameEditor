"use client";

import { useEffect, useState } from "react";

export function useCharacterCreateCost() {
  const [cost, setCost] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/backend/v1/billing/scene-prices", { credentials: "same-origin", cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then((body: { prices?: { scene?: string; amount?: number }[] } | null) => {
        const amount = body?.prices?.find(item => item.scene === "character")?.amount;
        if (live && typeof amount === "number" && amount > 0) setCost(amount);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return cost;
}

export function characterCreateLabel(cost: number | null, base = "创建角色") {
  return cost ? `${base} · ${cost} Credit` : base;
}
