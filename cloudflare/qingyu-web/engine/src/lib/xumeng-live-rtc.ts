/** Receiving-only Vidu media guards. No credentials or provider requests live here. */
export function isXumengLivePublisher(uid: unknown): uid is string {
  return typeof uid === "string" && /^live-(bot|video-push)-[A-Za-z0-9._:-]+$/.test(uid) && uid.length <= 300;
}

type Session = { id: string; mode: string; status: string } | null;
/** Claim once before an asynchronous join, so repeated ready polls cannot rejoin. */
export class XumengLiveRtcJoinGate {
  private attempted = new Set<string>();
  claim(session: Session, expectedId: string, epoch: number, leaseId: string) {
    if (!session || session.id !== expectedId || session.mode !== "real" || session.status !== "ready" || !leaseId) return false;
    const key = JSON.stringify([epoch, leaseId, expectedId]);
    if (this.attempted.has(key)) return false;
    this.attempted.add(key);
    if (this.attempted.size > 20) this.attempted.delete(this.attempted.values().next().value!);
    return true;
  }
  clear() { this.attempted.clear(); }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function counter(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : 0; }
export type XumengLiveAudioEvidence = { bytes: number; packets: number; energy: number };
/** SDK 7.3.4 remote stats expose WebRTC counters inside stats.inboundRtpStats. */
export function readXumengLiveAudioEvidence(value: unknown): XumengLiveAudioEvidence | null {
  if (!Array.isArray(value)) return null;
  let bytes = 0, packets = 0, energy = 0;
  for (const entry of value.slice(0, 50)) {
    if (!object(entry) || !isXumengLivePublisher(entry.uid) || !object(entry.stats)) continue;
    const stats = object(entry.stats.inboundRtpStats) ? entry.stats.inboundRtpStats : entry.stats;
    if (stats.kind !== undefined && stats.kind !== "audio" || stats.mediaType !== undefined && stats.mediaType !== "audio") continue;
    bytes = Math.max(bytes, counter(stats.bytesReceived));
    packets = Math.max(packets, counter(stats.packetsReceived));
    energy = Math.max(energy, counter(stats.totalAudioEnergy));
  }
  // A subscription, clock, or bitrate label alone is not received media.
  return bytes > 0 || packets > 0 ? { bytes, packets, energy } : null;
}

export function hasXumengLiveVideoFrame(video: Pick<HTMLVideoElement, "videoWidth" | "videoHeight" | "readyState" | "currentTime">) {
  return video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2 && video.currentTime > 0;
}
