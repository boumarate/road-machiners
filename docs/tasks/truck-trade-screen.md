# Trade with other trucks in a shop-style screen

## Context
- The radio trade topic lists NPC spare parts as numbered reply lines, one buy per line. See `tradeOptions()` in `src/sim/dialogue.ts` and `buySpare()` in `src/sim/dialogue-rules.ts`.
- The player cannot sell to a truck, and cannot buy its goods, fuel or supplies.
- Towns use `TownScreen` in `src/ui/town.ts`: the truck grid on the left and tabbed buy and sell tables on the right.

## Desired design
- Trade needs both trucks parked close together. Close means in tow reach, the same rule patches use.
- Far apart, "Want to trade?" on the radio gets "Pulling over." The call ends and a `trade` state starts between the NPC and the player.
- The NPC gets a trade goal. It drives to the player and parks beside it, like a patcher does.
- The state lapses after a number of turns without a meeting, so the NPC stops chasing a player who drives off. The number lives in `src/data/npcs.ts` next to the patch lapse.
- Both parked in reach: the use key opens the trade screen, like at a shop. The trade topic on the radio opens it too.
- Leaving the screen fulfills the trade state, and the NPC goes back to its goals.
- The trade screen is shaped like the town screen.
- Left side: the player truck grid through `InventoryView`, like the town screen.
- Header: the NPC name, player money, NPC money and free cells on both trucks.
- Goods tab: every good either truck holds, with buy price, sell price, NPC count, player count, and Buy 1, Buy 5, Sell 1, Sell all buttons.
- Parts tab: the NPC spares with Buy buttons, then the player spares with Sell buttons.
- Supplies tab: fuel and supplies the NPC will sell, with Buy 1, Buy 10 and Buy max buttons.
- Leave or Escape closes the screen.
- Money moves between the player and the NPC wallet. The NPC pays for what it buys, and it needs the money and the cargo room.
- Goods prices come from the base value in `GOODS` with the player trade spread. Trucks have no price pressure.
- Part prices use `partTradePrice()`, as today.
- Fuel and supplies cost `ECONOMY.supplyPrice` plus the player trade spread. A truck charges more than a town.
- The NPC sells fuel and supplies only above a reserve share of its cap. The share lives in `src/data/npcs.ts`, above the low fuel threshold, so a sale never sends the NPC to resupply at once.
- The player does not sell fuel or supplies to trucks.
- Out of scope: trait-based prices and haggling. Any driver that offers the trade topic trades on the same terms.

## Invariants and principles
- Money is conserved: the player pays exactly what the NPC receives, and the reverse. A test checks both wallets.
- Every trade command needs a live `trade` state with a live NPC, both trucks parked and in reach. Otherwise it throws.
- A moving truck never trades. A test drives one away and checks the throw.
- A failed trade throws and changes nothing. The screen shows the message, like `TownScreen.run()`.
- NPC fuel and supplies never drop below the reserve through a trade.
- Profit from a good sold to a truck trains the skill like a town sale. Export and reuse `practiceSale()` and the cost basis update.
- Truck trades draw no randomness and never touch shop state.
- Sim rules go in `src/sim/`, numbers in `src/data/`, the view in `src/ui/`.

## Implementation plan
### Phase 1: the meeting
- `src/sim/states.ts` and `src/sim/types.ts`: add a `trade` state kind. The NPC holds it toward the player. It lapses after its turn count and breaks when either truck is gone or they fall into a feud.
- `src/sim/npc-activities.ts`: add a `trade` goal kind. It drives to the player and parks beside it, reusing the patch path in `towedRadius()`. It holds while the trade state holds. Add it to `INTERRUPTIONS`.
- The trade topic: in reach, it opens trade. Out of reach, it starts the state and gives the NPC the goal. Add a condition and an effect in `src/sim/dialogue-rules.ts` for each branch.
- `tradeReady(world)` in `src/sim/economy.ts` returns the NPC when both trucks are parked in reach under a live trade state.
- Tests: the NPC drives over and parks, the state lapses, and a feud breaks it.

### Phase 2: sim trades
- `src/sim/economy.ts` owns trades between the player and the NPC under the trade state. It exports `truckGoodPrice`, `truckSupplyPrice`, `truckSupplyForSale`, `buyTruckGood`, `sellTruckGood`, `buyTruckPart`, `sellTruckPart`, `buyTruckSupply` and `endTrade`.
- Move `buySpare()` out of `src/sim/dialogue-rules.ts` into `buyTruckPart()`. Remove `SpareOutcome`, `SPARE_OUTCOME_LINE`, `tradeOptions`, `tradeLine` and `partId` on `OfferedOption` in `src/sim/dialogue.ts`.
- `src/data/dialogue.ts`: the trade topic asks "Want to trade?". Its nodes are "Pulling over." or "Come aboard.", and both end the call.
- `src/data/npcs.ts`: add the trade reserve share to `NPC_UPKEEP` with a comment on why it sits above the low threshold.
- Export `practiceSale()` from `src/sim/economy.ts`, and share the cost basis update with `tradeGoods()`.
- `src/sim/truck-trade.test.ts` covers each command, money conservation, no-money, no-room on both sides, the reserve, and no open trade call.
- Update `src/sim/dialogue.test.ts` where it relies on the old trade options.

### Phase 3: trade screen
- `TruckTradeScreen` in `src/ui/town.ts`, modeled on `TownScreen`. It reuses the `modal`, `town-screen`, `town-split` and `tabs` CSS classes.
- `src/three/game.ts`: `useContext()` opens the screen when `tradeReady()` returns an NPC. The screen also opens after the call that says "Come aboard." ends.
- Closing the screen applies `endTrade()`.

## Verification
- `npm test`, `npm run typecheck` and `npm run quality` pass.
- `npm run playtest -- --url <dev server>` passes.
- Manual try, positive: a Playwright script in `tmp/` calls a distant trader, asks to trade, ends turns until it parks beside the player, presses the use key, buys a part, a good and fuel, and sells a spare. It checks both wallets and cargo, and takes a screenshot.
- Manual try, negative: the NPC has less money than a spare is worth. Sell shows the error and nothing moves. Fuel at the reserve shows no fuel to buy.

## Result
- Done. All three phases work in the game.
- The sim rules live in `src/sim/economy.ts`. The screen lives in `src/ui/town.ts`. New files broke the quality gate's file-count rule.
- A ready trade wins the E key over a nearby shop. A trade still on its way shows after the shop and site actions.
- The NPC keeps its field repair parts and does not sell them.
- `npm test`: all pass. Four slow tests timed out under load and passed alone.
- `npm run quality` and `npm run playtest` pass.
- Manual try, positive: a trader 10 tiles away pulled alongside in 5 turns. E opened the trade screen. Buy max moved 30 fuel for 120 money.
- Manual try, negative: selling goods to a broke driver shows "cannot pay that much", and no money moves. After leaving, the trade state is gone, and E opens the town again.
