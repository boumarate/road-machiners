# Extra fuel tanks and supply lockers

Mode: hands-off

## Context
- Fuel capacity is fixed per chassis in `CHASSIS[id].fuelCap`. Supply capacity is one global number, `RULES.suppliesCap`.
- About 20 call sites read these two numbers directly. Examples are `economy.ts`, `salvage.ts`, `locations.ts`, `npc-activities.ts`, `cheats.ts`, `hud-readout.ts` and `town.ts`.
- The player cannot raise either capacity. Long trips off the roads have no gear answer.

## Desired design
- A new part kind `store` holds extra fuel or extra supplies while mounted. It follows the cargo pattern: it works only while mounted, like `extraRows`.
- Two parts, both 1x1 on deck cells `D`, so they compete with guns, scanners and cargo frames:
  - `jerrycans`, "Jerrycan rack": +12 fuel units, which is 60 L. Tier 1, value 120, mass 70 kg with fuel.
  - `supplyLocker`, "Supply locker": +10 supplies, half the base cap. Tier 1, value 120, mass 60 kg.
- Capacity counts mounted stores at any HP. A broken store keeps its capacity. Leaks stay a core tank rule only.
- `fuelCap(v)` and `suppliesCap(v)` in `src/sim/stats.ts` become the one source. Every call site switches to them. `RULES.suppliesCap` becomes `RULES.baseSupplies`, the base value.
- When a refit or a chassis swap lowers capacity, fuel and supplies drop to the new cap. The player log says how much was lost.
- Shops: the jerrycan rack joins the fuel-selling and parts profiles in `src/data/market.ts`. The supply locker joins the general profiles. Exact profile names are chosen from the file during work.
- The part card shows "+60 L fuel" or "+10 supplies". The town fill buttons and the HUD read the new caps.
- Models: new Blender scripts `tools/blender/store_jerrycans.py` and `tools/blender/store_locker.py`, built from `wreck.py` as template. The supply locker is a metal box with a lid. The jerrycan rack is a frame with three upright cans.
- Out of scope: NPC spawn tables. NPCs get the new caps through the shared helpers, but no NPC loadout adds a store yet.

## Invariants and principles
- `src/sim/` still never imports Three.js. Check: `npm run quality`.
- No call site reads `chassisDef(...).fuelCap` or the supply base except the two helpers. Check: grep after Phase 1.
- Fuel and supplies never exceed their cap after any command. Check: Vitest for mount, unmount and sell.
- A truck with no stores behaves exactly as now. Check: existing tests pass unchanged.
- Numbers live in `src/data/parts.ts`, never inline.

## Implementation plan
Work goes in a worktree at `.worktrees/extra-stores`. The main checkout has uncommitted edits in `parts.ts` and `partLooks.ts`. My edits there only add entries, so the merge stays simple.

### Phase 1 — capacity comes from one place
- `src/sim/stats.ts`: add `fuelCap(v)` and `suppliesCap(v)`. Both return the base plus the sum over `mountedParts(v, 'store')` of the matching kind.
- `src/data/rules.ts`: rename `suppliesCap` to `baseSupplies`.
- Switch every call site listed in Context to the helpers.
- `src/sim/resources.ts`: add `fitStores(world, v)`. It clamps fuel and supplies to the caps and logs any loss for the player.
- Call `fitStores` from `applyRefitLayout` in `inventory.ts` and from the chassis swap in `economy.ts`.

### Phase 2 — the two parts
- `src/data/parts.ts`: add `StoreDef` with `holds: "fuel" | "supplies"` and `amount`. Add kind `store` to `PartKind` and the two parts.
- `src/sim/grid.ts`: `MOUNT_CELLS.store = ['D']`.
- `src/sim/wear.ts`: stores lose max HP only, same as cargo.
- `src/data/market.ts`: add `store` to `ItemKind`, price bands per tier, and the shop profiles.
- `src/ui/cards.ts` and `src/ui/town.ts`: stat line for the card and a `store` stock filter.
- Vitest in `src/sim/stats.test.ts` or a new `stores.test.ts`: cap rises when mounted, not when stowed on a plain cell, and drops with a log line on unmount.

### Phase 3 — models
- Write both Blender scripts, render previews into `tmp/`, look at them.
- Add both names to `NAMES` in `src/three/render/models.ts` and map the parts in `src/render/partLooks.ts`.

## Verification
- `npm test`, `npm run quality`, `npm run playtest` all pass.
- Manual try, positive: give the player a jerrycan rack by cheat, mount it, fill at a town. The fuel bar shows 260 L on the scout. The fill button charges for 60 L more.
- Manual try, negative: with a full tank, unmount the rack. Fuel drops to 200 L and the log shows "60 L fuel lost". Stowing the rack on a plain cell gives no extra capacity.

## Result
- Done on branch `extra-stores`. Jerrycan racks and supply lockers mount on deck cells and raise the caps while mounted.
- `fitStores()` in `resources.ts` spills fuel and supplies above a lowered cap. It runs after every refit, after a chassis swap, and once per turn for stores lost to looters.
- Checks: `npm test` passes, 1596 tests. `npm run quality` passes. `npm run playtest` passes at 60 fps. New Vitest cases cover the caps, broken and stowed stores, the player spill and the NPC spill.
- Manual try, positive: in Bowl, both stores mounted and filled to 260 L and 30 supplies. The HUD showed "260 / 260 L".
- Manual try, negative: unmounting both while full dropped to 200 L and 20 supplies. The log said "No room for fuel: fuel -12.0" and "No room for supplies: supplies -10.0". A stowed store adds nothing.
- Found, not fixed: `tp bowl` crashes the page with "v293 has 0 mounted wheels, expected 4" on a Bowl hauler. It happens on 3907ac7 without this change. The main checkout has uncommitted `vehicle.ts` edits that may be the fix.

### Hands-off decisions
- uexecute: kept value 120 at tier 1. The effort band test is skipped, and current parts all miss their bands.
- uexecute: `store` effort bands copy the cargo bands.
- uexecute: garages stock both stores through the all-parts table. The Pump Station adds jerrycan racks and the Granary adds supply lockers.
- uexecute: the start kit, NPC spawn fuel and the chassis card still read the chassis base tank. None of them has a mounted store at that point.
- uexecute: the spill log uses sim fuel units, like the existing leak line.
