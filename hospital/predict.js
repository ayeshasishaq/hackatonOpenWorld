// ============================================================================
// OWNER: P5 / ML  —  THE PREDICTION OVERLAY  (the "wow" of the demo)
// Forecasts where every person will be over the next ~2 seconds and flags
// anyone on a collision course with the player.
//
// Contract:  predictCrowd(agents, player, dt, horizon) -> [{ path:[{x,z}...], risk:0..1 }]
//
// LEVEL 1 (here, always works): constant-velocity + social-force rollout.
// LEVEL 2 (upgrade): train an LSTM on downloaded runs, expose the same function.
// LEVEL 3 (stretch): pretrained Social GAN offline; same signature.
// The overlay looks identical whichever level you're on — so the demo NEVER
// depends on the ML finishing. Swap the internals, keep the interface.
// ============================================================================

const Predictor = {
  name: 'constant-velocity + social force',
  STEPS: 8,          // how many points along each predicted path
  DT: 0.25,          // seconds between points  (8 * 0.25 = 2s horizon)

  predict(agents, player) {
    const out = [];
    for (const a of agents) {
      let x = a.x, z = a.z, vx = a.vx, vz = a.vz;
      const path = [];
      for (let s = 0; s < this.STEPS; s++) {
        // social force: people veer away from each other as they get close
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
      // risk = how close this person's predicted path comes to the player
      let closest = 1e9;
      for (const p of path) closest = Math.min(closest, Math.hypot(p.x - player.x, p.z - player.z));
      out.push({ path, risk: Math.max(0, Math.min(1, (2.6 - closest) / 2.6)) });
    }
    return out;
  },
};

// --- LEVEL 2 hook -----------------------------------------------------------
// Train offline on downloaded runs, then paste weights / call your model here
// and return the same {path, risk} shape. Report ADE/FDE in the pitch.
//   Predictor.name = 'LSTM (ADE 0.31 / FDE 0.62)';
//   Predictor.predict = (agents, player) => { ... };
