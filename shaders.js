// Alle GLSL-Shader (WebGL2 / GLSL ES 3.00)

// ---------- Behälterform (gemeinsam für Simulation, Glow und Sand) ----------
const BOUNDARY_GLSL = `
uniform float uR;       // Umkreisradius des Behälters (UV)
uniform float uShape;   // 0 = Kreis, 3..8 = n-Eck, 100+n = Blüte mit n Blättern
uniform float uLobe;    // Tiefe der Blütenblätter
// Abstand vom Mittelpunkt zum Rand in Richtung th
float boundary(float th) {
  if (uShape < 0.5) return uR;
  if (uShape > 99.0) return uR * (1.0 - uLobe * 0.5 * (1.0 + cos((uShape - 100.0) * th)));
  float seg = 6.2831853 / uShape;
  float a = mod(th - 1.5707963, seg) - seg * 0.5;   // eine Ecke zeigt nach oben
  return uR * cos(3.14159265 / uShape) / cos(a);
}
// 1 im Inneren, weich auf 0 zum Rand hin (c = UV - 0.5)
float edgeFade(vec2 c) {
  float rb = boundary(atan(c.y, c.x));
  return smoothstep(rb, rb * 0.72, length(c));
}`;

// ---------- Wellensimulation ----------
// Zustand in einer RGBA16F-Textur: R = aktuelle Höhe, G = vorherige Höhe,
// B = Hüllkurve (geglättete |Höhe|) -> zeigt Bäuche und Knoten des stehenden Musters (für Sand).
// Diskrete 2D-Wellengleichung in einem Behälter mit festem Rand (h = 0)
// -> Wellen werden an der Peripherie reflektiert und bilden stehende Muster (Cymatics).

export const simVS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const simFS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform float uK;       // c^2 (Wellengeschwindigkeit², stabil bis 0.5)
uniform float uDamp;    // Dämpfung der Geschwindigkeit pro Schritt
uniform float uDrive;   // aktuelle Anregung
uniform vec2  uSrcPos;  // Ort der Anregung (UV), kann dem Blick folgen
uniform float uSrc;     // Radius der Anregungsquelle (UV)
uniform float uEnvK;    // Glättung der Hüllkurve pro Schritt
in vec2 vUv;
out vec4 o;
${BOUNDARY_GLSL}

float H(ivec2 p, ivec2 size) {
  p = clamp(p, ivec2(0), size - 1);
  return texelFetch(uState, p, 0).r;
}

