// Vibrations – Vanilla WebGL2 + WebXR (kein Framework)
import {
  simVS, simFS, sceneVS, sceneFS, partVS, partFS, fadeFS,
  flyVS, flyFS, tailVS, tailFS, TAIL_SEGMENTS, fracFS,
} from './shaders.js';
import { HumDetector, VoiceFX, EFFECTS } from './audio.js';

// Bei jedem Update erhöhen, damit man auf der Quest sieht, ob die neue Version geladen ist.
const VERSION = 'v0.10.0';

// ---------- Feste Szenenwerte ----------
const params = new URLSearchParams(location.search);
const SUPERSAMPLE = parseFloat(params.get('scale') || '1.5'); // 150 % der nativen Display-Auflösung
const WAVE_K = 0.25;           // c² -> 0.5 Texel pro Schritt
const DAMP = 0.9993;           // geringe Dämpfung -> Wellen erreichen den Rand und reflektieren
const SCENE = {
  center: [0, 0, -5],          // Wasserebene 5 m vor dem Startpunkt, auf Augenhöhe
  half: 8.0,                   // Quad 16 × 16 m
  waterR: 3.0,                 // Umkreisradius des Behälters (Reflexionsrand)
  sunR: 1.15,                  // Radius der Sonnenscheibe in Ruhe (wächst beim Summen bis +40 %)
  fracR: 1.4,                  // Grundgröße der Fraktale
  depth: 1.0,                  // Sonne liegt 1 m hinter dem Wasser
  bump: 3.0,
  partExtent: 3.8,             // Corona-Texturen decken ±3,8 m ab
  lobe: 0.08,                  // Blütentiefe bei Blütenformen
};

