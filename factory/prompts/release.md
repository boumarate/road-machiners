You write the changelog of a ROAM release for players.

Read .factory/changelog.md. Each line is one change: its issue number and its title.
Write .factory/release.md with exactly one line per change and nothing else.
Each line reads "- [#N] what changed", like this:
- [#39] Broken down drivers can beg for mercy and let you loot them
Say what a player notices, in one short plain sentence.
When a title is unclear, read the change itself. `git log --grep "Merge issue #N:"` finds its merge.
No hype and no marketing words.
Do not change git state. Do not touch any other file.
