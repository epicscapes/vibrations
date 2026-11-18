// Experience „Flow Drift“ – eine Kugel, angetrieben vom eigenen Summen, rollt durch eine Hügellandschaft.
// Vanilla WebGL2 + WebXR. Teilt Stimmerkennung/-effekte (audio.js) und VR-Menü (vrmenu.js) mit Soothing Ripples.
import {
  skyVS, skyFS, terrainVS, terrainFS, ballVS, ballFS, sparkVS, sparkFS,
  ringVS, ringFS, ribbonVS, ribbonFS, glowVS, glowFS, wingVS, wingFS, WING_FEATHERS, MAX_LIGHTS, compFS, shaftVS, shaftFS,
} from './flowshaders.js';
import { Bloom } from './flowpost.js';
import { FlowAudio } from './flowsound.js';
import { HumDetector, VoiceFX, EFFECTS } from './audio.js';
import { VRMenu } from './vrmenu.js';
import {
  mul, translation, rotationY, rotationX, perspective, invert, transformDir,
  axisAngle3, mul3, orthonormalize3, v3,
} from './mat.js';

const VERSION = 'v' + (window.VIBRATIONS_VERSION || '?');
const params = new URLSearchParams(location.search);
const R = 0.3;                // Kugelradius (m)
const RC = 0.12;              // Radius der Begleitkugeln (m)
const G = 9.81;

// ---------- Gelände (Level 1 „Rolling Hills“) – identisch zu TERRAIN_GLSL in flowshaders.js ----------
function terrainH(x, z) {
  return 1.1 * Math.sin(x * 0.17) * Math.cos(z * 0.14)
       + 0.55 * Math.sin(x * 0.071 + z * 0.113 + 1.3)
       + 0.30 * Math.sin((x - z) * 0.29 + 0.7)
       + 0.18 * Math.cos(x * 0.43 + z * 0.21);
}
function terrainGrad(x, z) {
  const e = 0.05;
  return [(terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e), (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e)];
}

// ---------- Einstellungen (UI-Bezeichnungen auf Englisch) ----------
function load(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

const SECTIONS = [
  { title: 'Voice & Effects', items: {
    volume:  { label: 'Effects volume', min: 0, max: 1.5, step: 0.05, def: 0.7 },
    dry:     { label: 'Dry voice', min: 0, max: 1.5, step: 0.05, def: 0 },
    gateThr: { label: 'Gate threshold', min: 0.0005, max: 0.02, step: 0.0005, def: 0.002 },
  }, effects: true },
  { title: 'Level', items: {
    fdLevel:     { label: 'Level', options: [[1, 'Level 1 – Rolling Hills']], def: 1 },
    fdGoals:     { label: 'Goals', min: 5, max: 80, step: 1, def: 30 },
    fdCompanion: { label: 'Companion chance', min: 0, max: 1, step: 0.05, def: 0.35 },
    fdMagnet:    { label: 'Companion magnet', min: 0.5, max: 8, step: 0.25, def: 2.5 },
  }},
  { title: 'Camera', items: {
    fdCam:  { label: 'POV ↔ third person', min: 0, max: 1, step: 0.01, def: 0.75 },
    fdTurn: { label: 'Turn speed (°/s)', min: 15, max: 150, step: 5, def: 60 },
  }},
  { title: 'Ball', items: {
    fdThrust:   { label: 'Thrust', min: 0.5, max: 12, step: 0.5, def: 4 },
    fdFriction: { label: 'Friction', min: 0.05, max: 1.5, step: 0.05, def: 0.35 },
    fdMaxSpeed: { label: 'Max speed (m/s)', min: 2, max: 20, step: 0.5, def: 9 },
    fdIOR:      { label: 'Refraction (IOR)', min: 1, max: 2.2, step: 0.01, def: 1.4 },
    fdRough:    { label: 'Roughness', min: 0, max: 1, step: 0.05, def: 0.25 },
    fdBallFresnel: { label: 'Ball fresnel', min: 0, max: 1, step: 0.05, def: 0.4 },
    fdLayers:   { label: 'Inner layers', min: 0, max: 3, step: 1, def: 3 },
    fdLayerScale: { label: 'Inner layer scale', min: 0.3, max: 1.2, step: 0.05, def: 1 },
    fdLayerSpin:  { label: 'Inner layer spin', min: 0, max: 2, step: 0.05, def: 1 },
    fdRipples:  { label: 'Ripple intensity', min: 0, max: 2, step: 0.05, def: 1 },
    fdRipFreq:  { label: 'Ripple frequency', min: 4, max: 36, step: 1, def: 14 },
    fdRipFade:  { label: 'Ripple fade-out (s)', min: 0.1, max: 4, step: 0.1, def: 0.5 },
  }},
  { title: 'Effects', items: {
    fdTrail:     { label: 'Trail density', min: 0, max: 80, step: 2, def: 30 },
    fdTrailLife: { label: 'Trail lifetime (s)', min: 3, max: 60, step: 1, def: 25 },
    fdRings:     { label: 'Warp rings', min: 0, max: 2, step: 0.05, def: 1 },
    fdRibbon:    { label: 'Ribbon length (s)', min: 0, max: 4, step: 0.1, def: 1.8 },
    fdLines:     { label: 'Glowing ground lines', min: 0, max: 1.5, step: 0.05, def: 0.5 },
    fdGrain:     { label: 'Ground grain', min: 0, max: 1, step: 0.05, def: 0.5 },
    fdFresnel:   { label: 'Ground fresnel', min: 0, max: 1, step: 0.05, def: 0.4 },
    fdSpecRough: { label: 'Light highlight roughness', min: 0, max: 1, step: 0.05, def: 0.5 },
    fdSparks:    { label: 'Collision sparks', min: 0, max: 2, step: 0.05, def: 1 },
  }},
  { title: 'Atmosphere', items: {
    fdAuroraInt: { label: 'Aurora sky', min: 0, max: 2, step: 0.05, def: 1 },
    fdShafts:  { label: 'Light shafts', min: 0, max: 2, step: 0.05, def: 0.5 },
    fdBloom:   { label: 'Bloom (post effect)', toggle: true, def: false },
    fdBloomStr:  { label: 'Bloom strength', min: 0, max: 2, step: 0.05, def: 0.7 },
    fdBloomSoft: { label: 'Bloom softness', min: 0, max: 1, step: 0.05, def: 0.5 },
  }},
  { title: 'Audio', items: {
    fdMusic: { label: 'Music volume', min: 0, max: 1.5, step: 0.05, def: 0.7 },
    fdRoll:  { label: 'Rolling volume', min: 0, max: 1.5, step: 0.05, def: 0.8 },
    fdSfx:   { label: 'Goal sound volume', min: 0, max: 1.5, step: 0.05, def: 0.8 },
    fdPurr:  { label: 'Purr volume', min: 0, max: 1.5, step: 0.05, def: 0.8 },
  }},
  { title: 'Display', items: {
    // gilt nur für diese Experience und wird nicht gespeichert (jedes Laden startet mit 150 %)
    superSample: { label: 'Supersampling (%)', min: 100, max: 300, step: 10, def: 150, session: true },
  }},
];
const S = {};
for (const sec of SECTIONS) for (const [k, d] of Object.entries(sec.items)) {
  let v = d.session ? d.def : load('set.' + k, d.def);
  if (d.options && !d.options.some(([ov]) => ov === v)) v = d.def;
  if (d.min !== undefined && !(v >= d.min && v <= d.max)) v = d.def;
  if (d.toggle && typeof v !== 'boolean') v = d.def;
  S[k] = v;
}

// ?scale=1.2 in der Adresse setzt den Startwert des Supersamplings (zum Testen)
if (params.get('scale')) S.superSample = Math.round(parseFloat(params.get('scale')) * 100);

const ui = {
  version: document.getElementById('version'),
  status: document.getElementById('status'),
  mic: document.getElementById('mic'),
  vr: document.getElementById('vr'),
  panel: document.getElementById('panel'),
  toggle: document.getElementById('toggle'),
  preview: document.getElementById('preview'),
};
ui.version.textContent = `Vibrations ${VERSION} · Flow Drift`;
ui.status.textContent = 'Hold / W = hum · A/D = turn view · ←/→ = steer · Space = jump · F = wings';

// ---------- WebGL2 ----------
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, xrCompatible: true, alpha: false, depth: true });
if (!gl) throw fail('WebGL2 is not supported.');
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
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

