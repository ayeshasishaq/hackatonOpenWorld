#!/usr/bin/env node
// ============================================================================
// OFFLINE TRAINER  —  bakes hospital/checkpoint.js
//
// Training a policy live, in front of a judge, on a laptop, looks like a stunt:
// nobody can tell a real fit from a progress bar with a timer behind it. So the
// checkpoint ships instead. This script produces it, and it is the ONLY thing
// that produces it, so the numbers on the model card are the numbers this run
// measured.
//
// It runs the page's own files under Node with a tiny DOM-free shim: same
// policyObs, same ScriptedDriver, same network code, same LEVEL. Nothing is
// re-implemented here, so the checkpoint cannot drift from what the page does.
//
//   node train_offline.js [episodes]      (default 50)
//
// PROVENANCE: episodes come from ScriptedDriver, our own hand-written waypoint
// controller, NOT from a person. The checkpoint records that verbatim and the
// model card prints it. If a human ever drives the episodes instead, change
// `source` and nothing else.
// ============================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HERE = __dirname;
const EPISODES = parseInt(process.argv[2], 10) || 50;
const SECONDS = 26;          // long enough for a full run to the OR
const NOISE = 0.18;          // DART: execute noisy, label clean

// ---- load the page's scripts into one shared scope, in load order ----------
// The browser runs these as four classic <script> tags sharing one script scope,
// so their top-level `const`s see each other. Concatenating into a single vm
// script reproduces exactly that: the same declarations, the same order, the
// same visibility. Loading them one at a time would not, because each vm script
// gets its own lexical scope and `LEVEL` would be invisible to policy.js.
const NEEDED = ['LEVEL', 'createCrowd', 'makeNet', 'forward', 'backward', 'policyObs',
                'ScriptedDriver', 'GlobalPlanner', 'Policy', 'P_IN', 'P_OUT', 'collectDemos',
                'Trainer', 'Predictor', 'NEAR_M'];
const src = ['level.js', 'crowd.js', 'predict.js', 'policy.js']
  .map(f => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(HERE, f), 'utf8'))
  .join('\n') + `\n;__out(${NEEDED.join(',')});\n`;

let loaded = null;
const sandbox = { console, setTimeout, performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
                  __out: (...v) => { loaded = Object.fromEntries(NEEDED.map((k, i) => [k, v[i]])); } };
sandbox.window = sandbox;
vm.runInNewContext(src, sandbox, { filename: 'hospital-bundle.js' });

const { LEVEL, collectDemos, Policy, makeNet, forward, backward, P_IN, P_OUT,
        Trainer, Predictor, NEAR_M } = loaded;

// ---- collect -------------------------------------------------------------
console.log(`collecting ${EPISODES} scripted-expert episodes (${SECONDS}s, DART noise ${NOISE})`);
const episodes = collectDemos(EPISODES, SECONDS, NOISE);
const frames = episodes.reduce((s, e) => s + e.length, 0);
console.log(`  ${frames} logged frames`);

// ---- train (same maths as Policy.train, run to completion synchronously) ---
const { X, Y } = Policy.dataset(episodes, LEVEL.walls);
const n = X.length;
console.log(`  ${n} (observation, action) pairs`);

const xm = new Float32Array(P_IN), xs = new Float32Array(P_IN);
const ym = new Float32Array(P_OUT), ys = new Float32Array(P_OUT);
for (const v of X) for (let i = 0; i < P_IN; i++) xm[i] += v[i] / n;
for (const v of X) for (let i = 0; i < P_IN; i++) xs[i] += (v[i] - xm[i]) ** 2 / n;
for (let i = 0; i < P_IN; i++) xs[i] = Math.sqrt(xs[i]) || 1;
for (const v of Y) for (let i = 0; i < P_OUT; i++) ym[i] += v[i] / n;
for (const v of Y) for (let i = 0; i < P_OUT; i++) ys[i] += (v[i] - ym[i]) ** 2 / n;
for (let i = 0; i < P_OUT; i++) ys[i] = Math.sqrt(ys[i]) || 1;

const Xn = X.map(v => Float32Array.from(v, (q, i) => (q - xm[i]) / xs[i]));
const Yn = Y.map(v => Float32Array.from(v, (q, i) => (q - ym[i]) / ys[i]));
const idx = [...Array(n).keys()];
for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [idx[i], idx[j]] = [idx[j], idx[i]]; }
const split = Math.floor(n * .85);
const net = makeNet([P_IN, 64, 64, P_OUT]);

const EPOCHS = 60;
const history = [];
const mse = (from, to) => {
  let s = 0, m = 0;
  for (let k = from; k < to; k++) {
    const a = forward(net, Xn[idx[k]]), o = a[a.length - 1], y = Yn[idx[k]];
    s += (o[0] - y[0]) ** 2 + (o[1] - y[1]) ** 2; m++;
  }
  return s / (m * 2);
};
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const lr = .008 * (1 - epoch / EPOCHS) + .0004;
  for (let k = 0; k < split; k++) backward(net, forward(net, Xn[idx[k]]), Yn[idx[k]], lr);
  history.push({ epoch, train: mse(0, Math.min(split, 400)), val: mse(split, n) });
  if (epoch % 10 === 0 || epoch === EPOCHS - 1)
    console.log(`  epoch ${epoch}  train ${history[epoch].train.toFixed(4)}  val ${history[epoch].val.toFixed(4)}`);
}

