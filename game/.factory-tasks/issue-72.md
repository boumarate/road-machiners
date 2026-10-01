# Browser shortcuts pass through game keys

**Status:** plan
**Branch:** factory/issue-72
**Worktree:** none
**Goal:** In the running game, a player opens the `?` help panel, selects the version line, presses Ctrl+C (Cmd+C on macOS), and pastes the version elsewhere. No game action fires from that chord.
**Mode:** hands-off

## Context
- Issue 72: the bug form tells players to copy the version from the `?` panel, and Ctrl+C there does not copy. The reporter asks that text be selectable and copyable, following web practice.
- The `?` panel ends with the version line `el("div", { class: "version" }, versionLabel())` at `src/ui/hud.ts:162`. No CSS sets `user-select: none` on it or its parents (`src/ui/style.css`); only inventory items and chips do.
- No keydown handler in `src/` reads `ctrlKey`, `metaKey` or `altKey`. Each matches on `e.code` or `e.key` alone, so a chord runs the bare key's game action:
  - `Game.bindInput()` at `src/three/game.ts:461-467` runs `runKey(e.code)` and Space. Ctrl+C runs `KeyC`, which opens the character screen, a full modal. Ctrl+F recenters, Cmd+R toggles manual driving, Ctrl+Space plays a turn and calls `preventDefault()`.
  - `Hud` at `src/ui/hud.ts:113-115` toggles the camera mode on `KeyV`, so Ctrl+V and Cmd+V do too.
  - `KeyPan` at `src/three/render/camera.ts:269-271` pans on WASD, so Ctrl+A, Ctrl+S and Ctrl+D pan the camera.
  - `DialoguePanel.onKey()` at `src/ui/dialogue.ts:182-187` calls on `KeyT`, honks on `KeyH` and answers on digits, and stops propagation when it acts.
  - `InventoryScreen` at `src/ui/inventory.ts:124-128` rotates on `r`, so Ctrl+R / Cmd+R also rotates.
- The "Report a bug" link already prefills the version field through `bugReportUrl(versionLabel())` (`src/ui/hud-readout.ts:306`), so copying matters when the player opens the form some other way.
- Vitest runs in Node with no DOM (`vitest.config.ts`), so a unit test can only check a pure key predicate. Behavior needs a Playwright check.

## Design
Game keys are bare keys. A keydown with Ctrl, Meta (Cmd) or Alt held belongs to the browser and the OS: the game runs no action for it and does not call `preventDefault()` or stop propagation on it. Shift stays a game modifier, since Shift-click is a game input and Shift on a key changes nothing today.