// ---------- Einstellungen (Browser-UI, in Untermenüs, in localStorage gespeichert) ----------
function load(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

const SHAPES = [
  [0, 'Kreis'], [3, 'Dreieck'], [4, 'Quadrat'], [5, 'Fünfeck'], [6, 'Sechseck'], [8, 'Achteck'],
  [105, 'Blüte 5'], [106, 'Blüte 6'], [108, 'Blüte 8'],
];

const SECTIONS = [
  { title: 'Stimme & Effekte', items: {
    volume:  { label: 'Effekt-Lautstärke', min: 0, max: 1.5, step: 0.05, def: 0.7 },
    dry:     { label: 'Eigene Stimme', min: 0, max: 1.5, step: 0.05, def: 0 },
    gateThr: { label: 'Gate-Schwelle', min: 0.0005, max: 0.02, step: 0.0005, def: 0.002 },
  }, effects: true },
  { title: 'Shapes', items: {
    centerObj: { label: 'Objekt', options: [[0, 'Sonne'], [1, 'Fraktal']], def: 0 },
    fracType:  { label: 'Fraktal-Algorithmus', options: [[0, 'Julia'], [1, 'Phoenix'], [2, 'Tricorn'], [3, 'Kaliset'], [4, 'Mandala']], def: 0 },
    fracZoom:  { label: 'Fraktal-Größe', min: 0.5, max: 2, step: 0.05, def: 1 },
    fracDepth: { label: 'Fraktal-Tiefe (m)', min: 0, max: 1.5, step: 0.05, def: 0.45 },
    fracSpeed: { label: 'Entwicklungs-Tempo', min: 0, max: 3, step: 0.1, def: 1 },
    fracIter:  { label: 'Detail (Iterationen)', min: 4, max: 96, step: 2, def: 48 },
    fracRes:   { label: 'Fraktal-Auflösung', options: [[512, '512'], [768, '768'], [1024, '1024'], [1536, '1536'], [2048, '2048 (schwer)'], [3072, '3072 (sehr schwer)']], def: 768 },
    fracCount: { label: 'Anzahl Ebenen', min: 1, max: 6, step: 1, def: 3 },
    fracBlend: { label: 'Ebenen-Mischmodus', options: [[0, 'Normal'], [1, 'Additiv'], [2, 'Screen'], [3, 'Difference'], [4, 'Aufhellen']], def: 0 },
    echoFade:  { label: 'Echo-Deckkraft', min: 0.1, max: 1, step: 0.05, def: 0.55 },
    echoSat:   { label: 'Echo-Sättigung (+ pro Abstand)', min: 0, max: 1, step: 0.05, def: 0.35 },
    echoHue:   { label: 'Echo-Farbversatz (vorne/hinten gegenläufig)', min: -1, max: 1, step: 0.05, def: 0.2 },
    relief:    { label: 'Relief-Tiefe (m, 0 = aus)', min: 0, max: 1.5, step: 0.05, def: 0 },
    reliefSteps: { label: 'Relief-Qualität (Schritte)', min: 6, max: 48, step: 2, def: 16 },
    fracInner: { label: 'Helle Innenflächen', options: [[2, 'Struktur'], [1, 'Hohl'], [0, 'Hell']], def: 2 },
    hueShift:  { label: 'Hue-Shift nach Tonhöhe', min: 0, max: 1, step: 0.05, def: 1 },
  }},
  { title: 'Hintergrund', items: {
    bgGrain:  { label: 'Korn an', toggle: true, def: true },
    bgStrength: { label: 'Stärke', min: 0, max: 0.12, step: 0.005, def: 0.03 },
    bgSize:   { label: 'Korngröße', min: 0.3, max: 4, step: 0.1, def: 1 },
    bgSpeed:  { label: 'Bewegung', min: 0, max: 2, step: 0.05, def: 0.4 },
    bgLayers: { label: 'Ebenen', min: 1, max: 3, step: 1, def: 3 },
    bgDepth:  { label: 'Ebenen-Abstand (m)', min: 0, max: 3, step: 0.1, def: 1 },
  }},
  { title: 'Sonne & Corona', items: {
    coronaCount: { label: 'Anzahl', min: 0, max: 18000, step: 300, def: 6000 },
    coronaSize:  { label: 'Größe', min: 0.3, max: 3, step: 0.1, def: 1 },
    coronaNoise: { label: 'Noise-Größe', min: 0.15, max: 1.5, step: 0.05, def: 0.5 },
    coronaDepth: { label: 'Tiefenverteilung (m)', min: 0, max: 1.5, step: 0.05, def: 0.6 },
  }},
  { title: 'Partikel zu mir', items: {
    flyCount: { label: 'Anzahl', min: 0, max: 4000, step: 50, def: 800 },
    flySize:  { label: 'Größe', min: 0.004, max: 0.06, step: 0.002, def: 0.018 },
    flyTail:  { label: 'Schweiflänge', min: 0, max: 0.15, step: 0.005, def: 0.05 },
  }},
  { title: 'Wasser & Cymatics', items: {
    shape:      { label: 'Form', options: SHAPES, def: 6 },
    waveGain:   { label: 'Wellen-Stärke', min: 0.2, max: 3, step: 0.1, def: 1 },
    waveDyn:    { label: 'Dynamik', min: 1, max: 4, step: 0.1, def: 2.2 },
    waveFreq:   { label: 'Wellen-Frequenz', min: 0.5, max: 3, step: 0.1, def: 1.3 },
    simRes:     { label: 'Auflösung', options: [[512, '512'], [768, '768'], [1024, '1024'], [1536, '1536 (schwer)']], def: 768 },
    follow:     { label: 'Zentrum folgt Blick', toggle: true, def: false },
    followSpeed:{ label: 'Folge-Tempo', min: 0.05, max: 2, step: 0.05, def: 0.4 },
  }},
];
const S = {};
for (const sec of SECTIONS) for (const [k, d] of Object.entries(sec.items)) S[k] = load('set.' + k, d.def);

const ui = {
  version: document.getElementById('version'),
  status: document.getElementById('status'),
  mic: document.getElementById('mic'),
  vr: document.getElementById('vr'),
  panel: document.getElementById('panel'),
  toggle: document.getElementById('toggle'),
};
ui.version.textContent = `Vibrations ${VERSION}`;

// ---------- WebGL2 ----------
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, xrCompatible: true, alpha: false });
if (!gl) throw fail('WebGL2 wird nicht unterstützt.');
if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
  throw fail('Float-Rendertargets werden nicht unterstützt.');
}

