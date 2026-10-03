# Issue 145 — Occasional visible waves from an active emergency beacon

**Mode:** hands-off
**Goal:** While the player's emergency beacon is on, red rings sometimes spread out from the player's truck. Each pulse starts when the beacon is switched on and repeats every few seconds. The rings stop as soon as the beacon is off. They differ from the white sound arcs at a glance and do not hide them, at night or by day. No rule, timing or NPC behavior changes. The goal is confirmed when the user looks at the day and night screenshots.

## Context
- `world.player.beacon` (`src/sim/types.ts:334`) is the beacon. `setBeacon()` in `src/sim/tow.ts:251-256` switches it, and `src/sim/tow.ts:259-263` switches it off when the truck can drive again or is towed. Only the player has a beacon.
- `SoundRingView` (`src/three/render/soundRing.ts`) draws a faint white partial arc (`PAL.contact`, 3 tiles out from the truck) toward each truck heard beyond sight. It is unlit, has no depth test and uses render order 906. `game.ts:1090` updates it every frame from `drawOverlays()`, also while a modal is open.
- Turns run on their own while the beacon calls: 1 s of playback (`PHYSICS.turnSeconds`) plus 250 ms idle (`CONFIG.autoTurnMs`). A pulse on every turn would fire about every 1.25 s, which is not sparing.
- A beacon press during playback waits in `rescueCommand()` (`game.ts:725-733`) until the turn ends. The world then changes through `apply()`/`runRescue()`.
- Loading a save and starting a new game reload the page (`src/ui/save-panel.ts:69`, `src/ui/game-menu.ts:16`), so every view starts fresh. A saved world can boot with `beacon: true`.
- Day and night come from `world.turn` (`daylightAt(turn)` in `src/three/render/daylight.ts:151`), so a browser check can set either.
- No reference images came with the issue.

## Design
A new render-only view, `BeaconPulseView` in `src/three/render/beaconPulse.ts`, owns the beacon pulse. `SoundRingView` stays the owner of what the player hears. The beacon is a signal going out, so it gets its own view, which reuses the sound ring's way of drawing (unlit rings on the ground under the truck, no depth test, above the fog).

Look, kept apart from the sound arcs:
- Full circles, never arcs. A circle means "out in all directions", and an arc means "from that way".
- A new palette color, `PAL.beacon`, an emergency red (`0xff4030`), unlike the white sound arcs, the teal radio blip and the static orange destination marker.
- One pulse is two thin rings, 0.35 s apart. Each spreads from just outside the truck (1.5 tiles) to 10 tiles in 2 s. It fades as it grows, so it is faint by the time it crosses the sound arcs at 3 tiles. A ring keeps the same thickness as it grows.
- Render order 904: above the fog (900) and shade (901), and below the contact markers (905) and the sound arcs (906). Sound cues draw over the beacon rings.

Timing runs on the wall clock, not on turns:
- The view remembers `onSinceMs`, the first frame on which it saw `beacon === true`. A pulse starts at `onSinceMs` and then every 6 s (about 5 automatic turns). It shows for 2.35 s of each 6 s.
- The phase is a pure function of `(onSinceMs, nowMs)` (elapsed time modulo the period). It keeps no queue, so returning from a hidden tab, a held Space or a long frame never replays a backlog.
- On the first frame with `beacon === false`, `onSinceMs` resets to null and both rings hide.
- The view makes its two meshes once and only moves, fades and hides them. Repeated turns cannot leak meshes. A reload makes a new view, so a saved beacon pulses again from boot.
- Pulses keep going while turns are stopped with Space or a modal is open, because the beacon is still calling. The sound ring keeps drawing in the same cases.

The view reads `world.player.beacon` and the drawn truck position and writes nothing back, so the sim, saves, detection, tows and NPCs do not change.

Alternatives rejected:
- Pulsing inside `SoundRingView` would mix "what I hear" with "what I send", two concepts in one class.
- Pulsing on each turn would be too frequent while turns run on their own, and would freeze while turns are stopped.
- Particles through `Fx3D` have no steady state to switch off, and a timed effect could outlive the beacon.

TDD: yes. The pulse timing and the show/hide state are deterministic logic, and a regression there brings back the orphan effects the issue warns about.

### Invariants
- IV1 — With `beacon === false`, the view shows nothing on the next `update()` call, whatever phase a pulse was in.
- IV2 — On the first `update()` with `beacon === true` after it was off, or after construction, a pulse starts at phase 0.
- IV3 — While the beacon stays on, pulses start exactly every `PULSE.period` seconds of wall-clock time and are hidden between pulses. There is never more than one pulse in flight, and none on every frame or every turn.
- IV4 — The view's mesh count never changes after construction. It allocates no geometry or material per frame.
- IV5 — The change touches nothing under `src/sim/`, `src/data/` or `src/phys/`, and nothing in the save shape.

### Principles
- PC1 — Beacon rings must stay visually below the sound cues: drawn under them, faint where they cross 3 tiles, and full circles in their own color.
- PC2 — The view's tuning numbers live in a const block at the top of the view file, as `ARC`/`RIPPLE` do in `soundRing.ts`. They are render-only, not balance, so they stay out of `src/data/`. The color goes in `PAL`.

