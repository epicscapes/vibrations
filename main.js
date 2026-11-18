// Vibrations – Vanilla WebGL2 + WebXR (kein Framework)
import {
  simVS, simFS, sceneVS, sceneFS, partVS, partFS, fadeFS,
  flyVS, flyFS, tailVS, tailFS, TAIL_SEGMENTS, fracFS,
  sandUpdateFS, sandVS, sandFS,
} from './shaders.js';
import { HumDetector, VoiceFX, EFFECTS } from './audio.js';

// Bei jedem Update erhöhen, damit man auf der Quest sieht, ob die neue Version geladen ist.
const VERSION = 'v0.12.0';

// ---------- Feste Szenenwerte ----------
const params = new URLSearchParams(location.search);
const SUPERSAMPLE = parseFloat(params.get('scale') || '1.5'); // 150 % der nativen Display-Auflösung
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
    fracFocus: { label: 'Stärkste Ebene', options: [[0, 'Vorderste'], [1, 'Mittlere']], def: 0 },
    fracBlend: { label: 'Ebenen-Mischmodus', options: [[0, 'Normal'], [1, 'Additiv'], [2, 'Screen'], [3, 'Difference'], [4, 'Aufhellen']], def: 0 },
    echoFade:  { label: 'Echo-Deckkraft', min: 0.1, max: 1, step: 0.05, def: 0.55 },
    echoSat:   { label: 'Echo-Sättigung (+ pro Abstand)', min: 0, max: 1, step: 0.05, def: 0.35 },
    echoHue:   { label: 'Echo-Farbversatz (pro Abstand)', min: -1, max: 1, step: 0.05, def: 0.2 },
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
    waveSpeed:  { label: 'Ausbreitungs-Tempo', min: 0.3, max: 4, step: 0.1, def: 1 },
    waveDecay:  { label: 'Abklingzeit (s)', min: 0.1, max: 12, step: 0.1, def: 2 },
    ior:        { label: 'Brechung (IOR)', min: 0.5, max: 2.2, step: 0.01, def: 1.33 },
    edgeSoft:   { label: 'Rand-Ausblendung (nur optisch)', min: 0, max: 0.6, step: 0.02, def: 0.25 },
    glow:       { label: 'Leuchtende Wellen', min: 0, max: 1.5, step: 0.05, def: 0 },
    sand:       { label: 'Sand-Muster', toggle: true, def: false },
    sandCount:  { label: 'Sand: Anzahl', min: 2000, max: 80000, step: 2000, def: 24000 },
    sandSize:   { label: 'Sand: Korngröße', min: 0.004, max: 0.04, step: 0.002, def: 0.012 },
    sandFade:   { label: 'Sand: Nachleuchten (s)', min: 0.5, max: 15, step: 0.5, def: 4 },
    sandFlow:   { label: 'Sand: Sammeln in Knotenlinien', min: 0.002, max: 0.05, step: 0.002, def: 0.012 },
    sandPos:    { label: 'Sand: Abstand vor dem Wasser (m)', min: 0, max: 4.6, step: 0.05, def: 0 },
    sandSpread: { label: 'Sand: Tiefen-Streuung (m)', min: 0, max: 3, step: 0.05, def: 0 },
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
  preview: document.getElementById('preview'),
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
const sandUpdProg = program(simVS, sandUpdateFS);
const sandProg = program(sandVS, sandFS);
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
// Ausbreitungs-Tempo: zuerst c² bis kurz unter die Stabilitätsgrenze (0,5), danach mehr Schritte pro Sekunde
const waveK = () => Math.min(0.25 * S.waveSpeed * S.waveSpeed, 0.45);
const simRate = () => 480 * SIM_SIZE / 512 * Math.max(S.waveSpeed * 0.5 / Math.sqrt(waveK()), 1);
// Abklingen: Halbwertszeit in Sekunden -> Dämpfung pro Schritt
const waveDamp = () => Math.pow(0.5, 1 / (S.waveDecay * simRate()));
function setSimRes(size) {
  for (const t of [simA, simB]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
  SIM_SIZE = size;
  simA = target(size, gl.RGBA16F, gl.RGBA);
  simB = target(size, gl.RGBA16F, gl.RGBA);
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

let envK = 0.01;
function simStep(drive) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fb);
  gl.viewport(0, 0, SIM_SIZE, SIM_SIZE);
  gl.useProgram(simProg.p);
  const u = simProg.u;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, simA.tex);
  gl.uniform1i(u.uState, 0);
  gl.uniform1f(u.uK, waveK());
  gl.uniform1f(u.uDamp, waveDamp());
  gl.uniform1f(u.uEnvK, envK);
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

