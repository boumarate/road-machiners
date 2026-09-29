# Economy Overhaul

**Status:** executing
**Branch:** economy-overhaul
**Worktree:** .worktrees/economy-overhaul
**Goal:** Parts carry wear history and rebuilt parts come back worse, shops hold random finite stock that is worth re-checking, goods prices react to trade, every price derives from one base value, contracts give the player targets, a broken turret has several real uses, and an economy harness reports how many turns of effort each item and upgrade costs. Confirming the feel needs a user playtest.
**Mode:** interactive

## Context

- Two parts of the same type differ only in current HP (`PartInstance` in `src/sim/types.ts`).
- A broken part sells for 0, because `partSellPrice()` in `src/sim/economy.ts` scales price by HP share.
- Town repair costs a flat `ECONOMY.partRepairPerHp` for every part. A 600-price rocket rack with 16 HP costs 48 to fix, less than a tenth of its price.
- Only Bowl and Nose trade, with hand-set prices per good in `TOWN_PRICES`. Markets have unlimited stock and never react to trade.
- The only progression is XP levels and skill points. There are no contracts or other targets.
- The region has two towns and 13 other destinations, so a shop network must use more than towns.
- Space Rangers 2 derives prices from place traits and lets trade move them. Items wear and resale falls with condition. Ex Machina drives trade by town-to-town price gaps and makes loot the main income. Neither game solved broken salvage.

## Design

Money comes from hauling goods, salvage, contracts and bounties. Money goes to fuel, supplies, repair, parts and trucks. Every rule below serves that loop.

Value. Each good and part def keeps one hand-set base value. Every price in the game is a formula from that value. Shop profiles and item state are the only other inputs.

Wear. A part has a wear level that starts at 0, which means pristine. Each time the part drops to 0 HP, its wear level rises by one step. That is the only way wear rises. Repairing a damaged but working part adds no wear. Each wear step lowers the part's max HP and makes it worse at its job. A gun scatters more, an engine gives less power, armor stops less and a cargo part holds less mass. A part at the last wear step is junk. It cannot be rebuilt. Built-in core parts follow the same rule, so an old truck slowly declines. The name shows the state, like "MG turret, rebuilt x2". Pristine parts are rare, so the player hunts for them.

Part prices. A part's value is its base value times a wear factor. Buy, sell and repair prices come from that value. Sell price scales with current HP, but never falls below a scrap floor from the part's mass. Repair cost is a share of the part's value per HP restored. So an expensive part costs more to fix than a cheap one.

Broken parts. A broken part has four uses.

- Rebuild it in a town garage. It returns to full HP at its new wear step.
- Field repair or a roadside patch also rebuilds it, with the same wear step.
- Strip it in the field for units of the parts good, which field repair spends. Its value sets the yield.
- Sell it for its scrap value, or deliver it for a contract.

Shops. Parts sell in three kinds of shops. Bowl and Nose garages hold a large stock. Outpost stalls at some landmarks hold a few, mostly worn, parts. NPC traders and scavengers sell the spare parts they carry over the radio. Every shop's part stock is finite and random, drawn with world RNG. Each item rolls its own wear and HP, so pristine parts are uncommon. Garages and stalls restock on a timer. Buying takes an item out of stock, and selling puts it in. Mounting parts still needs a town garage.

Goods. Each shop that trades goods has a profile. It makes some goods and needs others. The profile sets a base price from the good's value. Each unit bought raises the local price, and each unit sold lowers it. Prices drift back to base over a few days. NPC traders buy and sell through the same functions, so they move prices too. The buy and sell spread and the Trade skill keep their roles.

Contracts. Shops post contracts on a board. A haul contract pays to deliver goods to another place by a deadline. A fetch contract pays for a part of a given type, in any condition. A bounty contract pays for destroying a named raider. Contracts pay money and XP. There is no standing.

