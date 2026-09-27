# Defeat and rescue

**Status:** planning
**Branch:** defeat-rescue
**Worktree:** .worktrees/defeat-rescue
**Goal:** In the browser, a lost fight shows raiders looting the player's truck, the stripped truck crawls, and a passing trader or scavenger tows it to town for a fee on debt. Health at 0 ends the run. The user confirms the loop in play.
**Mode:** interactive

## Context

- `checkDefeat()` in `src/sim/defeat.ts` fires on a broken cab or on health at 0. It takes goods, spare parts and half the money, empties the tank and sets supplies to 4.
- Health never heals. Starving to 0 health triggers a robbery with no robbers, then refills supplies, so the player loops forever and never dies.
- Random wear can break the cab, which triggers a robbery with nobody near.
- After a defeat the truck crawls at limp speed with an empty tank. A town can be 300 turns away, and 4 supplies run out first.
- A truck with no engine mounted has a top speed of 0 in `vehicleStats()`.
- Raiders already search any wreck stock they see, through the scavenge activity in `chooseNpcActivity()`.
- The only social rules are that raiders fight everyone else and that a vehicle holds a grudge against whoever shot it.
- Supplies start at 12 of a cap of 20 and drain 0.03 per turn times heat. They last 160 to 220 daytime turns, and a road crossing takes 100 to 150, so exploring runs them dry.
- The user wants losses to start a new story, as in Kenshi, with no fade screens. Every event happens on real turns that the player can watch.

## Design

Losing a fight is a knockout. Health at 0 is death. A stripped or broken truck can always crawl, and passing traders and scavengers offer to tow it. The tow is the first social act: an NPC makes an offer, and the player accepts or refuses.

Knockout:

- A broken player cab with health above 0 knocks the player out.
- All mounted non-core parts, goods and spare parts move into a wreck stock at the truck's position. The truck keeps only its built-in core parts.
- Money is safe. The tank and supplies stay as they are. Grudges against the player are cleared, as now.
- While knocked out, turns run on their own and player commands are rejected. The player watches looters search the stock.
- The player wakes when no hostile vehicle can see the truck, or after `RULES.knockoutMaxTurns`. That limit guards against a raider idling in sight.
- On waking, broken core parts are patched to `RULES.defeatPatch` of their HP, as now. What the looters left stays as a normal stock beside the truck.

Raiders ignore trucks with nothing to take:

- A vehicle has loot when it holds goods, spare parts or mounted non-core parts.
- Raiders are not hostile to a vehicle without loot, unless a grudge says otherwise.

Crawling:

- A truck with no working engine, no engine at all, a broken transmission or an empty tank moves at limp speed. In the fiction, the driver pushes it.
- Pushing burns no fuel. Limp speed already makes no dust, and a truck without a working engine makes no sound.
- A player truck in this state is stranded.

Tow offer:

- A trader or scavenger that sees the stranded player starts a tow activity. It must not be hostile to the player or in danger, and the player must not have refused it before.
- It drives to the truck and parks within reach. Then it makes an offer: tow to the nearest town its class knows, for a fee.
- The fee is `TOW.base` plus `TOW.perTile` times the route length to that town.
- The HUD shows the offer with Accept and Refuse. Refusing or driving away ends it. That NPC never offers again.

Towing:

- An accepted tow hitches the player's truck to the tower. The player's truck leaves physics and sits `TOW.gap` tiles behind the tower along the tower's trail.
- The tower drives at `TOW.speedShare` of its top speed. Turns run on their own while towed.
- The player can unhitch at any time for free.
- If the tower enters a fight or flees, it drops the tow for free, and the player is stranded again.
- On arrival in the town, the tower unhitches and takes the fee. Money can go negative. A player in debt cannot buy anything, and sales pay the debt off.

Supplies:

- Start kits carry `RULES.suppliesCap` supplies, and `RULES.suppliesPerTurn` is halved. A full load lasts about 550 daytime turns.
- Healing spends `RULES.healSupplies` per turn on top of the normal drain.
- Without supplies, health drains `RULES.starveDamage` per turn down to `RULES.starveFloor`, which is 30, and stops there.

Death:

- Health at 0 kills the player. Starving stops at the floor, so only damage to the cab can kill.
- Cab damage keeps hurting health at `RULES.cabHealthShare` of 0.5, so a lost fight costs at most 30 health. A starving driver dies in a lost fight. A healthy driver dies on the fourth knockout without rest.
- The death screen offers Load last save and New game. A dead world is never saved.

Health and wear:

- A parked player with supplies, awake or knocked out, heals `RULES.healPerTurn` each turn. In a town the rate is multiplied by `RULES.townHealMult`.
- Wear and breakdowns never take the cab below 1 HP.

Saves go to version 8, with a migration from version 7 that sets the new player fields to their idle values.

Out of scope: faction standing, NPCs towing NPCs, the player towing others.

TDD: yes. Each rule is a sim rule with a Vitest test.

### Invariants

- IV1 — Player commands throw while the player is knocked out, towed or dead. Unhitch is the one command allowed while towed.
- IV2 — A knockout moves every non-core item into the wreck stock and none are lost or duplicated.
- IV3 — A knockout ends within `RULES.knockoutMaxTurns` turns.
- IV4 — A raider never treats a vehicle without loot as hostile unless one holds a grudge against the other.
- IV5 — A truck with core parts can always move at limp speed or faster.
- IV6 — The tow fee is charged once, only on arrival in town.
- IV7 — A world with a dead player is never saved.
- IV8 — Wear never takes the cab below 1 HP.
- IV9 — Starving never takes health below `RULES.starveFloor`.

### Principles

- PC1 — The tow is an NPC activity in `src/sim/npc-activities.ts`, chosen and run like the other activities.
- PC2 — The towed pose is derived from the tower's trail each turn. There is no joint or rope physics.

### Assumptions

- AS1 — Traders and scavengers pass within sight of a stranded truck on a road often enough that pickup takes tens of turns, not hundreds.

### Unknowns

- UK1 — Whether the loot rule belongs in `isHostile()` or only in raider decisions and targeting.
- UK2 — How to remove the towed truck's body from physics and restore it on unhitch.
- UK3 — How `src/three/game.ts` should run turns on its own, and at what pace. The pace goes in `.env`.
