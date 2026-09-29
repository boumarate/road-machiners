# Game factory

The public files and votes on GitHub issues. Agents design and build the top ones. A human committee approves each result by playing it.

The design and its reasons are in [the factory task](../docs/tasks/game-factory.md).

## Flow

1. Intake marks an aged `feature-request` or `bug` issue with enough thumbs-up, or one from a committee member. It goes to the Triage column of the GitHub Project.
2. Triage runs Sonnet in the agent container. It scores the issue on a clear goal, a checkable result, a scope of one task and a fit with DESIGN.md. It writes `.factory/triage.json`. `ready` moves the card to Design. `wont-do` comments the reason, labels the issue `wont-do`, closes it and moves the card to Done. `unclear` comments up to three questions for the author, labels the issue `needs-info` and leaves the card in Triage. The tick skips a `needs-info` issue until someone answers on GitHub. Then triage runs again with the answers.
3. Design runs Opus with the up design and plan skills. It writes `docs/tasks/issue-N.md` on branch `factory/issue-N`, or refuses the issue as "won't do". For a real blocker it writes `.factory/questions.md` instead, and the card goes back to Triage with those questions.
4. Implementation runs Sonnet with the up execute skill.
5. Testing runs Sonnet with the up verify and review skills. Then the factory runs the tests and the CPU playtest itself, builds the branch and copies it to `/<hash>/`.
6. Testing opens a pull request against `dev`, or reuses the open one. The committee chat gets a screenshot, the play link, the pull request link and how to try it. The post has Approve and Deny buttons. Approve merges the branch into `dev`, which redeploys to `/dev/`. Deny labels the issue `wont-do` and closes it and the pull request as not planned. A reply to the post sends the task back to design with the reply as feedback.
7. Every `FACTORY_RELEASE_DAYS`, `dev` merges into `main` and ships to itch.io with `npm run itch`. The public channel gets the changelog.
8. Every `FACTORY_MAINTENANCE_HOURS`, Sonnet picks one slow spot, quality issue or stale doc and opens a task for it.
9. A committee message starting with `/change` asks for a change to the factory itself. The factory opens a pull request against `dev` that touches only `factory/`. It never merges it.
10. A committee member can ask Hermes for one-off work, like "simulate 10 battles and tell me if the MG is too weak". The factory opens an `adhoc` issue and runs Sonnet in a fresh clone of `dev`. It may run any repo harness, pushes nothing, and answers the member's message with a report.

A failed or timed-out stage labels its issue `factory-stuck` and posts once to the committee chat. Remove the label to let the factory try again.

## Parts

- `src/` holds the Node CLI. `npm run factory -- tick` is the entry point. A timer runs it.
- `prompts/` holds the prompt of each agent stage.
- `docker/` holds the agent image. Agents get only their work clone and `CLAUDE_CODE_OAUTH_TOKEN`.
- `hermes/` holds the Hermes compose file, its config template, its identity in `SOUL.md` and the plugin that queues committee replies into `$FACTORY_HOME/inbox` and edits the committee file.
- `infra/` deploys the server with pyinfra. See [infra/README.md](infra/README.md).
- `mac/` runs the factory on a Mac. See [mac/README.md](mac/README.md).

## Committee

- The committee is a whitelist in `$FACTORY_HOME/committee/committee.json`. Each member has a Telegram id, a GitHub login and a name.
- Until that file exists, the committee is one member from `FACTORY_COMMITTEE_BOOTSTRAP` and `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` in `.env`.
- Members manage the list in the chat with `/committee list`, `/committee add`, `/committee remove` and `/committee github`. The Hermes plugin writes the file. The factory reads it on every tick and every command.
- The bot answers committee members only.

## GitHub setup

- The host needs `gh` logged in with the `repo` and `project` scopes. Run `gh auth setup-git` so git pushes with it.
- The host needs a git identity, since approvals make merge commits.
- Make a GitHub Project for the repo. Its Status field needs the options Triage, Design, Implementation, Testing, Approval and Done. Put its owner and number in `.env`.
- The repo needs a `dev` branch.

## Tests

- `npx vitest run factory` runs the CLI tests.
- `uv run --with pytest pytest factory/hermes` runs the plugin tests.
- `cd factory/infra && uv run pytest` runs the infra helper tests.
