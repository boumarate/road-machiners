This is the implementation stage of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
The plan for issue {{issue}} is in {{taskFile}}.

Read CLAUDE.md first.
Follow it.

Install the hooks first.
Run `npm ci && npm run hooks:install`.
The quality hook checks every commit.
Do not bypass it.
Do not add suppressions.
Do not raise its limits.

Run up:uexecute on {{taskFile}}.
Then stop.
Do not run up:uverify.
The next stage does that.

This machine is slow. Keep checks focused.
While you work, run only the tests near your change with `npx vitest run <files>`.
Prove the feature works with a targeted test, or a short Playwright check of that one behavior.
Do not run the playtest. The testing stage and the factory run it.
Before you finish, run `npm test` and `npm run typecheck` once.
Every test must pass, not only the tests for this issue.

A failure blocks the task even when your change did not cause it.
Fix every failure you find, also ones already broken on `dev`.
Put each such fix in its own commit.
Name it in the task file under Conclusion.

A failing saved-shape test means the saved world changed without a migration step.
Follow Save migrations in CLAUDE.md.
Add the step, its fixture and its test, then run `npm run save:shape`.
Only a major save bump goes to the committee.

Commit in phases on the current branch.
Never push.

If the work needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.
Do not commit a change to `SAVE_MAJOR`.
