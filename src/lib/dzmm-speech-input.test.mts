import test from "node:test";
import assert from "node:assert/strict";
import { pcm16Wav, samplesToSpeechWav, speechTranscript, wavLooksValid } from "./dzmm-speech-input.ts";

test("speech transcript reads the whisper text field", () => {
  assert.equal(speechTranscript({ text: "  你好，世界 \n" }), "你好，世界");
  assert.equal(speechTranscript({ result: { text: "nested" } }), "nested");
  assert.equal(speechTranscript({ text: "" }), "");
});

test("pcm wav is 16 kHz mono and long enough to accept", () => {
  const samples = new Float32Array(16_000);
  samples[100] = 0.4;
  const wav = pcm16Wav(samples, 16_000);
  assert.equal(wavLooksValid(wav), true);
  const short = samplesToSpeechWav([new Float32Array(1000)], 48_000);
  assert.equal(short, null);
  const speech = samplesToSpeechWav([samples, samples], 16_000);
  assert.ok(speech && wavLooksValid(speech));
});
