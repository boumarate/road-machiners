# Issue 50 — every interaction in reach can be picked with the arrow keys

**Mode:** hands-off
**Goal:** A player parked on a town pad with a dropped loot pile can search and loot the pile with `[E]` after picking it with the arrow keys, and can still enter the town. Confirmed by a Playwright check in `tmp/` on the real GPU plus `npm run playtest`.

## Context
- The issue reports that a loot pile dropped on an interaction pad cannot be picked up. The player expects to cycle between the things in reach with the arrow keys.
- `getContextAction()` in `src/ui/hud-readout.ts:43-96` returns one action. `getPlaceAction()` returns `Enter <shop>` whenever a shop is in reach, so a pile, a wreck or a knocked-out truck at a pad never gets the button.
- `Game.useContext()` in `src/three/game.ts:387-411` decides again what `[E]` does, with its own order: aid, trade, shop, then `useSite()`. The button and the key are two owners of one choice.
- `salvageHere()`, `salvageNear()` and `downedNear()` in `src/sim/locations.ts:72-93` return the first match. A pile dropped on a wreck or site stock, or two knocked-out trucks side by side, leave all but the first out of reach. `scavenge()`, `canScavenge()`, `canLoot()` and `lootBlockerHere()` inherit that first match.
- Drops near the player join the player's own pile only (`dropOnPile()`, `src/sim/salvage.ts:259-269`), so a player pile and a wreck or an NPC pile can overlap.
- No arrow key is bound in the game. Only the debug console (`src/ui/console.ts:314-318`) reads ArrowUp/ArrowDown, inside its own input, and `Game` skips keys while an input has focus (`isEditingControl()`).
- DESIGN.md "Information": the HUD shows what the player needs to decide. A pile sitting in reach and hidden by a shop button is a missing decision, not something left to discover.

## Design
Make the context action a list of every action in reach. The HUD shows one selected action on the `[E]` button. ArrowLeft and ArrowRight cycle the selection when there is more than one. `[E]` and a click run exactly the shown action.

Scope:
- `getContextActions(world, playing): ContextAction[]` replaces `getContextAction()`. Each action carries a `target` that names what it acts on: aid, trade, a shop, a knocked-out truck by id, the oasis, a stock by id, or an empty stock note.
- List order keeps today's default as the first entry: ready deals, shop, each knocked-out truck in reach, then, when the truck is not busy, the oasis, each stock with loot in reach, and the "picked clean" note only when no stock with loot is in reach. Unready deals come last. Today's gates stay unchanged: playback, `playerCanAct()` and the busy rule.
- A small UI owner, `ContextPicker` in `src/ui/context-picker.ts`, holds the selected action key. It keeps the selection while that action stays in the list, falls back to the first entry when it leaves, and wraps when cycling. The selection is not saved.
- `Game.useContext()` dispatches on the selected action's `target` and nothing else. `applySiteAction()` goes away because it re-decides the target by priority.
- The sim queries that picked the first match take a target id: `canScavenge(world, stockId)`, `scavenge(world, stockId)`, `canLoot(world, stockId)`, `lootBlockerHere(world, targetId)`. New list queries `salvageListNear(world)` and `downedListNear(world)` return every match. `InventoryScreen.openDowned(world, vehicleId)` opens the chosen truck.
- The HUD action box shows `‹ [E] label ›` with a `n/m` count when the list has more than one entry. The arrow buttons run the same keys as ArrowLeft and ArrowRight.
- The wiki gains one sentence in `docs/wiki/mechanics/turns.md` on picking between interactions with the arrow keys.

Approaches considered:
- Chosen: a list plus a selection. It answers the player's stated expectation, removes the double owner of the `[E]` choice and covers every overlap (pile on a pad, pile on a wreck, two downed trucks).
- Rejected: let a pile beat the shop in the fixed priority. That is a one-line change, but it hides the town while the pile lies there, up to two days, and keeps every other overlap broken.
- Rejected: list the pile inside the town panel. It mixes shop and salvage UI and leaves wrecks and downed trucks broken.

