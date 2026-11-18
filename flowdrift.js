// Experience „Flow Drift“ – eine Kugel, angetrieben vom eigenen Summen, rollt durch eine Hügellandschaft.
// Vanilla WebGL2 + WebXR. Teilt Stimmerkennung/-effekte (audio.js) und VR-Menü (vrmenu.js) mit Soothing Ripples.
import {
  skyVS, skyFS, terrainVS, terrainFS, ballVS, ballFS, sparkVS, sparkFS,
  ringVS, ringFS, ribbonVS, ribbonFS, glowVS, glowFS,
} from './flowshaders.js';
import { FlowAudio } from './flowsound.js';
import { HumDetector, VoiceFX, EFFECTS } from './audio.js';
import { VRMenu } from './vrmenu.js';
import {
  mul, translation, rotationY, rotationX, perspective, invert, transformDir,
  axisAngle3, mul3, orthonormalize3, v3,
} from './mat.js';

const VERSION = 'v' + (window.VIBRATIONS_VERSION || '?');
const params = new URLSearchParams(location.search);
const SUPERSAMPLE = parseFloat(params.get('scale') || '1.5');
const R = 0.3;                // Kugelradius (m)
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
  }},
  { title: 'Camera', items: {
    fdCam:  { label: 'POV ↔ third person', min: 0, max: 1, step: 0.01, def: 0.75 },
    fdTurn: { label: 'Turn speed (°/s)', min: 15, max: 150, step: 5, def: 60 },
  }},
  { title: 'Ball', items: {
    fdThrust:   { label: 'Thrust', min: 0.5, max: 12, step: 0.5, def: 4 },
    fdFriction: { label: 'Friction', min: 0.05, max: 1.5, step: 0.05, def: 0.35 },
    fdMaxSpeed: { label: 'Max speed (m/s)', min: 2, max: 20, step: 0.5, def: 9 },
  }},
  { title: 'Effects', items: {
    fdTrail:     { label: 'Trail density', min: 0, max: 80, step: 2, def: 30 },
    fdTrailLife: { label: 'Trail lifetime (s)', min: 3, max: 60, step: 1, def: 25 },
    fdRings:     { label: 'Warp rings', min: 0, max: 2, step: 0.05, def: 1 },
    fdRibbon:    { label: 'Ribbon length (s)', min: 0, max: 4, step: 0.1, def: 1.8 },
  }},
  { title: 'Audio', items: {
    fdMusic: { label: 'Music volume', min: 0, max: 1.5, step: 0.05, def: 0.7 },
    fdRoll:  { label: 'Rolling volume', min: 0, max: 1.5, step: 0.05, def: 0.8 },
    fdSfx:   { label: 'Goal sound volume', min: 0, max: 1.5, step: 0.05, def: 0.8 },
    fdPurr:  { label: 'Purr volume', min: 0, max: 1.5, step: 0.05, def: 0.8 },
  }},
];
const S = {};
for (const sec of SECTIONS) for (const [k, d] of Object.entries(sec.items)) {
  let v = load('set.' + k, d.def);
  if (d.options && !d.options.some(([ov]) => ov === v)) v = d.def;
  if (d.min !== undefined && !(v >= d.min && v <= d.max)) v = d.def;
  S[k] = v;
}

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
ui.status.textContent = 'Hold / W = hum · A/D = turn view · ←/→ = steer';

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
  glow: program(glowVS, glowFS),
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
const ball = { pos: [0, terrainH(0, 0) + R, 0], vel: [0, 0], rot: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
let yaw = 0;                      // Drehung der Ansicht um die Kugel
let rigPos = null;                // Weltposition des XR-Ursprungs (folgt der Kugel weich)
let time = 0, hue = 0, propel = 0, driveVis = 0;
let moveDir = [0, -1];            // aktuelle Fahrtrichtung (xz)
let headFwd = [0, -1];            // Blickrichtung (xz, Welt)
let manualHum = false;
const keys = new Set();
let stick = [0, 0], turn = 0, trigger = 0;

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

  // Physik: Hangabtrieb (rollende Kugel: 5/7 g), Antrieb, Reibung
  const [gx, gz] = terrainGrad(ball.pos[0], ball.pos[2]);
  const ax = -(5 / 7) * G * gx * 0.6 + dir[0] * propel * S.fdThrust;
  const az = -(5 / 7) * G * gz * 0.6 + dir[1] * propel * S.fdThrust;
  ball.vel[0] += ax * dt; ball.vel[1] += az * dt;
  const damp = Math.exp(-S.fdFriction * dt);
  ball.vel[0] *= damp; ball.vel[1] *= damp;
  let speed = Math.hypot(ball.vel[0], ball.vel[1]);
  if (speed > S.fdMaxSpeed) { ball.vel[0] *= S.fdMaxSpeed / speed; ball.vel[1] *= S.fdMaxSpeed / speed; speed = S.fdMaxSpeed; }
  const prev = [...ball.pos];
  ball.pos[0] += ball.vel[0] * dt;
  ball.pos[2] += ball.vel[1] * dt;
  ball.pos[1] = terrainH(ball.pos[0], ball.pos[2]) + R;
  if (speed > 0.2) moveDir = [ball.vel[0] / speed, ball.vel[1] / speed];
  else moveDir = dir;

  // Rollen: Drehachse senkrecht zur Bewegung
  const step = v3.sub(ball.pos, prev);
  const dist = v3.len(step);
  if (dist > 1e-5) {
    const axis = v3.norm(v3.cross([0, 1, 0], step));
    ball.rot = mul3(axisAngle3(axis, dist / R), ball.rot);
    if ((time * 60 | 0) % 60 === 0) ball.rot = orthonormalize3(ball.rot);
  }

  driveVis += (propel - driveVis) * Math.min(dt * 4, 1);
  emitTrail(dist);
  updateRings(dt);
  updateHistory();
  updateGoals(dt);
  updateBursts(dt);

  if (sound) {
    sound.resume();
    sound.roll(speed, R);
    sound.music(speed);
  }
  if (fx) fx.update(hum.level, hum.pitch, hum.rms);
  return speed;
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

function updateRings(dt) {
  if (S.fdRings > 0 && propel > 0.12) {
    ringTimer += dt * propel * 3.2;
    if (ringTimer > 1) {
      ringTimer = 0;
      rings.push({ pos: [...ball.pos], back: [-moveDir[0], 0, -moveDir[1]], birth: time, hue });
    }
  }
  while (rings.length && time - rings[0].birth > 1.2) rings.shift();
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
      if (sound) sound.chime();
      if (g.companion && companions.length < 8) spawnCompanion([g.x, gy, g.z]);
      goals.splice(i, 1);
      goals.push(placeGoal(ball.pos[0], ball.pos[2], 25, 55));   // Ersatz weiter weg
    }
  }
  while (goals.length < S.fdGoals) goals.push(placeGoal(ball.pos[0], ball.pos[2], 20, 55));
  if (goals.length > S.fdGoals) goals.length = S.fdGoals;

  companions.forEach((c, k) => {
    const a = c.phase + time * 0.6;
    const rad = 0.9 + 0.35 * (k % 3);
    const target = [ball.pos[0] + Math.cos(a) * rad, ball.pos[1] + 0.45 + 0.2 * Math.sin(time * 1.3 + c.phase), ball.pos[2] + Math.sin(a) * rad];
    for (let j = 0; j < 3; j++) {
      c.vel[j] += (target[j] - c.pos[j]) * 7 * dt;
      c.vel[j] *= Math.exp(-2.8 * dt);
      c.pos[j] += c.vel[j] * dt;
    }
    if (sound) sound.movePurr(c.id, c.pos);
  });
}