### Assumptions
- AS1 — Red `0xff4030` at 0.7 opacity stays readable on sand in the day and on dark ground at night. The day and night screenshots check this, and the user confirms the color and opacity.
- AS2 — `drawOverlays()` runs once every animation frame, including frames between turns, so the view sees a beacon switch-off within one frame.

### Unknowns
- UK1 — Whether a 10-tile spread fits on screen at the default camera zoom. Execution judges it from the screenshots and may change `PULSE.reach`. The reason goes in the conclusion.

## Plan

Approach: one new view file with a pure phase function, one palette color, wiring in three places in `game.ts`, and one doc line. The pure function and the view's show/hide state are tested first (TDD), then the wiring, then the browser check.

### PH1 — Beacon pulse view
- 1.1 `src/render/palette.ts:34-36` (modify) — add `beacon: 0xff4030, // red rings spreading from the player's truck while its emergency beacon calls` after `radio`. Respects: PC1, AS1.
- 1.2 `src/three/render/beaconPulse.test.ts` (create, written first and run to see it fail).
  - `beaconPulseRings(null, t)` returns `[]` for any `t`.
  - At `nowMs === onSinceMs` it returns `[0]` (IV2). At `onSinceMs + 0.35 s` it returns two phases, the first about 0.175 and the second 0.
  - Between the end of a pulse and the next period start it returns `[]`. At `onSinceMs + k * period` it returns `[0]` for k = 1..3 (IV3).
  - With a 10-minute jump in `nowMs`, it returns the same result as the same phase within the first period (no backlog).
  - `BeaconPulseView`: after `update(terrain, true, at, 0)` some ring mesh is visible. After `update(terrain, false, at, 500)` no mesh is visible (IV1). Switching back on at `t` restarts at phase 0 (IV2). After 1000 updates the `root.children.length` stays equal to the ring count, and each mesh's `geometry` object is unchanged (IV4).
  - The ring's inner and outer radii at phase p equal `lerp(start, reach, p)` and that value plus `thickness`, so the thickness stays the same.
  - Each ring's material opacity is non-increasing in phase.
  - Use `emptyWorld()` from `src/sim/testkit` for the terrain.
- 1.3 `src/three/render/beaconPulse.ts` (create)
  - Header comment in the style of `soundRing.ts`: what the rings mean, how they differ from sound arcs, and that they are render-only.
  - `const PULSE = { period: 6, rings: 2, stagger: 0.35, seconds: 2, start: 1.5, reach: 10, thickness: 0.18, opacity: 0.7, segments: 64 }`. Seconds and tiles.
  - `const RENDER_ORDER = 904` and `const LIFT = 0.1`.
  - `export function beaconPulseRings(onSinceMs: number | null, nowMs: number): number[]` gives the phase in [0,1) of each ring in flight. It derives them from `(nowMs - onSinceMs) / 1000 % PULSE.period`.
  - `export class BeaconPulseView { readonly root: THREE.Group; update(terrain: Terrain, on: boolean, at: Vec, nowMs: number): void }`.
    - The constructor makes `PULSE.rings` meshes. Each is a `RingGeometry(1, 2, segments)` rotated onto the ground with a `MeshBasicMaterial({ color: PAL.beacon, transparent, depthTest: false, depthWrite: false, side: DoubleSide })`, with `renderOrder = RENDER_ORDER`.
    - `update()` sets or clears `onSinceMs`, then places `root` at `at` on the terrain (as `SoundRingView.update` does).
    - For each ring with a phase, it writes the inner and outer vertex radii in place into the existing position attribute. A private `setRadii(mesh, inner, outer)` sets `needsUpdate` and does not reallocate. It also sets opacity to `PULSE.opacity * (1 - p)²` and `visible = true`. Every other ring gets `visible = false`.
  - Respects: IV1-IV4, PC1, PC2.
- Commit: "Add a beacon pulse view: red rings spread from the stranded truck while its beacon calls"

### PH2 — Wire into the game and document
- 2.1 `src/three/game.ts:71` add `import { BeaconPulseView } from "./render/beaconPulse";`. At `:128` add `private readonly beaconPulse = new BeaconPulseView();`. At `:236` add `this.beaconPulse.root` to `this.scene.add(...)` next to `this.soundRing.root`.
- 2.2 `src/three/game.ts:1089-1096` (`drawOverlays()`): after `soundRing.update`, call `this.beaconPulse.update(this.world.terrain, this.world.player.beacon, <same listener point passed to soundRing>, performance.now())`. Hoist that point into a local so both views share it. The call goes before `if (hide) return`, so pulses show during playback, as the sound arcs do. Respects: AS2, IV5.
- 2.3 `docs/architecture/render.md`: one bullet. `src/three/render/beaconPulse.ts` draws the player's beacon as red full rings every `PULSE.period` seconds of wall-clock time while `player.beacon` is on, under the sound arcs. It keeps a fixed set of meshes and reads no turn state.
- Commit: "Show the beacon pulse around the player's truck"

