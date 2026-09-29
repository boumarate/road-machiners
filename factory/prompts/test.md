This is the testing stage of the Korovan factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
Issue {{issue}} is built. Its plan is in {{taskFile}}.

Read CLAUDE.md first.
Follow it.

Run up:uverify and then up:ureview on {{taskFile}}.
Fix what they find.
Commit the fixes on the current branch.

Run the playtest with `npm run playtest -- --cpu`.
Never run it without `--cpu`.
This machine has no GPU.

Take a screenshot of the core feature.
Write a Playwright script in `tmp/`.
Launch Chromium without GPU flags.
Save the screenshot as `.factory/screenshot.png`.

Write `.factory/approval.json` with this shape.
`{"description": "...", "howToTry": "..."}`
The description is short plain text about what changed.
The howToTry text is the steps a committee member follows in the browser.

If the work needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.

Never push.
