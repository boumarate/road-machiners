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

Commit in phases on the current branch.
Never push.

If the work needs a major save format bump, stop.
Write what the committee must decide to `.factory/needs-committee.md`.
Do not commit a change to `SAVE_MAJOR`.
