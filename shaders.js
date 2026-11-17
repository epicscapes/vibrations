// Alle GLSL-Shader (WebGL2 / GLSL ES 3.00)

// ---------- Wellensimulation ----------
// Zustand in einer RG16F-Textur: R = aktuelle Höhe, G = vorherige Höhe.
// Diskrete 2D-Wellengleichung, kreisförmiger Behälter mit festem Rand (h = 0)
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
uniform float uDrive;   // aktuelle Anregung im Zentrum
uniform float uSrc;     // Radius der Anregungsquelle (in UV)
uniform float uR;       // Radius des Behälters (in UV)
uniform float uSym;     // Symmetrie des Randes (z. B. 6 -> sechszählige Muster)
uniform float uLobe;    // wie stark der Rand von der Kreisform abweicht
in vec2 vUv;
out vec4 o;

float H(ivec2 p, ivec2 size) {
  p = clamp(p, ivec2(0), size - 1);
  return texelFetch(uState, p, 0).r;
}

void main() {
  ivec2 size = textureSize(uState, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 s = texelFetch(uState, p, 0).rg;
  float h = s.r, prev = s.g;

  float lap = H(p + ivec2(1, 0), size) + H(p - ivec2(1, 0), size)
            + H(p + ivec2(0, 1), size) + H(p - ivec2(0, 1), size) - 4.0 * h;

  float n = h + (h - prev) * uDamp + uK * lap;

  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  n += uDrive * exp(-r2 / (uSrc * uSrc));

  // Reflektierender Rand: außerhalb des Kreises ist die Oberfläche fixiert
  // Leicht gewellter Rand bricht die perfekte Rotationssymmetrie,
  // dadurch entstehen blütenartige Interferenzmuster wie bei Cymatics.
  float th = atan(c.y, c.x);
  float rb = uR * (1.0 - uLobe * 0.5 * (1.0 + cos(uSym * th)));
  if (sqrt(r2) > rb) n = 0.0;

  o = vec4(clamp(n, -4.0, 4.0), h, 0.0, 1.0);
}`;

// ---------- Szene ----------
// Ein großes Quad im Raum = die transparente Wasserebene.
// Die Sonnenscheibe liegt "dahinter" auf einer virtuellen Ebene (uDepth Meter tiefer).
// Pro Pixel: Sichtstrahl -> an der Wasseroberfläche gebrochen -> trifft die Sonnenebene.
// Dadurch gibt es echte Parallaxe und die Sonne wird von den Wellen verzerrt.

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
uniform float uSunR;      // Radius der Sonnenscheibe (m)
uniform float uDepth;     // Abstand Wasser -> Sonnenebene (m)
uniform float uBump;      // Stärke der Oberflächen-Normalen
uniform float uTexel;     // 1 / Simulationsauflösung
uniform float uHalf;      // halbe Kantenlänge des Quads (m)
uniform sampler2D uPart;  // Sonnenwind-Partikel (Koordinaten der Sonnenebene)
uniform float uExtent;    // halbe Kantenlänge der Partikeltextur (m)
in vec3 vWorld;
in vec2 vLocal;
out vec4 o;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Die "projizierte Sonne": orange Scheibe, chromatischer Rand, gesättigter roter Glow
vec3 sun(vec2 p) {
  float d = length(p);
  float R = uSunR;

  // Kanalweise leicht unterschiedliche Radien/Weichheit -> Farbsaum
  // (Blau verschwindet zuerst, dann Grün, Rot reicht am weitesten -> gelb -> orange -> rot)
  vec3 radii = R * vec3(1.02, 1.0, 0.98);
  vec3 soft  = R * vec3(0.05, 0.03, 0.02);
  vec3 mask  = 1.0 - smoothstep(radii - soft, radii + soft, vec3(d));

  vec3 core = mix(vec3(1.0, 0.64, 0.26), vec3(0.97, 0.46, 0.13), pow(clamp(d / R, 0.0, 1.0), 2.5));
  vec3 col = core * mask;

  float e = max(d - R, 0.0);
  col += vec3(0.55, 0.09, 0.02) * exp(-e / (R * 0.25)) * 0.35;  // gesättigter Saum
  col += vec3(0.22, 0.03, 0.01) * exp(-e / (R * 1.2));          // weiter Halo

  // dunkelroter Grund
  col += vec3(0.07, 0.012, 0.006);

  // feines, statisches Korn (wie auf der Referenz)
  col += (hash(floor(p * 350.0)) - 0.5) * 0.03;
  return col;
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

  vec3 col = sun(ps);
  col += texture(uPart, ps / (2.0 * uExtent) + 0.5).rgb;

  // --- Schattierung der Wellen ---
  float slope = length(grad);
  col *= 1.0 - clamp(slope * 1.1, 0.0, 0.7);                 // dunkle Ringe
  float lit = dot(n.xy, normalize(vec2(-0.5, 0.8)));
  col += vec3(0.45, 0.10, 0.03) * max(lit, 0.0) * 0.6;        // warme Lichtkanten

  // --- Vignette: Quad-Rand verschwindet im Schwarz ---
  float v = smoothstep(uHalf, uHalf * 0.35, length(vLocal));
  col *= v;

  o = vec4(col, 1.0);
}`;

// ---------- Sonnenwind ----------
// Zustandslose Partikel: Position wird pro Frame aus ID + "Flusszeit" berechnet.
// uFlow läuft schneller, je lauter gesummt wird -> Partikel werden schneller.
// Gezeichnet wird in eine eigene Textur in Koordinaten der Sonnenebene;
// die Szene liest diese Textur am gebrochenen Punkt -> die Partikel liegen
// hinter dem Wasser und werden von den Wellen mit verzerrt.

export const partVS = `#version 300 es
uniform float uFlow;     // integrierte Flusszeit (Tempo ~ Lautstärke)
uniform float uTurb;     // integrierte Turbulenzzeit
uniform float uLevel;    // aktuelle Lautstärke 0..1
uniform float uSunR;
uniform float uExtent;   // halbe Kantenlänge der Partikeltextur (m)
uniform float uPx;       // Texel pro Meter
out float vA;
out vec3 vCol;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  float id = float(gl_VertexID);
  float s1 = h1(id), s2 = h1(id + 17.3), s3 = h1(id + 41.7), s4 = h1(id + 73.1);

  float speed = 0.5 + s2;
  float prog = fract(s1 + uFlow * speed * 0.1);       // 0 = an der Sonne, 1 = verglüht

  float ang = s3 * 6.2831853;
  float r0 = uSunR * (0.9 + 0.1 * s4);
  float dist = pow(prog, 1.3) * uSunR * 2.0 * (0.5 + 0.5 * s4);
  float r = r0 + dist;

  // Turbulenz: seitliches Verwirbeln, wächst mit Abstand und Lautstärke
  float d = dist / uSunR;
  float wob = sin(d * 7.0 + uTurb * 0.9 + s2 * 20.0) * 0.6
            + sin(d * 19.0 - uTurb * 1.7 + s3 * 30.0) * 0.3
            + sin(d * 41.0 + uTurb * 2.3 + s1 * 50.0) * 0.12;
  ang += wob * d * 0.25 * (0.5 + uLevel);
  // leichte Spirale
  ang += d * 0.15;

  vec2 p = vec2(cos(ang), sin(ang)) * r;
  gl_Position = vec4(p / uExtent, 0.0, 1.0);
  gl_PointSize = mix(0.014, 0.006, prog) * uPx;

  vA = smoothstep(0.0, 0.06, prog) * (1.0 - prog) * (0.35 + 0.65 * s4) * (0.45 + 0.9 * uLevel);
  vCol = mix(vec3(1.0, 0.78, 0.4), vec3(0.85, 0.18, 0.04), smoothstep(0.0, 0.7, prog));
}`;

export const partFS = `#version 300 es
precision mediump float;
in float vA;
in vec3 vCol;
out vec4 o;
void main() {
  float m = max(1.0 - length(gl_PointCoord * 2.0 - 1.0), 0.0);
  o = vec4(vCol * vA * m * m, 1.0);
}`;

// Blendet die Partikeltextur pro Frame etwas aus -> weiche Schweife
export const fadeFS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`;
