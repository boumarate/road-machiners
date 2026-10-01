# Log rework (issue #86)

**Status:** executed
**Branch:** factory/issue-86
**Worktree:** none
**Goal:** In the running game, the event log keeps a scrollable history of the session, every line leads with the game day and time in the format of the HUD clock (for example `Day 2 14:32`), a header button expands the log into a tall panel and shrinks it back, and a player scrolled back in the history stays where they are when new lines arrive.
**Mode:** hands-off

## Context
- `Hud` in `src/ui/hud.ts:102-518` owns the log. It keeps the newest `LOG_LINES = 14` lines (`hud.ts:77`) and drops older ones, so the history is lost after one busy turn.
- Every line is stamped `T<turn>` in two places: `turnStamped()` (`hud.ts:92`) for sim events and an inline template in `note()` (`hud.ts:503`) for UI notes. DESIGN.md says the log tells events in-character, and turns are an out-of-character mechanic.
- `clockLabel()` in `src/ui/format.ts:500` already formats a turn as `Day 2 14:32`, and the HUD "Time" readout uses it (`hud-readout.ts:294`). `save-panel.ts:18` has its own `clockText()` with a different format.
- `renderLog()` (`hud.ts:508`) rebuilds the whole panel on every push. The new DOM starts at scroll 0, so a player reading older lines gets thrown back to the newest one.
- The panel is 122px tall with an 86px line box (`style.css:495-541`), and 48px under 720px wide (`style.css:1283-1292`). About 5 short lines fit.
- `panel()` stops wheel events (`dom.ts:48`), so the wheel scrolls the log instead of zooming the camera.
- While a modal is open, the log stays visible above it (`style.css:816-825`). `scripts/ui-playtest.mjs:17-24` fails if the log covers the modal.
- Log lines live only in the UI. They are not in `World` and are not saved, so this change needs no save format change.
- UI tests run in Node without a DOM (`src/ui/*.test.ts`), so logic that needs a test must not depend on the DOM.

## Design
This is a UI-only change. The sim, the events and `eventText()` stay as they are.

**Ownership.** A new `src/ui/log.ts` takes the log out of `Hud`:
- `LogBook` is a pure class that owns the history. `add(turn, line)` stamps a line with `clockLabel(turn)` and keeps it, newest first. The history keeps at most `LOG_HISTORY` lines and drops the oldest. Sim events and UI notes both go through this one stamping path, which replaces `turnStamped()` and the inline `T${turn}`.
- `LogPanel` is the DOM view. It owns the panel element, the expand toggle and the scroll position. `Hud` keeps a `LogPanel` and calls it from `pushEvents()` and `note()`. `Hud` still decides which events also show a toast.

**Day and time.** Each line starts with a dim stamp span (`clockLabel(turn)`, for example `Day 2 14:32`), followed by the line's own text or spans. The stamp is a span of its own so the eye can skip it, and it matches the HUD clock. The turn passed in is the same `w.turn` the `T` stamp uses today, so stamps keep their current timing.

**Scrollable.** The history goes from 14 lines to `LOG_HISTORY = 200`. New lines are prepended to the line box instead of rebuilding it. If the player has scrolled away from the top (the newest line), the scroll position moves down by the height of the added lines, so the lines they were reading stay in place. At the top, new lines show as they arrive, as they do today.

**Expandable.** The log header holds a small button that toggles an `expanded` class on the panel. Its title reads "Expand log" or "Shrink log". When expanded, the panel stays anchored at the bottom right and grows wider and up to near the top of the screen, covering the contracts and info panels. Clicking again shrinks it. The state lasts for the session and is not saved. While a modal is open, the expanded log drops back to its normal size, so it never covers a modal. There is no hotkey.

**Easier to read.** This comes from the separated dim stamp, a little more room between lines, and a taller panel when expanded. Line colors and spans stay as they are.

Rejected approaches:
- Saving the log with the world. It would keep the history across loads, but it changes the saved shape and needs a migration, and the issue does not ask for it.
- Showing a day divider row with only `HH:MM` on each line. It is more compact, but the issue asks for day and time stamps, and the full label matches the HUD clock.
- A modal log window. Modals hide other panels and stop play, while an expanded panel keeps the game running beside it.

TDD: yes for `LogBook` (stamping, order, cap). It is deterministic, has no DOM and can regress. No for `LogPanel` DOM and CSS (no DOM in Vitest). A Playwright check in `tmp/` and `npm run playtest` cover those.

