// Granular-Prozessor: schreibt die Stimme in einen Ringpuffer und spielt daraus
// viele kurze, weich ein-/ausgeblendete "Körner" mit zufälliger Verzögerung,
// Stereoposition und Tonhöhe ab. pitch = 1 -> Grain Delay, pitch = 2 -> Shimmer.

class GrainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1 },      // Abspielrate der Körner
      { name: 'density', defaultValue: 18 },   // Körner pro Sekunde
      { name: 'spread', defaultValue: 0.8 },   // max. zusätzliche Verzögerung in s
      { name: 'variation', defaultValue: 0.25 }, // Anteil Körner eine Oktave tiefer/höher
    ];
  }

  constructor() {
    super();
    this.size = Math.floor(sampleRate * 4);
    this.buf = new Float32Array(this.size);
    this.w = 0;
    this.grains = [];
    this.next = 0;
  }

  spawn(pitch, spread, variation) {
    const len = Math.floor((0.08 + Math.random() * 0.17) * sampleRate);
    let rate = pitch;
    const v = Math.random();
    if (v < variation * 0.5) rate *= 0.5;
    else if (v < variation) rate *= 2;
    // Lesekopf darf den Schreibkopf nicht überholen
    const minDelay = Math.max(rate - 1, 0) * len + 0.03 * sampleRate;
    const delay = minDelay + Math.random() * spread * sampleRate;
    const pan = Math.random() * 2 - 1;
    this.grains.push({
      pos: (this.w - delay + this.size) % this.size,
      len, t: 0, rate,
      gl: Math.sqrt(0.5 * (1 - pan)), gr: Math.sqrt(0.5 * (1 + pan)),
    });
  }

  process(inputs, outputs, params) {
    const inp = inputs[0] && inputs[0][0];
    const L = outputs[0][0], R = outputs[0][1] || outputs[0][0];
    const pitch = params.pitch[0], density = params.density[0];
    const spread = params.spread[0], variation = params.variation[0];
    const size = this.size, buf = this.buf;
    const norm = 0.6 / Math.sqrt(Math.max(density * 0.16, 1));

    for (let i = 0; i < L.length; i++) {
      buf[this.w] = inp ? inp[i] : 0;
      this.w = (this.w + 1) % size;

      if (--this.next <= 0) {
        if (this.grains.length < 64) this.spawn(pitch, spread, variation);
        this.next = (sampleRate / density) * (0.5 + Math.random());
      }

      let l = 0, r = 0;
      for (let g = this.grains.length - 1; g >= 0; g--) {
        const gr = this.grains[g];
        const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * gr.t) / gr.len);
        const idx = gr.pos + gr.t * gr.rate;
        const i0 = Math.floor(idx), f = idx - i0;
        const a = buf[i0 % size], b = buf[(i0 + 1) % size];
        const s = (a + (b - a) * f) * env;
        l += s * gr.gl; r += s * gr.gr;
        if (++gr.t >= gr.len) this.grains.splice(g, 1);
      }
      L[i] = l * norm;
      if (R !== L) R[i] = r * norm;
    }
    return true;
  }
}

registerProcessor('grain', GrainProcessor);