// Strahl (Blick, Controller oder Zeiger) mit der Wasserebene schneiden -> UV, innerhalb des Behälters gehalten
function rayToUV(origin, dir, max = 0.3) {
  if (dir[2] >= -0.05) return null;
  const t = (SCENE.center[2] - origin[2]) / dir[2];
  let x = (origin[0] + dir[0] * t - SCENE.center[0]) / (2 * SCENE.waterR);
  let y = (origin[1] + dir[1] * t - SCENE.center[1]) / (2 * SCENE.waterR);
  const r = Math.hypot(x, y);
  if (r > max) { x *= max / r; y *= max / r; }
  return [0.5 + x, 0.5 + y];
}
function gazeFromRay(origin, dir) { const uv = rayToUV(origin, dir); if (uv) gazeUV = uv; }

// Controller: wohin der unsichtbare "Laserpointer" der Hand zeigt, deren Trigger am festesten gedrückt ist
let ctrlUV = null, ctrlValue = 0;
const TRIGGER_MAX = 1 / 3;     // voll gedrückter Trigger = 1/3 der bisherigen Wellenstärke

function updateSource(dt) {
  let goal, k;
  if (ctrlValue > 0.02 && ctrlUV) {
    goal = ctrlUV; k = Math.min(dt * 12, 1);         // folgt der Hand fast sofort
  } else {
    goal = S.follow ? gazeUV : [0.5, 0.5];
    k = Math.min(dt * S.followSpeed, 1);              // verzögert nachziehen
  }
  srcPos = [srcPos[0] + (goal[0] - srcPos[0]) * k, srcPos[1] + (goal[1] - srcPos[1]) * k];
}

