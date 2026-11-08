import assert from "node:assert/strict";
import { test } from "node:test";
import rtcModule from "./xumeng-live-rtc.ts";
const { XumengLiveRtcJoinGate, isXumengLivePublisher, readXumengLiveAudioEvidence, hasXumengLiveVideoFrame } = rtcModule as typeof import("./xumeng-live-rtc.ts");
const session = { id: "original-live", mode: "real", status: "ready" };

test("connecting polls never start RTC, readiness claims exactly once before async completion", () => {
  const gate = new XumengLiveRtcJoinGate();
  for (let i = 0; i < 10; i++) assert.equal(gate.claim({ ...session, status: "connecting" }, session.id, 3, "original-lease"), false);
  assert.equal(gate.claim(session, session.id, 3, "original-lease"), true);
  for (let i = 0; i < 10; i++) assert.equal(gate.claim(session, session.id, 3, "original-lease"), false);
  assert.equal(gate.claim({ ...session, status: "ended" }, session.id, 4, "original-lease"), false);
  assert.equal(gate.claim({ ...session, id: "late-old-session" }, session.id, 4, "original-lease"), false);
  assert.equal(gate.claim({ ...session, mode: "rehearsal" }, session.id, 4, "original-lease"), false);
  assert.equal(gate.claim(session, session.id, 4, ""), false);
  assert.equal(gate.claim({ ...session, id: "new-live" }, "new-live", 4, "new-lease"), true);
});

test("only official Vidu publishers can supply generated media", () => {
  for (const uid of ["live-bot-owner-original", "live-video-push-owner-original"]) assert.equal(isXumengLivePublisher(uid), true);
  for (const uid of ["live-user-owner-original", "spectator", "live-bot-", "live-bot-unsafe\n", null, 4, "live-bot-" + "a".repeat(300)]) assert.equal(isXumengLivePublisher(uid), false);
});

test("audio subscription, bitrate, malformed and unrelated stats cannot claim audio receipt", () => {
  for (const value of [null, {}, [{ uid: "live-bot-original", stats: { subscribed: true, bitrate: 123 } }],
    [{ uid: "live-user-original", stats: { inboundRtpStats: { bytesReceived: 999, packetsReceived: 6 } } }],
    [{ uid: "live-bot-original", stats: { inboundRtpStats: { kind: "video", bytesReceived: 999, packetsReceived: 6 } } }],
    [{ uid: "live-bot-original", stats: { inboundRtpStats: { bytesReceived: NaN, packetsReceived: -1 } } }]]) assert.equal(readXumengLiveAudioEvidence(value), null);
});

test("SDK 7.3.4 received audio counters are evidence, including packet-only stats", () => {
  assert.deepEqual(readXumengLiveAudioEvidence([{ uid: "live-bot-original", track: 1, stats: { inboundRtpStats: { kind: "audio", bytesReceived: 12000, packetsReceived: 44, totalAudioEnergy: 0.25 } } }]), { bytes: 12000, packets: 44, energy: 0.25 });
  assert.deepEqual(readXumengLiveAudioEvidence([{ uid: "live-bot-original", stats: { packetsReceived: 2 } }]), { bytes: 0, packets: 2, energy: 0 });
});

test("playing or video metadata alone is not a rendered first frame", () => {
  const frame = { videoWidth: 640, videoHeight: 960, readyState: 2, currentTime: 0.04 };
  assert.equal(hasXumengLiveVideoFrame(frame), true);
  for (const patch of [{ videoWidth: 0 }, { videoHeight: 0 }, { readyState: 1 }, { currentTime: 0 }]) assert.equal(hasXumengLiveVideoFrame({ ...frame, ...patch }), false);
});
