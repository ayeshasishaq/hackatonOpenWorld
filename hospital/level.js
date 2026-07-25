// ============================================================================
// OWNER: P2  —  ENVIRONMENT / LEVEL DESIGN
// Your job: make it look and feel like a real hospital.
//   1. Shape the floorplan below (walls = corridors + rooms).
//   2. Dress it with GLB props (see PROPS + buildProps(); models: assets.js).
// Coordinates: x = left/right, z = depth, y = up. Units are metres.
// You do NOT need to touch any other file.
// ============================================================================

const LEVEL = {
  bounds: { x: 14, z: 20 },              // half-extents of the hospital floor
  spawn:  { x: 0,  z: 17 },              // gurney starts at the ER entrance
  goal:   { x: 0,  z: -17, r: 2.2 },     // the operating room, far end

  // Walls = boxes {x, z, w, d}  (w = size along X, d = size along Z).
  // TODO P2: build a believable ward — corridors, side rooms, a nurse station.
  walls: [
    // outer shell
    { x: 0,   z: -20, w: 28,  d: 0.6 },
    { x: 0,   z:  20, w: 28,  d: 0.6 },
    { x: -14, z: 0,   w: 0.6, d: 40  },
    { x: 14,  z: 0,   w: 0.6, d: 40  },
    // corridor pinch points — these create the interesting avoidance moments
    { x: -8,  z: 10,  w: 11,  d: 0.6 },
    { x: 9,   z: 10,  w: 9,   d: 0.6 },
    { x: -9,  z: 2,   w: 9,   d: 0.6 },
    { x: 8,   z: 2,   w: 11,  d: 0.6 },
    { x: -7,  z: -7,  w: 13,  d: 0.6 },
    { x: 9,   z: -7,  w: 9,   d: 0.6 },
    // side-room dividers, each split to leave a 2.4 m doorway — without the
    // opening the bays are sealed and the player never sees what is in them
    { x: -10, z: 11.25, w: 0.6, d: 1.5 },
    { x: -10, z: 16.95, w: 0.6, d: 5.1 },
    { x: 10,  z: 3.5,   w: 0.6, d: 3   },
    { x: 10,  z: 8.7,   w: 0.6, d: 2.6 },
    { x: -10, z: -5,    w: 0.6, d: 3   },
    { x: -10, z: 0.7,   w: 0.6, d: 3.6 },
  ],

  crowdCount: 22,                        // staff + patients moving around (P3)
};

