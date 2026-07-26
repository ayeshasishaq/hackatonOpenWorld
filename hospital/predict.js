// ============================================================================
// OWNER: P5 / ML  —  PREDICTION + LEARNING  (the core of the physical-AI story)
//
// Two predictors behind ONE interface:
//   LEVEL 1  physics   : constant velocity + social force. Hand written, always works.
//   LEVEL 2  learned   : a small MLP trained IN THE BROWSER on the trajectories the
//                        player just generated. No server, no dependencies.
//
// The demo closes the loop live: play a few runs -> Train -> the overlay switches
// from the hand written model to the learned one and ADE/FDE visibly drop. That
// turns "this game makes useful robotics data" from a claim into a measurement.
//
// Contract (unchanged):  Predictor.predict(agents, player) -> [{ path:[{x,z}], risk }]
// ============================================================================

const HIST = 3;      // past frames fed to the model
const FUT  = 8;      // future steps predicted
const STRIDE = 2;    // logged frames between steps (telemetry is 10 Hz, so 0.2 s)
const NEIGH = 4;     // nearest neighbours included as context
const IN_DIM = 2 + 2 * HIST + 4 * NEIGH + 3;   // 27 (last 3 = nearest wall)
const OUT_DIM = 2 * FUT;                   // 16

// ---------------------------------------------------------------- tiny MLP ---
function makeNet(sizes) {
  const L = [];
  for (let i = 0; i < sizes.length - 1; i++) {
    const nin = sizes[i], nout = sizes[i + 1], s = Math.sqrt(2 / nin);
    L.push({
      nin, nout,
      W: Float32Array.from({ length: nin * nout }, () => (Math.random() * 2 - 1) * s),
      b: new Float32Array(nout),
      mW: new Float32Array(nin * nout), vW: new Float32Array(nin * nout),
      mb: new Float32Array(nout), vb: new Float32Array(nout),
    });
  }
  return { L, t: 0 };
}
function forward(net, x) {
  const acts = [x];
  let a = x;
  for (let li = 0; li < net.L.length; li++) {
    const l = net.L[li], out = new Float32Array(l.nout);
    for (let o = 0; o < l.nout; o++) {
      let s = l.b[o];
      for (let i = 0; i < l.nin; i++) s += a[i] * l.W[i * l.nout + o];
      out[o] = (li < net.L.length - 1) ? Math.max(0, s) : s;   // ReLU, last layer linear
    }
    acts.push(out); a = out;
  }
  return acts;
}
function backward(net, acts, y, lr) {
  const nL = net.L.length;
  let grad = new Float32Array(net.L[nL - 1].nout);
  const out = acts[nL];
  for (let o = 0; o < grad.length; o++) grad[o] = 2 * (out[o] - y[o]) / grad.length;
  net.t++;
  const b1 = .9, b2 = .999, eps = 1e-8;
  const c1 = 1 - Math.pow(b1, net.t), c2 = 1 - Math.pow(b2, net.t);
  for (let li = nL - 1; li >= 0; li--) {
    const l = net.L[li], a = acts[li], next = new Float32Array(l.nin);
    for (let o = 0; o < l.nout; o++) {
      const g = grad[o];
      if (g === 0) continue;
      for (let i = 0; i < l.nin; i++) {
        const idx = i * l.nout + o, gw = g * a[i];
        l.mW[idx] = b1 * l.mW[idx] + (1 - b1) * gw;
        l.vW[idx] = b2 * l.vW[idx] + (1 - b2) * gw * gw;
        next[i] += g * l.W[idx];
        l.W[idx] -= lr * (l.mW[idx] / c1) / (Math.sqrt(l.vW[idx] / c2) + eps);
      }
      l.mb[o] = b1 * l.mb[o] + (1 - b1) * g;
      l.vb[o] = b2 * l.vb[o] + (1 - b2) * g * g;
      l.b[o] -= lr * (l.mb[o] / c1) / (Math.sqrt(l.vb[o] / c2) + eps);
    }
    if (li > 0) for (let i = 0; i < l.nin; i++) if (acts[li][i] <= 0) next[i] = 0;  // ReLU grad
    grad = next;
  }
}

