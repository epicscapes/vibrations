// Handgesten für die Steuerung – reine Logik, kennt weder WebXR noch Rendering.
// Eingabe pro Frame: Gelenkpositionen beider Hände (25 Gelenke × xyz, Reihenfolge wie WebXR XRHand) im lokalen Raum
// + Kopfposition/-richtung. Ausgabe: Aktionen (Gas, Bremse, Flügel, Sprung, Lenken, Handmenü, Pinch fürs Menü).
// Bei einem späteren Umstieg (z. B. auf das Immersive Web SDK) wird nur der Adapter getauscht, der die Gelenke liefert.

// Gelenk-Indizes (WebXR Hand Input, feste Reihenfolge)
export const J = {
  wrist: 0, thumbTip: 4,
  indexMeta: 5, indexProx: 6, indexTip: 9,
  middleMeta: 10, middleProx: 11, middleTip: 14,
  ringProx: 16, ringTip: 19,
  pinkyMeta: 20, pinkyProx: 21, pinkyTip: 24,
};
export const JOINTS = 25;

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const get = (h, i) => [h[i * 3], h[i * 3 + 1], h[i * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => len(sub(a, b));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// geglättet nähern (unabhängig von der Bildrate)
const follow = (cur, goal, rate, dt) => cur + (goal - cur) * Math.min(dt * rate, 1);

// Einrollen eines Fingers: Abstand Spitze–Handgelenk relativ zu Knöchel–Handgelenk (größenunabhängig)
function curl(h, tip, prox) {
  const w = get(h, J.wrist);
  const ratio = dist(get(h, tip), w) / Math.max(dist(get(h, prox), w), 1e-3);
  return clamp01((1.85 - ratio) / 0.65);          // gestreckt ~2,0+ -> 0, Faust ~1,1 -> 1
}

// Werte einer Hand
function analyse(h, isLeft) {
  const wrist = get(h, J.wrist);
  const thumb = get(h, J.thumbTip), index = get(h, J.indexTip);
  const pinchD = dist(thumb, index);
  const others = (curl(h, J.middleTip, J.middleProx) + curl(h, J.ringTip, J.ringProx) + curl(h, J.pinkyTip, J.pinkyProx)) / 3;
  const indexCurl = curl(h, J.indexTip, J.indexProx);
  const pinch = 1 - sstep(0.015, 0.05, pinchD);                // 1 = Daumen und Zeigefinger berühren sich
  const om = pinch * (1 - sstep(0.35, 0.7, others));           // Om/Gyan-Mudra: übrige Finger gestreckt oder locker
  const fist = sstep(0.55, 0.85, others) * sstep(0.4, 0.75, indexCurl);
  // Handflächen-Normale (zeigt aus der Handfläche heraus)
  let palmN = norm(cross(sub(get(h, J.indexMeta), wrist), sub(get(h, J.pinkyMeta), wrist)));
  if (isLeft) palmN = [-palmN[0], -palmN[1], -palmN[2]];
  const palm = get(h, J.middleMeta);
  const pinchPt = [(thumb[0] + index[0]) / 2, (thumb[1] + index[1]) / 2, (thumb[2] + index[2]) / 2];
  return { wrist, palm, palmN, pinch, om, fist, pinchPt };
}

export class HandGestures {
  constructor() {
    this.s = { accel: 0, brake: 0, brakeBoost: 0, wing: 0, steer: 0, menuOpen: false, pinchR: 0 };
    this.prevY = { left: null, right: null };
    this.vy = { left: 0, right: 0 };
    this.jumpCool = 0;
    this.lastSeen = { left: -1, right: -1 };
    this.t = 0;
  }

  // hands: { left: Float32Array(75) | null, right: ... }, head: { pos, fwd } (lokaler Raum, fwd normiert)
  // p: { accelGain, steerGain, jumpSpeed, menuOpen (Menü-Zustand von außen: offen = keine Fahrgesten) }
  update(dt, hands, head, p) {
    this.t += dt;
    const s = this.s;
    const L = hands.left ? analyse(hands.left, true) : null;
    const R = hands.right ? analyse(hands.right, false) : null;
    const out = { active: !!(L || R), left: L, right: R, jump: false };

    // Hand-Geschwindigkeit nach oben (für den Sprung), geglättet
    for (const [k, H] of [['left', L], ['right', R]]) {
      if (H) {
        const y = H.palm[1];
        if (this.prevY[k] !== null && dt > 0) this.vy[k] = follow(this.vy[k], (y - this.prevY[k]) / dt, 20, dt);
        this.prevY[k] = y;
      } else { this.prevY[k] = null; this.vy[k] = 0; }
    }

    // Handfläche zum Gesicht + angeschaut? (Quest zeigt dann seinen Menü-/System-Button; Pinch dort darf kein Gas geben)
    const palmFacing = (H, tight) => {
      if (!H) return false;
      const toHead = norm(sub(head.pos, H.palm));
      const look = dot(head.fwd, norm(sub(H.palm, head.pos)));
      return tight ? dot(H.palmN, toHead) > 0.7 && look > 0.8 : dot(H.palmN, toHead) > 0.35 && look > 0.6;
    };
    out.palmL = palmFacing(L, false);
    out.palmR = palmFacing(R, false);
    s.menuOpen = !!p.menuOpen;
    out.menuOpen = s.menuOpen;
    s.pinchR = R ? R.pinch : 0;
    out.pinchR = s.pinchR;

    // Solange das Menü offen ist: keine Fahrgesten (Pinch dient nur zum Auswählen)
    const drive = !s.menuOpen;
    const both = L && R;

    // Gas: Om-Geste; eine Hand bis 60 %, beide 90 %, berühren sich die Om-Kreise beider Hände: 100 %
    let accel = 0;
    if (drive) {
      const a = L && !out.palmL ? L.om : 0, b = R && !out.palmR ? R.om : 0;   // Pinch am System-Button zählt nicht als Gas
      const hi = Math.max(a, b), lo = Math.min(a, b);
      const touch = both ? 1 - sstep(0.04, 0.1, dist(L.pinchPt, R.pinchPt)) : 0;
      accel = 0.6 * hi + 0.3 * lo + 0.1 * lo * touch;
    }
    s.accel = follow(s.accel, clamp01(accel * p.accelGain), accel > s.accel ? 8 : 4, dt);

    // Bremse: Faust; eine halb, beide voll, aneinander liegende Fäuste bremsen zusätzlich stärker
    let brake = 0, boost = 0;
    if (drive) {
      const a = L ? L.fist : 0, b = R ? R.fist : 0;
      brake = 0.5 * Math.max(a, b) + 0.5 * Math.min(a, b);
      if (both) boost = Math.min(a, b) * (1 - sstep(0.08, 0.16, dist(L.palm, R.palm)));
    }
    s.brake = follow(s.brake, brake, 8, dt);
    s.brakeBoost = follow(s.brakeBoost, boost, 8, dt);

    // Flügel: Hände seitlich angehoben (Brust- bis Kopfhöhe) und mehr als schulterbreit auseinander
    let wing = 0;
    if (drive && both) {
      const span = Math.hypot(L.palm[0] - R.palm[0], L.palm[2] - R.palm[2]);
      const lowest = Math.min(L.palm[1], R.palm[1]) - head.pos[1];
      wing = sstep(0.48, 0.62, span) * sstep(-0.62, -0.42, lowest) * (1 - sstep(0.15, 0.3, lowest));
    }
    s.wing = follow(s.wing, wing, wing > s.wing ? 6 : 3, dt);
    out.wing = s.wing;

    // Sprung: beide Hände gleichzeitig ruckartig nach oben, eher nah beieinander (nicht in Flügelhaltung)
    this.jumpCool = Math.max(this.jumpCool - dt, 0);
    if (drive && both && this.jumpCool === 0) {
      const span = Math.hypot(L.palm[0] - R.palm[0], L.palm[2] - R.palm[2]);
      if (this.vy.left > p.jumpSpeed && this.vy.right > p.jumpSpeed && span < 0.45 && s.wing < 0.3) {
        out.jump = true;
        this.jumpCool = 0.8;
      }
    }

    // Lenken: Neigung der Linie zwischen den Händen (wie ein Lenkrad); links höher -> rechts herum.
    // Nur in Fahr- (Om-Geste) oder Flughaltung, mit Totzone – entspannte Hände lenken nicht.
    let steer = 0;
    const omL = out.palmL ? 0 : L ? L.om : 0, omR = out.palmR ? 0 : R ? R.om : 0;
    if (drive && both && (Math.max(omL, omR) > 0.4 || s.wing > 0.3)) {
      const horiz = Math.max(Math.hypot(L.palm[0] - R.palm[0], L.palm[2] - R.palm[2]), 0.05);
      const ang = Math.atan2(L.palm[1] - R.palm[1], horiz) * 180 / Math.PI;
      const a = Math.abs(ang);
      steer = Math.sign(ang) * sstep(8, 35, a) * p.steerGain;
    }
    s.steer = follow(s.steer, Math.max(Math.min(steer, 1.5), -1.5), 6, dt);

    out.accel = s.accel; out.brake = s.brake; out.brakeBoost = s.brakeBoost; out.steer = s.steer;
    return out;
  }

  reset() { this.constructor.call(this); }
}