### Invariants
- IV1 — Every log line, from a sim event or a UI note, gets its stamp from `LogBook.add()` with `clockLabel(turn)`, and no `T<turn>` text appears in the log.
- IV2 — The history holds the newest `LOG_HISTORY` lines, newest first, and drops only the oldest.
- IV3 — When the line box is scrolled away from the top, adding lines leaves the same lines in view.
- IV4 — The log never covers an open modal, expanded or not, and `scripts/ui-playtest.mjs` keeps passing.
- IV5 — No change to `World`, sim code or the save shape.

### Principles
- PC1 — `clockLabel()` is the one formatter for game time in the log. The log does not get a third clock format next to `save-panel.ts`'s.

### Assumptions
- AS1 — 200 lines is enough history for "scrollable". The committee may pick another cap. It is one constant.
- AS2 — "Easier to read" is met by the separated stamp, the line spacing and the expanded view. The issue does not name a specific readability problem.
- AS3 — Expanded is a session-only view state, and the log stays newest first, as today.
- AS4 — Losing the history on reload is acceptable, since the issue does not ask for it and keeping it would change the saved shape.

### Unknowns
- UK1 — The exact expanded size at each breakpoint (1280x720, below 1100px, below 720px). Planning picks CSS values, and the screenshots in verify confirm them.

## Plan

Approach: first build the pure `LogBook` test-first, then move the log view out of `Hud` into `LogPanel` and add the expand button and CSS. The history and stamping logic is the part that can regress silently, so it gets Node tests. The view is checked in the browser.

### PH1 — LogBook history and day-time stamps (TDD)
- 1.1 `src/ui/log.test.ts` (create), written first and failing:
  - `add(turn, line)` stamps the line with `clockLabel(turn)`. Check turn 1 gives `Day 1 7:00`, and a turn past `TIME.turnsPerDay` gives day 2. Compare against `clockLabel()`, not a hand-written string, except one literal for turn 1.
  - The stamp is the first span, with class `log-time`. Plain lines become `[stamp span, { text, cls: line.cls }]`. Span lines keep their own spans after the stamp. `text` is `stamp + " " + line.text`.
  - Lines come back newest first.
  - After `LOG_HISTORY + 5` adds, `lines` holds `LOG_HISTORY` entries, and the newest and oldest are the expected ones (IV2).
  - No line's text matches `/^T\d+ /` (IV1).
- 1.2 `src/ui/log.ts` (create):
  - `export const LOG_HISTORY = 200;` (AS1)
  - `export class LogBook { add(turn: number, line: LogLine): LogLine; get lines(): readonly LogLine[] }`. `add` builds the stamped line, puts it first, trims to `LOG_HISTORY`, and returns the stamped line so the panel can prepend it. Imports `clockLabel` and `type LogLine` from `./format` (PC1).
  - Respects: IV1, IV2, IV5.
- Commit: `Log lines carry the game day and time and keep 200 lines of history`

### PH2 — LogPanel view, expand toggle and Hud wiring
- 2.1 `src/ui/log.ts` (modify), adding the DOM view next to `LogBook`:
  - `export class LogPanel { constructor(); add(turn: number, lines: LogLine[]): void }`. The constructor builds `panel("log")` with `aria-label="Event log"`, a header row (`h3` "Log" and a `button.log-expand` with title "Expand log"), and an empty `div.log-lines` (`tabindex 0`). The button toggles the `expanded` class and swaps its title to "Shrink log".
  - `add()` stamps each line through its `LogBook`, builds one `div` per line (the same span markup as `hud.ts:516`), and prepends them in order so the newest sits on top. If `scrollTop > 0` before the insert, it adds the line box's `scrollHeight` growth to `scrollTop` (IV3). It then removes DOM rows past `LOG_HISTORY` so the DOM matches the book.
  - Respects: IV3, AS3.
- 2.2 `src/ui/hud.ts` (modify):
  - Remove `LOG_LINES` (`:77`), `turnStamped()` (`:91-95`), `private log` (`:102`), `private lines` (`:118`), the log setup in the constructor (`:136-139`) and `renderLog()` (`:508-519`). Drop the now-unused `LogLine` import if nothing else uses it.
  - Add `private log = new LogPanel();` in the same field position, so the panel keeps its DOM order among the HUD panels.
  - `pushEvents(w)` (`:488-500`): collect the non-null lines from `eventText`, toast the unstamped `line.text` as today, then call `this.log.add(w.turn, lines)` once.
  - `note(w, text, cls)` (`:503-506`): `this.log.add(w.turn, [{ text, cls }])`. Both paths now stamp through `LogBook` (IV1).
