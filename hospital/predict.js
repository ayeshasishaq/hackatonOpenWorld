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

  infer(f) {
    const n = this.norm, x = new Float32Array(IN_DIM);
    for (let i = 0; i < IN_DIM; i++) x[i] = (f[i] - n.xm[i]) / n.xs[i];
    const a = forward(this.net, x), o = a[a.length - 1], y = new Float32Array(OUT_DIM);
    for (let i = 0; i < OUT_DIM; i++) y[i] = o[i] * n.ys[i] + n.ym[i];
    return y;
  },
};

// ------------------------------------------------------------- training -----
const Trainer = {
  episodes: [], X: [], Y: [], metrics: null, busy: false,

  addEpisode(frames) {
    if (frames && frames.length > HIST + FUT * STRIDE + 2) this.episodes.push(frames);
  },
  samples() { return this.X.length; },

  // Turn logged episodes into (features -> future offsets) pairs.
  buildDataset() {
    this.X = []; this.Y = [];
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
          this.X.push(featuresFrom(ep[t], past, i));
          this.Y.push(y);
        }
      }
    }
    // Consecutive 10 Hz frames are almost identical, so a few thousand well-spread
    // samples train just as well and keep the live demo under ~10 s.
    const MAX = 4000;
    if (this.X.length > MAX) {
      const keep = [...Array(this.X.length).keys()];
      for (let i = keep.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;[keep[i], keep[j]] = [keep[j], keep[i]];
      }
      const sel = keep.slice(0, MAX);
      this.X = sel.map(i => this.X[i]);
      this.Y = sel.map(i => this.Y[i]);
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

    const EPOCHS = 35;                 // enough to converge, keeps the live demo short
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
    const step = () => {
      for (let e = 0; e < 3 && epoch < EPOCHS; e++, epoch++) {          // 3 epochs per frame
        const lr = .01 * (1 - epoch / EPOCHS) + .0005;
        for (let k = 0; k < split; k++) {
          const s = idx[k];
          backward(net, forward(net, Xn[s]), Yn[s], lr);
        }
        this.history.push({ epoch, train: mse(0, Math.min(split, 400)), val: mse(split, n) });
      }
      onProgress(epoch / EPOCHS);
      if (epoch < EPOCHS) return setTimeout(step, 0);   // setTimeout: keeps going if the tab blurs
      // ---- evaluate on the held-out fifth ----
      Predictor.net = net; Predictor.norm = norm;
      let adeL = 0, fdeL = 0, m = 0;
      for (let k = split; k < n; k++) {
        const s = idx[k], p = Predictor.infer(this.X[s]), t = this.Y[s];
        let sum = 0;
        for (let f = 0; f < FUT; f++)
          sum += Math.hypot(p[f * 2] - t[f * 2], p[f * 2 + 1] - t[f * 2 + 1]);
        adeL += sum / FUT;
        fdeL += Math.hypot(p[(FUT - 1) * 2] - t[(FUT - 1) * 2], p[(FUT - 1) * 2 + 1] - t[(FUT - 1) * 2 + 1]);
        m++;
      }
      // ---- same split, constant-velocity baseline (what the physics model does) ----
      let adeB = 0, fdeB = 0;
      for (let k = split; k < n; k++) {
        const s = idx[k], f = this.X[s], t = this.Y[s];
        const vx = f[0], vz = f[1];
        let sum = 0;
        for (let q = 0; q < FUT; q++) {
          const dt = (q + 1) * Predictor.DT;
          sum += Math.hypot(vx * dt - t[q * 2], vz * dt - t[q * 2 + 1]);
          if (q === FUT - 1) fdeB += Math.hypot(vx * dt - t[q * 2], vz * dt - t[q * 2 + 1]);
        }
        adeB += sum / FUT;
      }
      this.metrics = {
        samples: n, episodes: this.episodes.length,
        adeL: adeL / m, fdeL: fdeL / m, adeB: adeB / m, fdeB: fdeB / m,
        arch: `${IN_DIM}-48-48-${OUT_DIM} MLP, ReLU, Adam`,
        train: n - (n - split), trainN: split, valN: n - split,
        history: this.history,
      };
      Predictor.mode = 'learned';
      Predictor.name = `learned MLP (ADE ${this.metrics.adeL.toFixed(2)} m)`;
      this.busy = false;
      onDone(this.metrics);
    };
    setTimeout(step, 0);
  },
};
