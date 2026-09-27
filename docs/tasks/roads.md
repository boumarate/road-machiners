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

Roads are drawn as meshes laid on the ground, like pads, with uneven width, worn edges and wandering ruts. The ground texture no longer paints roads. Road shapes gain gentle bends. A bend sways sideways between two given road points and is zero at both, so junctions and site entries stay put. The stretch over Canyon Bridge stays straight.

A crossing is one worn patch. Ruts end at its edge.

Landmarks differ by area. `REGION.landmarks` names each area as a circle with its landmark, spacing and footprint. A power line runs along the northern roads between Scrapjaw, Dustwell, Granary and Burnt Convoy. Old billboards stand between Podfield and Nose. Rock spires rise along the canyon roads east of Salvage Yard. Dead tanks lie along the southern roads around South Lock. There are no signposts. Every landmark is an obstacle of kind `landmark`, so it blocks trucks, routes and sight. Placement reads only the fixed roads, not the world seed, so every map has the same landmarks. `src/sim/mapgen.ts` places them after rocks and road wrecks and skips spots that would overlap anything.

### Invariants
- IV1 — No two corners of a tile a road crosses differ by more than `roadGrade` per tile, except under Canyon Bridge. The deck holds the same grade.
- IV2 — Ground farther than the road margin from every road keeps its ungraded height.
- IV3 — No landmark blocks a road surface, and every landmark trucks can see also blocks them.

## Plan
- PH1 — Road grading. `src/sim/road-grade.ts`.
- PH2 — Road meshes with uneven width, worn edges, ruts and bends. Done: `src/three/render/roads.ts` draws the strips, and `scaleRoad` in `src/data/region.ts` bends each stretch between its given points.
- PH3 — Crossing patches. Done in `src/three/render/roads.ts`.
- PH4 — Landmarks per area. Done: placement in `src/sim/mapgen.ts`, views in `src/three/render/obstacles.ts`, and models from `tools/blender/power_pole.py`, `billboard.py`, `crag.py` and `tank_hulk.py`.

## Verify
- PH1: `src/sim/road-grade.test.ts` checks IV1 and IV2 for three seeds. Road grades were up to 1.5 before and are at most 0.12 now. Terrain building takes about 250 ms longer. With cheap graded roads, fewer drivers leave the road. The route variety test in `src/sim/path.test.ts` now plans from Nose to Bowl, where ten drivers still take three ways.
- PH2 and PH3: road strips end at site edges and at the Canyon Bridge gap. Strip heights follow the drawn ground triangles, not the bilinear sim height, so strips do not sink into tile creases. `src/three/render/roads.test.ts` checks crossing detection. Bends every 3 tiles slowed terrain building, since the road index held 886 segments, so bends now place a point every 6 tiles. Under the same machine load, boot is 2.94 s against 2.87 s on main. The new map changed which random rolls some NPC tests got, so those tests now force the decisions they depend on. One corridor route in `src/sim/path.test.ts` became 9% longer than the reference while its cost stays within 5%, so its length tolerance is 10%.
- PH4: `src/sim/mapgen.test.ts` checks each area has its landmarks, none reaches a road surface or site, all block trucks, none overlaps another obstacle, each faces its road, and places match across seeds. Billboards carry paint on both faces, since the camera sees about half of them from behind. At the default zoom a billboard still reads weakly, which needs the user's review.