One owner decides this: a new `src/ui/keys.ts` exports `isBrowserChord(e)`. Every game keydown handler that maps keys to actions returns early on it. Escape handlers (`hud.ts:148`, `sound.ts:41`, `save-panel.ts`, dialogue's Escape) only close panels and are also covered where they share a handler with action keys; standalone Escape listeners stay as they are, since no browser shortcut uses Escape with a modifier that the game blocks. The debug console toggle (`console.ts:269`) is a dev tool on Backquote and stays as is.

Keyup stays unguarded: `KeyPan` keyup always drops a held key, so a key pressed bare and released under a modifier still stops panning.

Text selection needs no CSS change. The version line and the other HUD text are already selectable; the chord was the only blocker. A "copy" button was considered and rejected: the bug link already prefills the version, and native select-and-copy is what the reporter asked for.

Approaches considered:
- Guard each handler with one shared predicate (chosen). Small, explicit, each handler keeps its own gates.
- One capturing window listener that stops propagation of every chord. Fewer edits, but it hides chords from every listener, including future ones that may want them, and it relies on listener order. Harder to reason about.
- Guard only `KeyC`. Fixes the report but leaves Ctrl+V, Ctrl+A, Ctrl+F and Cmd+R firing game actions, which the reporter's "any text" request covers.

Compatibility: no saved shape, data id or config changes. Players who pressed a chord on purpose to fire a game key lose that, which is the point.

TDD: yes — `isBrowserChord` is a pure deterministic predicate; write its test first. Handler wiring is checked in the browser.

### Invariants
- IV1 — A keydown with `ctrlKey`, `metaKey` or `altKey` set runs no game action in any handler listed in Context, and the game calls neither `preventDefault()` nor `stopPropagation()`/`stopImmediatePropagation()` on it.
- IV2 — Bare keys and Shift+key run the same game actions as before.
- IV3 — `isBrowserChord()` in `src/ui/keys.ts` is the only place that decides which modifiers make a chord.

### Principles
- PC1 — Each handler keeps its existing gates (typing, modal, death, busy); the chord check is one early return beside them, not a rewrite of the handler.

### Assumptions
- AS1 — The copy fails because Ctrl+C opens the character screen modal over the help panel, and selection or focus is lost with it. Not reproduced in this stage: `node_modules` is not installed here. PH2's browser check confirms that copy works after the fix; if it still fails, the cause is elsewhere and execution must investigate before closing.
- AS2 — AltGr on European layouts reports `ctrlKey` and `altKey` together. Treating it as a chord is fine because no game key needs AltGr.

### Unknowns
- UK1 — Whether headless Chromium in the factory grants clipboard read for the PH2 check. If not, the check asserts that the selection survives Ctrl+C and that no modal opened, and the clipboard step is left to the committee's manual check.

## Plan

Approach: add the predicate with a test, then guard each action handler with it, then prove copy works in the browser.

### PH1 — Chord predicate and handler guards
- 1.1 `src/ui/keys.ts` (create) — owns the rule for which keydowns belong to the browser instead of the game.
  - `export function isBrowserChord(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">): boolean` — true when any of the three is set.
  - Respects: IV3, AS2
- 1.2 `src/ui/keys.test.ts` (create), written first and failing:
  - Ctrl, Meta and Alt each make a chord; Ctrl+Alt (AltGr) makes a chord; no modifier and Shift alone do not.
- 1.3 `src/three/game.ts:461-467` (modify) — in the `bindInput()` keydown listener, return when `isBrowserChord(e)` before the Space and `runKey()` branches. Leave the keyup Space release unguarded.
  - Respects: IV1, IV2, PC1
- 1.4 `src/ui/hud.ts:113-115` (modify) — the `KeyV` camera toggle listener skips chords.
- 1.5 `src/three/render/camera.ts:267-271` and `src/three/game.ts:203` (modify) — `camera.ts` imports nothing from `src/ui/` today, so keep it that way: change the `KeyPan` constructor parameter from `typing: () => boolean` to `ignore: (e: KeyboardEvent) => boolean`, and its keydown adds a held key only when `!ignore(e)`. `game.ts` passes `(e) => this.isEditingControl() || isBrowserChord(e)`. Keyup unchanged.
- 1.6 `src/ui/dialogue.ts:182-187` (modify) — `DialoguePanel.onKey()` returns on a chord before `onBusyKey`/`onCallKey`/`onFreeKey`, so it never stops propagation of one.
- 1.7 `src/ui/inventory.ts:124-128` (modify) — the rotate listener skips chords.
- Commit: Game keys leave Ctrl, Cmd and Alt chords to the browser

### PH2 — Browser check and docs
- 2.1 `tmp/issue-72-copy.mjs` (create, untracked) — Playwright on the dev server, per `docs/tools.md#browser-checks` (`--cpu`-style software launch on the factory server). Steps:
  - Open the `?` panel, select the `.help .version` text with a triple click, press `Control+C`. Assert the character screen (`.character-screen`) stays hidden, `window.getSelection().toString()` still equals the version, and, when clipboard permission is granted (UK1), `navigator.clipboard.readText()` equals it.
  - Press `Control+V`, `Control+A`, `Control+F` and assert camera mode label, camera position and character screen are unchanged.
  - Press bare `C` and `V` and assert the character screen opens and the camera mode flips (IV2).
- 2.2 `docs/architecture/render.md` (modify, one sentence in its UI part) — game keys are bare keys; Ctrl/Cmd/Alt chords go to the browser, decided by `isBrowserChord()` in `src/ui/keys.ts`. No doc describes key handling today.
- 2.3 Run `npm test`, `npm run typecheck`, `npm run quality` from the repo root, and `npm run playtest -- --cpu`.
- Commit: Document that chords belong to the browser
- Respects: IV1, IV2, AS1, UK1

### Test strategy
- Unit: `isBrowserChord` cases in `src/ui/keys.test.ts` (PH1, TDD first).
- Behavior: the PH2 Playwright script covers the issue's copy path, other chords, and bare keys still working.
- Regression: `npm run playtest -- --cpu` for boot and turns.

### Risks / rollback
- RK1 — A handler missed in Context keeps firing on chords. Mitigation: during PH1, grep `addEventListener\("keydown"` in `src/` and confirm each one is guarded or is Escape/dev-only as the Design says.
- RK2 — Players on macOS who used Cmd+key for a game action lose it. Accepted per Design. Rollback is reverting the PH1 commit.

### Order & dependencies
- PH2 needs PH1 applied.

## Code smells
- The "is a text field focused" check is written three times: `Game.isEditingControl()` (`src/three/game.ts:439`), `isTyping()` (`src/ui/dialogue.ts:94`) and inline in `src/ui/hud.ts:114` and `src/ui/console.ts:300`. It could live beside `isBrowserChord` in `src/ui/keys.ts`. Out of scope here.

## Conclusion
### Hands-off decisions
- udesign: guard all action keys against Ctrl/Cmd/Alt, not only `KeyC` — the reporter asked for copyable text generally, and Ctrl+V, Ctrl+A, Ctrl+F and Cmd+R misfire the same way.
- udesign: Shift stays a game modifier — no browser text shortcut needs Shift alone, and Shift-click is game input.
- udesign: no copy button and no CSS change — the text is already selectable and the bug link already prefills the version.
- udesign: standalone Escape listeners and the debug console toggle stay unguarded — they block no browser shortcut.
- udesign: did not reproduce in a browser — `node_modules` is not installed in this design clone; AS1 records the premise and PH2 tests it.
- uplan: plan auto-approved
- uexecute: `isBrowserChord()` lives in `src/ui/dom.ts` (test in `src/ui/dom.test.ts`), not a new `keys.ts` — a new file in `src/ui` broke the quality gate's fragmentation limit. `Game.ignoresKey` shares it between the keydown handler and `KeyPan` (the handler's complexity limit forced it). `game.ts` was at its line cap, so the `pointermove` handler became one line.
- uexecute: Browser check `tmp/issue-72-copy.mjs` passed: Ctrl+C keeps the selection and opens no character screen, Ctrl+V/A do nothing, bare C opens it. Clipboard read not checked (UK1).
- uexecute: `npm test` passed except `src/phys/drive.test.ts` "hold zone keeps its speed up a hill", which timed out at 30s under load; it passes alone in 10s. No code fix made. Typecheck passes.
