# Remake item prices

## Context
- Every part and chassis has one hand-set `value`. Prices follow no rule, so the order inside a kind breaks. The Courier costs more than the Scout with fewer deck cells. The Heavy tractor costs more than the Longbed and is worse at everything.
- The effort model divides value by a tier wage. The wages 1.5, 4 and 9 are first guesses. Against them every tier 1 part and chassis is above its band and every tier 3 item is below it. So a tier 3 item costs fewer turns of work than a tier 1 item.
- The band test in `src/data/content.test.ts` is skipped until this tuning happens. It is PH8 of `docs/tasks/economy-overhaul.md`.
- Core parts share one value per role, so a heavy transmission costs the same as a light one.
- `npm run econ` crashes. `sellSpareParts()` in `src/econ/harness.ts` sells stored parts at a stall, and `takeSellablePart()` in `src/sim/economy.ts` allows that only at a garage.

## Desired design
- Each part and chassis def holds a hand-set `base`. Its `value` is `base` plus a stat modifier from a per-kind formula. `value` is computed once at data load, so every reader of `.value` stays unchanged.
- The formulas and their coefficients live in a new `src/data/prices.ts`. Modifiers per kind:
  - chassis: money per deck cell, per armor mount cell and per tile of top speed.
  - weapon: money per damage per turn, from round damage, rounds and reload.
  - armor: money per point of armor times HP per cell.
  - engine: money per point of speed bonus.
  - cargo: money per added inventory cell.
  - store: money per unit of added cap.
  - core: money per HP, so heavy grades cost more.
  - scanner: money per tile of range.
- Scale, set by the user after the first harness run:
  - The tier 1 wage is the salvage bot's measured 0.37 per turn. The other bots lose money, so they do not set wages. Tier 2 and 3 wages keep the old ratio to tier 1.
  - Chassis tiers start at 2000, 3000 and 4500.
  - Tier 1 parts cost 100 to 250. Tier 2 parts cost about 200 to 450, and tier 3 parts about 350 to 800.
  - Bands in turns are rewritten to hold these ranges at the new wages.
- A chassis trade-in pays the normal sell price: value less the sell spread, scaled by core health and wear. It no longer pays half.
- Other readers of chassis value keep their money effect. Upkeep `dailyShare`, bounty `valueShare` and wreck `coreValueShare` shrink by the value growth.
- Goods keep their values. Their bands change to match them.
- NPC equipment budgets grow by the chassis price growth, so NPC gear stays about as strong as now.
- Out of scope: new items, stat changes, shop stock tables and contract factors.

## Invariants and principles
- Inside one kind and tier, the item with better stats on the priced stat costs more. A test checks this per kind.
- Every non-core part, chassis and good sits inside its tier band. The unskipped band test checks this.
- All numbers live in `src/data/`. The formula reads only def stats.
- Harness and game read the same `value`, so the econ report matches the game.

## Implementation plan
### Phase 1 — Harness runs and measures wages
- `src/econ/harness.ts` `sellSpareParts()`: sell stored parts only at a garage.
- Run `npm run econ -- --seeds 1,2,3 --days 30 --policy all` with a log in `tmp/`. Read the wage per tier from `tmp/econ/report.md`.
- Done. Salvage earns 0.37 per turn at tier 1. Idle, haul and contract bots lose money, and greedy earns 0.27.

### Phase 2 — Price formula
- `src/data/prices.ts`: coefficients per kind and `priced(def)`, which returns `base + modifier`.
- `src/data/parts.ts`, `src/data/chassis.ts`: rename the hand-set field to `base`. Export defs with `value` filled by `priced()`.
- Test in `src/data/prices.test.ts`: the order rule per kind, and core grades cost more.

### Phase 3 — Set bases, bands and dependents
- `chassisTradeIn()` in `src/sim/economy.ts`: use the sell spread. Remove `ECONOMY.chassisSellFactor`.
- `UPKEEP.dailyShare`, `CONTRACTS.bounty.valueShare`, `SALVAGE.coreValueShare`: scale down by the value growth.
- Set every `base` so each item lands in its band at the measured wages.
- `EFFORT.wage` and `EFFORT.bands`: new wages, and bands that hold the new price ranges and current goods values.
- `src/data/npcs.ts` budgets: scale each one by the ratio of new to old worth of its typical loadout.
- Unskip the band test in `src/data/content.test.ts`.
- Re-run the econ harness and compare the days to each upgrade with the Phase 1 run.

## Verification
- `npm test`, `npm run typecheck` and `npm run quality` pass.
- Econ report: every item row is in band, and no policy runs out of money.
- Manual try, positive: open the Bowl garage in the dev game. The truck list goes up in price from Buggy to the tier 3 trucks, and the Courier costs less than the Scout.
- Manual try, negative: a new game with the start kit can still buy fuel, supplies and a tier 1 part, and the first raider fight still happens with NPC gear of about the same strength.
