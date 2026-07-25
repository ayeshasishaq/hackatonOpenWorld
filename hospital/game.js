// ============================================================================
// OWNER: P1 / lead  —  FIRST-PERSON CONTROLLER + CORE LOOP + WIRING
// Keep GAME RULES here only. Art -> level.js (P2) / crowd -> crowd.js (P3) /
// data -> telemetry.js (P4) / prediction -> predict.js (P5).
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));   // PERF: retina at 2x quadruples fill cost
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x05060a, 12, 46);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 200);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- lights ----------
// PERF: every extra light costs per-fragment shading. Lifted the cheap ambient
// and cut the point lights from 9 to 3; the emissive strips still read as lit.
scene.add(new THREE.HemisphereLight(0x6274a0, 0x11141c, 1.35));
const key = new THREE.DirectionalLight(0xffffff, 0.75);
key.position.set(6, 20, 8); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -22, right: 22, top: 26, bottom: -26, near: 1, far: 60 });
scene.add(key);
// ceiling strips: emissive-only (free), with just two real lights for depth
const stripGeo = new THREE.BoxGeometry(2.4, .1, .3);
const stripMat = new THREE.MeshBasicMaterial({ color: 0xdce9ff });
for (let z = -18; z <= 18; z += 4.5) {
  const s = new THREE.Mesh(stripGeo, stripMat); s.position.set(0, 4.3, z); scene.add(s);
}
for (const z of [10, -4]) {
  const l = new THREE.PointLight(0xbfd8ff, 34, 22, 2); l.position.set(0, 4.2, z); scene.add(l);
}
const orLight = new THREE.PointLight(0x5ff3b4, 90, 26, 2);
orLight.position.set(LEVEL.goal.x, 4, LEVEL.goal.z); scene.add(orLight);

// ---------- static world ----------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(LEVEL.bounds.x * 2, LEVEL.bounds.z * 2),
  new THREE.MeshStandardMaterial({ color: 0x161c28, roughness: .92 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(Math.max(LEVEL.bounds.x, LEVEL.bounds.z) * 2, 28, 0x27324a, 0x1c2434);
grid.position.y = .02; grid.material.transparent = true; grid.material.opacity = .35; scene.add(grid);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3346, roughness: .85 });
for (const w of LEVEL.walls) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, 3.2, w.d), wallMat);
  m.position.set(w.x, 1.6, w.z); m.castShadow = m.receiveShadow = true; scene.add(m);
}
const SOLIDS = buildFurniture(THREE, scene);
loadProps(THREE, scene, GLTFLoader);          // async; safe if PROPS is empty

// OR goal marker
const goalDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(LEVEL.goal.r, LEVEL.goal.r, .08, 40),
  new THREE.MeshStandardMaterial({ color: 0x5ff3b4, emissive: 0x2fae7d, emissiveIntensity: 1.1 }));
goalDisc.position.set(LEVEL.goal.x, .04, LEVEL.goal.z); scene.add(goalDisc);
const goalBeam = new THREE.Mesh(
  new THREE.CylinderGeometry(LEVEL.goal.r, LEVEL.goal.r, 8, 40, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x5ff3b4, transparent: true, opacity: .07, side: THREE.DoubleSide }));
goalBeam.position.set(LEVEL.goal.x, 4, LEVEL.goal.z); scene.add(goalBeam);

