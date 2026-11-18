// VR-Menü: schwebt über der linken Hand, dreht sich immer zum Kopf.
// Öffnen/Schließen mit der X-Taste (linker Controller), Bedienung mit dem rechten Trigger per Laserpointer.
// Inhalt wird in eine 2D-Canvas gezeichnet und als Textur auf ein Quad gelegt (nur neu gezeichnet, wenn sich etwas ändert).
import { menuVS, menuFS, beamVS, beamFS } from './shaders.js';

const W = 640;            // Canvas-Breite (px)
const ROW = 46;           // Zeilenhöhe (px)
const PAD = 14;
const M_PER_PX = 0.36 / W; // Menü ist 36 cm breit
const SLIDER_X = 330, SLIDER_W = 210;

const C = {
  bg: 'rgba(20,6,4,0.92)', line: 'rgba(232,180,138,0.25)', text: '#f3c79c', dim: 'rgba(243,199,156,0.6)',
  accent: '#f08a3a', hover: 'rgba(240,138,58,0.16)', section: 'rgba(232,180,138,0.10)',
};

export class VRMenu {
  // sections: [{title, items:{key: def}}], effects: [{key,label}], S: Einstellungen,
  // onChange(key, value): übernimmt einen Wert, fx: {get(key), set(key, on)}
  constructor(gl, { program, sections, effects, S, onChange, fx }) {
    this.gl = gl;
    this.sections = sections;
    this.effects = effects;
    this.S = S;
    this.onChange = onChange;
    this.fx = fx;
    this.open = false;
    this.openSection = 0;
    this.hover = -1;
    this.drag = null;
    this.prevX = false;
    this.prevTrig = false;
    this.dirty = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.ctx = this.canvas.getContext('2d');
    this.tex = gl.createTexture();
    this.menuProg = program(menuVS, menuFS);
    this.beamProg = program(beamVS, beamFS);
    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.empty = gl.createVertexArray();
    this.pose = null;      // {origin, ax, ay, n} des Quads
    this.beam = null;      // {a, b}
  }

  // Zeilen des aktuellen Zustands (Akkordeon: nur eine Sektion offen)
  rows() {
    const r = [];
    this.sections.forEach((sec, i) => {
      r.push({ type: 'section', i, label: sec.title });
      if (i !== this.openSection) return;
      if (sec.effects) for (const e of this.effects) r.push({ type: 'fx', key: e.key, label: e.label });
      for (const [key, d] of Object.entries(sec.items)) r.push({ type: 'item', key, d, label: d.label });
    });
    return r;
  }

  markDirty() { this.dirty = true; }

