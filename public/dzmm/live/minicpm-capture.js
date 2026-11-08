class XumengMiniCpmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(16000);
    this.offset = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.muted = false;
    this.port.onmessage = event => { this.muted = Boolean(event.data?.muted); };
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let energy = 0;
    for (const value of input) {
      const sample = this.muted ? 0 : value;
      energy += sample * sample;
      this.sum += sample;
      this.count += 1;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.chunk[this.offset++] = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        if (this.offset === this.chunk.length) {
          this.port.postMessage({ audio: this.chunk }, [this.chunk.buffer]);
          this.chunk = new Float32Array(16000);
          this.offset = 0;
        }
      }
    }
    this.port.postMessage({ rms: Math.sqrt(energy / input.length) });
    return true;
  }
}
registerProcessor("xumeng-minicpm-capture", XumengMiniCpmCapture);
