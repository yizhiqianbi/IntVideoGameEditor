import { samplesToSpeechWav, SPEECH_INPUT_MAX_MS } from "@/lib/dzmm-speech-input";

export type SpeechRecorder = { stop: () => Promise<Uint8Array | null>; cancel: () => void };

export async function openSpeechRecorder(maxMs = SPEECH_INPUT_MAX_MS, onAutoStop?: () => void): Promise<SpeechRecorder> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
  const context = new AudioContext();
  const resume = context.resume();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    await resume;
  } catch (error) {
    await context.close();
    throw error;
  }
  if (typeof context.createScriptProcessor !== "function") {
    for (const track of stream.getTracks()) track.stop();
    await context.close();
    throw new Error("unsupported");
  }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  let settled = false;
  const sampleRate = context.sampleRate;
  const timer = window.setTimeout(() => onAutoStop?.(), maxMs);
  function release() {
    window.clearTimeout(timer);
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    mute.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  }
  return {
    cancel() {
      if (settled) return;
      settled = true;
      release();
    },
    async stop() {
      if (settled) return null;
      settled = true;
      release();
      return samplesToSpeechWav(chunks, sampleRate);
    },
  };
}
