# Social radio and dialogue

**Status:** planning
**Branch:** social
**Worktree:** .worktrees/social
**Goal:** All player and NPC talk runs through one dialogue system, where new talk is a new topic in data. In the browser, the player calls a truck in sight and gets directions to a town, honks and hears friendly trucks honk back, patches a stranded NPC and gets patched, and receives a tow offer and a raider demand as dialogues. The user confirms the loop in play.
**Mode:** interactive

## Context

- This branch starts from `defeat-rescue`. That task still has PH4b, the road lanes, and PH5, the game loop, HUD and saves, open. PH4b finishes on `defeat-rescue` first and merges in here.
- The tow offer in `src/sim/tow.ts` is the only social act. The tower drives up to the stranded player, then the offer sits in `world.player.tow` with no UI yet.
- `NpcBrain.refusedTow` stops a driver from offering a tow twice. No other per-driver memory of the player exists.
- The only way to act on another truck is to click it, which aims weapons at it. Hovering shows an info card.
- A stranded NPC has no special behavior. With a broken engine it keeps its activity and crawls at limp speed.
- Field repair in `src/sim/repair.ts` spends the truck's own spare parts, the `parts` good, to restore one part up to a field cap. Only the player uses it.
- Raiders attack any truck with loot on sight. They never talk first.
- `world.player.discovered` lists the sites the player has seen.
- No horn or radio sound exists in `public/sfx/`.
- Keys T and H are free. Keys 1 to 4 select weapons.

## Design

A dialogue system for all talk between the player and NPCs, in the style of Space Rangers 2 hails. Content plugs in as topics. Deals that outlive the call, like a tow or a patch, run as agreements. The first content is directions, patching, the tow and the raider demand.

### Calls

- A call joins the player and one NPC. Every truck has a radio, and radio works in sight only. The caller must see the other truck.
- The player calls a hovered truck in sight with T. An NPC calls the player when one of its topics fires.
- One call is open at a time, in `world.player.call`. It holds the NPC, the current topic and node, and the call values.
- The dialogue panel opens at once, and turns wait until the call ends. Auto turns wait too.
- A knocked-out player gets no calls.
- Each line goes to the HUD log, so the log is the backlog.

### Topics

A topic is the unit of content. Adding talk means adding a topic in `src/data/dialogue.ts`. A topic has:

- An id.
- An ask rule: the menu text and conditions under which the player can raise it with this NPC.
- An optional raise rule: conditions under which an NPC calls the player with it, and a priority among topics.
- A prepare step: a named function that fills the call values on entry, like a fee, a town or a rolled deal.
- A flag `once`. A driver raises or answers a `once` topic with the player at most once.
- A hang-up effect, run when the player ends the call inside the topic.
- Its nodes.

A player call opens on the hub. The hub lists every topic whose ask rule holds, plus Hang up. An NPC call opens directly on the raising topic's first node.

Who answers what is data. Each NPC class lists the topics it can take part in. A truck with a grudge against the player refuses every call.

### Nodes

- A node has the NPC's line and a list of player options.
- An option has text, optional conditions, optional effects, and a target: a node in the topic, the hub, or the end.
- Lines and option texts are templates filled from the call values. The sim stores raw values, and the UI formats units.
- Conditions and effects are named functions in `src/sim/dialogue.ts`. Data refers to them by name, and TypeScript checks the names.
- Effects run inside the command that picked the option, so every change goes through `update()`.

### Agreements

An agreement is a deal between two trucks that plays out over turns after the call. It lives in `world.agreements`.

- It has a kind, a provider, a client, terms and a state: agreed, working, done or cancelled.
- The terms hold the price, the parts to spend and the destination.
- Each kind supplies three functions: how the provider moves, how the work runs, and when it completes.
- The provider carries it out as an NPC activity. When the player is the provider, the player drives and a job runs on the player's truck.
- One function settles every agreement. Money and parts move once, on completion. The client pays into debt when it is the player. An NPC client must hold the money when the deal is made.
- An agreement is cancelled for free when a party leaves the world, the provider enters danger, or a party breaks off the work.

The tow becomes the first agreement kind. `world.player.tow` and its offer state fold into it. The towing itself stays as it is.

### Deals and memory

