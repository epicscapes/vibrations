// Klänge für „Flow Drift“ – alles live mit der Web Audio API erzeugt.
// Jeder Klang hat eine eigene Methode (roll, chime, purr, music), damit er später
// gegen eine Audiodatei getauscht werden kann, ohne den Rest zu ändern.

const PENTA = [0, 2, 4, 7, 9];          // Dur-Pentatonik (Halbtöne)
const ROOT = 146.83;                     // D3

function noiseBuffer(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function reverbIR(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.2 + 0.7 * (1 - t));
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return ir;
}

export class FlowAudio {
  constructor(ctx) {
    this.ctx = ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.g = g;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 4;
    this.master = g(0.9);
    this.master.connect(this.comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = reverbIR(ctx, 4.5, 2.4);
    this.reverb.connect(g(0.7)).connect(this.master);
    this.noise = noiseBuffer(ctx);
    this.volumes = { roll: 0.8, music: 0.7, sfx: 0.8, purr: 0.8 };
    this._initRoll();
    this._initWings();
    this._initMusic();
    this.purrs = new Map();
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    const t = this.ctx.currentTime;
    for (const e of this.purrs.values()) e.vol.gain.setTargetAtTime(this.volumes.purr * 0.9, t, 0.3);
  }

  // Binaurale Quelle im Raum (HRTF); Hörer = Kopf (siehe listener())
  _panner(pos, ref = 0.8) {
    const p = new PannerNode(this.ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.2, maxDistance: 60,
    });
    if (pos) this._place(p, pos, 0);
    return p;
  }
  _place(p, pos, tc = 0.04) {
    const t = this.ctx.currentTime;
    if (tc) { p.positionX.setTargetAtTime(pos[0], t, tc); p.positionY.setTargetAtTime(pos[1], t, tc); p.positionZ.setTargetAtTime(pos[2], t, tc); }
    else { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
  }

  // ---------- Rollen: Marmorkugel auf Holzboden ----------
  // Rauschen durch Bandpass (Holzresonanz) + tiefes Grollen, amplitudenmoduliert mit der Drehfrequenz.
  _initRoll() {
    const ctx = this.ctx, g = this.g;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 230; body.Q.value = 3; body.gain.value = 9;
    this.rollAM = g(0.7);
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 2;
    const lfoDepth = g(0.3);
    lfo.connect(lfoDepth).connect(this.rollAM.gain);
    lfo.start();
    this.rollGain = g(0);
    src.connect(bp).connect(body).connect(this.rollAM);
    src.connect(lp).connect(g(1.6)).connect(this.rollAM);
    this.rollPan = this._panner(null, 1.0);
    this.rollAM.connect(this.rollGain).connect(this.rollPan).connect(this.master);
    src.start();
    Object.assign(this, { rollBP: bp, rollLP: lp, rollLFO: lfo });
  }

  // pos = Auflagepunkt der Kugel; grounded = 0..1 (in der Luft verstummt das Rollen)
  roll(speed, radius, pos, grounded = 1) {
    const now = this.ctx.currentTime;
    const s = Math.min(speed / 8, 1);
    if (pos) this._place(this.rollPan, pos);
    this.rollGain.gain.setTargetAtTime(this.volumes.roll * 0.45 * Math.pow(s, 0.7) * grounded, now, 0.08);
    this.rollBP.frequency.setTargetAtTime(500 + s * 1400, now, 0.1);
    this.rollLP.frequency.setTargetAtTime(110 + s * 180, now, 0.1);
    this.rollLFO.frequency.setTargetAtTime(Math.max(speed / (2 * Math.PI * radius), 0.5), now, 0.1);
  }

  // ---------- Kolibri-Flügelschlag: weiches Brummen an der Kugel (binaural) ----------
  // Flügelfrequenz (~45 Hz) als Grundton + luftiges Rauschen, das im Schlagtakt pulsiert.
  _initWings() {
    const ctx = this.ctx, g = this.g;
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 46;
    const oscLP = ctx.createBiquadFilter(); oscLP.type = 'lowpass'; oscLP.frequency.value = 260;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.9;
    const am = g(0.5);
    const beat = ctx.createOscillator(); beat.frequency.value = 46;      // Luftstöße im Schlagtakt
    beat.connect(g(0.5)).connect(am.gain);
    const mix = g(1);
    osc.connect(oscLP).connect(g(0.55)).connect(mix);
    src.connect(bp).connect(am).connect(g(0.8)).connect(mix);
    this.wingGain = g(0);
    this.wingPan = this._panner(null, 1.0);
    mix.connect(this.wingGain).connect(this.wingPan).connect(this.master);
    osc.start(); src.start(); beat.start();
    this.wingOsc = osc; this.wingBeat = beat;
    this.wingFrame = 0;
  }

  // open = 0..1 (Flügel offen), pos = Kugelmitte
  wings(open, pos) {
    const now = this.ctx.currentTime;
    if (this.wingFrame++ % 2) return;
    this.wingGain.gain.setTargetAtTime(this.volumes.sfx * 0.32 * open, now, 0.12);
    if (open > 0.01) {
      const f = 40 + 8 * open + 3 * Math.sin(now * 1.7);                  // leicht schwankend wie ein echter Kolibri
      this.wingOsc.frequency.setTargetAtTime(f, now, 0.1);
      this.wingBeat.frequency.setTargetAtTime(f, now, 0.1);
      this._place(this.wingPan, pos, 0.06);
    }
  }

  // ---------- Goal eingesammelt: weiche Glocke (pentatonisch) ----------
  chime(pos, step = Math.floor(Math.random() * 10)) {
    const ctx = this.ctx, now = ctx.currentTime;
    const semis = PENTA[step % 5] + 12 * (1 + Math.floor(step / 5));
    const f = ROOT * Math.pow(2, semis / 12);
    const out = this.g(0);
    const pan = this._panner(pos, 1.2);
    out.connect(pan).connect(this.master);
    out.connect(this.g(0.6)).connect(this.reverb);
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.22 * this.volumes.sfx, now + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0005, now + 3.2);
    for (const [ratio, vol] of [[1, 1], [2.76, 0.35], [5.4, 0.15], [0.5, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f * ratio;
      const og = this.g(vol);
      o.connect(og).connect(out);
      o.start(now); o.stop(now + 3.3);
    }
  }

  // ---------- Landung nach Sprung/Schweben: weicher, tiefer Aufprall im Raum ----------
  thud(pos, strength) {
    const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, now);
    o.frequency.exponentialRampToValueAtTime(45, now + 0.25);
    const g = this.g(0);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(Math.min(strength, 1) * 0.35 * this.volumes.sfx, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.4);
    const pan = this._panner(pos, 1.0);
    o.connect(g).connect(pan).connect(this.master);
    o.start(now); o.stop(now + 0.45);
  }

  // ---------- Kollision zweier Kugeln: leises, gläsernes Klicken im Raum ----------
  click(pos, strength) {
    const ctx = this.ctx, now = ctx.currentTime;
    const out = this.g(0);
    const pan = this._panner(pos, 0.6);
    out.connect(pan).connect(this.master);
    out.connect(this.g(0.25)).connect(this.reverb);
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.09 * strength * this.volumes.sfx, now + 0.003);
    out.gain.exponentialRampToValueAtTime(0.0004, now + 0.35);
    const base = 1900 + Math.random() * 600;
    for (const [ratio, vol] of [[1, 1], [2.32, 0.4], [3.9, 0.15]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * ratio;
      const og = this.g(vol);
      o.connect(og).connect(out);
      o.start(now); o.stop(now + 0.4);
    }
  }

  // ---------- Schnurren einer Begleitkugel, binaural im Raum (HRTF) ----------
  // Tiefes, gefiltertes Rauschen mit ~25 Hz "Brummen" und langsamem Ein-/Ausatmen.
  addPurr(id) {
    const ctx = this.ctx, g = this.g;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 2;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
    const am = g(0);
    const buzz = ctx.createOscillator(); buzz.frequency.value = 23 + Math.random() * 5;
    const buzzDepth = g(0.5);
    buzz.connect(buzzDepth).connect(am.gain);
    const breath = ctx.createOscillator(); breath.frequency.value = 0.55 + Math.random() * 0.15;
    const breathDepth = g(0.25);
    const breathGain = g(0.5);
    breath.connect(breathDepth).connect(breathGain.gain);
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 0.6, rolloffFactor: 1.4, maxDistance: 30,
    });
    const vol = g(0);
    src.connect(hp).connect(lp).connect(am).connect(breathGain).connect(vol).connect(panner).connect(this.master);
    vol.gain.setTargetAtTime(this.volumes.purr * 0.9, ctx.currentTime, 1.5);   // sanft einblenden
    src.start(); buzz.start(); breath.start();
    this.purrs.set(id, { panner, vol, nodes: [src, buzz, breath], frame: 0 });
  }

  // Schnurren einer Begleitkugel ausblenden und Knoten danach vollständig abbauen
  removePurr(id) {
    const e = this.purrs.get(id);
    if (!e) return;
    this.purrs.delete(id);
    const t = this.ctx.currentTime;
    e.vol.gain.cancelScheduledValues(t);
    e.vol.gain.setValueAtTime(e.vol.gain.value, t);
    e.vol.gain.setTargetAtTime(0, t, 0.3);
    for (const n of e.nodes) n.stop(t + 1.6);
    setTimeout(() => { try { e.panner.disconnect(); } catch {} }, 2000);
  }

  movePurr(id, p) {
    const e = this.purrs.get(id);
    if (!e) return;
    if (e.frame++ % 3) return;                        // Position nur ~25×/s nachführen (weniger Automations-Ereignisse)
    const t = this.ctx.currentTime;
    e.panner.positionX.setTargetAtTime(p[0], t, 0.06);
    e.panner.positionY.setTargetAtTime(p[1], t, 0.06);
    e.panner.positionZ.setTargetAtTime(p[2], t, 0.06);
  }

  clearPurrs() {
    for (const e of this.purrs.values()) {
      e.vol.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      for (const n of e.nodes) n.stop(this.ctx.currentTime + 1);
    }
    this.purrs.clear();
  }

  // Hörer = Kopf/Kamera in Weltkoordinaten
  listener(pos, fwd, up) {
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos[0], t, 0.03); L.positionY.setTargetAtTime(pos[1], t, 0.03); L.positionZ.setTargetAtTime(pos[2], t, 0.03);
      L.forwardX.setTargetAtTime(fwd[0], t, 0.03); L.forwardY.setTargetAtTime(fwd[1], t, 0.03); L.forwardZ.setTargetAtTime(fwd[2], t, 0.03);
      L.upX.setTargetAtTime(up[0], t, 0.03); L.upY.setTargetAtTime(up[1], t, 0.03); L.upZ.setTargetAtTime(up[2], t, 0.03);
    } else {
      L.setPosition(...pos); L.setOrientation(...fwd, ...up);
    }
  }

  // ---------- Generative Szenenmusik: Flächen + einzelne Töne, lauter bei Tempo ----------
  _initMusic() {
    const ctx = this.ctx;
    this.musicGain = this.g(0);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.musicLP = lp;
    this.musicGain.connect(lp);
    lp.connect(this.master);
    lp.connect(this.reverb);
    this.chords = [[0, 7, 16], [-3, 4, 12], [2, 9, 14], [-5, 7, 11]];   // I – vi – ii – V (offen gesetzt)
    this.chordIdx = 0;
    this.nextChord = ctx.currentTime + 0.5;
    this.nextNote = ctx.currentTime + 2;
    this.pads = [];
  }

  _padChord(semis, when) {
    const ctx = this.ctx;
    for (const p of this.pads) { p.g.gain.setTargetAtTime(0, when, 1.4); p.o.forEach((o) => o.stop(when + 6)); }
    this.pads = semis.map((s) => {
      const f = ROOT / 2 * Math.pow(2, s / 12);
      const g = this.g(0);
      g.gain.setTargetAtTime(0.05, when, 1.6);
      const o = [0, 1].map((k) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        osc.detune.value = k ? 7 : -7;
        osc.connect(g);
        osc.start(when);
        return osc;
      });
      g.connect(this.musicGain);
      return { g, o };
    });
  }

  _pluck(when, intensity) {
    const ctx = this.ctx;
    const step = Math.floor(Math.random() * 8);
    const semis = PENTA[step % 5] + 12 * (1 + Math.floor(step / 5));
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = ROOT * Math.pow(2, semis / 12);
    const g = this.g(0);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.06 + 0.06 * intensity, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 2.2);
    o.connect(g).connect(this.musicGain);
    o.start(when); o.stop(when + 2.3);
  }

  // speed in m/s; pro Frame aufrufen
  music(speed) {
    const ctx = this.ctx, now = ctx.currentTime;
    const s = Math.min(speed / 7, 1);
    this.musicGain.gain.setTargetAtTime(this.volumes.music * (0.25 + 0.95 * s), now, 0.8);
    this.musicLP.frequency.setTargetAtTime(900 + 3000 * s, now, 0.8);
    if (now > this.nextChord - 0.1) {
      this._padChord(this.chords[this.chordIdx], this.nextChord);
      this.chordIdx = (this.chordIdx + 1) % this.chords.length;
      this.nextChord += 8;
    }
    if (now > this.nextNote - 0.1) {
      this._pluck(this.nextNote, s);
      this.nextNote += (1.6 - 1.1 * s) * (0.6 + Math.random() * 0.8);   // schneller = dichter
    }
  }

  resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }
}
