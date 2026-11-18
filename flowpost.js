// Flow Drift – Bloom als Post-Effekt auf die ganze Szene.
// Ablauf: Szene in einen eigenen Bildpuffer (Farbe + Tiefe) -> Hellpass mit Verkleinerung auf ¼ ->
// trennbare Gauß-Weichzeichnung (pro Auge begrenzt, nichts läuft ins andere Auge) -> Szene + Bloom in den Ziel-Puffer.
import { postVS, brightFS, blurFS, bloomCompFS } from './flowshaders.js';

export class Bloom {
  constructor(gl, program, fullscreenVao) {
    this.gl = gl;
    this.vao = fullscreenVao;
    this.P = { bright: program(postVS, brightFS), blur: program(postVS, blurFS), comp: program(postVS, bloomCompFS) };
    // Weiche Verläufe brauchen mehr als 8 Bit: Bloom-Puffer in Halbfloat, wenn möglich
    this.half = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.w = 0; this.h = 0;
  }

  _tex(w, h, half) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  _fbo(tex, depth) {
    const gl = this.gl;
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    return f;
  }

  // Puffer passend zur Zielgröße anlegen (nur bei Größenänderung)
  resize(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.release();
    this.w = w; this.h = h;
    this.bw = Math.max(1, Math.ceil(w / 4)); this.bh = Math.max(1, Math.ceil(h / 4));
    this.sceneTex = this._tex(w, h, false);
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    this.sceneFbo = this._fbo(this.sceneTex, this.depth);
    this.texA = this._tex(this.bw, this.bh, this.half); this.fboA = this._fbo(this.texA);
    this.texB = this._tex(this.bw, this.bh, this.half); this.fboB = this._fbo(this.texB);
  }
  release() {
    const gl = this.gl;
    if (!this.sceneFbo) return;
    for (const t of [this.sceneTex, this.texA, this.texB]) gl.deleteTexture(t);
    for (const f of [this.sceneFbo, this.fboA, this.fboB]) gl.deleteFramebuffer(f);
    gl.deleteRenderbuffer(this.depth);
    this.sceneFbo = null; this.w = this.h = 0;
  }

  // Hierhin rendert die Szene, wenn Bloom an ist
  begin(w, h) {
    this.resize(w, h);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.sceneFbo);
  }

  _pass(prog, fbo, rect, dstW, dstH, bounds, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(rect[0], rect[1], rect[2], rect[3]);
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u.uDstSize, dstW, dstH);
    gl.uniform4fv(prog.u.uBounds, bounds);
    setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // viewports: [[x,y,w,h], ...] in Pixeln des Ziels; target = Ziel-Bildpuffer (XR oder null)
  finish(target, viewports, strength, softness) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    const { w, h, bw, bh } = this;
    const iters = softness > 0.5 ? 2 : 1;
    const spread = 1.0 + softness * 2.5;
    for (const vp of viewports) {
      const r = [Math.floor(vp[0] / 4), Math.floor(vp[1] / 4), Math.ceil(vp[2] / 4), Math.ceil(vp[3] / 4)];
      // Augen-Rechteck in UV der Bloom-Textur, um einen halben Texel eingerückt
      const bb = [(r[0] + 0.5) / bw, (r[1] + 0.5) / bh, (r[0] + r[2] - 0.5) / bw, (r[1] + r[3] - 0.5) / bh];
      const sb = [(vp[0] + 0.5) / w, (vp[1] + 0.5) / h, (vp[0] + vp[2] - 0.5) / w, (vp[1] + vp[3] - 0.5) / h];
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      this._pass(this.P.bright, this.fboA, r, bw, bh, sb, (u) => {
        gl.uniform1i(u.uTex, 0);
        gl.uniform2f(u.uSrcTexel, 1 / w, 1 / h);
        gl.uniform1f(u.uThreshold, 0.12);
      });
      for (let i = 0; i < iters; i++) {
        const s = spread * (i + 1);
        gl.bindTexture(gl.TEXTURE_2D, this.texA);
        this._pass(this.P.blur, this.fboB, r, bw, bh, bb, (u) => { gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uStep, s / bw, 0); });
        gl.bindTexture(gl.TEXTURE_2D, this.texB);
        this._pass(this.P.blur, this.fboA, r, bw, bh, bb, (u) => { gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uStep, 0, s / bh); });
      }
    }
    // Zusammensetzen in das Ziel
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.useProgram(this.P.comp.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.uniform1i(this.P.comp.u.uScene, 0);
    gl.uniform1i(this.P.comp.u.uBloom, 1);
    gl.uniform1f(this.P.comp.u.uStrength, strength);
    gl.uniform2f(this.P.comp.u.uDstSize, w, h);
    for (const vp of viewports) {
      const r = [Math.floor(vp[0] / 4), Math.floor(vp[1] / 4), Math.ceil(vp[2] / 4), Math.ceil(vp[3] / 4)];
      gl.uniform4f(this.P.comp.u.uBounds, (r[0] + 0.5) / bw, (r[1] + 0.5) / bh, (r[0] + r[2] - 0.5) / bw, (r[1] + r[3] - 0.5) / bh);
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.depthMask(true);
  }
}