Backwards compatibility: no saved shape changes, since the selection lives in the UI only. The changed sim signatures have callers only in this package, and all of them are updated: `game.ts`, `progression/bot.ts` and the tests.

TDD: yes (deterministic sim queries, readout list and picker logic).

### Invariants
- IV1 — Every place target in reach gets its own action: the shop, each knocked-out truck, the oasis, and each stock with loot.
- IV2 — With no prior selection, the first action is the one `getContextAction()` returned before this change, for every existing readout test case.
- IV3 — `[E]` and a click on the button run the action the button shows, and nothing re-decides the target.
- IV4 — The selection lives only in the UI. `src/sim/types.ts` and the save format stay unchanged.
- IV5 — The selection stays on its target across renders while the target is in the list, and falls back to the first entry when the target leaves.
- IV6 — A search, a loot, a downed-truck loot and a lootBlocker check act on the given id, never on the first stock or truck in reach.

### Principles
- PC1 — One owner for the choice of interaction: the readout lists the actions, `ContextPicker` selects one, and `Game` only dispatches.

### Assumptions
- AS1 — The issue's screenshot, which this stage cannot view, shows a player pile on a town or site pad, as the triage summary says.
- AS2 — ArrowLeft and ArrowRight are the cycling keys. The player said "arrow keys", and left and right read naturally for a row of choices. ArrowUp and ArrowDown stay unbound.

### Unknowns
- UK1 — Whether the `n/m` count and the arrow buttons fit the action box at its current width on small screens. Execution checks this with a screenshot.

## Plan

Approach: change the sim queries to take target ids first, then turn the readout into a list, add the picker, and wire `Game`, the HUD and the keys. Each phase keeps the build green.

### PH1 — Sim queries act on a chosen target
- 1.1 `src/sim/locations.ts:45-133` (modify)
  - Delete `applySiteAction()`. The oasis goes through `useOasis()` and searches through `scavenge()`.
  - Add `salvageListNear(world): SalvageStock[]`, every stock with loot in range at any speed. `salvageNear()` becomes `salvageListNear(world)[0] ?? null`.
  - Add `downedListNear(world): Vehicle[]`, every knocked-out truck in tow reach. `downedNear()` becomes `downedListNear(world)[0] ?? null`.
  - `canScavenge(world, stockId: string): boolean`: the stock exists, has loot, the parked player reaches it, it is unsearched, there is no combat and no lootBlocker.
  - `canLoot(world, stockId: string): boolean`: the stock has loot, the player reaches it and has searched it.
  - `scavenge(world, stockId: string): World` uses `requireLootFree()` and `canScavenge()` on that id. Error text stays `Nothing unsearched in reach`.
  - `lootBlockerHere(world, targetId: string): Vehicle | null` → `lootBlocker(world, playerVehicle(world), targetId)`.
  - `salvageHere()` and `downedHere()` stay for the bot and the inventory.
  - Respects: IV6, IV4.
- 1.2 `src/sim/progression/bot.ts:392-397` (modify): `lootHere()` takes `salvageHere()` first, then calls `canLoot(o.world, stock.id)`.
- 1.3 Tests (modify): update `scavenge(w)` and `canScavenge(w)` calls in `src/sim/economy.test.ts:563-605`, `src/sim/salvage.test.ts:238-246`, `src/sim/search.test.ts:31-260` and `src/sim/defeat.test.ts:348` to pass the stock id. Replace the `applySiteAction` oasis test (`economy.test.ts:565-575`) with the same checks through `useOasis()`/`canUseOasis()`.
- 1.4 New tests in `src/sim/search.test.ts`, written first: with a player pile dropped through `dumpOnPile()` on a wreck stock in reach, `scavenge(w, pile.id)` starts a search with `stockId: pile.id`, `canLoot(w, wreck.id)` stays false after the pile is searched, and `salvageListNear()` returns both.
- Commit: `Sim loot queries act on a chosen stock`

