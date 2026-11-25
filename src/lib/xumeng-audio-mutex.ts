export const XUMENG_AUDIO_FOCUS_EVENT = "xumeng-audio-play";

/**
 * Claims global audio playback focus across VoiceNote, voice previews,
 * video playback, and speech recording so only one audio source plays at once.
 */
export function claimXumengAudioFocus(ownerId: string): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent<string>(XUMENG_AUDIO_FOCUS_EVENT, { detail: ownerId }));
}

/**
 * Subscribes to global audio focus claims and invokes `onYield` whenever
 * another source claims playback focus.
 */
export function subscribeXumengAudioFocus(ownerId: string, onYield: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (detail !== ownerId) onYield();
  };
  document.addEventListener(XUMENG_AUDIO_FOCUS_EVENT, listener);
  return () => document.removeEventListener(XUMENG_AUDIO_FOCUS_EVENT, listener);
}