// ---------------------------------------------------------------------------
// GLB PROPS.  key = a model in Assets.CATALOG (see assets.js), placed at x/z on
// the floor. rot = yaw in radians. y lifts wall-mounted and tabletop props off
// the floor; anything above 0.3 m is decoration and gets no collider, as does
// anything with a footprint radius under 0.15 m (tabletop clutter).
// solid:false opts a floor-level prop out of collision (doors sit flush in walls).
// Keep the list to models already in ../assets/models — nothing is fetched live.
// ---------------------------------------------------------------------------
const PROPS = [
  // --- entrance / waiting area (north of the z=10 wall, player spawns at z=17)
  { key: 'ambulance',       x:  10,    z:  17.4, rot: 0 },
  { key: 'hospital_sign',   x:   0,    z:  19.6, rot: Math.PI / 2, y: 2.3 },
  { key: 'waiting_chair_1', x:   5.5,  z:  17,   rot: Math.PI },
  { key: 'waiting_chair_1', x:   6.6,  z:  17,   rot: Math.PI },
  { key: 'waiting_chair_1', x:   7.7,  z:  17,   rot: Math.PI },
  { key: 'waiting_chair_1', x:   4.4,  z:  17,   rot: Math.PI },
  { key: 'waiting_chair_2', x:  -4,    z:  16,   rot: Math.PI / 2 },
  { key: 'waiting_chair_2', x:  -4,    z:  13.5, rot: Math.PI / 2 },
  { key: 'vending',         x:  13.1,  z:  12,   rot: -Math.PI / 2 },
  { key: 'biohazard_bin_1', x:  11.8,  z:  12.9, rot: 0 },
  { key: 'exit_sign',       x:   2,    z:  10.4, rot: Math.PI / 2, y: 2.7 },

  // --- bay A: behind the x=-10 divider, z 10.5 to 19.5
  { key: 'patient_bed_1',   x: -12,    z:  14,   rot: 0 },
  { key: 'patient_bed_2',   x: -12,    z:  17.5, rot: 0 },
  { key: 'bedside_table',   x: -12.9,  z:  12.4, rot: Math.PI / 2 },
  { key: 'stethoscope',     x: -12.9,  z:  12.4, rot: 0.5, y: 0.7 },
  { key: 'vitals_monitor_2', x: -13.6, z:  14,   rot: Math.PI / 2, y: 1.5 },
  { key: 'privacy_curtain', x: -10.6,  z:  16,   rot: Math.PI / 2 },
  { key: 'door',            x:  -9.65, z:  18,   rot: Math.PI / 2, solid: false },

  // --- middle corridor, z 2 to 10
  { key: 'triage_cot_1',    x: -12,    z:   8,   rot: 0 },
  { key: 'triage_cot_2',    x: -12,    z:   5,   rot: 0 },
  { key: 'crutches',        x: -13.3,  z:   3.4, rot: 0.3 },
  { key: 'wheelchair',      x:  -6,    z:   7.6, rot: 0.6 },
  { key: 'desk_chair',      x:   6,    z:   7.4, rot: 0.7 },
  { key: 'reception_bell',  x:   5.1,  z:   6.4, rot: 0, y: 0.92 },
  { key: 'first_aid',       x:   7.2,  z:   6.4, rot: 0, y: 0.92 },
  // the one monitor with a stand goes on the counter, not on a wall
  { key: 'vitals_monitor_1', x:  6.2,  z:   6.6, rot: 0.15, y: 0.95 },
  { key: 'door',            x:  -6,    z:   9.65, rot: 0, solid: false },
  { key: 'biohazard_bin_2', x:   2.6,  z:   4.5, rot: 0 },

  // --- bay B: behind the x=10 divider, z 2 to 10
  { key: 'patient_bed_2',   x:  12,    z:   8,   rot: 0 },
  { key: 'bedside_table',   x:  12.9,  z:   6.3, rot: -Math.PI / 2 },
  { key: 'syringe',         x:  12.9,  z:   6.3, rot: 0.4, y: 0.72 },
  { key: 'bandage',         x:  12.75, z:   6.05, rot: 1.1, y: 0.71 },
  { key: 'vitals_monitor_2', x: 13.6,  z:   8,   rot: Math.PI / 2, y: 1.4 },
  { key: 'privacy_curtain', x:  10.6,  z:   4,   rot: Math.PI / 2 },
  { key: 'door',            x:   8,    z:   2.35, rot: Math.PI, solid: false },

  // --- bay C: behind the x=-10 divider, z -6.5 to 2.5
  { key: 'patient_bed_1',   x: -12,    z:   0,   rot: 0 },
  { key: 'bedside_table',   x: -12.9,  z:  -1.6, rot: Math.PI / 2 },
  { key: 'pill_bottle',     x: -12.9,  z:  -1.6, rot: 0, y: 0.71 },
  { key: 'vitals_monitor_2', x: -13.6, z:   0,   rot: Math.PI / 2, y: 1.5 },
  { key: 'first_aid',       x: -13.7,  z:  -4,   rot: Math.PI / 2, y: 1.5 },

  // --- south corridor and the OR approach, z -7 to -20
  { key: 'door',            x:  -4,    z:  -6.65, rot: 0, solid: false },
  { key: 'exit_sign',       x:   2,    z:  -6.7,  rot: Math.PI / 2, y: 2.7 },
  { key: 'extinguisher',    x:  13.3,  z:  -2,    rot: 0 },
  { key: 'gurney',          x: -11,    z: -12,    rot: 0 },
  { key: 'privacy_curtain', x:  -6,    z: -12,    rot: 0 },
  { key: 'biohazard_bin_1', x:   3,    z: -12,    rot: 0 },
  { key: 'triage_cot_1',    x:  11,    z: -18.5,  rot: Math.PI / 2 },
  { key: 'triage_cot_2',    x:  -4.5,  z: -11,    rot: Math.PI / 2 },
  { key: 'first_aid',       x:  13.7,  z: -12,    rot: -Math.PI / 2, y: 1.5 },
  { key: 'vitals_monitor_2', x: -13.6, z: -16,    rot: Math.PI / 2, y: 1.4 },
  { key: 'extinguisher',    x: -13.3,  z: -10,    rot: 0 },
  { key: 'wheelchair',      x:   6.5,  z: -10.5,  rot: -0.7 },
  { key: 'patient_bed_1',   x: -12.4,  z: -17.5,  rot: 0 },
  { key: 'crutches',        x:  13.2,  z: -16.5,  rot: -0.3 },
  { key: 'biohazard_bin_2', x:  -8,    z: -19,    rot: 0 },
  // the OR itself: curtained bay, instrument tray, doors behind the goal disc
  { key: 'privacy_curtain', x:  -3.4,  z: -14.6,  rot: 0 },
  { key: 'privacy_curtain', x:   3.4,  z: -14.6,  rot: 0 },
  { key: 'bedside_table',   x:   2.6,  z: -13.6,  rot: 0 },
  { key: 'syringe',         x:   2.6,  z: -13.6,  rot: 0.2, y: 0.72 },
  { key: 'bandage',         x:   2.45, z: -13.75, rot: 0.9, y: 0.71 },
  { key: 'door',            x:  -3.5,  z: -19.65, rot: Math.PI, solid: false },
  { key: 'door',            x:   3.5,  z: -19.65, rot: Math.PI, solid: false },
  { key: 'hospital_sign',   x:   0,    z: -19.6,  rot: Math.PI / 2, y: 2.3 },
];

