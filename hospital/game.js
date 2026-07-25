// ============================================================================
// OWNER: P1 / lead  —  FIRST-PERSON CONTROLLER + CORE LOOP + WIRING
// Keep GAME RULES here only. Art -> level.js (P2) / crowd -> crowd.js (P3) /
// data -> telemetry.js (P4) / prediction -> predict.js (P5).
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

Assets.init(THREE, GLTFLoader);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1220);
scene.fog = new THREE.Fog(0x0c1220, 20, 62);   // far enough back to see the props
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 200);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- lights ----------
// The GLB props are flat-shaded with baked-in colour, so they read as
// silhouettes unless the ambient term is well up.
scene.add(new THREE.HemisphereLight(0x9db4d8, 0x39445c, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(6, 20, 8); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -22, right: 22, top: 26, bottom: -26, near: 1, far: 60 });
scene.add(key);
// ceiling strip lights down the corridor
for (let z = -18; z <= 18; z += 6) {
  const l = new THREE.PointLight(0xbfd8ff, 40, 22, 2); l.position.set(0, 4.2, z); scene.add(l);
  const s = new THREE.Mesh(new THREE.BoxGeometry(2.4, .1, .3),
    new THREE.MeshBasicMaterial({ color: 0xdce9ff })); s.position.set(0, 4.3, z); scene.add(s);
}
// the side bays are off the lit corridor, so give each one its own ceiling lamp
for (const [x, z] of [[-12, 14], [12, 6], [-12, -2], [-12, -14], [11, -16]]) {
  const l = new THREE.PointLight(0xcfe0ff, 22, 14, 2); l.position.set(x, 3.4, z); scene.add(l);
}
// vestibule (entrance.glb) — brighter so the lobby materials read clearly
for (const z of [23, 27]) {
  const l = new THREE.PointLight(0xe8f0ff, 50, 16, 2); l.position.set(0, 3.2, z); scene.add(l);
}
const orLight = new THREE.PointLight(0x5ff3b4, 90, 26, 2);
orLight.position.set(LEVEL.goal.x, 4, LEVEL.goal.z); scene.add(orLight);

// ---------- static world ----------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(LEVEL.bounds.x * 2, LEVEL.bounds.z * 2),
  new THREE.MeshStandardMaterial({ color: 0x39435c, roughness: .85 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(Math.max(LEVEL.bounds.x, LEVEL.bounds.z) * 2, 28, 0x4a5878, 0x3b4763);
grid.position.y = .02; grid.material.transparent = true; grid.material.opacity = .22; scene.add(grid);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x5c6884, roughness: .8 });
for (const w of LEVEL.walls) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, 3.2, w.d), wallMat);
  m.position.set(w.x, 1.6, w.z); m.castShadow = m.receiveShadow = true; scene.add(m);
}
// GLB props from ../assets/models. Wait up to 15s, then dress the ward with
// whatever arrived; missing keys are skipped by buildProps / Assets.make.
// Only if nothing loaded do we fall back to the primitive furniture.
const preloadKeys = [...propKeys(), 'gurney', 'entrance', ...Object.values(kindModels())];
const preloadP = Assets.preload(preloadKeys);
await Promise.race([
  preloadP,
  new Promise(r => setTimeout(r, 15000)),
]);
if (Assets.loaded < preloadKeys.length)
  console.warn('[assets] ready with', Assets.loaded, '/', preloadKeys.length,
               Assets.failed.length ? '; missing: ' + Assets.failed.join(', ') : '');
const SOLIDS = Assets.loaded ? buildProps(THREE, scene) : buildFurniture(THREE, scene);

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
const gurney = Assets.make('gurney') || buildBoxGurney();
scene.add(gurney);

function buildBoxGurney() {                    // stand-in if the GLB is missing
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, .12, 2.0),
    new THREE.MeshStandardMaterial({ color: 0xcfd8e8, metalness: .5, roughness: .35 }));
  frame.position.y = .78; g.add(frame);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.28, 1.0, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x8fa8c8 }));
  body.rotation.x = Math.PI / 2; body.position.set(0, .98, -.1); g.add(body);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(.9, .1, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x2f6fbf })); blanket.position.set(0, .93, .2); g.add(blanket);
  for (const [dx, dz] of [[-.42, -.85], [.42, -.85], [-.42, .85], [.42, .85]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .07, 12),
      new THREE.MeshStandardMaterial({ color: 0x222833 }));
    w.rotation.z = Math.PI / 2; w.position.set(dx, .12, dz); g.add(w);
  }
  return g;
}

// ---------- crowd meshes ----------
const KIND_COLOR = { nurse: 0x5fb0f3, patient: 0xd8dce6, rusher: 0xffc24d };
let crowd, crowdMeshes = [];

// One staff model per kind, so the corridor isn't 22 copies of one person.
// Declared as a function because the preload above runs before this section.
function kindModels() {
  return { nurse: 'staff_nurse', patient: 'staff_doctor', rusher: 'staff_surgeon' };
}

function buildCrowdMeshes() {
  crowdMeshes.forEach(m => scene.remove(m)); crowdMeshes = [];
  const models = kindModels(), tinted = new Map();
  crowd.agents.forEach(a => {
    const g = Assets.make(models[a.kind]) || buildCapsulePerson(a.kind);
    // A light tint toward the kind colour keeps nurse / patient / rusher
    // readable at a glance without washing out the scrubs and coats the models
    // already wear. Tinted materials are cached per kind so the whole crowd
    // still shares a handful of them.
    const tint = new THREE.Color(KIND_COLOR[a.kind] || 0x9aa4b8);
    g.traverse(o => {
      if (!o.isMesh) return;
      const cacheKey = a.kind + o.material.uuid;      // key on the shared original
      const cached = tinted.get(cacheKey);
      if (cached) { o.material = cached; return; }
      o.material = o.material.clone();
      o.material.color.lerp(tint, .18);
      tinted.set(cacheKey, o.material);
    });
    scene.add(g); crowdMeshes.push(g);
  });
}