  redraw() {
    const g = this.ctx, rows = this.rows();
    const H = PAD * 2 + rows.length * ROW;
    if (this.canvas.height !== H) this.canvas.height = H;
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg;
    roundRect(g, 0, 0, W, H, 22); g.fill();
    g.textBaseline = 'middle';
    rows.forEach((row, n) => {
      const y = PAD + n * ROW, cy = y + ROW / 2;
      if (row.type === 'section') { g.fillStyle = C.section; g.fillRect(8, y + 2, W - 16, ROW - 4); }
      if (n === this.hover) { g.fillStyle = C.hover; g.fillRect(8, y + 2, W - 16, ROW - 4); }
      g.font = row.type === 'section' ? '600 24px system-ui, sans-serif' : '21px system-ui, sans-serif';
      g.fillStyle = C.text;
      if (row.type === 'section') {
        g.fillText((row.i === this.openSection ? '▾ ' : '▸ ') + row.label, 22, cy);
        return;
      }
      g.fillText(row.label, 30, cy, SLIDER_X - 44);
      if (row.type === 'fx') { checkbox(g, SLIDER_X, cy, this.fx.get(row.key)); return; }
      const d = row.d, v = this.S[row.key];
      if (d.toggle) { checkbox(g, SLIDER_X, cy, v); return; }
      if (d.options) {
        const opt = d.options.find(([ov]) => ov === v);
        g.fillStyle = C.accent;
        g.fillText('◂ ' + (opt ? opt[1] : v) + ' ▸', SLIDER_X, cy, W - SLIDER_X - 20);
        return;
      }
      const t = (v - d.min) / (d.max - d.min);
      g.fillStyle = C.line; g.fillRect(SLIDER_X, cy - 3, SLIDER_W, 6);
      g.fillStyle = C.accent; g.fillRect(SLIDER_X, cy - 3, SLIDER_W * t, 6);
      g.beginPath(); g.arc(SLIDER_X + SLIDER_W * t, cy, 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.dim; g.textAlign = 'right';
      g.fillText((+v).toFixed(decimals(d.step)), W - 14, cy);
      g.textAlign = 'left';
    });
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.dirty = false;
    this.rowList = rows;
  }

  // Pro XR-Frame. Gibt true zurück, wenn der rechte Trigger gerade das Menü bedient (dann keine Wellen).
  update(frame, refSpace, head) {
    let left = null, right = null;
    for (const src of frame.session.inputSources) {
      if (src.handedness === 'left') left = src;
      if (src.handedness === 'right') right = src;
    }
    // X-Taste (linker Controller, Button 4) schaltet das Menü
    const xDown = !!(left && left.gamepad && left.gamepad.buttons[4] && left.gamepad.buttons[4].pressed);
    if (xDown && !this.prevX) { this.open = !this.open; this.dirty = true; this.drag = null; }
    this.prevX = xDown;
    this.beam = null;
    if (!this.open || !left) { this.pose = null; return false; }

    // Position: über der linken Hand, zum Kopf gedreht
    const lp = frame.getPose(left.gripSpace || left.targetRaySpace, refSpace);
    if (!lp) { this.pose = null; return false; }
    if (this.dirty) this.redraw();
    const p = lp.transform.position;
    const anchor = [p.x, p.y + 0.07, p.z];
    let z = sub(head, anchor); z = norm(z);
    let x = norm(cross([0, 1, 0], z));
    const y = cross(z, x);
    const wM = W * M_PER_PX, hM = this.canvas.height * M_PER_PX;
    const origin = add(anchor, scale(x, -wM / 2));
    this.pose = { origin, ax: scale(x, wM), ay: scale(y, hM), x, y, n: z, wM, hM };

    // Laserpointer vom rechten Controller
    if (!right || !right.gamepad) return false;
    const rp = frame.getPose(right.targetRaySpace, refSpace);
    if (!rp) return false;
    const o = [rp.transform.position.x, rp.transform.position.y, rp.transform.position.z];
    const q = rp.transform.orientation;
    const d = [-2 * (q.x * q.z + q.w * q.y), -2 * (q.y * q.z - q.w * q.x), -(1 - 2 * (q.x * q.x + q.y * q.y))];
    const denom = dot(d, z);
    const trig = right.gamepad.buttons[0] && right.gamepad.buttons[0].value > 0.5;
    const pressed = trig && !this.prevTrig;
    this.prevTrig = trig;
    let hitPx = null;
    if (Math.abs(denom) > 1e-4) {
      const t = dot(sub(origin, o), z) / denom;
      if (t > 0) {
        const hit = add(o, scale(d, t));
        const rel = sub(hit, origin);
        const u = dot(rel, x) / M_PER_PX, v = this.canvas.height - dot(rel, y) / M_PER_PX;
        const inside = u >= 0 && u <= W && v >= 0 && v <= this.canvas.height;
        if (inside || this.drag) { hitPx = [u, v]; this.beam = { a: o, b: hit }; }
      }
    }
    if (!trig) this.drag = null;
    if (!hitPx) { if (this.hover !== -1) { this.hover = -1; this.dirty = true; } return false; }

    const rowIdx = Math.floor((hitPx[1] - PAD) / ROW);
    const row = this.rowList && this.rowList[rowIdx];
    if (rowIdx !== this.hover) { this.hover = rowIdx; this.dirty = true; }

    if (this.drag) {                               // Schieberegler ziehen
      this.setSlider(this.drag, hitPx[0]);
    } else if (pressed && row) {
      if (row.type === 'section') { this.openSection = this.openSection === row.i ? -1 : row.i; }
      else if (row.type === 'fx') { this.fx.set(row.key, !this.fx.get(row.key)); }
      else if (row.d.toggle) { this.onChange(row.key, !this.S[row.key]); }
      else if (row.d.options) {
        const opts = row.d.options, i = opts.findIndex(([ov]) => ov === this.S[row.key]);
        const dir = hitPx[0] < SLIDER_X + 30 ? -1 : 1;   // links ◂ zurück, sonst ▸ weiter
        this.onChange(row.key, opts[(i + dir + opts.length) % opts.length][0]);
      } else { this.drag = row; this.setSlider(row, hitPx[0]); }
      this.dirty = true;
    }
    return true;
  }

  setSlider(row, px) {
    const d = row.d;
    const t = Math.min(Math.max((px - SLIDER_X) / SLIDER_W, 0), 1);
    let v = d.min + t * (d.max - d.min);
    v = Math.round(v / d.step) * d.step;
    v = +Math.min(Math.max(v, d.min), d.max).toFixed(6);
    if (v !== this.S[row.key]) { this.onChange(row.key, v); this.dirty = true; }
  }

  draw(proj, view, vpW, vpH) {
    if (!this.pose) return;
    const gl = this.gl;
    if (this.dirty) this.redraw();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.menuProg.p);
    const u = this.menuProg.u;
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform3fv(u.uOrigin, this.pose.origin);
    gl.uniform3fv(u.uAxisX, this.pose.ax);
    gl.uniform3fv(u.uAxisY, this.pose.ay);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u.uTex, 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (this.beam) {
      gl.useProgram(this.beamProg.p);
      const b = this.beamProg.u;
      gl.uniformMatrix4fv(b.uProj, false, proj);
      gl.uniformMatrix4fv(b.uView, false, view);
      gl.uniform3fv(b.uA, this.beam.a);
      gl.uniform3fv(b.uB, this.beam.b);
      gl.uniform2f(b.uVp, vpW, vpH);
      gl.uniform1f(b.uWidthPx, 2.5);
      gl.uniform3f(b.uColor, 1.0, 0.62, 0.3);
      gl.bindVertexArray(this.empty);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
  }
}

function decimals(step) { return step >= 1 ? 0 : Math.min(Math.ceil(-Math.log10(step)), 4); }
function checkbox(g, x, cy, on) {
  g.strokeStyle = C.accent; g.lineWidth = 2;
  roundRect(g, x, cy - 13, 26, 26, 6); g.stroke();
  if (on) { g.fillStyle = C.accent; roundRect(g, x + 6, cy - 7, 14, 14, 3); g.fill(); }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
