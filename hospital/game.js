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

let crowd, crowdMeshes = [], lastPreds = null;
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

// ---------- the autonomous delivery robot ----------
const robotMesh = new THREE.Group();
{
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(.32, .36, .8, 18),
    new THREE.MeshStandardMaterial({ color: 0x123240, emissive: 0x0a3a47,
                                     emissiveIntensity: .55, metalness: .35, roughness: .4 }));
  shell.position.y = .42; shell.castShadow = true; robotMesh.add(shell);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x0d1c24, roughness: .35 }));
  head.position.y = .92; robotMesh.add(head);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(.075, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x38e1ff }));
  eye.position.set(0, .92, .2); robotMesh.add(eye);
  robotMesh.userData.eye = eye.material;
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(.4, .16, .3),
    new THREE.MeshStandardMaterial({ color: 0xe8eef7 }));
  cargo.position.y = .9; robotMesh.add(cargo);
}
scene.add(robotMesh);
// ring showing what the robot is planning against
const robotRing = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.2, 36),
  new THREE.MeshBasicMaterial({ color: 0xffc24d, transparent: true, opacity: .3,
                               side: THREE.DoubleSide }));
robotRing.rotation.x = -Math.PI / 2; scene.add(robotRing);

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
  headYaw = 0; lastPreds = null;
  Robot.reset(LEVEL, SOLIDS);
  health = 100; running = true; wasHit = false; tick = 0;
  stats = { hit: 0, miss: 0 }; Telemetry.reset(); t0 = performance.now();
  document.getElementById('over').style.display = 'none';
}

const $ = id => document.getElementById(id);
const clock = new THREE.Clock();

function loop() {
  const dt = Math.min(clock.getDelta(), .05);
  if (started && running) {
    // ---- trolley physics: W/S drive, A/D steer the wheels ----
    const throttle = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
    const steer    = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
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

    // ---- the robot drives itself through the same crowd ----
    Robot.step(dt, agents, lastPreds, LEVEL, SOLIDS, Predictor.DT);
    robotMesh.position.set(Robot.x, 0, Robot.z);
    if (Math.hypot(Robot.vx, Robot.vz) > .05)
      robotMesh.rotation.y = Math.atan2(Robot.vx, Robot.vz);
    robotRing.position.set(Robot.x, .04, Robot.z);
    const stalled = Math.hypot(Robot.vx, Robot.vz) < .35;
    robotRing.material.color.setHex(stalled ? 0xff5a5a : (Robot.mode === 'predictive' ? 0x5ff3b4 : 0xffc24d));
    robotMesh.userData.eye.color.setHex(stalled ? 0xff5a5a : 0x38e1ff);
    if (tick % 12 === 0) {
      $('rHits').textContent = Robot.stats.hits;
      $('rStall').textContent = Robot.stats.stall.toFixed(1) + 's';
      $('rRate').textContent = Robot.stats.t > 3
        ? (Robot.stats.hits / (Robot.stats.t / 60)).toFixed(1) + ' hits/min' : '-';
    }

    // ---- log (~10 Hz).  yaw = head orientation, which now differs from travel
    //      direction: exactly the extra signal Human Scene Transformer uses.
    if (tick % 6 === 0) Predictor.pushHistory(agents, bed);   // 10 Hz, feeds the learned model
    if (tick % 6 === 0) Telemetry.record({
      t: (performance.now() - t0) / 1000,
      player: { x: bed.x, z: bed.z, vx: fx * bed.speed, vz: fz * bed.speed,
                yaw: bed.heading + headYaw },
      goal: LEVEL.goal, crowd: agents, nearest, collided, nearMiss, health });
    tick++;

    // ---- hud ---- (distance measured from the BED: the patient is what must arrive)
    const d = Math.hypot(bed.x - LEVEL.goal.x, bed.z - LEVEL.goal.z);
    $('dist').textContent = d.toFixed(1) + ' m';
    $('vTime').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
    $('vHit').textContent = stats.hit; $('vMiss').textContent = stats.miss;
    $('vLog').textContent = Telemetry.frames.length;
    $('barf').style.width = Math.max(0, health) + '%';
    $('vState').textContent = health > 66 ? 'STABLE' : health > 33 ? 'UNSTABLE' : 'CRITICAL';
    $('vState').style.color = health > 66 ? '#5ff3b4' : health > 33 ? '#ffc24d' : '#ff5a5a';

    if (d < LEVEL.goal.r) finish(true);
    else if (health <= 0) finish(false);
  }

  // you walk BEHIND the trolley; your head can look around independently
  const cfx = -Math.sin(bed.heading), cfz = -Math.cos(bed.heading);
  camera.position.set(bed.x - cfx * PUSH, EYE, bed.z - cfz * PUSH);
  camera.rotation.set(PITCH, bed.heading + headYaw, 0);
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
  $('mEps').textContent = Trainer.episodes.length;
  const s = Telemetry.summary(), secs = ((performance.now() - t0) / 1000).toFixed(1);
  const o = $('over');
  o.innerHTML = `<h2 style="color:${won ? '#5ff3b4' : '#ff5a5a'}">
      ${won ? 'PATIENT DELIVERED' : 'PATIENT LOST'}</h2>
    <p>${secs}s · ${stats.hit} collisions · ${stats.miss} near-misses</p>
    <p style="color:#5ff3b4">${s.rows} trajectory rows logged across ${s.frames} frames</p>
    <p style="font-size:12px;color:#6c7a95;max-width:430px">ETH/UCY format, ready for
       Social GAN and Human Scene Transformer</p>
    <div style="margin-top:14px">
      <button id="bAgain">Try again</button>
      <button id="bDl">Download data</button>
    </div>`;
  o.style.display = 'flex';
  // these live INSIDE the overlay: #over sits above #btns, so the bottom bar is unclickable here
  $('bAgain').onclick = () => { reset(); renderer.domElement.requestPointerLock(); };
  $('bDl').onclick = () => Telemetry.download();
}

