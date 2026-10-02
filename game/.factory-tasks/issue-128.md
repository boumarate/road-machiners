# Make part condition clear at a glance (issue #128)

**Status:** planned
**Branch:** factory/issue-128
**Worktree:** none
**Goal:** In the shop buy and sell tabs, NPC truck trade, the inventory inspection panel, garage storage and salvage loot, a swappable part's condition (pristine, rebuilt xN, junk) sits on its own row or tag. The colors are ordered by brightness: pristine is brighter than normal text and has a small star, and junk is gray. A broken part that can be rebuilt reads "broken" separately from its condition. Revision 1 adds two rules: grid item boxes show no star, and built-in core parts (cab, wheels, tank, transmission) show no condition row or tag. Screenshots of the finished game confirm this. No sim, price or save change.
**Mode:** hands-off

## Context
- `wearLabel()` in `src/ui/format.ts:97-101` gives "pristine", "rebuilt xN" or "junk". Non-junk wear runs 0 to `CONDITION.maxWear` (4, `src/data/wear.ts:5`). `isJunk()` is `wear > maxWear` (`src/sim/wear.ts:139`). A built-in core part caps at maxWear and never turns to junk.
- `partCard()` (`src/ui/cards.ts:234-255`) shows condition as `partNote()` (`cards.ts:221-225`), a 12px `.dim` span under the name (`style.css:1574`). The note mixes in HP state: "broken, rebuilt x2" or "junk, scrap only". `conditionMeter()` (`cards.ts:210-218`) shows HP only as a bar, with the numbers in a hover title.
- `partCard` is used by the shop buy tab (`src/ui/town.ts:235`), the sell tab (`town.ts:280`) and NPC truck trade (`town.ts:652`).
- The inventory inspection panel (`showItem`, `src/ui/inventory.ts:396-403`, and `showTruckItem` for a knocked-out target, `inventory.ts:683-688`) puts the wear inside `itemState()` ("Spare, rebuilt x1", `src/ui/inventory-draw.ts:156-160`), also as a dim span. `partDetails()` (`inventory.ts:1015-1023`) adds the meter and an "Against X" line.
- Garage storage chips (`inventory.ts:530-546`) and salvage loot chips (`inventory.ts:559-576`) show icon, name, footprint and an HP bar. They show no wear except in the hover title (`partTitle`, `inventory-draw.ts:147-150`).
- Grid item boxes (`itemBox`, `inventory-draw.ts:65-81`) show icon, short name and HP bar. Their title and aria-label already contain `wearLabel`.
- UI colors live in `src/ui/style.css`: text `--ink #e0d8ca`, `--muted #aaa69e`, bad `#f0a080`, card background `#22292d`, panel `#272b2e`.
- Vitest runs in Node with no DOM (`vitest.config.ts`), so `el()` builders cannot be unit-tested. Pure functions and the CSS text can be.
- `createIcon()` (`cards.ts:138-146`) draws SVG icons from `ART` with `aria-hidden` and a title. The UI font may lack a ★ glyph.

## Reference images
The issue has no reference images. The committee feedback for revision 1 replied to an image, `file_24.jpg`, but it was not available to this stage (its cached path does not exist), so it was NOT seen. The design does not depend on it: the two written requests are clear on their own (AS8). The goal is a UI look, so the plan ends with a screenshot acceptance check in PH7, checked against the issue's acceptance list and the committee's two requests rather than against an image. No 3D model is built, so the `blender-image-to-3d` skill does not apply.

## Design
The change is UI only, under the Information principle: condition decides equip, buy, sell and loot choices, so it must read at a glance. Labels stay the main cue. Color and the star only reinforce them.

