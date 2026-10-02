# Map and world

- The map is baked offline, never built in the game. `src/mapgen/bake.ts` runs fixed layers over one draft: base relief, geology, road and site finish, the old world, the new world, ground types and boulders.
- `src/mapgen/newworld.ts` grows scrub from moist ground, fills small basins with dirty water or toxic pools, and places shack camps with fences and junk, and car wrecks, with numbers in `NEW_WORLD`.
- `src/mapgen/oldworld.ts` places ruined settlements, overlook and bend buildings, old asphalt roads, old highways with broken bridges over deep gorges, power lines, billboards, tank hulks and dead fields, with numbers in `OLD_WORLD` in `src/data/terrain.ts`.
- `src/mapgen/geology.ts` holds the rain, slump, wind and dune rules, with numbers in `GEOLOGY` in `src/data/terrain.ts`.
- Baked props stay out of saves and are rebuilt from the map file on load. `decodeMap()` in `src/sim/terrain.ts` reads the file. Boot fetches it in `src/three/main.ts`, and tests use `TEST_MAP` from `src/test/map.ts`.
- `src/sim/bridge.ts` holds the Canyon Bridge geometry. The map stays one level. `heightAt` in `src/sim/terrain.ts` returns the deck height on the deck, and `groundAt` returns the canyon floor under it. Both rails block routes and physics, so trucks get on only over the ends.
- `src/sim/weather.ts` answers `weatherAt`, which every weather effect reads. `src/sim/sun.ts` owns time of day and sun heat, and `src/sim/engine-heat.ts` the player's engine heat. `src/sim/vision.ts` owns sight and fog of war, and `src/sim/locations.ts` discovery.

## Fortresses

- `src/mapgen/fortress.ts` runs last in the bake. For each site in `FORTRESS_SITES` (`src/data/fortress.ts`) it lays a closed curtain, circle, square or star, of `fortWall`, `fortTower`, `fortGate`, `fortBastion` and `fortInner` props. Prop group is the site's index in towns then locations, and step is the piece index.
- Each gatehouse's outer face sits on the site circle at a `siteGates()` point, so gates, pads, guards and tows work as before. `site.radius` is only the layout bound.
- A fortress site has no `site-<id>` circle obstacle. The pieces collide through their `prop-shapes.json` boxes in Rapier, the nav grid and sight. A wall stretches along its length to `2r`.
- `isFortress()` in `src/sim/sites.ts` names these sites. `isFree()` rejects the ground inside one, and discovery looks as far out as a pad is long, since the walls hide the inside.
- `buildSites()` fits each interior inside `insideCurtain()`. Abandoned sites keep their circle and edge.
