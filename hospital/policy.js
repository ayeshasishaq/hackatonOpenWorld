// ============================================================================
// OWNER: P1 / ML  —  THE CLONED POLICY  (this is where the AI actually lives)
//
// Behaviour cloning from human demonstrations. You drive; we record every
// (observation, action) pair; we fit a policy to it; then that policy drives.
//
// Why this counts as physical AI rather than decoration:
//   * It is the same recipe as pi0 / SmolVLA / GR00T, which are behaviour cloning
//     from human demonstrations with a vision encoder and language on top. This
//     is the honest minimal version: no vision, no language, trained in-browser.
//   * The standard objection to human data for robot learning is that it is
//     OBSERVATION WITHOUT ACTIONS. Ego4D and ETH/UCY show you where people went,
//     never what they did. A game records the control input, so every frame is a
//     real (observation, action) pair.
//
// Observations are EGOCENTRIC (everything rotated into the agent's own frame),
// which is what lets one policy drive both the gurney and every person in the
// ward. That turns the scene into a multi-agent avoidance problem where every
// entity is running the same human-derived controller.
// ============================================================================

const P_NEIGH = 5;
const P_IN = 1 + 2 + P_NEIGH * 4 + 3;    // speed, goal(2), neighbours(20), wall(3) = 26
const P_OUT = 2;                          // throttle, steer

// Observation for ANY entity: {x, z, heading, speed}. `others` is a list of
// {x, z, vx, vz}. Rotating into the ego frame is what makes it transferable.
function policyObs(e, others, goal, walls) {
  const f = [];
  // World -> ego as [forward, right]. Forward is -z rotated by heading, matching
  // the trolley convention; right is that turned 90 degrees. Getting this wrong
  // rotates every observation by 90 degrees and the policy cannot learn anything.
  const hx = -Math.sin(e.heading), hz = -Math.cos(e.heading);   // forward
  const rx = Math.cos(e.heading), rz = -Math.sin(e.heading);    // right
  const toEgo = (dx, dz) => [dx * hx + dz * hz, dx * rx + dz * rz];

  f.push(e.speed / 3.6);
  const [gf, gl] = toEgo(goal.x - e.x, goal.z - e.z);
  const gd = Math.hypot(gf, gl) || 1;
  f.push(Math.min(gd / 20, 1.5), Math.atan2(gl, gf));             // distance, bearing

  const near = others.map(o => {
    const [ox, oz] = toEgo(o.x - e.x, o.z - e.z);
    const [ovx, ovz] = toEgo(o.vx || 0, o.vz || 0);
    return { d: Math.hypot(ox, oz), v: [ox, oz, ovx, ovz] };
  }).sort((a, b) => a.d - b.d);
  for (let i = 0; i < P_NEIGH; i++) {
    const n = near[i];
    if (n && n.d < 9) f.push(n.v[0], n.v[1], n.v[2], n.v[3]);
    else f.push(9, 9, 0, 0);
  }

  let bx = 9, bz = 9, bd = 1e9;
  for (const w of (walls || [])) {
    const nx = Math.max(w.x - w.w / 2, Math.min(w.x + w.w / 2, e.x));
    const nz = Math.max(w.z - w.d / 2, Math.min(w.z + w.d / 2, e.z));
    const dx = e.x - nx, dz = e.z - nz, d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; [bx, bz] = toEgo(dx, dz); }
  }
  f.push(bx, bz, Math.min(bd, 6));
  return f;
}

