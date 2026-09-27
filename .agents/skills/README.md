# Game design skills

Project-local skills for game interface design, visual direction, feedback, balance, and design critique. Pi discovers these directories in trusted projects at startup. Start a new session to refresh discovery, or read a skill's `SKILL.md` directly in an existing session.

## Use

- `game-ui-design` maps player decisions before layout, limits the HUD to decision-relevant information, rejects generic dashboard styling, and checks gameplay occlusion. Start here for interface work.
- `directing-game-visuals` defines visual hierarchy, palette roles, negative space, and feedback that does not depend on explanatory text.
- `maximizing-game-feel` chooses restrained, event-driven feedback appropriate to the game's tone.
- `stress-testing-game-concepts` challenges rules and player choices with concrete failure traces rather than unsupported judgments about fun.
- `evaluating-gameplay-balance` compares strategies through telemetry and separates exploit detection from human difficulty.

Example after discovery: `/skill:game-ui-design`.

## Sources and selection

Four skills come from [abagames/agentic-gamedev-skills](https://github.com/abagames/agentic-gamedev-skills). The interface skill comes from [Jeremy Longworth's AgentSkills](https://github.com/jeremylongworth-source/AgentSkills/tree/main/skills/game-ui-design). Each directory contains its upstream license and an `UPSTREAM.json` recording the source revision and downloaded file hashes. Local Markdown formatting may differ because the project formatter runs on imported files.

The [awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) pack was also considered. Its interface skill emphasizes layout engineering and engine integration. The selected skills address visual hierarchy and player decisions more directly. This is a focused selection, not either complete upstream collection.

## Boundaries

Project guidance and user-approved scope take precedence. These skills do not authorize paid services, extra agents, experiments, or game changes. Named companion skills outside this selection are not installed. The abagames references often target action mini-games. Do not import arcade scoring thresholds, constant animation, or cartoon effects into Korovan without a game-specific reason. Use the existing Three.js and simulation boundaries rather than adopting Godot examples.

For Korovan mockups, keep the map dominant, avoid persistent dashboard cards and repeated labels, and show secondary information on demand. Validate visual direction with the user before implementation. These skills provide design procedures, not proof of visual quality.
