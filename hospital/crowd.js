// ============================================================================
// OWNER: P3  —  CROWD / CHAOS
// Your job: make the ward feel alive. Nurses hurrying, patients shuffling,
// people stopping to talk, someone rushing a crash cart through.
// Contract:  createCrowd(level, solids) -> { agents, step(dt) -> agents }
//   agent = { x, z, vx, vz, r, kind, speed }
// Steering ported from adaptive-collision-space.html (seek + separation).
// You do NOT need to touch any other file.
// ============================================================================

function createCrowd(level, solids) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const bx = level.bounds.x - 1.5;
  // Keep staff in the ward — not in the glued vestibule (z > wardZ).
  const zLo = -(Math.min(level.bounds.z, 20) - 1.5);
  const zHi = level.wardZ != null ? level.wardZ : (Math.min(level.bounds.z, 20) - 1.5);

  // TODO P3: tune the mix. More 'rusher' = more chaos = richer avoidance data.
  const KINDS = [
    { kind: 'nurse',   speed: 1.5, r: .45 },
    { kind: 'patient', speed: 0.7, r: .45 },
    { kind: 'rusher',  speed: 2.4, r: .45 },
  ];

  const blocked = (x, z) => {
    for (const w of level.walls)
      if (Math.abs(x - w.x) < w.w / 2 + .6 && Math.abs(z - w.z) < w.d / 2 + .6) return true;
    for (const s of (solids || []))
      if (Math.hypot(x - s.x, z - s.z) < s.r + .6) return true;
    return false;
  };
  const freeSpot = () => {
    for (let i = 0; i < 60; i++) {
      const x = rand(-bx, bx), z = rand(zLo, zHi);
      if (!blocked(x, z)) return { x, z };
    }
    return { x: 0, z: 0 };
  };

  const agents = [];
  for (let i = 0; i < level.crowdCount; i++) {
    const k = KINDS[i % KINDS.length], p = freeSpot(), g = freeSpot();
    agents.push({ ...p, vx: 0, vz: 0, r: k.r, kind: k.kind, speed: k.speed, gx: g.x, gz: g.z });
  }

  return {
    agents,
    step(dt) {
      for (const a of agents) {
        // seek own waypoint
        let sx = a.gx - a.x, sz = a.gz - a.z;
        const dl = Math.hypot(sx, sz) || 1; sx /= dl; sz /= dl;
        // separation from other people
        for (const o of agents) {
          if (o === a) continue;
          const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz);
          if (d < 1.4 && d > .01) { sx += (dx / d) * (1.4 - d) * 1.1; sz += (dz / d) * (1.4 - d) * 1.1; }
        }
        // push away from furniture
        for (const s of (solids || [])) {
          const dx = a.x - s.x, dz = a.z - s.z, d = Math.hypot(dx, dz), safe = s.r + .8;
          if (d < safe && d > .01) { sx += (dx / d) * (safe - d) * 1.6; sz += (dz / d) * (safe - d) * 1.6; }
        }
        // push away from walls
        for (const w of level.walls) {
          const nx = Math.max(w.x - w.w / 2, Math.min(w.x + w.w / 2, a.x));
          const nz = Math.max(w.z - w.d / 2, Math.min(w.z + w.d / 2, a.z));
          const dx = a.x - nx, dz = a.z - nz, d = Math.hypot(dx, dz);
          if (d < 1.0 && d > .01) { sx += (dx / d) * (1.0 - d) * 3.0; sz += (dz / d) * (1.0 - d) * 3.0; }
        }
        const sl = Math.hypot(sx, sz) || 1;
        const tvx = sx / sl * a.speed, tvz = sz / sl * a.speed;
        a.vx += (tvx - a.vx) * Math.min(1, dt * 3.5);
        a.vz += (tvz - a.vz) * Math.min(1, dt * 3.5);
        a.x = Math.max(-bx, Math.min(bx, a.x + a.vx * dt));
        a.z = Math.max(zLo, Math.min(zHi, a.z + a.vz * dt));
        // new destination on arrival (or occasionally, so paths stay unpredictable)
        if (Math.hypot(a.gx - a.x, a.gz - a.z) < 1.2 || Math.random() < dt * .08) {
          const g = freeSpot(); a.gx = g.x; a.gz = g.z;
        }
      }
      return agents;
    }
  };
}