// Places every prop in PROPS. Assets.preload() must have resolved first.
// Returns collidable circles {x, z, r} sized from each model's real footprint.
function buildProps(THREE, scene) {
  const solids = [];
  scene.add(buildNurseStation(THREE));
  for (const p of PROPS) {
    const o = Assets.make(p.key);
    if (!o) continue;                       // model missing: silently skip
    o.position.set(p.x, p.y || 0, p.z);
    o.rotation.y = p.rot || 0;
    scene.add(o);

    const f = Assets.footprint(p.key);
    if (p.solid === false || (p.y || 0) > 0.3 || !f || f.r < 0.15) continue;
    solids.push({ x: p.x, z: p.z, r: f.r });
  }
  solids.push({ x: 6.1, z: 6.4, r: 1.7 });  // the nurse station counter
  return solids;
}

// The one piece of built geometry that stays: a nurse-station counter for the
// middle corridor, since no counter model was in the asset set.
function buildNurseStation(THREE) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, .9, 1.0),
    new THREE.MeshStandardMaterial({ color: 0x8b93a6, roughness: .6 }));
  body.position.set(6.1, .45, 6.4);
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, .07, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xd7deea, roughness: .35 }));
  top.position.set(6.1, .92, 6.4);
  for (const m of [body, top]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  return g;
}

// Fallback furniture: only used if the GLBs fail to load, so the corridors are
// never empty. Returns the same {x, z, r} collider contract as buildProps.
function buildFurniture(THREE, scene) {
  const solids = [];
  const matA = new THREE.MeshStandardMaterial({ color: 0x2b3346, roughness: .8 });
  const matB = new THREE.MeshStandardMaterial({ color: 0x1d2432, roughness: .9 });

  // beds parked along the walls
  const beds = [[-12, 14], [-12, 11], [12, 8], [12, 4], [-12, -4], [12, -12]];
  for (const [x, z] of beds) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 2.1), matA);
    bed.position.set(x, .5, z); bed.castShadow = true; scene.add(bed);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(.8, .18, .5),
      new THREE.MeshStandardMaterial({ color: 0x8fa0bd }));
    pillow.position.set(x, .85, z - .7); scene.add(pillow);
    solids.push({ x, z, r: 1.1 });
  }
  // supply carts scattered in the corridors
  const carts = [[-4, 13], [5, 6], [-6, -1], [3, -10], [-3, 5]];
  for (const [x, z] of carts) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(.75, 1.0, .75), matB);
    c.position.set(x, .5, z); c.castShadow = true; scene.add(c);
    solids.push({ x, z, r: .65 });
  }
  return solids;
}

// The distinct models this level needs — what game.js hands to Assets.preload().
function propKeys() {
  return [...new Set(PROPS.map(p => p.key))];
}