// ------------------------------------------------------------- features ------
// One sample = how agent `i` is moving now + where the 4 nearest bodies are.
// Everything is relative to the agent, so the model generalises across the ward.
function featuresFrom(snapshot, hist, i) {
  const cur = snapshot.crowd[i], f = [];
  f.push(cur[2], cur[3]);                                  // own velocity
  for (let h = 0; h < HIST; h++) {                         // recent displacement
    const p = hist[h].crowd[i];
    f.push(cur[0] - p[0], cur[1] - p[1]);
  }
  const others = [];
  for (let j = 0; j < snapshot.crowd.length; j++) {
    if (j === i) continue;
    const o = snapshot.crowd[j];
    others.push([o[0] - cur[0], o[1] - cur[1], o[2], o[3]]);
  }
  const pl = snapshot.player;                              // the gurney counts too
  others.push([pl.x - cur[0], pl.z - cur[1], pl.vx, pl.vz]);
  others.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
  for (let k = 0; k < NEIGH; k++) {
    const o = others[k] || [9, 9, 0, 0];
    f.push(o[0], o[1], o[2], o[3]);
  }
  // Nearest wall. This is the signal constant-velocity can never have: it is what
  // tells the model a bounce or a swerve is about to happen.
  let bx = 9, bz = 9, bd = 1e9;
  const walls = (typeof LEVEL !== 'undefined' && LEVEL.walls) || [];
  for (const w of walls) {
    const nx = Math.max(w.x - w.w / 2, Math.min(w.x + w.w / 2, cur[0]));
    const nz = Math.max(w.z - w.d / 2, Math.min(w.z + w.d / 2, cur[1]));
    const dx = cur[0] - nx, dz = cur[1] - nz, d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; bx = dx; bz = dz; }
  }
  f.push(bx, bz, Math.min(bd, 6));
  return f;
}

// ------------------------------------------------------------- the API -------
const Predictor = {
  name: 'physics (constant velocity + social force)',
  mode: 'physics',
  STEPS: FUT, DT: 0.2,
  net: null, norm: null,
  history: [],                     // rolling 10 Hz snapshots, for learned inference

  // game.js calls this at the same cadence as the telemetry log
  pushHistory(agents, player) {
    this.history.push({
      crowd: agents.map(a => [a.x, a.z, a.vx, a.vz]),
      player: { x: player.x, z: player.z, vx: -Math.sin(player.heading) * player.speed,
                vz: -Math.cos(player.heading) * player.speed },
    });
    if (this.history.length > HIST + 2) this.history.shift();
  },

  predict(agents, player) {
    const paths = (this.mode === 'learned' && this.net && this.history.length > HIST)
      ? this.learnedPaths(agents) : this.physicsPaths(agents);
    return paths.map(path => {
      let closest = 1e9;
      for (const p of path) closest = Math.min(closest, Math.hypot(p.x - player.x, p.z - player.z));
      return { path, risk: Math.max(0, Math.min(1, (2.6 - closest) / 2.6)) };
    });
  },

  physicsPaths(agents) {
    const out = [];
    for (const a of agents) {
      let x = a.x, z = a.z, vx = a.vx, vz = a.vz;
      const path = [];
      for (let s = 0; s < FUT; s++) {
        let fx = 0, fz = 0;
        for (const o of agents) {
          if (o === a) continue;
          const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz);
          if (d < 1.6 && d > .01) { fx += (dx / d) * (1.6 - d) * .6; fz += (dz / d) * (1.6 - d) * .6; }
        }
        vx += fx * this.DT; vz += fz * this.DT;
        x += vx * this.DT;  z += vz * this.DT;
        path.push({ x, z });
      }
      out.push(path);
    }
    return out;
  },

  learnedPaths(agents) {
    const h = this.history, snap = h[h.length - 1];
    const past = [];
    for (let k = 0; k < HIST; k++) past.push(h[h.length - 2 - k] || h[0]);
    const out = [];
    for (let i = 0; i < agents.length; i++) {
      if (!snap.crowd[i]) { out.push(this.physicsPaths([agents[i]])[0]); continue; }
      const f = featuresFrom(snap, past, i);
      const y = this.infer(f);
      const path = [];
      for (let s = 0; s < FUT; s++) path.push({ x: agents[i].x + y[s * 2], z: agents[i].z + y[s * 2 + 1] });
      out.push(path);
    }
    return out;
  },

  // Constant-velocity extrapolation of one sample's features. Feature 0 and 1 are
  // the agent's own velocity, so this is the whole baseline.
  cvOffsets(f) {
    const y = new Float32Array(OUT_DIM);
    for (let s = 0; s < FUT; s++) {
      const dt = (s + 1) * this.DT;
      y[s * 2] = f[0] * dt; y[s * 2 + 1] = f[1] * dt;
    }
    return y;
  },

  // Returns ABSOLUTE future offsets, but the network only supplies the RESIDUAL
  // on top of constant velocity.
  //
  // Regressing the absolute offsets directly is what an MLP does badly here: with
  // a squared loss it hedges toward the conditional mean, which systematically
  // under-shoots displacement, and it loses to plain constant velocity — the exact
  // result Schöller et al. 2020 report for a lot of deep predictors. Predicting the
  // residual removes that failure by construction: the baseline is already in the
  // output, so the worst the network can do is learn zero and tie, and everything
  // it does learn is the part constant velocity cannot express (people slowing at
  // walls, stepping around each other, turning at doorways).
  infer(f) {
    const n = this.norm, x = new Float32Array(IN_DIM);
    for (let i = 0; i < IN_DIM; i++) x[i] = (f[i] - n.xm[i]) / n.xs[i];
    const a = forward(this.net, x), o = a[a.length - 1];
    const y = this.cvOffsets(f);
    for (let i = 0; i < OUT_DIM; i++) y[i] += o[i] * n.ys[i] + n.ym[i];
    return y;
  },
};

