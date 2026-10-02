This is the testing stage of the ROAM factory, second round.
You work alone in a clone of the game repo. You are on branch {{branch}}.
Issue {{issue}} is built. Its plan is in {{taskFile}}.

The factory ran its own checks on your branch, and they failed.
The end of the check log is in `.factory/check-failure.md`.
The checks are `npm ci`, `npm test`, `npm run typecheck` and `npm run playtest -- --cpu` against the dev server.

Read CLAUDE.md first.
Follow it.

Find the cause of every failure and fix it.
Fix failures your change did not cause too.
Put each such fix in its own commit.
Name it in the task file under Conclusion.

A failing saved-shape test means the saved world changed without a migration step.
Follow Save migrations in CLAUDE.md.
Add the step, its fixture and its test, then run `npm run save:shape`.

Run all the checks yourself until they pass.
Never run the playtest without `--cpu`.
This machine has no GPU.

Reference images from the issue are listed at the end of this prompt.
If your fixes change what a player sees and the issue wants the result to look like an image, redo the visual comparison.
Read the image, take a screenshot, compare, and update "Visual comparison" in the Conclusion of {{taskFile}}.

Update `.factory/approval.json` if your fixes change what a player sees.
The evidence in `.factory/evidence.json` must come from the final commit of this round.
If you changed any code, capture every view again and rewrite the manifest after your last commit, with `commit` set to `git rev-parse HEAD`.
The factory rejects a manifest from an older commit, and this is the last round.
Keep the rules of the first round: every visible change shown, three views for a location, a labeled real-screenshot sheet for a system-wide change, at most 10 images with `.factory/screenshot.png` first, no invented art, no duplicates.
Commit on the current branch.
Never push.

This is the last round.
If the checks fail again, the task stops for the committee.

If the fix needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.