function fail(msg) { ui.status.textContent = msg; return new Error(msg); }

function program(vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw fail(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw fail(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

function vao(data) {
  const v = gl.createVertexArray();
  gl.bindVertexArray(v);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return v;
}

const simProg = program(simVS, simFS);
const sceneProg = program(sceneVS, sceneFS);
const partProg = program(partVS, partFS);
const fadeProg = program(simVS, fadeFS);
const flyProg = program(flyVS, flyFS);
const tailProg = program(tailVS, tailFS);
const fracProg = program(simVS, fracFS);
const emptyVao = gl.createVertexArray();
const fullscreen = vao([-1, -1, 3, -1, -1, 3]);
const h = SCENE.half;
const quad = vao([-h, -h, h, -h, -h, h, -h, h, h, -h, h, h]);

// ---------- Render-Targets ----------
function target(size, format, srcFormat) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, size, size, 0, srcFormat, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw fail('Framebuffer unvollständig.');
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fb };
}

// Wellen: Ping-Pong; Auflösung umschaltbar, Schritte/s wachsen mit, damit die Wellen in Metern gleich schnell laufen
let SIM_SIZE = 512, simA, simB;
const simRate = () => 480 * SIM_SIZE / 512;
function setSimRes(size) {
  for (const t of [simA, simB]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
  SIM_SIZE = size;
  simA = target(size, gl.RG16F, gl.RG);
  simB = target(size, gl.RG16F, gl.RG);
}
setSimRes(S.simRes);

// Corona: drei Tiefenebenen (vor / auf / hinter der Sonnenebene)
const PART_SIZE = 1024;
const coronaLayers = [0, 1, 2].map(() => target(PART_SIZE, gl.RGBA16F, gl.RGBA));

// Fraktal: drei Ebenen (aktuell + zwei zeitversetzte Echos in der Tiefe), Auflösung umschaltbar
// Alle Ebenen liegen in einem Textur-Array; es wird nur so viel Speicher belegt, wie Ebenen eingestellt sind.
let FRAC_SIZE = 768, fracTex = null, fracFbs = [], fracCount = 0;
function setFracLayers(size, count) {
  if (fracTex) gl.deleteTexture(fracTex);
  for (const fb of fracFbs) gl.deleteFramebuffer(fb);
  FRAC_SIZE = size;
  fracCount = count;
  fracTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, fracTex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, size, size, count);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  fracFbs = [];
  for (let i = 0; i < count; i++) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, fracTex, 0, i);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    fracFbs.push(fb);
  }
}
setFracLayers(S.fracRes, S.fracCount);

// ---------- Wellen-Simulation ----------
let srcPos = [0.5, 0.5];       // Anregungsort (UV), folgt optional dem Blick
let gazeUV = [0.5, 0.5];

function simStep(drive) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fb);
  gl.viewport(0, 0, SIM_SIZE, SIM_SIZE);
  gl.useProgram(simProg.p);
  const u = simProg.u;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, simA.tex);
  gl.uniform1i(u.uState, 0);
  gl.uniform1f(u.uK, WAVE_K);
  gl.uniform1f(u.uDamp, DAMP);
  gl.uniform1f(u.uDrive, drive);
  gl.uniform2fv(u.uSrcPos, srcPos);
  gl.uniform1f(u.uSrc, 0.012);
  gl.uniform1f(u.uR, 0.49);
  gl.uniform1f(u.uShape, S.shape);
  gl.uniform1f(u.uLobe, SCENE.lobe);
  gl.bindVertexArray(fullscreen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  [simA, simB] = [simB, simA];
}

