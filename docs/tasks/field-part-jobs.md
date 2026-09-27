# Field part changes and inventory swaps

## Context
- `moveItem` currently requires a town when a part changes mounted state. Inventory dragging rejects occupied positions. Parked jobs already support repair and search with turn counts and cancellation on movement.
- The requested field work costs 5 turns per installation or removal. Replacing an installed part with a spare costs 10 turns. Clicking an occupied position with an item selected must swap the two items when both fit.
- Worktree: `.worktrees/field-part-jobs`, branch `feature/field-part-jobs`, base `923c8325bb3a6116986ac73a7f3d2392de7bd7c4`. Uncommitted changes in the main checkout remain untouched and are not included.

## Desired design
- Outside towns, changing mounted equipment starts one parked refit job. Each affected installed part costs 5 turns to remove and each resulting installation costs 5 turns. Moving installed equipment between mount positions therefore costs removal plus installation. Rearranging goods or spare parts remains instant.
- Keep garage changes instant. Garage storage remains town-only.
- Select an item, then click another item to exchange their positions. Preserve each item's rotation. Support the same exchange when dragging onto one occupied item. Reject overlaps with multiple items and swaps where either item cannot fit.
- Apply a field refit atomically when its full timer ends. Until then the old layout and equipment remain active. Movement cancels the job with no layout change and loses progress, matching existing parked jobs.
- Allow one job per truck. Block conflicting inventory edits during a refit. Revalidate the pending change before completion and cancel visibly if required items or space have disappeared. Preserve current part damage rather than restoring an old inventory snapshot.
- Direct salvage placement on a mount must use the same timed installation rule. Spare collection stays instant. Swaps concern two items already in the truck grid. External storage and salvage retain their existing transfer controls.

## Invariants and principles
- No item is lost, duplicated, or moved outside the resulting grid. Built-in parts remain fixed. Removing cargo equipment cannot strand items on removed rows.
- Simulation owns fit checks, job duration, and completion. UI calls simulation commands and displays their result. Simulation imports no UI or rendering code.
- Reuse the existing parked-job lifecycle and world save structure. Pending refits store item identities and destinations, not copies of whole inventories. No new dependencies or generic job framework.
- Duration is a balance rule in `src/data/rules.ts`, not a UI constant. Mechanics does not change the requested fixed duration.

## Progress
- Worktree dependencies installed locally. Existing quality hook installed from the main checkout. Baseline inventory and jobs checks passed: 21 tests.
- Phase 1 implemented. Field timers, swaps, cancellation, damage preservation, salvage installation, and save/load pass focused tests. Placement planning stays in `src/sim/inventory.ts` to keep inventory behavior together and meet the existing fragmentation limit.
- Phase 2 complete. One-click swaps, drag swaps, selection indication, and refit progress pass browser checks. Interaction assertions use `tmp/try-refit.mjs` because the existing Vitest UI suite runs in Node without a DOM. No test dependencies were added.

## Implementation plan
### Phase 1 — Timed field refits and atomic swaps
- `src/data/rules.ts` owns the 5-turn part operation cost.
- `src/sim/types.ts` owns the refit job variant and its serializable item destinations.
- `src/sim/inventory.ts` owns planning and validation of moves and two-item swaps, duration calculation, and applying the resulting layout through existing refit checks.
- `src/sim/jobs.ts` owns starting, advancing, and cancelling refit jobs alongside repairs and searches. Keep inventory placement rules in their owner.
- `src/sim/locations.ts` owns salvage transfers and routes mounted field placement through the refit rules without removing stock before successful completion.
- Inspect `src/three/save.ts` and job consumers for required handling of the new variant. Add only changes needed to preserve and restore pending jobs.
- `src/sim/inventory.test.ts`, `src/sim/jobs.test.ts`, and relevant salvage/save tests own regression coverage for their respective behavior.
### Phase 2 — Inventory controls and job feedback
- `src/ui/inventory.ts` owns selection, one-click swaps, drag swaps, fit feedback, and field-work explanations. Keep inspection available and distinguish a selection click from a drag so it cannot launch unintended work.
- `src/ui/hud.ts` owns refit progress display. `src/ui/format.ts` owns started, completed, and cancelled refit event text.
- `src/ui/inventory.test.ts` retains existing inventory artwork checks. `tmp/try-refit.mjs` exercises selection, swaps, and rejected targets in Chromium.
- `DESIGN.md` owns the updated player-facing rules for field work and swaps.

## Verification
- Before implementation, install dependencies locally in the worktree with `npm ci`, install the existing hook from the main checkout, and run focused existing inventory and job tests. Record any baseline failures without repairing unrelated changes.
- Add failing regression tests first, then verify installation completes on turn 5 and replacement on turn 10, with unchanged layout before completion.
- Test moving cancellation, an already busy truck, changed or missing parts, pending-job save/load, blocked cargo-row removal, built-in parts, mismatched swap footprints, multiple overlaps, and conservation of item identities and current damage.
- Verify instant garage operations, instant goods/spare swaps, mounted-to-mounted relocation cost, and salvage installation without an instant-mount bypass.
- Run focused Vitest tests, `npm run typecheck`, and `npm run quality` inside the worktree. Run `npm run playtest` against a worktree-local dev server.
- Manual try, positive: use a Metal-backed Playwright script in worktree-local `tmp/` to select a spare and click an installed part outside town, observe the 10-turn job, advance turns, and verify the completed swap and progress display. Also swap two goods instantly.
- Manual try, negative: attempt a swap that cannot fit and verify visible rejection with no inventory changes. Start a valid field refit, drive away, and verify cancellation with no completed swap.
- Capture screenshots of inventory and job feedback. User confirmation is required for small visual details. Append actual results after approved execution.

## Result
- Implemented field installation/removal at 5 turns per operation, atomic 10-turn replacement, instant garage changes, and click/drag swaps. Driving above parked speed cancels work. Current damage and item identities survive completion and save/load.
- Focused verification passed: `npm test -- src/sim/refit.test.ts src/sim/inventory.test.ts src/sim/jobs.test.ts src/sim/search.test.ts src/sim/salvage.test.ts src/three/save.test.ts src/ui/inventory.test.ts` ran 74 tests across 7 files. `npm run typecheck` and `npm run quality` passed. Logs: `tmp/final-tests.log`, `tmp/final-typecheck.log`, `tmp/final-quality.log`.
- `npm run playtest -- --url http://localhost:5174` passed 12 turns at 60.5 frames per second on Metal. Log: `tmp/playtest.log`.
- Manual positive passed: goods swapped instantly by click and drag, selected-item accessibility state was correct, replacement stayed pending through turn 9 and completed on turn 10, and refit progress appeared. Manual negative passed: a fixed-part swap was rejected without mutation, and driving at speed 2.239 cancelled a pending replacement without swapping. Script: `tmp/try-refit.mjs`. Output: `tmp/try-final.log`.
- The first driving fixture ended at speed 0.396, below the parked limit, so work correctly continued. The fixture was moved to a clear road. An attempt to remove fixed map rocks was rejected by the renderer and removed from the fixture. One Chromium launch crashed before loading the game. A fresh launch succeeded. Browser testing also caught an empty selection accessibility attribute, which was fixed and retested.
- Screenshots inspected: `tmp/refit-inventory.png`, `tmp/refit-progress.png`, `tmp/refit-rejected.png`, and `.playtest/end.png`. The small selection outline awaits user confirmation. No functional verification remains blocked.
- Work remains on `feature/field-part-jobs` in `.worktrees/field-part-jobs`. No merge was performed.
