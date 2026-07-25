// ============================================================================
// Tiny software rasteriser + PNG writer, so model-generating scripts can render
// their own contact sheet without a browser or a GPU. Orthographic camera,
// z-buffer, smooth-shaded from the vertex normals, 2x supersampled.
// Used by make_staff_models.mjs; no dependencies beyond node + three.
// ============================================================================

import { deflateSync } from 'node:zlib';
import * as THREE from 'three';

const SS = 2;                                  // supersampling factor
const LIGHT = new THREE.Vector3(0.45, 0.65, 0.72).normalize();
const AMBIENT = 0.34;

// Renders meshes with baked world-space geometry into an RGBA buffer.
// view = { minX, maxX, minY, maxY } in metres, mapped onto the whole image.
// yaw spins the model about its own y axis first, so we can show a 3/4 view.
export function render(meshes, { width, height, view, yaw = 0, background = [14, 18, 32] }) {
  const w = width * SS, h = height * SS;
  const colour = new Float32Array(w * h * 3);
  const depth = new Float32Array(w * h).fill(Infinity);
  const cover = new Float32Array(w * h);
  const rot = new THREE.Matrix4().makeRotationY(yaw);

  const sx = w / (view.maxX - view.minX), sy = h / (view.maxY - view.minY);
  const toScreen = v => [(v.x - view.minX) * sx, h - (v.y - view.minY) * sy];

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const idx = geo.index;
    const base = new THREE.Color(mesh.material.color);

    for (let t = 0; t < idx.count; t += 3) {
      const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
      a.fromBufferAttribute(pos, i0).applyMatrix4(rot);
      b.fromBufferAttribute(pos, i1).applyMatrix4(rot);
      c.fromBufferAttribute(pos, i2).applyMatrix4(rot);
      na.fromBufferAttribute(nor, i0).applyMatrix4(rot);
      nb.fromBufferAttribute(nor, i1).applyMatrix4(rot);
      nc.fromBufferAttribute(nor, i2).applyMatrix4(rot);

      const [ax, ay] = toScreen(a), [bx, by] = toScreen(b), [cx, cy] = toScreen(c);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;

      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          let u = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
          let v = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
          const wgt = 1 - u - v;
          if (u < 0 || v < 0 || wgt < 0) continue;

          const z = -(u * a.z + v * b.z + wgt * c.z);        // camera looks down -z
          const o = y * w + x;
          if (z >= depth[o]) continue;
          depth[o] = z;

          n.set(u * na.x + v * nb.x + wgt * nc.x,
                u * na.y + v * nb.y + wgt * nc.y,
                u * na.z + v * nb.z + wgt * nc.z).normalize();
          const lit = AMBIENT + (1 - AMBIENT) * Math.max(0, n.dot(LIGHT));
          colour[o * 3] = base.r * lit;
          colour[o * 3 + 1] = base.g * lit;
          colour[o * 3 + 2] = base.b * lit;
          cover[o] = 1;
        }
      }
    }
  }

  // Downsample to the requested size, compositing over the background.
  const out = Buffer.alloc(width * height * 4);
  const inv = 1 / (SS * SS);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, bl = 0, cv = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = (y * SS + dy) * w + (x * SS + dx);
          if (!cover[o]) continue;
          r += colour[o * 3]; g += colour[o * 3 + 1]; bl += colour[o * 3 + 2]; cv++;
        }
      }
      const k = cv * inv, o = (y * width + x) * 4;
      out[o] = clamp(255 * srgb(r * inv) + background[0] * (1 - k));
      out[o + 1] = clamp(255 * srgb(g * inv) + background[1] * (1 - k));
      out[o + 2] = clamp(255 * srgb(bl * inv) + background[2] * (1 - k));
      out[o + 3] = 255;
    }
  }
  return { width, height, rgba: out };
}

const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const srgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

// Places several rendered tiles left to right into one image.
export function hstack(tiles, gap = 0, background = [14, 18, 32]) {
  const height = Math.max(...tiles.map(t => t.height));
  const width = tiles.reduce((n, t) => n + t.width, 0) + gap * (tiles.length - 1);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = background[0]; rgba[i * 4 + 1] = background[1];
    rgba[i * 4 + 2] = background[2]; rgba[i * 4 + 3] = 255;
  }
  let x0 = 0;
  for (const t of tiles) {
    for (let y = 0; y < t.height; y++)
      t.rgba.copy(rgba, ((y * width) + x0) * 4, y * t.width * 4, (y + 1) * t.width * 4);
    x0 += t.width + gap;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder: 8-bit RGBA, one IDAT, no filtering.
// ---------------------------------------------------------------------------
export function encodePNG({ width, height, rgba }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                                   // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;                                         // 8-bit, truecolour+alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