// Blickrichtung (oder Zeiger in der 2D-Vorschau) mit der Wasserebene schneiden
function gazeFromRay(origin, dir) {
  if (dir[2] >= -0.05) return;
  const t = (SCENE.center[2] - origin[2]) / dir[2];
  let x = (origin[0] + dir[0] * t - SCENE.center[0]) / (2 * SCENE.waterR);
  let y = (origin[1] + dir[1] * t - SCENE.center[1]) / (2 * SCENE.waterR);
  const r = Math.hypot(x, y), max = 0.3;   // innerhalb des Behälters bleiben
  if (r > max) { x *= max / r; y *= max / r; }
  gazeUV = [0.5 + x, 0.5 + y];
}

function updateSource(dt) {
  const goal = S.follow ? gazeUV : [0.5, 0.5];
  const k = Math.min(dt * S.followSpeed, 1);          // verzögert nachziehen
  srcPos = [srcPos[0] + (goal[0] - srcPos[0]) * k, srcPos[1] + (goal[1] - srcPos[1]) * k];
}

// ---------- Sonne: wächst beim Summen, federnd nachgezogen ----------
let sunScale = 1, sunVel = 0, sunWob = 0;
let flow = 0, turb = 0, clock = 0, flyFlow = 0;
let morph = 0, hue = 0, grainT = 0;

// Fraktale atmen nur leicht mit (die Sonne wächst stärker)
const fracBreath = () => 1 + (sunScale - 1) * 0.3;

function updateSun(dt, level) {
  const goal = 1 + 0.4 * level;
  sunVel += ((goal - sunScale) * 5.0 - sunVel * 2.2) * dt;   // gedämpfte Feder
  sunScale += sunVel * dt;
  const wobGoal = 0.006 + Math.abs(sunVel) * 0.1 + level * 0.012;
  sunWob += (wobGoal - sunWob) * Math.min(dt * 2, 1);
}
function sunUniforms(u) {
  gl.uniform1f(u.uSunR, SCENE.sunR);
  gl.uniform1f(u.uSunScale, sunScale);
  gl.uniform1f(u.uSunWob, sunWob);
  // Farbe/Helligkeit folgt dem (federnden) Wachstum: ruhig = rote Abendsonne, Summen = hell
  const x = Math.min(Math.max((sunScale - 1) / 0.3, 0), 1);
  gl.uniform1f(u.uSunHeat, x * x * (3 - 2 * x));
  gl.uniform1f(u.uClock, clock);
}

// ---------- Fraktal ----------
const fractalOn = () => S.centerObj === 1;

