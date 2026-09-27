# Occluded Vehicle Outline

**Status:** reviewing
**Branch:** occluded-vehicle-outline
**Worktree:** .worktrees/occluded-vehicle-outline
**Goal:** A vehicle hidden behind terrain or props shows a filled silhouette, so the player never loses their truck on screen. User confirms the look in game.
**Mode:** interactive

## Context
- The camera looks down at 30 degrees from one side (`src/three/render/camera.ts`). Mountains reach about 11 height units, near 44 m, so a peak hides ground far behind it.
- Hills block sight in the sim through `TERRAIN.vision.eyeHeight`. Flattening the map would remove cover play, so the fix is in the renderer.
- `game.ts` draws a vehicle view while `isVehicleVisible` holds, or while it lingers after the player last saw it. The player truck is always visible.
- `VehicleView` in `src/three/render/vehicle.ts` builds each truck from many Lambert meshes under one root. Wheels and turrets move as child groups.
- The renderer has no stencil buffer today. Three.js 0.186 defaults `stencil` to false.

## Design
A vehicle hidden behind terrain or props shows a filled silhouette in its faction `top` color at half opacity. The user chose a filled silhouette over an edge outline, because an edge outline needs a full-screen post pass every frame.

Mechanism: each truck mesh gets a twin mesh that shares its geometry and sits under the same parent, so it follows wheels, turrets and pose for free. The twin uses one unlit material per view with these settings.
- It passes the depth test only where something nearer already covers the truck.
- It does not write depth.
- The normal truck meshes mark their pixels in the stencil buffer. The twin skips marked pixels, so the silhouette never paints over the visible truck itself.
- The twin marks the pixels it paints. So overlapping truck parts color each pixel once, and the half opacity stays even.

The renderer turns on the stencil buffer. The twins draw after the ground, obstacles and trucks, and below the path and zone overlays.

`game.ts` tells each view each frame whether to show its silhouette. It shows for the player truck always, and for other vehicles while `isVehicleVisible` holds. A lingering vehicle out of clear sight shows no silhouette.

A truck hidden behind another truck gets no silhouette over that truck, because the front truck marks the stencil first. That is acceptable.

Alternatives rejected: an edge outline post pass costs a full-screen pass and a new render pipeline. Fading the terrain in front of the truck needs per-chunk transparency and sorting.

No save, sim or config change. No compatibility risk.

TDD: no (a render-only change with no sim rule; it is verified by screenshots and playtest).

### Invariants
- IV1 — A silhouette shows only for vehicles the player sees now: the `seen` check in `game.ts`, which is `isVehicleVisible`, or a shot target during combat playback.
- IV2 — Where the truck is not covered, the silhouette paints no pixels.
- IV3 — The sim does not change. `src/sim/` gets no edits.

### Principles
- PC1 — The silhouette color comes from `FACTION_COLORS`. Its opacity and draw order are named constants in `vehicle.ts`, next to the other truck look constants.

### Assumptions
- AS1 — Twice the vehicle draw calls stays within `scripts/perf-budgets.json`.
- AS2 — Turning on the stencil buffer does not change how any existing view looks.

### Unknowns
- UK1 — Whether the unlit silhouette looks too bright at night. The user judges it in game.

## Plan
- PH1 — `src/three/render/vehicle.ts`: at the end of `rebuild`, every truck mesh marks the stencil, and gets a twin under the same parent with a per-view silhouette material. `silhouette(on)` shows or hides that material.
- PH2 — `src/three/game.ts`: the renderer gets `stencil: true`. The vehicle loop calls `view.silhouette(seen)`.
- PH3 — Playwright script in `tmp/` puts the player truck behind a hill and screenshots it. Then `npm run playtest` and `npm run perf`.

## Verify
- `tmp/hidden.mjs` puts the player truck behind a hill at tile 170,450 on the default seed. Before the change the truck is invisible there. After it, a faction-color silhouette shows. A truck in the open looks unchanged (IV2).
- Night: the silhouette keeps its day brightness, because it is unlit (UK1, for the user to judge).
- `npm run quality` and `npm run playtest` pass.
- `npm run perf` fails `bootMs` and `turnMs`. The parent commit 5019536 fails both by the same margin, so this change does not cause it. `frameP95Ms` stays 16.7 to 16.8 ms against a 17 ms budget on both (AS1 held).

## Code smells

## Conclusion
