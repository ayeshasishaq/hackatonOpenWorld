// ============================================================================
// STAFF CHARACTER GENERATOR
// Builds the three ER staff characters from the outfit reference (white-coat
// doctor, masked surgeon, scrubs nurse) as low-poly GLBs and writes them into
// assets/models/, so they load through the same Assets pipeline as the
// poly.pizza props. Original geometry — no third-party asset, nothing to credit.
//
//   node tools/make_staff_models.mjs
//
// Authoring contract expected by hospital/assets.js:
//   1.75 m tall, feet on y = 0, centred on x/z, facing +z (game.js turns an
//   agent with rotation.y = atan2(vx, vz), which points local +z along travel).
// One merged mesh per material keeps a 22-agent crowd at ~7 draw calls each.
// ============================================================================

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { render, hstack, encodePNG } from './lib_rasterise.mjs';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/models');

// GLTFExporter assembles the .glb through FileReader, which node has no
// equivalent global for; Blob.arrayBuffer() covers everything it asks of it.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(
      buffer => { this.result = buffer; this.onloadend?.(); },
      error => this.onerror?.(error));
  }
};

// Palette sampled from the reference render.
const MATS = {
  scrub:   { color: 0x2478c4, roughness: 0.78 },   // blue scrub top and trousers
  scrubHi: { color: 0x2f8bd8, roughness: 0.74 },   // cap and mask, a shade lighter
  // the coat shell is an open-fronted arc, so it has to render from both sides
  coat:    { color: 0xeef2f6, roughness: 0.68, side: THREE.DoubleSide },
  tube:    { color: 0x1d5fa6, roughness: 0.45 },   // stethoscope tubing
  glove:   { color: 0x6fdcc8, roughness: 0.52 },   // mint surgical gloves
  shoe:    { color: 0xdfe4e8, roughness: 0.55 },
  skin:    { color: 0xe9c6a3, roughness: 0.72 },
  hair:    { color: 0x4a3527, roughness: 0.85 },
  dark:    { color: 0x1b2028, roughness: 0.5 },    // eyes, stethoscope tubing
  steel:   { color: 0xb9c2cf, roughness: 0.3, metalness: 0.6 },
};

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Part collection: every primitive is baked into a per-material bucket, so the
// finished character is one mesh per colour rather than ~40 tiny nodes.
// ---------------------------------------------------------------------------
function newBuilder() {
  const buckets = new Map();

  // p = position, r = rotation in radians, s = scale (number or [x,y,z]).
  const add = (mat, geo, { p = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}) => {
    const scale = typeof s === 'number' ? [s, s, s] : s;
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...p),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
      new THREE.Vector3(...scale)));
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
    return geo;
  };

  // Same part on both sides of the body; sx is -1 then +1 for the callback.
  const pair = fn => { fn(-1); fn(1); };

  const build = name => {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
        metalness: 0, ...MATS[mat],
      }));
      mesh.name = `${name}_${mat}`;
      group.add(mesh);
    }
    return group;
  };

  return { add, pair, build };
}

