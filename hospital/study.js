// ============================================================================
// OWNER: P1 / ML  —  THE STRATIFIED STUDY
//
// "Does prediction help?" is the wrong question. The right one is WHERE it helps.
// Liu et al., "Beyond ADE and FDE" (arXiv 2510.10086), argue that aggregate
// metrics hide exactly this, and that prediction must be evaluated stratified by
// agent density and geometry. That is what this does, for the robot rather than
// for the predictor: naive vs predictive planning across crowd density and
// corridor geometry, same controller and map in every cell.
//
// Runs headless (no rendering), chunked so the page keeps painting.
// ============================================================================

const Study = {
  busy: false, results: null,
  DENSITIES: [{ name: 'sparse', n: 8 }, { name: 'medium', n: 16 }, { name: 'dense', n: 28 }],
  GEOMS: [{ name: 'open floor', pinch: false }, { name: 'corridors', pinch: true }],
  // Collisions are rare events, so short runs are extremely noisy. This is the
  // smallest budget that gave stable ordering between the two planners.
  TRIALS: 4, SECONDS: 60,

  // A wall is part of the outer shell if it spans most of the room. Everything
  // else is an interior divider, i.e. what creates the pinch points.
  shell(walls) { return walls.filter(w => w.w >= 20 || w.d >= 20); },

  simulate(mode, seconds, trials, solids) {
    let hits = 0, stall = 0, t = 0, dist = 0;
    for (let tr = 0; tr < trials; tr++) {
      const c = createCrowd(LEVEL, solids);
      Robot.mode = mode; Robot.reset(LEVEL, solids);
      let preds = null, px = Robot.x, pz = Robot.z;
      const dt = 1 / 60, steps = (seconds * 60) | 0;
      for (let i = 0; i < steps; i++) {
        const ag = c.step(dt);
        if (i % 5 === 0) preds = Predictor.predict(ag, Robot);
        Robot.step(dt, ag, preds, LEVEL, solids, Predictor.DT);
        dist += Math.hypot(Robot.x - px, Robot.z - pz); px = Robot.x; pz = Robot.z;
      }
      hits += Robot.stats.hits; stall += Robot.stats.stall; t += Robot.stats.t;
    }
    return { hits: hits / (t / 60), stall: 100 * stall / t, dist: dist / (t / 60) };
  },

  run(onProgress, onDone) {
    if (this.busy) return;
    this.busy = true;
    // LEVEL is shared by the crowd, the robot AND the predictor's wall features,
    // so we mutate it per cell and restore afterwards to keep them consistent.
    const realWalls = LEVEL.walls, realCount = LEVEL.crowdCount;
    const cells = [];
    for (const g of this.GEOMS) for (const d of this.DENSITIES) cells.push({ g, d });
    const out = [];
    let i = 0;

    const step = () => {
      const { g, d } = cells[i];
      LEVEL.walls = g.pinch ? realWalls : this.shell(realWalls);
      LEVEL.crowdCount = d.n;
      const naive = this.simulate('naive', this.SECONDS, this.TRIALS, []);
      const pred = this.simulate('predictive', this.SECONDS, this.TRIALS, []);
      out.push({
        geom: g.name, density: d.name, n: d.n, naive, pred,
        // With a zero baseline a ratio is meaningless, so report it as such
        // rather than emitting a nonsense percentage.
        hitGain: naive.hits < .05 && pred.hits < .05 ? 0
               : naive.hits < .05 ? null : 100 * (1 - pred.hits / naive.hits),
        stallGain: naive.stall < .5 && pred.stall < .5 ? 0
                 : naive.stall < .5 ? null : 100 * (1 - pred.stall / naive.stall),
        distGain: naive.dist < .5 ? null : 100 * (pred.dist / naive.dist - 1),
      });
      i++;
      onProgress(i / cells.length);
      if (i < cells.length) return setTimeout(step, 0);
      LEVEL.walls = realWalls; LEVEL.crowdCount = realCount;   // restore the real ward
      Robot.mode = 'naive'; Robot.reset(LEVEL, []);
      this.results = out; this.busy = false;
      onDone(out);
    };
    setTimeout(step, 0);
  },

  // Markdown-ish table, handy for the writeup and the submission form.
  asText() {
    if (!this.results) return '';
    const L = ['geometry\tdensity\tplanner\thits/min\tfrozen%\tm/min'];
    for (const r of this.results) {
      L.push(`${r.geom}\t${r.density}(${r.n})\tnaive\t${r.naive.hits.toFixed(2)}\t${r.naive.stall.toFixed(0)}\t${r.naive.dist.toFixed(1)}`);
      L.push(`${r.geom}\t${r.density}(${r.n})\tpredictive\t${r.pred.hits.toFixed(2)}\t${r.pred.stall.toFixed(0)}\t${r.pred.dist.toFixed(1)}`);
    }
    return L.join('\n');
  },
};