**Condition tiers.** A new pure function `conditionTier(part)` in `src/ui/format.ts`, next to `wearLabel`, gives `"pristine"`, `"w1"`…`"w<maxWear>"` or `"junk"`. Each tier has one CSS class `.cond-<tier>` in `style.css` with its text color. The colors get dimmer as wear grows:
- pristine: a warm near-white, brighter than `--ink`, with a small filled star.
- w1: `--ink`.
- w2 to w4: warm grays in descending brightness.
- junk: a neutral light gray, the dimmest step and without the warm tint.
Every tier keeps at least 4.5:1 contrast against the card and panel backgrounds. A test parses the CSS and enforces both the order and the contrast.

**HP status is separate from condition.** A new pure function `conditionStatus(part)` in `format.ts` gives `{ text, tone }`:
- junk: "scrap only", dim.
- HP 0: "broken", bad.
- otherwise: "`<hp>`/`<max>` HP", dim. It uses `hp()` from `units.ts`, as the meter title does today.
So a broken rebuildable part reads "rebuilt x2 · broken", in two colors. A junk part reads "junk · scrap only".

**Shared view pieces in `cards.ts`:**
- `conditionTag(part)`: the star icon (pristine only), then the `wearLabel` text, inside a span with class `cond cond-<tier>`.
- `conditionRow(part)`: a `.card-cond` row with the tag on the left and the status on the right.

**Where condition shows:**
- `partCard`: the name block holds only the name. `conditionRow` sits between the head and the meter. `partNote` is deleted.
- Inspection panel: `itemState` drops the wear and keeps "Mounted", "Spare" or "Built in". `partDetails` puts `conditionRow` above the meter. Both inspection views use `partDetails`, so the target truck view gets the row too.
- Comparison lines: "Compared with X" in partCard and "Against X" in the inspection panel append the base part's `conditionTag`. The stat deltas depend on the base part's wear, so the player needs to see it.
- Compact chips (storage, loot): `conditionTag` in a smaller font after the name, so the full label shows.
- Grid item boxes (superseded by revision 1, IV6: no grid star): a small star in a corner for pristine parts only. The star is aria-hidden; the item's existing aria-label already says "pristine". Rebuilt and junk grid items stay unchanged and keep the wear in their title. A cell is too small for a label.

**Star:** a new `star` entry in `ART` and `ICON_NAMES` ("Pristine"), drawn through `createIcon`, so the glyph does not depend on the font. It is filled with the pristine color.

**Rejected approaches:**
- Computing colors in TypeScript by blending. UI colors live in CSS, and inline styles would scatter them.
- Folding the status into `wearLabel`. That is the current problem, and `wearLabel` also feeds tooltips and other text.

TDD: yes for `conditionTier`, `conditionStatus` and the CSS color ladder test, since they are deterministic and their regression should fail CI. The DOM placement is checked with screenshots, because the tests have no DOM.

### Invariants
- IV1 — `conditionTier` maps wear 0 to `pristine`, wear 1..`CONDITION.maxWear` to `w<wear>`, and junk to `junk`. `wearLabel` output is unchanged.
- IV2 — `style.css` has a `.cond-<tier>` color for every tier `conditionTier` can return. Relative luminance strictly falls from pristine through w1..w4 to junk. Pristine is brighter than `--ink`. Every tier is at least 4.5:1 against `#22292d` and `#272b2e`.
- IV3 — `conditionStatus` returns "broken" with tone bad for a non-junk part at 0 HP, "scrap only" for junk, and the HP numbers otherwise. A broken rebuildable part never shows the word "junk".
- IV4 — Only pristine parts get the star, and only in condition tags (revision 1: never on a grid box or a core part).
- IV5 — No file under `src/sim/`, `src/data/`, `src/phys/` or the save code changes. Prices, stats and saves are untouched.

### Principles
- PC1 — The label text is always visible next to its color, so color is never the only cue.
- PC2 — One owner per concept: `format.ts` decides tier, label and status text, `cards.ts` builds the condition elements, `style.css` holds the colors. Every view calls `conditionTag` or `conditionRow` and never builds its own.

