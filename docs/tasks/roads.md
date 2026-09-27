# Roads

**Status:** in progress
**Branch:** roads
**Worktree:** .worktrees/roads
**Goal:** Every road is climbable by a loaded truck. Roads look worn and uneven, not like ruled strokes. Crossings look like one place, not one road pasted over another. Each area of the map has its own roadside landmarks, so players can tell where they are.
**Mode:** interactive

## Context
- Roads are polylines in `REGION.roads` with few points, so they run in long straight lines.
- Elevation flattens noise near roads, but broad rolling ground, site levels and craters stay. Then `heightFromElevation` makes ground above `mountainFrom` about 13 times steeper. Some road stretches reached a grade of 1.5, while a loaded hauler climbs 0.2.
- `paintRoad` in `src/render/groundPaint.ts` paints each road as two uniform strokes and two ruts on a canvas of about 3 pixels per tile. Roads are painted one after another, so at a crossing the later road covers the earlier one.
- Ex Machina references are in `tmp/exm/` of the main checkout. Power-line poles along roads show in `s4.jpg` and `s10.jpg`.

## Design
Road grading sets the ground on the road surface and in its margin after elevation. The surface holds `TERRAIN.roadGrade` between corners. The margin holds `TERRAIN.bankGrade`, so hills become cuttings and dips become banks. The graded ground stays as close to the ungraded ground as those grades allow. Crossings, junctions and sites share one graded surface.

Roads are drawn as meshes laid on the ground, like pads, with uneven width, worn edges and wandering ruts. Road shapes gain gentle bends.

A crossing is one worn patch. Ruts end at its edge.

Landmarks differ by area. Power-line poles run along the roads of one area. Other areas get old billboards, special wrecks or crags. There are no signposts. Every landmark stands beside the road and blocks trucks.

### Invariants
- IV1 — No two corners of a tile a road crosses differ by more than `roadGrade` per tile, except under Canyon Bridge. The deck holds the same grade.
- IV2 — Ground farther than the road margin from every road keeps its ungraded height.
- IV3 — No landmark blocks a road surface, and every landmark trucks can see also blocks them.

## Plan
- PH1 — Road grading. `src/sim/road-grade.ts`.
- PH2 — Road meshes with uneven width, worn edges, ruts and bends.
- PH3 — Crossing patches.
- PH4 — Landmarks per area.

## Verify
- PH1: `src/sim/road-grade.test.ts` checks IV1 and IV2 for three seeds. Road grades were up to 1.5 before and are at most 0.12 now. Terrain building takes about 250 ms longer. With cheap graded roads, fewer drivers leave the road, so the route variety test in `src/sim/path.test.ts` now plans 20 drivers instead of 10 to find three ways.
