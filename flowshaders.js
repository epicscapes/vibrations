// Shader für die Experience „Flow Drift“ – Look nach der Unreal-Referenz:
// sehr dunkel, Magenta/Violett, Aurora-Schleier am Himmel, Bodennebel ohne sichtbaren Horizont,
// fast schwarzer, leicht glänzender Boden, gläserne Kugel mit Innenlicht.
import { COLOR_GLSL } from './shaders.js';

// Gelände von Level 1 „Rolling Hills“: sanfte, überlagerte Sinus-Hügel.
// Dieselbe Formel steht in flowdrift.js (terrainH) für die Physik – beide gleich halten!
export const TERRAIN_GLSL = `
float terrainH(vec2 p) {
  return 1.1 * sin(p.x * 0.17) * cos(p.y * 0.14)
       + 0.55 * sin(p.x * 0.071 + p.y * 0.113 + 1.3)
       + 0.30 * sin((p.x - p.y) * 0.29 + 0.7)
       + 0.18 * cos(p.x * 0.43 + p.y * 0.21);
}
vec3 terrainN(vec2 p) {
  float e = 0.06;
  float hx = terrainH(p + vec2(e, 0.0)) - terrainH(p - vec2(e, 0.0));
  float hz = terrainH(p + vec2(0.0, e)) - terrainH(p - vec2(0.0, e));
  return normalize(vec3(-hx, 2.0 * e, -hz));
}`;

// Grundfarben (werden per Hue-Shift nach Stimmfrequenz gedreht)
const BASE_GLSL = `
const vec3 GLOW     = vec3(0.95, 0.28, 0.75);  // Licht der Kugeln, Funken, Ringe (Magenta)
const vec3 AUR_LOW  = vec3(0.55, 0.04, 0.42);  // Aurora unten (Magenta)
const vec3 AUR_HIGH = vec3(0.22, 0.08, 0.62);  // Aurora oben (Violett/Indigo)
const vec3 FOG      = vec3(0.065, 0.016, 0.07);// Szenen-/Bodennebel
`;

// Aurora + Nebel: von Himmel, Boden (Fake-Spiegelung) und Kugeln gemeinsam genutzt
const SKY_GLSL = `
uniform float uTime;
vec3 skyColor(vec3 dir, float hue) {
  float up = dir.y;
  float az = atan(dir.x, dir.z);
  // schräge, langsam wandernde Schleier
  float s = az * 3.0 + up * 2.2;
  float curtain = 0.55 + 0.45 * sin(s * 2.0 + uTime * 0.05 + sin(az * 5.0 + uTime * 0.03) * 1.5);
  curtain *= 0.6 + 0.4 * sin(s * 7.0 - uTime * 0.08 + sin(az * 11.0) * 2.0);
  curtain = pow(max(curtain, 0.0), 1.4);
  float band = smoothstep(-0.02, 0.25, up) * (1.0 - smoothstep(0.55, 1.0, up) * 0.6);
  vec3 aur = mix(hueShift(AUR_LOW, hue), hueShift(AUR_HIGH, hue), smoothstep(0.1, 0.8, up));
  vec3 col = hueShift(FOG, hue) + aur * curtain * band * 0.95;
  // zum Horizont in den Nebel übergehen -> kein sichtbarer Horizont
  return mix(hueShift(FOG, hue), col, smoothstep(0.0, 0.18, up));
}`;

// ---------- Himmel ----------
export const skyVS = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;

export const skyFS = `#version 300 es
precision highp float;
uniform mat4 uInvVP;
uniform vec3 uCam;
uniform float uHue;
in vec2 vNdc;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
${SKY_GLSL}
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - uCam);
  o = vec4(skyColor(dir, uHue), 1.0);
}`;

// ---------- Gelände: dunkel, leicht glänzend, Innenlichter der Kugeln, Höhennebel ----------
export const MAX_LIGHTS = 9;

