# Tiny gameplay tweaks

## Context
- Roads in `src/data/region.ts` run through the centers of 12 small locations, like Old Orchard, Pump Station and Salvage Yard. Through traffic has to drive around them.
- The player starts 2 tiles outside the Bowl wall (`playerStart.offset`, used in `src/sim/world.ts:103`). The first thing a new player sees is the town.
- The `?` panel in `src/ui/hud.ts:170` is short and wrong. It says A for auto fire and W for weapons. The code uses Q and X, and WASD pans the camera. It does not explain route vs manual driving or E.
- The only truck particles are one dust dot behind the truck center and damage smoke (`game.ts:1082-1102`, `src/three/render/fx.ts`). Dust dots are round blobs of 0.5 to 0.7 m. There is no exhaust and no overheat smoke.
- Neutral NPCs spawn on a ring around a random town (`townSpot` in `src/sim/spawn.ts:96`). There are only two towns, so traffic starts in two clumps.
- A stranded truck looks the same as a working one. `isStranded()` in `src/sim/stats.ts:55` knows the state.
- Sun heat is per spot: `heatAt()` in `src/sim/sun.ts:60` is 1 in shade and at night and up to 2.5 in noon sun, more in a heat wave. Nothing on screen shows it, except the shade darkening from `src/three/render/shade.ts`.
- Raiders hunt at 5 fixed points in `HUNTING_GROUNDS` (`src/data/npcs.ts:613`). The points are not tied to roads or loot.

## Desired design
1. Every location except towns ends a road instead of sitting on one. Each moved location stands beside its old road point, with a short straight spur road to its gate. The junction stays where it was, so road layout and routes stay the same.
2. The player starts on the Bowl to Orchard road, about 55 tiles outside the Bowl wall. Bowl then shows only as grey at the edge of gray vision. The truck faces along the road. This road is the north trunk, which all Bowl to Nose traffic uses.
3. The `?` panel gives the play loop in a few short lines. It covers route driving, manual driving, turns, targets, fire, services with E, talking with T, and the camera. Every key it names matches the code.
4. Trucks get particle feedback in `src/three/render/fx.ts`, all render-only:
   - Black exhaust puffs come from the rear of the truck. Their rate grows with forward acceleration. At high speed a puff comes now and then at random.
   - White smoke comes from the front of the player truck while engine heat is at or above `ENGINE_HEAT.warnAt`. This is when the gauge turns red.
   - Dust comes from the ground contact of each wheel on the left and the right side. Each puff starts small, dense and fast, backward and outward. It then slows, grows wide and fades. Many small puffs make a stream instead of round blobs.
5. Neutral NPCs spawn, and respawn, outside a random gate of any town or non-camp location. Respawns keep the existing `SPAWN.campMinPlayerDist` from the player, so nothing pops in next to the truck. Initial spawns skip that rule, so the start road has traffic.
6. Raider hunting grounds come from the map, not from fixed points. There are two kinds. Road points lie along stretches far from any site. Pads of lootable locations are the other kind. Towns and camps are never hunting grounds.

7. A stranded truck puffs thick black smoke from its engine end, steadily, for player and NPCs. The view reads `isStranded()` once per turn per vehicle, not per frame.
8. Ground where the sun heats an engine shimmers like a hot day. The haze starts at heat 1.7. Below that, airflow cools a truck at top speed faster than the sun heats it: `1 + coolDriving / gain` from `ENGINE_HEAT`. The shimmer grows up to the heat of noon in a heat wave. It is drawn in the ground shader as a small wobble of the ground texture. A mask texture of heat per tile covers a patch around the player and updates once per turn. It reuses the patch shape and `inShade` of `ShadeView`, so the haze never disagrees with the heat the sim uses.

Out of scope: new exhaust sockets on models, engine heat for NPCs, new road layout, new help UI shape.

## Invariants and principles
- Sim stays deterministic. Spawn and hunting choices use world RNG. Particles use `Math.random()`, since they never change rules.
- No through road crosses a non-town site. A test checks that every road crossing a location's edge ends inside or on that edge.
- Every site still has a gate. `siteGates` throws if a road does not reach a site, so boot and tests catch mistakes.
- The player start is clear of obstacles. `world.ts` already throws if not.
- Hunting ground and particle numbers live in data files with a reason in the comment. Hunting numbers go to `src/data/npcs.ts`. Particle numbers stay in `fx.ts` beside the existing ones, since they are render-only.
- Bump `SAVE_VERSION`, since site positions change.

## Implementation plan
Work in `.worktrees/tiny-gameplay-tweaks`.

### Phase 1 — Locations beside the road
- `src/data/region.ts`: for each of the 12 locations on a road vertex, move `pos` sideways from that vertex. The gap is the site radius plus 10 tiles. That is half the road width of 3, the pad length of 5 and 2 tiles of margin. Pick each side by hand, away from other roads and the canyon.
- Add one straight spur road per moved location from the old vertex to the new center, next to the camp tracks.
- Test in `src/sim/sites.test.ts`: no road passes through a location. Existing mapgen, sites and path tests must pass.
- Screenshot the map around Orchard and Pump Station and look at them.

### Phase 2 — Start on the trunk road
- `src/data/region.ts`: replace `playerStart` with `{ road: 0, distance: <tiles along the road from Bowl's edge> }`. `world.ts` walks the road polyline to that point and sets the heading along the road. Put the truck on the right shoulder, so it does not block traffic.
- Test: the start is on road 0 and at least one sight radius outside Bowl.