// ---------- the gurney + the patient on it ----------
// You push from the HEAD end (as staff really do), so the patient's face is
// nearest you and their feet lead. Local +z = toward you, -z = direction of travel.
const gurney = new THREE.Group();
const P = {};                                   // patient parts we animate
{
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .8, ...o });
  const skin  = mat(0xd9a88a);                  // mutated by updatePatient (pallor)
  const gown  = mat(0xcfe0ee, { roughness: .95 });
  const steel = mat(0xcfd8e8, { metalness: .55, roughness: .3 });
  P.skin = skin;

  // --- trolley ---
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, .12, 2.0), steel);
  frame.position.y = .78; frame.castShadow = true; gurney.add(frame);
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(.94, .14, 1.94), mat(0x33405a));
  mattress.position.y = .9; gurney.add(mattress);
  for (const [dx, dz] of [[-.42, -.85], [.42, -.85], [-.42, .85], [.42, .85]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .07, 12), mat(0x1a1f29));
    w.rotation.z = Math.PI / 2; w.position.set(dx, .12, dz); gurney.add(w);
  }
  for (const dx of [-.46, .46]) {               // side rails
    const r = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, 1.1), steel);
    r.position.set(dx, 1.12, -.1); gurney.add(r);
    for (const dz of [-.6, .4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(.05, .22, .05), steel);
      post.position.set(dx, 1.0, dz); gurney.add(post);
    }
  }

  // --- body, lying supine ---
  const seg = (r, len, m) => {
    const s = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m);
    s.rotation.x = Math.PI / 2; s.castShadow = true; return s;
  };
  P.chest = seg(.2, .42, gown);  P.chest.position.set(0, 1.0, .26);  gurney.add(P.chest);
  const belly = seg(.18, .28, gown); belly.position.set(0, .99, -.08); gurney.add(belly);
  const hips  = seg(.19, .12, gown); hips.position.set(0, .98, -.32);  gurney.add(hips);

  P.head = new THREE.Group(); P.head.position.set(0, 1.02, .74); gurney.add(P.head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(.135, 18, 14), skin);
  skull.scale.set(1, .95, 1.12); skull.castShadow = true; P.head.add(skull);
  // hair caps the crown and the back of the skull, never the face (the face points up)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.142, 16, 12,
    0, Math.PI * 2, 0, Math.PI * .5), mat(0x2b2119));
  hair.rotation.x = Math.PI * .62; hair.position.set(0, -.01, .01); P.head.add(hair);
  // face points up: clenched eyes, drawn brows, mouth open in a gasp
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(.055, .012, .016), mat(0x241c14));
    eye.position.set(sx * .058, .122, .04); P.head.add(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(.06, .016, .018), mat(0x241c14));
    brow.position.set(sx * .06, .13, .078); brow.rotation.y = sx * .4; P.head.add(brow);
  }
  P.mouth = new THREE.Mesh(new THREE.SphereGeometry(.042, 12, 10), mat(0x2e1010));
  P.mouth.scale.set(1, .5, .7); P.mouth.position.set(0, .118, -.055); P.head.add(P.mouth);
  const mask = new THREE.Mesh(new THREE.SphereGeometry(.075, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0xdff1f7, transparent: true, opacity: .32,
                                     roughness: .25 }));
  mask.scale.set(1, .6, .85); mask.position.set(0, .1, -.02); P.head.add(mask);

  // arms: one across the chest clutching the wound, one at the side
  P.armL = new THREE.Group(); P.armL.position.set(-.24, 1.02, .34); gurney.add(P.armL);
  const upL = seg(.055, .2, skin); upL.position.set(0, 0, -.12); P.armL.add(upL);
  const foreL = seg(.05, .2, skin); foreL.position.set(.1, .06, -.32);
  foreL.rotation.y = .7; P.armL.add(foreL);
  P.armR = new THREE.Group(); P.armR.position.set(.26, 1.0, .3); gurney.add(P.armR);
  const upR = seg(.055, .22, skin); upR.position.set(0, 0, -.14); P.armR.add(upR);

  // legs under a blanket
  for (const sx of [-1, 1]) {
    const thigh = seg(.085, .26, gown); thigh.position.set(sx * .12, .98, -.58); gurney.add(thigh);
    const shin  = seg(.07, .26, skin);  shin.position.set(sx * .12, .96, -.9);   gurney.add(shin);
  }
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(.86, .1, .95), mat(0x2f5fa8, { roughness: 1 }));
  blanket.position.set(0, 1.02, -.62); gurney.add(blanket);

  // trauma: blood-soaked dressing on the abdomen
  P.wound = new THREE.Mesh(new THREE.BoxGeometry(.26, .03, .2), mat(0xf2f4f6));
  P.wound.position.set(.02, 1.14, -.02); gurney.add(P.wound);
  const blood = new THREE.Mesh(new THREE.CircleGeometry(.085, 14), mat(0x8e1414, { roughness: .55 }));
  blood.rotation.x = -Math.PI / 2; blood.position.set(.03, 1.157, -.02); gurney.add(blood);
  P.blood = blood;

  // IV pole with a drip bag, and a monitor LED that pulses with the heart rate
  // set well forward and to the side so it never blocks the view of the patient
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 1.25, 8), steel);
  pole.position.set(.5, 1.5, -.55); gurney.add(pole);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(.13, .19, .06),
    new THREE.MeshStandardMaterial({ color: 0xe8f4ff, transparent: true, opacity: .8 }));
  bag.position.set(.5, 2.0, -.55); gurney.add(bag);
  P.led = new THREE.Mesh(new THREE.SphereGeometry(.028, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
  P.led.position.set(.5, 2.15, -.55); gurney.add(P.led);
}
scene.add(gurney);

// Distress rises as vitals fall: faster shallow breathing, harder head-rolling,
// sharper spasms, trembling and pallor when critical.
function updatePatient(t, health) {
  const d = 1 - Math.max(0, Math.min(1, health / 100));      // 0 = stable, 1 = critical
  const breathe = Math.sin(t * (1.1 + d * 2.6) * Math.PI * 2);
  P.chest.scale.set(1, 1 + breathe * (.05 + d * .06), 1 + breathe * .03);
  P.head.rotation.z = Math.sin(t * (.7 + d * 1.9)) * (.05 + d * .3);   // rolling in pain
  // head tilted back on the pillow (airway open, gasping) so the face reads from behind
  P.head.rotation.x = .5 + Math.sin(t * 1.3) * .05 + d * .12;
  const spasm = Math.pow(Math.max(0, Math.sin(t * .8)), 14);           // sharp periodic wince
  P.armL.rotation.x = -spasm * (.35 + d * .9);
  P.armR.rotation.x = spasm * (.15 + d * .4);
  P.mouth.scale.set(1, .5 + d * .9, .7);                              // gasping
  P.shakeX = d > .55 ? (Math.random() - .5) * .008 * d : 0;           // tremor offset
  P.shakeY = d > .55 ? (Math.random() - .5) * .006 * d : 0;
  P.skin.color.setHSL(.07, .42 - d * .3, .62 - d * .14);              // goes pale
  P.blood.scale.setScalar(1 + d * .5);
  P.led.material.color.setHex(Math.sin(t * (2 + d * 4) * Math.PI * 2) > .4 ? 0xff3b3b : 0x400d0d);
}

// ---------- crowd meshes ----------
const KIND_COLOR = { nurse: 0x5fb0f3, patient: 0xd8dce6, rusher: 0xffc24d };
// PERF: one geometry + one material per kind, shared by every agent, built once.
// (Previously each of the 22 agents allocated its own, on every reset.)
const BODY_GEO = new THREE.CapsuleGeometry(.26, .95, 3, 8);
const HEAD_GEO = new THREE.SphereGeometry(.2, 10, 8);
const HEAD_MAT = new THREE.MeshStandardMaterial({ color: 0xe7d3bd, roughness: .8 });
const BODY_MAT = {};
for (const k in KIND_COLOR)
  BODY_MAT[k] = new THREE.MeshStandardMaterial({ color: KIND_COLOR[k], roughness: .75 });

let crowd, crowdMeshes = [], lastPreds = null, distN = 0, distP = 0;
let lastAction = { throttle: 0, steer: 0 };
function buildCrowdMeshes() {
  crowdMeshes.forEach(m => scene.remove(m)); crowdMeshes = [];
  crowd.agents.forEach(a => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(BODY_GEO, BODY_MAT[a.kind] || BODY_MAT.patient);
    body.position.y = .78; g.add(body);          // no castShadow: 22 shadow casters is costly
    const head = new THREE.Mesh(HEAD_GEO, HEAD_MAT); head.position.y = 1.5; g.add(head);
    scene.add(g); crowdMeshes.push(g);
  });
}

