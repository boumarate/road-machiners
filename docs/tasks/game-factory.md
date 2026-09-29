# Game factory

Status: design
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: A public issue with enough votes moves through design, build, deploy and committee approval to `dev` with no human action but the approval, and a periodic release ships `dev` to itch.io.
Mode: interactive

## Context

- This task owns the stage flow and the contracts between the part tasks. Each part is its own up:make task.
- Parts: [intake](factory-intake.md), [design stage](factory-design-stage.md), [build stage](factory-build-stage.md), [hosting](factory-hosting.md), [approval](factory-approval.md), [release](factory-release.md), [maintenance](factory-maintenance.md), [factory chat](factory-chat.md), [CPU playtest](playtest-cpu-mode.md).
- The game stays at the repo root. All factory code, prompts and config go in `factory/`.
- Tunable numbers go in `.env` and `.env.example`. Examples are vote thresholds, aging time, committee members and the release period.
- Hermes Agent is the orchestrator. It polls GitHub, moves tasks between stages, runs cron jobs and talks to Telegram.
- Hermes runs the agents as Claude Code in headless mode, since the up skills exist only there.
- Opus 5.5 runs design. Sonnet 5.5 runs build, testing and maintenance.
- Agents use the user's Claude subscription OAuth token. The user accepts that hostile issue text could leak it. The exposure is the subscription.
- Everything runs on one CPU server the user provides. The browser draws in software there, at 10 to 20 fps.
- Votes can be faked, and issue text may carry hostile instructions. The user accepts this.
- The coding agent holds no secrets but the OAuth token. Deploy, merge and Telegram run in a separate step with their own credentials.
- No `dev` branch exists yet. Create it from `main`.
- The server domain is not chosen yet. Assume one will exist, and keep it in `.env`.

## Design

Draft for udesign to confirm.

Stage flow:

1. Intake marks an issue and adds it to the kanban column design.
2. Design writes the task file and plan, or answers "won't do" on the issue and closes the card.
3. Build implements on the task branch, runs tests and the CPU playtest, and pushes.
4. Hosting deploys the branch build to `/{hash}`.
5. Approval posts to the committee chat. Approve merges to `dev`. Feedback sends the card back to design with the feedback attached.
6. Hosting redeploys `dev` to `/dev` after each merge.
7. Release runs every configured number of days. It merges `dev` to `main`, runs `npm run itch` and posts to the public channel.

Contracts to fix here:

- The kanban column is the only stage state. Each stage reads its column and moves the card on success.
- One task branch per issue, with one name rule.
- One task file per issue in `docs/tasks/`, with one name rule. Design writes it. Build reads it.
- The feedback format a card carries back to design.
- The fail signal every stage emits, and the one committee post it becomes.
- Which step holds which credential.

### Invariants

- A stage that fails or stalls posts to the committee chat and stops. Nothing retries forever.
- Agents never merge, deploy or post to Telegram.
- Agents follow CLAUDE.md, the quality hook and the save migration rules.
- A major save bump stops the task and asks the committee.
- Nothing is fast. Slow is fine.

### Principles
### Assumptions
### Unknowns

- The server domain.
- How long a stage may run before it counts as stalled.

## Plan
## Verify
## Code smells
## Conclusion
### Hands-off decisions
### Deferred (needs user input)