### Assumptions
- AS1 — "Junk light gray" and "visually ordered brightness" together mean junk is the dimmest step but still a readable light gray, set apart from the warm rebuilt grays by hue.
- AS2 — The issue's "comparison views" are the "Compared with" and "Against" lines. No separate comparison screen exists.
- AS3 — Showing HP numbers on the condition row is how the HP state "stays legible". The meter stays below the row.
- AS4 — (Superseded by revision 1: grid boxes get no star.) Grid boxes only need the pristine star, since a 1×1 cell cannot fit a label and the inspection panel shows the full row on click.

### Unknowns
- UK1 — Whether the chip tag fits a narrow storage or loot column without squeezing the name. Resolved in PH4 by screenshot. The fallback is to drop the "rebuilt " prefix in chips only, through a `short` option on `conditionTag`.
- UK2 — (Moot after revision 1.) Where the grid star fits without covering the icon or name on 1×1 and long items. Resolved in PH4 by screenshot.

## Revision 1 — committee feedback
Feedback from Dr. Boris, quoted in the issue comments:
1. "dont display the stars on icons in grid view"
2. "parts that cant be changed (e.g. cab) dont get this condition display at all"

### Revision context
- Round 1 added the grid star in `partBoxExtras()` (`src/ui/inventory-draw.ts:64-68`), styled by `.inv-item-star` (`src/ui/style.css:1089-1106`). The test `colors the grid star from the pristine color` (`src/ui/condition-style.test.ts:57-59`) checks that CSS rule.
- Core parts have `kind: "core"` in `src/data/parts.ts`. They are cabs, wheels, tanks and transmissions. They cannot be moved or sold (`src/sim/inventory.ts:193,253`). Their wear caps at `CONDITION.maxWear` (`src/sim/wear.ts:150`).
- Core parts never reach `partCard` or the storage or loot chips. Shop stock excludes core (`town.ts:59`). The garage and spares never hold core parts (`world.ts:493`, `npc-loadout.ts:65`). Core parts appear only on the truck grid, which leads to the inspection panel: `showItem` (`inventory.ts:396-403`) and `showTruckItem` (`inventory.ts:685-690`). Both call `partDetails()` (`inventory.ts:1017-1026`), and that puts `conditionRow(part)` first.
- A "Compared with" or "Against" base comes from `baselinePart(me, kind)` for the inspected part's kind. A spare part is never core, so its base is never core either.
- `itemState()` already returns plain "Built in" for core (`inventory-draw.ts:164`). The hover title and aria-label (`partTitle`, `itemTitle`, `inventory-draw.ts:136-156`) still include `wearLabel` for every part, as they did before #128.
- `el()` (`src/ui/dom.ts:5`) skips `null` children. `replaceChildren` does not accept null.

### Revision design
**No grid star.** Delete `partBoxExtras` and append only `conditionBar(it.part)` again, as before #128. Delete the `.inv-item-star` CSS rules and their test. The star stays in `conditionTag`, so cards, chips and the inspection row keep it. The grid item's existing aria-label and hover title already say "pristine".

**No condition display on core parts.** One owner decides whether a part shows condition: a new pure function `showsCondition(part)` in `src/ui/format.ts`, next to `conditionTier`. It returns false for a core part and true for every other part. `conditionTag` and `conditionRow` in `cards.ts` return `null` when it is false, so no view can show it by mistake. `partDetails` leaves out a null row. The HP meter stays on core parts. It predates #128 and shows HP, not condition.

Rejected: checking `kind === "core"` inside `partDetails` only. That works today, since only the inspection panel shows core parts. But the next view that shows a core part would repeat the check or miss it.

TDD: yes for `showsCondition`, a pure function. The grid star removal and the core row removal live in DOM builders with no DOM in Vitest, so screenshots check them.

### Revision invariants
- IV6 — No grid item box draws a star for any part. `.inv-item-star` no longer exists in `src/ui/` code or CSS.
- IV7 — `showsCondition` is false for every `kind: "core"` part def and true for every other kind. `conditionTag` and `conditionRow` return null exactly when it is false.
- IV8 — Swappable parts keep the round 1 behavior: IV1 to IV5 still hold, and the star still shows in cards, chips and the inspection row.