// ---------- two robots, raced side by side ----------
// The whole point of the demo: the difference has to be SEEN, not remembered.
// Same spawn, same goal, same crowd, running at the same time.
const NAIVE_C = 0xffc24d, PRED_C = 0x5ff3b4;
// Floating name tag, so nobody has to guess which robot is which.
function makeLabel(text, color, y) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#' + color.toString(16).padStart(6, '0');
  x.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(2.6, .65, 1); s.position.y = y; s.renderOrder = 999;   // staggered so they never collide
  return s;
}
function makeRobotRig(color) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(.32, .36, .8, 18),
    new THREE.MeshStandardMaterial({ color: 0x16202c, emissive: color,
                                     emissiveIntensity: .35, metalness: .35, roughness: .45 }));
  shell.position.y = .42; shell.castShadow = true; g.add(shell);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x0d1c24, roughness: .35 }));
  head.position.y = .92; g.add(head);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(.08, 12, 10),
    new THREE.MeshBasicMaterial({ color })); eye.position.set(0, .92, .2); g.add(eye);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(.1, 10, 8),
    new THREE.MeshBasicMaterial({ color })); beacon.position.y = 1.5; g.add(beacon);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.95, 1.12, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .35, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .04; g.add(ring);
  // trail: preallocated line, rewritten in place each frame
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300 * 3), 3));
  const trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .55 }));
  trail.frustumCulled = false;
  scene.add(g, trail);
  return { g, ring, beacon, eye, trail, color };
}
const RIGS = { naive: makeRobotRig(NAIVE_C), predictive: makeRobotRig(PRED_C) };
RIGS.naive.g.add(makeLabel('NAIVE', NAIVE_C, 2.2));
RIGS.predictive.g.add(makeLabel('PREDICTIVE', PRED_C, 3.1));
const BOTS = { naive: makeRobot('naive'), predictive: makeRobot('predictive') };

