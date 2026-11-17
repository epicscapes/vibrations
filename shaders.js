// Alle GLSL-Shader (WebGL2 / GLSL ES 3.00)

// ---------- Wellensimulation ----------
// Zustand in einer RG16F-Textur: R = aktuelle Höhe, G = vorherige Höhe.
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
uniform float uR;       // Umkreisradius des Behälters (UV)
uniform float uShape;   // 0 = Kreis, 3..8 = n-Eck, 100+n = Blüte mit n Blättern
uniform float uLobe;    // Tiefe der Blütenblätter
in vec2 vUv;
out vec4 o;

float H(ivec2 p, ivec2 size) {
  p = clamp(p, ivec2(0), size - 1);
  return texelFetch(uState, p, 0).r;
}

// Abstand vom Mittelpunkt zum Rand in Richtung th
float boundary(float th) {
  if (uShape < 0.5) return uR;
  if (uShape > 99.0) return uR * (1.0 - uLobe * 0.5 * (1.0 + cos((uShape - 100.0) * th)));
  float seg = 6.2831853 / uShape;
  float a = mod(th - 1.5707963, seg) - seg * 0.5;   // eine Ecke zeigt nach oben
  return uR * cos(3.14159265 / uShape) / cos(a);
}

void main() {
  ivec2 size = textureSize(uState, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 s = texelFetch(uState, p, 0).rg;
  float h = s.r, prev = s.g;

  float lap = H(p + ivec2(1, 0), size) + H(p - ivec2(1, 0), size)
            + H(p + ivec2(0, 1), size) + H(p - ivec2(0, 1), size) - 4.0 * h;

  float n = h + (h - prev) * uDamp + uK * lap;

  vec2 ds = vUv - uSrcPos;
  n += uDrive * exp(-dot(ds, ds) / (uSrc * uSrc));

  vec2 c = vUv - 0.5;
  if (length(c) > boundary(atan(c.y, c.x))) n = 0.0;

  o = vec4(clamp(n, -4.0, 4.0), h, 0.0, 1.0);
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
  vec3 core = mix(vec3(1.0, 0.64, 0.26), vec3(0.97, 0.46, 0.13), pow(clamp(d / R, 0.0, 1.0), 2.5));
  vec3 col = core * mask;
  float e = max(d - R, 0.0);
  col += vec3(0.55, 0.09, 0.02) * exp(-e / (R * 0.08)) * 0.3;   // schmaler, gesättigter Saum
  col += vec3(0.22, 0.03, 0.01) * exp(-e / (R * 1.2));          // weiter Halo
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

// Escape-Time mit weicher Iterationszahl; Inneres = 1 (hell wie die Sonnenscheibe)
float escape(vec2 z, vec2 c, int mode, float norm) {
  for (int i = 0; i < 256; i++) {
    if (i >= uIter) break;
    if (mode == 1) z = vec2(abs(z.x), abs(z.y));
    if (mode == 2) z.y = -z.y;
    z = cmul(z, z) + c;
    float m = dot(z, z);
    if (m > 256.0) {
      float nu = float(i) + 1.0 - log2(log2(m) * 0.5);
      // auf max. "norm" normiert: feine Außenstrukturen leuchten sichtbar, auch bei vielen Iterationen
      return clamp(nu / min(float(uIter), norm), 0.0, 1.0);
    }
  }
  return 1.0;
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uExtent;      // Meter auf der Ebene
  vec2 z = p / uScale;
  float m = uMorph;
  float t;

  if (uType < 0.5) {                          // Julia: c wandert auf dem klassischen Kreis
    float a = 2.4 + m * 0.23 + 0.4 * sin(m * 0.11);
    t = escape(z, 0.7885 * vec2(cos(a), sin(a)), 0, 48.0);
  } else if (uType < 1.5) {                   // Burning Ship (Julia-Variante)
    vec2 c = vec2(-0.62 + 0.2 * sin(m * 0.21), -0.95 + 0.07 * cos(m * 0.17));   // spitzenartige Sets
    t = escape(z * vec2(1.0, -1.0) * 1.45, c, 1, 160.0);
  } else if (uType < 2.5) {                   // Tricorn (Mandelbar-Julia)
    float a = 1.25 + 0.55 * sin(m * 0.19) + 0.2 * sin(m * 0.07);
    vec2 c = 0.63 * vec2(cos(a), sin(a));
    t = escape(z, c, 2, 48.0);
  } else if (uType < 3.5) {                   // Kaliset: z = |z|/|z|² - c, Orbit-Akkumulation
    vec2 c = vec2(0.56, 0.47) + 0.06 * vec2(sin(m * 0.13), cos(m * 0.1));
    vec2 q = z * 0.75;
    float acc = 0.0, prev = 0.0;
    int n = max(uIter / 4, 8);
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
    float a = 1.9 + m * 0.17;
    t = escape(zf * 0.62, 0.7885 * vec2(cos(a), sin(a)), 0, 48.0);
  }

  // Helligkeit -> Farbe und Deckkraft
  float b = pow(t, 0.75);
  vec3 col = hueShift(palette(b), uHue);
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
uniform sampler2D uFrac0; // Fraktal: aktuelle Form
uniform sampler2D uFrac1; // Fraktal: Echo dahinter
uniform sampler2D uFrac2; // Fraktal: Echo noch weiter dahinter
uniform float uFracOff;   // Abstand der Fraktal-Ebenen (m)
uniform float uHue;       // Farbton-Verschiebung des Fraktals
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

vec3 ground(vec2 p) {
  return vec3(0.07, 0.012, 0.006) + (hash(floor(p / uSunR * 245.0)) - 0.5) * 0.03;  // dunkelrot + Korn
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
  vec3 rr  = refract(ray, n, 1.0 / 1.33);
  float t  = uDepth / max(-rr.z, 0.05);
  vec2 ps  = vLocal + rr.xy * t;

  vec3 col;
  float cover;                                   // was die hintere Corona-Ebene verdeckt
  if (uMode < 0.5) {
    col = sun(ps);
    cover = sunCover(ps);
  } else {
    // Fraktal: drei Ebenen, von hinten nach vorne (vormultipliziert)
    // weiter Glow wie bei der Sonne, im aktuellen Farbton
    col = ground(ps) + hueShift(vec3(0.22, 0.03, 0.01), uHue) * exp(-length(ps) / (uSunR * 1.2));
    vec4 f2 = layer(uFrac2, rr, uDepth + uFracOff * 2.0);
    col = col * (1.0 - f2.a) + f2.rgb;
    vec4 f1 = layer(uFrac1, rr, uDepth + uFracOff);
    col = col * (1.0 - f1.a) + f1.rgb;
    vec4 f0 = texture(uFrac0, ps / (2.0 * uExtent) + 0.5);
    col = col * (1.0 - f0.a) + f0.rgb;
    cover = f0.a;
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
uniform sampler2D uFrac; // Fraktal-Textur (vordere Ebene) -> Geburtsort und Farbe
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
    vec4 f = textureLod(uFrac, dir * r0 / (2.0 * uExtent) + 0.5, 0.0);
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
