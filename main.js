import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// Bei jedem Update erhöhen, damit man auf der Quest sieht, ob die neue Version geladen ist.
const VERSION = 'v0.1.0';
document.getElementById('version').textContent = `Vibrations ${VERSION}`;

// ---------- Grundgerüst ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060f, 0.045);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0, 1.6, 0);

// ---------- Himmel: weicher Verlauf ----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(100, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x0a1030) }, bottom: { value: new THREE.Color(0x1a0f2a) } },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
      void main(){ float h = normalize(vPos).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0, 1.0, h)), 1.0); }`
  })
);
scene.add(sky);

// ---------- Boden: dunkle, ruhige Wasserfläche ----------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(60, 64),
  new THREE.MeshStandardMaterial({ color: 0x0b0f22, roughness: 0.35, metalness: 0.6 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

scene.add(new THREE.AmbientLight(0x404a80, 0.6));

// ---------- Atem-Kugel: 4 s ein, 4 s aus ----------
const BREATH = 8; // Sekunden pro Atemzug
const orbLight = new THREE.PointLight(0x8fb8ff, 3, 12, 1.5);
const orb = new THREE.Mesh(
  new THREE.SphereGeometry(0.25, 48, 24),
  new THREE.MeshStandardMaterial({ color: 0x9cc4ff, emissive: 0x4f7dff, emissiveIntensity: 1.2, transparent: true, opacity: 0.9 })
);
orb.position.set(0, 1.5, -2.2);
orb.add(orbLight);
scene.add(orb);

// Halo um die Kugel
const halo = new THREE.Mesh(
  new THREE.SphereGeometry(0.45, 32, 16),
  new THREE.MeshBasicMaterial({ color: 0x6f9bff, transparent: true, opacity: 0.12, depthWrite: false })
);
orb.add(halo);

// ---------- Schwebende Lichtpartikel ----------
const COUNT = 600;
const positions = new Float32Array(COUNT * 3);
const seeds = new Float32Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  const r = 3 + Math.random() * 25;
  const a = Math.random() * Math.PI * 2;
  positions[i * 3] = Math.cos(a) * r;
  positions[i * 3 + 1] = 0.2 + Math.random() * 8;
  positions[i * 3 + 2] = Math.sin(a) * r;
  seeds[i] = Math.random() * 100;
}
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particles = new THREE.Points(
  particleGeo,
  new THREE.PointsMaterial({ color: 0xc8d8ff, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending })
);
scene.add(particles);

// ---------- Klang: sanfter Drone (startet mit der VR-Session) ----------
let audio;
function startAudio() {
  if (audio) return;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 4);
  // Grundton + Quinte + Oktave, leicht verstimmt für Schwebungen ("Vibrations")
  [[110, 0], [110.6, 0], [165, 0.5], [220.4, 0.3]].forEach(([freq, pan]) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(g).connect(p).connect(master);
    osc.start();
  });
  audio = { ctx, master };
}
renderer.xr.addEventListener('sessionstart', startAudio);
renderer.xr.addEventListener('sessionend', () => { audio?.ctx.close(); audio = null; });

// ---------- Animation ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();

  // Atmen: 0 → 1 → 0 über BREATH Sekunden, weich (Sinus)
  const breath = 0.5 - 0.5 * Math.cos((t / BREATH) * Math.PI * 2);
  const s = 1 + breath * 0.8;
  orb.scale.setScalar(s);
  orb.material.emissiveIntensity = 0.8 + breath * 1.2;
  orbLight.intensity = 2 + breath * 3;
  halo.material.opacity = 0.08 + breath * 0.12;
  if (audio) audio.master.gain.setTargetAtTime(0.1 + breath * 0.08, audio.ctx.currentTime, 0.5);

  // Partikel steigen langsam auf und schwanken
  const pos = particleGeo.attributes.position.array;
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3 + 1] += 0.002;
    if (pos[i * 3 + 1] > 9) pos[i * 3 + 1] = 0.2;
    pos[i * 3] += Math.sin(t * 0.3 + seeds[i]) * 0.0015;
  }
  particleGeo.attributes.position.needsUpdate = true;
  particles.rotation.y = t * 0.005;

  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
