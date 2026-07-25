// ============================================================================
// OWNER: P2  —  ENVIRONMENT / LEVEL DESIGN
// Your job: make it look and feel like a real hospital.
//   1. Shape the floorplan below (walls = corridors + rooms).
//   2. Optionally load GLB props from the web (see PROPS + loadProps()).
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
    // Corridor pinch points: the interesting avoidance moments. Keep the doorways
    // ~9 m wide and only gently offset from each other. The trolley is car-like and
    // cannot strafe, so a narrow gap that is also offset from the previous one is
    // effectively impassable. An earlier layout had a 5 m gap swung 3 m sideways
    // and even a scripted expert only reached the OR 1 run in 6.
    { x: -8.5, z: 10,  w: 11, d: 0.6 },   // doorway x in (-3, 6)
    { x: 10,   z: 10,  w: 8,  d: 0.6 },
    { x: -10,  z: 2,   w: 8,  d: 0.6 },   // doorway x in (-6, 3)
    { x: 8.5,  z: 2,   w: 11, d: 0.6 },
    { x: -8.5, z: -7,  w: 11, d: 0.6 },   // doorway x in (-3, 6)
    { x: 10,   z: -7,  w: 8,  d: 0.6 },
    // side-room dividers
    { x: -10, z: 15,  w: 0.6, d: 9 },
    { x: 10,  z: 6,   w: 0.6, d: 8 },
    { x: -10, z: -2,  w: 0.6, d: 9 },
  ],

  crowdCount: 22,                        // staff + patients moving around (P3)
};

// ---------------------------------------------------------------------------
// GLB PROPS.  Add CC0 / CC-BY hospital models here and they get placed in-world.
// Good free sources: Poly Haven (CC0), Kenney kits (CC0), Sketchfab (filter CC).
// Keep it light: a handful of props, < ~150k triangles total, or the browser chugs.
// If a URL fails to load the game still runs — a simple box stands in for it.
// ---------------------------------------------------------------------------
const PROPS = [
  // { url:'https://.../hospital_bed.glb', x:-11, z:12, rot:0,          scale:1 },
  // { url:'https://.../equipment_cart.glb', x: 6, z:-3, rot:Math.PI/2, scale:1 },
];

// Simple built-in furniture so the corridors aren't empty before GLBs arrive.
// Returns collidable circles {x, z, r} that the crowd and player avoid.
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

// Loads the GLB list above. Never throws — logs and continues if a URL 404s.
async function loadProps(THREE, scene, GLTFLoader) {
  if (!PROPS.length) return;
  const loader = new GLTFLoader();
  await Promise.all(PROPS.map(p => new Promise(res => {
    loader.load(p.url, g => {
      const o = g.scene;
      o.position.set(p.x, 0, p.z);
      o.rotation.y = p.rot || 0;
      o.scale.setScalar(p.scale || 1);
      o.traverse(m => { if (m.isMesh) m.castShadow = true; });
      scene.add(o); res();
    }, undefined, err => { console.warn('prop failed:', p.url, err); res(); });
  })));
}
