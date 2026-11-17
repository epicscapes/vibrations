// Mikrofon-Eingang: erkennt Summen (Lautstärke + Tonhöhe per Autokorrelation)

export class HumDetector {
  constructor() {
    this.active = false;
    this.level = 0;      // geglättete Lautstärke 0..1, nur wenn gesummt wird
    this.pitch = 150;    // geglättete Tonhöhe in Hz
    this.clarity = 0;
    this._frame = 0;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.sr = this.ctx.sampleRate;
    this.active = true;
  }

  // einmal pro Frame aufrufen
  update() {
    if (!this.active) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    // Tonhöhenanalyse nur jeden 2. Frame (spart CPU auf der Quest)
    if (this._frame++ % 2 === 0) this._analyse();

    const target = this._humming ? Math.min(this._rms * 12, 1) : 0;
    // schnell an, langsam aus
    const k = target > this.level ? 0.15 : 0.05;
    this.level += (target - this.level) * k;
  }

  _analyse() {
    const x = this.buf;
    this.analyser.getFloatTimeDomainData(x);
    const N = 1024;

    let e = 0;
    for (let i = 0; i < N; i++) e += x[i] * x[i];
    this._rms = Math.sqrt(e / N);
    if (this._rms < 0.008) { this._humming = false; this.clarity = 0; return; }

    // Autokorrelation für 70–500 Hz
    const minLag = Math.floor(this.sr / 500);
    const maxLag = Math.min(Math.floor(this.sr / 70), x.length - N);
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      for (let i = 0; i < N; i++) c += x[i] * x[i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    this.clarity = best / e;
    this._humming = this.clarity > 0.6;
    if (this._humming) {
      const hz = this.sr / bestLag;
      // in log-Skala glätten
      this.pitch = Math.exp(Math.log(this.pitch) * 0.7 + Math.log(hz) * 0.3);
    }
  }
}