function drawFractal() {
  gl.useProgram(fracProg.p);
  const u = fracProg.u;
  gl.uniform1f(u.uType, S.fracType);
  gl.uniform1i(u.uIter, S.fracIter);
  gl.uniform1f(u.uExtent, SCENE.partExtent);
  gl.uniform1f(u.uR, SCENE.fracR * S.fracZoom * fracBreath());
  gl.uniform1f(u.uHue, hue);
  gl.uniform1f(u.uInner, S.fracInner);
  gl.bindVertexArray(fullscreen);
  // Ebenen symmetrisch um die innerste: k < 0 = davor, k > 0 = dahinter.
  // Die innerste hat volle Deckkraft; nach vorne und hinten nehmen Deckkraft ab und Sättigung zu.
  const center = (fracCount - 1) / 2;
  const evenShift = fracCount % 2 === 0 ? 0.5 : 0;   // bei gerader Anzahl sind die zwei mittleren "innen"
  for (let i = 0; i < fracCount; i++) {
    const k = i - center;
    const dist = Math.abs(k) - evenShift;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fracFbs[i]);
    gl.viewport(0, 0, FRAC_SIZE, FRAC_SIZE);
    // Echos: etwas früherer Zustand, etwas größer, blasser
    gl.uniform1f(u.uMorph, morph - k * 0.9);          // dahinter = früherer Zustand, davor = späterer
    gl.uniform1f(u.uScale, SCENE.fracR * 0.75 * S.fracZoom * fracBreath() * (1 + k * 0.07));
    gl.uniform1f(u.uFade, Math.pow(S.echoFade, dist));
    gl.uniform1f(u.uSat, 1 + S.echoSat * dist);
    gl.uniform1f(u.uHueOff, S.echoHue * k);            // vorne und hinten in entgegengesetzte Richtung
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// Farbton: Tonhöhe -> Position im Spektrum; ohne Summen langsam zurück zur Sonnenfarbe
function updateHue(dt, pitch, humming) {
  let goal = 0;
  if (humming) {
    const u = Math.min(Math.max(Math.log(pitch / 80) / Math.log(400 / 80), 0), 1);
    goal = u * 2 * Math.PI * S.hueShift;
  }
  hue += (goal - hue) * Math.min(dt * (humming ? 1.5 : 0.15), 1);
}

// ---------- Corona ----------
function drawCorona(dt, level) {
  const keep = Math.pow(0.82, dt * 72);          // Schweife, framerate-unabhängig
  const perLayer = Math.round(S.coronaCount / 3);
  for (let i = 0; i < 3; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, coronaLayers[i].fb);
    gl.viewport(0, 0, PART_SIZE, PART_SIZE);
    gl.enable(gl.BLEND);
    gl.blendColor(0, 0, 0, keep);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    gl.useProgram(fadeProg.p);
    gl.bindVertexArray(fullscreen);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (perLayer > 0) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(partProg.p);
      const u = partProg.u;
      gl.uniform1f(u.uFlow, flow);
      gl.uniform1f(u.uTurb, turb);
      gl.uniform1f(u.uLevel, level);
      sunUniforms(u);
      gl.uniform1f(u.uExtent, SCENE.partExtent);
      gl.uniform1f(u.uPx, PART_SIZE / (2 * SCENE.partExtent));
      gl.uniform1f(u.uIdOffset, i * 100000);
      gl.uniform1f(u.uSizeMul, S.coronaSize);
      gl.uniform1f(u.uNoise, 1 / S.coronaNoise);
      gl.uniform1f(u.uMode, fractalOn() ? 1 : 0);
      gl.uniform1f(u.uFracR, SCENE.fracR * S.fracZoom * fracBreath() * 1.3);
      gl.uniform1f(u.uFracMain, Math.floor((fracCount - 1) / 2));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, fracTex);
      gl.uniform1i(u.uFrac, 0);
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.POINTS, 0, perLayer);
    }
    gl.disable(gl.BLEND);
  }
}

// ---------- Pro Frame: Summen -> Wellen, Sonne, Partikel ----------
const hum = new HumDetector();
let manualHum = false;        // Trigger / Maus / Touch zum Testen ohne Mikro
let amp = 0, phase = 0, lastT = 0;

function update(t) {
  const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 1 / 72;
  lastT = t;

  hum.update();
  const goal = Math.max(hum.level, manualHum ? 0.6 : 0);
  amp += (goal - amp) * 0.1;

  // Wellen: Dynamik-Kurve -> leises Summen = kleine Wellen, lautes Summen = volle Stärke
  const drive = S.waveGain * Math.pow(amp, S.waveDyn) * 0.02;
  const pitch = manualHum && !hum.level ? 150 : hum.pitch;
  const u = Math.min(Math.max(Math.log(pitch / 80) / Math.log(400 / 80), 0), 1);
  const lambda = Math.max(48 * Math.pow(12 / 48, u) * (SIM_SIZE / 512) / S.waveFreq, 5);
  const freq = Math.sqrt(WAVE_K) / lambda;             // Zyklen pro Schritt

  updateSource(dt);
  const steps = Math.min(Math.max(Math.round(dt * simRate()), 1), 24);
  for (let i = 0; i < steps; i++) {
    phase += 2 * Math.PI * freq;
    simStep(drive * Math.sin(phase));
  }

  if (fx) fx.update(hum.level, hum.pitch, hum.rms);

  flow += dt * (0.6 + amp * 2.5);
  turb += dt * (0.4 + amp * 1.5);
  flyFlow += dt * (0.06 + amp * 0.35);
  clock += dt;
  morph += dt * S.fracSpeed * (0.25 + amp * 1.5);
  grainT += dt * S.bgSpeed;
  updateSun(dt, amp);
  updateHue(dt, manualHum && !hum.level ? 150 : hum.pitch, amp > 0.15);
  if (fractalOn()) drawFractal();
  drawCorona(dt, amp);

  if (hum.active) ui.status.textContent =
    `Mikro: ${(hum.level * 100) | 0}% · ${hum.pitch.toFixed(0)} Hz · Klarheit ${hum.clarity.toFixed(2)}`;
}