// ---------------------------------------------------------------------------
// A reliable scripted driver. Two jobs: it drives the gurney during the
// hands-off demo, and it generates seed demonstrations so the page works cold,
// before anyone has played. It follows doorway waypoints rather than a potential
// field, because potential fields oscillate in doorways and never get through.
//
// Honesty: data from this is labelled "demonstration", never "human". When a
// person actually plays, their run replaces it and the label changes.
// ---------------------------------------------------------------------------
const ScriptedDriver = {
  waypoints: [{ x: 1.5, z: 10 }, { x: -1.5, z: 2 }, { x: 1.5, z: -7 }, { x: 0, z: -15.5 }],
  reset() { this.i = 0; },
  act(e, agents) {
    if (this.i === undefined) this.i = 0;
    let w = this.waypoints[Math.min(this.i, this.waypoints.length - 1)];
    if (Math.hypot(e.x - w.x, e.z - w.z) < 2.2 && this.i < this.waypoints.length - 1) {
      this.i++; w = this.waypoints[this.i];
    }
    let tx = w.x - e.x, tz = w.z - e.z;
    const d = Math.hypot(tx, tz) || 1; tx /= d; tz /= d;
    let near = 9;
    for (const a of agents) {                       // ease around people, do not fight walls
      const dx = e.x - a.x, dz = e.z - a.z, dd = Math.hypot(dx, dz);
      near = Math.min(near, dd);
      if (dd < 2.6 && dd > .01) { tx += (dx / dd) * (2.6 - dd) * .8; tz += (dz / dd) * (2.6 - dd) * .8; }
    }
    const want = Math.atan2(-tx, -tz);
    const err = ((want - e.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return {
      steer: Math.max(-1, Math.min(1, -err * 1.7)),
      throttle: Math.max(.05, Math.min(1, 1 - Math.abs(err) * .6 - Math.max(0, 2 - near) * .3)),
    };
  },
};

// ---------------------------------------------------------------------------
// PROOF THAT IT IS MULTI-AGENT.
// Claiming "every agent runs its own policy" is not evidence. This runs the same
// scene twice: once with each agent able to observe its neighbours, once blinded
// to them. Each agent still decides independently in both. If agent-agent
// collisions rise sharply when blinded, the agents were causally using each
// other's state, which is the thing that makes it multi-agent.
// ---------------------------------------------------------------------------
const MultiAgentTest = {
  run(seconds, trials) {
    if (!Policy.trained) return { error: 'clone a policy first' };
    const out = {};
    for (const blind of [false, true]) {
      Policy.blind = blind;
      let contacts = 0, t = 0, decisions = 0;
      for (let k = 0; k < trials; k++) {
        const c = createCrowd(LEVEL, []);
        const saved = Policy.drive; Policy.drive = 'world';
        const dt = 1 / 30;
        for (let i = 0; i < seconds * 30; i++) {
          const ag = c.step(dt); t += dt; decisions += ag.length;
          for (let a = 0; a < ag.length; a++)
            for (let b = a + 1; b < ag.length; b++)
              if (Math.hypot(ag[a].x - ag[b].x, ag[a].z - ag[b].z) < ag[a].r + ag[b].r) contacts++;
        }
        Policy.drive = saved;
      }
      out[blind ? 'blind' : 'seeing'] = { contacts: contacts / (t / 60), decisions };
    }
    Policy.blind = false;
    out.ratio = out.seeing.contacts > 0 ? out.blind.contacts / out.seeing.contacts : Infinity;
    return out;
  },
};

const Policy = {
  net: null, norm: null, trained: false, busy: false, metrics: null, history: [],
  drive: 'human',                 // 'human' | 'auto' | 'world'  (world = every agent)
  blind: false,                   // ablation: hide neighbours from every agent
  calls: 0,                       // policy evaluations, for the multi-agent readout

  act(e, others, goal, walls) {
    if (!this.net) return { throttle: 0, steer: 0 };
    this.calls++;
    // ABLATION: with `blind` on, each agent still runs its own policy but can no
    // longer see the others. If collisions spike, the agents were genuinely
    // deciding from their neighbours' state, which is what makes this multi-agent
    // rather than N independent goal-seekers that happen to share a room.
    const f = policyObs(e, this.blind ? [] : others, goal, walls), n = this.norm;
    const x = new Float32Array(P_IN);
    for (let i = 0; i < P_IN; i++) x[i] = (f[i] - n.xm[i]) / n.xs[i];
    const a = forward(this.net, x), o = a[a.length - 1];
    return {
      throttle: Math.max(-1, Math.min(1, o[0] * n.ys[0] + n.ym[0])),
      steer:    Math.max(-1, Math.min(1, o[1] * n.ys[1] + n.ym[1])),
    };
  },

  // Build (observation, action) pairs from the logged human runs.
  dataset(episodes, walls) {
    const X = [], Y = [];
    for (const ep of episodes) {
      for (const fr of ep) {
        if (!fr.action || !fr.player) continue;
        const p = fr.player;
        const e = { x: p.x, z: p.z, heading: p.heading ?? Math.atan2(p.vx, p.vz), speed: p.speed ?? Math.hypot(p.vx, p.vz) };
        const others = fr.crowd.map(a => ({ x: a[0], z: a[1], vx: a[2], vz: a[3] }));
        X.push(policyObs(e, others, fr.goal, walls));
        Y.push([fr.action.throttle, fr.action.steer]);
      }
    }
    return { X, Y };
  },

  train(episodes, walls, onProgress, onDone) {
    if (this.busy) return;
    const { X, Y } = this.dataset(episodes, walls);
    if (X.length < 150) { onDone({ error: `only ${X.length} demo frames, drive a bit more` }); return; }
    this.busy = true;

    const n = X.length;
    const xm = new Float32Array(P_IN), xs = new Float32Array(P_IN);
    const ym = new Float32Array(P_OUT), ys = new Float32Array(P_OUT);
    for (const v of X) for (let i = 0; i < P_IN; i++) xm[i] += v[i] / n;
    for (const v of X) for (let i = 0; i < P_IN; i++) xs[i] += (v[i] - xm[i]) ** 2 / n;
    for (let i = 0; i < P_IN; i++) xs[i] = Math.sqrt(xs[i]) || 1;
    for (const v of Y) for (let i = 0; i < P_OUT; i++) ym[i] += v[i] / n;
    for (const v of Y) for (let i = 0; i < P_OUT; i++) ys[i] += (v[i] - ym[i]) ** 2 / n;
    for (let i = 0; i < P_OUT; i++) ys[i] = Math.sqrt(ys[i]) || 1;
    const norm = { xm, xs, ym, ys };

    const Xn = X.map(v => Float32Array.from(v, (q, i) => (q - xm[i]) / xs[i]));
    const Yn = Y.map(v => Float32Array.from(v, (q, i) => (q - ym[i]) / ys[i]));
    const idx = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[idx[i], idx[j]] = [idx[j], idx[i]]; }
    const split = Math.floor(n * .85);
    const net = makeNet([P_IN, 64, 64, P_OUT]);

    const EPOCHS = 60;
    let epoch = 0;
    this.history = [];                  // per-epoch train/val loss, so the curve is inspectable
    const mse = (from, to) => {
      let s = 0, m = 0;
      for (let k = from; k < to; k++) {
        const a = forward(net, Xn[idx[k]]), o = a[a.length - 1], y = Yn[idx[k]];
        s += (o[0] - y[0]) ** 2 + (o[1] - y[1]) ** 2; m++;
      }
      return s / (m * 2);
    };
    const step = () => {
      for (let e = 0; e < 4 && epoch < EPOCHS; e++, epoch++) {
        const lr = .008 * (1 - epoch / EPOCHS) + .0004;
        for (let k = 0; k < split; k++) backward(net, forward(net, Xn[idx[k]]), Yn[idx[k]], lr);
        this.history.push({ epoch, train: mse(0, Math.min(split, 400)), val: mse(split, n) });
      }
      onProgress(epoch / EPOCHS);
      if (epoch < EPOCHS) return setTimeout(step, 0);
      this.net = net; this.norm = norm; this.trained = true;
      let err = 0, m = 0;                                    // held-out action error
      for (let k = split; k < n; k++) {
        const a = forward(net, Xn[idx[k]]), o = a[a.length - 1];
        err += Math.hypot(o[0] - Yn[idx[k]][0], o[1] - Yn[idx[k]][1]); m++;
      }
      this.metrics = { frames: n, err: err / m, trainN: split, valN: n - split,
                       arch: `${P_IN}-64-64-${P_OUT} MLP, ReLU, Adam`, history: this.history };
      this.busy = false;
      onDone(this.metrics);
    };
    setTimeout(step, 0);
  },
};
