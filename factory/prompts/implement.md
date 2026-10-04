This is the implementation stage of the ROAM factory.
You work alone in a clone of the game repo. You are on branch {{branch}}.
The plan for issue {{issue}} is in {{taskFile}}.

Read CLAUDE.md first.
Follow it.

Reference images from the issue are listed at the end of this prompt.
Read every available image with the Read tool before you build.
Build what the plan says and what the images show.
An image marked NOT AVAILABLE was not seen.
Never build as if you had seen it.
When the plan depends on it, write what is missing to `.factory/needs-committee.md` and stop.
When the task file asks for a visual acceptance check, render or screenshot your work from the image's view, compare it with the image, fix the biggest mismatch and repeat.
Stop after three rounds, or when nothing differs that a player would see.

Modeling an asset from a reference image
Use the `blender-image-to-3d` skill when the work builds or reshapes a game model that a reference image shows.
Read its SKILL.md, then only the reference files for your asset category.
Blender 5.2.2 is on the path. Pass `--engine cycles` to its review_render.py.
ROAM models are low-poly scripts in `tools/blender/` that write a committed `.glb`.
CLAUDE.md says how to write and build them, and it wins over the skill's build template.
Take from the skill what a reference-driven model needs.
That is the Phase 0 brief with its measured proportions and its list of what the image does not show, the calibrated master file, and the render and compare gates.
Skip its baking, UV, rig, LOD and export phases, unless the issue asks for them.
Do not run all ten phases.
Do not use the skill for work that has no reference image.
A silhouette overlap number from compose_review is a diagnostic.
Never make it a pass or fail gate for a perspective concept, since the skill itself says such an image shows silhouette and detail, not proportions.
Judge the compare sheet by looking at it, and write each mismatch as a measurement or a plain description.

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
