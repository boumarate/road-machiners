# Debug Console

**Status:** executing
**Branch:** debug-console
**Worktree:** .worktrees/debug-console
**Goal:** In any build, the user opens an in-game console, types cheat commands, and the game enters the requested test situation. The user confirms the command set covers the situations they test.
**Mode:** interactive

## Context

- Test situations are set up today by Playwright scripts in `tmp/` that clone `__KOROVAN__.state`, edit it and pass it to `apply()`. Examples: `tmp/fight.mjs` moves a raider next to the truck, `tmp/night.mjs` sets `world.turn` for a given hour.
- `Game.apply(next)` in `src/three/game.ts` swaps the world, pauses travel, syncs physics bodies and refreshes the UI. It is the one seam for outside world edits.
- The game key handler ignores keys while an input has focus, through `isEditingControl()`.
- `spawnOne` in `src/sim/spawn.ts` builds an NPC from a template at a camp or town spot. It cannot place an NPC at a chosen point.
- Damage to the player comes from many rules: `damagePart`, engine heat, wear, starvation and fuel use. All run inside `endTurn` before `resolveDestroyed`, `checkDeath` and `checkKnockout`.
- Saves store the whole world with a version number and migrate old versions on load, in `src/three/save.ts`.

## Design

A console line opens with the backtick key in every build. The user types a command and presses Enter. The console prints the result or an error. Up and down arrows walk the command history. `help` lists every command with its usage.

Three layers keep sim rules testable and the UI thin:

- `src/sim/cheats.ts` holds one pure world function per cheat. Each takes a world and typed arguments and returns a new world through `update()`. Each validates its arguments and throws on bad input.
- `src/ui/cheat-commands.ts` holds the command table. Each entry has a name, a usage line, a help line and a run function. The run function parses text arguments into typed values and calls the sim cheat. Parsing is pure, so Vitest covers it.
- `src/ui/console.ts` draws the input line and the output log in the overlay. On Enter it runs the command against `game.state` and passes the result to `game.apply()`. A thrown error prints in the console log in red and leaves the world unchanged. The console refuses commands while a turn plays.

Commands in the first set:

- Resources: `money <n>`, `fuel <n>`, `supplies <n>`, `health <n>`, `xp <n>`, `skillpoints <n>`. Each sets the value. Fuel and supplies are capped by the truck's limits.
- Truck state: `repair` restores every part to full. `damage <part def> <hp>` sets a mounted part's hit points. `give <part or good id> [count]` adds to the truck grid and fails when there is no room. `god` toggles god mode.
- World setup: `tp <location id>` or `tp <x> <y>` moves the truck to a free spot and stops it. `hour <h>` advances the turn to the next turn at that hour. `weather <storm|heatwave|overcast>` starts that weather, and a storm starts at the truck. `reveal` marks the whole map explored.
- Encounters: `spawn <template id> [hostile]` places that NPC at a free spot near the truck. `hostile <vehicle id>` makes a vehicle hostile to the player. `kill <vehicle id|hostiles|all>` destroys vehicles. `list` prints nearby vehicles with id, template, faction and distance.

God mode is a saved flag, `player.god`. A sim step in `endTurn` restores the player's parts, health, fuel and supplies right before `resolveDestroyed`. So hits, wear and heat still show during the turn, but the truck never breaks down, dies or gets knocked out. This needs one save version bump, and the migration sets `god` to false.

Rejected approach: a button panel. Buttons do not scale to commands with arguments like `spawn gunwagon hostile`.

Rejected approach: cheats written in the UI layer that edit the world directly. They would skip Vitest and duplicate sim rules like spawn placement.

`spawn.ts` gets a shared `spawnAt(world, template, pos)` that both `spawnOne` and the spawn cheat call. That keeps one path for building NPCs.

Backwards compatibility: the save version goes from 8 to 9. Version 6 to 8 saves migrate by setting `god` to false. No other consumers exist.

TDD: yes. Sim cheats and command parsing are deterministic and reusable rules.

### Invariants

- IV1 — Every cheat changes the world only through a function in `src/sim/cheats.ts` and `Game.apply()`.
- IV2 — A failed command leaves the world unchanged and prints the error in the console.
- IV3 — Game keys do nothing while the console input has focus.
- IV4 — `spawn` and `tp` never place a vehicle overlapping another vehicle or a drive obstacle.
- IV5 — With god mode on, a turn never ends with the player knocked out or dead.
- IV6 — Cheat code does not import Three.js or Rapier from `src/sim/`.