function syncRobot(bot, rig, t) {
  rig.g.position.set(bot.x, 0, bot.z);
  if (Math.hypot(bot.vx, bot.vz) > .05) rig.g.rotation.y = Math.atan2(bot.vx, bot.vz);
  rig.ring.position.y = .04;
  const frozen = bot.stalled;
  rig.ring.material.color.setHex(frozen ? 0xff3b3b : rig.color);
  rig.ring.material.opacity = frozen ? .35 + .3 * Math.abs(Math.sin(t * 6)) : .3;
  rig.beacon.material.color.setHex(frozen ? 0xff3b3b : rig.color);
  rig.beacon.scale.setScalar(frozen ? 1 + .35 * Math.abs(Math.sin(t * 6)) : 1);
  const arr = rig.trail.geometry.attributes.position.array;
  const n = Math.min(bot.trail.length / 2, 300);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = bot.trail[i * 2]; arr[i * 3 + 1] = .08; arr[i * 3 + 2] = bot.trail[i * 2 + 1];
  }
  rig.trail.geometry.attributes.position.needsUpdate = true;
  rig.trail.geometry.setDrawRange(0, n);
}

// ---------- prediction overlay ----------
// PERF: objects are pooled and rewritten in place. Rebuilding geometry every
// frame (the old approach) allocated ~66 geometries/materials per frame and
// never disposed them, which was the main source of stutter.
const predGroup = new THREE.Group(); scene.add(predGroup);
let showPredict = true;
const PRED_POOL = [];
const DOT_GEO = new THREE.SphereGeometry(.1, 8, 6);
function predSlot(i, steps) {
  if (!PRED_POOL[i]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(steps * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ transparent: true }));
    const dot = new THREE.Mesh(DOT_GEO, new THREE.MeshBasicMaterial({ transparent: true }));
    line.frustumCulled = false; predGroup.add(line, dot);
    PRED_POOL[i] = { line, dot };
  }
  return PRED_POOL[i];
}
function hidePredictions() {
  for (const s of PRED_POOL) if (s) { s.line.visible = false; s.dot.visible = false; }
}
function drawPredictions(preds) {
  hidePredictions();
  if (!showPredict) return;
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i], s = predSlot(i, p.path.length);
    const arr = s.line.geometry.attributes.position.array;
    for (let k = 0; k < p.path.length; k++) {
      arr[k * 3] = p.path[k].x; arr[k * 3 + 1] = .1; arr[k * 3 + 2] = p.path[k].z;
    }
    s.line.geometry.attributes.position.needsUpdate = true;
    s.line.geometry.setDrawRange(0, p.path.length);
    const hue = .42 - .42 * p.risk;                       // green -> red by collision risk
    s.line.material.color.setHSL(hue, .9, .55);
    s.line.material.opacity = .25 + p.risk * .7;
    s.line.visible = true;
    const end = p.path[p.path.length - 1];
    s.dot.position.set(end.x, .12, end.z);
    s.dot.scale.setScalar(.7 + p.risk * 1.6);
    s.dot.material.color.setHSL(hue, .9, .55);
    s.dot.material.opacity = .5 + p.risk * .5;
    s.dot.visible = true;
  }
}

// ---------- the gurney IS the vehicle: car-like (bicycle) model ----------
// You push from behind. Wheels only steer while rolling, so it handles like a real trolley.
const MAX_FWD = 3.6, MAX_REV = 1.2, ACCEL = 6.0, DRAG = 1.8, TURN = 2.2;
const BED_R = .5, BED_HALF = .9;          // trolley = capsule: radius + half its length
const PUSH = 2.45, EYE = 1.88, PITCH = -0.24;   // stand back and look down on the patient
const bed = { x: LEVEL.spawn.x, z: LEVEL.spawn.z, heading: 0, speed: 0 };  // heading 0 = -z, toward the OR
let headYaw = 0;                          // mouse look, decoupled from where the bed points
let camMode = 'fp';                       // 'fp' while driving, 'overhead' to watch the robots
const camAim = { x: 0, z: 0 };            // smoothed overhead follow target
camera.rotation.order = 'YXZ';
const keys = {};
addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (e.key === ' ') e.preventDefault(); });
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement)
    headYaw = clamp(headYaw - e.movementX * 0.0022, -1.25, 1.25);   // glance around, keep driving
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function hitsWall(x, z, r = BED_R) {
  for (const w of LEVEL.walls)
    if (Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r) return true;
  for (const s of SOLIDS) if (Math.hypot(x - s.x, z - s.z) < s.r + r) return true;
  return false;
}
// the trolley is long, so test both ends or it clips corners
function bedBlocked(x, z, fx, fz) {
  return hitsWall(x + fx * BED_HALF, z + fz * BED_HALF) ||
         hitsWall(x - fx * BED_HALF, z - fz * BED_HALF);
}
// closest point on the trolley's long axis to (px,pz) — used for person collisions
function bedClosest(px, pz, fx, fz) {
  const t = clamp((px - bed.x) * fx + (pz - bed.z) * fz, -BED_HALF, BED_HALF);
  return { x: bed.x + fx * t, z: bed.z + fz * t };
}