const P = {
  sky: program(skyVS, skyFS), terrain: program(terrainVS, terrainFS), ball: program(ballVS, ballFS),
  spark: program(sparkVS, sparkFS), ring: program(ringVS, ringFS), ribbon: program(ribbonVS, ribbonFS),
  glow: program(glowVS, glowFS), wing: program(wingVS, wingFS), comp: program(ballVS, compFS),
  shaft: program(shaftVS, shaftFS),
};
const emptyVao = gl.createVertexArray();

function gridMesh(n, m) {
  const pts = new Float32Array((n + 1) * (m + 1) * 2);
  for (let y = 0, k = 0; y <= m; y++) for (let x = 0; x <= n; x++) { pts[k++] = x / n; pts[k++] = y / m; }
  const idx = new Uint32Array(n * m * 6);
  for (let y = 0, k = 0; y < m; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
    idx.set([a, c, b, b, c, d], k); k += 6;
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  return { vao, count: idx.length };
}
const TERRAIN_N = 180, TERRAIN_SIZE = 110;
const terrainMesh = gridMesh(TERRAIN_N, TERRAIN_N);
const sphereMesh = gridMesh(48, 24);
const fullscreen = (() => {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  return vao;
})();

// Dynamischer Punkt-Puffer: pos(3) + data(4) pro Eintrag
function pointBuffer(capacity) {
  const data = new Float32Array(capacity * 7);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
  return { data, vao, buf, capacity };
}

// ---------- Zustand ----------
const ball = { pos: [0, terrainH(0, 0) + R, 0], vel: [0, 0], vy: 0, rot: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
let grounded = 1;                 // 1 = rollt auf dem Boden, 0 = in der Luft
let groundSmooth = terrainH(0, 0);// geglättete Bodenhöhe (Schweben folgt den Hügeln weich)
let wing = 0, wingGoal = 0;       // Flügel 0..1 (Arme ausbreiten)
let jumpPressed = false, jumpPrev = false;
let yaw = 0;                      // Drehung der Ansicht um die Kugel
let rigPos = null;                // Weltposition des XR-Ursprungs (folgt der Kugel weich)
let time = 0, hue = 0, propel = 0, driveVis = 0;
let ripEnv = 0;                   // Ripple-Hüllkurve (schnell an, klingt mit fdRipFade aus)
const shellRot = [0, 1, 2].map(() => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
const shellRadius = (k) => Math.min((0.8 - k * 0.22) * S.fdLayerScale, 0.95);
let moveDir = [0, -1];            // aktuelle Fahrtrichtung (xz)
let headFwd = [0, -1];            // Blickrichtung (xz, Welt)
let manualHum = false;
const keys = new Set();
let stick = [0, 0], turn = 0, trigger = 0;
const IDENT3 = () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

// Zufall mit Saat (Goals sollen bei jedem Start gleich verteilt sein)
let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// Schimmernder Pfad: Ringpuffer
const trail = pointBuffer(30000);
let trailHead = 0, trailDist = 0;
const trailDirty = [];
// Explosionen der Goals
const bursts = pointBuffer(3000);
const burstList = [];
const chips = pointBuffer(1500);   // Kollisions-Splitter: fliegen weg, bleiben kurz am Boden liegen
const chipList = [];
// Goals & Begleiter
const glowBuf = pointBuffer(256);
let goals = [];
const companions = [];
let companionId = 0;
// Warp-Ringe und Ribbon
const rings = [];
let ringTimer = 0;
const history = [];
const ribbonVao = gl.createVertexArray();
const ribbonBuf = gl.createBuffer();
gl.bindVertexArray(ribbonVao);
gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuf);
gl.bufferData(gl.ARRAY_BUFFER, 400 * 2 * 5 * 4, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
let ribbonCount = 0;

function placeGoal(cx, cz, rMin, rMax) {
  const a = rand() * Math.PI * 2, r = rMin + rand() * (rMax - rMin);
  return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, phase: rand() * 6.28, companion: rand() < S.fdCompanion, hue: (rand() - 0.5) * 0.8 };
}
function resetGoals() {
  seed = 12345;
  goals = [];
  for (let i = 0; i < S.fdGoals; i++) goals.push(placeGoal(ball.pos[0], ball.pos[2], 6, 55));
}
resetGoals();

// ---------- Audio ----------
const hum = new HumDetector();
let fx = null, sound = null;
function ensureSound() {
  if (sound) return;
  sound = new FlowAudio(hum.ctx || new AudioContext());
  applyVolumes();
  for (const c of companions) sound.addPurr(c.id);   // Begleiter, die schon vor dem Ton da waren
}
function applyVolumes() {
  if (sound) sound.setVolumes({ music: S.fdMusic, roll: S.fdRoll, sfx: S.fdSfx, purr: S.fdPurr });
}

// ---------- Simulation ----------
function update(dt) {
  time += dt;
  hum.update();
  const keyHum = keys.has('w') || keys.has('arrowup');
  const goal = Math.max(hum.level, manualHum || keyHum ? 0.7 : 0, trigger * 0.8);
  propel += (goal - propel) * Math.min(dt * 6, 1);

  // Farbton nach Stimmfrequenz; ohne Summen langsam zurück zur Grundfarbe
  if (hum.level > 0.1) {
    const u = Math.min(Math.max(Math.log(hum.pitch / 80) / Math.log(400 / 80), 0), 1);
    hue += (u * 2 * Math.PI - hue) * Math.min(dt * 1.5, 1);
  } else hue += (0 - hue) * Math.min(dt * 0.15, 1);

  // Ansicht drehen (linker Stick / A, D)
  const kTurn = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0);
  yaw += (kTurn - turn) * S.fdTurn * Math.PI / 180 * dt;

  // Richtung: Blickrichtung + rechter Stick (bzw. Pfeiltasten)
  const fwd = headFwd;
  const right = [-fwd[1], fwd[0]];
  let sx = stick[0], sy = stick[1];
  if (keys.has('arrowleft')) sx -= 1;
  if (keys.has('arrowright')) sx += 1;
  let dir = fwd;
  if (Math.hypot(sx, sy) > 0.15) {
    const s = [fwd[0] * -sy + right[0] * sx, fwd[1] * -sy + right[1] * sx];
    dir = [fwd[0] + s[0] * 1.5, fwd[1] + s[1] * 1.5];
    const l = Math.hypot(...dir) || 1;
    dir = [dir[0] / l, dir[1] / l];
  }

  // Physik: Hangabtrieb (rollende Kugel: 5/7 g, nur am Boden), Antrieb, Reibung
  const [gx, gz] = terrainGrad(ball.pos[0], ball.pos[2]);
  const slope = (5 / 7) * G * 0.6 * grounded;
  const ax = -slope * gx + dir[0] * propel * S.fdThrust;
  const az = -slope * gz + dir[1] * propel * S.fdThrust;
  ball.vel[0] += ax * dt; ball.vel[1] += az * dt;
  const damp = Math.exp(-S.fdFriction * dt);
  ball.vel[0] *= damp; ball.vel[1] *= damp;
  let speed = Math.hypot(ball.vel[0], ball.vel[1]);
  if (speed > S.fdMaxSpeed) { ball.vel[0] *= S.fdMaxSpeed / speed; ball.vel[1] *= S.fdMaxSpeed / speed; speed = S.fdMaxSpeed; }
  const prev = [...ball.pos];
  ball.pos[0] += ball.vel[0] * dt;
  ball.pos[2] += ball.vel[1] * dt;
  updateVertical(dt);
  if (speed > 0.2) moveDir = [ball.vel[0] / speed, ball.vel[1] / speed];
  else moveDir = dir;

  // Rollen: Drehachse senkrecht zur Bewegung
  const step = v3.sub(ball.pos, prev);
  const dist = v3.len(step);
  if (dist > 1e-5) {
    const axis = v3.norm(v3.cross([0, 1, 0], step));
    ball.rot = mul3(axisAngle3(axis, dist / R), ball.rot);
    // innere Schalen: gleiche Achse, Tempo umgekehrt proportional zur Größe (kleinere drehen schneller)
    for (let k = 0; k < 3; k++) {
      const f = 1 + (1 / shellRadius(k) - 1) * S.fdLayerSpin;
      shellRot[k] = mul3(axisAngle3(axis, dist / R * f), shellRot[k]);
    }
    if ((time * 60 | 0) % 60 === 0) { ball.rot = orthonormalize3(ball.rot); for (let k = 0; k < 3; k++) shellRot[k] = orthonormalize3(shellRot[k]); }
  }

  driveVis += (propel - driveVis) * Math.min(dt * 4, 1);
  const ripGoal = Math.min(propel * 1.4, 1);
  ripEnv = ripGoal > ripEnv ? ripEnv + (ripGoal - ripEnv) * Math.min(dt * 6, 1) : ripGoal + (ripEnv - ripGoal) * Math.exp(-dt * 3 / S.fdRipFade);
  emitTrail(dist * grounded);
  updateRings(dt);
  updateHistory();
  updateGoals(dt);
  updateBursts(dt);
  updateChips(dt);

  if (sound) {
    sound.resume();
    sound.roll(speed, R, [ball.pos[0], ball.pos[1] - R, ball.pos[2]], grounded);
    sound.music(speed);
  }
  if (fx) fx.update(hum.level, hum.pitch, hum.rms);
  return speed;
}

// Senkrechte Bewegung: Sprung, Schweben mit Flügeln (organisch federnd über den Hügeln), Landung
function updateVertical(dt) {
  const gh = terrainH(ball.pos[0], ball.pos[2]);
  groundSmooth += (gh - groundSmooth) * Math.min(dt * 1.2, 1);
  wing += (wingGoal - wing) * Math.min(dt * (wingGoal > wing ? 1.6 : 1.0), 1);
  const floor = gh + R;
  const onGround = ball.pos[1] <= floor + 0.02;

  // Sprung (Taste, nur am Boden)
  if (jumpPressed && !jumpPrev && onGround) ball.vy = 4.3;
  jumpPrev = jumpPressed;

  // Schweben: Feder zu einer Höhe über dem geglätteten Boden, sanftes Auf und Ab
  let acc = -G * (1 - wing);
  if (wing > 0.02) {
    const target = Math.max(groundSmooth + R + wing * (1.1 + 0.18 * Math.sin(time * 0.9)) + 0.07 * Math.sin(time * 2.3) * wing, floor + 0.15 * wing);
    acc += ((target - ball.pos[1]) * 6 - ball.vy * 2.6) * wing;
  }
  ball.vy += acc * dt;
  ball.pos[1] += ball.vy * dt;
  if (ball.pos[1] <= floor) {
    if (ball.vy < -1.2) {
      if (sound) sound.thud([ball.pos[0], gh, ball.pos[2]], -ball.vy / 6);
      ball.vy = -ball.vy * 0.22;           // kleiner Rückprall
      if (ball.vy < 0.4) ball.vy = 0;
    } else ball.vy = Math.max(ball.vy, 0);
    ball.pos[1] = floor;
  }
  const air = ball.pos[1] - floor;
  grounded = Math.max(0, 1 - air / 0.08);
}

function emitTrail(dist) {
  if (S.fdTrail <= 0) return;
  trailDist += dist * S.fdTrail;
  while (trailDist >= 1) {
    trailDist -= 1;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.2;
    const x = ball.pos[0] + Math.cos(a) * r, z = ball.pos[2] + Math.sin(a) * r;
    const i = trailHead * 7, d = trail.data;
    d[i] = x; d[i + 1] = terrainH(x, z) + 0.03; d[i + 2] = z;
    d[i + 3] = time; d[i + 4] = S.fdTrailLife * (0.7 + Math.random() * 0.6); d[i + 5] = hue; d[i + 6] = Math.random();
    trailDirty.push(trailHead);
    trailHead = (trailHead + 1) % trail.capacity;
  }
}

function uploadTrail() {
  if (!trailDirty.length) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, trail.buf);
  // zusammenhängende Bereiche hochladen (Ringpuffer kann umbrechen)
  let start = trailDirty[0], prevI = start;
  const flush = (a, b) => gl.bufferSubData(gl.ARRAY_BUFFER, a * 28, trail.data, a * 7, (b - a + 1) * 7);
  for (let k = 1; k < trailDirty.length; k++) {
    const i = trailDirty[k];
    if (i !== prevI + 1) { flush(start, prevI); start = i; }
    prevI = i;
  }
  flush(start, prevI);
  trailDirty.length = 0;
}