function spawnCompanion(p) {
  const c = { id: companionId++, pos: [...p], vel: [0, 1.5, 0], phase: Math.random() * 6.28 };
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
const GLOW = [1.0, 0.5, 0.18];

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
    const alpha = Math.pow(f, 2.2) * 0.35 * near;
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
    d.set([g.x, y, g.z, g.companion ? 1.0 : 0.75, hue + g.hue, pulse, 0.6], k * 7); k++;
  }
  for (const c of companions) { d.set([c.pos[0], c.pos[1], c.pos[2], 0.35, hue + 0.3, 1.1, 0.8], k * 7); k++; }
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

function drawWorld(proj, view, cam, vpW, vpH) {
  const pxScale = proj[5] * vpH * 0.5;

  // Himmel (ohne Tiefe)
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.useProgram(P.sky.p);
  gl.uniformMatrix4fv(P.sky.u.uInvVP, false, invert(mul(proj, view)));
  gl.uniform3fv(P.sky.u.uCam, cam);
  gl.uniform1f(P.sky.u.uHue, hue);
  gl.bindVertexArray(fullscreen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // Gelände und Kugel (mit Tiefe)
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
  gl.uniform3fv(u.uBall, ball.pos);
  gl.uniform1f(u.uHue, hue);
  gl.uniform1f(u.uGlowAmt, driveVis);
  gl.bindVertexArray(terrainMesh.vao);
  gl.drawElements(gl.TRIANGLES, terrainMesh.count, gl.UNSIGNED_INT, 0);

  u = P.ball.u;
  gl.useProgram(P.ball.p);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform3fv(u.uPos, ball.pos);
  gl.uniform1f(u.uR, R);
  gl.uniformMatrix3fv(u.uRot, false, ball.rot);
  gl.uniform3fv(u.uCam, cam);
  gl.uniform1f(u.uHue, hue);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uDrive, driveVis);
  gl.bindVertexArray(sphereMesh.vao);
  gl.drawElements(gl.TRIANGLES, sphereMesh.count, gl.UNSIGNED_INT, 0);

  // Leuchtendes: additiv, verdeckt vom Gelände, schreibt keine Tiefe
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);

  // Pfad + Explosionen
  u = P.spark.u;
  gl.useProgram(P.spark.p);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform1f(u.uTime, time);
  gl.uniform1f(u.uPxScale, pxScale);
  gl.uniform1f(u.uSize, 0.03);
  gl.uniform1f(u.uRise, 0.008);
  gl.bindVertexArray(trail.vao);
  gl.drawArrays(gl.POINTS, 0, trail.capacity);
  if (burstList.length) {
    gl.uniform1f(u.uSize, 0.045);
    gl.uniform1f(u.uRise, 0);
    gl.bindVertexArray(bursts.vao);
    gl.drawArrays(gl.POINTS, 0, burstList.length);
  }

  // Goals + Begleiter
  if (glowCount) {
    u = P.glow.u;
    gl.useProgram(P.glow.p);
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
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uColor, hueRGB(GLOW, hue));
    gl.bindVertexArray(ribbonVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, ribbonCount);
  }

  // Warp-Ringe
  if (rings.length && S.fdRings > 0) {
    u = P.ring.u;
    gl.useProgram(P.ring.p);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.bindVertexArray(emptyVao);
    for (const r of rings) {
      const age = time - r.birth, life = 1.2;
      const center = v3.add(r.pos, v3.scale(r.back, 0.3 + age * 0.9));
      const rad = R * 1.2 + age * 1.1;
      const ax = v3.norm(v3.cross(r.back, [0, 1, 0]));
      const ay = v3.cross(ax, r.back);
      gl.uniform3fv(u.uCenter, center);
      gl.uniform3fv(u.uU, v3.scale(ax, rad));
      gl.uniform3fv(u.uV, v3.scale(ay, rad));
      gl.uniform3fv(u.uColor, hueRGB(GLOW, r.hue));
      gl.uniform1f(u.uAlpha, Math.pow(1 - age / life, 2) * 0.7 * S.fdRings);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
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
  update(dt);
  updateRig(dt);
  // Blick leicht nach unten auf die Kugel (POV: steiler)
  const pitch = 0.95 - 0.6 * S.fdCam;
  const camM = mul(rigMatrix(), rotationX(-pitch));
  const view = invert(camM);
  const cam = [camM[12], camM[13], camM[14]];
  prepareFrame(cam);
  if (sound) sound.listener(cam, transformDir(camM, [0, 0, -1]), transformDir(camM, [0, 1, 0]));

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawWorld(perspective(parseFloat(params.get('fov') || '1.1'), w / h, 0.05, 200), view, cam, w, h);
  requestAnimationFrame(previewFrame);
}
ui.preview.addEventListener('click', () => setPreview(!previewOn));
setPreview(previewOn);

canvas.addEventListener('pointerdown', () => { manualHum = true; ensureSound(); });
addEventListener('pointerup', () => { manualHum = false; });
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); });
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); });