// ------------------------------------------------------------- training -----
// How close a person has to be to the gurney before their predicted path is a
// SAFETY question rather than background scenery. Liu et al., "Beyond ADE and
// FDE" (arXiv 2510.10086), make this the centre of their critique: ADE and FDE
// average nearby and distant agents together, so a model can post a good headline
// number while being wrong about exactly the people you are about to hit. Every
// metric below is therefore reported near / far as well as pooled.
const NEAR_M = 3.5;

// Did the learned model earn the right to be planned on? Judged on the near band
// only. A model that wins pooled but loses close-in is worse than useless to a
// planner, because close-in is the only range where its output changes a decision.
function beatsBaseline(m) {
  const b = m && m.strat && m.strat.near;
  return !!(b && b.learned.n >= 100 && b.learned.fde < b.cv.fde);
}

const Trainer = {
  episodes: [], X: [], Y: [], D: [], metrics: null, busy: false,

  // Budget knobs. The defaults keep an in-browser fit under about ten seconds.
  // train_offline.js raises both, because a checkpoint is trained once and the
  // near band needs far more than a few dozen samples before its number means
  // anything.
  MAX: 4000,        // samples kept after subsampling
  EPOCHS: 35,
  // Starting learning rate. 0.01 gets a usable fit inside ten seconds in a
  // browser, but it overshoots: validation loss bottoms out within a handful of
  // epochs and then climbs, which is how a predictor that should at worst tie
  // constant velocity ends up losing to it. Offline runs turn it down.
  LR0: 0.01,

  // Install the predictor half of the shipped checkpoint. Same reasoning as the
  // policy: a fit performed live is unverifiable, and the stratified near/far
  // evaluation has to be on screen from the first second rather than hidden
  // behind a button nobody presses.
  loadCheckpoint(p) {
    if (!p || !p.layers) return false;
    const f = a => Float32Array.from(a);
    Predictor.net = { t: 0, L: p.layers.map(l => ({
      nin: l.nin, nout: l.nout, W: f(l.W), b: f(l.b),
      mW: new Float32Array(l.W.length), vW: new Float32Array(l.W.length),
      mb: new Float32Array(l.b.length), vb: new Float32Array(l.b.length),
    })) };
    Predictor.norm = { xm: f(p.norm.xm), xs: f(p.norm.xs), ym: f(p.norm.ym), ys: f(p.norm.ys) };
    // Same gate as after a live fit: the checkpoint is only planned on if it beat
    // constant velocity close-in. The weights load either way so the model card
    // can report the result honestly, including when the result is a loss.
    const won = beatsBaseline(p);
    Predictor.mode = won ? 'learned' : 'physics';
    Predictor.name = won ? `learned MLP (ADE ${p.adeL.toFixed(2)} m)`
                         : 'physics (constant velocity + social force)';
    this.metrics = { ...p, pretrained: true, beatsBaseline: won };
    return true;
  },

  addEpisode(frames) {
    if (frames && frames.length > HIST + FUT * STRIDE + 2) this.episodes.push(frames);
  },
  samples() { return this.X.length; },

  // Turn logged episodes into (features -> future offsets) pairs.
  buildDataset() {
    this.X = []; this.Y = []; this.D = [];
    for (const ep of this.episodes) {
      const last = ep.length - FUT * STRIDE - 1;
      for (let t = HIST; t < last; t++) {
        const past = [];
        for (let k = 1; k <= HIST; k++) past.push(ep[t - k]);
        for (let i = 0; i < ep[t].crowd.length; i++) {
          if (!ep[t + FUT * STRIDE].crowd[i]) continue;
          const cur = ep[t].crowd[i], y = [];
          for (let s = 1; s <= FUT; s++) {
            const p = ep[t + s * STRIDE].crowd[i];
            y.push(p[0] - cur[0], p[1] - cur[1]);
          }
          const f = featuresFrom(ep[t], past, i);
          // Target is the RESIDUAL over constant velocity, not the raw offset.
          // See Predictor.infer for why. Y stays residual all the way through
          // training; the evaluation adds the baseline back before scoring, so
          // ADE/FDE are still absolute metres and comparable to any other model.
          const cv = Predictor.cvOffsets(f);
          for (let k = 0; k < OUT_DIM; k++) y[k] -= cv[k];
          this.X.push(f);
          this.Y.push(y);
          // Range to the ego at prediction time. Kept alongside every sample so
          // the held-out split can be stratified by it later.
          const pl = ep[t].player;
          this.D.push(Math.hypot(pl.x - cur[0], pl.z - cur[1]));
        }
      }
    }
    // Consecutive 10 Hz frames are almost identical, so a few thousand well-spread
    // samples train just as well and keep the live demo under ~10 s.
    const MAX = this.MAX;
    if (this.X.length > MAX) {
      const keep = [...Array(this.X.length).keys()];
      for (let i = keep.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;[keep[i], keep[j]] = [keep[j], keep[i]];
      }
      const sel = keep.slice(0, MAX);
      this.X = sel.map(i => this.X[i]);
      this.Y = sel.map(i => this.Y[i]);
      this.D = sel.map(i => this.D[i]);
    }
    return this.X.length;
  },

  standardise() {
    const n = this.X.length;
    const xm = new Float32Array(IN_DIM), xs = new Float32Array(IN_DIM);
    const ym = new Float32Array(OUT_DIM), ys = new Float32Array(OUT_DIM);
    for (const x of this.X) for (let i = 0; i < IN_DIM; i++) xm[i] += x[i] / n;
    for (const x of this.X) for (let i = 0; i < IN_DIM; i++) xs[i] += (x[i] - xm[i]) ** 2 / n;
    for (let i = 0; i < IN_DIM; i++) xs[i] = Math.sqrt(xs[i]) || 1;
    for (const y of this.Y) for (let i = 0; i < OUT_DIM; i++) ym[i] += y[i] / n;
    for (const y of this.Y) for (let i = 0; i < OUT_DIM; i++) ys[i] += (y[i] - ym[i]) ** 2 / n;
    for (let i = 0; i < OUT_DIM; i++) ys[i] = Math.sqrt(ys[i]) || 1;
    return { xm, xs, ym, ys };
  },

  // Chunked so the browser keeps painting: you watch it train.
  train(onProgress, onDone) {
    if (this.busy) return;
    const n = this.buildDataset();
    if (n < 200) { onDone({ error: `only ${n} samples, play another run` }); return; }
    this.busy = true;
    const norm = this.standardise();
    const split = Math.floor(n * .8);
    const idx = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[idx[i], idx[j]] = [idx[j], idx[i]]; }
    const net = makeNet([IN_DIM, 48, 48, OUT_DIM]);
    const Xn = this.X.map(x => Float32Array.from(x, (v, i) => (v - norm.xm[i]) / norm.xs[i]));
    const Yn = this.Y.map(y => Float32Array.from(y, (v, i) => (v - norm.ym[i]) / norm.ys[i]));

    const EPOCHS = this.EPOCHS;
    let epoch = 0;
    this.history = [];                 // per-epoch train/val loss, so the curve is inspectable
    const mse = (from, to) => {
      let s = 0, m = 0;
      for (let k = from; k < to; k++) {
        const a = forward(net, Xn[idx[k]]), o = a[a.length - 1], y = Yn[idx[k]];
        for (let i = 0; i < OUT_DIM; i++) s += (o[i] - y[i]) ** 2;
        m++;
      }
      return s / (m * OUT_DIM);
    };
    // EARLY STOPPING. Validation loss bottoms out well before the last epoch and
    // then climbs, so shipping the final weights ships an overfit model — that
    // alone was enough to put the predictor behind constant velocity. Keep a copy
    // of the best-validation weights and restore them before evaluating.
    let bestVal = Infinity, bestEpoch = 0, best = null;
    const snapshot = () => net.L.map(l => ({ W: l.W.slice(), b: l.b.slice() }));
    const restore = s => net.L.forEach((l, i) => { l.W.set(s[i].W); l.b.set(s[i].b); });

    const step = () => {
      for (let e = 0; e < 3 && epoch < EPOCHS; e++, epoch++) {          // 3 epochs per frame
        const lr = this.LR0 * (1 - epoch / EPOCHS) + this.LR0 * .05;
        for (let k = 0; k < split; k++) {
          const s = idx[k];
          backward(net, forward(net, Xn[s]), Yn[s], lr);
        }
        const val = mse(split, n);
        this.history.push({ epoch, train: mse(0, Math.min(split, 400)), val });
        if (val < bestVal) { bestVal = val; bestEpoch = epoch; best = snapshot(); }
      }
      onProgress(epoch / EPOCHS);
      if (epoch < EPOCHS) return setTimeout(step, 0);   // setTimeout: keeps going if the tab blurs
      if (best) restore(best);
      // ---- evaluate on the held-out fifth, POOLED and STRATIFIED BY RANGE ----
      // The stratification is the point. A pooled ADE is dominated by the many
      // people wandering far from the gurney, whose paths are nearly straight and
      // therefore easy; the handful inside NEAR_M are the ones a planner has to
      // get right, and they are the ones that manoeuvre. Reporting only the
      // pooled number is precisely the failure Liu et al. describe.
      Predictor.net = net; Predictor.norm = norm;
      const acc = () => ({ ade: 0, fde: 0, n: 0 });
      const L = { all: acc(), near: acc(), far: acc() };     // learned MLP
      const B = { all: acc(), near: acc(), far: acc() };     // constant velocity
      const add = (g, ade, fde) => { g.ade += ade; g.fde += fde; g.n++; };

      for (let k = split; k < n; k++) {
        const s = idx[k], band = this.D[s] < NEAR_M ? 'near' : 'far';
        // Y is stored as a residual, so rebuild the true absolute offsets before
        // scoring. Both models are then measured in the same metres.
        const cv = Predictor.cvOffsets(this.X[s]);
        const t = new Float32Array(OUT_DIM);
        for (let i = 0; i < OUT_DIM; i++) t[i] = this.Y[s][i] + cv[i];

        const p = Predictor.infer(this.X[s]);
        let sum = 0;
        for (let f = 0; f < FUT; f++)
          sum += Math.hypot(p[f * 2] - t[f * 2], p[f * 2 + 1] - t[f * 2 + 1]);
        const adeL = sum / FUT;
        const fdeL = Math.hypot(p[(FUT - 1) * 2] - t[(FUT - 1) * 2],
                                p[(FUT - 1) * 2 + 1] - t[(FUT - 1) * 2 + 1]);
        add(L.all, adeL, fdeL); add(L[band], adeL, fdeL);

        // Same sample, constant-velocity baseline. Schöller et al. 2020 showed
        // this beats many deep predictors, so it is the baseline that matters.
        // Its error is exactly the magnitude of the residual we asked the network
        // to predict, which is what makes the comparison a fair one.
        let sumB = 0, fdeB = 0;
        for (let q = 0; q < FUT; q++) {
          const e = Math.hypot(cv[q * 2] - t[q * 2], cv[q * 2 + 1] - t[q * 2 + 1]);
          sumB += e;
          if (q === FUT - 1) fdeB = e;
        }
        const adeB = sumB / FUT;
        add(B.all, adeB, fdeB); add(B[band], adeB, fdeB);
      }
      const mean = g => g.n ? { ade: g.ade / g.n, fde: g.fde / g.n, n: g.n }
                            : { ade: null, fde: null, n: 0 };
      this.metrics = {
        samples: n, episodes: this.episodes.length,
        adeL: L.all.ade / L.all.n, fdeL: L.all.fde / L.all.n,
        adeB: B.all.ade / B.all.n, fdeB: B.all.fde / B.all.n,
        // The stratified table. `nearM` travels with it so the threshold is never
        // a magic number someone has to go digging for.
        strat: { nearM: NEAR_M,
                 near: { learned: mean(L.near), cv: mean(B.near) },
                 far:  { learned: mean(L.far),  cv: mean(B.far) } },
        arch: `${IN_DIM}-48-48-${OUT_DIM} MLP, ReLU, Adam`,
        train: n - (n - split), trainN: split, valN: n - split,
        bestEpoch, epochs: EPOCHS,
        history: this.history,
      };
      // Only plan on the learned model if it actually earned it, judged on the
      // NEAR band because that is the band a planner acts on. Losing to constant
      // velocity and using it anyway would make the robot comparison in beat 4 a
      // measure of our overfitting rather than of prediction.
      this.metrics.beatsBaseline = beatsBaseline(this.metrics);
      Predictor.mode = this.metrics.beatsBaseline ? 'learned' : 'physics';
      Predictor.name = this.metrics.beatsBaseline
        ? `learned MLP (ADE ${this.metrics.adeL.toFixed(2)} m)`
        : `physics (constant velocity + social force) — the MLP did not beat it`;
      this.busy = false;
      onDone(this.metrics);
    };
    setTimeout(step, 0);
  },
};