// ---------- Szene zeichnen ----------
function flyUniforms(u, proj, view, cam, vpH) {
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform3fv(u.uCam, cam);
  gl.uniform3fv(u.uFrom, SCENE.center);
  gl.uniform1f(u.uSunR, SCENE.sunR * sunScale);
  gl.uniform1f(u.uFlow, flyFlow);
  gl.uniform1f(u.uTurb, turb);
  gl.uniform1f(u.uClock, clock);
  gl.uniform1f(u.uSize, S.flySize);
  gl.uniform1f(u.uPxScale, proj[5] * vpH * 0.5);
  gl.uniform1f(u.uLevel, amp);
  gl.uniform1f(u.uHue, fractalOn() ? hue : 0);
}

function drawScene(proj, view, cam, vpW, vpH) {
  gl.useProgram(sceneProg.p);
  const u = sceneProg.u;
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform3fv(u.uCenter, SCENE.center);
  gl.uniform3fv(u.uCam, cam);
  gl.uniform1f(u.uWaterR, SCENE.waterR);
  sunUniforms(u);
  gl.uniform1f(u.uDepth, SCENE.depth);
  gl.uniform1f(u.uBump, SCENE.bump * SIM_SIZE / 512);
  gl.uniform1f(u.uTexel, 1 / SIM_SIZE);
  gl.uniform1f(u.uHalf, SCENE.half);
  gl.uniform1f(u.uExtent, SCENE.partExtent);
  // Tiefenversatz: vordere Ebene Richtung Wasser, hintere hinter die Sonne
  const dz = S.coronaDepth;
  gl.uniform3f(u.uLayerOff, -Math.min(dz * 0.6, SCENE.depth - 0.1), 0, dz);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, simA.tex);
  gl.uniform1i(u.uWave, 0);
  ['uPart0', 'uPart1', 'uPart2'].forEach((name, i) => {
    gl.activeTexture(gl.TEXTURE1 + i);
    gl.bindTexture(gl.TEXTURE_2D, coronaLayers[i].tex);
    gl.uniform1i(u[name], 1 + i);
  });
  gl.uniform1f(u.uMode, fractalOn() ? 1 : 0);
  gl.uniform1f(u.uFracOff, S.fracDepth);
  gl.uniform1f(u.uHue, hue);
  gl.uniform1f(u.uBlend, S.fracBlend);
  gl.uniform1f(u.uRelief, Math.min(S.relief, SCENE.depth - 0.05));   // nicht vor die Wasserebene
  gl.uniform1f(u.uReliefSteps, S.reliefSteps);
  gl.uniform1f(u.uFracRad, SCENE.fracR * S.fracZoom * fracBreath() * 2.4);
  gl.uniform1f(u.uGrain, S.bgGrain ? S.bgStrength : 0);
  gl.uniform1f(u.uGrainSize, S.bgSize);
  gl.uniform1f(u.uGrainT, grainT);
  gl.uniform1f(u.uGrainLayers, S.bgLayers);
  gl.uniform1f(u.uGrainDepth, S.bgDepth);
  gl.uniform1f(u.uFracCount, fracCount);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, fracTex);
  gl.uniform1i(u.uFracArr, 4);
  gl.bindVertexArray(quad);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Partikel, die auf mich zufliegen: erst Schweife, dann Köpfe (additiv)
  const count = S.flyCount | 0;
  if (count > 0) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(emptyVao);
    if (S.flyTail > 0) {
      gl.useProgram(tailProg.p);
      flyUniforms(tailProg.u, proj, view, cam, vpH);
      gl.uniform1f(tailProg.u.uTail, S.flyTail);
      gl.uniform2f(tailProg.u.uVp, vpW, vpH);
      gl.drawArrays(gl.TRIANGLES, 0, count * TAIL_SEGMENTS * 6);
    }
    gl.useProgram(flyProg.p);
    flyUniforms(flyProg.u, proj, view, cam, vpH);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disable(gl.BLEND);
  }
}