const RING_LIFE = 1.6;
function updateRings(dt) {
  if (S.fdRings > 0 && propel > 0.12) {
    ringTimer += dt * propel * 10;
    if (ringTimer > 1) {
      ringTimer = 0;
      rings.push({ pos: [...ball.pos], back: [-moveDir[0], 0, -moveDir[1]], birth: time, hue });
    }
  }
  while (rings.length && time - rings[0].birth > RING_LIFE) rings.shift();
}

function updateHistory() {
  const last = history[history.length - 1];
  if (!last || v3.len(v3.sub(last.p, ball.pos)) > 0.04) history.push({ p: [...ball.pos], t: time });
  while (history.length > 380 || (history.length && time - history[0].t > S.fdRibbon)) history.shift();
}

function updateGoals(dt) {
  for (let i = goals.length - 1; i >= 0; i--) {
    const g = goals[i];
    const gy = terrainH(g.x, g.z) + 0.8;
    const d = Math.hypot(g.x - ball.pos[0], gy - ball.pos[1], g.z - ball.pos[2]);
    if (d < R + 0.55) {
      explode([g.x, gy, g.z], hue + g.hue);
      if (sound) sound.chime([g.x, gy, g.z]);
      if (g.companion && companions.length < 8) spawnCompanion([g.x, gy, g.z]);
      goals.splice(i, 1);
      goals.push(placeGoal(ball.pos[0], ball.pos[2], 25, 55));   // Ersatz weiter weg
    }
  }
  while (goals.length < S.fdGoals) goals.push(placeGoal(ball.pos[0], ball.pos[2], 20, 55));
  if (goals.length > S.fdGoals) goals.length = S.fdGoals;

  // Begleiter: rollen immer am Boden und werden magnetisch von der Hauptkugel angezogen.
  // Zug wächst mit dem Abstand (weit weg = schnell hinterher), nahe dran bremsen sie relativ zur Hauptkugel ab
  // und stoßen nur sanft an (mit leisem Klang). Unabhängig von Blick und Kamera.
  companions.forEach((c) => {
    const dx = ball.pos[0] - c.pos[0], dz = ball.pos[2] - c.pos[2];
    const d = Math.hypot(dx, dz) || 1e-4;
    const gap = Math.max(d - (R + RC), 0);
    const pull = S.fdMagnet * gap * (1 + 0.35 * gap);           // stärker, je weiter weg
    const near = Math.exp(-gap * 2.5);                            // nahe dran: mehr Bremsen
    const rvx = c.vel[0] - ball.vel[0], rvz = c.vel[1] - ball.vel[1];
    const [cgx, cgz] = terrainGrad(c.pos[0], c.pos[2]);
    const slope = (5 / 7) * G * 0.6;
    c.vel[0] += (dx / d * pull - rvx * (0.4 + 2.6 * near) - slope * cgx) * dt;
    c.vel[1] += (dz / d * pull - rvz * (0.4 + 2.6 * near) - slope * cgz) * dt;
    c.pos[0] += c.vel[0] * dt;
    c.pos[2] += c.vel[1] * dt;
  });
  // Kollisionen: Begleiter ↔ Hauptkugel (nur wenn sie unten ist) und untereinander, weich mit wenig Rückprall
  const bodies = [{ pos: ball.pos, vel: ball.vel, r: R, main: true }, ...companions.map((c) => ({ pos: c.pos, vel: c.vel, r: RC, c }))];
  for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) {
    const A = bodies[a], B = bodies[b];
    if (!B.c) continue;
    if (A.main && ball.pos[1] - (terrainH(ball.pos[0], ball.pos[2]) + R) > 0.3) continue;   // Hauptkugel in der Luft
    const dx = B.pos[0] - A.pos[0], dz = B.pos[2] - A.pos[2], d = Math.hypot(dx, dz), min = A.r + B.r;
    if (d >= min || d < 1e-5) continue;
    const nx = dx / d, nz = dz / d;
    const wA = A.main ? 0.1 : 0.5, wB = A.main ? 0.9 : 0.5;          // Hauptkugel ist schwerer
    const push = min - d;
    if (!A.main) { A.pos[0] -= nx * push * wA; A.pos[2] -= nz * push * wA; }
    B.pos[0] += nx * push * wB; B.pos[2] += nz * push * wB;
    const vn = (B.vel[0] - A.vel[0]) * nx + (B.vel[1] - A.vel[1]) * nz;
    if (vn < 0) {
      const j = -(1 + 0.25) * vn;                                   // Rückprall 0,25
      if (!A.main) { A.vel[0] -= nx * j * wA; A.vel[1] -= nz * j * wA; }
      B.vel[0] += nx * j * wB; B.vel[1] += nz * j * wB;
      if (A.main && -vn > 0.12 && time - (B.c.lastSpark || 0) > 0.15) {
        B.c.lastSpark = time;
        const cp = [A.pos[0] + nx * A.r, 0, A.pos[2] + nz * A.r];
        cp[1] = terrainH(cp[0], cp[2]) + RC;
        sparkChips(cp, [nx, nz], Math.min(-vn / 2, 1));
      }
      if (-vn > 0.25 && sound && time - (B.c.lastClick || 0) > 0.12) {
        B.c.lastClick = time;
        sound.click([(A.pos[0] + B.pos[0]) / 2, B.pos[1], (A.pos[2] + B.pos[2]) / 2], Math.min(-vn / 3, 1));
      }
    }
  }
  companions.forEach((c, k) => {
    c.pos[1] = terrainH(c.pos[0], c.pos[2]) + RC;
    const step = [c.vel[0] * dt, 0, c.vel[1] * dt];
    const d = Math.hypot(step[0], step[2]);
    if (d > 1e-5) {
      c.rot = mul3(axisAngle3(v3.norm(v3.cross([0, 1, 0], step)), d / RC), c.rot);
      if (((time * 60) | 0) % 90 === k) c.rot = orthonormalize3(c.rot);
    }
    if (sound) sound.movePurr(c.id, c.pos);
  });
}

