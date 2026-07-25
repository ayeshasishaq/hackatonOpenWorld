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

// ---------------------------------------------------------------------------
// A* over a coarse grid of the static map.
//
// The robot used to be a pure reactive potential field, which meant it got
// trapped in rooms and corners and sat there. Two problems with that: it looks
// broken, and it corrupts the experiment, because the time-frozen metric ends up
// measuring failures of GEOMETRY when the thing we are comparing is avoidance of
// PEOPLE. Routing the walls with A* removes geometry from the comparison, so
// naive vs predictive is now purely about the crowd.
// ---------------------------------------------------------------------------
const NavGrid = {
  cell: 1.0, w: 0, h: 0, ox: 0, oz: 0, blocked: null,

  build(LEVEL, solids, pad) {
    this.ox = -LEVEL.bounds.x; this.oz = -LEVEL.bounds.z;
    this.w = Math.ceil(LEVEL.bounds.x * 2 / this.cell);
    this.h = Math.ceil(LEVEL.bounds.z * 2 / this.cell);
    this.blocked = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.w; i++) for (let j = 0; j < this.h; j++) {
      const x = this.ox + (i + .5) * this.cell, z = this.oz + (j + .5) * this.cell;
      let bad = false;
      for (const wl of LEVEL.walls)
        if (Math.abs(x - wl.x) < wl.w / 2 + pad && Math.abs(z - wl.z) < wl.d / 2 + pad) bad = true;
      for (const s of (solids || []))
        if (Math.hypot(x - s.x, z - s.z) < s.r + pad) bad = true;
      this.blocked[j * this.w + i] = bad ? 1 : 0;
    }
  },

  idx(x, z) {
    return [Math.max(0, Math.min(this.w - 1, ((x - this.ox) / this.cell) | 0)),
            Math.max(0, Math.min(this.h - 1, ((z - this.oz) / this.cell) | 0))];
  },
  free(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h && !this.blocked[j * this.w + i]; },
  world(i, j) { return { x: this.ox + (i + .5) * this.cell, z: this.oz + (j + .5) * this.cell }; },

  path(sx, sz, gx, gz) {
    if (!this.blocked) return null;
    const [si, sj] = this.idx(sx, sz); let [gi, gj] = this.idx(gx, gz);
    if (!this.free(gi, gj)) {                                  // nudge goal to open ground
      let best = null, bd = 1e9;
      for (let i = 0; i < this.w; i++) for (let j = 0; j < this.h; j++)
        if (this.free(i, j)) { const d = (i - gi) ** 2 + (j - gj) ** 2; if (d < bd) { bd = d; best = [i, j]; } }
      if (!best) return null; [gi, gj] = best;
    }
    const N = this.w * this.h, start = sj * this.w + si, goal = gj * this.w + gi;
    const g = new Float32Array(N).fill(Infinity), f = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1), open = [start];
    const hx = k => Math.hypot((k % this.w) - gi, ((k / this.w) | 0) - gj);
    g[start] = 0; f[start] = hx(start);
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) {
        const out = []; let k = cur;
        while (k !== -1) { out.push(this.world(k % this.w, (k / this.w) | 0)); k = prev[k]; }
        return out.reverse();
      }
      const ci = cur % this.w, cj = (cur / this.w) | 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;  // no corner cuts
        const nk = nj * this.w + ni, ng = g[cur] + Math.hypot(di, dj);
        if (ng < g[nk]) {
          g[nk] = ng; f[nk] = ng + hx(nk); prev[nk] = cur;
          if (!open.includes(nk)) open.push(nk);
        }
      }
    }
    return null;
  },
};

const RobotProto = {
  R: .34, MAXV: 1.75, ACC: 5.0,
  SAFE: 1.15,                        // personal space it tries to keep

  reset(LEVEL, solids, keepGoal) {
    if (!NavGrid.blocked) NavGrid.build(LEVEL, solids, this.R + .55);
    this.x = -9; this.z = 14; this.vx = this.vz = 0;
    this.stats = { hits: 0, stall: 0, t: 0 }; this.wasHit = false;
    this.trail.length = 0; this.route = null; this.leg = 0; this.since = 0;
    if (!keepGoal) this.newGoal(LEVEL, solids); else this.replan();
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
        this.gx = x; this.gz = z; this.replan(); return;
      }
    }
    this.gx = -this.x; this.gz = -this.z; this.replan();
  },

  replan() {
    this.route = NavGrid.path(this.x, this.z, this.gx, this.gz) || null;
    this.leg = 0;
  },

  // Where to aim right now: the next point along the route, not the far goal.
  aim() {
    if (!this.route || this.leg >= this.route.length) return { x: this.gx, z: this.gz };
    while (this.leg < this.route.length - 1 &&
           Math.hypot(this.x - this.route[this.leg].x, this.z - this.route[this.leg].z) < 1.6) this.leg++;
    return this.route[this.leg];
  },

  // preds: [{path:[{x,z}...]}] from Predictor, index-aligned with agents
  step(dt, agents, preds, LEVEL, solids, DT) {
    if (!this.active) return;
    this.stats.t += dt;

    // ---- follow the planned route, not the far goal ----
    const wp = this.aim();
    let ax = wp.x - this.x, az = wp.z - this.z;
    const gd = Math.hypot(ax, az) || 1;
    const gdx = ax / gd, gdz = az / gd;
    let fx = gdx * 2.2, fz = gdz * 2.2;
    if (Math.hypot(this.gx - this.x, this.gz - this.z) < 1.8) this.newGoal(LEVEL, solids);
    // Stuck watchdog: if it has barely moved for a while, replan. Reactive control
    // alone will happily sit in a corner forever.
    this.since = (this.since || 0) + dt;
    if (Math.hypot(this.vx, this.vz) > .5) this.since = 0;
    if (this.since > 2.5) { this.replan(); this.since = 0;
      if (!this.route) this.newGoal(LEVEL, solids); }

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
