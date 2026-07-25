// ============================================================================
// OWNER: P1 / lead  —  FIRST-PERSON CONTROLLER + CORE LOOP + WIRING
// Keep GAME RULES here only. Art -> level.js (P2) / crowd -> crowd.js (P3) /
// data -> telemetry.js (P4) / prediction -> predict.js (P5).
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
scene.add(new THREE.HemisphereLight(0x4a5a7a, 0x0a0c14, 0.75));
const key = new THREE.DirectionalLight(0xffffff, 0.55);
key.position.set(6, 20, 8); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -22, right: 22, top: 26, bottom: -26, near: 1, far: 60 });
scene.add(key);
// ceiling strip lights down the corridor
for (let z = -18; z <= 18; z += 6) {
  const l = new THREE.PointLight(0xbfd8ff, 26, 16, 2); l.position.set(0, 4.2, z); scene.add(l);
  const s = new THREE.Mesh(new THREE.BoxGeometry(2.4, .1, .3),
    new THREE.MeshBasicMaterial({ color: 0xdce9ff })); s.position.set(0, 4.3, z); scene.add(s);
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

// ---------- the gurney you push (visible in front of the camera) ----------
const gurney = new THREE.Group();
{
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, .12, 2.0),
    new THREE.MeshStandardMaterial({ color: 0xcfd8e8, metalness: .5, roughness: .35 }));
  frame.position.y = .78; gurney.add(frame);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.28, 1.0, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x8fa8c8 }));
  body.rotation.x = Math.PI / 2; body.position.set(0, .98, -.1); gurney.add(body);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(.9, .1, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x2f6fbf })); blanket.position.set(0, .93, .2); gurney.add(blanket);
  for (const [dx, dz] of [[-.42, -.85], [.42, -.85], [-.42, .85], [.42, .85]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .07, 12),
      new THREE.MeshStandardMaterial({ color: 0x222833 }));
    w.rotation.z = Math.PI / 2; w.position.set(dx, .12, dz); gurney.add(w);
  }
}
scene.add(gurney);

// ---------- crowd meshes ----------
const KIND_COLOR = { nurse: 0x5fb0f3, patient: 0xd8dce6, rusher: 0xffc24d };
let crowd, crowdMeshes = [];
function buildCrowdMeshes() {
  crowdMeshes.forEach(m => scene.remove(m)); crowdMeshes = [];
  crowd.agents.forEach(a => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.26, .95, 4, 10),
      new THREE.MeshStandardMaterial({ color: KIND_COLOR[a.kind] || 0x9aa4b8, roughness: .7 }));
    body.position.y = .78; body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.2, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xe7d3bd })); head.position.y = 1.5; g.add(head);
    scene.add(g); crowdMeshes.push(g);
  });
}

// ---------- prediction overlay ----------
const predGroup = new THREE.Group(); scene.add(predGroup);
let showPredict = true;
function drawPredictions(preds) {
  predGroup.clear();
  if (!showPredict) return;
  for (const p of preds) {
    const pts = p.path.map(q => new THREE.Vector3(q.x, .1 + p.risk * .05, q.z));
    const col = new THREE.Color().setHSL(0.42 - 0.42 * p.risk, .9, .55);   // green -> red
    predGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: .25 + p.risk * .7 })));
    const end = p.path[p.path.length - 1];
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.09 + p.risk * .1, 10, 8),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .5 + p.risk * .5 }));
    dot.position.set(end.x, .12, end.z); predGroup.add(dot);
    if (p.risk > .55) {                                   // warning ring on the floor
      const ring = new THREE.Mesh(new THREE.RingGeometry(.5, .68, 24),
        new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: p.risk * .7,
                                      side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(end.x, .06, end.z); predGroup.add(ring);
    }
  }
}

// ---------- the gurney IS the vehicle: car-like (bicycle) model ----------
// You push from behind. Wheels only steer while rolling, so it handles like a real trolley.
const MAX_FWD = 3.6, MAX_REV = 1.2, ACCEL = 6.0, DRAG = 1.8, TURN = 2.2;
const BED_R = .5, BED_HALF = .9;          // trolley = capsule: radius + half its length
const PUSH = 1.7, EYE = 1.6, PITCH = -0.1;
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
  headYaw = 0;
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
    // wheels bite only while rolling; steering naturally inverts when reversing
    bed.heading += steer * TURN * (bed.speed / MAX_FWD) * dt;

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

    // ---- prediction overlay ----
    drawPredictions(Predictor.predict(agents, bed));

    // ---- log (~10 Hz).  yaw = head orientation, which now differs from travel
    //      direction: exactly the extra signal Human Scene Transformer uses.
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
  gurney.position.set(bed.x, 0, bed.z);
  gurney.rotation.y = bed.heading;
  goalDisc.rotation.y += dt * .6;

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function finish(won) {
  running = false;
  document.exitPointerLock?.();
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
$('bRestart').onclick = () => { reset(); renderer.domElement.requestPointerLock(); };
$('bData').onclick = () => Telemetry.download();
$('bPredict').onclick = () => {
  showPredict = !showPredict;
  $('bPredict').classList.toggle('on', showPredict);
  if (!showPredict) predGroup.clear();
};
$('start').onclick = () => {
  $('start').style.display = 'none'; started = true;
  renderer.domElement.requestPointerLock();
};

reset(); started = false; loop();
