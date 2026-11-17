// Vibrations – Vanilla WebGL2 + WebXR (kein Framework)
import { simVS, simFS, sceneVS, sceneFS, partVS, partFS, fadeFS } from './shaders.js';
import { HumDetector, VoiceFX, EFFECTS } from './audio.js';

// Bei jedem Update erhöhen, damit man auf der Quest sieht, ob die neue Version geladen ist.
const VERSION = 'v0.4.0';

// ---------- Einstellungen ----------
const params = new URLSearchParams(location.search);
const SUPERSAMPLE = parseFloat(params.get('scale') || '1.5'); // 150 % der nativen Display-Auflösung
const SIM_SIZE = 512;          // Auflösung der Wellensimulation
const SIM_RATE = 480;          // Simulationsschritte pro Sekunde
const WAVE_K = 0.25;           // c² -> 0.5 Texel pro Schritt
const DAMP = 0.9993;          // geringe Dämpfung -> Wellen erreichen den Rand und reflektieren
const SCENE = {
  center: [0, 0, -5],          // Wasserebene 5 m vor dem Startpunkt, auf Augenhöhe
  half: 8.0,                   // Quad 16 × 16 m
  waterR: 3.0,                 // Radius des Behälters (Reflexionsrand)
  sunR: 1.4,                   // Radius der Sonnenscheibe
  depth: 1.0,                  // Sonne liegt 1 m hinter dem Wasser
  bump: 3.0,
  particles: 6000,             // Sonnenwind-Partikel
  partExtent: 3.6,             // Partikeltextur deckt ±3,6 m der Sonnenebene ab
  sym: 6,                      // Symmetrie der Interferenzmuster
  lobe: 0.08,
};

const ui = {
  version: document.getElementById('version'),
  status: document.getElementById('status'),
  mic: document.getElementById('mic'),
  vr: document.getElementById('vr'),
  fx: document.getElementById('fx'),
  volume: document.getElementById('volume'),
  dry: document.getElementById('dry'),
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
const emptyVao = gl.createVertexArray();
const fullscreen = vao([-1, -1, 3, -1, -1, 3]);
const h = SCENE.half;
const quad = vao([-h, -h, h, -h, -h, h, -h, h, h, -h, h, h]);

// ---------- Simulation: Ping-Pong zwischen zwei RG16F-Texturen ----------
function simTarget(size = SIM_SIZE, format = gl.RG16F, srcFormat = gl.RG) {
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
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw fail('Sim-Framebuffer unvollständig.');
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fb };
}
let simA = simTarget(), simB = simTarget();
const PART_SIZE = 1024;
const partTarget = simTarget(PART_SIZE, gl.RGBA16F, gl.RGBA);

function simStep(drive) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fb);
  gl.viewport(0, 0, SIM_SIZE, SIM_SIZE);
  gl.useProgram(simProg.p);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, simA.tex);
  gl.uniform1i(simProg.u.uState, 0);
  gl.uniform1f(simProg.u.uK, WAVE_K);
  gl.uniform1f(simProg.u.uDamp, DAMP);
  gl.uniform1f(simProg.u.uDrive, drive);
  gl.uniform1f(simProg.u.uSrc, 0.012);
  gl.uniform1f(simProg.u.uR, 0.49);
  gl.uniform1f(simProg.u.uSym, SCENE.sym);
  gl.uniform1f(simProg.u.uLobe, SCENE.lobe);
  gl.bindVertexArray(fullscreen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  [simA, simB] = [simB, simA];
}

// ---------- Sonnenwind ----------
let flow = 0, turb = 0, clock = 0;
function drawParticles(dt, level) {
  flow += dt * (0.6 + level * 2.5);
  turb += dt * (0.4 + level * 1.5);
  clock += dt;

  gl.bindFramebuffer(gl.FRAMEBUFFER, partTarget.fb);
  gl.viewport(0, 0, PART_SIZE, PART_SIZE);
  gl.enable(gl.BLEND);

  // alte Partikel ausblenden (Schweife), unabhängig von der Framerate
  const keep = Math.pow(0.82, dt * 72);
  gl.blendColor(0, 0, 0, keep);
  gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
  gl.useProgram(fadeProg.p);
  gl.bindVertexArray(fullscreen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // neue Partikel additiv
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(partProg.p);
  const u = partProg.u;
  gl.uniform1f(u.uFlow, flow);
  gl.uniform1f(u.uTurb, turb);
  gl.uniform1f(u.uClock, clock);
  gl.uniform1f(u.uLevel, level);
  gl.uniform1f(u.uSunR, SCENE.sunR);
  gl.uniform1f(u.uExtent, SCENE.partExtent);
  gl.uniform1f(u.uPx, PART_SIZE / (2 * SCENE.partExtent));
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.POINTS, 0, SCENE.particles);
  gl.disable(gl.BLEND);
}

// ---------- Anregung durch Summen ----------
const hum = new HumDetector();
let manualHum = false;        // Trigger / Maus / Touch zum Testen ohne Mikro
let amp = 0, phase = 0, lastT = 0;