### Revision assumptions
- AS5 — "Parts that cant be changed" means `kind: "core"` parts, the built-in ones that the inventory refuses to move. The cab is the committee's example.
- AS6 — "This condition display" means the #128 condition row and tag: wear label, star, tier color and the status text. A core part keeps its HP meter, as it had before #128, and the plain "Built in" state line.
- AS7 — The hover title and screen-reader label of a grid item keep the wear text, for core parts too. They predate #128 and are not a visible display. The committee can ask for their removal at approval.
- AS8 — The committee's attached image (`file_24.jpg`) was not available to this stage. The two written requests are clear without it, so the design does not depend on it.

## Plan

Revision 1 plan. Round 1 (PH1 to PH4 in commits 34d742d6, 0f69b838 and a216b8ea) is done and is not redone. Approach: add the core rule as one pure function with a test, then remove the grid star and route the core rule through the shared builders, then screenshot. Three phases in order, all in `src/ui/`.

### PH5 — Core parts show no condition (TDD)
- 5.1 `src/ui/format.test.ts:33-40` (modify): add a `showsCondition` describe. Test it on every def in `Object.values(PARTS)` from `src/data/parts.ts:701`: false for each `kind === "core"`, true otherwise, and false for `cab` by name. Run it and watch it fail.
- 5.2 `src/ui/format.ts:103-110` (modify): add `export function showsCondition(part: PartInstance): boolean`, which returns `partDef(part.defId).kind !== 'core'`. Add a one-line comment saying why: built-in parts are never swapped, bought or sold, so their wear decides no choice.
- 5.3 `src/ui/cards.ts:222-232` (modify): `conditionTag(part): HTMLElement | null` and `conditionRow(part): HTMLElement | null` return null when `showsCondition(part)` is false. Update their comments. Callers in `partCard`, `compareLine` and the chips pass the result to `el()`, which skips null, and need no change.
- 5.4 `src/ui/inventory.ts:1017-1026` `partDetails()`: build the list with `...(row ? [row] : [])` for the condition row, so the return type stays `HTMLElement[]`. The "Against" line passes `conditionTag(base)` to `el()` as now.
- Respects: IV7, IV8, PC2, AS5, AS6
- Commit: "Hide part condition on built-in parts (#128)"

### PH6 — Remove the grid star
- 6.1 `src/ui/inventory-draw.ts:64-68,85` (modify): delete `partBoxExtras` and append `conditionBar(it.part)` in `itemBox` as before #128. Drop the `conditionTier` import if it is unused.
- 6.2 `src/ui/style.css:1089-1106` (modify): delete the `.inv-item-star` rules. Keep `--cond-pristine`, since `.cond-pristine` uses it.
- 6.3 `src/ui/condition-style.test.ts:57-59` (modify): delete the `colors the grid star from the pristine color` test.
- 6.4 Run `grep -rn "inv-item-star" src/` and expect no hits.
- Respects: IV6, IV8
- Commit: "Remove the pristine star from grid item boxes (#128)"

### PH7 — Verify on screen
- 7.1 Run `npm test` and `npm run typecheck` in `game/`, and `npm run quality` at the repo root.
- 7.2 Reuse or rewrite `tmp/condition-shots.ts` (Playwright, CPU launch flags, `__ROAM__` state edits as in PH4). Give the player a pristine spare weapon on the grid, a pristine weapon in garage storage and a pristine part in shop stock. Set the cab to wear 2 and a wheel to HP 0. Screenshot to `tmp/condition/`:
  - the inventory grid;
  - the inspection panel for the cab, for the broken wheel and for the pristine spare;
  - a knocked-out NPC truck's cab in the target inspection, if the setup is quick; otherwise note that it shares `partDetails`;
  - the shop buy tab and the garage storage chips.
