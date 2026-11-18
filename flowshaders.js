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

// Weiche Schnitte: Effekte blenden aus, je näher sie Gelände oder Hauptkugel kommen
// (analytisch – Gelände-Formel und Kugelposition sind bekannt, kein Tiefenpuffer nötig).
const SOFT_GLSL = `
uniform vec3 uBallPos;
uniform float uBallR;
float softFade(vec3 p, float range) {
  float dT = p.y - terrainH(p.xz);
  float dB = length(p - uBallPos) - uBallR;      // im Inneren der Kugel negativ -> unsichtbar
  return smoothstep(0.0, range, dT) * smoothstep(0.0, range, dB);
}`;

// Wertrauschen (für Bodenkörnung und weiche Masken)
const NOISE_GLSL = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

// Dithering gegen Treppenstufen in weichen Verläufen (8-Bit-Bildpuffer): ±½ Farbstufe Rauschen pro Pixel
const DITHER_GLSL = `
float ditherHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 dither(vec3 c) { return c + (ditherHash(gl_FragCoord.xy) - 0.5) / 255.0; }
// für additive Effekte: Rauschen skaliert mit dem Signal -> wo nichts leuchtet, bleibt es exakt schwarz
vec3 ditherAdd(vec3 c) { float k = clamp(max(c.r, max(c.g, c.b)) * 255.0, 0.0, 1.0); return max(c + (ditherHash(gl_FragCoord.xy) - 0.5) / 255.0 * k, 0.0); }`;

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
uniform float uAurora;      // Intensität der Aurora (0 = aus, nur Nebelverlauf)
const vec3 SHAFT_DIR = vec3(0.3216, 0.9191, 0.1379);   // = normalize(0.35, 1, 0.15), Richtung der Lichtstrahlen
vec3 skyColor(vec3 dir, float hue) {
  float up = dir.y;
  // Schleier parallel zu den Lichtstrahlen: Muster hängt nur vom Winkel um die Strahlrichtung ab
  // -> in jeder Blickrichtung dieselbe Schräge (Linien laufen wie parallele Strahlen auf ihren Fluchtpunkt zu)
  vec3 bx = normalize(cross(SHAFT_DIR, vec3(0.0, 0.0, 1.0)));
  vec3 by = cross(SHAFT_DIR, bx);
  float ang = atan(dot(dir, bx), dot(dir, by));
  float curtain = 0.55 + 0.45 * sin(ang * 6.0 + uTime * 0.05 + sin(ang * 5.0 + uTime * 0.03) * 1.5);
  curtain *= 0.6 + 0.4 * sin(ang * 21.0 - uTime * 0.08 + sin(ang * 11.0) * 2.0);
  curtain = pow(max(curtain, 0.0), 1.4);
  // nur über dem Horizont und etwas höher; zum Pol hin weich aus (dort liefen die Linien zusammen)
  float band = smoothstep(-0.02, 0.12, up) * (1.0 - smoothstep(0.18, 0.55, up)) * (1.0 - smoothstep(0.6, 0.85, dot(dir, SHAFT_DIR)));
  vec3 aur = mix(hueShift(AUR_LOW, hue), hueShift(AUR_HIGH, hue), smoothstep(0.05, 0.5, up));
  float on = min(uAurora, 1.0);
  vec3 col = hueShift(FOG, hue) * (1.0 + 0.4 * smoothstep(0.0, 0.5, up) * (1.0 - on)) + aur * curtain * band * 0.95 * uAurora;
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
${DITHER_GLSL}
void main() {
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - uCam);
  o = vec4(dither(skyColor(dir, uHue)), 1.0);
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
uniform float uGrain;       // Körnung als Bump (zeigt Bewegung besser)
uniform float uLines;       // leuchtende Höhenlinien
uniform float uFresnel;     // dezenter Fresnel-Saum in Szenenfarbe (0 = aus)
uniform float uSpecRough;   // Rauheit der Licht-Glanzflecken (0 = scharf, 1 = breit)
in vec3 vWorld;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
${TERRAIN_GLSL}
${SKY_GLSL}
${NOISE_GLSL}
${DITHER_GLSL}

// weiche Marmorierung (wie die Bodentextur der Referenz)
float marble(vec2 p) {
  float n = sin(p.x * 0.9 + sin(p.y * 0.7) * 2.0) * 0.5 + sin(p.y * 1.3 + sin(p.x * 1.1) * 1.6) * 0.35
          + sin((p.x + p.y) * 2.7 + sin(p.x * 0.5) * 3.0) * 0.15;
  return 0.5 + 0.5 * n;
}

void main() {
  vec3 n = terrainN(vWorld.xz);
  vec3 v = normalize(uCam - vWorld);
  float dist = length(uCam - vWorld);
  // feine Körnung als Bump: lässt Glanzlichter funkeln, nimmt mit der Entfernung ab (kein Flimmern)
  if (uGrain > 0.0) {
    vec2 q = vWorld.xz * 140.0;
    float e = 0.5;
    float gx = vnoise(q + vec2(e, 0.0)) - vnoise(q - vec2(e, 0.0));
    float gz = vnoise(q + vec2(0.0, e)) - vnoise(q - vec2(0.0, e));
    n = normalize(n + vec3(gx, 0.0, gz) * uGrain * 0.35 * (1.0 - smoothstep(3.0, 10.0, dist)));
  }
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float m = marble(vWorld.xz);
  vec3 col = vec3(0.006, 0.003, 0.01) * (0.6 + 0.8 * m);
  // Fake-Spiegelung des Himmels (Glanz an flachen Blickwinkeln)
  vec3 r = reflect(-v, n);
  col += skyColor(r, uHue) * (0.02 + fres * 0.55);

  // Innenlichter der Kugeln: diffuses Kontaktlicht + glänzender Lichtstreif zur Kamera (Fake-Spiegelung)
  float specExp = mix(60.0, 3.0, uSpecRough);
  float specNorm = (specExp + 2.0) / 26.0;          // Energie erhalten: breiter = schwächer
  // raue Glanzlichter: Normale zusätzlich mit gröberem Noise streuen
  vec3 rr = r;
  if (uSpecRough > 0.0) {
    vec2 q = vWorld.xz * 18.0;
    rr = normalize(r + vec3(vnoise(q) - 0.5, 0.0, vnoise(q + 7.7) - 0.5) * uSpecRough * 0.35);
  }
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 L = uLightPos[i] - vWorld;
    float d2 = dot(L, L);
    vec3 l = L * inversesqrt(d2);
    // Licht sitzt dicht über dem Boden: weich umgreifendes Kontaktlicht statt reinem Lambert
    float diff = clamp(dot(n, l) * 0.6 + 0.4, 0.0, 1.0) / (1.0 + d2 * 2.2);
    float spec = pow(max(dot(rr, l), 0.0), specExp) * specNorm / (1.0 + d2 * 0.25);
    col += uLightCol[i] * (diff * 0.9 + spec * 0.55 * (0.5 + m));
  }

  // dezenter Fresnel-Saum in Szenenfarbe (Hügelkanten lesbarer)
  col += mix(hueShift(AUR_LOW, uHue), hueShift(AUR_HIGH, uHue), 0.5) * fres * 0.14 * uFresnel;

  // leuchtende Höhenlinien, die langsam nach oben wandern: unregelmäßige Abstände (Höhe per Noise verzogen),
  // jede Linie mit eigener Helligkeit, weich; maskiert mit großem, weichem, wanderndem Noise
  if (uLines > 0.0) {
    vec2 mp = vWorld.xz;
    float warp = vnoise(mp * 0.07 + 3.1) * 1.6 + vnoise(mp * 0.19 - 1.7) * 0.6;
    float hl = (vWorld.y + warp) * 9.0 - uTime * 0.5;
    float w = fwidth(hl);
    float id = floor(hl + 0.5);
    float bright = 0.25 + 0.75 * hash12(vec2(id * 0.137, 4.7));          // Helligkeit je Linie
    float width = 0.08 + 0.12 * hash12(vec2(id * 0.311, 9.1));           // Breite je Linie
    float line = (1.0 - smoothstep(0.0, w * 2.0 + width, abs(fract(hl) - 0.5) - 0.0)) * bright;
    float mask = vnoise(mp * 0.08 + vec2(uTime * 0.015, -uTime * 0.01)) * 0.65 + vnoise(mp * 0.21 - uTime * 0.025) * 0.35;
    mask = smoothstep(0.45, 0.85, mask);
    col += hueShift(GLOW, uHue) * line * mask * uLines * 0.12 * (1.0 - smoothstep(10.0, 30.0, dist));
  }

  // Höhennebel: am Boden am dichtesten, in der Szenenfarbe
  float hFactor = exp(-max(vWorld.y + 1.5, 0.0) * 0.45);
  float fog = 1.0 - exp(-dist * uFogDensity * (0.6 + 1.4 * hFactor));
  col = mix(col, hueShift(FOG, uHue), clamp(fog, 0.0, 1.0));
  // ganz außen vollständig im Nebel (kein Rand des Geländes sichtbar)
  col = mix(col, hueShift(FOG, uHue), smoothstep(36.0, 52.0, dist));
  o = vec4(dither(col), 1.0);
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

// Glasmurmel: im Fragment-Shader verfolgt – Brechung an der Oberfläche (IOR), Ripples von der Rückseite
// (wo der Warp-Antrieb austritt), 0–3 eingeschlossene Schalen mit Julia-Mustern (versetzte Evolution, drehen
// mit der Kugel), Innenlicht, Austritt + Hintergrund-Näherung, Roughness macht alles dahinter/darin weicher.
// Nur Vorderseiten werden gezeichnet (behebt das gelegentlich sichtbare Innere).
export const ballFS = `#version 300 es
precision highp float;
uniform vec3 uCam;
uniform vec3 uPos;
uniform float uR;
uniform float uHue;
uniform float uLight;      // Innenlicht
uniform float uIOR;        // Brechungsindex
uniform float uRough;      // 0 = klar, 1 = milchig
uniform float uFresnel;    // dezenter Fresnel-Saum in Szenenfarbe (wie beim Boden)
uniform int uLayers;       // eingeschlossene Schalen 0..3
uniform float uShellScale; // Größe der Schalen
uniform mat3 uShellRot[3]; // eigene Drehung je Schale (kleinere drehen schneller)
uniform vec3 uEmit;        // Richtung der Ripple-Quelle (hinten, Welt)
uniform float uRipple;     // Ripple-Stärke (bereits mit Ausklingzeit geglättet)
uniform float uRipFreq;    // Ripple-Frequenz
in vec3 vObj;
in vec3 vN;
in vec3 vWorld;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
${SKY_GLSL}
${DITHER_GLSL}
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
float julia(vec2 z, vec2 c) {
  for (int i = 0; i < 22; i++) {
    z = cmul(z, z) + c;
    float m = dot(z, z);
    if (m > 64.0) return (float(i) + 1.0 - log2(log2(m) * 0.5)) / 22.0;
  }
  return 1.0;
}
float shellRadius(int k) { return min((0.8 - float(k) * 0.22) * uShellScale, 0.95); }
// gravurartige Wirbel-Linien entlang der Julia-Höhenstufen
float shell(vec3 q, float k, float soft) {
  vec2 z = q.xz / (1.0 + abs(q.y)) * (1.5 + 0.3 * k);
  float a = 3.1 + 1.4 * sin(uTime * 0.07 + k * 2.1);
  float t = julia(z, 0.7885 * vec2(cos(a), sin(a)));
  float w = 0.06 + soft * 0.18;
  float lines = 1.0 - smoothstep(0.0, w, abs(fract(t * 3.0 + k * 0.33) - 0.5));
  return lines * smoothstep(0.08, 0.25, t) * (1.0 - soft * 0.4);
}
vec3 background(vec3 d, float soft) {
  vec3 g = hueShift(FOG, uHue) * 0.6 + hueShift(GLOW, uHue) * 0.1 * uLight;   // Boden mit Lichtpfütze
  vec3 b = d.y < -0.02 ? g : skyColor(d, uHue);
  return mix(b, hueShift(FOG, uHue) * 1.4, soft * 0.5);
}
// Ein Strahl durch die Murmel: Eintritt (gebrochen), Schalen, Innenlicht, Austritt -> Farbe hinter der Oberfläche
vec3 traceInside(vec3 v, vec3 nr, float soft) {
  vec3 rd = refract(-v, nr, 1.0 / uIOR);
  if (dot(rd, rd) < 0.5) rd = reflect(-v, nr);
  rd = normalize(rd);
  vec3 ro = (vWorld - uPos) / uR;          // Einheitskugel, Weltausrichtung
  vec3 acc = vec3(0.0);
  float trans = 1.0;
  for (int k = 0; k < 3; k++) {
    if (k >= uLayers) break;
    float rk = shellRadius(k);
    float b = dot(ro, rd), h = b * b - (dot(ro, ro) - rk * rk);
    if (h <= 0.0) continue;
    float t = -b - sqrt(h);
    if (t <= 0.0) continue;
    vec3 q = transpose(uShellRot[k]) * normalize(ro + rd * t);   // in die Drehung dieser Schale
    float pat = shell(q, float(k), soft);
    acc += trans * hueShift(GLOW, uHue + float(k) * 0.3) * pat * (0.55 - float(k) * 0.12);
    trans *= 1.0 - pat * 0.4;
  }
  float tc = max(-dot(ro, rd), 0.0);
  float dmin = length(ro + rd * tc);
  acc += trans * hueShift(GLOW, uHue) * uLight * exp(-dmin * dmin * 9.0) * 0.8 * (1.0 - soft * 0.3);
  float b2 = dot(ro, rd);
  float t2 = -b2 + sqrt(max(b2 * b2 - (dot(ro, ro) - 1.0), 0.0));
  vec3 pe = ro + rd * t2;
  vec3 od = refract(rd, -normalize(pe), uIOR);
  if (dot(od, od) < 0.5) od = reflect(rd, -normalize(pe));
  acc += trans * background(normalize(od), soft) * 0.35;
  return acc;
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vWorld);
  if (dot(n, v) < 0.0) discard;

  // Ripples: laufen von der Quelle hinten über die Oberfläche
  float c = clamp(dot(n, uEmit), -1.0, 1.0);
  float th = acos(c);
  float ph = th * uRipFreq - uTime * 9.0;
  float env = exp(-th * 2.4) * uRipple;
  float dh = (cos(ph) * uRipFreq - 2.4 * sin(ph)) * env;
  vec3 g = c * n - uEmit;
  float gl = length(g);
  vec3 nr = gl > 1e-4 ? normalize(n - g / gl * dh * 0.012 * 14.0 / uRipFreq) : n;

  float f0 = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0);
  vec3 inside = traceInside(v, nr, uRough);
  vec3 refl = skyColor(reflect(-v, nr), uHue);
  float F = f0 + (1.0 - f0) * pow(1.0 - max(dot(nr, v), 0.0), 5.0);
  vec3 col = mix(inside, refl * 0.7, clamp(F, 0.0, 1.0));
  vec3 l = normalize(vec3(-0.3, 0.9, 0.2));
  col += vec3(1.0, 0.85, 0.95) * pow(max(dot(reflect(-v, nr), l), 0.0), mix(80.0, 12.0, uRough)) * 0.3 * (1.0 - uRough * 0.6);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += mix(hueShift(AUR_LOW, uHue), hueShift(AUR_HIGH, uHue), 0.5) * rim * 0.35 * uFresnel;
  o = vec4(dither(col), 1.0);
}`;

// Begleitkugeln: leuchtende Kugel (Lavendel), innen am hellsten, zum Rand sanft in den Glow-Farbton
export const compFS = `#version 300 es
precision highp float;
uniform vec3 uCam;
uniform float uHue;
uniform float uBright;   // Helligkeit je Begleiter (inkl. Schnurr-Vibration)
in vec3 vObj;
in vec3 vN;
in vec3 vWorld;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vWorld);
  float nv = dot(n, v);
  if (nv < 0.0) discard;
  // Helligkeit ohne Vergrauen: gedimmt wird der weißliche Kern schwächer und die Farbe satter,
  // heller wird der Kern größer (Licht statt grauer Abdunklung)
  float b = uBright;
  vec3 rim = hueShift(GLOW, uHue) * 0.75;
  vec3 core = hueShift(vec3(0.82, 0.68, 1.0), uHue) * 1.25;
  float coreAmt = pow(nv, mix(2.5, 0.6, clamp(b * 0.5, 0.0, 1.0))) * clamp(0.35 + 0.65 * b, 0.0, 1.0);
  vec3 c = mix(rim, core, coreAmt) * (0.85 + 0.15 * nv);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = max(mix(vec3(l), c, 1.0 + 0.6 * clamp(1.0 - b, 0.0, 1.0)), 0.0);   // Sättigung beim Dimmen anheben
  o = vec4(c * b, 1.0);
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
uniform float uGlitter;    // 1 = funkelnde Pfad-Partikel
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
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * seed) * uPxScale / max(-vp.z, 0.05), 1.5, 24.0);
  // Glitzern: meist gedämpft, kurze helle Aufblitzer (zufällige Phase und Tempo je Partikel)
  float tw = 0.5 + 0.5 * sin(uTime * (1.5 + seed * 5.0) + seed * 40.0);
  if (uGlitter > 0.5) tw = 0.4 + 2.4 * pow(tw, 12.0);
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
  float a = exp(-r * r * 9.0) * (1.0 - smoothstep(0.85, 1.0, r));   // schärfer, sauber auf 0 am Rand
  o = vec4(vCol * vA * a, 1.0);
}`;

// ---------- Warp-Ringe: dünn, dezent, wie ein Tunnel hinter der Kugel ----------
export const ringVS = `#version 300 es
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenter;
uniform vec3 uU;
uniform vec3 uV;
out vec2 vUv;
out vec3 vWorld;
void main() {
  int c = gl_VertexID;
  vec2 q = vec2((c == 1 || c == 2 || c == 4) ? 1.0 : -1.0, (c == 2 || c == 4 || c == 5) ? 1.0 : -1.0);
  vUv = q;
  vWorld = uCenter + uU * q.x + uV * q.y;
  gl_Position = uProj * uView * vec4(vWorld, 1.0);
}`;

export const ringFS = `#version 300 es
precision mediump float;
uniform vec3 uColor;
uniform float uAlpha;
in vec2 vUv;
in vec3 vWorld;
out vec4 o;
${TERRAIN_GLSL}
${SOFT_GLSL}
${DITHER_GLSL}
void main() {
  float d = length(vUv);
  float a = exp(-pow((d - 0.92) / 0.018, 2.0)) + 0.25 * exp(-pow((d - 0.9) / 0.07, 2.0));
  o = vec4(ditherAdd(uColor * a * uAlpha * softFade(vWorld, 0.2)), 1.0);
}`;

// ---------- Ribbon-Schweif ----------
export const ribbonVS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aData;
uniform mat4 uProj;
uniform mat4 uView;
out vec2 vData;
out vec3 vWorld;
void main() { vData = aData; vWorld = aPos; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;

export const ribbonFS = `#version 300 es
precision mediump float;
uniform vec3 uColor;
in vec2 vData;
in vec3 vWorld;
out vec4 o;
${TERRAIN_GLSL}
${SOFT_GLSL}
${DITHER_GLSL}
void main() {
  float side = 1.0 - vData.y * vData.y;
  o = vec4(ditherAdd(uColor * vData.x * side * side * softFade(vWorld, 0.3)), 1.0);
}`;

// ---------- Leucht-Sprites: Goals und Halos der Kugeln ----------
export const glowVS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aData;     // (Größe m, Farbton, Helligkeit, Halo-Anteil)
uniform mat4 uProj;
uniform mat4 uView;
uniform float uPxScale;
out vec3 vCol;
out float vHalo;
out vec3 vCenter;
out float vRad;
${COLOR_GLSL}
${BASE_GLSL}
void main() {
  vec4 vp = uView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  float px = aData.x * uPxScale / max(-vp.z, 0.05);
  gl_PointSize = clamp(px, 2.0, 512.0);
  vCenter = aPos;
  vRad = aData.x * 0.5 * gl_PointSize / max(px, 1e-3);   // Weltradius des tatsächlich gezeichneten Sprites
  vCol = hueShift(mix(GLOW, vec3(1.0, 0.85, 1.0), 0.3), aData.y) * aData.z;
  vHalo = aData.w;
}`;

export const glowFS = `#version 300 es
precision mediump float;
uniform vec3 uRight;     // Kamera-Rechts/Oben in Welt (für die Position jedes Sprite-Pixels)
uniform vec3 uUp;
in vec3 vCol;
in float vHalo;
in vec3 vCenter;
in float vRad;
out vec4 o;
${TERRAIN_GLSL}
${SOFT_GLSL}
void main() {
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r = length(pc);
  float core = exp(-r * r * 40.0);
  float halo = exp(-r * r * 5.0) * vHalo;
  vec3 p = vCenter + (uRight * pc.x - uUp * pc.y) * vRad;
  o = vec4(vCol * (core * 1.4 + halo) * (1.0 - smoothstep(0.9, 1.0, r)) * softFade(p, vRad * 0.6 + 0.05), 1.0);
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
out vec3 vWorld;
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
  float flap = sin(uFlap - fk * 0.35) * 0.55 * uOpen;   // schneller Kolibri-Schlag, große Amplitude
  vec3 dir = normalize(right * side * cos(spread) + up * (sin(spread) * 0.5 + flap) - uFwd * fk * 0.6);
  float len = uSpan * uOpen * mix(1.0, 0.55, fk);
  vec3 width = normalize(cross(dir, up)) * 0.1 * uOpen * (1.0 - q.x * 0.6);
  vec3 root = uPos + right * side * uRootR + up * 0.05;
  vec3 w = root + dir * len * q.x + width * q.y;
  vUv = q;
  vK = fk;
  vWorld = w;
  gl_Position = uProj * uView * vec4(w, 1.0);
}`;

export const wingFS = `#version 300 es
precision highp float;
uniform float uHue;
uniform float uTime;
uniform float uOpen;
in vec2 vUv;
in float vK;
in vec3 vWorld;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
${TERRAIN_GLSL}
${SOFT_GLSL}
${DITHER_GLSL}
void main() {
  float edge = 1.0 - vUv.y * vUv.y;
  float a = edge * (0.35 + 0.65 * vUv.x) * (1.0 - vUv.x * 0.5) * uOpen * (0.6 + 0.4 * (1.0 - vK));
  // chromatisch: Farbton läuft schnell über Federn und Länge (wie schillernde Kolibri-Federn)
  vec3 col = hueShift(GLOW, uHue + uTime * 2.2 + vK * 2.4 + vUv.x * 1.3);
  o = vec4(ditherAdd(col * a * 0.8 * softFade(vWorld, 0.12)), 1.0);
}`;

// ---------- Atmosphärische Lichtstrahlen (wie gestreute Planes in Unreal) ----------
// Zustandsloses Raster um den Spieler: je Zelle entscheidet ein Hash, ob dort ein Strahl steht.
// Jeder Strahl = schräges Band, um seine Achse zur Kamera gedreht (zylindrisches Billboard), additiv.
export const shaftVS = `#version 300 es
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCam;
uniform vec2 uCenter;     // Rasterzentrum (Welt xz, auf Zellen gerastet)
uniform float uCell;      // Zellgröße (m)
uniform int uGrid;        // Zellen je Seite
uniform float uTime;
uniform vec2 uPlayer;     // ungerastete Spielerposition (für weiches Ein-/Ausblenden)
uniform vec2 uFade;       // Abstand: Beginn / Ende des Ausblendens
out vec2 vUv;
out vec3 vWorld;
out float vSeed;
out float vOn;
${TERRAIN_GLSL}
float h1(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  int id = gl_VertexID;
  int q = id / 6, c = id - q * 6;
  int gx = q - (q / uGrid) * uGrid, gz = q / uGrid;
  vec2 cellId = floor(uCenter / uCell) + vec2(float(gx - uGrid / 2), float(gz - uGrid / 2));
  float s0 = h1(cellId * 1.37 + 0.5), s1 = h1(cellId * 2.11 + 7.3), s2 = h1(cellId * 0.71 + 3.9);
  vOn = s0 < 0.62 ? 1.0 : 0.0;
  vSeed = s1;
  vec2 corner = vec2((c == 1 || c == 2 || c == 4) ? 1.0 : -1.0, (c == 2 || c == 4 || c == 5) ? 1.0 : 0.0);
  vec2 bxz = (cellId + vec2(s1, s2)) * uCell;
  // ganzer Strahl blendet weich ein/aus, lange bevor seine Zelle das Raster verlässt -> kein Aufpoppen
  vOn *= 1.0 - smoothstep(uFade.x, uFade.y, length(bxz - uPlayer));
  vec3 base = vec3(bxz.x, terrainH(bxz) - 1.5, bxz.y);
  vec3 axis = normalize(vec3(0.35 + (s2 - 0.5) * 0.15, 1.0, 0.15 + (s1 - 0.5) * 0.15));  // alle etwa gleich schräg (eine Lichtquelle)
  float len = 16.0 + 14.0 * s2;
  float wid = 1.2 + 2.8 * h1(cellId * 3.3);
  vec3 mid = base + axis * len * 0.5;
  vec3 side = normalize(cross(axis, uCam - mid));
  vec3 w = base + axis * len * corner.y + side * wid * corner.x;
  vUv = corner;
  vWorld = w;
  gl_Position = vOn > 0.001 ? uProj * uView * vec4(w, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

export const shaftFS = `#version 300 es
precision highp float;
uniform vec3 uCam;
uniform float uTime;
uniform float uHue;
uniform float uIntensity;
in vec2 vUv;
in vec3 vWorld;
in float vSeed;
in float vOn;
out vec4 o;
${COLOR_GLSL}
${BASE_GLSL}
${TERRAIN_GLSL}
${NOISE_GLSL}
${DITHER_GLSL}
void main() {
  float x2 = vUv.x * vUv.x;
  float across = exp(-x2 * 3.5) * (1.0 - x2) * (1.0 - x2);               // weich quer zum Strahl, am Rand exakt 0
  float along = smoothstep(0.0, 0.25, vUv.y) * pow(1.0 - vUv.y, 1.6);      // oben weich auslaufend
  float ground = smoothstep(0.0, 3.0, vWorld.y - terrainH(vWorld.xz));     // Nähe-Maske: unten zum Boden ausblenden
  float d = length(vWorld - uCam);
  float camFade = smoothstep(3.0, 11.0, d);                                // zur Kamera hin ausblenden
  float pulse = 0.55 + 0.45 * sin(uTime * (0.08 + vSeed * 0.07) + vSeed * 40.0);
  float streak = 0.6 + 0.4 * vnoise(vec2(vUv.x * 2.5 + vSeed * 9.0, vUv.y * 2.0 - uTime * 0.05));
  vec3 col = hueShift(mix(AUR_LOW, AUR_HIGH, vUv.y * 0.8), uHue);
  float a = across * along * ground * camFade * vOn * pulse * streak * uIntensity * 4.0;
  o = vec4(ditherAdd(col * a), 1.0);
}`;

// ---------- Bloom (Post-Effekt auf die ganze Szene) ----------
export const postVS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Gemeinsam: Pixel -> UV, auf das Augen-Rechteck begrenzt (kein Überlauf ins andere Auge)
const POST_GLSL = `
uniform vec2 uDstSize;
uniform vec4 uBounds;   // min.xy, max.xy (UV der Quelle)
vec2 dstUv() { return gl_FragCoord.xy / uDstSize; }
vec2 clampUv(vec2 uv) { return clamp(uv, uBounds.xy, uBounds.zw); }`;

export const brightFS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSrcTexel;
uniform float uThreshold;
out vec4 o;
${POST_GLSL}
void main() {
  vec2 uv = dstUv();
  vec3 c = vec3(0.0);
  c += texture(uTex, clampUv(uv + uSrcTexel * vec2(-1.0, -1.0))).rgb;
  c += texture(uTex, clampUv(uv + uSrcTexel * vec2( 1.0, -1.0))).rgb;
  c += texture(uTex, clampUv(uv + uSrcTexel * vec2(-1.0,  1.0))).rgb;
  c += texture(uTex, clampUv(uv + uSrcTexel * vec2( 1.0,  1.0))).rgb;
  c *= 0.25;
  float b = max(max(c.r, c.g), c.b);
  float k = smoothstep(uThreshold * 0.5, uThreshold * 2.0 + 0.05, b);   // weicher Knick statt harter Schwelle
  o = vec4(c * k, 1.0);
}`;

export const blurFS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;     // Abstand der Abtastpunkte (UV)
out vec4 o;
${POST_GLSL}
void main() {
  vec2 uv = dstUv();
  vec3 c = texture(uTex, clampUv(uv)).rgb * 0.2270270;
  c += texture(uTex, clampUv(uv + uStep * 1.3846154)).rgb * 0.3162162;
  c += texture(uTex, clampUv(uv - uStep * 1.3846154)).rgb * 0.3162162;
  c += texture(uTex, clampUv(uv + uStep * 3.2307692)).rgb * 0.0702703;
  c += texture(uTex, clampUv(uv - uStep * 3.2307692)).rgb * 0.0702703;
  o = vec4(c, 1.0);
}`;

export const bloomCompFS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uStrength;
out vec4 o;
${POST_GLSL}
${DITHER_GLSL}
void main() {
  vec3 s = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 b = texture(uBloom, clampUv(dstUv())).rgb;
  o = vec4(max(dither(s + b * uStrength), 0.0), 1.0);
}`;

// ---------- Magische Umgebungspartikel: steigen vom Boden auf, nur in Kameranähe ----------
// Zustandslos: jede ID hat eine weltfeste Position in einem um die Kamera mitwandernden Würfel (Kachel-Wrap).
// Weltfest -> beim Durchfahren ziehen sie vorbei und zeigen das Tempo. Am Würfelrand ausgeblendet (kein sichtbares Umspringen).
export const moteVS = `#version 300 es
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCam;
uniform float uTime;
uniform float uHue;
uniform float uBox;        // Kantenlänge des Bereichs (m)
uniform float uPxScale;
uniform float uSize;
uniform float uBright;
out float vA;
out vec3 vCol;
${COLOR_GLSL}
${BASE_GLSL}
${TERRAIN_GLSL}
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float id = float(gl_VertexID);
  vec3 r = vec3(h1(id + 0.1), h1(id + 7.3), h1(id + 3.7));
  float r4 = h1(id + 11.9);
  // xz weltfest, um die Kamera gewrappt
  vec2 xz = uCam.xz + (fract(r.xy - uCam.xz / uBox) - 0.5) * uBox;
  // langsamer Aufstieg vom Boden, eigene Phase und Tempo, leichtes Schweben seitlich
  float cyc = 5.0 + 6.0 * r4;
  float t = fract(uTime / cyc + r.z);
  float rise = 2.6 * t * (0.6 + 0.4 * r.z);
  xz += vec2(sin(uTime * 0.4 + id), cos(uTime * 0.33 + id * 1.7)) * 0.12 * t;
  vec3 p = vec3(xz.x, terrainH(xz) + 0.02 + rise, xz.y);
  vec4 vp = uView * vec4(p, 1.0);
  gl_Position = uProj * vp;
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * r4) * uPxScale / max(-vp.z, 0.05), 1.5, 10.0);
  float d = length(p - uCam);
  float fade = sin(3.14159 * t)                                      // auf- und abblenden über den Zyklus
             * (1.0 - smoothstep(uBox * 0.28, uBox * 0.46, length(xz - uCam.xz)))   // Rand des Bereichs
             * smoothstep(0.3, 0.9, d);                              // nicht direkt vor dem Auge
  float tw = 0.5 + 0.5 * sin(uTime * (1.5 + r4 * 5.0) + id);
  tw = 0.3 + 2.0 * pow(tw, 10.0);                                     // Glitzern
  vA = fade * tw * uBright;
  vCol = hueShift(mix(GLOW, vec3(1.0, 0.85, 1.0), 0.35), uHue + (r.x - 0.5) * 0.3);
}`;

export const moteFS = `#version 300 es
precision mediump float;
in float vA;
in vec3 vCol;
out vec4 o;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float a = exp(-r * r * 9.0) * (1.0 - smoothstep(0.85, 1.0, r));
  o = vec4(vCol * vA * a, 1.0);
}`;
