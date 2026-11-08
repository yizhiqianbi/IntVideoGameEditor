import type { AcquisitionLanding } from "./xumeng-acquisition";

export async function recordXumengAcquisition(landing: AcquisitionLanding): Promise<boolean> {
  try {
    const response = await fetch("/api/backend/v1/acquisition", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: landing.source,
        ...(landing.inviteCode ? { inviteCode: landing.inviteCode } : {}),
        ...(landing.characterId ? { characterId: landing.characterId } : {}),
        ...(landing.poster ? { poster: landing.poster } : {}),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