function spawnCompanion(p) {
  const c = { id: companionId++, pos: [p[0], terrainH(p[0], p[2]) + RC, p[2]], vel: [0, 0], phase: Math.random() * 6.28, rot: IDENT3() };
  companions.push(c);
  if (sound) sound.addPurr(c.id);
}

function explode(p, h) {
  for (let i = 0; i < 140; i++) {
    let d = [Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5];
    d = v3.scale(v3.norm(d), 1.2 + Math.random() * 2.6);
    burstList.push({ p: [...p], v: d, birth: time, life: 1.2 + Math.random() * 1.2, hue: h, seed: Math.random() });
  }
  if (burstList.length > bursts.capacity) burstList.splice(0, burstList.length - bursts.capacity);
}

// Kleine helle Splitter am Kontaktpunkt: springen seitlich/aufwärts weg, landen und glimmen kurz am Boden
function sparkChips(p, n, strength) {
  if (S.fdSparks <= 0) return;
  const count = Math.round((6 + 22 * strength) * S.fdSparks);
  for (let i = 0; i < count; i++) {
    const a = Math.atan2(n[1], n[0]) + (Math.random() - 0.5) * 2.6;          // fächerförmig um die Stoßnormale, auch nach hinten
    const side = Math.random() < 0.5 ? 1 : -1;
    const sp = (0.4 + Math.random() * 1.1) * (0.5 + strength);
    const v = [Math.cos(a + (side < 0 ? Math.PI : 0)) * sp, 0.6 + Math.random() * 1.4 * (0.5 + strength), Math.sin(a + (side < 0 ? Math.PI : 0)) * sp];
    chipList.push({ p: [...p], v, birth: time, life: 2.2 + Math.random() * 2.0, hue: hue + 0.12 * (Math.random() - 0.5), seed: Math.random(), landed: false });
  }
  if (chipList.length > chips.capacity) chipList.splice(0, chipList.length - chips.capacity);
}