// Cheap primitive helpers — segment counts are deliberately low, these are
// background crowd characters seen from a few metres away.
const cyl = (rTop, rBot, h, seg = 12) => new THREE.CylinderGeometry(rTop, rBot, h, seg);
const ball = (r, wSeg = 12, hSeg = 8) => new THREE.SphereGeometry(r, wSeg, hSeg);
const dome = r => new THREE.SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---------------------------------------------------------------------------
// The character itself. Every variant shares the scrubs-and-shoes base; the
// flags switch in the coat, cap, mask, hair and stethoscope.
// ---------------------------------------------------------------------------
function makeStaff({ coat = false, cap = false, mask = false, hair = false, stethoscope = false }) {
  const { add, pair, build } = newBuilder();
  const shoulder = coat ? 'coat' : 'scrub';

  // ---- shoes and scrub trousers ----
  pair(sx => {
    add('shoe', box(0.15, 0.1, 0.29), { p: [0.115 * sx, 0.05, 0.035] });
    add('scrub', cyl(0.115, 0.1, 0.84), { p: [0.115 * sx, 0.5, 0] });
  });

  // ---- hips and scrub top (oval cross-section, flattened front to back) ----
  add('scrub', cyl(0.185, 0.18, 0.24, 14), { p: [0, 1.0, 0], s: [1.06, 1, 0.75] });
  add('scrub', cyl(0.19, 0.185, 0.36, 14), { p: [0, 1.24, 0], s: [1.05, 1, 0.72] });
  pair(sx => add(shoulder, ball(0.092), { p: [0.185 * sx, 1.38, 0], s: [1.1, 0.9, 0.82] }));

  // ---- arms: hang clear of the torso so the silhouette reads at a distance ----
  pair(sx => {
    if (coat) {                                 // coat sleeves reach the wrist
      add('coat', cyl(0.062, 0.056, 0.32), { p: [0.248 * sx, 1.22, 0.01], r: [0, 0, 5 * DEG * sx] });
      add('coat', cyl(0.055, 0.05, 0.3), { p: [0.275 * sx, 0.92, 0.035], r: [-8 * DEG, 0, 3 * DEG * sx] });
    } else {
      // nurse: short scrub sleeve, bare forearm
      add('scrub', cyl(0.066, 0.058, 0.19, 10), { p: [0.245 * sx, 1.29, 0.01], r: [0, 0, 5 * DEG * sx] });
      add('skin', cyl(0.05, 0.045, 0.42), { p: [0.268 * sx, 0.97, 0.03], r: [-7 * DEG, 0, 3 * DEG * sx] });
    }
    add('glove', ball(0.063), { p: [0.288 * sx, 0.75, 0.055], s: [0.85, 1.15, 1] });
  });

  // ---- knee-length lab coat: an arc, not a tube, so the scrubs show through
  // the front opening the way they do in the reference ----
  if (coat) {
    const GAP = 0.92;                            // radians of missing front, ~0.2 m wide
    add('coat', new THREE.CylinderGeometry(0.225, 0.252, 0.78, 18, 1, true,
      GAP / 2, Math.PI * 2 - GAP), { p: [0, 1.05, 0], s: [1, 1, 0.72] });
    pair(sx => add('coat', box(0.08, 0.34, 0.04),
      { p: [0.105 * sx, 1.27, 0.15], r: [0, 0, -11 * DEG * sx] }));       // lapels, open at the collar
    pair(sx => add('coat', box(0.11, 0.13, 0.025), { p: [0.125 * sx, 0.85, 0.165] })); // pockets
  } else {
    add('scrubHi', box(0.17, 0.07, 0.03), { p: [0, 1.36, 0.125] });       // v-neck
  }

  // ---- head ----
  add('skin', cyl(0.055, 0.06, 0.1), { p: [0, 1.45, 0] });
  add('skin', ball(0.118, 14, 10), { p: [0, 1.6, 0], s: [1, 1.12, 1.02] });
  pair(sx => add('skin', ball(0.032, 8, 6), { p: [0.115 * sx, 1.59, -0.005] }));
  pair(sx => add('dark', ball(0.014, 8, 6), { p: [0.047 * sx, 1.638, 0.108] }));

  if (hair) {
    add('hair', dome(0.126), { p: [0, 1.605, -0.008], s: [1, 0.88, 1.05] });
    add('hair', ball(0.056), { p: [0, 1.575, -0.125] });
  }
  if (cap) {
    add('scrubHi', dome(0.132), { p: [0, 1.6, 0], s: [1, 0.92, 1.05] });
    add('scrubHi', ball(0.05), { p: [0, 1.575, -0.135] });                // gathered back
  }
  if (mask) {
    add('scrubHi', ball(0.126, 14, 10), { p: [0, 1.542, 0.026], s: [0.98, 0.66, 1.02] });
    pair(sx => add('scrubHi', cyl(0.01, 0.01, 0.12, 6),
      { p: [0.098 * sx, 1.585, -0.015], r: [0, 0, 90 * DEG] }));          // ear loops
  }

  // ---- stethoscope: ring over the collar, tubing down the front ----
  if (stethoscope) {
    add('tube', new THREE.TorusGeometry(0.128, 0.019, 6, 18),
      { p: [0, 1.42, 0.035], r: [76 * DEG, 0, 0], s: [1, 0.85, 1] });
    pair(sx => add('tube', cyl(0.017, 0.017, 0.3, 6),
      { p: [0.08 * sx, 1.23, 0.2], r: [-4 * DEG, 0, 7 * DEG * sx] }));
    add('steel', cyl(0.042, 0.042, 0.024, 12), { p: [0.07, 1.08, 0.2], r: [86 * DEG, 0, 0] });
  }

  return build;
}

const VARIANTS = {
  staff_doctor:  { hair: true, coat: true },
  staff_surgeon: { cap: true, mask: true, coat: true, stethoscope: true },
  staff_nurse:   { cap: true, mask: true },
};

const exporter = new GLTFExporter();
const toGlb = object => new Promise((res, rej) =>
  exporter.parse(object, res, rej, { binary: true }));

// Front and 3/4 view of each character, framed on a 1.9 m tall subject.
const VIEW = { minX: -0.62, maxX: 0.62, minY: -0.06, maxY: 1.84 };
const tiles = [];

for (const [name, opts] of Object.entries(VARIANTS)) {
  const object = makeStaff(opts)(name);
  const glb = await toGlb(object);
  writeFileSync(resolve(OUT_DIR, `${name}.glb`), Buffer.from(glb));

  // the camera sits on +z, and the model already faces +z: yaw 0 is the front
  for (const yaw of [0, -0.28 * Math.PI])
    tiles.push(render(object.children, { width: 230, height: 352, view: VIEW, yaw }));

  const bbox = new THREE.Box3().setFromObject(object);
  const tris = object.children.reduce((n, m) => n + m.geometry.index.count / 3, 0);
  console.log(`${name}.glb  ${(glb.byteLength / 1024).toFixed(1)} kB  `
    + `${tris} tris  ${object.children.length} meshes  `
    + `h=${(bbox.max.y - bbox.min.y).toFixed(3)}m`);
}

const sheet = resolve(OUT_DIR, '../staff-preview.png');
writeFileSync(sheet, encodePNG(hstack(tiles, 6)));
console.log(`preview -> ${sheet}`);
