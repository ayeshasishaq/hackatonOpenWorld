// ============================================================================
// OWNER: P1  —  THE DEMO SPINE
//
// ONE argument, four beats. Earlier versions were a feature tour: two different
// models making two different claims, with the evidence hidden behind an
// "Advanced" tab nobody opens. The argument is:
//
//   1. A human does something hard.
//   2. We record it in a form robots can learn from.
//   3. A model learns it and does the job itself.
//   4. Here is the proof it helps, and where it stops helping.
//
// Every beat has exactly ONE obvious button that says what happens next, so
// nothing depends on a hidden key and nothing needs explaining.
// ============================================================================

const Demo = {
  act: 0, auto: false, t0: 0, fired: -1,

  ACTS: [
    { id: 'play', title: '1. A HUMAN DOES THE HARD PART',
      caption: 'Get the patient across a moving ward to the operating room without hitting anyone.',
      panel: 'vitals', camera: 'fp', primary: null },

    { id: 'data', title: '2. EVERY MOMENT IS RECORDED',
      caption: 'What the driver saw, and what the driver DID. Human datasets like Ego4D have the first and not the second, which is why they cannot train a controller.',
      panel: 'data', camera: 'fp', primary: { label: 'Train on this data ▸', cue: 'clone' } },

    { id: 'clone', title: '3. THE MODEL LEARNS TO DRIVE',
      caption: 'Cloned from those demonstrations, it now takes the wheel. The same recipe as pi0 and SmolVLA, without the vision encoder.',
      panel: 'clone', camera: 'fp', primary: { label: 'Run the whole ward on it ▸', cue: 'world' } },

    { id: 'proof', title: '4. DOES IT ACTUALLY HELP?',
      caption: 'One robot, two planners, same crowd. Amber plans on where people are. Green plans on where they will be.',
      panel: 'proof', camera: 'overhead', primary: { label: 'Measure it ▸', cue: 'study' } },
  ],

  TIMELINE: [
    { at: 0,  act: 0, do: 'scripted' },
    { at: 15, act: 1, do: 'clone' },      // record, then learn from it
    { at: 30, act: 2, do: 'drive' },      // the model drives
    { at: 40, act: 2, do: 'world' },      // then every agent in the ward
    { at: 48, act: 3, do: null },         // the two planners, side by side
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
    document.getElementById('capStep').textContent = `STEP ${i + 1} OF ${this.ACTS.length}`;
    document.getElementById('capHint').textContent = '';   // controls live on-screen, not in text
    for (const p of ['vitals', 'data', 'clone', 'proof'])
      document.getElementById('p_' + p).style.display = (p === a.panel) ? 'block' : 'none';
    // One contextual primary action per beat. Never a hidden key, never a tab.
    const b = document.getElementById('bPrimary');
    if (a.primary && !this.auto) { b.style.display = 'inline-block'; b.textContent = a.primary.label; }
    else b.style.display = 'none';
    if (this.onEnter) this.onEnter(a);
  },
};