NPC economy. NPC loadouts roll wear like shop stock. Equipment budgets count part value. Scavengers and raiders sell salvage into the same shops. So a shop near raider camps fills with worn guns.

Saves. The item and market shapes change, so the save version rises. Old saves stop with the crash screen, per the existing save rule. No migration.

Cargo parts add whole rows, so wear costs a cargo part max HP only.

Contract terms. A haul contract loads its goods at acceptance. If the deadline passes, the player owes the goods' value, and debt is allowed as today. A fetch contract takes a part of the named type from the grid or garage storage. A bounty contract names a living raider and lapses if it leaves the world. The player holds a limited number of contracts at once.

Effort model. The unit of effort is one turn of play. The wage is the net money a player earns per turn after fuel, supplies and repairs. Every part, chassis and good has a tier from 1 to 3. Each tier has a reference wage in `src/data/effort.ts`. An item's effort is its value divided by its tier's wage. Data sets a target effort band per tier and kind, and a test keeps every item inside its band. Contract rewards are estimated turns of work times the wage, so contracts pay like other work.

Economy harness. A Node harness plays the real sim economy with simple bot policies. Travel is abstract: the bot jumps to its destination and the clock advances by route length over cruise speed. Shop drift, restock, contracts, wear, XP, levels and skills run through the real sim functions. Encounters use sampled raider loadouts and real wreck salvage. The report gives each policy's measured wage per tier, the day each upgrade on a wishlist is reached, and the effort of every item. Tuning sets the reference wages from these measurements. A human playtest calibrates the bot.

TDD: yes (the wear, price, stock and contract rules are deterministic sim code in `src/sim/`).

### Invariants

- IV1 — Every buy, sell, repair and contract price derives from a def's base value through functions in `src/sim/economy.ts`. No shop holds a hand-set price.
- IV2 — Wear rises by exactly one step each time a part goes from above 0 HP to 0 HP, and never otherwise.
- IV3 — A part at the last wear step cannot be rebuilt by town repair, field repair or a patch.
- IV4 — At one shop, the sell price of an item is below its buy price and never below its scrap floor.
- IV5 — Shop part stock is finite. Buying removes the item, and selling adds it.
- IV6 — Shop stock, NPC loadout wear and contracts draw only from world RNG, so one seed gives one world.
- IV7 — Player and NPC trades go through the same market functions and move prices the same way.

### Principles

- PC1 — All wear steps, price factors, drift rates, restock timers and contract rewards live in `src/data/`.
- PC2 — The UI shows why a price is what it is: base value, wear, condition and local pressure.
- PC3 — The harness never adds behavior to the game that exists only for bots.

### Assumptions

- AS1 — Two garages, a few stalls and trader trucks give enough places to make thrift hunting fun.
- AS2 — Wear from breaking makes pristine parts desirable without making combat feel too punishing.
- AS3 — NPC traders still find profitable routes once prices react to trade.
- AS4 — Abstract travel and encounter rates in the harness are close enough to real play to set prices. A user playtest checks this.

### Unknowns

- UK1 — Which landmarks get outpost stalls, and how they look.
- UK2 — Wear step count, max HP loss and stat loss per step.
- UK3 — Restock period and stock size per shop kind.
- UK4 — Price pressure per unit and drift speed.
- UK5 — How contracts are generated, and how rewards scale with distance, value and danger.
- UK6 — How NPC traders pick which spares to offer, and how the radio trade UI works.
- UK7 — How the new value formula maps onto the current hand-set part and good prices.

## Plan

Approach: build bottom-up so each phase keeps the game playable and tests green. Part condition comes first because every price reads it. Shops replace town prices next, then contracts, NPC trade and UI. The harness comes after the sim rules it plays, and a final phase tunes numbers from its report. Phases run in order, one implementer each, because most touch `src/sim/economy.ts` or `src/sim/types.ts`.

Source tree after the change:

- `src/sim/condition.ts` owns part condition: max HP, worn stats, damage, restore and wear steps.
- `src/sim/economy.ts` keeps paid transactions: part and chassis prices, repair, rebuild, supplies.
- `src/sim/market.ts` owns shop state: goods pressure, drift, part stock and restock.
- `src/sim/strip.ts` owns stripping a spare part into the parts good.
- `src/sim/contracts.ts` owns contract generation, acceptance, completion and expiry.
- `src/data/effort.ts` owns tier wages, effort bands and harness assumptions.
- `src/data/shops.ts` owns shop profiles, stock tables and restock timers. It replaces `TOWN_PRICES`.
- `src/data/contracts.ts` owns contract kinds, limits, durations and reward factors.
- `src/econ/` owns the Node economy harness. The game never imports it. It imports `src/sim/` and `src/data/` only.

### PH1 — Part condition and wear steps
- 1.1 `src/sim/types.ts:21-26` modify: `PartInstance` gains `wear: number`, 0 for pristine.
- 1.2 `src/data/wear.ts` modify: add `CONDITION` with `maxWear`, `hpLoss` per step and `statLoss` per stat (weapon spread, engine speed and accel bonus, armor, scanner range).
- 1.3 `src/sim/condition.ts` create:
  - `maxHp(part: PartInstance): number`
  - `wornDef<T extends PartDef>(part: PartInstance): T` returns the def with worn stats.
  - `isJunk(part: PartInstance): boolean` is true past `maxWear`.
  - `damagePart(part: PartInstance, amount: number, floor: number): void` lowers HP and adds one wear step on the drop to 0 (IV2).
  - `restorePart(part: PartInstance, hp: number): void` sets HP up to `maxHp`. It throws for a junk part rising from 0 (IV3).
- 1.4 Replace every HP write in `wear.ts:29-36`, `damage.ts:17`, `engine-heat.ts:32`, `crash-contact.ts:101`, `cheats.ts:86-99,271`, `economy.ts:255,266`, `defeat.ts:53`, `repair.ts:54` and `patch.ts:159` with `damagePart` or `restorePart`.
- 1.5 Replace max HP reads of `partDef(..).hp` with `maxHp(part)` in the files found by `grep -rlE "partDef\([^)]*\)\.hp|def\.hp" src`. Replace stat reads with `wornDef` in `stats.ts`, `combat.ts`, `armor.ts:85` and the scanner check in `detect.ts`.
- 1.6 `src/sim/factory.ts:28-31` modify: `makePart(world, defId, wear)` takes an explicit wear. All callers pass it.
- 1.7 `src/three/save.ts:24` modify: `SAVE_VERSION` becomes 16 with a note.
- Tests: `src/sim/condition.test.ts` covers wear on break only, stat loss per step, junk refusing restore and a source scan that no file in `src/sim/` except `condition.ts` writes `.hp`.
- Commit: Add part wear steps on breaking
- Respects: IV2, IV3

### PH2 — Values, part prices and stripping
- 2.1 `src/data/parts.ts`, `src/data/chassis.ts`, `src/data/goods.ts` modify: rename `price` to `value`, add `tier: 1 | 2 | 3`. Goods get `value` and `tier`. Current numbers carry over until PH8.
- 2.2 `src/data/effort.ts` create: `EFFORT.wage` per tier and `EFFORT.bands` per tier and kind in turns.
- 2.3 `src/sim/economy.ts` modify:
  - `partValue(part): number` is value times the wear factor. Junk is worth scrap only.
  - `partSellPrice(world, vehicle, part): number` scales by condition with a scrap floor from mass (IV4).
  - `partRepairCost(world, part): number` is a share of `partValue` per missing HP share, times Mechanics. A broken part pays the same formula for a rebuild.
  - `chassisTradeIn(world)` uses core condition and core wear.