// ---------- ui ----------
// Train on the runs just played: the loop from human behaviour to a working model,
// closed live in front of the judges.
$('bTrain').onclick = () => {
  const b = $('bTrain');
  if (Trainer.busy) return;
  Trainer.addEpisode(Telemetry.frames);                    // include the run in progress
  $('mEps').textContent = Trainer.episodes.length;
  b.textContent = 'Training 0%';
  Trainer.train(
    p => b.textContent = `Training ${(p * 100) | 0}%`,
    m => {
      if (m.error) { b.textContent = m.error; setTimeout(() => b.textContent = 'Train on my runs', 2600); return; }
      b.textContent = 'Retrain'; b.classList.add('on');
      $('mMode').textContent = 'learned MLP';
      $('mMode').style.color = '#5ff3b4';
      $('mScores').style.display = 'block';
      $('mAdeB').textContent = m.adeB.toFixed(2) + ' m';
      $('mAdeL').textContent = m.adeL.toFixed(2) + ' m';
      $('mFdeB').textContent = m.fdeB.toFixed(2) + ' m';
      $('mFdeL').textContent = m.fdeL.toFixed(2) + ' m';
      const gain = 100 * (1 - m.fdeL / m.fdeB);            // FDE: the 1.6 s horizon
      $('mGain').textContent = (gain >= 0 ? '+' : '') + gain.toFixed(0) + '%';
      $('mGain').style.color = gain > 0 ? '#5ff3b4' : '#ffc24d';
      $('mEps').textContent = `${m.episodes} (${m.samples} samples)`;
    });
};
// The headline comparison: same controller, same map, only the planning input changes.
$('bRobot').onclick = () => {
  Robot.mode = Robot.mode === 'naive' ? 'predictive' : 'naive';
  Robot.stats = { hits: 0, stall: 0, t: 0 };            // reset so the two are comparable
  const pred = Robot.mode === 'predictive';
  $('bRobot').textContent = 'Robot: ' + Robot.mode;
  $('bRobot').classList.toggle('on', pred);
  $('rMode').textContent = Robot.mode;
  $('rMode').style.color = pred ? '#5ff3b4' : '#ffc24d';
};
$('bRestart').onclick = () => { reset(); renderer.domElement.requestPointerLock(); };
$('bData').onclick = () => Telemetry.download();
$('bPredict').onclick = () => {
  showPredict = !showPredict;
  $('bPredict').classList.toggle('on', showPredict);
  if (!showPredict) hidePredictions();     // hide, never clear: the pool owns these objects
};
$('start').onclick = () => {
  $('start').style.display = 'none'; started = true;
  renderer.domElement.requestPointerLock();
};

reset(); started = false; loop();
