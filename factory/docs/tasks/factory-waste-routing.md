# Cheap rework, a free test slot and a weekly waste review

**Status:** planning
**Branch:** factory/waste-routing
**Worktree:** .worktrees/waste-routing
**Goal:** A small approval reply reaches the committee again in under 30 minutes, on Sonnet, with every machine check passed. A card waits at most one machine check run for the test slot. Once a week the committee gets one named bottleneck with its numbers and one proposed factory change it can queue with a button. Confirming it needs a live week on the server: one answered reply, one patch, one redesign and one weekly review post.
**Mode:** interactive

## Context

The numbers come from the server logs of 2026-09-29 to 2026-10-03.

- Any reply to an approval post except "approve" is feedback. The plugin regex in `hermes/plugin/__init__.py` `_request` decides this, and the Hermes LLM never sees the reply. `feedback()` in `src/stages/approval.ts` moves the card to Design.
- On #131 a reply asked for an atlas the build already had, plus a tentative view preference. It ran design, implementation and testing again. Implementation and testing ran on Opus, since the `implementation-opus` label from triage stays on the issue.
- 73 cards waited 58 hours in total between the end of implementation and the start of testing. The median wait was 19 min, p75 86 min, and #131 waited the longest at 193 min.
- The machine checks are short. The medians are 2.6 min for tests and typecheck, 1.5 min for playtest and 0.1 min for build.
- The testing job holds its slot during agent work. #131's first run held it 87 min: agent 17 min, tests failed, fix agent 47 min on Opus, checks 13 min. 11 of 88 check runs failed.
- 23 issues ran testing two or more times. The logs keep no record of why a stage ran again.
- Agent cost and run time sit only in the `result` event of each agent transcript. Queue wait and the cause of a run are recorded nowhere.
- `main` already runs two test workers since `17dce6bd`. Most of the data above is from before that.

## Design

Three parts. Hermes routes every approval reply. The test slot runs only machine checks. A ledger feeds a weekly waste review.

### Reply routing

- The plugin stops turning an approval reply into feedback. The words "approve", "patch" and "redesign" stay fixed commands. Every other reply goes to the Hermes LLM with the issue number and the post it answers.
- Hermes calls one new tool, `factory_route_reply`, with the issue, the route and the text. There are three routes.
- answer: no card moves. Hermes replies in the chat. It may link files from the posted build, which the build URL already serves.
- patch: the change keeps the plan. Examples are a constant, a copy fix, a look tweak or a missing view in the evidence.
- redesign: the plan changes. This is the current path to Design.
- When a reply holds both a question and a change, Hermes answers the question and asks whether to patch. It does not guess a route for a tentative wish like "most likely we want".
- The factory comments the route and the reply on the issue under the feedback heading, with a line that names the route. The post status line names the route too. A member who disagrees replies "patch" or "redesign" to the same post, and that wins.

### Patch

- A patch is a new card stage, `patch`, in the agent queue. Its card sits in Implementation.
- One agent run on the build model does all of it. It merges the base, applies the feedback, checks only the diff since the last posted build, updates the task file Conclusion and captures evidence for the changed views.
- The model of a patch ignores `implementation-opus`. That label judged the first build of the whole issue.
- Then the card goes to Checks as usual. A patch never skips the machine checks.
- A patch that finds the plan must change writes `.factory/needs-redesign.md` and stops. The card then goes to Design with that file as feedback. The patch agent never redesigns by itself.

### Checks own the test slot

- Testing splits in two stages. Verify runs in the agent queue: base merge, conflict resolution, up:uverify, up:ureview and evidence. Checks runs in the test queue: tests, typecheck, playtest, build, publish and the post.
- A failed check sends the card back to Verify with `check-failure.md`, as the fix round does today. The fix agent then runs in the agent queue and frees the test slot. The second failure still stops the card.
- The board keeps its columns. Verify and Checks both show as Testing.

### Ledger

- Every job appends one line to `$FACTORY_HOME/ledger.jsonl` when it ends: job id, stage, issue, model, cause, queued at, started at, ended at, outcome, and agent cost and minutes summed from the `result` events of its transcripts.
- The cause is one of: first, feedback-patch, feedback-redesign, conflict, check-fix, retry, resume.
- The line is written under the state lock with an append, so a crash loses at most the line of the crashing job.

### Weekly waste review

- Every `FACTORY_REVIEW_DAYS`, the tick starts a review job in the agent queue. It does not count toward the daily cap.
- A script, `factory review-numbers`, reads the ledger of the period. It writes the queue wait per queue, the cost and minutes per stage and model, the runs per issue by cause, and the five most expensive issues. Every number in the post comes from it.
- A Sonnet agent reads those numbers, the issue histories of the top five and the chat. It names one bottleneck and proposes one factory change in a short brief.
- The post goes to the committee chat with a "Queue as change" button. The button queues the brief as a `/change` request, so a member still merges the pull request.
- When nothing stands out, the post says so in one line.

### Approaches considered

- Chosen: Hermes routes, since it already reads the chat, the issue and the state, and a member can override it with one word.
- A size label from triage on the whole issue was rejected. #131 shows that the reply decides the size, not the issue.
- Skipping testing for patches was rejected. The machine checks are short, and a patch with broken tests must not reach the committee.
- More test workers alone were rejected. The test machine needs the most memory, and the wait comes from agents holding the slot.

TDD: yes for the plugin routing, the patch and verify stage flow, the ledger line and the review numbers. No for the prompts and Hermes's judgment, which the live week checks.

### Invariants

- IV1 — Every build posted for approval passed the full machine checks on its final commit.
- IV2 — A test queue job runs no agent.
- IV3 — A member's "patch" or "redesign" reply overrides Hermes's route for that reply.
- IV4 — Every route lands on the issue as a comment with the route and the reply text.
- IV5 — Every job that ends writes exactly one ledger line, failures and timeouts included.
- IV6 — Every number in the review post comes from the review script, never from the agent.
- IV7 — The review never changes the factory itself. Only a member's merge of a `/change` pull request does.

### Assumptions

- AS1 — Hermes's model can tell a question from a small change from a new plan in a one-line reply. The live week checks it, and IV3 bounds a miss.
- AS2 — The Verify agent's browser screenshots fit in agent queue memory beside other agents. Today only the test queue runs a browser and a build at the same time.
- AS3 — The `result` event of each agent run holds `total_cost_usd` and `duration_ms`, as in the transcripts on the server today.

### Unknowns

- UK1 — How much memory the Verify screenshots take. If AS2 fails, evidence capture moves into Checks and runs as a script the agent wrote.
- UK2 — Whether a patch needs its own time limit, below `FACTORY_STAGE_TIMEOUT_MINUTES`.
- UK3 — Whether the review should also cover release candidate replies, which already route by fixed words.
