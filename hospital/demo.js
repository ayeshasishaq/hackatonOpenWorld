// ============================================================================
// OWNER: P1  —  THE DEMO SPINE
//
// Three minutes, four acts, SPACE to advance. Each act shows exactly ONE caption
// and ONE panel, so a judge always knows what they are looking at without the
// presenter narrating mechanics.
//
// The rule that drives all of this: the claim must be something a judge SEES,
// never something they have to remember and compare.
// ============================================================================

const Demo = {
  act: 0,
  ACTS: [
    { // 0
      id: 'play', title: 'THE JOB',
      caption: 'Push the patient to the OR. Do not hit the staff.',
      panel: 'vitals', camera: 'fp',
      hint: 'W S drive · A D steer · mouse look',
    },
    { // 1
      id: 'data', title: 'YOUR RUN IS THE DATASET',
      caption: 'Every run logged trajectories and head orientation. Train a predictor on them.',
      panel: 'data', camera: 'fp',
      hint: 'press T to train · SPACE for next',
    },
    { // 2  — the AI headline
      id: 'clone', title: 'NOW IT DRIVES ITSELF',
      caption: 'A policy cloned from your demonstrations is in your seat. Same recipe as pi0 and SmolVLA, minus the vision encoder.',
      panel: 'clone', camera: 'fp',
      hint: 'press C for autopilot · V to run the whole ward on it · SPACE for next',
    },
    { // 3
      id: 'robot', title: 'SAME ROBOT. SAME CROWD.',
      caption: 'Only the planner differs. Amber plans on where people are. Green plans on where they will be.',
      panel: 'race', camera: 'overhead',
      hint: 'watch the amber one freeze · SPACE for next',
    },
    { // 3
      id: 'honest', title: 'WHERE IT DOES NOT WORK',
      caption: 'In open space prediction is a clean win. In tight corridors it trades safety for throughput. The freezing robot problem is still open.',
      panel: 'honest', camera: 'overhead',
      hint: 'press A for the full study · SPACE to restart',
    },
  ],

  current() { return this.ACTS[this.act]; },
  next() { this.go((this.act + 1) % this.ACTS.length); },

  go(i) {
    this.act = i;
    const a = this.current();
    document.getElementById('capTitle').textContent = a.title;
    document.getElementById('capText').textContent = a.caption;
    document.getElementById('capHint').textContent = a.hint;
    document.getElementById('capStep').textContent = `${i + 1} / ${this.ACTS.length}`;
    for (const p of ['vitals', 'data', 'clone', 'race', 'honest'])
      document.getElementById('p_' + p).style.display = (p === a.panel) ? 'block' : 'none';
    if (this.onEnter) this.onEnter(a);
  },
};
