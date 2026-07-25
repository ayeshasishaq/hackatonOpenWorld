// ============================================================================
// OWNER: P4  —  TELEMETRY + THE DATA THESIS
// This file IS the Track-2 argument. Your job:
//   1. Log every run as robotics-ready trajectory data (done below).
//   2. Own the pitch: why this format is what real models train on.
//   3. Write CONSENT.md (consent, provenance, PII) — wins the tie-breaker.
//
// FORMAT (why it matters):
//   ETH/UCY is the standard pedestrian-trajectory benchmark. Rows are
//     frameId  pedId  x  y
//   Social GAN (arXiv:1803.10892) reads exactly this. Human Scene Transformer
//   additionally uses head orientation, which we log as `heading`/`gaze`.
//   pedId 0 is ALWAYS the human player (the gurney).
// ============================================================================

const Telemetry = {
  frames: [],   // rich JSON (analysis / replay)
  rows:   [],   // ETH/UCY-style rows (direct model input)
  frameId: 0,

  reset() { this.frames = []; this.rows = []; this.frameId = 0; },

  record(s) {                                    // called ~10 Hz by game.js
    const f = this.frameId;
    // --- ETH/UCY rows: player is ped 0, crowd are 1..N ---
    this.rows.push([f, 0, +s.player.x.toFixed(3), +s.player.z.toFixed(3),
                    +s.player.yaw.toFixed(3)]);
    s.crowd.forEach((a, i) =>
      this.rows.push([f, i + 1, +a.x.toFixed(3), +a.z.toFixed(3),
                      +Math.atan2(a.vx, a.vz).toFixed(3)]));

    // --- rich frame: everything an analyst might want ---
    this.frames.push({
      frame: f, t: +s.t.toFixed(2),
      player: { x: +s.player.x.toFixed(3), z: +s.player.z.toFixed(3),
                vx: +s.player.vx.toFixed(3), vz: +s.player.vz.toFixed(3),
                yaw: +s.player.yaw.toFixed(3),                 // head orientation (HST input)
                heading: +(s.player.heading ?? 0).toFixed(3),
                speed: +(s.player.speed ?? 0).toFixed(3),
                gaze: +Math.atan2(s.goal.z - s.player.z, s.goal.x - s.player.x).toFixed(3) },
      // THE ACTION LABEL. Human trajectory datasets (Ego4D, ETH/UCY) are
      // observation-only, which is the standard objection to using human data for
      // robot learning: you see where someone went, not what they did. A game
      // records the control input itself, so every frame here is a genuine
      // (observation, action) pair, the same shape imitation learning needs.
      action: { throttle: +(s.action?.throttle ?? 0).toFixed(2),
                steer: +(s.action?.steer ?? 0).toFixed(2) },
      goal: { x: s.goal.x, z: s.goal.z },
      nearest: +s.nearest.toFixed(3), collided: s.collided, nearMiss: s.nearMiss,
      vitals: +s.health.toFixed(1),
      crowd: s.crowd.map(a => [+a.x.toFixed(2), +a.z.toFixed(2),
                               +a.vx.toFixed(2), +a.vz.toFixed(2), a.kind]),
    });
    this.frameId++;
    // TODO P4: derive give-way events (who yielded first), personal-space
    //          intrusions, and path-length vs straight-line ratio.
  },

  summary() {
    return {
      frames: this.frames.length,
      rows: this.rows.length,
      collisions: this.frames.filter(f => f.collided).length,
      nearMisses: this.frames.filter(f => f.nearMiss).length,
    };
  },

  // ETH/UCY text: "frame ped x z heading" — feed straight to Social GAN loaders
  toETH() { return this.rows.map(r => r.join('\t')).join('\n'); },

  download() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const meta = {
      format: 'ETH/UCY-compatible trajectories + head orientation',
      note: 'pedId 0 = human player (gurney). Columns: frame, pedId, x, z, heading(rad).',
      consent: 'Synthetic environment; human navigation decisions recorded with player consent.',
      models: ['Social GAN (arXiv:1803.10892)', 'Human Scene Transformer (JRDB)'],
      summary: this.summary(),
    };
    dl(`hospital_run_${stamp}.json`, JSON.stringify({ meta, frames: this.frames }, null, 1));
    dl(`hospital_run_${stamp}.txt`, this.toETH());

    function dl(name, text) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = name; a.click();
    }
  },
};
