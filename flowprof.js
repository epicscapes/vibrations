// Flow Drift – einfacher Profiler (nur mit ?profile=1 aktiv).
// GPU: EXT_disjoint_timer_query_webgl2, wenn vorhanden (asynchron, verfälscht nichts);
// sonst ein 1-Pixel-readPixels vor/nach jedem Abschnitt (synchron, nur relativ aussagekräftig).
// mark(name) beendet den laufenden Abschnitt und startet den nächsten; Zeiten werden pro Frame summiert (beide Augen).
export class Profiler {
  constructor(gl) {
    this.gl = gl;
    this.ext = new URLSearchParams(location.search).get('profile') === 'finish' ? null : gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.mode = this.ext ? 'gpu-timer' : 'finish';
    this.cur = null; this.t0 = 0; this.q = null;
    this.pending = [];
    this.gpu = {}; this.cpu = {};
    this.frames = 0; this.frameMs = 0; this.lastFrame = 0;
    this.report = '';
  }
  mark(name) {
    const gl = this.gl;
    if (this.ext) {
      if (this.q) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.q); this.q = null; }
      if (name) { const q = gl.createQuery(); q.name = name; gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.q = q; }
    } else {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px || (this.px = new Uint8Array(4)));   // erzwingt Abschluss (finish allein wartet nicht überall)
      const now = performance.now();
      if (this.cur) this.gpu[this.cur] = (this.gpu[this.cur] || 0) + now - this.t0;
      this.cur = name; this.t0 = now;
    }
  }
  end() { this.mark(null); }
  cpuTime(name, ms) { this.cpu[name] = (this.cpu[name] || 0) + ms; }
  frame() {
    const gl = this.gl, now = performance.now();
    if (this.lastFrame) this.frameMs += now - this.lastFrame;
    this.lastFrame = now;
    this.frames++;
    if (this.ext) {
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      this.pending = this.pending.filter((q) => {
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
        if (!disjoint) this.gpu[q.name] = (this.gpu[q.name] || 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
        return false;
      });
    }
    if (this.frames >= 120) {
      const n = this.frames, line = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / n).toFixed(2)}`).join(' · ');
      const gpuSum = Object.values(this.gpu).reduce((a, b) => a + b, 0) / n;
      this.report = `[${this.mode}] frame ${(this.frameMs / (n - 1 || 1)).toFixed(1)} ms (${(1000 * (n - 1) / this.frameMs).toFixed(0)} fps) | GPU ${gpuSum.toFixed(2)} ms: ${line(this.gpu)} | CPU: ${line(this.cpu)}`;
      console.log('PROFILE ' + this.report);
      this.last = { gpu: { ...this.gpu }, cpu: { ...this.cpu }, frames: n, frameMs: this.frameMs / (n - 1 || 1) };
      this.gpu = {}; this.cpu = {}; this.frames = 0; this.frameMs = 0;
    }
  }
}
