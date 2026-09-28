# Perk redesign

**Status:** planning
**Branch:** perks
**Worktree:** .worktrees/perks
**Goal:** The 20 perks listed in DESIGN.md under Character replace the old 20 in code, each with a Vitest test of its rule, the character screen offers the new pairs, `npm test`, `npm run quality` and `npm run playtest` pass.
**Mode:** hands-off

## Context
- 15 of the 20 perks in `src/data/skills.ts` multiply a number the skill levels already grow, and 7 fire only after the player fails. DESIGN.md now lists 20 replacement perks in 10 pairs.
- Every perk reader goes through `vehicleHasPerk()` or `hasPerk()` in `src/sim/progress.ts`, with numbers in `PERK_NUMBERS`. The character screen and the `perk` cheat derive pairs from `PERKS`, so they need no logic change.
- Old perk readers sit in crash-contact, stats, detect, vision, combat, repair, inventory, search, salvage, resources, damage, defeat, parley, npc-decisions and patch, each with tests.
- `isWorld` in `src/three/save.ts` does not check `player.perks`. A save naming a removed perk loads and offers that pair again.
- Several new perks need state that does not exist: an engine stall, a dust screen flag, marked contacts, a weld job, a rebuilt flag, an NPC's last town and rumored wrecks.
- `update()` clears `draft.events`, so a dialogue effect cannot credit a bounty through the event scan in `bountyFulfilled`.

## Design
Replace the old perk set in one pass. `PerkId`, `PERKS` and `PERK_NUMBERS` hold the new 20. Every old reader and its test goes, and each new perk gets its hook and a test with and without the perk. Rule text in `PERKS` matches DESIGN.md. `SAVE_VERSION` goes up, so old saves with old perk ids and without the new fields do not load.

Per perk, the hook and the new state:
- Rammer: a damaging crash in `applyContactCrash` where the player hits a hostile truck sets `Vehicle.stalledUntil` to the turn it stalls through. `vehicleStats` treats a stalled engine as no working engine, and `soundRange` as silent. `isStranded` ignores the stall, so a one-turn stall does not draw tow offers.
- Cold running: `hearingRange` caps the reach at the listener's sight radius while the player drives below half its top speed.
- Dust screen: `advanceDust` flags a player cloud as `screen` when the truck drives at `PERK_NUMBERS.dustScreen.topShare` of its top speed or more. `inPlainView` treats a screen cloud within `PERK_NUMBERS.dustScreen.radius` of the sight line as a hill for any observer but the player. Line of fire stays unchanged.
- Steady aim: kept as is.
- Read the driver: kept, moved to level 2.
- Spotter: `player.marked` holds vehicle ids with an end turn one day ahead. A mark command marks a seen truck. `contactsOf` adds a `mark` contact with the scanner's radius for a marked truck out of sight. A key on the hovered truck marks it.
- Cargo eye: `formatNpcCargo` in `src/ui/format.ts` lists goods and spare parts of a seen truck in the hover panel.
- Night eyes: `sightRadius` skips the night factor.
- Welder: a new `weld` job kind spends `PERK_NUMBERS.welder.scrap` units of scrap metal and makes one Scrap sheet after `PERK_NUMBERS.welder.turns` parked turns. It needs room for the sheet after the scrap leaves. The inventory panel shows a Weld button.
- Cannibal: taking a part from a wreck stock or a knocked-out truck plans one job turn in total.
- Rebuild: `rebuildJunk` in `src/sim/wear.ts` sets a junk part to the last wear step and full HP and marks `PartInstance.rebuilt`. A town garage repair offers it for a junk part without that mark, at the full repair price of the part.
- Road mechanic: `priceOf` in `src/sim/patch.ts` doubles a paid patch when the player patches an NPC.
- Desert rat: `advanceEngineHeat` caps the sun elevation share at `PERK_NUMBERS.desertRat.sunShare`, the share at 9:00. Weather still scales it, so a heat wave still hurts.
- Storm rider: `sightRadius` and `spreadCauses` skip the weather factor for the player.
- Fight through: `checkKnockout` skips a broken cab while health is above half of `maxHealthOf`.
- Long haul: `healPlayer` skips its parked check.
- Market ears: NPCs record `brain.lastTown` when they finish a service at a town. A new trader topic `marketNews` asks for it and shows current buy and sell prices of that town through a new `prices` call value.
- Rumor mill: a new once-per-driver topic names the nearest undiscovered site or unsearched wreck stock within `PERK_NUMBERS.rumorMill.radius` of the driver. A site is discovered. A wreck joins `player.rumored` and gets a map label.
- Paid truce: a new topic during a feud offers a truce for `PERK_NUMBERS.paidTruce.share` of the driver's truck value. A player who can pay gets peace through `makePeace`, with no roll.
- Bounty talk: `yieldTo` credits a held bounty whose template matches the loser when the winner has the perk, through a new `creditBounty` in `src/sim/market.ts`.

Why this approach: each perk hooks at the one owner of its rule, as the old perks did. A generic perk effect layer would add an abstraction with no second use.

TDD: yes. Each perk is a deterministic sim rule with a test that fails before the hook.

### Invariants
- IV1 — Every new perk rule reads through `vehicleHasPerk()` or `hasPerk()`, so NPCs never get it. Each perk test checks an NPC or a player without the perk too.
- IV2 — Every perk number lives in `PERK_NUMBERS`, never inline.
- IV3 — Only `src/sim/wear.ts` writes part HP, including Rebuild.
- IV4 — No new perk draws from the world RNG, so seeds replay the same without the perk.
- IV5 — No old perk id remains in `src/`.
- IV6 — `SAVE_VERSION` rises by one, with a changelog line.

### Principles
- PC1 — A perk that needs a UI action gets the smallest control beside an existing one: a button in its panel or a key on the hovered truck.
- PC2 — New topics follow the data-plus-named-rule shape in `src/data/dialogue.ts`.

### Assumptions
- AS1 — `applyContactCrash` runs in the same turn pipeline before the turn counter moves, so `stalledUntil` can name the next turn.
- AS2 — Junk parts can sit in the grid as spares and reach the town repair panel.
- AS3 — Wreck obstacles in explored tiles render, so a rumored wreck label is enough to find it.

### Unknowns
- UK1 — Which key marks a hovered truck. M is mute.
- UK2 — How the town repair panel lists junk parts today.
- UK3 — How a `prices` call value renders in the call panel.

## Plan

## Verify

## Conclusion

### Hands-off decisions
- make: size Large — 20 perks across combat, detection, vision, jobs, dialogue, healing and knockout rules.
- udesign: tuning numbers for Welder, Dust screen, Desert rat, Rumor mill and Paid truce are picked in data and flagged for your tuning — no numbers were given.
- udesign: Market ears shows current prices, not a snapshot from when the driver left — simpler and close enough.
- udesign: Paid truce always succeeds when paid — the perk is the price, no roll.
- udesign: SAVE_VERSION bump, no migration — no backwards-compat per CLAUDE.md.
- make: reuse the existing branch `perks` and worktree `.worktrees/perks` — the user named them.