let err = 0, m = 0;
for (let k = split; k < n; k++) {
  const a = forward(net, Xn[idx[k]]), o = a[a.length - 1];
  err += Math.hypot(o[0] - Yn[idx[k]][0], o[1] - Yn[idx[k]][1]); m++;
}

// ---- closed-loop gate: does it actually drive? ----------------------------
Policy.net = net;
Policy.norm = { xm, xs, ym, ys };
Policy.trained = true;
const TRIALS = 24;                       // more than the in-browser 8: this is the shipped number
const quality = Policy.evaluate(TRIALS, 40);
console.log(`  closed-loop: ${Math.round(quality * TRIALS)}/${TRIALS} reached the OR (${(quality * 100).toFixed(0)}%)`);

if (quality < 0.9) {
  console.error(`\nREFUSING TO WRITE: closed-loop success ${(quality * 100).toFixed(0)}% is below 90%.`);
  console.error('A shipped checkpoint that cannot drive is worse than no checkpoint. Re-run.');
  process.exit(1);
}

// ---- crowd predictor, on the same episodes --------------------------------
// Baked for the same reason as the policy, and because the stratified near/far
// evaluation is the part that has to be on screen. If this only ran when someone
// pressed a button, the paper's argument would never be visible in the demo.
console.log(`\ntraining the crowd predictor on the same ${EPISODES} episodes`);
Trainer.MAX = 20000;      // 5x the live cap: the near band is a small slice of
Trainer.EPOCHS = 60;      // the data and needs the volume to mean anything
Trainer.LR0 = 0.002;      // 5x lower: 0.01 bottomed out at epoch 4 and then overfit
for (const ep of episodes) Trainer.addEpisode(ep);

const arr = a => Array.from(a, v => +v.toFixed(6));

Trainer.train(
  () => {},
  pm => {
    if (pm.error) { console.error('predictor: ' + pm.error); process.exit(1); }
    console.log(`  ${pm.samples} samples from ${pm.episodes} episodes` +
                `   best val at epoch ${pm.bestEpoch}/${pm.epochs}`);
    console.log(`  pooled  ADE ${pm.adeB.toFixed(3)} → ${pm.adeL.toFixed(3)} m` +
                `   FDE ${pm.fdeB.toFixed(3)} → ${pm.fdeL.toFixed(3)} m   (cv → ours)`);
    for (const band of ['near', 'far']) {
      const b = pm.strat[band];
      if (!b.learned.n) continue;
      const gain = 100 * (1 - b.learned.fde / b.cv.fde);
      console.log(`  ${band.padEnd(6)} n=${String(b.learned.n).padEnd(5)}` +
                  ` ADE ${b.cv.ade.toFixed(3)} → ${b.learned.ade.toFixed(3)}` +
                  `   FDE ${b.cv.fde.toFixed(3)} → ${b.learned.fde.toFixed(3)}` +
                  `   ${gain >= 0 ? '-' : '+'}${Math.abs(gain).toFixed(0)}% FDE`);
    }
    console.log(pm.beatsBaseline
      ? '  planned on: LEARNED (it beat constant velocity close in)'
      : '  planned on: PHYSICS — the MLP did not beat constant velocity close in.\n' +
        '              Shipping it anyway, reported as a negative result on the model card.');
    write(pm);
  });

// ---- write ---------------------------------------------------------------
function write(pm) {
  const ckpt = {
    schema: 'code-blue.checkpoint.v2',
    source: 'scripted expert (ScriptedDriver), not human',
    episodes: EPISODES, seconds: SECONDS, dart_noise: NOISE,

    // 1. the cloned policy
    arch: `${P_IN}-64-64-${P_OUT} MLP, ReLU, Adam`,
    epochs: EPOCHS, frames: n, trainN: split, valN: n - split,
    err: +(err / m).toFixed(4),
    quality, closedLoopTrials: TRIALS,
    norm: { xm: arr(xm), xs: arr(xs), ym: arr(ym), ys: arr(ys) },
    layers: net.L.map(l => ({ W: arr(l.W), b: arr(l.b), nin: l.nin, nout: l.nout })),
    history: history.map(h => ({ epoch: h.epoch, train: +h.train.toFixed(5), val: +h.val.toFixed(5) })),

    // 2. the crowd predictor, including the stratified evaluation
    predictor: {
      arch: pm.arch, samples: pm.samples, episodes: pm.episodes,
      trainN: pm.trainN, valN: pm.valN,
      adeL: +pm.adeL.toFixed(4), fdeL: +pm.fdeL.toFixed(4),
      adeB: +pm.adeB.toFixed(4), fdeB: +pm.fdeB.toFixed(4),
      strat: pm.strat, nearM: NEAR_M,
      bestEpoch: pm.bestEpoch, epochs: pm.epochs, beatsBaseline: pm.beatsBaseline,
      norm: { xm: arr(Predictor.norm.xm), xs: arr(Predictor.norm.xs),
              ym: arr(Predictor.norm.ym), ys: arr(Predictor.norm.ys) },
      layers: Predictor.net.L.map(l => ({ W: arr(l.W), b: arr(l.b), nin: l.nin, nout: l.nout })),
      history: pm.history.map(h => ({ epoch: h.epoch, train: +h.train.toFixed(5), val: +h.val.toFixed(5) })),
    },
  };

  const out = path.join(HERE, 'checkpoint.js');
  fs.writeFileSync(out, '// GENERATED by train_offline.js. Do not edit by hand.\n' +
    '// Every number below was measured by that script on the run that wrote this file.\n' +
    'const CHECKPOINT = ' + JSON.stringify(ckpt) + ';\n');
  console.log(`\nwrote ${out}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}