### Principles

- PC1 — Every command error names the bad argument and the valid choices, for example the list of template ids.
- PC2 — Numbers in cheats come from `src/data/`, like the spawn search distance.

### Assumptions

- AS1 — `apply()` refreshes every view that depends on truck position, fog and weather, so `tp`, `reveal` and `weather` show at once.
- AS2 — Setting `world.turn` forward breaks no rule that counts turns, like spawn timers or weather timers.

### Unknowns

- UK1 — Whether destroying a vehicle outside a turn can reuse `resolveDestroyed`, or needs its own path for loot and XP.
- UK2 — Whether the backtick key reaches the page on all keyboard layouts the user has, or needs a second key.

## Plan

Approach: sim cheats first with Vitest, then the text command table, then the console UI. Each layer only calls the one below it, so each phase is testable alone. `CheatError` marks bad user input. The console catches only that error type, so real bugs still reach the crash screen.

### PH1 — Sim cheats and god mode
- 1.1 `src/sim/types.ts:184-212` (modify) — `Player.god: boolean`, god mode on or off.
- 1.2 `src/sim/world.ts:34-110` (modify) — `newWorld` sets `god: false`.
- 1.3 `src/sim/world.ts:170-205` (modify) — `endTurn` calls `applyGodMode(w)` after `leakFuel` and before `resolveDestroyed`. Respects IV5.
- 1.4 `src/data/cheats.ts` (create) — `CHEATS` with the spawn distance from the truck, the free-spot search step and ring count. Respects PC2.
- 1.5 `src/sim/spawn.ts:33-58,86-104` (modify) — extract `spawnAt(world: World, tpl: NpcTemplate, pos: Vec): Vehicle` from `spawnOne`. Export `isFree`. Respects IV4.
- 1.6 `src/sim/weather.ts:35-54` (modify) — extract `makeWeather(world: World, kind: WeatherEvent['kind'], pos: Vec): WeatherEvent` from `spawnIfClear`. The storm takes `pos`, and other kinds ignore it.
- 1.7 `src/sim/cheats.ts` (create) — `class CheatError extends Error`. Each command below returns a new world through `update()` and throws `CheatError` on bad input. Respects IV1, IV2, IV6, PC1.
  - `setMoney`, `setFuel`, `setSupplies`, `setHealth`, `setSkillPoints` `(world, n: number): World`. Fuel caps at `chassisDef().fuelCap`, supplies at `RULES.suppliesCap`, health at `RULES.maxHealth`. Negative values throw.
  - `addXp(world, n): World` goes through `gainXp`, so levels follow.
  - `repairAll(world): World` sets every player part to full hit points.
  - `damagePartTo(world, defId: string, hp: number): World` sets the first mounted part with that def.
  - `give(world, id: string, count: number): World` stows parts with `stowPart` and goods with `addGoods`. It throws when the grid lacks room.
  - `toggleGod(world): World`.
  - `applyGodMode(world): void` mutates a draft. It restores parts, health, fuel and supplies when `player.god` is on.
  - `teleport(world, target: Vec): World` puts the truck at the nearest free spot to `target`, clears the order and speed, and refreshes vision.
  - `locationPos(id: string): Vec` returns a town or location center from `REGION`.
  - `skipToHour(world, hour: number): World` moves `turn` to the first later turn whose `clockOf` hour floors to `hour`.
  - `startWeather(world, kind): World` removes any event of that kind and adds `makeWeather` at the truck.
  - `revealMap(world): World` fills `explored` with 1 and refreshes vision.
  - `spawnNear(world, templateId: string, hostile: boolean): World` finds a free spot at `CHEATS.spawnDistance` and calls `spawnAt`.
  - `makeHostile(world, vehicleId: string): World` adds the player truck to the vehicle's grudges and its brain's attackers.
  - `killVehicles(world, target: string): World` takes a vehicle id, `hostiles` or `all`. It zeroes each cab and calls `resolveDestroyed`, so wrecks and salvage appear. `lastHitBy` stays as it is, so no bounty is paid. Resolves UK1.
  - `nearbyVehicles(world): VehicleRow[]` is a query for `list`, sorted by distance.
- 1.8 `src/three/save.ts:19-60` (modify) — `SAVE_VERSION` 9. Versions 6 to 8 load, and `migrateFrom8` sets `god` to false.
- 1.9 `src/sim/cheats.test.ts` (create) and `src/three/save.test.ts` (modify) — tests first, see Test strategy.
- Commit: Add sim cheats and god mode