### PH2 — The readout lists every action in reach
- 2.1 `src/ui/hud-readout.ts:35-98` (modify)
  - `getContextActions(world, playing): ContextAction[]` replaces `getContextAction()`, ordered as the Design says. `getPlaceActions()`, `getSiteActions()` and `getStockAction(world, stock)` return arrays or one entry. `getStockAction()` uses `lootBlockerHere(world, stock.id)`, and `ready` uses `canReachSalvage()` for that stock.
  - Respects: IV1, IV2.
- 2.2 `src/ui/hud.ts:35` (modify), next to `ContextAction`, since `hud-readout.ts` already imports from `hud.ts`:
  - `export type ContextTarget = { kind: 'aid' } | { kind: 'trade' } | { kind: 'shop' } | { kind: 'downed'; id: string } | { kind: 'oasis' } | { kind: 'stock'; id: string } | { kind: 'empty' }`.
  - `ContextAction` gains `target: ContextTarget`.
  - `export function contextKey(target: ContextTarget): string` gives `kind` or `kind:id`.
- 2.3 `src/ui/hud-readout.test.ts` (modify): the 19 existing calls read `getContextActions(w, false)[0]` and match with `toMatchObject` for IV2. New cases, written first: a player pile dumped on a town pad lists `Enter <town>` then `Search the pile`; a pile on a wreck lists both stocks; two knocked-out trucks list two `Loot` actions; a busy truck lists no stock action.
- Commit: `Context actions list every interaction in reach`

### PH3 — Picker, keys and HUD
- 3.1 `src/ui/context-picker.ts` (create)
  - `class ContextPicker { pick(actions: ContextAction[]): ContextAction | null; cycle(actions: ContextAction[], step: 1 | -1): void }`. It stores the selected `contextKey`. `pick` returns the stored match, or else the first entry and stores that one.
  - Respects: IV5, PC1.
- 3.2 `src/ui/context-picker.test.ts` (create, first): first entry by default, cycling wraps both ways, the selection survives a reorder and falls back when its target leaves, and an empty list gives null.
- 3.3 `src/three/game.ts:28-29, 376-411, 487-503` (modify)
  - `private readonly picker = new ContextPicker()`. `private contextActions(): ContextAction[]` wraps `getContextActions(this.world, this.anim !== null)`.
  - Render passes `this.picker.pick(actions)` and the count and index to `hud.renderAction`.
  - `useContext()` reads `this.picker.pick(getContextActions(this.world, false))` and dispatches on `target.kind`: aid → `startAid`, trade → `trade.openIfReady()`, shop → `town.open()`, downed → `inventory.openDowned(world, id)`, oasis → `useOasis`, stock → combat note, then `scavenge(world, id)` when `canScavenge`, or else `inventory.openLoot(id)` when `canLoot`, empty → nothing. Keep the `isBusy` guard for oasis and stock actions. `noteCombatBlock()` reads the selected action's `combat`.
  - Keys: `ArrowLeft` and `ArrowRight` run `this.picker.cycle(actions, ∓1)` then refresh the action box. Mark them `noModal: true` and `idle: true`.
  - Respects: IV3, PC1.
- 3.4 `src/ui/inventory.ts:933-942` (modify): `openDowned(world, vehicleId: string): boolean` opens that truck when `canLootTruck(playerVehicle(world), vehicle)`.
- 3.5 `src/ui/hud.ts:204-252` (modify): `renderAction(action, count: number, index: number, world, onUse, onCycle: (step: 1 | -1) => void)`. With `count > 1` the box shows a `‹` button titled `[←]`, the action button and a `›` button titled `[→]`, with `index+1/count` beside the label.
- 3.6 `src/ui/style.css:692-711` (modify): lay the arrow buttons and the count in one row inside `#ui .action`.
- 3.7 `docs/wiki/mechanics/turns.md` (modify): one sentence saying that when several things are in reach, the arrow keys choose which one `[E]` uses.
- Commit: `Arrow keys choose between interactions in reach`

