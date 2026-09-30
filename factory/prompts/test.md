This is the testing stage of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
Issue {{issue}} is built. Its plan is in {{taskFile}}.

Read CLAUDE.md first.
Follow it.

Run up:uverify and then up:ureview on {{taskFile}}.
Fix what they find.
Commit the fixes on the current branch.

This machine has no GPU and is slow. Keep checks focused.

Take a screenshot of the core feature.
Write a Playwright script in `tmp/`.
Launch Chromium without GPU flags.
Save the screenshot as `.factory/screenshot.png`.

Write `.factory/approval.json` with this shape.
`{"description": "...", "howToTry": "..."}`
The description is plain text about what changed, under 300 characters.
The howToTry text is the steps a committee member follows in the browser, under 400 characters.
They play the branch build from a link in the post, so start the steps from the loaded game, not from `npm run dev`.

The factory checks your branch after you finish.
It runs `npm test`, `npm run typecheck` and `npm run playtest -- --cpu` against the dev server.
Every test must pass, not only the tests for this issue.
Do not run the full suite or the playtest yourself.
Run the tests near your changes with `npx vitest run <files>`, and `npm run typecheck`.
If the factory's checks fail, you get one round to fix them, with the failure log in `.factory/check-failure.md`.

A failure blocks the task even when your change did not cause it.
Fix every failure you find, also ones already broken on `dev`.
Put each such fix in its own commit.
Name it in the task file under Conclusion.

A failing saved-shape test means the saved world changed without a migration step.
Follow Save migrations in CLAUDE.md.
Add the step, its fixture and its test, then run `npm run save:shape`.
Only a major save bump goes to the committee.

If the work needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.

Never push.