export const terrainVS = `#version 300 es
in vec2 aPos;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec2 uOrigin;
uniform float uSize;
out vec3 vWorld;
${TERRAIN_GLSL}
void main() {
  vec2 xz = uOrigin + (aPos - 0.5) * uSize;
  vWorld = vec3(xz.x, terrainH(xz), xz.y);
  gl_Position = uProj * uView * vec4(vWorld, 1.0);
}`;

export const terrainFS = `#version 300 es
precision highp float;
uniform vec3 uCam;
uniform float uHue;
uniform int uLightCount;
uniform vec3 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightCol[${MAX_LIGHTS}];   // Farbe × Stärke
uniform float uFogDensity;
in vec3 vWorld;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
${TERRAIN_GLSL}
${SKY_GLSL}

// weiche Marmorierung (wie die Bodentextur der Referenz)
float marble(vec2 p) {
  float n = sin(p.x * 0.9 + sin(p.y * 0.7) * 2.0) * 0.5 + sin(p.y * 1.3 + sin(p.x * 1.1) * 1.6) * 0.35
          + sin((p.x + p.y) * 2.7 + sin(p.x * 0.5) * 3.0) * 0.15;
  return 0.5 + 0.5 * n;
}

void main() {
  vec3 n = terrainN(vWorld.xz);
  vec3 v = normalize(uCam - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float m = marble(vWorld.xz);
  vec3 col = vec3(0.006, 0.003, 0.01) * (0.6 + 0.8 * m);
  // Fake-Spiegelung des Himmels (Glanz an flachen Blickwinkeln)
  vec3 r = reflect(-v, n);
  col += skyColor(r, uHue) * (0.08 + fres * 0.9);

  // Innenlichter der Kugeln: diffuses Kontaktlicht + glänzender Lichtstreif zur Kamera (Fake-Spiegelung)
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 L = uLightPos[i] - vWorld;
    float d2 = dot(L, L);
    vec3 l = L * inversesqrt(d2);
    float diff = max(dot(n, l), 0.0) / (1.0 + d2 * 1.2);
    float spec = pow(max(dot(r, l), 0.0), 24.0) / (1.0 + d2 * 0.25);
    col += uLightCol[i] * (diff * 0.9 + spec * 0.55 * (0.5 + m));
  }

  // Höhennebel: am Boden am dichtesten, in der Szenenfarbe
  float dist = length(uCam - vWorld);
  float hFactor = exp(-max(vWorld.y + 1.5, 0.0) * 0.45);
  float fog = 1.0 - exp(-dist * uFogDensity * (0.6 + 1.4 * hFactor));
  col = mix(col, hueShift(FOG, uHue), clamp(fog, 0.0, 1.0));
  // ganz außen vollständig im Nebel (kein Rand des Geländes sichtbar)
  col = mix(col, hueShift(FOG, uHue), smoothstep(36.0, 52.0, dist));
  o = vec4(col, 1.0);
}`;

// ---------- Kugeln: gläsern, dunkle Wirbel (Julia), Innenlicht, dezenter Rand ----------
export const ballVS = `#version 300 es
in vec2 aPos;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uPos;
uniform float uR;
uniform mat3 uRot;
out vec3 vObj;
out vec3 vN;
out vec3 vWorld;
void main() {
  float th = aPos.x * 6.2831853, ph = aPos.y * 3.14159265;
  vec3 p = vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th));
  vObj = p;
  vN = uRot * p;
  vWorld = uPos + vN * uR;
  gl_Position = uProj * uView * vec4(vWorld, 1.0);
}`;