// ---------- run state ----------
let health, running, started, t0, tick, wasHit, stats;
function reset() {
  crowd = createCrowd(LEVEL, SOLIDS); buildCrowdMeshes();
  bed.x = LEVEL.spawn.x; bed.z = LEVEL.spawn.z; bed.heading = 0; bed.speed = 0;
  headYaw = 0; lastPreds = null; distN = distP = 0;
  BOTS.naive.reset(LEVEL, SOLIDS);
  BOTS.predictive.reset(LEVEL, SOLIDS, true);            // share the naive robot's goal
  BOTS.predictive.x = BOTS.naive.x; BOTS.predictive.z = BOTS.naive.z;
  BOTS.predictive.gx = BOTS.naive.gx; BOTS.predictive.gz = BOTS.naive.gz;
  health = 100; running = true; wasHit = false; tick = 0;
  stats = { hit: 0, miss: 0 }; Telemetry.reset(); t0 = performance.now();
  document.getElementById('over').style.display = 'none';
}

const $ = id => document.getElementById(id);
const clock = new THREE.Clock();

function loop() {
  const dt = Math.min(clock.getDelta(), .05);
  Demo.tick();                                   // drives the hands-off sequence
  if (started && running) {
    // ---- trolley physics: W/S drive, A/D steer the wheels ----
    // Either the human supplies the action, or the cloned policy does. Identical
    // downstream, which is the point: the policy occupies the human's seat.
    let throttle, steer;
    if (Policy.drive === 'scripted') {                 // reliable driver for the hands-off demo
      const a = ScriptedDriver.act({ x: bed.x, z: bed.z, heading: bed.heading, speed: bed.speed },
                                   crowd.agents);
      throttle = a.throttle; steer = a.steer;
    } else if (Policy.drive === 'auto' && Policy.trained) {
      const others = crowd.agents.map(a => ({ x: a.x, z: a.z, vx: a.vx, vz: a.vz }));
      const a = Policy.act({ x: bed.x, z: bed.z, heading: bed.heading, speed: bed.speed },
                           others, LEVEL.goal, LEVEL.walls);
      throttle = a.throttle; steer = a.steer;
    } else {
      throttle = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
      steer    = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
    }
    lastAction = { throttle, steer };
    bed.speed += throttle * ACCEL * dt;
    bed.speed -= bed.speed * DRAG * dt;                       // rolling friction / coast
    if (!throttle && Math.abs(bed.speed) < .05) bed.speed = 0;
    bed.speed = clamp(bed.speed, -MAX_REV, MAX_FWD);
    // wheels bite only while rolling; steering naturally inverts when reversing.
    // minus: forward is -z and right is +x, so turning right DECREASES heading.
    bed.heading -= steer * TURN * (bed.speed / MAX_FWD) * dt;

    const fx = -Math.sin(bed.heading), fz = -Math.cos(bed.heading);
    const nx = bed.x + fx * bed.speed * dt, nz = bed.z + fz * bed.speed * dt;
    if (!bedBlocked(nx, bed.z, fx, fz)) bed.x = nx; else bed.speed *= .25;
    if (!bedBlocked(bed.x, nz, fx, fz)) bed.z = nz; else bed.speed *= .25;

    // ---- crowd + SOLID contact (you cannot drive through people) ----
    const agents = crowd.step(dt);
    let nearest = 1e9;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const c = bedClosest(a.x, a.z, fx, fz);
      let dx = a.x - c.x, dz = a.z - c.z, d = Math.hypot(dx, dz);
      const minD = BED_R + a.r;
      if (d < minD) {                                   // impact: shove them, lose momentum
        if (d < 1e-4) { dx = fx; dz = fz; d = 1; }
        const ux = dx / d, uz = dz / d, pen = minD - d;
        a.x += ux * pen; a.z += uz * pen;               // person is pushed clear of the trolley
        a.vx += ux * 2.2; a.vz += uz * 2.2;             // and stumbles aside
        bed.x -= ux * pen * .35; bed.z -= uz * pen * .35;
        bed.speed *= .45;                               // the trolley jolts almost to a stop
      }
      crowdMeshes[i].position.set(a.x, 0, a.z);
      if (Math.hypot(a.vx, a.vz) > .1) crowdMeshes[i].rotation.y = Math.atan2(a.vx, a.vz);
      nearest = Math.min(nearest, d - minD);
    }
    const collided = nearest < 0, nearMiss = nearest >= 0 && nearest < .45;
    if (collided && !wasHit) { health -= 9; stats.hit++; }
    if (nearMiss && !wasHit) stats.miss++;
    wasHit = collided;
    health -= dt * 1.6;                                    // the patient is deteriorating

    // ---- prediction overlay (PERF: ~12 Hz, not every frame; it is O(agents^2 * steps)) ----
    // The robot reuses these same forecasts, so we never compute them twice.
    if (tick % 5 === 0) { lastPreds = Predictor.predict(agents, bed); drawPredictions(lastPreds); }

    // ---- both robots drive through the same crowd, as counterfactuals ----
    // They share a goal so you watch them pick different routes to the same place.
    for (const k of ['naive', 'predictive']) {
      const b = BOTS[k], ox = b.x, oz = b.z;
      b.step(dt, agents, lastPreds, LEVEL, SOLIDS, Predictor.DT);
      const moved = Math.hypot(b.x - ox, b.z - oz);
      if (k === 'naive') distN += moved; else distP += moved;
      syncRobot(b, RIGS[k], clock.elapsedTime);
    }
    if (BOTS.naive.gx !== BOTS.predictive.gx) {           // keep their targets identical
      BOTS.predictive.gx = BOTS.naive.gx; BOTS.predictive.gz = BOTS.naive.gz;
    }
    if (tick % 10 === 0 && Demo.current().panel === 'race') {
      const n = BOTS.naive, p = BOTS.predictive;
      $('rcHitN').textContent = n.stats.hits; $('rcHitP').textContent = p.stats.hits;
      $('rcStN').textContent = n.stallPct().toFixed(0) + '%';
      $('rcStP').textContent = p.stallPct().toFixed(0) + '%';
      $('rcDN').textContent = Math.round(distN); $('rcDP').textContent = Math.round(distP);
    }

    // ---- log (~10 Hz).  yaw = head orientation, which now differs from travel
    //      direction: exactly the extra signal Human Scene Transformer uses.
    if (tick % 6 === 0) Predictor.pushHistory(agents, bed);   // 10 Hz, feeds the learned model
    if (tick % 6 === 0) Telemetry.record({
      t: (performance.now() - t0) / 1000,
      player: { x: bed.x, z: bed.z, vx: fx * bed.speed, vz: fz * bed.speed,
                yaw: bed.heading + headYaw, heading: bed.heading, speed: bed.speed },
      action: lastAction,                    // the demonstration label
      goal: LEVEL.goal, crowd: agents, nearest, collided, nearMiss, health });
    tick++;

    // ---- hud ---- (distance measured from the BED: the patient is what must arrive)
    const d = Math.hypot(bed.x - LEVEL.goal.x, bed.z - LEVEL.goal.z);
    if (tick % 6 === 0) {
      $('vDist').textContent = d.toFixed(1) + ' m';
      $('vHit').textContent = stats.hit;
      $('barf').style.width = Math.max(0, health) + '%';
      $('vState').textContent = health > 66 ? 'STABLE' : health > 33 ? 'UNSTABLE' : 'CRITICAL';
      $('vState').style.color = health > 66 ? '#5ff3b4' : health > 33 ? '#ffc24d' : '#ff5a5a';
      $('dEps').textContent = Trainer.episodes.length;
      $('dRows').textContent = Telemetry.rows.length + Trainer.episodes.length * 0;
    }

    if (d < LEVEL.goal.r) finish(true);
    else if (health <= 0) finish(false);
  }

  // camera: first person while you drive, overhead while you watch the robots.
  // You cannot judge a robot's path from behind a gurney, so the act switches view.
  if (camMode === 'overhead') {
    const mx = (BOTS.naive.x + BOTS.predictive.x) / 2, mz = (BOTS.naive.z + BOTS.predictive.z) / 2;
    camAim.x += (mx - camAim.x) * Math.min(1, dt * 1.5);
    camAim.z += (mz - camAim.z) * Math.min(1, dt * 1.5);
    camera.position.set(camAim.x, 21, camAim.z + 13);
    camera.rotation.set(-1.02, 0, 0);
  } else {
    const cfx = -Math.sin(bed.heading), cfz = -Math.cos(bed.heading);
    camera.position.set(bed.x - cfx * PUSH, EYE, bed.z - cfz * PUSH);
    camera.rotation.set(PITCH, bed.heading + headYaw, 0);
  }
  updatePatient(clock.elapsedTime, health);     // breathing / pain, before we place the rig
  gurney.position.set(bed.x + (P.shakeX || 0), P.shakeY || 0, bed.z);
  gurney.rotation.y = bed.heading;
  goalDisc.rotation.y += dt * .6;

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function finish(won) {
  running = false;
  document.exitPointerLock?.();
  Trainer.addEpisode(Telemetry.frames);        // keep the run as training data
  const s = Telemetry.summary(), secs = ((performance.now() - t0) / 1000).toFixed(1);
  const o = $('over');
  o.innerHTML = `<h2 style="color:${won ? '#5ff3b4' : '#ff5a5a'}">
      ${won ? 'PATIENT DELIVERED' : 'PATIENT LOST'}</h2>
    <p>${secs}s · ${stats.hit} collisions · ${stats.miss} near-misses</p>
    <p style="color:#5ff3b4">${s.rows} trajectory rows logged across ${s.frames} frames</p>
    <p style="font-size:12px;color:#6c7a95;max-width:430px">ETH/UCY format, ready for
       Social GAN and Human Scene Transformer</p>
    <div style="margin-top:14px">
      <button id="bAgain">Run it again</button>
      <button id="bOnward" class="pri">Next: train on it ▸</button>
    </div>`;
  o.style.display = 'flex';
  // these live INSIDE the overlay, which sits above the control bar
  $('bAgain').onclick = () => { o.style.display = 'none'; reset(); renderer.domElement.requestPointerLock(); };
  $('bOnward').onclick = () => { o.style.display = 'none'; Demo.go(1); };
}

