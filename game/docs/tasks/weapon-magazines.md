# Weapon magazines

**Status:** executing
**Branch:** weapon-classes
**Worktree:** .worktrees/weapon-classes
**Goal:** Each gun fires until its magazine is empty, then reloads. The HUD shows the player's ammo and the hover card shows enemy ammo. A button forces a reload. A `gun-empty` sound plays when any gun runs dry. Sound quality needs the user's ear.
**Mode:** hands-off

## Context
- `WeaponDef.reload` in `src/data/parts.ts` is the turns between shots. A gun fires every time it is ready, for as long as a fight lasts.
- With no pause in fire, there is no time when approaching a gun is safe.
- `fireBlock()` in `src/sim/combat.ts` says why a gun cannot fire. The weapon panel in `src/ui/weapons.ts` and the hover card in `src/ui/hitCard.ts` both read it.
- Shot sounds in `src/three/game.ts` depend only on the projectile look. No cue exists for an empty gun.
- `src/sim/ai.ts` and the price modifier in `src/data/parts.ts` each work out damage per turn on their own.

## Design
- `WeaponDef.reload` is renamed `cooldown`, the turns between shots. The word "reload" then means refilling a magazine only.
- `WeaponDef` gains `magazine`, the shots per magazine, and `reload`, the turns a full refill takes.
- `PartInstance` gains `ammo` and `reloadWork`, and its `reload` becomes `cooldown`.
- A gun that does not fire in a turn works one turn on its reload. Firing resets that work to 0. When the work reaches `reload`, the magazine is full.
- So an empty gun reloads without a break, and a gun that holds fire long enough refills a half magazine.
- `fireBlock()` gives `cooldown` for a gun between shots and `empty` for a gun with no ammo.
- The player can force a reload per gun. A sim command drops the rest of the magazine, so the gun reloads from empty.
- The shot that fires the last round pushes an `empty` event with the vehicle and weapon. The game plays the `gun-empty` cue at that truck, for the player and NPCs alike.
- The weapon panel shows each gun's ammo, like "4/6", or "reloading 2 turns", and a reload button. The hover card shows the same for the hovered truck's guns.
- Town and camp guard guns keep no magazine.
- `sustainedDamage(def)` in `src/data/parts.ts` gives damage per turn over a full magazine cycle. Prices and NPC danger in `src/sim/ai.ts` both read it.
- Existing guns get rough magazine numbers now. `docs/tasks/weapon-roster.md` tunes them.
- The `gun-empty` cue is generated with `npm run sfx:gen`, which costs credits. The user approves the variant count before the run.

TDD: yes (sim rules for ammo, reload work and the forced reload are deterministic and reused).

### Invariants
- IV1 — A gun with 0 ammo never fires.
- IV2 — Firing a round never raises ammo, and a reload never lifts ammo above `magazine`.
- IV3 — Every gun in `UNPRICED_PARTS` has a positive `magazine` and `reload`, checked by a content test.
- IV4 — The saved part shape changes, so `SAVE_VERSION` in `src/three/save.ts` goes up.

### Assumptions
- AS1 — The combat harness still finishes fights within its turn cap once guns pause to reload.
