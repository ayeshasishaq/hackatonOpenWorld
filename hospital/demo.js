// ============================================================================
// OWNER: P1  —  THE DEMO SPINE
//
// Two ways in, and the default requires NO input at all:
//
//   AUTO   a 60 second hands-off sequence. Nobody presses anything. A judge who
//          opens the link cold sees the entire argument end to end. This is also
//          exactly what gets screen-recorded for the backup video.
//   DRIVE  the judge takes the wheel, and their run becomes the training data.
//
// The sequence is built so it degrades gracefully: Act 1 is driven by the
// scripted waypoint driver, which reaches the OR 8 times out of 8, so the demo
// never stalls even if the learned policy underperforms.
// ============================================================================

const Demo = {
  act: 0, auto: false, t0: 0, fired: -1,

  ACTS: [
    { id: 'play', title: 'THE JOB',
      caption: 'A trauma patient has to cross a busy ward to the operating room.',
      panel: 'vitals', camera: 'fp', hint: '' },

    { id: 'data', title: 'EVERY FRAME IS A TRAINING PAIR',
      caption: 'We log what the driver saw and what the driver DID. Human datasets have the first and not the second.',
      panel: 'data', camera: 'fp', hint: '' },

    { id: 'clone', title: 'NOW IT DRIVES ITSELF',
      caption: 'A policy cloned from those demonstrations is in the driving seat. Same recipe as pi0 and SmolVLA, without the vision encoder.',
      panel: 'clone', camera: 'fp', hint: '' },

    { id: 'robot', title: 'SAME ROBOT. SAME CROWD.',
      caption: 'Only the planner differs. Amber plans on where people are now. Green plans on where they will be.',
      panel: 'race', camera: 'overhead', hint: 'amber plans on now, green plans ahead' },

    { id: 'honest', title: 'WHERE IT DOES NOT WORK',
      caption: 'In open space prediction is a clean win. In tight corridors it trades safety for throughput. The freezing robot problem is still open.',
      panel: 'honest', camera: 'overhead', hint: '' },
  ],

  // Hands-off timeline. Each entry fires once, when the clock passes `at`.
  TIMELINE: [
    { at: 0,  act: 0, do: 'scripted' },   // the scripted driver takes the patient across
    { at: 14, act: 1, do: 'train' },      // logging becomes a dataset, predictor trains
    { at: 26, act: 2, do: 'clone' },      // hand the gurney to the cloned policy
    { at: 36, act: 2, do: 'world' },      // hand the ENTIRE ward to it
    { at: 45, act: 3, do: null },         // the two robots race
    { at: 56, act: 4, do: null },         // the honest caveat
    { at: 62, act: -1, do: 'end' },
  ],

  current() { return this.ACTS[Math.max(0, this.act)]; },
  next() { this.go((this.act + 1) % this.ACTS.length); },

  startAuto() {
    this.auto = true; this.fired = -1; this.t0 = performance.now();
    document.getElementById('autoBar').style.display = 'block';
  },
  stopAuto() {
    this.auto = false;
    document.getElementById('autoBar').style.display = 'none';
  },

  // called every frame from the game loop
  tick() {
    if (!this.auto) return;
    const t = (performance.now() - this.t0) / 1000;
    const total = this.TIMELINE[this.TIMELINE.length - 1].at;
    document.getElementById('autoFill').style.width = Math.min(100, t / total * 100) + '%';
    for (let i = this.fired + 1; i < this.TIMELINE.length; i++) {
      if (t < this.TIMELINE[i].at) break;
      this.fired = i;
      const e = this.TIMELINE[i];
      if (e.act >= 0 && e.act !== this.act) this.go(e.act);
      if (e.do && this.onCue) this.onCue(e.do);
    }
  },

  go(i) {
    this.act = i;
    const a = this.current();
    document.getElementById('capTitle').textContent = a.title;
    document.getElementById('capText').textContent = a.caption;
    document.getElementById('capHint').textContent = this.auto ? '' : a.hint;
    document.getElementById('capStep').textContent = `${i + 1} / ${this.ACTS.length}`;
    for (const p of ['vitals', 'data', 'clone', 'race', 'honest'])
      document.getElementById('p_' + p).style.display = (p === a.panel) ? 'block' : 'none';
    if (this.onEnter) this.onEnter(a);
  },
};
