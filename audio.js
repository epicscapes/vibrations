// Mikrofon-Eingang: erkennt Summen (Lautstärke + Tonhöhe per Autokorrelation)

export class HumDetector {
  constructor() {
    this.active = false;
    this.level = 0;      // geglättete Lautstärke 0..1, nur wenn gesummt wird
    this.rms = 0;        // rohe Lautstärke (für das Stimm-Gate)
    this.pitch = 150;    // geglättete Tonhöhe in Hz
    this.clarity = 0;
    this._frame = 0;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const src = this.ctx.createMediaStreamSource(stream);
    this.source = src;
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

    // lineare Lautstärke 0..1 (die Dynamik-Kurve für die Wellen wird in main.js angewendet)
    const target = this._humming ? Math.min(this._rms * 8, 1) : 0;
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
    this.rms = this._rms;
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

// ---------------------------------------------------------------------------
// Stimmeffekte. Signalfluss:
//   Mikro -> Gate (öffnet nur beim Summen) -> Sends -> [Hall | Echo | Grain | Shimmer] -> Master -> Kompressor -> Ausgang
//   Obertöne: Sinus-Oszillatoren folgen der erkannten Tonhöhe -> Hall + Master
// Zusätzlich ein regelbarer Anteil der trockenen Stimme (Gate -> Dry -> Kompressor).
// ---------------------------------------------------------------------------

export const EFFECTS = {
  hall:    { label: 'Reverb',        default: true },
  echo:    { label: 'Echo',          default: false },
  grain:   { label: 'Grain Delay',   default: false },
  shimmer: { label: 'Shimmer',       default: false },
  harmony: { label: 'Harmonics',     default: false },
};

function impulseResponse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Rauschen, das mit der Zeit dunkler wird (Tiefpass zieht zu) und exponentiell abklingt
      const k = 0.15 + 0.8 * (1 - t);
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.pow(1 - t, decay) * (i < ctx.sampleRate * 0.02 ? i / (ctx.sampleRate * 0.02) : 1);
    }
  }
  return ir;
}

export class VoiceFX {
  constructor(ctx, source) {
    this.ctx = ctx;
    this.source = source;
    this.enabled = {};
  }

  async init() {
    const ctx = this.ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    // Ausgang
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 6;
    this.master = g(0.7);
    this.master.connect(this.comp).connect(ctx.destination);

    // Eingang mit Gate + Rumpelfilter
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 70;
    this.gate = g(0);
    this.source.connect(hp).connect(this.gate);

    // Eigene Stimme ohne Effekte, separat regelbar (am Effekt-Master vorbei)
    this.dry = g(0);
    this.gate.connect(this.dry).connect(this.comp);

    // Hall (Faltungshall mit generierter Impulsantwort, ~7 s)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulseResponse(ctx, 7, 2.2);
    const revOut = g(0.9);
    this.reverb.connect(revOut).connect(this.master);

    this.sends = {};
    const send = (name, dest) => { const s = g(0); this.gate.connect(s).connect(dest); this.sends[name] = s; return s; };

    // Hall
    send('hall', this.reverb);

    // Echo: Ping-Pong-Delay mit abgedunkeltem Feedback
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    dl.delayTime.value = 0.42; dr.delayTime.value = 0.63;
    const fb = g(0.5), tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 2200;
    const merger = ctx.createChannelMerger(2);
    const echoIn = send('echo', dl);
    dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
    dl.connect(dr); dr.connect(tone).connect(fb).connect(dl);
    const echoOut = g(0.8);
    merger.connect(echoOut).connect(this.master);
    echoOut.connect(g(0.3)).connect(this.reverb);

    // Grain Delay + Shimmer über AudioWorklet
    try {
      await ctx.audioWorklet.addModule(new URL('./grain-worklet.js?v=' + (window.VIBRATIONS_VERSION || ''), import.meta.url));
      const grain = new AudioWorkletNode(ctx, 'grain', { outputChannelCount: [2] });
      send('grain', grain);
      grain.connect(this.master);
      grain.connect(g(0.4)).connect(this.reverb);

      const shimmer = new AudioWorkletNode(ctx, 'grain', { outputChannelCount: [2] });
      shimmer.parameters.get('pitch').value = 2;        // eine Oktave höher
      shimmer.parameters.get('density').value = 24;
      shimmer.parameters.get('spread').value = 0.4;
      shimmer.parameters.get('variation').value = 0.1;
      send('shimmer', shimmer);
      shimmer.connect(g(1.2)).connect(this.reverb);      // klingt nur im Hall
    } catch (e) {
      console.warn('AudioWorklet nicht verfügbar – Grain/Shimmer deaktiviert', e);
    }

    // Obertöne: Unteroktave, Quinte, Oktave folgen der Tonhöhe
    this.harmonyGain = g(0);
    this.harmonyGain.connect(this.master);
    this.harmonyGain.connect(g(0.8)).connect(this.reverb);
    this.oscs = [[0.5, 0.35], [1.5, 0.25], [2, 0.18], [3, 0.08]].map(([ratio, vol]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const og = g(vol);
      o.connect(og).connect(this.harmonyGain);
      o.start();
      return { o, ratio };
    });
    this.sends.harmony = this.harmonyGain;
    this._harmonyLevel = 0;

    for (const k of Object.keys(EFFECTS)) this.set(k, this.enabled[k] ?? EFFECTS[k].default);
    this.ready = true;
  }

  set(name, on) {
    this.enabled[name] = on;
    if (name === 'harmony') return;             // Pegel wird in update() gesteuert
    const s = this.sends && this.sends[name];
    if (s) s.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.1);
  }

  setDry(v) {
    if (this.dry) this.dry.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // pro Frame: Gate und Obertöne an Summen koppeln
  // Gate-Schwelle (RMS). Niedrig = Stimme setzt weich ein, aber leise Umgebung kommt eher durch.
  setGateThreshold(v) { this.gateThr = v; }

  update(level, pitch, rms = 0) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    // Gate folgt der rohen Lautstärke: schnell auf, langsam zu -> nicht abgehackt
    const thr = this.gateThr ?? 0.003;
    const x = Math.min(Math.max((rms - thr) / (thr * 1.5), 0), 1);
    const open = x * x * (3 - 2 * x);
    const cur = this.gate.gain.value;
    this.gate.gain.setTargetAtTime(open, now, open > cur ? 0.015 : 0.35);
    const h = this.enabled.harmony ? level * 0.25 : 0;
    this.harmonyGain.gain.setTargetAtTime(h, now, h > this._harmonyLevel ? 0.6 : 1.5);
    this._harmonyLevel = h;
    if (level > 0.05) for (const { o, ratio } of this.oscs) o.frequency.setTargetAtTime(pitch * ratio, now, 0.15);
  }
}
