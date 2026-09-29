# Factory approval

Status: design
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: The committee gets a Telegram post per built task, and an approve merges it to dev while feedback sends it back to design.
Mode: interactive

## Context

- Part of the [game factory](game-factory.md). That task owns the stage flow and the contracts between parts.
- Hermes posts to the committee Telegram chat.
- The post has a screenshot of the core feature, the play link, the issue link, a short description and how to try it.
- An approve reply or button merges the task branch to `dev`.
- Feedback sends the card back to design with the feedback attached.
- Only committee members can approve. Their Telegram names live in `.env`.
- Merge and Telegram credentials stay out of the agent environment.

## Design
### Invariants
### Principles
### Assumptions
### Unknowns
## Plan
## Verify
## Code smells
## Conclusion
### Hands-off decisions
### Deferred (needs user input)