// ---------- the demo spine ----------
// One caption, one panel, SPACE advances. The presenter never has to explain
// mechanics, so the three minutes go on the story instead.
Demo.onEnter = a => {
  camMode = a.camera;
  $('xhair').style.display = a.camera === 'fp' ? 'block' : 'none';
  gurney.visible = a.camera === 'fp';
  if (a.id === 'robot') {                       // start the race clean and side by side
    for (const k of ['naive', 'predictive']) BOTS[k].stats = { hits: 0, stall: 0, t: 0 };
    BOTS.naive.trail.length = 0; BOTS.predictive.trail.length = 0;
    distN = distP = 0;
    // 1.5 m apart so both are visible from frame one. Negligible over a 60 s race,
    // and far better than two robots stacked on the same pixel.
    BOTS.predictive.x = BOTS.naive.x + 1.5; BOTS.predictive.z = BOTS.naive.z;
    BOTS.predictive.gx = BOTS.naive.gx; BOTS.predictive.gz = BOTS.naive.gz;
  }
  if (a.id === 'honest' && Study.results) {
    const open = Study.results.filter(r => r.geom === 'open floor' && r.hitGain !== null);
    if (open.length) $('hBig').textContent =
      '+' + Math.round(Math.max(...open.map(r => r.hitGain))) + '%';
  }
  if (a.camera === 'fp' && started) renderer.domElement.requestPointerLock();
};

