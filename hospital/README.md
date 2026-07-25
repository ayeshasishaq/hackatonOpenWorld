# CODE BLUE — a first-person hospital navigation data engine

**One-sentence pitch:** Push a critical patient's gurney through a crowded hospital to the
operating room — and every run records human collision-avoidance trajectories in the exact
format that social-navigation robots train on.

**Track 2 (VLGE Together)** · built in Three.js (no install, runs from a link).

---

## Why this wins

| Rubric | How we hit it |
|---|---|
| **Experience + Usability (25)** | Clear goal (reach the OR), intuitive FPS controls, real stakes (patient vitals drain), obvious win/lose. Opens from one link. |
| **Technical Execution (25)** | Real-time 3D, crowd steering, live trajectory prediction, zero dependencies beyond Three.js. |
| **Track Fit + Impact (20)** | The gameplay **is** the data collection. Exports ETH/UCY-format trajectories for hospital logistics robots / autonomous gurneys. |
| **Originality (20)** | First-person + head orientation + a **live crowd-prediction overlay** — not passive top-down capture. |
| **Demo + Reproducibility (10)** | One URL, downloadable dataset, documented format. |

**The robotics tie (be honest about it):** the environment is synthetic, so there's a
sim-to-real gap — but the *human's navigation decisions under first-person partial
observability* are real behavioural data. This is a **data engine**, and human trajectory
data is a proven **prior** for social navigation (not a drop-in robot policy).

**Papers this data feeds:**
- **Social GAN** (arXiv:1803.10892) — reads ETH/UCY rows directly: `frame  pedId  x  y`.
- **Human Scene Transformer** (Google, won JRDB 2023) — additionally uses head orientation, which we log as `heading`/`yaw`.

---

## Run it

```bash
python3 -m http.server 8123      # from the repo root
# then open http://localhost:8123/hospital/index.html
```
Click to start → **WASD** move · **mouse** look · **Esc** release cursor.
Deploy for the judge link: drag the `hospital/` folder onto Netlify Drop (~2 min, HTTPS).

## Who owns what (5 people, 5 files — no merge conflicts)

| Person | File | Job |
|---|---|---|
| **P1 / lead** | `game.js` | FPS controller, core loop, collisions, win/lose, wiring |
| **P2** | `level.js` | Hospital floorplan + **GLB props** (`PROPS` array — add CC0 models) |
| **P3** | `crowd.js` | Staff/patient behaviour — the chaos |
| **P4** | `telemetry.js` | Data logging + **the data thesis** + `CONSENT.md` |
| **P5 / ML** | `predict.js` | The prediction overlay (upgrade to a trained model) |

Each file states its owner and has `TODO <person>` markers. **Agree the interfaces below in
the first 30 minutes, then don't change them** — that's what keeps everyone unblocked.

```js
LEVEL = { bounds, spawn, goal, walls[], crowdCount }        // level.js
createCrowd(LEVEL, solids) -> { agents, step(dt) }          // crowd.js
   agent = { x, z, vx, vz, r, kind, speed }
Telemetry.record(state) / .download() / .summary()          // telemetry.js
Predictor.predict(agents, player) -> [{ path:[{x,z}], risk }] // predict.js
state = { t, player:{x,z,vx,vz,yaw}, goal, crowd, nearest, collided, nearMiss, health }
```

**Workflow:** feature branches → PRs (small, often), or VS Code **Live Share** for
real-time co-editing. This branch: `feat/first-person-hospital`.

## Data format

`Download data` produces two files:
- **`.txt`** — ETH/UCY rows, tab-separated: `frame  pedId  x  z  heading`. `pedId 0` is always
  the human player. Feed straight into Social-GAN-style loaders.
- **`.json`** — richer: velocities, gaze-to-goal, per-frame collisions/near-misses, patient
  vitals, crowd kinds. For analysis and replay.

## The 3-minute demo

1. **Play it.** Push the gurney through the ward to the OR (problem → interaction → outcome).
2. **"Every run is a dataset."** Hit *Download data*, show the ETH/UCY rows.
3. **Toggle the prediction overlay.** Paths turn red as people converge on you.
4. **Close:** "a scalable engine for generating human collision-avoidance data for
   autonomous hospital gurneys and social-navigation robots."

Keep a 60–90s backup video locally. Submissions close **18:30 PT**.

## Upgrade path (only after the core loop is solid)

- P2: drop real hospital GLBs into `PROPS` (Poly Haven / Kenney / Sketchfab-CC).
- P5: train an LSTM on downloaded runs → replace `Predictor.predict`, report ADE/FDE.
  The overlay looks identical either way, so **the demo never depends on the ML finishing**.
- P4: `CONSENT.md` — consent, provenance, PII. Wins the "clearer provenance" tie-breaker.