function buildCapsulePerson(kind) {            // stand-in if the GLB is missing
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.26, .95, 4, 10),
    new THREE.MeshStandardMaterial({ color: KIND_COLOR[kind] || 0x9aa4b8, roughness: .7 }));
  body.position.y = .78; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.2, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xe7d3bd })); head.position.y = 1.5; g.add(head);
  return g;
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

// ---------- player state + first-person controls ----------
const SPEED = 3.4, PR = .62, EYE = 1.6, PITCH = -0.13;   // yaw 0 = looking down -z, toward the OR
const player = { x: LEVEL.spawn.x, z: LEVEL.spawn.z, vx: 0, vz: 0, yaw: 0 };
camera.rotation.order = 'YXZ';
const keys = {};
addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (e.key === ' ') e.preventDefault(); });
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement) player.yaw -= e.movementX * 0.0022;
});

function hitsWall(x, z) {
  for (const w of LEVEL.walls)
    if (Math.abs(x - w.x) < w.w / 2 + PR && Math.abs(z - w.z) < w.d / 2 + PR) return true;
  for (const s of SOLIDS) if (Math.hypot(x - s.x, z - s.z) < s.r + PR) return true;
  return false;
}

// ---------- run state ----------
let health, running, started, t0, tick, wasHit, stats;
function reset() {
  crowd = createCrowd(LEVEL, SOLIDS); buildCrowdMeshes();
  player.x = LEVEL.spawn.x; player.z = LEVEL.spawn.z; player.yaw = 0;
  player.vx = player.vz = 0;
  health = 100; running = true; wasHit = false; tick = 0;
  stats = { hit: 0, miss: 0 }; Telemetry.reset(); t0 = performance.now();
  document.getElementById('over').style.display = 'none';
}

const $ = id => document.getElementById(id);
const clock = new THREE.Clock();

function loop() {
  const dt = Math.min(clock.getDelta(), .05);
  if (started && running) {
    // ---- movement (relative to where you're looking) ----
    const f = (keys['w'] || keys['arrowup'] ? 1 : 0) - (keys['s'] || keys['arrowdown'] ? 1 : 0);
    const r = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    let dx = (-sin * f + cos * r), dz = (-cos * f - sin * r);
    const m = Math.hypot(dx, dz) || 1;
    player.vx = dx / m * SPEED * (f || r ? 1 : 0);
    player.vz = dz / m * SPEED * (f || r ? 1 : 0);
    const nx = player.x + player.vx * dt, nz = player.z + player.vz * dt;
    if (!hitsWall(nx, player.z)) player.x = nx;
    if (!hitsWall(player.x, nz)) player.z = nz;

    // ---- crowd + contact ----
    const agents = crowd.step(dt);
    let nearest = 1e9;
    agents.forEach((a, i) => {
      crowdMeshes[i].position.set(a.x, 0, a.z);
      if (Math.hypot(a.vx, a.vz) > .1) crowdMeshes[i].rotation.y = Math.atan2(a.vx, a.vz);
      nearest = Math.min(nearest, Math.hypot(player.x - a.x, player.z - a.z) - a.r - PR);
    });
    const collided = nearest < 0, nearMiss = nearest >= 0 && nearest < .45;
    if (collided && !wasHit) { health -= 9; stats.hit++; }
    if (nearMiss && !wasHit) stats.miss++;
    wasHit = collided;
    health -= dt * 1.6;                                    // the patient is deteriorating

    // ---- prediction overlay ----
    drawPredictions(Predictor.predict(agents, player));

    // ---- log (~10 Hz) ----
    if (tick % 6 === 0) Telemetry.record({
      t: (performance.now() - t0) / 1000, player, goal: LEVEL.goal, crowd: agents,
      nearest, collided, nearMiss, health });
    tick++;

    // ---- hud ----
    const d = Math.hypot(player.x - LEVEL.goal.x, player.z - LEVEL.goal.z);
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

  // camera follows the player's head; gurney sits just in front
  camera.position.set(player.x, EYE, player.z);
  camera.rotation.set(PITCH, player.yaw, 0);
  gurney.position.set(player.x - Math.sin(player.yaw) * 2.1, 0, player.z - Math.cos(player.yaw) * 2.1);
  gurney.rotation.y = player.yaw;
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
      ${won ? 'Patient delivered to the OR' : 'Patient lost'}</h2>
    <p>${secs}s · ${stats.hit} collisions · ${stats.miss} near-misses</p>
    <p style="color:#5ff3b4">${s.rows} trajectory rows logged across ${s.frames} frames</p>
    <p>Download data &rarr; ETH/UCY format, ready for Social GAN / HST</p>`;
  o.style.display = 'flex';
}

// ---------- ui ----------
$('bRestart').onclick = () => { reset(); renderer.domElement.requestPointerLock(); };
$('bData').onclick = () => Telemetry.download();
$('bPredict').onclick = () => {
  showPredict = !showPredict;
  $('bPredict').classList.toggle('on', showPredict);
  if (!showPredict) predGroup.clear();
};
// This module top-level-awaits the models, so reaching here means the world is
// dressed — only now does the overlay become clickable.
$('go').textContent = 'Click to start';
$('go').classList.remove('wait');
$('start').onclick = () => {
  $('start').style.display = 'none'; started = true;
  renderer.domElement.requestPointerLock();
};

reset(); started = false; loop();