// ---------- 2D-Vorschau (Handy / PC) ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

let xrSession = null;
let pointerNDC = null;
let previewFovy = 1.0, previewAspect = 1;

function previewFrame(t) {
  if (xrSession) return;
  const dpr = (window.devicePixelRatio || 1) * SUPERSAMPLE;
  const w = Math.round(canvas.clientWidth * dpr), hgt = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }

  previewAspect = w / hgt;
  previewFovy = previewAspect < 1 ? 1.6 : 1.0;   // Hochformat: weiter, damit die Scheibe reinpasst
  // In der Vorschau folgt das Zentrum dem Zeiger statt dem Blick
  if (pointerNDC) {
    const tf = Math.tan(previewFovy / 2);
    gazeFromRay([0, 0, 0], [pointerNDC[0] * tf * previewAspect, pointerNDC[1] * tf, -1]);
  }

  update(t);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, hgt);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawScene(perspective(previewFovy, previewAspect, 0.1, 100), IDENTITY, [0, 0, 0], w, hgt);
  requestAnimationFrame(previewFrame);
}
requestAnimationFrame(previewFrame);

// Maus / Touch gedrückt halten = Summen simulieren; Position = "Blick"
const toNDC = (e) => [(e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2];
canvas.addEventListener('pointerdown', (e) => { manualHum = true; pointerNDC = toNDC(e); });
canvas.addEventListener('pointermove', (e) => { pointerNDC = toNDC(e); });
addEventListener('pointerup', () => { manualHum = false; });

// ---------- Einstellungs-Oberfläche ----------
let fx = null;
const fxState = {};

function decimals(step) { return step >= 1 ? 0 : Math.min(Math.ceil(-Math.log10(step)), 4); }

function applySetting(key) {
  if (key === 'simRes') setSimRes(S.simRes);
  if (key === 'fracRes' || key === 'fracCount') setFracLayers(S.fracRes, S.fracCount);
  if (!fx) return;
  if (key === 'volume') fx.setVolume(S.volume);
  if (key === 'dry') fx.setDry(S.dry);
  if (key === 'gateThr') fx.setGateThreshold(S.gateThr);
}

SECTIONS.forEach((sec, i) => {
  const det = document.createElement('details');
  det.open = load('ui.open.' + i, i === 0);
  det.addEventListener('toggle', () => save('ui.open.' + i, det.open));
  const sum = document.createElement('summary');
  sum.textContent = sec.title;
  det.appendChild(sum);
  const body = document.createElement('div');
  body.className = 'body';
  det.appendChild(body);

  if (sec.effects) {
    const row = document.createElement('div');
    row.className = 'chips';
    for (const [key, { label, default: def }] of Object.entries(EFFECTS)) {
      fxState[key] = load('fx.' + key, def);
      const el = document.createElement('label');
      el.className = 'chip';
      el.innerHTML = `<input type="checkbox"> ${label}`;
      const box = el.querySelector('input');
      box.checked = fxState[key];
      box.addEventListener('change', () => {
        fxState[key] = box.checked;
        save('fx.' + key, box.checked);
        if (fx) fx.set(key, box.checked);
      });
      row.appendChild(el);
    }
    body.appendChild(row);
  }

  for (const [key, d] of Object.entries(sec.items)) {
    const row = document.createElement('label');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = d.label;
    const val = document.createElement('span');
    val.className = 'val';
    let input;
    if (d.options) {
      input = document.createElement('select');
      for (const [v, text] of d.options) input.add(new Option(text, v));
      input.value = S[key];
    } else if (d.toggle) {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = S[key];
    } else {
      input = document.createElement('input');
      Object.assign(input, { type: 'range', min: d.min, max: d.max, step: d.step });
      input.value = S[key];
    }
    const show = () => { val.textContent = d.min !== undefined ? (+S[key]).toFixed(decimals(d.step)) : ''; };
    input.addEventListener(d.options || d.toggle ? 'change' : 'input', () => {
      S[key] = d.toggle ? input.checked : +input.value;
      save('set.' + key, S[key]);
      applySetting(key);
      show();
    });
    row.append(name, input, val);
    body.appendChild(row);
    show();
  }
  ui.panel.appendChild(det);
});
ui.toggle.addEventListener('click', () => ui.panel.classList.toggle('hidden'));

ui.mic.addEventListener('click', async () => {
  try {
    await hum.start();
    fx = new VoiceFX(hum.ctx, hum.source);
    Object.assign(fx.enabled, fxState);
    await fx.init();
    for (const k of ['volume', 'dry', 'gateThr']) applySetting(k);
    ui.mic.textContent = '🎤 Mikrofon aktiv';
    ui.mic.disabled = true;
  } catch (e) {
    ui.status.textContent = 'Mikrofon nicht verfügbar: ' + e.message;
  }
});

// ---------- WebXR ----------
let refSpace = null;

async function initXR() {
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr'))) {
    ui.vr.textContent = 'VR nicht verfügbar';
    ui.vr.disabled = true;
    return;
  }
  ui.vr.addEventListener('click', startXR);
}