function updateChips(dt) {
  for (let i = chipList.length - 1; i >= 0; i--) {
    const c = chipList[i];
    if (time - c.birth > c.life) { chipList.splice(i, 1); continue; }
    if (c.landed) continue;
    c.v[1] -= 4.5 * dt;                                        // leichte Schwerkraft (schweben etwas)
    c.v = v3.scale(c.v, Math.exp(-0.6 * dt));
    c.p = v3.add(c.p, v3.scale(c.v, dt));
    const g = terrainH(c.p[0], c.p[2]) + 0.012;
    if (c.p[1] <= g) {
      if (c.v[1] < -1.2 && !c.bounced) { c.v = [c.v[0] * 0.4, -c.v[1] * 0.25, c.v[2] * 0.4]; c.bounced = true; c.p[1] = g; }
      else { c.p[1] = g; c.landed = true; }
    }
  }
  const d = chips.data;
  chipList.forEach((c, i) => { d.set([c.p[0], c.p[1], c.p[2], c.birth, c.life, c.hue, c.seed], i * 7); });
  if (chipList.length) {
    gl.bindBuffer(gl.ARRAY_BUFFER, chips.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, chipList.length * 7);
  }
}

function updateBursts(dt) {
  for (let i = burstList.length - 1; i >= 0; i--) {
    const b = burstList[i];
    if (time - b.birth > b.life) { burstList.splice(i, 1); continue; }
    b.v[1] -= 0.8 * dt;
    b.v = v3.scale(b.v, Math.exp(-1.8 * dt));
    b.p = v3.add(b.p, v3.scale(b.v, dt));
  }
  const d = bursts.data;
  burstList.forEach((b, i) => { d.set([b.p[0], b.p[1], b.p[2], b.birth, b.life, b.hue, b.seed], i * 7); });
  if (burstList.length) {
    gl.bindBuffer(gl.ARRAY_BUFFER, bursts.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, burstList.length * 7);
  }
}

// ---------- Kamera-Rig ----------
// POV (0): direkt über der Kugel · Third Person (1): ~3 m dahinter und darüber
function eyeTarget() {
  const t = S.fdCam;
  const up = 0.55 + 1.05 * t, back = 3.2 * t;
  const bx = Math.sin(yaw), bz = Math.cos(yaw);             // "hinten" relativ zur Ansicht
  const e = [ball.pos[0] + bx * back, ball.pos[1] + up, ball.pos[2] + bz * back];
  e[1] = Math.max(e[1], terrainH(e[0], e[2]) + 0.6);         // nicht ins Gelände tauchen
  return e;
}
function updateRig(dt) {
  const target = eyeTarget();
  if (!rigPos) rigPos = target;
  const k = 1 - Math.exp(-dt * (6 + 10 * (1 - S.fdCam)));   // POV folgt straffer
  rigPos = v3.lerp(rigPos, target, k);
}
const rigMatrix = () => mul(translation(...rigPos), rotationY(yaw));

// ---------- Zeichnen ----------
function hueRGB(rgb, a) {
  const [r, g, b] = rgb;
  const y = 0.299 * r + 0.587 * g + 0.114 * b, i = 0.596 * r - 0.274 * g - 0.322 * b, q = 0.211 * r - 0.523 * g + 0.312 * b;
  const c = Math.cos(a), s = Math.sin(a), i2 = c * i - s * q, q2 = s * i + c * q;
  return [y + 0.956 * i2 + 0.621 * q2, y - 0.272 * i2 - 0.647 * q2, y - 1.106 * i2 + 1.703 * q2].map((v) => Math.max(v, 0));
}
const GLOW = [0.95, 0.28, 0.75];   // wie GLOW in flowshaders.js