void main() {
  ivec2 size = textureSize(uState, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  float h = s.r, prev = s.g, env = s.b;

  float lap = H(p + ivec2(1, 0), size) + H(p - ivec2(1, 0), size)
            + H(p + ivec2(0, 1), size) + H(p - ivec2(0, 1), size) - 4.0 * h;

  float n = h + (h - prev) * uDamp + uK * lap;

  vec2 ds = vUv - uSrcPos;
  n += uDrive * exp(-dot(ds, ds) / (uSrc * uSrc));

  vec2 c = vUv - 0.5;
  bool outside = length(c) > boundary(atan(c.y, c.x));
  if (outside) n = 0.0;
  env += (abs(h) - env) * uEnvK;
  if (outside) env = 0.0;

  o = vec4(clamp(n, -4.0, 4.0), h, env, 1.0);
}`;

// ---------- Farbe: Hue-Shift (Rotation im YIQ-Farbraum, Helligkeit bleibt) ----------
const COLOR_GLSL = `
vec3 hueShift(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float ca = cos(a), sa = sin(a);
  yiq.yz = mat2(ca, sa, -sa, ca) * yiq.yz;
  return max(toRGB * yiq, 0.0);
}`;

// ---------- Sonne (gemeinsam für Szene und Corona) ----------
const SUN_GLSL = `
uniform float uSunR;
uniform float uSunScale;   // Wachstum beim Summen (federnd nachgezogen)
uniform float uSunWob;     // organische Randverformung
uniform float uClock;      // Echtzeit in s
uniform float uSunHeat;    // 0 = ruhig (rote Abendsonne), 1 = beim Summen voll hell

// Radius der Sonne in Richtung p: Grundgröße * Wachstum * weich wabernder Rand
float sunRadius(vec2 p) {
  float a = atan(p.y, p.x), t = uClock;
  float w = sin(a * 2.0 + t * 0.7) * 0.5 + sin(a * 3.0 - t * 0.5 + 1.7) * 0.3 + sin(a * 5.0 + t * 1.1 + 4.0) * 0.2;
  return uSunR * uSunScale * (1.0 + w * uSunWob);
}

// Wie stark die Scheibe an p deckt (für Partikel hinter der Sonne)
float sunCover(vec2 p) {
  float R = sunRadius(p);
  return 1.0 - smoothstep(R * 0.985, R * 1.01, length(p));
}

vec3 sunDisc(vec2 p, float R) {
  float d = length(p);
  // Kanalweise leicht unterschiedliche Radien/Weichheit -> schmaler Farbsaum
  vec3 radii = R * vec3(1.008, 1.0, 0.992);
  vec3 soft  = R * vec3(0.022, 0.014, 0.010);
  vec3 mask  = 1.0 - smoothstep(radii - soft, radii + soft, vec3(d));
  float rr = pow(clamp(d / R, 0.0, 1.0), 2.5);
  // Ruhe: tiefrote, gedämpfte Abendsonne (wie über der Savanne); Summen: helles Orange-Gelb
  vec3 calm = mix(vec3(0.86, 0.27, 0.07), vec3(0.70, 0.14, 0.04), rr);
  vec3 hot  = mix(vec3(1.0, 0.64, 0.26), vec3(0.97, 0.46, 0.13), rr);
  vec3 col = mix(calm, hot, uSunHeat) * mask;
  float e = max(d - R, 0.0);
  col += mix(vec3(0.45, 0.05, 0.012), vec3(0.55, 0.09, 0.02), uSunHeat) * exp(-e / (R * 0.08)) * 0.3;  // schmaler Saum
  col += mix(vec3(0.15, 0.018, 0.006), vec3(0.22, 0.03, 0.01), uSunHeat) * exp(-e / (R * 1.2));       // weiter Halo
  return col;
}`;


// ---------- Fraktal (Alternative zur Sonne) ----------
// Wird pro Frame in drei Texturen gerendert (Tiefenebenen: aktuelle Form + zwei
// zeitlich verzögerte "Echos" dahinter). Gespeichert vormultipliziert: rgb*a, a = Helligkeit.
// Farbe = Sonnenpalette, danach Hue-Shift nach Tonhöhe.
export const fracFS = `#version 300 es
precision highp float;
uniform float uType;     // 0 Julia, 1 Burning Ship, 2 Tricorn, 3 Kaliset, 4 Mandala
uniform float uMorph;    // integrierte Entwicklungszeit (schneller beim Summen)
uniform float uScale;    // Meter pro Fraktal-Einheit
uniform float uExtent;   // halbe Kantenlänge der Textur (m)
uniform float uR;        // ungefährer Radius des Objekts (m) für die Randblende
uniform int   uIter;
uniform float uHue;
uniform float uFade;     // Deckkraft dieser Ebene
uniform float uSat;      // Sättigung dieser Ebene (Echos kräftiger -> kein Grauschleier)
uniform float uHueOff;   // zusätzlicher Farbton-Versatz dieser Ebene
uniform float uInner;    // Innenflächen: 0 = hell, 1 = hohl (dunkel), 2 = Struktur (Orbit-Trap)
in vec2 vUv;
out vec4 o;
${COLOR_GLSL}

// Sonnenpalette: dunkelrot -> rot -> orange -> hellgelb
vec3 palette(float t) {
  vec3 c = mix(vec3(0.07, 0.012, 0.006), vec3(0.55, 0.09, 0.02), smoothstep(0.0, 0.3, t));
  c = mix(c, vec3(0.97, 0.46, 0.13), smoothstep(0.25, 0.65, t));
  c = mix(c, vec3(1.0, 0.72, 0.36), smoothstep(0.6, 1.0, t));
  return c;
}

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

vec2 phoenixP = vec2(0.0);   // Phoenix: Anteil des vorletzten Werts

// Escape-Time mit weicher Iterationszahl.
// Punkte, die nie entkommen (Innenflächen), würden sonst als große helle Flächen erscheinen:
// je nach uInner hell, dunkel oder mit Orbit-Trap-Strukturen gefüllt.
float escape(vec2 z, vec2 c, int mode, float norm) {
  float trap = 1e9;
  vec2 zp = vec2(0.0);
  for (int i = 0; i < 256; i++) {
    if (i >= uIter) break;
    if (mode == 2) z.y = -z.y;
    vec2 zn = cmul(z, z) + c;
    if (mode == 1) zn += cmul(phoenixP, zp);
    zp = z;
    z = zn;
    trap = min(trap, abs(length(z) - 0.6));
    float m = dot(z, z);
    if (m > 256.0) {
      float nu = float(i) + 1.0 - log2(log2(m) * 0.5);
      // auf max. "norm" normiert: feine Außenstrukturen leuchten sichtbar, auch bei vielen Iterationen
      return clamp(nu / min(float(uIter), norm), 0.0, 1.0);
    }
  }
  if (uInner < 0.5) return 1.0;
  if (uInner < 1.5) return 0.1;
  return 0.06 + 0.8 * exp(-trap * 16.0);    // dunkle Fläche mit leuchtenden Bahnen
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uExtent;      // Meter auf der Ebene
  vec2 z = p / uScale;
  float m = uMorph;
  float t;

  if (uType < 0.5) {                          // Julia: c wandert auf dem klassischen Kreis
    // Winkel pendelt im Bereich mit sichtbaren Strukturen (vermeidet fast leere Phasen)
    float a = 3.1 + 1.45 * sin(m * 0.12) + 0.15 * sin(m * 0.31);
    t = escape(z, 0.7885 * vec2(cos(a), sin(a)), 0, 48.0);
  } else if (uType < 1.5) {                   // Phoenix: z = z² + c + p·z(n-1) -> klare, federartige Formen
    float a = 1.85 + 0.3 * sin(m * 0.2) + 0.08 * sin(m * 0.53);
    vec2 c = vec2(0.5667 + 0.1 * cos(a), 0.0);
    phoenixP = vec2(-0.5 + 0.1 * sin(a), 0.0);
    t = escape(vec2(-z.y, z.x) * 0.9, c, 1, 48.0);
  } else if (uType < 2.5) {                   // Tricorn (Mandelbar-Julia)
    float a = 1.25 + 0.55 * sin(m * 0.19) + 0.2 * sin(m * 0.07);
    vec2 c = 0.63 * vec2(cos(a), sin(a));
    t = escape(z, c, 2, 48.0);
  } else if (uType < 3.5) {                   // Kaliset: z = |z|/|z|² - c, Orbit-Akkumulation
    vec2 c = vec2(0.56, 0.47) + 0.06 * vec2(sin(m * 0.13), cos(m * 0.1));
    vec2 q = z * 0.75;
    float acc = 0.0, prev = 0.0;
    int n = max(uIter / 3, 2);
    for (int i = 0; i < 64; i++) {
      if (i >= n) break;
      q = abs(q) / dot(q, q) - c;
      float d = dot(q, q);
      acc += exp(-4.0 * abs(d - prev));
      prev = d;
    }
    t = clamp(acc / float(n) * 2.6, 0.0, 1.0);
    t *= 1.0 - smoothstep(0.9, 1.6, length(z));   // unendliches Muster -> zur Mitte bündeln
  } else {                                    // Mandala: 8-fach gefaltete Julia-Menge
    float seg = 6.2831853 / 8.0;
    float ang = atan(z.y, z.x);
    ang = abs(mod(ang, seg) - seg * 0.5);
    vec2 zf = length(z) * vec2(cos(ang), sin(ang));
    float a = 3.3 + 0.8 * sin(m * 0.15) + 0.1 * sin(m * 0.41);
    t = escape(zf * 1.2, 0.7885 * vec2(cos(a), sin(a)), 0, 48.0);
  }

  // Helligkeit -> Farbe und Deckkraft
  float b = pow(t, 0.75);
  vec3 col = hueShift(palette(b), uHue + uHueOff);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = max(mix(vec3(luma), col, uSat), 0.0);
  float a = smoothstep(0.12, 0.7, b) * uFade;
  a *= 1.0 - smoothstep(uR * 1.5, uR * 2.4, length(p));  // weich ausblenden
  o = vec4(col * a, a);
}`;

// ---------- Szene ----------
// Ein großes Quad im Raum = die transparente Wasserebene.
// Die Sonne liegt "dahinter" (uDepth Meter). Pro Pixel: Sichtstrahl -> an der Wasseroberfläche
// gebrochen -> trifft die Sonnenebene. Die Corona liegt in drei Tiefenebenen
// (vor, auf und hinter der Sonnenebene) -> echte Parallaxe in VR.

export const sceneVS = `#version 300 es
in vec2 aPos;           // lokale Position in Metern
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenter;   // Mittelpunkt der Wasserebene in Weltkoordinaten
out vec3 vWorld;
out vec2 vLocal;
void main() {
  vec3 w = uCenter + vec3(aPos, 0.0);
  vWorld = w;
  vLocal = aPos;
  gl_Position = uProj * uView * vec4(w, 1.0);
}`;

export const sceneFS = `#version 300 es
precision highp float;
uniform sampler2D uWave;
uniform vec3  uCam;       // Augenposition
uniform float uWaterR;    // Radius des Wasserbehälters (m)
uniform float uDepth;     // Abstand Wasser -> Sonnenebene (m)
uniform float uBump;      // Stärke der Oberflächen-Normalen
uniform float uTexel;     // 1 / Simulationsauflösung
uniform float uHalf;      // halbe Kantenlänge des Quads (m)
uniform sampler2D uPart0; // Corona vor der Sonne
uniform sampler2D uPart1; // Corona auf der Sonnenebene
uniform sampler2D uPart2; // Corona hinter der Sonne
uniform vec3  uLayerOff;  // Tiefenversatz der drei Ebenen relativ zur Sonnenebene (m)
uniform float uExtent;    // halbe Kantenlänge der Partikeltexturen (m)
uniform float uMode;      // 0 = Sonne, 1 = Fraktal
uniform highp sampler2DArray uFracArr; // Fraktal-Ebenen: 0 = aktuelle Form, 1.. = Echos dahinter
uniform float uFracCount; // Anzahl der Fraktal-Ebenen
uniform float uFracOff;   // Abstand der Fraktal-Ebenen (m)
uniform float uHue;       // Farbton-Verschiebung des Fraktals
uniform float uIOR;       // Brechungsindex des Wassers
uniform float uGlow;      // Leuchten der Wellenberge/-täler (0 = aus)
uniform float uSkipMain;  // 1 = innerste Fraktal-Ebene wird als Mesh gezeichnet (nicht hier)
uniform float uReliefBlur; // Weichzeichnung der Relief-Höhenkarte (Mipmap-Stufe)
uniform float uBlend;     // Mischmodus der Fraktal-Ebenen: 0 Normal, 1 Additiv, 2 Screen, 3 Difference, 4 Aufhellen
uniform float uRelief;    // Relief-Tiefe (m), 0 = aus
uniform float uReliefSteps; // Abtastschritte des Reliefs
uniform float uFracRad;   // Radius, außerhalb dessen kein Relief berechnet wird (m)
uniform float uGrain;     // Stärke des Hintergrund-Korns (0 = aus)
uniform float uGrainSize; // Korngröße
uniform float uGrainT;    // integrierte Animationszeit
uniform float uGrainLayers; // Anzahl Tiefenebenen 1..3
uniform float uGrainDepth;  // Abstand der Ebenen (m)
in vec3 vWorld;
in vec2 vLocal;
out vec4 o;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

${SUN_GLSL}
${COLOR_GLSL}
${BOUNDARY_GLSL}

vec3 ground(vec2 p) {
  return vec3(0.07, 0.012, 0.006);   // dunkelroter Grund (Korn kommt separat in Ebenen dazu)
}

vec3 blendLayer(vec3 base, vec4 l) {
  if (uBlend < 0.5) return base * (1.0 - l.a) + l.rgb;                 // Normal
  if (uBlend < 1.5) return base + l.rgb;                               // Additiv
  if (uBlend < 2.5) return 1.0 - (1.0 - clamp(base, 0.0, 1.0)) * (1.0 - l.rgb);  // Screen
  if (uBlend < 3.5) return abs(base - l.rgb);                          // Difference
  return max(base, l.rgb);                                             // Aufhellen
}

vec2 fracUV(vec2 p) { return p / (2.0 * uExtent) + 0.5; }

// Relief per Parallax-Occlusion-Mapping: Helligkeit des Fraktals = Höhe (hell = näher).
// Der gebrochene Strahl wird schrittweise durch die Höhenschicht verfolgt, bis er die Oberfläche trifft.
// Läuft nur, wenn aktiviert und der Strahl in der Nähe des Fraktals ist.
vec2 reliefHit(vec3 rr, vec2 ps, float base, float li, out float shade) {
  shade = 1.0;
  if (uRelief <= 0.0 || length(ps) > uFracRad) return ps;
  float iz = 1.0 / max(-rr.z, 0.05);
  float rel = min(uRelief, base - 0.05);
  float top = base - rel;                       // vorderste mögliche Tiefe
  float n = uReliefSteps;
  float prevD = top, prevGap = -1.0;
  vec2 hit = ps;
  for (int i = 0; i <= 64; i++) {
    if (float(i) > n) break;
    float d = top + rel * float(i) / n;         // aktuelle Strahltiefe
    vec2 p = vLocal + rr.xy * d * iz;
    float h = textureLod(uFracArr, vec3(fracUV(p), li), uReliefBlur).a;
    float gap = d - (base - h * rel);           // >= 0: Strahl ist hinter der Oberfläche
    if (gap >= 0.0) {
      float k = prevGap < 0.0 ? clamp(-prevGap / (gap - prevGap), 0.0, 1.0) : 0.0;
      d = mix(prevD, d, k);
      hit = vLocal + rr.xy * d * iz;
      break;
    }
    prevD = d; prevGap = gap;
  }
  // einfache Beleuchtung aus der Höhen-Steigung
  float e = 2.0 * uExtent / float(textureSize(uFracArr, 0).x) * 2.0;
  e *= exp2(uReliefBlur);
  float hx = textureLod(uFracArr, vec3(fracUV(hit + vec2(e, 0.0)), li), uReliefBlur).a - textureLod(uFracArr, vec3(fracUV(hit - vec2(e, 0.0)), li), uReliefBlur).a;
  float hy = textureLod(uFracArr, vec3(fracUV(hit + vec2(0.0, e)), li), uReliefBlur).a - textureLod(uFracArr, vec3(fracUV(hit - vec2(0.0, e)), li), uReliefBlur).a;
  vec3 nrm = normalize(vec3(-hx, -hy, e * 4.0 / max(rel, 0.01)));
  shade = 0.7 + 0.6 * max(dot(nrm, normalize(vec3(-0.5, 0.7, 0.6))), 0.0);
  return hit;
}

// Animiertes Korn: Zellen driften langsam und funkeln weich (kein hartes Flackern)
float grainLayer(vec2 p, float k) {
  vec2 q = p * 175.0 / uGrainSize * (1.0 + 0.15 * k);
  q += uGrainT * vec2(2.0 + 1.5 * k, 1.2 - 2.0 * k);
  vec2 cell = floor(q);
  float h  = hash(cell + k * 37.0);
  float h2 = hash(cell + 91.7 + k * 13.0);
  float tw = 0.5 + 0.5 * sin(uGrainT * 5.0 + h2 * 6.2831853);
  return (h - 0.5) * (0.4 + 1.2 * tw);
}

vec3 sun(vec2 p) {
  return sunDisc(p, sunRadius(p)) + ground(p);
}

vec4 layer(sampler2D tex, vec3 rr, float depth) {
  float t = depth / max(-rr.z, 0.05);
  vec2 p = vLocal + rr.xy * t;
  return texture(tex, p / (2.0 * uExtent) + 0.5);
}

void main() {
  // --- Wasseroberfläche: Gradient aus der Simulation ---
  vec2 wuv = vLocal / (2.0 * uWaterR) + 0.5;
  float hL = texture(uWave, wuv - vec2(uTexel, 0.0)).r;
  float hR = texture(uWave, wuv + vec2(uTexel, 0.0)).r;
  float hD = texture(uWave, wuv - vec2(0.0, uTexel)).r;
  float hU = texture(uWave, wuv + vec2(0.0, uTexel)).r;
  vec2 grad = vec2(hR - hL, hU - hD) * uBump;
  vec3 n = normalize(vec3(-grad, 1.0));

  // --- Brechung: Strahl durch die Wasserebene auf die Sonnenebene ---
  vec3 ray = normalize(vWorld - uCam);
  vec3 rr  = refract(ray, n, 1.0 / uIOR);
  float t  = uDepth / max(-rr.z, 0.05);
  vec2 ps  = vLocal + rr.xy * t;

  vec3 col;
  float cover;                                   // was die hintere Corona-Ebene verdeckt
  if (uMode < 0.5) {
    col = sun(ps);
    cover = sunCover(ps);
  } else {
    // Fraktal: weiter Glow wie bei der Sonne, im aktuellen Farbton
    col = ground(ps) + hueShift(vec3(0.22, 0.03, 0.01), uHue) * exp(-length(ps) / (1.4 * 1.2));
    // Ebenen symmetrisch um die innerste verteilt (Index 0 = vorne), von hinten nach vorne komponiert.
    // Die innerste Ebene ist die Hauptform (volle Deckkraft, Relief, verdeckt die hintere Corona).
    float center = (uFracCount - 1.0) * 0.5;
    int mainIdx = int(floor(center));
    float iz = 1.0 / max(-rr.z, 0.05);
    cover = 0.0;
    for (int i = 5; i >= 0; i--) {
      if (float(i) >= uFracCount) continue;
      float d = max(uDepth + (float(i) - center) * uFracOff, 0.1);
      vec2 pl = vLocal + rr.xy * (d * iz);
      vec4 f;
      if (i == mainIdx) {
        if (uSkipMain > 0.5) continue;
        float shade;
        pl = reliefHit(rr, pl, d, float(i), shade);
        f = texture(uFracArr, vec3(fracUV(pl), float(i)));
        f.rgb *= shade;
        cover = f.a;
      } else {
        f = texture(uFracArr, vec3(fracUV(pl), float(i)));
      }
      col = blendLayer(col, f);
    }
  }

  // Hintergrund-Korn in bis zu drei Tiefenebenen (hintere Ebenen werden vom Objekt verdeckt)
  if (uGrain > 0.0) {
    float g = 0.0;
    for (int k = 0; k < 3; k++) {
      if (float(k) >= uGrainLayers) break;
      float fk = float(k);
      float d = uDepth + fk * uGrainDepth;
      vec2 pk = vLocal + rr.xy * (d / max(-rr.z, 0.05));
      float w = (k == 0 ? 1.0 : 1.0 - cover) * (1.0 - 0.25 * fk);
      g += grainLayer(pk, fk) * w;
    }
    col += g * uGrain;
  }

  // Corona-Ebenen, von hinten nach vorne "über" die Szene komponiert (vormultipliziert).
  // Die hintere Ebene wird von der Sonnenscheibe verdeckt.
  vec4 back = layer(uPart2, rr, uDepth + uLayerOff.z);
  float vis = 1.0 - cover;
  col = col * (1.0 - min(back.a, 1.0) * vis) + back.rgb * vis;
  vec4 mid = layer(uPart1, rr, uDepth + uLayerOff.y);
  col = col * (1.0 - min(mid.a, 1.0)) + mid.rgb;
  vec4 front = layer(uPart0, rr, uDepth + uLayerOff.x);
  col = col * (1.0 - min(front.a, 1.0)) + front.rgb;

  // --- Schattierung der Wellen ---
  float slope = length(grad);
  col *= 1.0 - clamp(slope * 1.1, 0.0, 0.7);                 // dunkle Ringe
  float lit = dot(n.xy, normalize(vec2(-0.5, 0.8)));
  col += vec3(0.45, 0.10, 0.03) * max(lit, 0.0) * 0.6;        // warme Lichtkanten

  // --- Sanftes Leuchten von Wellenbergen und -tälern, zum Behälterrand hin ausgeblendet ---
  if (uGlow > 0.0) {
    float hc = texture(uWave, wuv).r;
    float g = smoothstep(0.015, 0.35, abs(hc)) * edgeFade(wuv - 0.5);
    col += hueShift(vec3(1.0, 0.45, 0.15), uHue) * g * uGlow;
  }

  // --- Vignette: Quad-Rand verschwindet im Schwarz ---
  col *= smoothstep(uHalf, uHalf * 0.35, length(vLocal));

  o = vec4(col, 1.0);
}`;

// ---------- Corona ----------
// Zustandslose Partikel: Position wird pro Frame aus ID + "Flusszeit" berechnet.
// Gezeichnet in eine Textur pro Tiefenebene; die Textur wird pro Frame nur teilweise
// gelöscht -> kurze Schweife. Die Szene liest sie am gebrochenen Punkt.

export const partVS = `#version 300 es
uniform float uFlow;     // integrierte Flusszeit (Tempo ~ Lautstärke)
uniform float uTurb;     // integrierte Turbulenzzeit
uniform float uLevel;    // aktuelle Lautstärke 0..1
uniform float uExtent;   // halbe Kantenlänge der Partikeltextur (m)
uniform float uPx;       // Texel pro Meter
uniform float uIdOffset; // trennt die Partikel der drei Ebenen
uniform float uSizeMul;  // Größe aus dem UI
uniform float uNoise;    // Frequenz-Faktor des Emissions-Noise (größer = feiner)
uniform float uMode;     // 0 = Sonne, 1 = Fraktal
uniform highp sampler2DArray uFrac; // Fraktal-Ebenen -> Geburtsort und Farbe (aus der innersten)
uniform float uFracMain;  // Index der innersten Ebene
uniform float uFracR;    // Radius, in dem Fraktal-Partikel entstehen können
out float vA;
out vec3 vCol;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
${SUN_GLSL}

// Emissionsdichte entlang des Sonnenrandes: langsam wanderndes, periodisches Noise.
// Frequenzen werden auf ganze Zahlen gerundet, damit es rundherum nahtlos bleibt.
float emission(float a, float t) {
  float k = uNoise;
  float n = sin(a * floor(7.0 * k + 0.5)  + t * 0.21 + 1.3) * 0.40
          + sin(a * floor(13.0 * k + 0.5) - t * 0.17 + 4.1) * 0.30
          + sin(a * floor(23.0 * k + 0.5) + t * 0.29 + 2.2) * 0.22
          + sin(a * floor(37.0 * k + 0.5) - t * 0.37 + 0.7) * 0.15
          + sin(a * floor(61.0 * k + 0.5) + t * 0.43 + 3.3) * 0.10;
  return n / 1.17 * 0.5 + 0.5;
}

void main() {
  float id = float(gl_VertexID) + uIdOffset;
  float s1 = h1(id), s2 = h1(id + 17.3);

  float speed = 0.6 + 0.8 * s2;
  float life = s1 + uFlow * speed * 0.25;
  float prog = fract(life);                        // 0 = Geburt, 1 = verglüht
  float cycle = floor(life);                       // jede neue Lebensrunde: neuer Geburtsort
  float s3 = h1(id * 1.37 + cycle * 7.71);
  float s4 = h1(id * 2.11 + cycle * 3.17 + 5.0);

  float ang = s3 * 6.2831853;
  vec2 dir = vec2(cos(ang), sin(ang));
  float dens, r0;
  vec3 birth;
  if (uMode < 0.5) {
    dens = smoothstep(0.4, 0.75, emission(ang, uClock));
    float Rb = sunRadius(dir);
    r0 = Rb * (0.86 + 0.13 * s4);                  // Geburt knapp innerhalb des Randes
    birth = sunDisc(dir * r0, Rb);
  } else {
    // Fraktal: zufälliger Ort, sichtbar nur, wo das Fraktal hell ist; Farbe von dort
    r0 = sqrt(h1(id * 4.13 + cycle * 1.9)) * uFracR;
    vec4 f = textureLod(uFrac, vec3(dir * r0 / (2.0 * uExtent) + 0.5, uFracMain), 0.0);
    float a = f.a;
    birth = f.rgb / max(a, 1e-3);
    dens = smoothstep(0.2, 0.6, a);
  }
  float dist = pow(prog, 1.2) * uSunR * (uMode < 0.5 ? 1.4 : 2.0) * (0.5 + 0.5 * s4);
  float r = r0 + dist;

  // Turbulenz: seitliches Verwirbeln, wächst mit Abstand und Lautstärke
  float d = dist / uSunR;
  float wob = sin(d * 7.0 + uTurb * 0.9 + s2 * 20.0) * 0.6
            + sin(d * 19.0 - uTurb * 1.7 + s3 * 30.0) * 0.3
            + sin(d * 41.0 + uTurb * 2.3 + s1 * 50.0) * 0.12;
  ang += wob * d * 0.25 * (0.5 + uLevel) + d * 0.15;

  vec2 p = vec2(cos(ang), sin(ang)) * r;
  gl_Position = vec4(p / uExtent, 0.0, 1.0);
  gl_PointSize = max(mix(0.02, 0.009, prog) * uSunR * uPx * uSizeMul, 1.0);

  // Farbe = Farbe am Geburtsort, glüht dann langsam dunkler aus (im Fraktal-Modus farbtreu)
  vec3 fadeTo = uMode < 0.5 ? birth * vec3(0.85, 0.3, 0.15) : birth * 0.45;
  vCol = mix(birth, fadeTo, smoothstep(0.0, 0.9, prog));

  vA = dens * smoothstep(0.0, 0.05, prog) * (1.0 - prog) * (0.3 + 0.7 * s4) * (0.7 + 0.6 * uLevel);
  if (uMode > 0.5) { vA = min(vA * 1.8, 1.0); gl_PointSize *= 1.3; }
}`;

export const partFS = `#version 300 es
precision mediump float;
in float vA;
in vec3 vCol;
out vec4 o;
void main() {
  float m = max(1.0 - length(gl_PointCoord * 2.0 - 1.0), 0.0);
  float a = vA * m * m;
  o = vec4(vCol * a, a);
}`;

// Blendet die Partikeltextur pro Frame etwas aus -> weiche Schweife
export const fadeFS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`;

// ---------- Partikel, die auf den Betrachter zufliegen ----------
// Entstehen auf der Sonnenscheibe (an der Wasserebene) und fliegen aufgefächert auf den
// Startpunkt (0,0,0) zu. Tempo ~ Lautstärke. Kopf = runder Punkt, dahinter ein
// schlängelnder, spitz zulaufender Schweif aus mehreren Segmenten (entlang der Flugbahn).

const FLY_GLSL = `
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCam;
uniform vec3 uFrom;      // Mittelpunkt der Sonne an der Wasserebene
uniform float uSunR;
uniform float uFlow;     // integrierte Flugzeit
uniform float uTurb;
uniform float uClock;
uniform float uSize;     // Größe in Metern
uniform float uPxScale;  // Pixel pro (Meter / Abstand)
uniform float uLevel;
uniform float uHue;      // Farbton-Verschiebung (nur im Fraktal-Modus ≠ 0)

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
${COLOR_GLSL}

struct Fly { float prog; float s1; float s2; float s5; float a; float rr; };

Fly flyState(float id) {
  Fly f;
  f.s1 = h1(id + 3.1); f.s2 = h1(id + 11.7);
  float life = f.s1 + uFlow * (0.6 + 0.8 * f.s2);
  f.prog = fract(life);
  float cyc = floor(life);
  f.a  = h1(id * 1.91 + cyc * 5.3) * 6.2831853;
  f.rr = sqrt(h1(id * 3.07 + cyc * 2.9));
  f.s5 = h1(id * 0.77 + cyc * 9.1);
  return f;
}

vec3 flyPos(Fly f, float prog) {
  vec3 start = uFrom + vec3(cos(f.a), sin(f.a), 0.0) * f.rr * uSunR * 0.95;
  vec3 target = vec3(cos(f.a) * (0.6 + 1.6 * f.s5), sin(f.a) * (0.4 + 1.2 * f.s5), 1.5);
  vec3 p = mix(start, target, prog);
  float k = sin(prog * 3.14159);
  p.x += sin(prog * 9.0 + uTurb + f.s1 * 30.0) * 0.12 * k;
  p.y += sin(prog * 7.0 - uTurb * 1.3 + f.s2 * 40.0) * 0.12 * k;
  return p;
}

float flyAlpha(Fly f, vec3 p) {
  return smoothstep(0.0, 0.08, f.prog)               // einblenden an der Sonne
       * smoothstep(0.8, 2.2, length(p - uCam))       // ausblenden kurz vor der Kamera
       * (0.25 + 0.5 * f.s5) * (0.5 + 0.7 * uLevel);
}

vec3 flyColor(Fly f) { return hueShift(mix(vec3(1.0, 0.62, 0.26), vec3(0.95, 0.3, 0.08), f.s5), uHue); }
`;

export const flyVS = `#version 300 es
${FLY_GLSL}
out float vA;
out vec3 vCol;
void main() {
  Fly f = flyState(float(gl_VertexID));
  vec3 p = flyPos(f, f.prog);
  vec4 vp = uView * vec4(p, 1.0);
  gl_Position = uProj * vp;
  gl_PointSize = clamp(uSize * (0.6 + 0.8 * f.s5) * uPxScale / max(-vp.z, 0.05), 1.0, 48.0);
  vA = flyAlpha(f, p);
  vCol = flyColor(f);
}`;

export const flyFS = `#version 300 es
precision mediump float;
in float vA;
in vec3 vCol;
out vec4 o;
void main() {
  float m = max(1.0 - length(gl_PointCoord * 2.0 - 1.0), 0.0);
  o = vec4(vCol * vA * m * m, 1.0);
}`;

export const TAIL_SEGMENTS = 6;

export const tailVS = `#version 300 es
${FLY_GLSL}
uniform float uTail;     // Schweiflänge (Anteil der Flugstrecke)
uniform vec2  uVp;       // Viewport in Pixeln
out float vA;
out vec3 vCol;
out float vU;            // 0 = Schweifende, 1 = am Kopf
out float vV;            // -1..1 quer zum Schweif

const int SEG = ${TAIL_SEGMENTS};

void main() {
  int per = SEG * 6;
  int vid = gl_VertexID;
  float id = float(vid / per);
  int local = vid - (vid / per) * per;
  int seg = local / 6;
  int corner = local - seg * 6;
  // zwei Dreiecke pro Segment
  int e = (corner == 1 || corner == 2 || corner == 4) ? 1 : 0;
  float side = (corner == 2 || corner == 4 || corner == 5) ? 1.0 : -1.0;
  float u = float(seg + e) / float(SEG);

  Fly f = flyState(id);
  float pr = max(f.prog - uTail * (1.0 - u), 0.0);
  vec3 P  = flyPos(f, pr);
  vec3 P2 = flyPos(f, pr + 0.003);

  mat4 vpm = uProj * uView;
  vec4 c1 = vpm * vec4(P, 1.0);
  vec4 c2 = vpm * vec4(P2, 1.0);
  vec2 d = (c2.xy / c2.w - c1.xy / c1.w) * uVp;
  vec2 dir = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);

  float headPx = clamp(uSize * (0.6 + 0.8 * f.s5) * uPxScale / max(c1.w, 0.05), 1.0, 48.0);
  float wPx = headPx * 0.35 * mix(0.15, 1.0, u * u);
  // Schlängeln wie ein Spermium: seitliche Welle, zum Ende hin stärker
  float wig = sin(u * 9.0 - uClock * 10.0 + f.s1 * 40.0) * (1.0 - u) * headPx * 0.6;

  c1.xy += perp * (side * wPx + wig) * 2.0 / uVp * c1.w;
  gl_Position = c1;

  vU = u;
  vV = side;
  vA = flyAlpha(f, P) * smoothstep(0.0, 0.02, f.prog - uTail * (1.0 - u));
  vCol = flyColor(f);
}`;

export const tailFS = `#version 300 es
precision mediump float;
in float vA;
in vec3 vCol;
in float vU;
in float vV;
out vec4 o;
void main() {
  float a = vA * (1.0 - vV * vV) * pow(vU, 1.5) * 0.7;
  o = vec4(vCol * a, 1.0);
}`;


// ---------- Sand (Cymatics-Partikel) ----------
// Zustand pro Partikel in einer Float-Textur: xy = Position (UV der Wasserfläche), z = Alter 0..1, w = Saat.
// Wie Sand auf einer Rüttelplatte: in Schwingungsbäuchen (große Hüllkurve) werden die Körner
// zufällig weggestoßen, entlang des Hüllkurven-Gefälles rutschen sie in die ruhigen Knotenlinien.
export const sandUpdateFS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uWave;
uniform float uDt;
uniform float uLife;      // Lebensdauer eines Korns (s)
uniform float uTime;
uniform float uMobility;  // wie stark die Körner ins Ruhige rutschen
uniform float uJitter;    // wie stark sie in bewegten Bereichen springen
out vec4 o;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec4 s = texelFetch(uState, ivec2(gl_FragCoord.xy), 0);
  vec2 p = s.xy;
  float age = s.z, seed = s.w;
  bool fresh = seed == 0.0;
  if (fresh) seed = hash(gl_FragCoord.xy * 0.731) + 0.001;
  age += uDt / uLife;
  if (age >= 1.0 || fresh) {
    float a = hash(vec2(seed * 91.3, uTime + seed)) * 6.2831853;
    float r = sqrt(hash(vec2(uTime * 1.7 + seed * 3.1, seed * 17.1))) * 0.48;
    p = 0.5 + r * vec2(cos(a), sin(a));
    age = fresh ? hash(vec2(seed, 7.7)) : 0.0;   // anfangs verteilte Alter -> kein gemeinsames Pulsieren
  }
  float tx = 2.0 / float(textureSize(uWave, 0).x);
  float e  = texture(uWave, p).b;
  float ex = texture(uWave, p + vec2(tx, 0.0)).b - texture(uWave, p - vec2(tx, 0.0)).b;
  float ey = texture(uWave, p + vec2(0.0, tx)).b - texture(uWave, p - vec2(0.0, tx)).b;
  vec2 grad = vec2(ex, ey) / (2.0 * tx);
  vec2 jit = vec2(hash(p * 913.1 + uTime), hash(p * 271.7 - uTime * 1.3)) - 0.5;
  p += (-grad * uMobility + jit * min(e, 1.0) * uJitter) * uDt;
  o = vec4(p, age, seed);
}`;

export const sandVS = `#version 300 es
uniform sampler2D uState;
uniform sampler2D uWave;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenter;
uniform float uWaterR;
uniform float uSize;      // Korngröße (m)
uniform float uPxScale;
uniform float uVis;       // Sichtbarkeit (steigt beim Summen, klingt danach ab)
out float vA;
${BOUNDARY_GLSL}
void main() {
  int w = textureSize(uState, 0).x;
  ivec2 ij = ivec2(gl_VertexID % w, gl_VertexID / w);
  vec4 s = texelFetch(uState, ij, 0);
  vec2 p = s.xy;
  vec3 world = uCenter + vec3((p - 0.5) * 2.0 * uWaterR, 0.02);
  vec4 vp = uView * vec4(world, 1.0);
  gl_Position = uProj * vp;
  gl_PointSize = clamp(uSize * uPxScale / max(-vp.z, 0.1), 1.0, 8.0);
  float env = texture(uWave, p).b;
  float calm = 1.0 - smoothstep(0.02, 0.2, env);      // in den Knotenlinien heller
  vA = uVis * sin(3.14159 * clamp(s.z, 0.0, 1.0)) * edgeFade(p - 0.5) * (0.25 + 0.75 * calm);
}`;

export const sandFS = `#version 300 es
precision mediump float;
uniform vec3 uColor;
in float vA;
out vec4 o;
void main() {
  float m = max(1.0 - length(gl_PointCoord * 2.0 - 1.0), 0.0);
  o = vec4(uColor * vA * m, 1.0);
}`;

// ---------- Relief als Mesh ----------
// Unterteiltes Gitter für die innerste Fraktal-Ebene; Höhe = (weichgezeichnete) Helligkeit.
// Nur in Gebrauch, wenn Relief-Modus "Mesh" gewählt ist.
export const meshVS = `#version 300 es
in vec2 aPos;                 // 0..1
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenter;
uniform highp sampler2DArray uFracArr;
uniform float uMain;          // Index der innersten Ebene
uniform float uLod;           // Weichzeichnung (Mipmap-Stufe)
uniform float uDisp;          // Verschiebung zum Betrachter (m)
uniform float uBase;          // Tiefe der Ebene hinter dem Wasser (m)
uniform float uHalfSize;      // halbe Kantenlänge des Gitters (m)
uniform float uExtent;
out vec3 vWorld;
out vec2 vFuv;
out vec3 vNormal;
float H(vec2 fuv) { return textureLod(uFracArr, vec3(fuv, uMain), uLod).a; }
void main() {
  vec2 local = (aPos * 2.0 - 1.0) * uHalfSize;
  vec2 fuv = local / (2.0 * uExtent) + 0.5;
  float h = H(fuv);
  vec3 world = uCenter + vec3(local, -uBase + h * uDisp);
  // weiche Normale aus der (weichgezeichneten) Höhenkarte statt flacher Dreiecks-Normalen
  float e = exp2(uLod) / float(textureSize(uFracArr, 0).x) * 1.5;
  float hx = H(fuv + vec2(e, 0.0)) - H(fuv - vec2(e, 0.0));
  float hy = H(fuv + vec2(0.0, e)) - H(fuv - vec2(0.0, e));
  float m = 2.0 * e * 2.0 * uExtent;               // Abstand der Proben in Metern
  vNormal = normalize(vec3(-hx * uDisp / m, -hy * uDisp / m, 1.0));
  vWorld = world;
  vFuv = fuv;
  gl_Position = uProj * uView * vec4(world, 1.0);
}`;

export const meshFS = `#version 300 es
precision highp float;
uniform highp sampler2DArray uFracArr;
uniform sampler2D uWave;
uniform float uMain;
uniform vec3 uCam;
uniform vec3 uCenter;
uniform float uWaterR;
uniform float uBump;
uniform float uTexel;
uniform float uIOR;
uniform float uBase;
uniform float uExtent;
in vec3 vWorld;
in vec2 vFuv;
in vec3 vNormal;
out vec4 o;
void main() {
  // Wo schneidet der Sichtstrahl die Wasseroberfläche? Dort die Wellen-Neigung lesen
  vec3 ray = normalize(vWorld - uCam);
  float t = (uCenter.z - uCam.z) / ray.z;
  vec2 wl = uCam.xy + ray.xy * t - uCenter.xy;
  vec2 wuv = wl / (2.0 * uWaterR) + 0.5;
  float hL = texture(uWave, wuv - vec2(uTexel, 0.0)).r;
  float hR = texture(uWave, wuv + vec2(uTexel, 0.0)).r;
  float hD = texture(uWave, wuv - vec2(0.0, uTexel)).r;
  float hU = texture(uWave, wuv + vec2(0.0, uTexel)).r;
  vec2 grad = vec2(hR - hL, hU - hD) * uBump;
  // Näherung der Brechung: Versatz ~ Neigung × Tiefe unter dem Wasser
  float depthBelow = uCenter.z - vWorld.z;
  vec2 off = grad * depthBelow * (1.0 - 1.0 / uIOR) * 0.8;
  vec4 f = texture(uFracArr, vec3(vFuv + off / (2.0 * uExtent), uMain));

  // Licht aus der Geometrie-Neigung (macht die Tiefe lesbar)
  vec3 nrm = normalize(vNormal);
  float shade = 0.65 + 0.6 * max(dot(nrm, normalize(vec3(-0.5, 0.7, 0.6))), 0.0);
  f.rgb *= shade * (1.0 - clamp(length(grad) * 1.1, 0.0, 0.7));
  o = f;                       // vormultipliziert
}`;