function updateWaves(t) {
  const dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 1 / 72;
  lastT = t;

  hum.update();
  const target = Math.max(hum.level, manualHum ? 0.6 : 0);
  amp += (target - amp) * 0.1;

  // Tonhöhe -> Wellenlänge: tiefer Ton = lange Wellen, hoher Ton = feine Muster
  const pitch = manualHum && !hum.level ? 150 : hum.pitch;
  const u = Math.min(Math.max(Math.log(pitch / 80) / Math.log(400 / 80), 0), 1);
  const lambda = 48 * Math.pow(12 / 48, u);           // 48 … 12 Texel
  const freq = Math.sqrt(WAVE_K) / lambda;             // Zyklen pro Schritt

  const steps = Math.min(Math.max(Math.round(dt * SIM_RATE), 1), 12);
  for (let i = 0; i < steps; i++) {
    phase += 2 * Math.PI * freq;
    simStep(amp * Math.sin(phase) * 0.02);
  }

  if (fx) fx.update(hum.level, hum.pitch);
  drawParticles(dt, amp);

  if (hum.active) ui.status.textContent =
    `Mikro: ${(hum.level * 100) | 0}% · ${hum.pitch.toFixed(0)} Hz · Klarheit ${hum.clarity.toFixed(2)}`;
}

// ---------- Szene zeichnen ----------
function drawScene(proj, view, cam) {
  gl.useProgram(sceneProg.p);
  const u = sceneProg.u;
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform3fv(u.uCenter, SCENE.center);
  gl.uniform3fv(u.uCam, cam);
  gl.uniform1f(u.uWaterR, SCENE.waterR);
  gl.uniform1f(u.uSunR, SCENE.sunR);
  gl.uniform1f(u.uDepth, SCENE.depth);
  gl.uniform1f(u.uBump, SCENE.bump);
  gl.uniform1f(u.uTexel, 1 / SIM_SIZE);
  gl.uniform1f(u.uHalf, SCENE.half);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, simA.tex);
  gl.uniform1i(u.uWave, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, partTarget.tex);
  gl.uniform1i(u.uPart, 1);
  gl.uniform1f(u.uExtent, SCENE.partExtent);
  gl.bindVertexArray(quad);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ---------- 2D-Vorschau (Handy / PC) ----------
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

let xrSession = null;
function previewFrame(t) {
  if (xrSession) return;
  const dpr = (window.devicePixelRatio || 1) * SUPERSAMPLE;
  const w = Math.round(canvas.clientWidth * dpr), hgt = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; }

  updateWaves(t);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, hgt);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const aspect = w / hgt;
  const fovy = aspect < 1 ? 1.6 : 1.0;   // Hochformat: weiter, damit die Scheibe reinpasst
  drawScene(perspective(fovy, aspect, 0.1, 100), IDENTITY, [0, 0, 0]);
  requestAnimationFrame(previewFrame);
}
requestAnimationFrame(previewFrame);

// Maus / Touch gedrückt halten = Summen simulieren
canvas.addEventListener('pointerdown', () => { manualHum = true; });
addEventListener('pointerup', () => { manualHum = false; });

// ---------- Mikrofon + Stimmeffekte ----------
let fx = null;
const fxState = {};
function load(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }

for (const [key, { label, default: def }] of Object.entries(EFFECTS)) {
  fxState[key] = load('fx.' + key, def);
  const el = document.createElement('label');
  el.innerHTML = `<input type="checkbox"> ${label}`;
  const box = el.querySelector('input');
  box.checked = fxState[key];
  box.addEventListener('change', () => {
    fxState[key] = box.checked;
    save('fx.' + key, box.checked);
    if (fx) fx.set(key, box.checked);
  });
  ui.fx.appendChild(el);
}
ui.volume.value = load('fx.volume', 0.7);
ui.volume.addEventListener('input', () => {
  save('fx.volume', +ui.volume.value);
  if (fx) fx.setVolume(+ui.volume.value);
});
ui.dry.value = load('fx.dry', 0);
ui.dry.addEventListener('input', () => {
  save('fx.dry', +ui.dry.value);
  if (fx) fx.setDry(+ui.dry.value);
});

ui.mic.addEventListener('click', async () => {
  try {
    await hum.start();
    fx = new VoiceFX(hum.ctx, hum.source);
    Object.assign(fx.enabled, fxState);
    await fx.init();
    fx.setVolume(+ui.volume.value);
    fx.setDry(+ui.dry.value);
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

function xrFrame(t, frame) {
  const session = frame.session;
  session.requestAnimationFrame(xrFrame);
  const pose = frame.getViewerPose(refSpace);
  if (!pose) return;

  updateWaves(t);

  const layer = session.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const view of pose.views) {
    const vp = layer.getViewport(view);
    gl.viewport(vp.x, vp.y, vp.width, vp.height);
    const p = view.transform.position;
    drawScene(view.projectionMatrix, view.transform.inverse.matrix, [p.x, p.y, p.z]);
  }
}

initXR();