function buildRibbon(cam) {
  const n = history.length;
  ribbonCount = 0;
  if (n < 3 || S.fdRibbon <= 0) return;
  const data = new Float32Array(n * 10);
  for (let i = 0; i < n; i++) {
    const p = history[i].p;
    const a = history[Math.max(i - 1, 0)].p, b = history[Math.min(i + 1, n - 1)].p;
    const tan = v3.norm(v3.sub(b, a));
    const side = v3.norm(v3.cross(tan, v3.sub(cam, p)));
    const f = i / (n - 1);
    const w = R * 0.32 * Math.pow(f, 0.8);
    // weich ausblenden, je näher das Band der Kamera kommt
    const near = Math.min(Math.max((v3.len(v3.sub(cam, p)) - 0.6) / 1.5, 0), 1);
    const alpha = Math.pow(f, 2.2) * 0.22 * near;
    const l = v3.add(p, v3.scale(side, w)), r = v3.sub(p, v3.scale(side, w));
    data.set([...l, alpha, -1, ...r, alpha, 1], i * 10);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, ribbonBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  ribbonCount = n * 2;
}

function uploadGlows() {
  const d = glowBuf.data;
  let k = 0;
  for (const g of goals) {
    const y = terrainH(g.x, g.z) + 0.8 + 0.15 * Math.sin(time * 1.5 + g.phase);
    const pulse = 0.8 + 0.3 * Math.sin(time * 2.2 + g.phase);
    d.set([g.x, y, g.z, g.companion ? 0.9 : 0.7, hue + g.hue, pulse * 0.7, 0.35], k * 7); k++;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf.buf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, k * 7);
  return k;
}

let glowCount = 0;
function prepareFrame(cam) {
  uploadTrail();
  buildRibbon(cam);
  glowCount = uploadGlows();
}

// Innenlichter: Hauptkugel + Begleiter beleuchten den Boden (Kontaktlicht + Fake-Spiegelung)
function lightUniforms(u) {
  const pos = new Float32Array(MAX_LIGHTS * 3), col = new Float32Array(MAX_LIGHTS * 3);
  const glow = hueRGB(GLOW, hue);
  const main = 0.35 + 0.45 * driveVis;
  pos.set([ball.pos[0], ball.pos[1] - R * 0.8, ball.pos[2]], 0);
  col.set(glow.map((c) => c * main), 0);
  let n = 1;
  for (const c of companions) {
    if (n >= MAX_LIGHTS) break;
    pos.set([c.pos[0], c.pos[1] - RC * 0.75, c.pos[2]], n * 3);
    col.set(hueRGB(GLOW, hue + 0.25).map((x) => x * 0.22), n * 3);
    n++;
  }
  gl.uniform1i(u.uLightCount, n);
  gl.uniform3fv(u['uLightPos[0]'], pos);
  gl.uniform3fv(u['uLightCol[0]'], col);
}

function drawSphere(u, pos, r, rot) {
  gl.uniform3fv(u.uPos, pos);
  gl.uniform1f(u.uR, r);
  gl.uniformMatrix3fv(u.uRot, false, rot);
  gl.drawElements(gl.TRIANGLES, sphereMesh.count, gl.UNSIGNED_INT, 0);
}
// Weiche Schnitte: Hauptkugel als Referenz für alle Effekt-Shader
function softUniforms(u) {
  gl.uniform3fv(u.uBallPos, ball.pos);
  gl.uniform1f(u.uBallR, R);
}

const SHAFT_CELL = 8, SHAFT_GRID = 13;   // Raster der Lichtstrahlen: 13×13 Zellen à 8 m um den Spieler
const shellRotBuf = new Float32Array(27);
function shellRotData() { for (let k = 0; k < 3; k++) shellRotBuf.set(shellRot[k], k * 9); return shellRotBuf; }

function drawWorld(proj, view, cam, vpW, vpH) {
  const pxScale = proj[5] * vpH * 0.5;

  // Himmel: Aurora + Nebel (ohne Tiefe)
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.useProgram(P.sky.p);
  gl.uniformMatrix4fv(P.sky.u.uInvVP, false, invert(mul(proj, view)));
  gl.uniform3fv(P.sky.u.uCam, cam);
  gl.uniform1f(P.sky.u.uHue, hue);
  gl.uniform1f(P.sky.u.uTime, time);
  gl.uniform1f(P.sky.u.uAurora, S.fdAuroraInt);
  gl.bindVertexArray(fullscreen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // Gelände (mit Tiefe)
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  const cell = TERRAIN_SIZE / TERRAIN_N;
  let u = P.terrain.u;
  gl.useProgram(P.terrain.p);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform2f(u.uOrigin, Math.round(ball.pos[0] / cell) * cell, Math.round(ball.pos[2] / cell) * cell);
  gl.uniform1f(u.uSize, TERRAIN_SIZE);
  gl.uniform3fv(u.uCam, cam);
  gl.uniform1f(u.uHue, hue);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uFogDensity, 0.05);
  gl.uniform1f(u.uGrain, S.fdGrain);
  gl.uniform1f(u.uLines, S.fdLines);
  gl.uniform1f(u.uFresnel, S.fdFresnel);
  gl.uniform1f(u.uSpecRough, S.fdSpecRough);
  gl.uniform1f(u.uAurora, S.fdAuroraInt);
  lightUniforms(u);
  gl.bindVertexArray(terrainMesh.vao);
  gl.drawElements(gl.TRIANGLES, terrainMesh.count, gl.UNSIGNED_INT, 0);

  // Begleiter: leuchtende Kugeln (deckend)
  gl.bindVertexArray(sphereMesh.vao);
  if (companions.length) {
    u = P.comp.u;
    gl.useProgram(P.comp.p);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uCam, cam);
    gl.uniform1f(u.uHue, hue + 0.25);
    for (const c of companions) drawSphere(u, c.pos, RC, c.rot);
  }
  // Hauptkugel: Glasmurmel (im Shader verfolgt, deckend -> keine Sortierprobleme)
  u = P.ball.u;
  gl.useProgram(P.ball.p);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform3fv(u.uCam, cam);
  gl.uniform1f(u.uHue, hue);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uLight, 0.45 + 0.55 * driveVis);
  gl.uniform1f(u.uIOR, S.fdIOR);
  gl.uniform1f(u.uRough, S.fdRough);
  gl.uniform1f(u.uFresnel, S.fdBallFresnel);
  gl.uniform1i(u.uLayers, S.fdLayers);
  gl.uniform1f(u.uShellScale, S.fdLayerScale);
  gl.uniformMatrix3fv(u['uShellRot[0]'], false, shellRotData());
  gl.uniform1f(u.uAurora, S.fdAuroraInt);
  gl.uniform3f(u.uEmit, -moveDir[0], 0, -moveDir[1]);
  gl.uniform1f(u.uRipple, S.fdRipples * ripEnv);
  gl.uniform1f(u.uRipFreq, S.fdRipFreq);
  drawSphere(u, ball.pos, R, ball.rot);

  // Leuchtendes: additiv, verdeckt vom Gelände, schreibt keine Tiefe, blendet an Geometrie weich aus
  gl.enable(gl.BLEND);
  gl.depthMask(false);
  gl.blendFunc(gl.ONE, gl.ONE);

  // Atmosphärische Lichtstrahlen: zur Kamera gedrehte, schräge Bänder, unten zum Boden und zur Kamera hin ausgeblendet
  if (S.fdShafts > 0) {
    u = P.shaft.u;
    gl.useProgram(P.shaft.p);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uCam, cam);
    gl.uniform2f(u.uCenter, Math.round(ball.pos[0] / SHAFT_CELL) * SHAFT_CELL, Math.round(ball.pos[2] / SHAFT_CELL) * SHAFT_CELL);
    gl.uniform1f(u.uCell, SHAFT_CELL);
    gl.uniform1i(u.uGrid, SHAFT_GRID);
    gl.uniform2f(u.uPlayer, ball.pos[0], ball.pos[2]);
    gl.uniform2f(u.uFade, SHAFT_CELL * 2.6, SHAFT_CELL * (SHAFT_GRID / 2 - 1.5));   // vor dem Rasterrand vollständig aus
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uHue, hue);
    gl.uniform1f(u.uIntensity, S.fdShafts);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, SHAFT_GRID * SHAFT_GRID * 6);
  }

  // Pfad + Explosionen
  u = P.spark.u;
  gl.useProgram(P.spark.p);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uPxScale, pxScale);
  gl.uniform1f(u.uSize, 0.011);
  gl.uniform1f(u.uRise, 0.004);
  gl.uniform1f(u.uBright, 0.85);
  gl.uniform1f(u.uGlitter, 1);
  gl.bindVertexArray(trail.vao);
  gl.drawArrays(gl.POINTS, 0, trail.capacity);
  if (burstList.length) {
    gl.uniform1f(u.uSize, 0.04);
    gl.uniform1f(u.uRise, 0);
    gl.uniform1f(u.uBright, 0.9);
    gl.uniform1f(u.uGlitter, 0);
    gl.bindVertexArray(bursts.vao);
    gl.drawArrays(gl.POINTS, 0, burstList.length);
  }
  if (chipList.length) {
    gl.uniform1f(u.uSize, 0.02);
    gl.uniform1f(u.uRise, 0);
    gl.uniform1f(u.uBright, 2.2);
    gl.uniform1f(u.uGlitter, 0);
    gl.bindVertexArray(chips.vao);
    gl.drawArrays(gl.POINTS, 0, chipList.length);
  }

  // Goals
  if (glowCount) {
    u = P.glow.u;
    gl.useProgram(P.glow.p);
    softUniforms(u);
    gl.uniform3f(u.uRight, view[0], view[4], view[8]);   // Kamera-Achsen in Welt (Zeilen der Ansicht)
    gl.uniform3f(u.uUp, view[1], view[5], view[9]);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uPxScale, pxScale);
    gl.bindVertexArray(glowBuf.vao);
    gl.drawArrays(gl.POINTS, 0, glowCount);
  }

  // Ribbon
  if (ribbonCount) {
    u = P.ribbon.u;
    gl.useProgram(P.ribbon.p);
    softUniforms(u);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uColor, hueRGB(GLOW, hue));
    gl.bindVertexArray(ribbonVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, ribbonCount);
  }

  // Warp-Ringe: dünn und dezent, wie ein Tunnel hinter der Kugel
  if (rings.length && S.fdRings > 0) {
    u = P.ring.u;
    gl.useProgram(P.ring.p);
    softUniforms(u);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.bindVertexArray(emptyVao);
    for (const r of rings) {
      const age = time - r.birth, life = RING_LIFE;
      const center = v3.add(r.pos, v3.scale(r.back, 0.1 + age * 0.75));
      const rad = R * 0.55 + age * 0.55;            // startet kleiner, wächst auf die bisherige Größe
      const ax = v3.norm(v3.cross(r.back, [0, 1, 0]));
      const ay = v3.cross(ax, r.back);
      gl.uniform3fv(u.uCenter, center);
      gl.uniform3fv(u.uU, v3.scale(ax, rad));
      gl.uniform3fv(u.uV, v3.scale(ay, rad));
      gl.uniform3fv(u.uColor, hueRGB([0.9, 0.18, 0.45], r.hue));
      gl.uniform1f(u.uAlpha, Math.pow(1 - age / life, 1.5) * Math.min(age * 8, 1) * 0.22 * S.fdRings);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  // Flügel (beim Ausbreiten der Arme)
  if (wing > 0.02) {
    u = P.wing.u;
    gl.useProgram(P.wing.p);
    softUniforms(u);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uPos, ball.pos);
    gl.uniform3fv(u.uFwd, [moveDir[0], 0, moveDir[1]]);
    gl.uniform1f(u.uOpen, wing);
    gl.uniform1f(u.uFlap, time * 2.4);
    gl.uniform1f(u.uSpan, 0.75);
    gl.uniform1f(u.uRootR, R * 0.8);
    gl.uniform3fv(u.uColor, hueRGB(GLOW, hue));
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, WING_FEATHERS * 2 * 6);
  }
  gl.disable(gl.BLEND);
  gl.depthMask(true);
}

