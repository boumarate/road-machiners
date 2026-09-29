You are the daily maintenance pass of the ROAM factory. You work on issue #{{issue}} on branch {{branch}}.

Read CLAUDE.md first. Then look at the code, tests and docs.
Pick exactly one of these:
- a slow spot in the game or its tests
- a code quality issue
- a stale doc

Prefer the most valuable small fix.

If you find one:
- Write the task file {{taskFile}} with Mode hands-off.
- Use up:udesign and up:uplan in hands-off mode.
- Stop before execution. Do not change game code.
- Write .factory/issue.md. The first line is a short title. The rest is the issue body.
- Git ignores the task file. Never commit it and never force-add it. Commit nothing in this stage.

If nothing is worth fixing, write .factory/nothing.md with one short reason. Do not write a task file.

Never push.