- 2.4 `src/sim/strip.ts` create: `stripYield(part): number`, `startStrip(world, partId): World` as a parked job. `src/sim/types.ts` `Job` gains `{ kind: 'strip'; partId; turnsLeft; total }`. `src/sim/jobs.ts` runs it.
- 2.5 `src/data/salvage.ts` modify: `STRIP` yield share and turns.
- Tests: `src/data/effort.test.ts` keeps every def inside its band. `economy.test.ts` covers sell floor, repair scaling with value and a broken rebuild. `strip.test.ts` covers yield and cancel on moving.
- Commit: Price parts from value, wear and condition
- Respects: IV1, IV4

### PH3 — Shops and reactive markets
- 3.1 `src/data/shops.ts` create: `SHOPS` for `bowl`, `nose` as garages and `salvage-yard`, `granary`, `pump-station` as stalls. Each has `makes`, `needs`, traded goods, a part stock table with wear weights, `stockSize`, `restockTurns`, `pressurePerUnit`, `driftPerTurn` and `contractSlots`. Remove `TOWN_PRICES`.
- 3.2 `src/sim/types.ts` modify: `World.shops: Record<string, ShopState>`, with `ShopState = { pressure: Record<string, number>; stock: PartInstance[]; restockAt: number; contracts: Contract[] }`.
- 3.3 `src/sim/market.ts` create:
  - `initializeShops(world): void` called from `newWorld`.
  - `advanceShops(world): void` called from `endTurn` for drift and restock with world RNG (IV6).
  - `goodPrice(world, vehicle, shopId, good, direction): number` from value, profile and pressure.
  - `recordTrade(world, shopId, good, units, direction): void` moves pressure (IV7).
  - `takeStockPart(world, shopId, partId)` and `addStockPart(world, shopId, part)` (IV5).
- 3.4 `src/sim/economy.ts` modify: `getTradePrice` and `tradeGoods` take a shop id and use `market.ts`. `buyPart(world, partId)` buys from stock. `sellPart` and `sellVehicleCargo` add parts to stock. `requireVehicleShop` replaces `requireVehicleTown` for trade. Mounting and chassis stay town only.
- 3.5 `src/sim/sites.ts` modify: `shopAt(world)` returns the shop the parked player can use.
- 3.6 `src/sim/npc-decisions.ts:212`, `src/sim/npc-activities.ts:188,766` modify: NPC trade reads shop prices and records pressure through the same functions.
- Tests: `market.test.ts` covers pressure both ways, drift back, finite stock, deterministic restock and NPC trades moving prices. `npc-economy.test.ts` keeps traders profitable (AS3).
- Commit: Add shops with random stock and reactive prices
- Respects: IV1, IV5, IV6, IV7

### PH4 — Contracts
- 4.1 `src/data/contracts.ts` create: kinds, `maxActive`, durations, reward effort factors and the haul penalty share.
- 4.2 `src/sim/types.ts` modify: `Contract` union for `haul`, `fetch`, `bounty`. `Player.contracts: Contract[]`.
- 4.3 `src/sim/contracts.ts` create: `generateContracts(world, shopId)` on restock, `contractReward(world, contract)` from estimated turns times the tier wage, `acceptContract(world, id): World`, `deliverContract(world, id): World`, `advanceContracts(world)` in `endTurn` for expiry and bounty kills from `destroyed` events.
- Tests: `contracts.test.ts` covers each kind end to end, expiry debt, lapsed bounty and the active limit.
- Commit: Add haul, fetch and bounty contracts

### PH5 — NPC wear and radio trade
- 5.1 `src/sim/npc-loadout.ts:61-69,111-133` modify: roll wear per part from `src/data/npcs.ts` tables. Budgets count `partValue`.
- 5.2 `src/data/npcs.ts` modify: wear weights and trader spare part tables.
- 5.3 `src/data/dialogue.ts`, `src/sim/dialogue-rules.ts` modify: a `trade` topic lists the NPC's spare parts. A buy moves the part into the player grid and pays the NPC at `partBuyPrice` with the NPC spread.
- Tests: `npc-loadout.test.ts` for wear and budget, `dialogue.test.ts` for a radio buy and the no-room refusal.
- Commit: Roll NPC part wear and sell spares over the radio