// ---------- 2D-Vorschau (Portal) ----------
let xrSession = null, lastT = 0;
let previewOn = load('ui.preview', false), previewRunning = false;
function setPreview(on) {
  previewOn = on;
  save('ui.preview', on);
  canvas.classList.toggle('off', !on);
  ui.preview.textContent = on ? 'Disable preview' : 'Enable preview';
  if (on) ensureSound();
  if (on && !previewRunning && !xrSession) { lastT = 0; previewRunning = true; requestAnimationFrame(previewFrame); }
}

function previewFrame(t) {
  if (xrSession || !previewOn) { previewRunning = false; return; }
  const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 1 / 60;
  lastT = t;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

  headFwd = [-Math.sin(yaw), -Math.cos(yaw)];
  jumpPressed = keys.has(' ');
  wingGoal = keys.has('f') ? 1 : 0;
  update(dt);
  updateRig(dt);
  // Blick leicht nach unten auf die Kugel (POV: steiler)
  const pitch = 0.95 - 0.6 * S.fdCam;
  const camM = mul(rigMatrix(), rotationX(-pitch));
  const view = invert(camM);
  const cam = [camM[12], camM[13], camM[14]];
  prepareFrame(cam);
  if (sound) sound.listener(cam, transformDir(camM, [0, 0, -1]), transformDir(camM, [0, 1, 0]));

  if (S.fdBloom) bloom.begin(w, h); else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawWorld(perspective(parseFloat(params.get('fov') || '1.1'), w / h, 0.05, 200), view, cam, w, h);
  if (S.fdBloom) bloom.finish(null, [[0, 0, w, h]], S.fdBloomStr, S.fdBloomSoft);
  requestAnimationFrame(previewFrame);
}
ui.preview.addEventListener('click', () => setPreview(!previewOn));
setPreview(previewOn);

canvas.addEventListener('pointerdown', () => { manualHum = true; ensureSound(); });
addEventListener('pointerup', () => { manualHum = false; });
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); if (e.key === ' ') e.preventDefault(); });
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); });

// ---------- Einstellungs-Oberfläche (wie in Soothing Ripples) ----------
const fxState = {};
const inputs = {}, fxInputs = {};
function decimals(step) { return step >= 1 ? 0 : Math.min(Math.ceil(-Math.log10(step)), 4); }

// Supersampling während der VR-Sitzung ändern: Bildpuffer neu anlegen (kurz nach dem letzten Reglerschritt)
let scaleTimer = null;
function applySupersampling() {
  clearTimeout(scaleTimer);
  scaleTimer = setTimeout(() => {
    if (!xrSession) return;
    const native = XRWebGLLayer.getNativeFramebufferScaleFactor(xrSession) || 1;
    const layer = new XRWebGLLayer(xrSession, gl, { antialias: false, depth: true, framebufferScaleFactor: native * S.superSample / 100 });
    xrSession.updateRenderState({ baseLayer: layer });
    ui.status.textContent = `XR framebuffer: ${layer.framebufferWidth}×${layer.framebufferHeight} (${S.superSample} %)`;
  }, 350);
}

function applySetting(key) {
  if (key === 'superSample') applySupersampling();
  if (key === 'fdGoals' || key === 'fdCompanion') { /* wirkt beim nächsten Nachfüllen */ }
  if (key.startsWith('fdMusic') || key.startsWith('fdRoll') || key.startsWith('fdSfx') || key.startsWith('fdPurr')) applyVolumes();
  if (!fx) return;
  if (key === 'volume') fx.setVolume(S.volume);
  if (key === 'dry') fx.setDry(S.dry);
  if (key === 'gateThr') fx.setGateThreshold(S.gateThr);
}
function setSetting(key, value) {
  S[key] = value;
  if (key !== 'superSample') save('set.' + key, value);
  applySetting(key);
  const el = inputs[key];
  if (el) { if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new Event('sync')); }
  if (vrMenu) vrMenu.markDirty();
}
function setEffect(key, on) {
  fxState[key] = on;
  save('fx.' + key, on);
  if (fx) fx.set(key, on);
  if (fxInputs[key]) fxInputs[key].checked = on;
  if (vrMenu) vrMenu.markDirty();
}