function trainNow() {
  const b = $('bTrain');
  if (Trainer.busy) return;
  Trainer.addEpisode(Telemetry.frames);
  $('dBig').textContent = 'training…'; $('dSub').textContent = 'fitting on your trajectories';
  b.textContent = 'Training 0%';
  Trainer.train(
    p => { b.textContent = `Training ${(p * 100) | 0}%`; $('dBig').textContent = `${(p * 100) | 0}%`; },
    m => {
      b.textContent = 'Train on my runs (T)';
      if (m.error) { $('dBig').textContent = 'need more'; $('dSub').textContent = m.error; return; }
      const gain = 100 * (1 - m.fdeL / m.fdeB);
      $('dBig').innerHTML = `<span class="green">${gain >= 0 ? '-' : '+'}${Math.abs(gain).toFixed(0)}%</span> error`;
      $('dSub').textContent = `at 1.6 s ahead, against a constant-velocity baseline, on held-out data`;
      $('aMode').textContent = 'learned MLP';
      $('aAde').textContent = `${m.adeB.toFixed(2)} → ${m.adeL.toFixed(2)} m`;
      $('aFde').textContent = `${m.fdeB.toFixed(2)} → ${m.fdeL.toFixed(2)} m`;
    });
}

// ---- behaviour cloning: the human's own driving becomes the controller ----
function setDrive(mode) {
  Policy.drive = mode;
  $('cDrive').textContent = mode === 'human' ? 'human' : mode === 'auto' ? 'cloned policy' : 'whole ward';
  $('cDrive').style.color = mode === 'human' ? '#e8edf7' : '#5ff3b4';
  $('bWorld').classList.toggle('pri', mode === 'world');
}
function cloneNow() {
  if (Policy.busy) return;
  Trainer.addEpisode(Telemetry.frames);                 // include the run in progress
  const eps = Trainer.episodes;
  $('cBig').textContent = 'cloning…';
  Policy.train(eps, LEVEL.walls,
    p => $('cBig').textContent = `${(p * 100) | 0}%`,
    m => {
      if (m.error) { $('cBig').textContent = 'need more'; $('cSub').textContent = m.error; return; }
      $('cBig').innerHTML = '<span class="green">trained</span>';
      $('cSub').textContent = `held-out action error ${m.err.toFixed(2)} (normalised). Press C to hand over the controls.`;
      $('cFrames').textContent = m.frames;
      setDrive('auto');
    });
}
$('bClone').onclick = () => Policy.trained ? setDrive(Policy.drive === 'auto' ? 'human' : 'auto') : cloneNow();
$('bWorld').onclick = () => {
  if (!Policy.trained) return cloneNow();
  setDrive(Policy.drive === 'world' ? 'auto' : 'world');
};
$('bNext').onclick = () => Demo.next();
$('bRestart').onclick = () => { reset(); if (camMode === 'fp') renderer.domElement.requestPointerLock(); };
$('bAdv').onclick = () => {
  const a = $('adv'); a.style.display = a.style.display === 'block' ? 'none' : 'block';
};
$('bTrain').onclick = trainNow;
$('bData').onclick = () => Telemetry.download();