- Where a topic offers terms, its prepare step rolls them once with the world RNG from weights in data. Only terms both trucks can afford take part in the roll. Traits and reputation will replace these weights later.
- `NpcBrain.talked` replaces `refusedTow`. It maps each topic a driver has raised or answered to its outcome: agreed, refused or done. `once` topics read it, and reputation can read it later.

### First topics

- Directions. Traders and scavengers name the nearest town their class knows, with direction and distance. The town joins `world.player.discovered`. It is not `once`.
- Patch. It restores the parts that strand a truck, the engine and the transmission, to `SOCIAL.patchShare` of max HP. It uses the repair math in `src/sim/repair.ts` with the patcher's Mechanics skill. The rolled deal is one of three:
  - Paid: the patcher spends its own parts, and the client pays their town value plus a labor fee.
  - Own parts: the client's parts are spent, and the client pays the labor fee.
  - Free: the patcher spends its own parts for nothing.
- The player asks a trader or scavenger for a patch when stranded. A trader or scavenger stranded by a broken engine or transmission raises it with the player. Traders and scavengers spawn with some spare parts.
- Tow. A trader or scavenger raises it when it sees the stranded player. A stranded player can ask for it. Accepting creates a tow agreement, and the tower drives over and hitches.
- Demand. A raider that would start a fight with the player raises it when the player carries goods or spare parts. Handing over moves them into a stock at the player's truck. The raider and its faction mates within `SPAWN.neighborHelp` get a truce with the player for `SOCIAL.truceTurns`, and they go search the stock. Refusing or hanging up starts the fight. A grudge ends the truce as usual.
- Brush-off. A raider called without a demand answers "Get lost" and ends the call.

### Honk

A honk is a signal, not a call. H honks, as a command that ends no turn. Every NPC within `SOCIAL.honkRange` whose class honks back and that is not hostile honks back. Each honk plays a positional horn sound and writes a log line.

### Remaining defeat-rescue work

Defeat-rescue PH5 moves here: auto turns with `VITE_AUTO_TURN_MS`, the knocked-out banner, the Unhitch button, debt display, the death screen, the save migration and the DESIGN.md update. The dialogue panel replaces the planned tow offer panel. Saves go to version 8, and the version 7 migration also sets the call, agreements, `talked` and truce fields. The tow code on this branch has never shipped, so it changes without compatibility.

### Out of scope

- Traits, reputation and favor toward the player. They need a persistent pool of named NPCs who come back, as in Space Rangers 2, so favor is not lost when a driver dies.
- NPC to NPC talk, honks and agreements.
- Honks revealing the player to raiders.
- Trade, fuel sales and jobs by radio.
- Face-to-face talk in towns.

TDD: yes. Each rule is a sim rule with a Vitest test. The panel and keys get a Playwright check.

### Invariants

- IV1 — `endTurn()` throws while a call is open, and `autoRuns()` is false.
- IV2 — A call opens only when the caller sees the other truck, the player is active, and no call is open.
- IV3 — Every option target exists, every node is reachable from its topic's start, and every condition and effect name resolves. A test walks all topics.
- IV4 — An agreement settles once, on completion. Its parts are never lost or duplicated.
- IV5 — A driver raises or answers a `once` topic with the player at most once.
- IV6 — A raider in truce is never hostile to the player unless a grudge exists.
- IV7 — Dialogue effects change the world only inside `update()` or `playerCommand()`.
- IV8 — A world with an open call and live agreements saves and loads intact.
- IV9 — Two trucks hold at most one live agreement of each kind.

### Principles

- PC1 — Topic data holds text and structure. All logic lives in named conditions, effects and prepare steps.
- PC2 — A new topic or agreement kind needs no change to the call, hub or settlement code.
- PC3 — NPC decisions to raise a topic or carry out an agreement are NPC activities in `src/sim/npc-activities.ts`.

### Assumptions

- AS1 — Sight radius brings trucks close enough that calls happen often on roads, even with sight halved at night.
- AS2 — NPC engines break from wear often enough that patch requests appear in normal play.

### Unknowns

- UK1 — Where the horn and radio call sounds come from: user files, or `npm run sfx:gen`, which costs credits.
- UK2 — How a stranded NPC client pauses its activity to wait for its provider, and when it gives up.
- UK3 — Whether the provider-moves, work and completion split fits both tow and patch without special cases.