export const ballFS = `#version 300 es
precision highp float;
uniform vec3 uCam;
uniform float uHue;
uniform float uLight;      // Stärke des Innenlichts
uniform float uSwirl;      // Sichtbarkeit der Wirbel
in vec3 vObj;
in vec3 vN;
in vec3 vWorld;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
${SKY_GLSL}
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
float julia(vec2 z, vec2 c) {
  for (int i = 0; i < 24; i++) {
    z = cmul(z, z) + c;
    float m = dot(z, z);
    if (m > 64.0) return (float(i) + 1.0 - log2(log2(m) * 0.5)) / 24.0;
  }
  return 1.0;
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vWorld);
  float nv = max(dot(n, v), 0.0);
  float fres = pow(1.0 - nv, 3.0);
  vec3 glow = hueShift(GLOW, uHue);
  vec3 q = normalize(vObj);
  vec2 z = q.xz / (1.0 + abs(q.y)) * 1.6;
  float a = 3.1 + 1.4 * sin(uTime * 0.07);
  float t = julia(z, 0.7885 * vec2(cos(a), sin(a)));
  float swirl = smoothstep(0.15, 0.75, t);
  // Glas: Innenlicht scheint durch die Mitte, Wirbel liegen darüber
  vec3 inner = glow * uLight * pow(nv, 2.5);
  vec3 col = inner * (0.55 + 0.45 * swirl) + glow * swirl * uSwirl * 0.18;
  col += skyColor(reflect(-v, n), uHue) * fres * 0.9;          // Spiegelung von Aurora/Nebel am Rand
  col += glow * fres * 0.12;
  vec3 l = normalize(vec3(-0.3, 0.9, 0.2));
  col += vec3(1.0, 0.85, 0.95) * pow(max(dot(reflect(-v, n), l), 0.0), 60.0) * 0.25;
  float alpha = clamp(0.55 + fres * 0.45 + uLight * 0.2, 0.0, 1.0);   // gläsern, Rand deckender
  o = vec4(col, alpha);
}`;

// ---------- Funken: schimmernder Pfad und Explosionen ----------
export const sparkVS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aData;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uSize;
uniform float uPxScale;
uniform float uRise;
uniform float uBright;
out float vA;
out vec3 vCol;
${COLOR_GLSL}
${BASE_GLSL}
void main() {
  float age = (uTime - aData.x) / aData.y;
  if (age < 0.0 || age > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
  float seed = aData.w;
  vec3 p = aPos + vec3(0.0, (uTime - aData.x) * uRise, 0.0);
  vec4 vp = uView * vec4(p, 1.0);
  gl_Position = uProj * vp;
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * seed) * uPxScale / max(-vp.z, 0.05), 1.0, 24.0);
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + seed * 6.0) + seed * 40.0);
  vA = pow(1.0 - age, 1.5) * smoothstep(0.0, 0.03, age) * tw * uBright;
  vCol = hueShift(mix(GLOW, vec3(1.0, 0.8, 0.95), seed * 0.4), aData.z);
}`;

export const sparkFS = `#version 300 es
precision mediump float;
in float vA;
in vec3 vCol;
out vec4 o;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  o = vec4(vCol * vA * exp(-r * r * 5.0), 1.0);
}`;

// ---------- Warp-Ringe: dünn, dezent, wie ein Tunnel hinter der Kugel ----------
export const ringVS = `#version 300 es
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenter;
uniform vec3 uU;
uniform vec3 uV;
out vec2 vUv;
void main() {
  int c = gl_VertexID;
  vec2 q = vec2((c == 1 || c == 2 || c == 4) ? 1.0 : -1.0, (c == 2 || c == 4 || c == 5) ? 1.0 : -1.0);
  vUv = q;
  gl_Position = uProj * uView * vec4(uCenter + uU * q.x + uV * q.y, 1.0);
}`;

export const ringFS = `#version 300 es
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
in vec2 vUv;
out vec4 o;
void main() {
  float d = length(vUv);
  float a = exp(-pow((d - 0.92) / 0.018, 2.0)) + 0.25 * exp(-pow((d - 0.9) / 0.07, 2.0));
  o = vec4(uColor * a * uAlpha, 1.0);
}`;

// ---------- Ribbon-Schweif ----------
export const ribbonVS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aData;
uniform mat4 uProj;
uniform mat4 uView;
out vec2 vData;
void main() { vData = aData; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

export const ribbonFS = `#version 300 es
precision mediump float;
uniform vec3 uColor;
in vec2 vData;
out vec4 o;
void main() { o = vec4(uColor * vData.x * (1.0 - vData.y * vData.y), 1.0); }`;

// ---------- Leucht-Sprites: Goals und Halos der Kugeln ----------
export const glowVS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aData;     // (Größe m, Farbton, Helligkeit, Halo-Anteil)
uniform mat4 uProj;
uniform mat4 uView;
uniform float uPxScale;
out vec3 vCol;
out float vHalo;
${COLOR_GLSL}
${BASE_GLSL}
void main() {
  vec4 vp = uView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  gl_PointSize = clamp(aData.x * uPxScale / max(-vp.z, 0.05), 2.0, 512.0);
  vCol = hueShift(mix(GLOW, vec3(1.0, 0.85, 1.0), 0.3), aData.y) * aData.z;
  vHalo = aData.w;
}`;