- 7.3 Visual acceptance check. Look at each screenshot and record pass or fail with the file name:
  - no grid box shows a star, pristine or not;
  - the cab inspection shows "Built in" and the HP meter, with no condition row, no wear label and no star;
  - the broken wheel inspection shows no condition row, and its meter is empty;
  - the pristine spare inspection still shows the condition row with the star;
  - shop cards and storage chips still show the star and tier colors.
- 7.4 Run `npm run playtest -- --cpu` with the dev server.
- Respects: IV5, IV6, IV7, IV8. `git diff --stat a216b8ea` shows only `src/ui/` files.

### Test strategy
- `format.test.ts`: IV7 over every part def, so a new core part is covered without a test edit.
- Round 1 tests (`conditionTier`, `conditionStatus`, the CSS ladder) stay and guard IV8.
- Screenshots (PH7): IV6 and the core inspection view, since the DOM builders have no unit tests.

### Order & dependencies
- PH5 → PH6 → PH7. PH5 and PH6 touch different functions and could run in either order. They run one after the other so each commit passes tests alone.

### Risks / rollback
- RK3 — A core part with no row could hide that it is broken. The empty meter still shows that, and the defeat and repair flows report broken core parts on their own. Check the broken wheel screenshot in 7.3.
- RK4 — Changing `conditionTag` to return null could break a caller that expects an element. tsc catches this, since the type changes. Run `npm run typecheck` after PH5.
- Rollback: revert the PH5 and PH6 commits. No data or save changes.

### Interfaces
- IF1 — `showsCondition(part: PartInstance): boolean` in `src/ui/format.ts`. False exactly for `kind: "core"` defs. `conditionTag` and `conditionRow` return `HTMLElement | null` and are null exactly when it is false.

### Interface graph
- PH5 -> IF1 @ src/ui/format.ts, src/ui/format.test.ts, src/ui/cards.ts, src/ui/inventory.ts
- PH6 -> @ src/ui/inventory-draw.ts, src/ui/style.css, src/ui/condition-style.test.ts
- PH7 IF1 -> @ tmp/condition-shots.ts

## Round 1 plan (done)

Approach: add the pure tier and status functions with tests first, then the shared elements and CSS, then wire every view, then screenshot. Four phases, run in order, all in `src/ui/`.

#### PH1 — Tier and status functions (TDD)
- 1.1 `src/ui/format.test.ts:18-30` (modify): add tests for IV1 (wear 0, 1, maxWear, maxWear+1) and IV3 (working, broken at wear 2, junk, and a broken core part at maxWear reads "broken", not junk).
- 1.2 `src/ui/format.ts:95-101` (modify): add
  - `export type ConditionTier = 'pristine' | \`w${number}\` | 'junk'`
  - `export function conditionTier(part: PartInstance): ConditionTier`
  - `export function conditionStatus(part: PartInstance): { text: string; tone: 'dim' | 'bad' }`. It imports `maxHp` from `../sim/wear` and `hp` from `./units`.
  - Respects: IV1, IV3, PC2
- Commit: "Give part condition a tier and a separate HP status (#128)"

#### PH2 — Condition elements and colors
- 2.1 `src/ui/condition-style.test.ts` (create): read `src/ui/style.css` with `node:fs`. For each tier from `conditionTier` over wear 0..maxWear+1, find the `.cond-<tier>` color hex. Assert IV2: ordered luminance, pristine above `--ink`, contrast ≥ 4.5 against both backgrounds. Also assert the `.cond-pristine .icon svg` fill exists. Write this test first and watch it fail.
- 2.2 `src/ui/style.css:1560-1577` (modify): add `.cond`, `.cond-pristine`, `.cond-w1`…`.cond-w4`, `.cond-junk` colors, the star sizing and fill for `.cond .icon` (12px, inline), and `.card-cond` (flex row, space-between, 12px). Pick the hex values to pass 2.1.
- 2.3 `src/ui/cards.ts:15-60,138-146,210-225` (modify):
  - Add a `star` path to `ART` and `star: "Pristine"` to `ICON_NAMES`.
  - `export function conditionTag(part: PartInstance): HTMLElement`
  - `export function conditionRow(part: PartInstance): HTMLElement`. The status span gets class `dim` or `bad` from `conditionStatus`.
  - Delete `partNote`.
  - Respects: IV2, IV4, PC1, PC2