// ---------- Sand (Cymatics-Partikel) ----------
// Zustand in einer Float32-Textur (Position braucht Präzision); nur angelegt, wenn Sand an ist.
let sandSize = 0, sandA = null, sandB = null, sandVis = 0, sandTime = 0;
function stateTarget(size) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fb };
}
function ensureSand() {
  const want = S.sand ? Math.ceil(Math.sqrt(S.sandCount)) : 0;
  if (want === sandSize) return;
  for (const t of [sandA, sandB]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
  sandA = sandB = null;
  sandSize = want;
  if (want) { sandA = stateTarget(want); sandB = stateTarget(want); }
}
function updateSand(dt, level) {
  ensureSand();
  if (!sandSize) return;
  // sichtbar beim Summen, danach langsam verschwinden
  const goal = level > 0.05 ? 1 : 0;
  sandVis += (goal - sandVis) * Math.min(dt * (goal > sandVis ? 1.5 : 1 / S.sandFade), 1);
  sandTime += dt;
  gl.bindFramebuffer(gl.FRAMEBUFFER, sandB.fb);
  gl.viewport(0, 0, sandSize, sandSize);
  gl.useProgram(sandUpdProg.p);
  const u = sandUpdProg.u;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sandA.tex);
  gl.uniform1i(u.uState, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, simA.tex);
  gl.uniform1i(u.uWave, 1);
  gl.uniform1f(u.uDt, dt);
  gl.uniform1f(u.uLife, S.sandFade * 2.5);
  gl.uniform1f(u.uTime, sandTime % 1000);
  gl.uniform1f(u.uMobility, S.sandFlow);
  gl.uniform1f(u.uJitter, 0.3);
  gl.bindVertexArray(fullscreen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  [sandA, sandB] = [sandB, sandA];
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
// Index der stärksten Ebene als Mittelpunkt der Verteilung: 0 = vorderste, (n-1)/2 = mittlere
const fracCenter = () => (S.fracFocus === 1 ? (fracCount - 1) / 2 : 0);

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
  // Ebenen um die stärkste verteilt: k < 0 = davor, k > 0 = dahinter (bei „Vorderste“ gibt es nur k ≥ 0).
  // Die stärkste hat volle Deckkraft; mit dem Abstand nehmen Deckkraft ab und Sättigung zu.
  const center = fracCenter();
  const evenShift = S.fracFocus === 1 && fracCount % 2 === 0 ? 0.5 : 0;   // gerade Anzahl: zwei mittlere
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
    gl.uniform1f(u.uHueOff, S.echoHue * k);            // davor / dahinter in entgegengesetzte Richtung
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
      gl.uniform1f(u.uFracMain, Math.floor(fracCenter()));
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
  // Anregung: Summen, Trigger (analog, beide Hände) oder gedrückter Zeiger in der Vorschau
  const goal = Math.max(hum.level, manualHum ? 0.6 : 0, ctrlValue);
  amp += (goal - amp) * 0.1;
  const pitch = (manualHum || ctrlValue > 0.02) && hum.level < 0.05 ? 150 : hum.pitch;

  // Wellen: Dynamik-Kurve -> leises Summen = kleine Wellen, lautes Summen = volle Stärke.
  // Kommt die Anregung vom Trigger, ist sie auf 1/3 begrenzt.
  const triggerOnly = ctrlValue > hum.level;
  const drive = S.waveGain * Math.pow(amp, S.waveDyn) * 0.02 * (triggerOnly ? TRIGGER_MAX : 1);
  const u = Math.min(Math.max(Math.log(pitch / 80) / Math.log(400 / 80), 0), 1);
  const lambda = Math.max(48 * Math.pow(12 / 48, u) * (SIM_SIZE / 512) / S.waveFreq, 5);
  const freq = Math.sqrt(waveK()) / lambda;            // Zyklen pro Schritt

  updateSource(dt);
  const rate = simRate();
  envK = 1 - Math.exp(-1 / (0.25 * rate));             // Hüllkurve folgt mit ~0,25 s
  const steps = Math.min(Math.max(Math.round(dt * rate), 1), 48);
  for (let i = 0; i < steps; i++) {
    phase += 2 * Math.PI * freq;
    simStep(drive * Math.sin(phase));
  }
  updateSand(dt, amp);

  if (fx) fx.update(hum.level, hum.pitch, hum.rms);

  flow += dt * (0.6 + amp * 2.5);
  turb += dt * (0.4 + amp * 1.5);
  flyFlow += dt * (0.06 + amp * 0.35);
  clock += dt;
  morph += dt * S.fracSpeed * (0.25 + amp * 1.5);
  grainT += dt * S.bgSpeed;
  updateSun(dt, amp);
  updateHue(dt, pitch, amp > 0.15);
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
  gl.uniform1f(u.uIOR, S.ior);
  gl.uniform1f(u.uEdgeSoft, S.edgeSoft);
  gl.uniform1f(u.uFracCenter, fracCenter());
  gl.uniform1f(u.uGlow, S.glow);
  gl.uniform1f(u.uR, 0.49);
  gl.uniform1f(u.uShape, S.shape);
  gl.uniform1f(u.uLobe, SCENE.lobe);
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

  // Sand auf der Wasseroberfläche (additiv)
  if (sandSize && sandVis > 0.003) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(sandProg.p);
    const g = sandProg.u;
    gl.uniformMatrix4fv(g.uProj, false, proj);
    gl.uniformMatrix4fv(g.uView, false, view);
    gl.uniform3fv(g.uCenter, SCENE.center);
    gl.uniform1f(g.uWaterR, SCENE.waterR);
    gl.uniform1f(g.uSize, S.sandSize);
    gl.uniform1f(g.uPxScale, proj[5] * vpH * 0.5);
    gl.uniform1f(g.uVis, sandVis);
    gl.uniform3fv(g.uCam, cam);
    gl.uniform1f(g.uSandPos, S.sandPos);
    gl.uniform1f(g.uSandSpread, S.sandSpread);
    gl.uniform1f(g.uEdgeSoft, S.edgeSoft);
    gl.uniform1f(g.uR, 0.49);
    gl.uniform1f(g.uShape, S.shape);
    gl.uniform1f(g.uLobe, SCENE.lobe);
    const c = hueRGB([1.0, 0.72, 0.42], fractalOn() ? hue : 0);
    gl.uniform3f(g.uColor, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sandA.tex);
    gl.uniform1i(g.uState, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, simA.tex);
    gl.uniform1i(g.uWave, 1);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.POINTS, 0, sandSize * sandSize);
    gl.disable(gl.BLEND);
  }

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