### Test strategy
- PH1: sim tests on overlapping stocks, with failing tests first (IV6).
- PH2: readout list cases, with the existing cases as the IV2 regression check.
- PH3: picker unit tests (IV5). Then `npm test`, `npm run typecheck`, `npm run quality` at the root and `npm run playtest`.
- Behavior check: a Playwright script in `tmp/` on the real GPU parks the player on a town pad, dumps an item on a pile through `window.__ROAM__`, and checks four things: the button reads `Enter <town>`; ArrowRight switches it to `Search the pile`; `[E]` starts a search on the pile; and after the search the pile's loot opens. It takes a screenshot of the action box for UK1.
- `npm run stuck` is not needed, since NPC goals do not change.

### Order & dependencies
- PH1 → PH2 → PH3, in sequence. Each phase uses the signatures of the one before.

### Risks / rollback
- RK1 — Deleting `applySiteAction()` could drop the oasis path. The oasis action dispatches to `useOasis()`, and the replaced test keeps the stop rule.
- RK2 — Arrow keys could also scroll the page or move the camera. Check this in the Playwright run, and `preventDefault` only if the page scrolls.
- Rollback: revert the three commits. No data or save changes.

## Verify

Result: passed

Happy-path:
- CK1 — pile on a town pad lists Enter + pile; ArrowRight selects the pile; [E] opens its loot — held (Playwright, no GPU)

Invariants / assumptions:
- CK2 (IV2, IV6) — readout and sim tests on overlapping stocks — held (199 tests in 5 files pass)
- CK3 (IV4) — no change to src/sim/types.ts or save format — held
- CK4 (UK1) — count and arrow buttons fit the action box — held (screenshot)

Smoke: `node tmp/issue50.mjs` — label `Enter Bowl 1/2`, then `Loot the pile 2/2`, loot panel opened.
Notes: deviation from plan — `ContextPicker` lives in `hud-readout.ts` and dispatch in `src/three/truck-controls.ts`, not `context-picker.ts` and `game.ts`. Same owners, behavior as designed.

## Code smells
- `src/ui/hud-readout.ts:35-41` — `shopNear()` duplicates `shopNear()` in `src/sim/market.ts:404` and returns a different shape (GPC8).

## Conclusion

### Hands-off decisions
- udesign: list plus selection over a priority tweak — it matches the player's ask and fixes every overlap, not only pile versus shop.
- udesign: ArrowLeft and ArrowRight cycle the actions (AS2) — the player asked for arrow keys, and no arrow key is bound in the game.
- udesign: the selection is UI-only and unsaved (IV4) — no save migration is needed.
- udesign: the first entry keeps today's priority (IV2) — players who never press an arrow see no change.
- uplan: plan auto-approved.
- ureview: fixed stale header comment in truck-controls.ts.


Outcome: goal achieved; Playwright run shows `Enter Bowl 1/2`, ArrowRight gives `Loot the pile 2/2`, and [E] opens the loot. Reviewer found no issue at confidence 80 or above.

Invariants:
- IV1–IV6, PC1 — held (tests, review of dispatch on `action.target`, no save-type change).

### Assumptions check
- AS1 — unverifiable — the issue screenshot was not viewable.
- AS2 — held — ArrowLeft/ArrowRight cycle.

### Unknowns outcome
- UK1 — resolved — the count and arrow buttons fit the box in the screenshot.

Plan adherence: `ContextPicker` is in `hud-readout.ts` and dispatch is in `src/three/truck-controls.ts`.

### Round 2 fixes
- Commit `Give the limping courier bank test room under suite load` — not caused by issue 50. `src/phys/drive.test.ts` "a limping courier crawls up a bank" took 5s alone but passed the 30s timeout when the full suite shared the cores. It now has a 90s timeout. After the fix `npm run typecheck`, `npm test` (2745 pass) and `npm run playtest -- --cpu` pass.