$('bStudy').onclick = () => {
  if (Study.busy) return;
  const b = $('bStudy'); b.textContent = 'Running 0%';
  Study.run(p => b.textContent = `Running ${(p * 100) | 0}%`, rows => {
    b.textContent = 'Run stratified study';
    const cell = v => {
      if (v === null) return '<td class="flat">n/a</td>';
      const cls = Math.abs(v) < 8 ? 'flat' : (v > 0 ? 'good' : 'bad');
      return `<td class="${cls}">${v >= 0 ? '+' : ''}${v.toFixed(0)}%</td>`;
    };
    let h = `<table><tr><th>geometry</th><th>density</th><th>hits/min</th><th>frozen</th>
      <th>m/min</th><th>hits</th><th>frozen</th><th>throughput</th></tr>`;
    for (const r of rows)
      h += `<tr><td>${r.geom}</td><td>${r.density} (${r.n})</td>
        <td>${r.naive.hits.toFixed(1)} → ${r.pred.hits.toFixed(1)}</td>
        <td>${r.naive.stall.toFixed(0)}% → ${r.pred.stall.toFixed(0)}%</td>
        <td>${r.naive.dist.toFixed(0)} → ${r.pred.dist.toFixed(0)}</td>
        ${cell(r.hitGain)}${cell(r.stallGain)}${cell(r.distGain)}</tr>`;
    $('studyTable').innerHTML = h + '</table>';
    $('study').style.display = 'block';
    Demo.onEnter(Demo.current());                 // refresh the Act 4 headline number
  });
};
$('sClose').onclick = () => $('study').style.display = 'none';
$('sCopy').onclick = () => navigator.clipboard?.writeText(Study.asText());

addEventListener('keydown', e => {
  if (!started) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); Demo.next(); }
  else if (k === 't') trainNow();
  else if (k === 'c') $('bClone').click();
  else if (k === 'v') $('bWorld').click();
  else if (k === 'a') $('bAdv').click();
  else if (k === 'escape') $('study').style.display = 'none';
});

// ---- hands-off cues: the 60 s sequence drives itself ----
Demo.onCue = cue => {
  if (cue === 'scripted') { reset(); Policy.drive = 'scripted'; ScriptedDriver.reset(); }
  else if (cue === 'train') { if (!Trainer.busy) trainNow(); }
  else if (cue === 'clone') {
    if (Policy.trained) setDrive('auto');
    else { cloneNow(); Policy.drive = 'scripted'; }     // keep moving while it fits
  } else if (cue === 'world') { if (Policy.trained) setDrive('world'); }
  else if (cue === 'end') {
    Demo.stopAuto();
    $('over').innerHTML = `<h2 style="color:#5ff3b4">Human demonstrations in. Robot behaviour out.</h2>
      <p>Every run logs (observation, action) pairs. A policy clones them. A robot plans with them.</p>
      <p style="color:#8792ad;font-size:13px">ETH/UCY compatible · Social GAN and Human Scene Transformer</p>
      <div style="margin-top:14px">
        <button id="bReplay" class="pri">Replay the 60s</button>
        <button id="bTake">Drive it yourself</button></div>`;
    $('over').style.display = 'flex';
    $('bReplay').onclick = () => { $('over').style.display = 'none'; startAuto(); };
    $('bTake').onclick = () => { $('over').style.display = 'none'; Demo.stopAuto();
      Policy.drive = 'human'; reset(); Demo.go(0); renderer.domElement.requestPointerLock(); };
  }
};

function startAuto() {
  started = true; $('start').style.display = 'none';
  reset(); Demo.startAuto(); Demo.go(0);
  Policy.drive = 'scripted'; ScriptedDriver.reset();
}
$('bAuto').onclick = startAuto;
$('bDrive').onclick = () => {
  started = true; $('start').style.display = 'none';
  Demo.stopAuto(); Policy.drive = 'human'; reset(); Demo.go(0);
  renderer.domElement.requestPointerLock();
};

Demo.go(0);


reset(); started = false; loop();