### Phase 3 — Spawns and hunting grounds
- `src/sim/spawn.ts`: replace `townSpot` with `siteSpot`. It picks a random town or non-camp location, then a random gate, then a spot on the track outside it. This is the same shape as `campSpot`, and both share one gate helper. The player distance rule applies to respawns only.
- `src/data/npcs.ts`: drop `HUNTING_GROUNDS`. Add `HUNT` with road spacing and minimum site distance, with a reason for each.
- New `huntingGrounds()` in `src/sim/npc-decisions.ts`, built once from `REGION`. It returns road points every `HUNT.roadSpacing` tiles that lie at least `HUNT.siteDistance` from any site edge. It adds the pads of every location with salvage stock.
- Update `huntingGroundsAway`, `src/sim/progression/bot.ts` and `bot.test.ts` to use it.
- Tests: spawns land at several different sites for a fixed seed. Hunting grounds include road points and loot pads, and none lie in or near a town or camp.

### Phase 4 — Particles
- `src/three/render/fx.ts`: give each sprite its own start scale, end scale, start opacity, drag and color. Add `exhaust(p, dir)`, `steam(p)` and a stream-shaped `dust(p, dir)`. Size the pool from emission rate times life for the visible trucks, with the math in a comment.
- `src/three/game.ts` `vehicleParticles`: get the wheel contact points from `wheelMounts(body)` and the frame pose. Emit dust from each wheel, with the rate scaled by speed and `ground.dust`. Emit exhaust from the rear corner at roof height, by forward acceleration from `frame.acc`, plus a random chance above 80% of top speed. Emit steam for the player at the front while heat is at or above `warnAt`.
- Run `npm run playtest` and `npm run perf`. Take screenshots of dust, exhaust and steam. The user confirms the look.

### Phase 5 — Stranded smoke and heat haze
- `src/three/game.ts` `vehicleParticles`: emit `fx.smoke` in black from the rear while the vehicle is stranded. Cache stranded flags per vehicle when a turn commits.
- `src/data/wear.ts`: export the haze start as a derived value next to `ENGINE_HEAT`, with the reason above.
- New `src/three/render/haze.ts`: a `HeatHaze` that builds a heat mask DataTexture over the player patch each turn from `heatAt`. It feeds uniforms into the ground material through the existing `onBeforeCompile` hook in `src/three/render/roads.ts`. The ground shader offsets its texture lookup by animated noise times the mask.
- Test in Vitest: the mask is 0 in shade, at night and below heat 1.7, and above 0 in noon sun.
- Screenshot noon open ground next to a rock shadow. Check `npm run perf` for the added per-turn mask cost. The user confirms the look.

### Phase 6 — Help panel
- `src/ui/hud.ts`: rewrite the `?` lines. Draft:
  - Click the ground: drive there by road. Shift-click: stop there.
  - Space: play the turn. Hold Space: travel fast. Click your truck: brake.
  - R: manual mode. You drive straight at the point, through anything.
  - On a pad, press E to trade, repair or loot.
  - T: radio the truck under the cursor. Ask drivers the way. H: honk.
  - Click a truck to target it. 1-4 or 0 picks weapons. Q: auto fire. X: show weapons.
  - P: auto patch. C: character. I: inventory.
  - WASD or right-drag: pan. Wheel: zoom. F: center. V: camera mode. M: mute.
- Check each key against the handlers in `game.ts`, `camera.ts`, `hud.ts` and `dialogue.ts`.

## Verification
- `npm test`, `npm run quality` and `npm run playtest` pass.
- Manual try, positive: start a new game. The truck is on the road, and Bowl is grey in the distance. Traffic passes within a few turns. T on a driver gives directions. Driving the road past Orchard needs no detour. Dust streams from the wheels, and exhaust puffs on acceleration.
- Manual try, stranded: drain the fuel with the console. Black smoke starts. Refuel, and it stops.
- Manual try, haze: at noon, open ground shimmers and shaded ground beside a rock does not. At night nothing shimmers.
- Manual try, negative: set engine heat to 0.74 with the console. There is no steam. At 0.8 steam shows. Watch spawns for 50 turns with the player at a site. No NPC spawns within `campMinPlayerDist`.

## Result
- All six phases are done, one commit each, on branch `tiny-gameplay-tweaks`.
- Phase 1 moved 12 locations beside the roads on straight spurs. Dustwell sits west of its junction, so every pair of sites stays over 60 tiles apart. Driver taste strength went from 0.5 to 0.6. At 0.5 every Bowl to Nose driver took the same middle road. Now two roads get used, and drivers still keep to roads.
- Phase 2 put the start 54 tiles past the Bowl wall, on the trunk road. The player starts knowing no site. The progression bot now sells at the first town it finds.
- Phase 3 spawns neutrals at any non-camp site gate. Hunting grounds are 11 lonely road points and 8 salvage pads.
- Phase 4 moved particles to instanced billboards, one draw call per pool. It adds per-wheel dust streams, exhaust, overheat steam and breakdown smoke.
- Phase 5 added heat haze in the ground shader, from sun heat 1.7 up.
- Phase 6 rewrote the help panel.
- Two salvage restock tests passed only by RNG luck. They now run enough days to be certain.
- Checks: `npm test` gave 1411 passed. `npm run quality` passed. `npm run playtest` passed at 60 fps.
- `npm run perf` fails boot time and the first turn. Main fails the same checks with worse numbers: boot 3173 ms against 2824 ms here, first turn 247 ms against 214 ms here.
- Manual try, positive: the start is on the road with nothing discovered. The first NPCs spread over 8 sites. Screenshots show dust streams, black exhaust, white steam at heat 0.95 and black smoke when stranded. They also show haze at noon in a heat wave.
- Manual try, finding: a truck parked at the start first sees a neutral driver on turn 45. Traffic is not busy at the start, because no initial spawn lands near it.
- Open: the user confirms the look of dust, exhaust, steam, smoke and haze in motion.