### PH3 — Browser check (no commit)
- `tmp/beacon-pulse.mjs` is a Playwright script, as `docs/tools.md#browser-checks` describes. On the factory server, launch with the CPU flags. It:
  1. Clones `__ROAM__.state`, strands the player's truck by zeroing the HP of its wheels or engine, and sets `turn` to a midday turn found with `daylightAt`. It places one NPC truck heard beyond sight so a sound arc shows. Then it calls `apply()`.
  2. Switches the beacon on through the HUD rescue panel's beacon switch, as a player would.
  3. Takes screenshots at 0.3 s, 1.2 s and 4 s after the switch (between pulses, so no rings expected) and after 6.3 s (second pulse).
  4. Switches the beacon off mid-pulse and takes a screenshot at the next frame plus 100 ms (no rings).
  5. Repeats steps 1-4 at a night turn.
  6. Saves with the beacon on, reloads, and takes a screenshot showing pulses resuming.
  7. Checks that `__ROAM__.beaconPulse.root.children.length` (read through a private-field cast) stays the same before and after 20 automatic turns.
  8. Checks that the beacon answer still happens: within the usual automatic turns, a tow offer arrives as on main. This is a smoke check. IV5 is proven by the diff, since the view writes nothing to the world.
- Visual acceptance: look at the day and night screenshots. The rings must be full circles, red, and below and distinct from the white sound arc. They must be gone in the between-pulse and switch-off shots. Put the screenshots in the conclusion for the user to confirm (AS1, UK1).
- Run `npm test`, `npm run typecheck`, `npm run playtest -- --cpu`, and `npm run quality` from the root.

### Test strategy
- Unit: PH1.2 covers IV1-IV4 and the constant ring thickness.
- IV5: `git diff --stat main` shows no file under `src/sim/`, `src/data/` or `src/phys/`. PH3 step 8 checks that a tow offer still arrives.
- Visual and no orphans: PH3.

### Order & dependencies
- PH1 then PH2 then PH3. PH2 needs PH1's class.

### Risks / rollback
- RK1 — Red might read as the destination marker or as damage. The marker is a static orange point and the beacon only exists while stranded, so the overlap is small. The user confirms the color from the screenshots, and the color is one `PAL` value to change.
- RK2 — In-place vertex edits of `RingGeometry` depend on its vertex order, inner circle first and then outer, per `phiSegments`. The PH1.2 radius test catches a wrong order. Rollback is a revert of two commits, with no save or data impact.

### Hands-off decisions
- udesign: new `BeaconPulseView` instead of extending `SoundRingView` — the sound ring owns what is heard and the beacon is a sent signal, so each concept keeps one owner.
- udesign: wall-clock period of 6 s, not per turn — automatic turns run about every 1.25 s while the beacon calls, so per-turn pulses would not be sparing.
- udesign: color `0xff4030` red, full circles, render order under the sound arcs — the clearest contrast with the white partial arcs. The user confirms it from the screenshots.
- udesign: pulses continue while turns are stopped or a modal is open — the beacon is still on in the sim, and the sound ring draws in the same cases.
- udesign: no change to the mechanics page — the change is visual only and the wiki rules are unchanged.
- uplan: plan auto-approved.

## Conclusion
- Built `BeaconPulseView` (`src/three/render/beaconPulse.ts`), `PAL.beacon`, wiring in `game.ts` and a render.md bullet. Unit tests cover IV1-IV4.
- Browser check (`tmp/beacon-pulse.mjs`, CPU render): red full rings show at pulse start (`tmp/beacon-night-800.png`) and all rings are hidden after the beacon goes off. The 10-tile reach fit the default zoom, so `PULSE.reach` stays. The day shot (`tmp/beacon-day-800.png`) fell between pulses. The user confirms color and opacity from the screenshots.
- Skipped: the strand/NPC sound-arc, save-reload and tow-offer parts of PH3, and the playtest, by instruction. The diff touches nothing in `src/sim/`, `src/data/` or `src/phys/`.
- `npm test`: `src/phys/traffic.test.ts` timed out once under full-suite load on this slow machine and passed alone. No code was broken. `npm run typecheck` passes.

### Testing stage
- Played the stranded truck with the beacon on in the browser (CPU render, clock frozen mid-pulse for a stable shot). Day (`.factory/screenshot.png`) and night (`.factory/view-night.png`) show two red full rings around the truck. All rings hide as soon as the beacon is off. No errors.
- No fixes needed. Not checked in the browser: the sound arc overlap (no NPC placed), save-reload and tow offer.

#### Visual comparison
No reference image came with the issue, so there was no image comparison.

#### Testing stage, round 2
- Merged base (radio antenna light feature). Resolved the render.md conflict by keeping both bullets. The quality gate rejected the merge on `src/three` fragmentation, so `RadioLights` moved from `radioLight.ts` into `vehicle.ts` and its two tests were joined in `vehicleRadio.test.ts`. No behavior change.
- Re-captured day and night shots on the final build: two red full rings, all hidden after the beacon goes off, no errors.
