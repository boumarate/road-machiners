# Old world map layer

**Status:** design
**Branch:** procedural-map
**Worktree:** .worktrees/procedural-map
**Goal:** The baked map carries an old world placed by rules from terrain, sites and roads: ruined settlements on flat ground, buildings on overlooks and road bends, faded old roads with broken bridges where washes cut them, bridges on today's roads over washes, power lines, billboards, tank hulks and dead fields. The fixed landmark rows are gone. The user confirms the look from the bake pictures and in play.
**Mode:** interactive

## Context

- `docs/tasks/map-geology.md` built the bake: layers over one draft in `src/mapgen/bake.ts`, a map file read by `decodeMap()`, and pictures in `tmp/map/`. The file stores only rocks as props, as position and radius.
- Fixed landmark rows come from `REGION.landmarks` in `src/data/region.ts`: power poles, billboards, rock spires and tank hulks at even steps along roads in four areas. `generateObstacles()` places them at boot, the same on every map.
- Obstacles drive, block sight and draw by kind. `building` and `landmark` kinds exist, with models for building, silo, water tower, bridge, billboard, power pole, tank hulk and crag.
- `world.obstacles` is saved whole, so every baked prop also lands in each save. Today that is about 1,300 rocks.
- Sight checks filter the whole obstacle list per query in `src/sim/vision.ts`, so more props cost more per check.
- The ground has a cracked asphalt type with no rule since geology dropped the noise patches.
- Decided with the user: old world comes before the new-world layer, broken bridges appear on both old and current roads, old world replaces the fixed landmark rows, and art reuses existing models plus about four new ones.

## Design

An old-world layer runs after geology and before the road finish. It reads terrain, flow and today's sites and roads, and writes props and ground types into the draft. Each rule is a separate function with its numbers in an `OLD_WORLD` table in `src/data/terrain.ts`.

Rules, in order:

1. Old settlements. Flat, dry spots near today's sites and junctions score high. Picks keep a minimum spacing. Each settlement gets a cluster of ruined houses, and a farm settlement also gets a silo or water tower.
2. Overlooks and bends. Hilltop edges with a wide drop get a lone building. Outer sides of sharp road bends get a building or a gas station.
3. Old roads. Straight-ish routes on the terrain connect old settlements to each other and to today's roads. They are cracked asphalt tiles, not graded, so they follow the ground. Where an old road crosses a wash bed or the canyon, it breaks: the asphalt stops, and a broken bridge span stands on each side.
4. Bridges on today's roads. Where a road crosses a wash bed, a low road bridge stands over the crossing. A share of them are broken. There the road dips through the wash on grade instead of a causeway.
5. Power lines. Poles run along one side of today's roads between sites. Some poles are down or missing.
6. Billboards. They stand on the approach to towns and on long straight stretches, with spacing.
7. Tank hulks. They lie along old roads near old settlements, in small groups.
8. Dead fields. Flat low ground beside farm settlements becomes rectangles of a new dry field ground type.

Rock spires move to geology as tall rocks on ridge tops.

All props share one baked list with a kind, a position, a radius and a facing. The map file stores that list in place of the rock list, as format version 2. Baked props do not go into saves. The world rebuilds them from the map file on load, like the terrain.

Ruins, bridges, poles, billboards and hulks block driving and sight like today's landmarks. They give cover in fights. Fields are only ground.

New Blender models: a ruined house shell, a broken bridge span, a road bridge deck and a gas station. The rest reuse existing models.

The bake pictures gain a prop layer, so each kind shows in its own color.

TDD: yes. Placement rules are deterministic functions with clear properties.

### Invariants

- IV1 — The same map seed and rules give a byte-identical map file.
- IV2 — No prop stands on a road surface, pad, site or the Canyon Bridge deck, and every road keeps a clear lane.
- IV3 — Every town and location stays reachable by route from every other, as the existing route tests check.
- IV4 — Baked props never enter a save. A loaded world holds the same baked props as a new one.
- IV5 — Old roads and fields never overwrite built ground: roads, pads and sites.

### Principles

- PC1 — A bake with pictures stays under 60 seconds.
- PC2 — Props come from terrain and sites through rules. No coordinate lists by hand, except today's sites and roads as inputs.

### Assumptions

- AS1 — A few thousand more static obstacles keep turn time and frame rate inside `scripts/perf-budgets.json`.
- AS2 — The route grids handle the new static obstacles without slower route searches.

### Unknowns

- UK1 — Whether a broken bridge on today's road can let the road dip through the wash without breaking the road-grade limits, or must stay a causeway with a broken deck beside it.
- UK2 — Whether sight checks need a spatial index once props grow to thousands.
- UK3 — Speed, wear and dust numbers for the dry field ground type.

## Plan

## Verify

## Code smells

## Conclusion