- Commit: "Draw part condition as its own colored tag with a pristine star (#128)"

#### PH3 — Wire every view
- 3.1 `src/ui/cards.ts:234-260` `partCard()`: the name block becomes `el("b", {}, def.name)` alone. Insert `conditionRow(o.part)` after the head. `compareLine(base)` appends `conditionTag(base)`.
- 3.2 `src/ui/inventory-draw.ts:156-160` `itemState()`: return "Built in", "Mounted" or "Spare" without the wear. `partTitle` and `itemTitle` stay unchanged and keep the wear for hover text and the aria-label.
- 3.3 `src/ui/inventory-draw.ts:65-81` `itemBox()`: for a part at wear 0, append `createIcon("star")` wrapped in `span.inv-item-star`. Add the `.inv-item-star` corner position to `style.css` near `.inv-item` (`style.css:1091`).
- 3.4 `src/ui/inventory.ts:1015-1023` `partDetails()`: put `conditionRow(part)` first. The "Against X" line appends `conditionTag(base)`.
- 3.5 `src/ui/inventory.ts:530-546,559-576` storage and loot chips: insert `conditionTag(p)` after the name span. Add `.inv-chip > .cond { font-size: 11px; }` to `style.css` near line 1235.
- Respects: PC1, PC2, IV4, AS2, AS4
- Commit: "Show part condition on its own row in shop, trade, inventory and loot (#128)"

#### PH4 — Verify on screen
- 4.1 Run `npm test`, `npm run typecheck` and `npm run quality` from the repo root.
- 4.2 Write `tmp/condition-shots.ts`, a Playwright script using `--cpu` style launch flags, since this machine has no GPU. Use `__ROAM__.state` clone plus `apply()` to put a pristine, a rebuilt x1, a rebuilt x3 (HP 0) and a junk part of the same weapon `defId` into:
  - a town shop's stock (buy tab) and the player's spares (sell tab);
  - garage storage;
  - a salvage site's stock (loot chips);
  - a knocked-out NPC's spares (target inspection).
  Screenshot each view to `tmp/condition/`.
- 4.3 Visual acceptance check. Look at each screenshot and confirm, by name:
  - the condition row is separate from the name;
  - the pristine star is visible;
  - pristine is brighter than the part name text;
  - x1 > x3 > junk in brightness;
  - junk is gray;
  - "broken" on the x3 part is red and apart from "rebuilt x3";
  - chip tags do not squeeze the names (UK1);
  - the grid star clears the icon and name (UK2).
  Record each item as pass or fail with the file name.
- 4.4 Run `npm run playtest -- --cpu` with the dev server.
- Respects: IV5. `git diff --stat main` shows only `src/ui/` files.

#### Test strategy
- `format.test.ts`: IV1 and IV3, including broken-not-junk.
- `condition-style.test.ts`: IV2 on the real CSS, so a new wear step or a color edit that breaks the order fails.
- Screenshots (PH4): placement, the star, and readability in each view. The issue's acceptance list is checked by name.

#### Order & dependencies
- PH1 → PH2 (`conditionTag` uses `conditionTier` and `conditionStatus`) → PH3 → PH4. All four phases run in order.

#### Risks / rollback
- RK1 — Tests that match on `partNote` or `itemState` text break. None was found by grep. Rerun `npm test` after PH3.
- RK2 — The extra row makes shop cards taller and may push the card grid past its panel height. Check in the PH4 screenshots. Fix with spacing only, without changing card content.
- Rollback: revert the phase commits. No data or save changes.

