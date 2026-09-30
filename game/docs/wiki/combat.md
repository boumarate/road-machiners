# Combat

Weapons and armor are in [items.md](items.md). This page says how they work together. The owner code is `src/sim/combat.ts` for fire and hostility, `src/sim/armor.ts` for rounds through the part grid, `src/sim/crash-contact.ts` for crashes, `src/sim/guards.ts` for town guns and `src/sim/defeat.ts` for knockouts.

## The turn

Both sides fire at the same time. Every weapon shoots when it is loaded, has a target in range and arc, and no tall part blocks its side. A weapon with reload above 1 waits that many turns between shots. Every value in the tables is multiplied by `RULES.weaponDamage` for rounds and `RULES.crashDamage` for crashes.

## Aim and spread

Each round gets an angular error with a spread. It adds up from the gun's own spread, reduced by the shooter's gunnery skill, a lead error of `RULES.leadError` times the target's crossing speed over the round's speed, `RULES.shake` per m/s of the shooter's own speed times the gun's shake, and the gun's recoil over the truck mass in tonnes. Range adds spread by `RULES.rangeFalloff` for the weapon's tier: a lower tier scatters more at full range. A target slower than `RULES.stillSpeed` stands still, and its spread shrinks to `RULES.stillSpread` of the full one. The hit chance stays between `RULES.minHit` and `RULES.maxHit`. A round that lands is a critical hit with chance `RULES.critChance`, which multiplies damage by `RULES.critDamage` and penetration by `RULES.critPen`.

## Penetration through the grid

A round enters a lane of the struck side and walks through the part grid. Every cell it passes costs `RULES.cellPen` penetration for the frame and bulk in the way, and each part in the cell stops its `armor`, or its blast armor for blast rounds. A part takes damage while it stops the round, and a round with penetration left goes on to the next cell. `src/sim/armor.ts` owns the walk.

## Blast and splash

A weapon with a splash radius hurts the lanes near a miss with its splash damage and splash penetration. Splash always counts as blast.

## Crashes

A crash gives each truck `RULES.ramDamage` times the impact squared, scaled by the other body's share of both masses, spread over the lanes of the struck side. Bumps slower than `RULES.collisionMinImpact` deal nothing. A crash into an obstacle faster than `RULES.hardCrashSpeed` hits harder by the square of the speed ratio. Crash damage has penetration `RULES.crashPen` per lane. Falls and landings use `RULES.groundCrash` and `RULES.landingDamage`. Rams multiply the damage a truck deals from their side.

## Town guns

Each town gate has one gun. It fires `RULES.guards.rounds` rounds each turn at the nearest vehicle in range that fired this turn at anyone but a raider. Guards judge by action, not faction.

## Knockouts and death

A broken cab knocks out the player and NPCs alike. A knockout ends after at most `RULES.knockoutMaxTurns` turns. An NPC whose cab breaks dies into a wreck with chance `RULES.npcDeathChance`. Broken core parts get back `RULES.defeatPatch` of their max HP when a driver wakes.

## Lawmen

Patrols of the Bowl Farmers and the Nose Army are hostile to raiders. `callLawmen()` in `src/sim/combat.ts` sets every lawman in sight on whoever fires the first shot at a neutral NPC or starts robbing one. See [npcs.md](npcs.md).

## Numbers

<!-- wiki:numbers -->
| path | value |
| --- | --- |
| `RULES.weaponDamage` | 1.2375 |
| `RULES.crashDamage` | 1.125 |
| `RULES.leadError` | 4.5 |
| `RULES.shake` | 0.002 |
| `RULES.rangeFalloff` | {"1":3,"2":2,"3":1} |
| `RULES.stillSpeed` | 0.1 |
| `RULES.stillSpread` | 0.6 |
| `RULES.minHit` | 0.05 |
| `RULES.maxHit` | 0.95 |
| `RULES.critChance` | 0.04 |
| `RULES.critDamage` | 2 |
| `RULES.critPen` | 2 |
| `RULES.cellPen` | 0.5 |
| `RULES.ramDamage` | 2.5 |
| `RULES.collisionMinImpact` | 1.5 |
| `RULES.hardCrashSpeed` | 4 |
| `RULES.crashPen` | 4 |
| `RULES.groundCrash` | 3 |
| `RULES.landingDamage` | 0.25 |
| `RULES.guards.rounds` | 4 |
| `RULES.knockoutMaxTurns` | 30 |
| `RULES.npcDeathChance` | 0.05 |
| `RULES.defeatPatch` | 0.25 |
<!-- /wiki:numbers -->
