# Stray fire

**Status:** executing
**Branch:** weapon-classes
**Worktree:** .worktrees/weapon-classes
**Goal:** A miss can hit another truck near the line of fire, explosions hit every truck in their radius, and accidental hits start a feud only past a damage threshold.
**Mode:** hands-off

## Context
- `applyShot()` in `src/sim/combat.ts` resolves every round against the aimed truck only. A round that misses lands on the ground, whatever stands near the line of fire.
- Splash applies only to a missed round, and only to lanes of the aimed truck. A direct cannon hit harms nothing around it.
- Every shot calls `noteAttack()` on its target, so damage always means an attack. No rule exists for accidental damage.
- `ShotRound` in `src/sim/types.ts` names no vehicle, so every consumer assumes its hits belong to the event's target: `noteHurt()`, `damagedByShots()`, the log in `src/ui/format.ts` and the volley playback in `src/three/game.ts`.

## Design
- Each weapon gets `stray`, the chance that a round which misses its target hits another truck instead.
- Candidates for a stray round are trucks other than shooter and target whose center lies within `RULES.stray.reach` tiles of the line of fire. The line runs from the shooter to `RULES.stray.reach` tiles past the target. One candidate is picked with world RNG, nearer to the line weighing more.
- A stray round enters the struck truck on the side facing the shooter, in a random lane, with its full damage and pen.
- A round with `splashRadius` above 0 explodes where it lands: on its target, on a stray truck, or on the ground at its miss offset. Every truck with a lane center within the radius takes splash in those lanes, on the side facing the blast. The lane a direct hit entered takes no extra splash.
- The trucks a round was not aimed at take unintended damage. Unintended damage is no attack: no `noteAttack()`, no feud, no lawmen.
- An NPC victim keeps a `strayFire` state toward the shooter with the unintended damage summed. When the sum reaches `RULES.stray.feudDamage`, the victim treats it as an attack by `noteAttack()`, which starts the feud as for a first shot. The state expires after its duration in `src/data/npcs.ts`, so old accidents are forgotten.
- The player decides its own hostility, so the player keeps no `strayFire` state.
- `ShotRound` gets `struck`, the truck the round landed on or null for the ground, and `blast`, a list of trucks and the part hits the explosion dealt. `hits` stays the direct hits on `struck`.
- `shotDamage(event)` in `src/sim/combat.ts` gives the part hits per truck of a shot. Every consumer reads it.
- Guard shots keep direct hits only, with `struck` set and an empty `blast`.
- The log shows stray and blast damage on the player. The volley playback flies a stray round to the truck it struck and lands a blast label on each damaged truck.
- Starting `stray` values are rough. `docs/tasks/weapon-roster.md` tunes them.

TDD: yes (stray picks, blast reach and the feud threshold are deterministic sim rules).

### Invariants
- IV1 — Unintended damage below `RULES.stray.feudDamage` never starts a feud or calls lawmen.
- IV2 — A round damages at most one truck directly. Blast damage reaches only trucks within its radius.
- IV3 — Stray picks draw only from world RNG, so the combat harness stays deterministic.
- IV4 — The saved event shape does not persist, but `strayFire` is a saved state kind, so `SAVE_VERSION` goes up.

### Principles
- PC1 — Existing aimed-shot odds stay as they are. Stray fire changes only where a missed round goes.

## Plan

Approach: extend `applyShot()` to resolve each round against a landing truck and a blast, then move every consumer to `shotDamage()`.

### PH1 — Sim rules
- `src/data/parts.ts` — `WeaponDef.stray`. Rough values per gun.
- `src/data/rules.ts` — `RULES.stray` with `reach` and `feudDamage`.
- `src/sim/types.ts` — `ShotRound.struck` and `ShotRound.blast`. `strayFire` state kind with a `damage` data field.
- `src/sim/combat.ts` — `applyShot()` split into `landRound()`, `strayTarget()`, `explode()` and `noteStray()`. `shotDamage(e)`. `damagedByShots()` reads it.
- `src/sim/states.ts`, `src/data/npcs.ts` — `strayFire` kind and its duration.
- `src/sim/guards.ts` — guard rounds fill `struck` and `blast`.
- `src/sim/npc-activities.ts` `addEventHurt()` — reads `shotDamage()`.
- `src/three/save.ts` — bump `SAVE_VERSION`.
- Tests in `src/sim/stray.test.ts`: a miss hits a truck on the line and never one far off it; a stray hit starts no feud; summed stray damage past the threshold starts one; a cannon hit splashes a truck beside the target and not one outside the radius; the player keeps no `strayFire` state.
- Commit: `Missed rounds can hit other trucks near the line of fire, blasts hit every truck in reach, and accidental hits start a feud only past a damage threshold`

### PH2 — Log and playback
- `src/ui/format.ts` — stray and blast damage on the player gets a log line.
- `src/three/game.ts` `playVolley()` and `src/three/render/projectiles.ts` `planVolley()` — each round lands at its `struck` truck, and blast labels show per truck.
- `src/three/sound.ts` — accents read `shotDamage()`.
- Commit: `Stray rounds fly to the truck they hit, and the log names stray damage`

## Verify

## Conclusion