## Code smells
- `conditionBar()` in `inventory-draw.ts:138-145` duplicates `conditionMeter()` in `cards.ts:210-218` with different class names. Left as is, since it is out of scope.
- `.info-part` rules in `style.css:700-712` have no user in `src/`.

## Conclusion
### Hands-off decisions
- udesign: junk is the dimmest step, a neutral light gray — this reconciles "junk light gray" with "ordered brightness" (AS1).
- udesign: the star is an SVG icon, not a ★ glyph — the UI fonts may lack the glyph.
- udesign: HP numbers move onto the condition row as the status text — this keeps HP legible and apart from wear (AS3).
- udesign: grid boxes get only the pristine star — cells are too small for labels (AS4).
- udesign: wear on the comparison base is shown in the "Compared with" and "Against" lines (AS2).
- uplan: plan auto-approved.
- udesign (rev 1): the core rule lives in one pure `showsCondition` in `format.ts`, and the shared builders return null — so no view can show core condition by mistake.
- udesign (rev 1): core parts keep the HP meter and the hover or aria wear text — both predate #128 (AS6, AS7).
- udesign (rev 1): the committee image `file_24.jpg` was unavailable; the written feedback is clear without it (AS8).
- uplan (rev 1): plan auto-approved.

### Round 1 execution result
- PH1 to PH3 done in three UI-only commits (`format.ts`, `cards.ts`, `inventory.ts`, `inventory-draw.ts`, `style.css`, two tests). `npm test` (2878) and `npm run typecheck` pass. No pre-existing failures fixed.
- PH4 screenshots (`tmp/condition/inventory.png`, `inspect.png`): pass — grid star clears icon and name (UK2), inspection shows a separate condition row with the star, brighter than the name, and HP on the right.
- Not screenshotted: shop buy/sell, NPC trade, garage and loot chips (UK1), and the rebuilt, broken and junk colors. The machine is slow and these need a town. The CSS ladder test covers the color order and contrast. The playtest was left to the testing stage.

## Round 1 verify

Result: passed

- CK1 — shop buy/sell cards, garage chips, inspection, grid star render the tiers on screen — held (screenshots in `.factory/`).
- CK2 (IV3) — broken rebuildable part never reads "junk" — held: "rebuilt x3 · broken" (red), junk reads "scrap only".
- CK3 (IV5) — only `src/ui/` changed — held.
Smoke: Playwright in headless Chromium with a part of each tier in shop stock and storage. `npm run typecheck` and `npx vitest run src/ui` pass.
Notes: NPC trade and salvage loot chips were not screenshotted. They use the same `partCard` and `conditionTag`.

### Review
- Important: the grid star used its own `wear === 0` — fixed, it now calls `conditionTier`.
- Important: the pristine hex was copied in three CSS rules — fixed, one `--cond-pristine` variable, and the test reads it.
- PH4 gap — closed: shop, storage chips and broken/junk colors screenshotted. UK1 resolved: chips show the full tag without squeezing the name.

### Visual comparison
No reference image. Checked against the issue's acceptance list:
- Condition row is separate from the name: matches.
- Pristine star visible and brighter than the name: matches.
- Brightness falls from rebuilt x1 to x3 to junk: matches.
- Junk is gray: matches.
- "broken" is red and apart from "rebuilt x3": matches.
- Chip tags do not squeeze names (UK1) and the grid star clears the icon (UK2): matches.

### Revision 1 execution result
- PH5 and PH6 done in two UI-only commits: `showsCondition` (tested over every part def) with null-returning `conditionTag` and `conditionRow`, and the grid star removed (code, CSS and its test). `npm test` (2879) and `npm run typecheck` pass. No pre-existing failures fixed.
- PH7 screenshots and the playtest were not run, because the machine is slow. The core rule and the grid star removal live in DOM builders, so a player should check them on screen: cab inspection shows "Built in" and the HP meter with no condition row, and no grid box has a star.