// ---------- Einstellungs-Oberfläche (wie in Soothing Ripples) ----------
const fxState = {};
const inputs = {}, fxInputs = {};
function decimals(step) { return step >= 1 ? 0 : Math.min(Math.ceil(-Math.log10(step)), 4); }

function applySetting(key) {
  if (key === 'fdGoals' || key === 'fdCompanion') { /* wirkt beim nächsten Nachfüllen */ }
  if (key.startsWith('fdMusic') || key.startsWith('fdRoll') || key.startsWith('fdSfx') || key.startsWith('fdPurr')) applyVolumes();
  if (!fx) return;
  if (key === 'volume') fx.setVolume(S.volume);
  if (key === 'dry') fx.setDry(S.dry);
  if (key === 'gateThr') fx.setGateThreshold(S.gateThr);
}
function setSetting(key, value) {
  S[key] = value;
  save('set.' + key, value);
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
if (params.get('debug')) window.__fd = { ball, goals, companions, get sound() { return sound; } };

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
  const layer = new XRWebGLLayer(session, gl, { antialias: false, depth: true, framebufferScaleFactor: native * SUPERSAMPLE });
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
  stick = [0, 0]; turn = 0; trigger = 0;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    if (src.handedness === 'right') { stick = [dz(ax[0]), dz(ax[1])]; if (!menuBusy) trigger = Math.max(trigger, gp.buttons[0]?.value || 0); }
    if (src.handedness === 'left') { turn = dz(ax[0]); trigger = Math.max(trigger, gp.buttons[0]?.value || 0); }
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  for (const view of pose.views) {
    const vp = layer.getViewport(view);
    gl.viewport(vp.x, vp.y, vp.width, vp.height);
    const localView = view.transform.inverse.matrix;
    const worldView = mul(localView, invRig);
    drawWorld(view.projectionMatrix, worldView, camW(view.transform.position), vp.width, vp.height);
    gl.disable(gl.DEPTH_TEST);
    vrMenu.draw(view.projectionMatrix, localView, vp.width, vp.height);
  }
}

initXR();
