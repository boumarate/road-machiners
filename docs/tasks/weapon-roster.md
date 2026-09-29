# Weapon classes and roster

**Status:** executing
**Branch:** weapon-classes
**Worktree:** .worktrees/weapon-classes
**Goal:** Every tier has one chip, damager and precision gun and one gun per mix of two classes, and the combat harness shows each class doing its job.
**Mode:** hands-off

## Context
- There are seven guns: MG and shotgun at tier 1, forward cannon and autocannon at tier 2, tank gun, rocket rack and sniper cannon at tier 3.
- A round deals the same damage to every part it meets, armor or not. No gun is better at stripping plates than at wrecking what lies behind them.
- So the only way to beat armor is more pen or more damage, and the biggest gun wins every job.
- Guns are assembled from shared mounts, receivers and barrels in `WEAPON_POOLS` in `src/render/partLooks.ts`, so a new gun can reuse existing pieces.

## Design
- Every gun has hidden classes, `classes` in `WeaponDef`: damager, chip or precision. The player never sees them.
- Damagers deal high damage to parts behind armor and splash, but little to armor itself. They have narrow arcs and wide spread.
- Chippers deal good damage to armor parts and little to other parts, at mid range with wide spread.
- Precision guns reach far with low spread and a low rate of fire. They suit aimed shots at one part, like a wheel.
- A round gets `armorShare`: armor parts take its damage times this share. Damagers sit below 1 and chippers above 1.
- Each tier has one gun per pure class and one per pair of classes: damager and chip, damager and precision, chip and precision. That makes 18 guns.
- Tier 1: MG is chip. Shotgun is damager. Long rifle is precision. Flamer is damager and chip. Pneumobolter is damager and precision. Slug cannon is chip and precision.
- Tier 2: Heavy MG is chip. Forward cannon is damager. Anti-materiel rifle is precision. Autocannon is damager and chip. Recoilless rifle is damager and precision. Battle rifle is chip and precision.
- Tier 3: Gatling MG is chip. Rocket rack is damager. Sniper cannon is precision. Grenade launcher is damager and chip. Tank gun is damager and precision. Flechette gun is chip and precision.
- New guns take models from existing pool pieces. New Blender pieces are a follow-up.
- Prices come from the stat modifier and each tier's price band. Garages stock every part already.
- NPC loadout tables and the trader spares gain the new guns at weights that keep each template's gun mix close to today.
- Crash and guard rounds use an `armorShare` of 1.

TDD: yes (the armor share rule and the roster shape are deterministic).

### Invariants
- IV1 — Each tier has exactly one gun per class set: D, C, P, DC, DP and CP, checked by a content test.
- IV2 — A pure damager has `armorShare` below 1 and a pure chipper above 1.
- IV3 — The pure precision gun of a tier has the lowest spread and the longest range in its tier.
- IV4 — Every gun has a pool in `WEAPON_POOLS` and a projectile look, and prices land in its tier band.

## Plan

### PH1 — Armor share
- `src/sim/armor.ts` `Round` gains `armorShare`. `walkLane()` multiplies damage to armor parts by it.
- Call sites in `src/sim/combat.ts`, `src/sim/guards.ts`, `src/sim/crash-contact.ts`, `src/sim/salvage.ts` and tests pass it.
- Test in `src/sim/armor.test.ts`: an armor part takes damage times the share, and the part behind takes the same damage as with share 1.
- Commit: `A round's armor share scales its damage to armor parts`

### PH2 — Roster
- `src/data/parts.ts` — `WeaponClass`, `classes` and `round.armorShare` on every gun. Eleven new guns. The seven old ones retuned to their class.
- `src/render/partLooks.ts` — pools for the new guns. `src/three/render/projectiles.ts` — a look per new gun.
- `src/data/npcs.ts` — weapon tables, light guns and trader spares take new guns.
- `src/data/content.test.ts` — IV1 to IV4, and the range table.
- Commit: `Eighteen guns in three classes: damagers wreck parts behind armor, chippers strip armor, precision guns pick parts off from afar`

### PH3 — Harness check
- Run `npm run combat` for tier-matched duels and record hit rates and time to kill per class against armored and bare trucks.
## Verify

## Conclusion