// Hue-Shift auf der CPU (gleiche YIQ-Rotation wie im Shader)
function hueRGB([r, g, b], a) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b, i = 0.596 * r - 0.274 * g - 0.322 * b, q = 0.211 * r - 0.523 * g + 0.312 * b;
  const c = Math.cos(a), s = Math.sin(a), i2 = c * i - s * q, q2 = s * i + c * q;
  return [y + 0.956 * i2 + 0.621 * q2, y - 0.272 * i2 - 0.647 * q2, y - 1.106 * i2 + 1.703 * q2].map((v) => Math.max(v, 0));
}

// ---------- 2D-Vorschau (Handy / PC) ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

let xrSession = null;
let pointerNDC = null;
let previewFovy = 0.75, previewAspect = 1;

// Vorschau: kleines Portal in der Seitenmitte, enger Blickwinkel, volle (nicht überabgetastete) Auflösung.
// Standardmäßig aus, damit der Quest-Browser ohne VR nicht unnötig rechnet.
let previewOn = load('ui.preview', false);
let previewRunning = false;
function setPreview(on) {
  previewOn = on;
  save('ui.preview', on);
  canvas.classList.toggle('off', !on);
  ui.preview.textContent = on ? 'Preview aus' : 'Preview aktivieren';
  if (on && !previewRunning && !xrSession) { lastT = 0; previewRunning = true; requestAnimationFrame(previewFrame); }
}

function previewFrame(t) {
  if (xrSession || !previewOn) { previewRunning = false; return; }
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), hgt = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }

  previewAspect = w / hgt;
  previewFovy = parseFloat(params.get('fov') || '0.75');   // ca. 43° – Ausschnitt um das Zentrum
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
ui.preview.addEventListener('click', () => setPreview(!previewOn));
setPreview(previewOn);

// Maus / Touch gedrückt halten = Summen simulieren; Position = "Blick"
const toNDC = (e) => {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
};
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

  session.addEventListener('end', () => {
    xrSession = null;
    lastT = 0;
    ctrlValue = 0;
    if (previewOn) { previewRunning = true; requestAnimationFrame(previewFrame); }
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

  // Controller (beide Hände): Stärke = Trigger-Druck, Ort = unsichtbarer Strahl der fester gedrückten Hand
  ctrlValue = 0;
  for (const src of session.inputSources) {
    if (!src.gamepad || !src.gamepad.buttons.length) continue;
    const v = src.gamepad.buttons[0].value;          // Trigger, analog 0..1
    if (v <= ctrlValue) continue;
    ctrlValue = v;
    const rp = frame.getPose(src.targetRaySpace, refSpace);
    if (rp) {
      const o = rp.transform.position;
      const uv = rayToUV([o.x, o.y, o.z], forward(rp.transform.orientation), 0.42);
      if (uv) ctrlUV = uv;
    }
  }
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
