# Game factory

The public files and votes on GitHub issues. Agents design and build the top ones. A human committee approves each result by playing it.

Run every command in this file from `factory/`, unless it says otherwise. The factory reads its settings from `factory/.env`. Copy `.env.example` to `.env` first.

The design and its reasons are in [the factory task](docs/tasks/game-factory.md).

## Flow

1. Intake marks an aged `feature-request` or `bug` issue with enough thumbs-up, or one from a committee member. It goes to the Triage column of the GitHub Project.
2. Triage runs Sonnet in the agent container. It scores the issue on a clear goal, a checkable result, a scope of one task and a fit with DESIGN.md. It writes `.factory/triage.json`. `ready` moves the card to Design. `wont-do` comments the reason, labels the issue `wont-do`, closes it and moves the card to Done. `unclear` comments up to three questions for the author, labels the issue `needs-info` and leaves the card in Triage. The tick skips a `needs-info` issue until someone answers on GitHub. Then triage runs again with the answers.
3. Design runs Opus with the up design and plan skills. It writes `docs/tasks/issue-N.md` on branch `factory/issue-N`, or refuses the issue as "won't do". For a real blocker it writes `.factory/questions.md` instead, and the card goes back to Triage with those questions.
4. Implementation runs Sonnet with the up execute skill.
5. Testing first merges the current `dev` into the issue branch, so the build matches what approve will merge. On a conflict the agent resolves it, and a merge left unfinished fails the stage. Then testing runs Sonnet with the up verify and review skills. Then the factory runs the tests and the CPU playtest itself, builds the branch and copies it to `/<hash>/`. The state file records the build of each issue.
6. Testing opens a pull request against `dev`, or reuses the open one. The committee chat gets a screenshot, the play link, the pull request link and how to try it. The post has Approve and Deny buttons. Approve merges the branch into `dev`, which redeploys to `/dev/`. The issue stays open with the label `release-candidate` until its release ships. Deny labels the issue `wont-do` and closes it and the pull request as not planned. A reply to the post sends the task back to design with the reply as feedback.
7. Every `FACTORY_RELEASE_DAYS`, the factory cuts branch `release/<day>` from `dev`. It opens a tracking issue with the label `release` and two cleanup issues, one for optimization and one for code janitor work. They carry the labels `release-task` and `maintenance`. Release tasks run the normal stages against the release branch. Cleanup tasks merge into it without a committee post.
8. When no release task is open, the factory builds the release candidate at `/rc/`. The committee chat gets a screenshot, the play link, the pull request, the notes and the feature list, with a Ship button. A reply `remove #N` takes feature N out of the release and `dev`, and reopens its issue. Any other reply opens a new `release-task` issue with the reply as its body. Both make a new candidate later.
9. `ship`, as a reply or the Ship button, merges the release branch into `main` and ships to itch.io. It works only on the current candidate post and only when no release task is open. The factory builds a fresh clone of `main` in the agent container with an empty save scope, then runs `butler push` on the host. Only that call gets `BUTLER_API_KEY`. The public channel gets the changelog, and so does a GitHub release tagged `release-<day>` on `main`. Each shipped issue loses `release-candidate` and closes. Then `main` merges back into `dev`.
10. A committee message starting with `/change` asks for a change to the factory itself. The factory opens a pull request against `dev` that touches only `factory/`. It never merges it.
11. A committee member can ask Hermes for one-off work, like "simulate 10 battles and tell me if the MG is too weak". The factory opens an `adhoc` issue and runs Sonnet in a fresh clone of `dev`. It may run any repo harness, pushes nothing, and answers the member's message with a report.

Every tick, after intake, the factory deletes each folder in the web root except `dev` and the builds of cards now in Approval.

When `dev` on GitHub moves past the commit `/dev/` serves, the next free tick rebuilds `/dev/`. So a merge made outside the factory also reaches the dev link. A failed build records its commit in `devFailed` in the state file. The tick skips that commit until `dev` moves again, and Hermes gets the incident.

The factory starts at most `FACTORY_MAX_JOBS_PER_DAY` public-driven jobs in any 24 hours. Triage, design, implementation, testing and the release cut count. Approve, change and ad hoc jobs do not. The first time the cap blocks work, the committee chat gets one notice with the count and the time the next slot frees.

Triage, design, implementation and testing each comment on their issue when they finish or fail, with the time they took.

A failed or timed-out stage labels its issue `factory-stuck` and posts once to the committee chat. A stuck release step labels the tracking issue. Removing the label lets the factory try again.

Hermes manages the factory. A watch job wakes it when an issue gets stuck or the tick crashes. It reads the logs, the state and the chat, then fixes the incident or asks the committee. It has a shell with `gh`, `git` and `jq` as the bot account, and it can edit the factory home. While it edits state, it pauses the factory with the file `$FACTORY_HOME/paused`, and every tick skips.

## Parts

- `src/` holds the Node CLI. `npm run factory -- tick` is the entry point. Run `npm ci` in `factory/` first. A timer runs it.
- `prompts/` holds the prompt of each agent stage.
- `docker/` holds the agent image with Blender and ffmpeg. Agents get their work clone, `CLAUDE_CODE_OAUTH_TOKEN` and `ELEVENLABS_API_KEY` with `SFX_MAX_GENERATIONS`, so they can generate sounds.
- `hermes/` holds the Hermes compose file, its config template, its identity in `SOUL.md`, the incident watch script, the `factory-host` ssh command for the server and the plugin that queues committee replies into `$FACTORY_HOME/inbox` and edits the committee file.
- `infra/` deploys the server with pyinfra. See [infra/README.md](infra/README.md).
- `mac/` runs the factory on a Mac. See [mac/README.md](mac/README.md).

## Committee

- The committee is a whitelist in `$FACTORY_HOME/committee/committee.json`. Each member has a Telegram id, a GitHub login and a name.
- Until that file exists, the committee is one member from `FACTORY_COMMITTEE_BOOTSTRAP` and `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` in `factory/.env`.
- Members manage the list in the chat with `/committee list`, `/committee add`, `/committee remove` and `/committee github`. The Hermes plugin writes the file. The factory reads it on every tick and every command.
- The bot answers committee members only.

## GitHub setup

- The host needs `gh` logged in with the `repo`, `project` and `read:org` scopes. `gh project` needs `read:org` even for a user's Project. Run `gh auth setup-git` so git pushes with it.
- The host needs a git identity, since approvals make merge commits.
- Make a GitHub Project for the repo. Its Status field needs the options Triage, Design, Implementation, Testing, Approval and Done. Put its owner and number in `factory/.env`.
- The repo needs a `dev` branch.

## Tests

- `npm test` runs the CLI tests.
- `uv run --with pytest pytest hermes` runs the plugin tests.
- `cd infra && uv run pytest` runs the infra helper tests.
