# Site Collision and Walls

**Status:** in progress
**Branch:** site-collision-and-walls
**Worktree:** .worktrees/site-collision-and-walls
**Goal:** Sites are closed, static places. A truck approaches a site's gate and uses it from there, and it never drives inside. Each site's blocking shape is its visible outer edge. Walls, gates and site props look like worn places in the style of Ex Machina. The user confirms the look in game.
**Mode:** interactive

## Context
- The user named site collision the most annoying thing in the game. Trucks ram sites while trying to use them.
- Each town and location is one invisible cylinder at its full radius. `placeSites` in `src/sim/mapgen.ts` adds it as an obstacle of kind `site`. Physics in `src/phys/drive.ts` and route planning in `src/sim/nav/layer.ts` block that circle.
- Most sites draw far less than their circle. An oasis blocks a circle 48 m across, while its well is under 10 m wide. So trucks hit empty air.
- `canUseSite` in `src/sim/sites.ts` lets open sites work anywhere within `(radius + useRange) * interactionScale` of the center. Walled sites work within `gateReach` of a gate. Site salvage, towing, NPC visits and camp spawns all go through `canUseSite` or `siteGates`.
- Walls, gate towers, flags and houses are plain Three.js boxes built in code. Town walls are one flat tan color. The user finds them ugly, blocky and cartoonish.
- Ex Machina references are in `tmp/exm/`. A town is a concrete wall across the road with one gate, marked by green smoke on both posts. A checkpoint is two concrete blocks with sandbag gun nests on each side of the road. An industrial site has a silo, drill towers, a shed and a pipe on pillars. `sc/11.jpg`, `sc/04.jpg`, `sc/29.jpg` and `s10.jpg` show these.

## Design
Trucks never enter any site, town or location. The user chose this over drivable site interiors.

Collision stays one shape per site. The site's model fills that shape to its edge, and the edge is a visible boundary. So the truck hits a wall, fence or wreck pile, never empty air.

Every site gets at least one gate on its edge where a road arrives. A marked pad lies outside each gate. A truck uses the site while parked on a pad. This replaces the center range for open sites. Salvage, towing, NPC visits and camp spawns follow, because they already go through `canUseSite` and `siteGates`.

A click on a site sets a stop order on the pad of its nearest gate.

The gate opens when the player uses the site. The truck drives in through the gate and hides, and the site panel opens. When the panel closes, the truck drives back out onto the pad, and the gate closes. The animation is render only. The sim keeps the truck parked on the pad the whole time.

Each gate carries a marker that shows from far away, like smoke pots on the gate posts.

Walls, gates and key props become Blender models from `tools/blender/`.
- A concrete wall slab has panel seams, a top lip, barbed wire and stains.
- A buttress post joins slabs.
- A gatehouse has two heavy block towers, a beam across the top, a sign and sandbag gun nests. Its metal doors are separate parts, so the view can swing them.
- A scrap wall panel is built from corrugated sheets, car doors and spikes on posts.

Colors move from tan to gray concrete and rust.

Each kind of site gets a boundary that fits it.
- Bowl and Nose get concrete walls, a gatehouse tower and gate smoke.
- Scrapjaw and Kiln get scrap walls and concrete road blocks with turrets on sandbags.
- Pump Station and Granary get a fence with a gate, around a silo, drill tower and a pipe on pillars.
- Convoy sites and Salvage Yard get a ring of piled wrecks with a gate gap. Salvage Yard gets a crane arm.
- Oasis sites get a low wall of stone and palms around the water.
- Every site gets one tall shape visible from far away.

Landmarks like Canyon Bridge and Fallen Sun keep their own shapes. The bridge stays drivable.

### Invariants
- IV1 — No truck position inside a site's shape is reachable. Physics and route planning block the same shape.
- IV2 — The drawn boundary lies on the collision edge, within the width of the wall.
- IV3 — Every site has at least one pad that a truck can reach by road.
- IV4 — The gate animation never changes sim state.

### Principles
- PC1 — Layout numbers live in `src/data/`. Model sizes are stated in each Blender script docstring.

### Unknowns
- UK1 — Site radii may shrink to fit their models. Some sites then need a new gate position.
- UK2 — Whether the drive-in animation should skip during combat or automatic travel.

## Plan
- PH1 — Use spots: every site gets gates and pads. `canUseSite` works on pads only. A click on a site stops at its nearest pad. Tests cover use from a pad and refusal elsewhere. Done.
- PH2 — Boundaries: each site draws a boundary on its collision edge. Radii are tuned so models fill the shape. Done: every location names its edge in `src/data/region.ts`, and doors close every gate. Models are fitted to the radii instead.
- PH3 — Wall kit: Blender slab, post, gatehouse with doors and scrap panel. The user reviews each preview.
- PH4 — Gate animation: doors open, the truck drives in and hides, and the reverse on leave.
- PH5 — Site props per site, one site at a time, each reviewed in game.

## Verify
- PH1: `src/sim/sites.test.ts` covers gates on every site edge, pads outside each gate, use only on a pad, and site clicks. `tmp/pad-check.mjs dustwell` clicks the Dustwell center, and the truck stops and stays on the pad. `tmp/bowl-pad.mjs` shows the Bowl pad with the enter action.
- PH1 found two bugs. A truck without an order held its current speed, so a parked truck rolled faster down a slope into the site. It now brakes below parking speed. On a steep 0.2 grade the brakes still slip about 0.06 tiles per turn. The terrain canvas texture was flipped north to south, so roads, pads and ground colors drew on the mirrored half of the map. It now sets `flipY` false.
- PH2: `src/three/render/sites.test.ts` checks that every site has an edge with shut doors at each gate, that the edge lies on the collision circle, and that nothing below truck height pokes past it. The Fallen Sun hull overflowed its edge by 7 tiles, and the orchard's old fence line by 1. Both now fit. Canyon Bridge stays outside its site on purpose. Road crossings closer than `gateSpacing` share one gate, so door gaps never overlap.
