# Game factory

The public files and votes on GitHub issues. Agents design and build the top ones. A human committee approves each result by playing it.

The design and its reasons are in [the factory task](../docs/tasks/game-factory.md).

## Flow

1. Intake marks an aged `feature-request` or `bug` issue with enough thumbs-up, or one from a committee member. It goes to the Design column of the GitHub Project.
2. Design runs Opus with the up design and plan skills. It writes `docs/tasks/issue-N.md` on branch `factory/issue-N`, or refuses the issue as "won't do".
3. Implementation runs Sonnet with the up execute skill.
4. Testing runs Sonnet with the up verify and review skills. Then the factory runs the tests and the CPU playtest itself, builds the branch and copies it to `/<hash>/`.
5. The committee chat gets a screenshot, the play link and how to try it. A reply "approve" merges the branch into `dev`, which redeploys to `/dev/`. Any other reply sends the task back to design.
6. Every `FACTORY_RELEASE_DAYS`, `dev` merges into `main` and ships to itch.io with `npm run itch`. The public channel gets the changelog.
7. Every `FACTORY_MAINTENANCE_HOURS`, Sonnet picks one slow spot, quality issue or stale doc and opens a task for it.
8. A committee message starting with `/change` asks for a change to the factory itself. The factory opens a pull request against `dev` that touches only `factory/`. It never merges it.

A failed or timed-out stage labels its issue `factory-stuck` and posts once to the committee chat. Remove the label to let the factory try again.

## Parts

- `src/` holds the Node CLI. `npm run factory -- tick` is the entry point. A timer runs it.
- `prompts/` holds the prompt of each agent stage.
- `docker/` holds the agent image. Agents get only their work clone and `CLAUDE_CODE_OAUTH_TOKEN`.
- `hermes/` holds the Hermes compose file, its config template and the plugin that queues committee replies into `$FACTORY_HOME/inbox` and edits the committee file.
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
- Make a GitHub Project for the repo. Its Status field needs the options Design, Implementation, Testing, Approval and Done. Put its owner and number in `.env`.
- The repo needs a `dev` branch.

## Tests

- `npx vitest run factory` runs the CLI tests.
- `uv run --with pytest pytest factory/hermes` runs the plugin tests.
- `cd factory/infra && uv run pytest` runs the infra helper tests.