SECTIONS.forEach((sec, i) => {
  const det = document.createElement('details');
  det.open = load('ui.fd.open.' + i, i === 0);
  det.addEventListener('toggle', () => save('ui.fd.open.' + i, det.open));
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
      fxInputs[key] = box;
      box.addEventListener('change', () => setEffect(key, box.checked));
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
    inputs[key] = input;
    input.addEventListener(d.options || d.toggle ? 'change' : 'input', () => setSetting(key, d.toggle ? input.checked : +input.value));
    input.addEventListener('sync', show);
    row.append(name, input, val);
    body.appendChild(row);
    show();
  }
  ui.panel.appendChild(det);
});
ui.toggle.addEventListener('click', () => ui.panel.classList.toggle('hidden'));

// Für automatische Tests: ?debug=1 macht den Zustand von außen erreichbar
if (params.get('debug')) window.__fd = { ball, goals, companions, chipList, get time() { return time; }, get sound() { return sound; } };

const bloom = new Bloom(gl, program, fullscreen);

const vrMenu = new VRMenu(gl, {
  program, sections: SECTIONS, S,
  effects: Object.entries(EFFECTS).map(([key, e]) => ({ key, label: e.label })),
  onChange: setSetting,
  fx: { get: (k) => fxState[k], set: setEffect },
});

ui.mic.addEventListener('click', async () => {
  try {
    await hum.start();
    fx = new VoiceFX(hum.ctx, hum.source);
    Object.assign(fx.enabled, fxState);
    await fx.init();
    for (const k of ['volume', 'dry', 'gateThr']) applySetting(k);
    ensureSound();
    ui.mic.textContent = '🎤 Microphone on';
    ui.mic.disabled = true;
  } catch (e) {
    ui.status.textContent = 'Microphone not available: ' + e.message;
  }
});

// ---------- WebXR ----------
let refSpace = null;
async function initXR() {
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr'))) {
    ui.vr.textContent = 'VR not available';
    ui.vr.disabled = true;
    return;
  }
  ui.vr.addEventListener('click', startXR);
}

async function startXR() {
  ensureSound();   // noch innerhalb des Klicks, damit Audio starten darf
  const session = await navigator.xr.requestSession('immersive-vr');
  xrSession = session;
  await gl.makeXRCompatible();
  const native = XRWebGLLayer.getNativeFramebufferScaleFactor(session) || 1;
  const layer = new XRWebGLLayer(session, gl, { antialias: false, depth: true, framebufferScaleFactor: native * S.superSample / 100 });
  session.updateRenderState({ baseLayer: layer, depthNear: 0.05, depthFar: 200 });
  refSpace = await session.requestReferenceSpace('local');
  session.addEventListener('end', () => {
    xrSession = null; lastT = 0; trigger = 0; stick = [0, 0]; turn = 0;
    if (previewOn) { previewRunning = true; requestAnimationFrame(previewFrame); }
  });
  session.requestAnimationFrame(xrFrame);
}

const fwdOf = (q) => [-2 * (q.x * q.z + q.w * q.y), -2 * (q.y * q.z - q.w * q.x), -(1 - 2 * (q.x * q.x + q.y * q.y))];
const upOf = (q) => [2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x)];

function xrFrame(t, frame) {
  const session = frame.session;
  session.requestAnimationFrame(xrFrame);
  const pose = frame.getViewerPose(refSpace);
  if (!pose) return;
  const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 1 / 72;
  lastT = t;

  const hp = pose.transform.position, ho = pose.transform.orientation;
  const menuBusy = vrMenu.update(frame, refSpace, [hp.x, hp.y, hp.z]);

  // Controller: rechter Stick lenkt, linker Stick dreht die Ansicht, Trigger = Antrieb (Alternative zum Summen)
  stick = [0, 0]; turn = 0; trigger = 0; jumpPressed = false;
  const hands = {};
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    // Sprung: A/B (rechts) oder Y (links); X bleibt fürs Menü
    const b = gp.buttons;
    if (src.handedness === 'right' && ((b[4] && b[4].pressed) || (b[5] && b[5].pressed))) jumpPressed = true;
    if (src.handedness === 'left' && b[5] && b[5].pressed) jumpPressed = true;
    const gpose = frame.getPose(src.gripSpace || src.targetRaySpace, refSpace);
    if (gpose) hands[src.handedness] = gpose.transform.position;
    const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    if (src.handedness === 'right') { stick = [dz(ax[0]), dz(ax[1])]; if (!menuBusy) trigger = Math.max(trigger, gp.buttons[0]?.value || 0); }
    if (src.handedness === 'left') { turn = dz(ax[0]); trigger = Math.max(trigger, gp.buttons[0]?.value || 0); }
  }

  // Arme ausbreiten -> Flügel: Hände weit auseinander (> ~1,1 m) und etwa auf Schulterhöhe
  wingGoal = 0;
  if (hands.left && hands.right) {
    const span = Math.hypot(hands.left.x - hands.right.x, hands.left.z - hands.right.z);
    const lowest = Math.min(hands.left.y, hands.right.y);
    const s = Math.min(Math.max((span - 0.95) / 0.3, 0), 1);
    const h = Math.min(Math.max((lowest - (hp.y - 0.75)) / 0.25, 0), 1);
    wingGoal = s * h;
  }

  // Blickrichtung in Welt: Kopf-Vorwärts (lokal) um die Rig-Drehung gedreht, auf die Ebene projiziert
  const fl = fwdOf(ho);
  const fw = transformDir(rotationY(yaw), fl);
  const l = Math.hypot(fw[0], fw[2]);
  if (l > 0.2) headFwd = [fw[0] / l, fw[2] / l];

  update(dt);
  updateRig(dt);
  const rig = rigMatrix();
  const invRig = invert(rig);
  const camW = (p) => [rig[0] * p.x + rig[4] * p.y + rig[8] * p.z + rig[12], rig[1] * p.x + rig[5] * p.y + rig[9] * p.z + rig[13], rig[2] * p.x + rig[6] * p.y + rig[10] * p.z + rig[14]];
  const headPos = camW(hp);
  prepareFrame(headPos);
  if (sound) sound.listener(headPos, transformDir(rig, fl), transformDir(rig, upOf(ho)));

  const layer = session.renderState.baseLayer;
  const useBloom = S.fdBloom;
  if (useBloom) bloom.begin(layer.framebufferWidth, layer.framebufferHeight);
  else gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const vps = [];
  for (const view of pose.views) {
    const vp = layer.getViewport(view);
    vps.push([vp.x, vp.y, vp.width, vp.height]);
    gl.viewport(vp.x, vp.y, vp.width, vp.height);
    drawWorld(view.projectionMatrix, mul(view.transform.inverse.matrix, invRig), camW(view.transform.position), vp.width, vp.height);
  }
  // Bloom auf die Szene, danach das Menü (bleibt scharf)
  if (useBloom) bloom.finish(layer.framebuffer, vps, S.fdBloomStr, S.fdBloomSoft);
  pose.views.forEach((view, i) => {
    gl.viewport(...vps[i]);
    gl.disable(gl.DEPTH_TEST);
    vrMenu.draw(view.projectionMatrix, view.transform.inverse.matrix, vps[i][2], vps[i][3]);
  });
}

initXR();