export const glowFS = `#version 300 es
precision mediump float;
in vec3 vCol;
in float vHalo;
out vec4 o;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float core = exp(-r * r * 40.0);
  float halo = exp(-r * r * 5.0) * vHalo;
  o = vec4(vCol * (core * 1.4 + halo) * (1.0 - smoothstep(0.9, 1.0, r)), 1.0);
}`;

// ---------- Flügel: zwei Fächer aus leuchtenden Federn, schlagen sanft ----------
export const WING_FEATHERS = 9;
export const wingVS = `#version 300 es
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uPos;          // Kugelmitte
uniform vec3 uFwd;          // Flugrichtung (horizontal)
uniform float uOpen;        // 0 = eingeklappt, 1 = offen
uniform float uFlap;        // Flügelschlag-Phase
uniform float uSpan;        // Spannweite je Flügel (m)
uniform float uRootR;       // Abstand der Flügelwurzel von der Mitte (m)
out vec2 vUv;
out float vK;
const int F = ${WING_FEATHERS};
void main() {
  int id = gl_VertexID;
  int quad = id / 6;                  // Feder-Index über beide Flügel
  int c = id - quad * 6;
  float side = quad < F ? -1.0 : 1.0;
  int k = quad < F ? quad : quad - F;
  float fk = float(k) / float(F - 1);
  vec2 q = vec2((c == 1 || c == 2 || c == 4) ? 1.0 : 0.0, (c == 2 || c == 4 || c == 5) ? 1.0 : -1.0);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(uFwd, up));
  // Federn fächern von vorne-oben nach hinten aus, Schlag läuft von innen nach außen
  float spread = mix(0.55, -0.35, fk);
  float flap = sin(uFlap - fk * 0.6) * 0.35 * uOpen;
  vec3 dir = normalize(right * side * cos(spread) + up * (sin(spread) * 0.5 + flap) - uFwd * fk * 0.6);
  float len = uSpan * uOpen * mix(1.0, 0.55, fk);
  vec3 width = normalize(cross(dir, up)) * 0.1 * uOpen * (1.0 - q.x * 0.6);
  vec3 root = uPos + right * side * uRootR + up * 0.05;
  vec3 w = root + dir * len * q.x + width * q.y;
  vUv = q;
  vK = fk;
  gl_Position = uProj * uView * vec4(w, 1.0);
}`;

export const wingFS = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform float uOpen;
in vec2 vUv;
in float vK;
out vec4 o;
void main() {
  float edge = 1.0 - vUv.y * vUv.y;
  float a = edge * (0.35 + 0.65 * vUv.x) * (1.0 - vUv.x * 0.5) * uOpen * (0.6 + 0.4 * (1.0 - vK));
  o = vec4(uColor * a * 0.8, 1.0);
}`;
