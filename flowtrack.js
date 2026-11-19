// Flow Drift – Spuren im Boden (wie in Sand): rollende Kugeln drücken für ein paar Sekunden eine Rille ein.
// Keine Geometrie: eine Höhen-Textur (RGBA16F) in Weltkoordinaten, gekachelt (Ringpuffer) um den Spieler.
// Pro Frame: alte Spuren abklingen lassen (Ping-Pong, außerhalb des Radius gelöscht -> keine Kachel-Geister),
// dann je Kugel ein weiches Kapsel-Segment (letzte -> aktuelle Position) mit MAX einstempeln.
// Der Gelände-Shader liest die Textur und kippt damit die Normale (Bump) und dunkelt die Rille leicht ab.

export const TRACK_SIZE = 16;     // m, Kantenlänge der Kachel
export const TRACK_RES = 512;     // Texel (≈ 3,1 cm – gleiche Detailschärfe wie vorher auf kleinerer Fläche)
export const TRACK_RADIUS = 6.5;  // m um den Spieler; außerhalb gelöscht, ab ~4,5 m weich ausgeblendet (muss < TRACK_SIZE/2 sein)

const vs = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const decayFS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform float uKeep;
uniform vec2 uCenter;
uniform float uSize, uRes, uRadius;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  // nächstgelegene Weltposition dieses Texels zum Spieler
  vec2 w = uv * uSize;
  w += uSize * floor((uCenter - w) / uSize + 0.5);
  float keep = length(w - uCenter) < uRadius ? uKeep : 0.0;
  o = vec4(texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).r * keep, 0.0, 0.0, 1.0);
}`;

const stampVS = `#version 300 es
uniform vec2 uA, uB;      // Segment (Welt xz)
uniform float uW;         // Halbbreite der Rille (m)
uniform vec2 uBase;       // Weltursprung der Kachel-Kopie
uniform float uSize;
out vec2 vP;
void main() {
  int c = gl_VertexID;
  vec2 corner = vec2((c == 1 || c == 2 || c == 4) ? 1.0 : -1.0, (c == 2 || c == 4 || c == 5) ? 1.0 : -1.0);
  vec2 d = uB - uA;
  float L = length(d);
  vec2 t = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-t.y, t.x);
  vec2 mid = (uA + uB) * 0.5;
  vec2 p = mid + t * (L * 0.5 + uW) * corner.x + nrm * uW * corner.y;
  vP = p;
  gl_Position = vec4((p - uBase) / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;

const stampFS = `#version 300 es
precision highp float;
uniform vec2 uA, uB;
uniform float uW, uDepth;
in vec2 vP;
out vec4 o;
void main() {
  vec2 ab = uB - uA;
  float h = clamp(dot(vP - uA, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  float d = length(vP - uA - ab * h) / uW;
  if (d >= 1.0) discard;
  float prof = (1.0 - d * d); prof *= prof;            // weiche, runde Rille
  o = vec4(prof * uDepth, 0.0, 0.0, 1.0);
}`;

export class Tracks {
  constructor(gl, program, fullscreenVao, emptyVao) {
    this.gl = gl;
    this.ok = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    if (!this.ok) return;
    this.vao = fullscreenVao; this.emptyVao = emptyVao;
    this.decay = program(vs, decayFS);
    this.stamp = program(stampVS, stampFS);
    this.tex = []; this.fbo = [];
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, TRACK_RES, TRACK_RES, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.tex.push(t); this.fbo.push(f);
    }
    this.cur = 0;
  }

  get texture() { return this.ok ? this.tex[this.cur] : null; }

  // segs: [{ a:[x,z], b:[x,z], w, depth }]
  update(dt, center, life, segs) {
    if (!this.ok) return;
    const gl = this.gl, S = TRACK_SIZE;
    const src = this.cur, dst = 1 - this.cur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst]);
    gl.viewport(0, 0, TRACK_RES, TRACK_RES);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    // Abklingen (+ Löschen außerhalb des Radius)
    gl.useProgram(this.decay.p);
    let u = this.decay.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[src]);
    gl.uniform1i(u.uPrev, 0);
    gl.uniform1f(u.uKeep, Math.exp(-dt * 3 / life));       // nach „life“ Sekunden ~5 %
    gl.uniform2f(u.uCenter, center[0], center[1]);
    gl.uniform1f(u.uSize, S);
    gl.uniform1f(u.uRes, TRACK_RES);
    gl.uniform1f(u.uRadius, TRACK_RADIUS);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Einstempeln: MAX, damit sich Rillen nicht aufaddieren
    if (segs.length) {
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.useProgram(this.stamp.p);
      u = this.stamp.u;
      gl.uniform1f(u.uSize, S);
      gl.bindVertexArray(this.emptyVao);
      for (const s of segs) {
        gl.uniform2f(u.uA, s.a[0], s.a[1]);
        gl.uniform2f(u.uB, s.b[0], s.b[1]);
        gl.uniform1f(u.uW, s.w);
        gl.uniform1f(u.uDepth, s.depth);
        // Kachel-Kopien: das Segment kann über den Rand der Kachel ragen
        const bx = Math.floor(s.a[0] / S) * S, bz = Math.floor(s.a[1] / S) * S;
        for (const ox of [-S, 0, S]) for (const oz of [-S, 0, S]) {
          const minX = Math.min(s.a[0], s.b[0]) - s.w - (bx + ox), maxX = Math.max(s.a[0], s.b[0]) + s.w - (bx + ox);
          const minZ = Math.min(s.a[1], s.b[1]) - s.w - (bz + oz), maxZ = Math.max(s.a[1], s.b[1]) + s.w - (bz + oz);
          if (maxX < 0 || minX > S || maxZ < 0 || minZ > S) continue;
          gl.uniform2f(u.uBase, bx + ox, bz + oz);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
      }
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
    }
    gl.depthMask(true);
    this.cur = dst;
  }
}
