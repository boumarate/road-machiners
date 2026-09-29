# NPC gear levels

## Context
- `generateNpcLoadout()` in `src/sim/npc-loadout.ts` mounts one engine, one gun, one optional cargo part and one optional armor piece under a budget.
- A coverage report over 60 seeds per template found one gun on every template but gunwagons, and cab armor cover of about half on the front and near zero on the sides and rear.
- The user found the same in play: randomkit trucks had one gun and patchy armor, and a gunwagon's bare cab broke to a starter MG.

## Desired design
- Each NPC rolls a gear level with world RNG from its template's weights: poor, light, standard, heavy or loaded.
- `GEAR_LEVELS` in `src/data/npcs.ts` gives each level a gun count roll, an armor cover target, a budget multiplier, a wear shift and a cargo multiplier.
- The budget of a loadout is the template budget times the level's multiplier.
- Fill passes, each stopping at its target or when nothing more fits: engine and main gun, extra guns, armor by side, one utility part, then cargo and spares.
- Extra guns come from the template's light gun pool. Gun spots favor sides no other gun covers, so a gunwagon's MG ends up covering its back.
- A template can set a minimum gun count. Gunwagons have 2.
- Armor fills sides in order: front, both flanks, rear. Each side uses one armor type from the template pool. Pieces go where they shield the most cab lanes. The armor cover target is a share of the chassis edge cells.
- Wear rolls shift by the level. Goods and spares counts scale by the level's cargo multiplier.
- Each template has target bands for average guns and armor cover. A test fails when an average leaves its band.
- `npm run loadouts` prints the level mix, guns, armor cover per side, cab cover, gear value, mass share and cargo value per template.
- `randomkit [template] [level]` draws from the same generator.

## Invariants and principles
- Every part passes the budget, rated mass, grid room and every-gun-fires checks.
- All randomness uses world RNG streams as today, so seeds stay deterministic.
- Numbers live in `src/data/npcs.ts`.
- Every chassis in every table rolls a loadout at every level.

## Verification
- Loadout, spawn, cheats and console tests pass, and the band test passes.
- `npm run loadouts` shows varied trucks: some poor, some loaded, decent averages.
- Rerun the combat duels and the econ harness, and report the changes.