### PH2 — Command table
- 2.1 `src/ui/cheat-commands.ts` (create)
  - `type Command = { name: string; usage: string; help: string; run(world: World, args: string[]): CommandResult }`.
  - `type CommandResult = { world: World | null; lines: string[] }`. `world` is null for queries like `help` and `list`.
  - `runCommand(world: World, line: string): CommandResult` splits the line and dispatches. Unknown commands, wrong argument counts and bad numbers throw `CheatError` with the usage line. Respects PC1.
- 2.2 `src/ui/cheat-commands.test.ts` (create).
- Commit: Add the cheat command table

### PH3 — Console UI
- 3.1 `src/ui/console.ts` (create) — `class DebugConsole` with `constructor(host: HTMLElement, game: ConsoleGame)`. `ConsoleGame` is `{ state: World; busy: boolean; apply(w: World): void }`. Backquote toggles it and focuses the input. Enter runs `runCommand`, applies a non-null world and prints the lines. It catches only `CheatError` and prints it red. While `busy`, it prints a wait message. Up and down walk the history. Respects IV2, IV3.
- 3.2 `src/ui/style.css` (modify) — `.debug-console` bottom strip in the panel look.
- 3.3 `src/three/game.ts:352-354` (modify) — `get busy(): boolean` returns whether a turn plays.
- 3.4 `src/three/main.ts:26-34` (modify) — mount `DebugConsole` in every build.
- Verify with a Playwright script in `tmp/` that opens the console and runs each command group, then `npm run playtest`. Checks AS1, AS2, UK2.
- Commit: Add the in-game debug console

### Test strategy
- `cheats.test.ts`: each setter clamps and rejects negatives. `repairAll` restores hit points. `give` stows a part and throws when full. `teleport` lands on a free spot and never on an obstacle or vehicle. `spawnNear` adds one NPC of the template at a free spot. `makeHostile` makes `hostileToPlayer` true. `killVehicles` leaves a wreck obstacle and gives no bounty. `skipToHour` lands on the right hour. `startWeather` adds one event of the kind. `revealMap` marks every tile.
- God mode: a world with `god` on and the cab at 1 hit point takes enough damage to break it, and `endTurn` leaves the player active. The same world with `god` off gets knocked out.
- A failed cheat leaves the input world unchanged.
- `save.test.ts`: a version 8 save loads with `god` false.
- `cheat-commands.test.ts`: parsing of numbers and ids, usage errors, unknown command, `help` lists every command.

### Order & dependencies
- PH1, then PH2, then PH3. Each builds on the one before.

### Risks / rollback
- RK1 — Teleport while physics holds the old body could leave a stale body. `apply()` calls `syncDrive`, and the PH3 script checks the truck drives after `tp`.
- RK2 — `killVehicles` on a vehicle hitched as the player's tower could leave a broken tow. `checkTower` runs next turn and drops it with reason `gone`.

### Interfaces
- IF1 — `src/sim/cheats.ts` exports and `CheatError`, as listed in 1.7.
- IF2 — `runCommand(world, line): CommandResult`.

### Interface graph
- PH1 -> IF1 @ src/sim/, src/data/cheats.ts, src/three/save.ts, src/three/save.test.ts
- PH2 IF1 -> IF2 @ src/ui/cheat-commands.ts, src/ui/cheat-commands.test.ts
- PH3 IF2 -> @ src/ui/console.ts, src/ui/style.css, src/three/game.ts, src/three/main.ts

## Conclusion

### Deviations from plan
- PH2 and PH3 share one file, `src/ui/console.ts`, and one commit — two new `src/ui` files broke the quality gate's fragmentation limit, and one file passes.
- `CHEATS` lives in `src/data/rules.ts`, not a new `src/data/cheats.ts` — a new data file broke the same limit.
- `Game.state` and `Game.busy` are one-line getters — `game.ts` is over its line limit, and the new getter had to fit without growing it.
- `spawnAt(world, tpl, loadout, pos)` takes the sampled loadout — the caller needs the chassis radius to find a free spot before spawning.
- `isFree` takes an `ignoreId` — teleport must leave the player truck out of its own overlap check.
- `makeWeather(world, kind)` takes no position, and `startWeather` moves the storm after — this keeps natural storms drawing random numbers in the old order.
- `killVehicles` clears `lastHitBy`, so no bounty or XP is paid for cheat kills.
- `repairAll` and god mode also restore spare parts. `skipToHour` also refreshes vision, because sight shrinks at night.
