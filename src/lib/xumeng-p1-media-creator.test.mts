import test from "node:test";
import assert from "node:assert/strict";
import audioMutexModule from "./xumeng-audio-mutex";

const {
  claimXumengAudioFocus,
  subscribeXumengAudioFocus,
  XUMENG_AUDIO_FOCUS_EVENT,
} = audioMutexModule as typeof import("./xumeng-audio-mutex");

test("audio mutex notifies other owners and ignores self claims", () => {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const fakeDoc = {
    addEventListener(type: string, fn: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (event: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event: Event) {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
      return true;
    },
  };
  const previousDoc = (globalThis as Record<string, unknown>).document;
  (globalThis as Record<string, unknown>).document = fakeDoc;
  try {
    const yielded: string[] = [];
    const unsubA = subscribeXumengAudioFocus("voice-a", () => yielded.push("voice-a"));
    const unsubB = subscribeXumengAudioFocus("voice-b", () => yielded.push("voice-b"));

    claimXumengAudioFocus("voice-a");
    assert.deepEqual(yielded, ["voice-b"]);

    claimXumengAudioFocus("speech-input");
    assert.deepEqual(yielded, ["voice-b", "voice-a", "voice-b"]);

    unsubA();
    claimXumengAudioFocus("video-channel");
    assert.deepEqual(yielded, ["voice-b", "voice-a", "voice-b", "voice-b"]);

    unsubB();
    assert.equal(listeners.get(XUMENG_AUDIO_FOCUS_EVENT)?.size ?? 0, 0);
  } finally {
    if (previousDoc === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as Record<string, unknown>).document = previousDoc;
  }
});
