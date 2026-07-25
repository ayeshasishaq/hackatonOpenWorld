// ============================================================================
// OWNER: P1 / ML  —  THE AUTONOMOUS ROBOT  (where human data becomes capability)
//
// A hospital delivery robot driving the same corridors as the player, using a
// potential field. The only thing the toggle changes is WHAT it plans against:
//
//   naive       repels from where people are RIGHT NOW.  It reacts late, so it
//               gets cut off, stalls, and clips people. The freezing robot problem.
//   predictive  repels from where the predictor says people WILL BE, comparing
//               each future step against where the robot itself will be. It
//               commits to a gap early and flows through.
//
// Same controller, same gains, same map. The difference is the prediction, which
// is exactly the claim: human trajectory data makes a robot navigate better.
// ============================================================================

const RobotProto = {
  R: .34, MAXV: 1.75, ACC: 5.0,
  SAFE: 1.15,                        // personal space it tries to keep

  reset(LEVEL, solids, keepGoal) {
    this.x = -9; this.z = 14; this.vx = this.vz = 0;
    this.stats = { hits: 0, stall: 0, t: 0 }; this.wasHit = false;
    this.trail.length = 0;
    if (!keepGoal) this.newGoal(LEVEL, solids);
  },

  // Path history for the on-screen trail. Capped, so it never grows unbounded.
  pushTrail() {
    const t = this.trail, n = t.length;
    if (n === 0 || Math.hypot(this.x - t[n - 2], this.z - t[n - 1]) > .35) {
      t.push(this.x, this.z);
      if (t.length > 600) t.splice(0, 2);
    }
  },

  blocked(x, z, LEVEL, solids, pad = .7) {
    for (const w of LEVEL.walls)
      if (Math.abs(x - w.x) < w.w / 2 + pad && Math.abs(z - w.z) < w.d / 2 + pad) return true;
    for (const s of (solids || [])) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true;
    return false;
  },

  newGoal(LEVEL, solids) {
    const bx = LEVEL.bounds.x - 2, bz = LEVEL.bounds.z - 2;
    for (let i = 0; i < 60; i++) {
      const x = (Math.random() * 2 - 1) * bx, z = (Math.random() * 2 - 1) * bz;
      if (!this.blocked(x, z, LEVEL, solids, 1.1) && Math.hypot(x - this.x, z - this.z) > 12) {
        this.gx = x; this.gz = z; return;
      }
    }
    this.gx = -this.x; this.gz = -this.z;
  },

  // preds: [{path:[{x,z}...]}] from Predictor, index-aligned with agents
  step(dt, agents, preds, LEVEL, solids, DT) {
    if (!this.active) return;
    this.stats.t += dt;

    // ---- attraction to the delivery target ----
    let ax = this.gx - this.x, az = this.gz - this.z;
    const gd = Math.hypot(ax, az) || 1;
    const gdx = ax / gd, gdz = az / gd;
    let fx = gdx * 1.9, fz = gdz * 1.9;
    if (gd < 1.6) this.newGoal(LEVEL, solids);

    // Repel AND slide. A pure push-away field deadlocks in corridors: the robot
    // shoves straight back into the thing blocking it and freezes. Adding a
    // tangential component (the perpendicular that points goalward) makes it
    // walk around obstacles instead, which is what stops it stalling.
    const repel = (dx, dz, d, push) => {
      fx += (dx / d) * push; fz += (dz / d) * push;
      const px = -dz / d, pz = dx / d;
      const sign = (px * gdx + pz * gdz) >= 0 ? 1 : -1;
      fx += px * sign * push * .85; fz += pz * sign * push * .85;
    };

    // ---- people ----
    if (this.mode === 'predictive' && preds && preds.length === agents.length) {
      // Compare each FUTURE step of the person against where WE will be then.
      // Reacting to a predicted conflict lets it start turning seconds early.
      for (let i = 0; i < agents.length; i++) {
        const path = preds[i].path || preds[i];
        // React ONCE, to the closest predicted approach. Pushing at every future
        // step would make this planner ~8x more repulsive than the naive one and
        // the comparison would measure timidity, not prediction. This is also the
        // principled form: it is the closest point of approach that matters.
        let bd = 1e9, bdx = 0, bdz = 0, bt = 0;
        for (let s = 0; s < path.length; s++) {
          const tAhead = (s + 1) * DT;
          const rx = this.x + this.vx * tAhead, rz = this.z + this.vz * tAhead;
          const dx = rx - path[s].x, dz = rz - path[s].z, d = Math.hypot(dx, dz);
          if (d < bd) { bd = d; bdx = dx; bdz = dz; bt = tAhead; }
        }
        const safe = this.SAFE + .45;
        if (bd < safe && bd > .01)
          repel(bdx, bdz, bd, ((safe - bd) / safe) * 3.4 / (1 + bt * 1.6));
      }
    } else {
      // Naive: only what is happening right now.
      for (const a of agents) {
        const dx = this.x - a.x, dz = this.z - a.z, d = Math.hypot(dx, dz);
        const safe = this.SAFE + a.r;
        if (d < safe && d > .01) repel(dx, dz, d, ((safe - d) / safe) * 3.4);
      }
    }

    // ---- static world ----
    for (const w of LEVEL.walls) {
      const nx = Math.max(w.x - w.w / 2, Math.min(w.x + w.w / 2, this.x));
      const nz = Math.max(w.z - w.d / 2, Math.min(w.z + w.d / 2, this.z));
      const dx = this.x - nx, dz = this.z - nz, d = Math.hypot(dx, dz), safe = this.R + .85;
      if (d < safe && d > .01) repel(dx, dz, d, ((safe - d) / safe) * 4.0);
    }
    for (const s of (solids || [])) {
      const dx = this.x - s.x, dz = this.z - s.z, d = Math.hypot(dx, dz), safe = s.r + this.R + .5;
      if (d < safe && d > .01) repel(dx, dz, d, ((safe - d) / safe) * 3.2);
    }

    // ---- integrate ----
    const fl = Math.hypot(fx, fz) || 1, want = Math.min(fl, 1) * this.MAXV;
    const tvx = (fx / fl) * want, tvz = (fz / fl) * want;
    this.vx += (tvx - this.vx) * Math.min(1, this.ACC * dt);
    this.vz += (tvz - this.vz) * Math.min(1, this.ACC * dt);
    const nx2 = this.x + this.vx * dt, nz2 = this.z + this.vz * dt;
    if (!this.blocked(nx2, this.z, LEVEL, solids, this.R + .1)) this.x = nx2; else this.vx *= -.2;
    if (!this.blocked(this.x, nz2, LEVEL, solids, this.R + .1)) this.z = nz2; else this.vz *= -.2;

    // ---- scoring: contacts, and time spent effectively frozen ----
    let hit = false;
    for (const a of agents) if (Math.hypot(this.x - a.x, this.z - a.z) < this.R + a.r) hit = true;
    if (hit && !this.wasHit) this.stats.hits++;
    this.wasHit = hit;
    if (Math.hypot(this.vx, this.vz) < .35) this.stats.stall += dt;   // the freezing problem
    this.pushTrail();
  },

  get stalled() { return Math.hypot(this.vx, this.vz) < .35; },
  hitsPerMin() { return this.stats.t > 2 ? this.stats.hits / (this.stats.t / 60) : 0; },
  stallPct() { return this.stats.t > 2 ? 100 * this.stats.stall / this.stats.t : 0; },
};

// Two planners are run as COUNTERFACTUALS of the same robot: same spawn, same
// goal, same crowd, and they do not see each other. That is what makes the
// side-by-side race a fair comparison rather than two robots getting in the way.
function makeRobot(mode) {
  return Object.assign(Object.create(RobotProto), {
    mode, x: 0, z: 0, vx: 0, vz: 0, gx: 0, gz: 0,
    stats: { hits: 0, stall: 0, t: 0 }, wasHit: false, active: true, trail: [],
  });
}

// Kept so study.js and any existing callers keep working unchanged.
const Robot = makeRobot('naive');