- 2.3 `src/ui/style.css` (modify):
  - `#ui .log` (`:495-506`): no change to the collapsed size. `.log h3` (`:526-529`) sits in a flex header row with the expand button on the right, styled like the existing small HUD buttons.
  - `.log-lines > div` (`:535-537`): `padding: 3px 0` for a bit more line spacing (AS2). Add `.log-time` in `var(--muted)` and `var(--font-mono)` at 11px, with a small right margin.
  - Add `#ui .log.expanded`: `width: 420px; height: calc(100dvh - 112px - 72px); z-index` above the contracts and info panels. `.log.expanded .log-lines { max-height: calc(100% - 28px) }`. At `max-width: 1100px` keep 420px. At `max-width: 720px` use `width: calc(100vw - 28px)` and `height: calc(100dvh - 176px - 72px)` (UK1). The planned values are checked by screenshot in verify.
  - Next to the modal rules (`:816-825`), add `#ui:has(.modal:not([style*="display: none"])) > .log.expanded`, which resets width, height and `.log-lines` max-height to the collapsed values (IV4).
- 2.4 `docs/architecture/render.md` (modify): add one bullet saying `src/ui/log.ts` owns the event log. `LogBook` keeps 200 lines stamped with the HUD clock, `LogPanel` shows them newest first, keeps the reader's scroll place, expands from its header and shrinks back while a modal is open.
- Commit: `The log expands from its header and keeps the reader's place when new lines arrive`

### Test strategy
- PH1: `npm test` runs `src/ui/log.test.ts` (TDD, red first).
- PH2: `npm run typecheck`, `npm test`, then `npm run playtest` with the dev server. `scripts/ui-playtest.mjs` covers IV4 for the collapsed log.
- PH2 browser check, a Playwright script in `tmp/` on the real GPU (per `docs/tools.md#browser-checks`), at 1280x720 and 700x700:
  - Play turns until the log has more than 14 lines, and check it holds more than 14 rows and each row starts with a `.log-time` matching `/^Day \d+ \d+:\d\d$/`.
  - Scroll the line box down, play a turn that logs, and check the first visible row's text is unchanged (IV3).
  - Click the expand button: the panel gets taller and its title becomes "Shrink log". Open the inventory (`i`) while expanded, and check the log box does not overlap `.modal` (IV4). Click again to shrink it back.
  - Take screenshots of collapsed, expanded and expanded-with-modal, and look at them (UK1).
- IV5: `git diff --stat` shows no change under `src/sim/`, `src/three/save*` or `src/data/`, and `npm run save:shape` leaves `save-shape.json` unchanged.

### Order & dependencies
- PH2 uses `LogBook` from PH1, so PH1 goes first. Both phases touch `src/ui/log.ts`, so they run one after the other.

### Risks / rollback
- RK1 — The scroll keeping in `LogPanel.add()` can be off when lines wrap or fonts load late. The scroll check in the browser script catches it. Each phase is one commit, so a revert undoes it.
- RK2 — The expanded panel can cover the contracts or info panel the player wants to read. That is intended while expanded, and one click shrinks it. Committee may revisit (AS3).

## Verify

## Code smells
- `src/ui/save-panel.ts:18` — `clockText()` repeats the day and time formatting of `clockLabel()` in `src/ui/format.ts:500` with a different format (GPC8).

## Conclusion
### Deviations from plan
- PH1 and PH2 landed in one commit — the quality gate's fragmentation check rejected the new `src/ui/log.ts` alone (5.01 files per 1,000 code lines), and passes once `Hud` loses its log code in the same commit.
- `.log-lines` gets `overflow-anchor: none` — Chromium's scroll anchoring double-adjusted the scroll on prepend, so `LogPanel` keeps the place itself.
- The expanded rules apply only while no modal is open (`#ui:not(:has(.modal...))`) instead of a reset rule — it holds at every breakpoint.

### Checks
- `npm test` 2748 passed, `npm run typecheck` clean. No other failures found, so no extra fix commits.
- `tmp/log-check.mjs` passes at 1280x720 and 700x700: more than 14 rows, `Day N H:MM` stamps, scroll place kept, expand/shrink, no modal overlap. Playtest not run, as instructed.
### Hands-off decisions
- udesign: day and time in full on every line (`Day 2 14:32`) via `clockLabel()` — the issue's literal wording, and it matches the HUD clock.
- udesign: history cap of 200 lines — the request needs some cap, and one constant is easy to change (AS1).
- udesign: expand as a header button with no hotkey — inventing a key binding could clash with controls, and a button is easy to find.
- udesign: log history is not saved — saving it would change the save shape, which the issue does not ask for.
- udesign: newest-first order kept — it matches today's log and keeps the change small.
- uplan: plan auto-approved.
- uplan: `LogBook` and `LogPanel` share `src/ui/log.ts` — one log concern, and `dom.ts` is safe to import in Node tests.
- uplan: expanded size 420px wide and up to 72px from the top — the instruments and top-left panels set these edges, and the verify screenshots check them.