### PH6 — UI
- 6.1 `src/ui/town.ts` modify into a shop screen for towns and stalls. Tabs: Market, Parts, Garage and Trucks for towns only, and Contracts. Prices show their parts: value, wear, condition and pressure (PC2).
- 6.2 `src/ui/inventory.ts` modify: part cards show wear as "rebuilt x2" and junk. A spare part gets a Strip button with turns and yield.
- 6.3 `src/ui/dialogue.ts` modify: the trade topic lists parts with buy buttons.
- 6.4 `src/ui/hud.ts` modify: active contracts with deadlines.
- 6.5 `src/three/game.ts:275` modify: open the shop screen at any shop.
- Verify: `npm run playtest` and a Playwright screenshot of each tab in `tmp/`.
- Commit: Show shops, wear and contracts in the UI

### PH7 — Economy harness
- 7.1 `src/data/effort.ts` modify: harness assumptions: cruise speed share, route factor, encounter rate per tile, fight damage and win odds.
- 7.2 `src/econ/harness.ts` create: `runPolicy(seed, policy, days): RunReport`. It builds a real world with `newWorld`, jumps travel, burns fuel and supplies by the sim formulas, advances shops and contracts turn by turn and resolves encounters with sampled raider loadouts and `createWreckSalvage`.
- 7.3 `src/econ/policies.ts` create: `haulOnly`, `salvageOnly`, `contractsOnly` and `greedy`. Greedy follows a wishlist of upgrades and spends skill points. Policies read only what the player can see (PC3).
- 7.4 `src/econ/report.ts` create: wage per tier per policy, the day each wishlist item is reached and the effort of every item. It writes JSON and a markdown table to `tmp/econ/`.
- 7.5 `src/econ/cli.ts` create and `package.json` script `econ`: `vite-node src/econ/cli.ts -- --seed <n> --days <n> --policy <name|all>`.
- Tests: `src/econ/harness.test.ts` for determinism per seed and that money never goes negative without a recorded debt event.
- Commit: Add economy harness

### PH8 — Tuning and docs
- 8.1 Run `npm run econ` with a short run first, then set `EFFORT.wage`, item values, stock tables and contract factors from the report. Record the measured wages in `src/data/effort.ts` comments.
- 8.2 `DESIGN.md` modify: replace fixed markets with shops, wear, contracts and the effort model. `CLAUDE.md` modify: owners of `condition.ts`, `market.ts`, `contracts.ts`, `strip.ts`, `src/econ/` and `npm run econ`. Remove "Town markets remain unlimited".
- Commit: Tune the economy from the harness

### Test strategy
- TDD per phase: write the phase's failing sim tests first, then implement.
- Full `npm test`, `npm run typecheck` and `npm run quality` pass before each commit.
- PH6 and PH8 end with `npm run playtest`.

### Risks / rollback
- RK1 — The harness abstracts travel and fights, so its wage can differ from real play. A user playtest calibrates it (AS4).
- RK2 — Reactive prices can make NPC traders stall or lose money. PH3 keeps an NPC profit test (AS3).
- RK3 — The HP refactor touches combat, crashes and repair. The source scan test and the full suite guard it.
- RK4 — Old saves stop loading at version 16. The design accepts this.
- Rollback: each phase is one commit on `economy-overhaul`.

### Unknowns mapping
- UK1 is set in PH3: Salvage Yard, Granary and Pump Station stalls, with no new art.
- UK2, UK3, UK4 and UK7 get first numbers in PH1 to PH3 and final numbers in PH8.
- UK5 is set in PH4 with the effort model.
- UK6 is set in PH5.

## Verify

## Conclusion