async function startXR() {
  const session = await navigator.xr.requestSession('immersive-vr');
  xrSession = session;
  await gl.makeXRCompatible();

  const native = XRWebGLLayer.getNativeFramebufferScaleFactor(session) || 1;
  const layer = new XRWebGLLayer(session, gl, {
    antialias: false,
    depth: false,
    framebufferScaleFactor: native * SUPERSAMPLE,
  });
  session.updateRenderState({ baseLayer: layer, depthNear: 0.1, depthFar: 100 });
  refSpace = await session.requestReferenceSpace('local');

  ui.status.textContent = `XR-Framebuffer: ${layer.framebufferWidth}×${layer.framebufferHeight} ` +
    `(Faktor ${(native * SUPERSAMPLE).toFixed(2)})`;
  console.log(ui.status.textContent);

  session.addEventListener('selectstart', () => { manualHum = true; });
  session.addEventListener('selectend', () => { manualHum = false; });
  session.addEventListener('end', () => {
    xrSession = null;
    lastT = 0;
    requestAnimationFrame(previewFrame);
  });
  session.requestAnimationFrame(xrFrame);
}

// Vorwärtsrichtung (0,0,-1) mit der Kopf-Orientierung (Quaternion) drehen
function forward(q) {
  const { x, y, z, w } = q;
  return [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
}

function xrFrame(t, frame) {
  const session = frame.session;
  session.requestAnimationFrame(xrFrame);
  const pose = frame.getViewerPose(refSpace);
  if (!pose) return;

  const hp = pose.transform.position;
  gazeFromRay([hp.x, hp.y, hp.z], forward(pose.transform.orientation));
  update(t);

  const layer = session.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const view of pose.views) {
    const vp = layer.getViewport(view);
    gl.viewport(vp.x, vp.y, vp.width, vp.height);
    const p = view.transform.position;
    drawScene(view.projectionMatrix, view.transform.inverse.matrix, [p.x, p.y, p.z], vp.width, vp.height);
  }
}

initXR();
