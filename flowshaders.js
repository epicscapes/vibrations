// Shader für die Experience „Flow Drift“
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

// Grundfarbe aller Leuchteffekte (warm wie die Sonne); wird per Hue-Shift nach Stimmfrequenz gedreht
const BASE_GLSL = `
const vec3 GLOW = vec3(1.0, 0.5, 0.18);
const vec3 SKY_LOW = vec3(0.16, 0.05, 0.05);
`;

// ---------- Himmel: Verlauf + feine Sterne (Vollbild, aus der inversen Kamera berechnet) ----------
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
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - uCam);
  float up = dir.y;
  vec3 low = hueShift(SKY_LOW, uHue);
  vec3 col = mix(low, vec3(0.008, 0.006, 0.02), smoothstep(-0.02, 0.45, up));
  col += hueShift(GLOW, uHue) * 0.12 * exp(-abs(up) * 18.0);          // schmaler Horizont-Schimmer
  vec3 cell = floor(dir * 260.0);
  float s = hash(cell);
  col += step(0.9975, s) * smoothstep(0.02, 0.2, up) * 0.6;          // Sterne
  o = vec4(col, 1.0);
}`;

// ---------- Gelände mit Fresnel ----------
export const terrainVS = `#version 300 es
in vec2 aPos;               // 0..1 Gitter
uniform mat4 uProj;
uniform mat4 uView;
uniform vec2 uOrigin;       // Gittermitte (auf Zellen gerastet, damit nichts "schwimmt")
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
uniform vec3 uBall;
uniform float uHue;
uniform float uGlowAmt;     // Leuchten unter der Kugel (stärker beim Antrieb)
in vec3 vWorld;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
${TERRAIN_GLSL}
void main() {
  vec3 n = terrainN(vWorld.xz);
  vec3 v = normalize(uCam - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 glow = hueShift(GLOW, uHue);
  vec3 col = vec3(0.018, 0.012, 0.03);
  col += glow * fres * 0.9;
  // sehr feine Höhenlinien
  float c = abs(fract(vWorld.y * 2.5) - 0.5);
  col += glow * smoothstep(0.03, 0.0, c) * 0.05;
  // Lichtpfütze unter der Kugel
  vec2 d = vWorld.xz - uBall.xz;
  col += glow * exp(-dot(d, d) * 1.4) * (0.12 + 0.35 * uGlowAmt);
  // Nebel zum Horizont
  float dist = length(uCam - vWorld);
  float f = exp(-dist * 0.03);
  col = mix(hueShift(SKY_LOW, uHue) * 0.8, col, f);
  o = vec4(col, 1.0);
}`;

// ---------- Kugel: Fresnel + sanft durchscheinende Julia-Muster (drehen sich mit) ----------
export const ballVS = `#version 300 es
in vec2 aPos;               // (Längengrad, Breitengrad) 0..1
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
uniform float uTime;
uniform float uDrive;
in vec3 vObj;
in vec3 vN;
in vec3 vWorld;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
float julia(vec2 z, vec2 c) {
  for (int i = 0; i < 28; i++) {
    z = cmul(z, z) + c;
    float m = dot(z, z);
    if (m > 64.0) return (float(i) + 1.0 - log2(log2(m) * 0.5)) / 28.0;
  }
  return 1.0;
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.2);
  vec3 glow = hueShift(GLOW, uHue);
  // Stereografische Projektion je Halbkugel -> Julia-Muster auf der Oberfläche
  vec3 q = normalize(vObj);
  vec2 z = q.xz / (1.0 + abs(q.y)) * 1.7;
  float a = 3.1 + 1.4 * sin(uTime * 0.07);
  float t = julia(z, 0.7885 * vec2(cos(a), sin(a)));
  float pat = smoothstep(0.12, 0.7, t);
  vec3 col = vec3(0.03, 0.02, 0.05);
  col += glow * pat * (0.5 + 0.4 * uDrive) * (1.0 - fres * 0.5);
  col += glow * fres * 1.3;
  // weicher Glanzpunkt
  vec3 l = normalize(vec3(-0.4, 0.8, 0.3));
  col += vec3(1.0, 0.9, 0.8) * pow(max(dot(reflect(-v, n), l), 0.0), 40.0) * 0.35;
  o = vec4(col, 1.0);
}`;

// ---------- Funken: schimmernder Pfad und Explosionen der Goals ----------
// Attribute: aPos (Position), aData = (Geburtszeit, Lebensdauer, Farbton, Saat)
export const sparkVS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aData;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uTime;
uniform float uSize;
uniform float uPxScale;
uniform float uRise;        // langsames Aufsteigen (m/s)
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
  float tw = 0.55 + 0.45 * sin(uTime * (2.0 + seed * 6.0) + seed * 40.0);   // Schimmern
  vA = pow(1.0 - age, 1.5) * smoothstep(0.0, 0.03, age) * tw;
  vCol = hueShift(mix(GLOW, vec3(1.0, 0.85, 0.6), seed * 0.5), aData.z);
}`;

export const sparkFS = `#version 300 es
precision mediump float;
in float vA;
in vec3 vCol;
out vec4 o;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float m = exp(-r * r * 5.0);
  o = vec4(vCol * vA * m, 1.0);
}`;

// ---------- Warp-Ringe: konzentrische Ringe, die beim Antrieb nach hinten wegstrahlen ----------
export const ringVS = `#version 300 es
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenter;
uniform vec3 uU;            // Achse 1 × Radius
uniform vec3 uV;            // Achse 2 × Radius
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
  float a = exp(-pow((d - 0.9) / 0.035, 2.0)) + 0.35 * exp(-pow((d - 0.88) / 0.12, 2.0));
  o = vec4(uColor * a * uAlpha, 1.0);
}`;

// ---------- Ribbon-Schweif: Band entlang der letzten Positionen, zur Kamera gedreht ----------
export const ribbonVS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aData;     // (Deckkraft, Seite -1..1)
uniform mat4 uProj;
uniform mat4 uView;
out vec2 vData;
void main() {
  vData = aData;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

export const ribbonFS = `#version 300 es
precision mediump float;
uniform vec3 uColor;
in vec2 vData;
out vec4 o;
void main() {
  float a = vData.x * (1.0 - vData.y * vData.y);
  o = vec4(uColor * a, 1.0);
}`;

// ---------- Leuchtkugeln: Goals und Begleiter (Punkt-Sprites mit Kern und Halo) ----------
// aData = (Größe in m, Farbton, Helligkeit, Halo-Anteil)
export const glowVS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aData;
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
  vCol = hueShift(mix(GLOW, vec3(1.0, 0.9, 0.7), 0.35), aData.y) * aData.z;
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
  o = vec4(vCol * (core * 1.5 + halo) * (1.0 - smoothstep(0.9, 1.0, r)), 1.0);
}`;
