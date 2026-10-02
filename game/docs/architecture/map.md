# Map and world

- The map is baked offline, never built in the game. `src/mapgen/bake.ts` runs fixed layers over one draft: base relief, geology, road and site finish, the old world, the new world, ground types and boulders.
- `src/mapgen/newworld.ts` grows scrub from moist ground, fills small basins with dirty water or toxic pools, and places shack camps with fences and junk, and car wrecks, with numbers in `NEW_WORLD`.
- `src/mapgen/oldworld.ts` places ruined settlements, overlook and bend buildings, old asphalt roads, old highways with broken bridges over deep gorges, power lines, billboards, tank hulks and dead fields, with numbers in `OLD_WORLD` in `src/data/terrain.ts`.
- `src/mapgen/geology.ts` holds the rain, slump, wind and dune rules, with numbers in `GEOLOGY` in `src/data/terrain.ts`.
- Baked props stay out of saves and are rebuilt from the map file on load. `decodeMap()` in `src/sim/terrain.ts` reads the file. Boot fetches it in `src/three/main.ts`, and tests use `TEST_MAP` from `src/test/map.ts`.
- The ship wing at Broken Wing is a baked prop, `shipWing`, placed first by `shipWing()` in `oldworld.ts` from `TERRAIN.features.wing`. Its collision boxes start 7 m up, so physics, nav and sight leave the road under it open like a canopy. Its two ground contacts, the tip strut and debris, stand off the road. The road stretch under it is straight in `scaleRoad`.
- `src/sim/bridge.ts` holds the Canyon Bridge geometry. The map stays one level. `heightAt` in `src/sim/terrain.ts` returns the deck height on the deck, and `groundAt` returns the canyon floor under it. Both rails block routes and physics, so trucks get on only over the ends.
- `src/sim/weather.ts` answers `weatherAt`, which every weather effect reads. `src/sim/sun.ts` owns time of day and sun heat, and `src/sim/engine-heat.ts` the player's engine heat. `src/sim/vision.ts` owns sight and fog of war, and `src/sim/locations.ts` discovery.
