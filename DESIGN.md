# Korovan design

A post-apocalyptic wasteland RPG where you drive a truck. 3D world seen from an isometric camera. Turn-based, like Space Rangers 2. Inspired by Ex Machina, Space Rangers 2, Kenshi, Dustland Delivery, Caravaneer 2, Convoy.

## Character

The character has stats and skills. These are the durable upgrades that persist across trucks.

Personal items grant special abilities and modifiers. They stay with the character, not the truck.

## Truck

The truck is equipment. It can be changed, upgraded, and destroyed.

Each truck has an inventory grid, in the style of Dredge. Parts and goods all take cells, and the player arranges them by dragging and rotating.

The grid is a top view of the truck with the nose up. Each chassis marks some cells as mounts for weapons, engines or cargo parts. Armor mounts sit on the front, back, left and right edges, and plates and rams go on any side. A part works only while it lies fully on mounts of its own kind. Built-in parts sit on fixed cells: the cab, transmission, four wheels and fuel tank. They can be repaired but not removed. Empty mounts hold cargo like any other cell, so every mounted part costs cargo room. Parts have shapes: a cannon is a 3x1 bar, an engine is a 2x2 block.

Cargo parts add full-width rows to the grid while mounted. A roof rack adds one row, a cargo box adds three.

Goods take one cell per unit and can be moved or dumped anywhere. Mounting and unmounting parts needs a town garage. Spare parts ride in the grid or wait in garage storage.

Every part and good has a mass. A heavier truck accelerates, brakes, steers and tops out worse. Trucks make tradeoffs: cargo vs armor vs fuel use. No truck is best at everything.

Parts wear. The frame cannot be fully repaired, so old trucks slowly decline. The player changes trucks every so often. Parts move between trucks, so a change keeps some progress.

Every turn, each mounted part may lose HP. The chance grows with the tiles driven that turn, the truck's speed and how rough the ground is. Rarely, a part breaks down and loses a large share of its HP at once, logged in the event feed. The same rule wears NPC trucks.

Parts is a trade good, bought and sold in towns like scrap or salt. It is the resource field repair spends. The standard start kit carries a few.

A job is work that needs the truck parked for a number of turns: field repair or scavenging. The player has at most one job at a time. Driving before it ends cancels it and the turns already spent are lost. The HUD shows the current job and its turns left.

Field repair fixes one damaged mounted part. It spends parts and restores HP up to a field cap below full, only when the job finishes. Mechanics shortens the job and cuts the parts it needs. A full repair to 100% still needs a town. The inventory panel shows a Patch button on a damaged part, with its turns and parts cost, disabled with the reason when the truck is moving or the grid lacks parts. NPCs keep their town upkeep and do not field repair.

The truck stays critical to progression, like the ship in Space Rangers 2.

## Turns and combat

Movement and combat happen on the same map, in Space Rangers 2 style. Travel and fights use the same turns.

Each turn the player sets a destination. The player also assigns each weapon a target, or tells it to hold fire. Then the player ends the turn. All vehicles move at the same time, then all weapons fire at the same time.

Each chassis has max speed, acceleration, braking and turn rates. Momentum carries over: the speed you have is a committed distance for next turn. Faster trucks turn less per turn. Vehicles are physics bodies with suspension. Time only runs while a turn plays: each turn simulates one second of driving, then everything pauses. Slopes, bumps and collisions come from the physics.

A click is a waypoint to drive through. While moving, a close click brakes, a click about one turn of travel away holds speed, and a far click accelerates. From rest, a nearby click starts the truck slowly, and a click behind it backs toward that point. At rest the colored zones show one third red and two thirds green. Steering bends the path as far as the turn limit allows, without slowing down. After the waypoint, or with no order, the truck coasts on. Clicking your own truck brakes it. Shift-click stops on the point, driving carefully around corners.

The truck plans a route around rocks, wrecks, parked vehicles and cliffs, preferring roads. The screen shows the planned path for the next turns.

Crash damage grows with impact speed. The lighter truck takes the bigger share, so heavy trucks win rams. A ram part on the striking side takes the blow and hits harder. R toggles manual driving, which skips the route planner so the truck can ram. NPC drivers use the same steering and obstacle routing as the player. A stuck driver backs away before trying the route again. During normal travel, NPCs use reversing to turn their nose toward the route instead of following it rear-first.

Weapons have range, reload time, scatter, a firing arc and a number of rounds per shot. A turret covers all sides. A forward gun needs the truck to face the target. Each round rolls on its own. It hits when its scatter is smaller than the target's width as seen from the gun. So distance, target size, facing, crossing speed, the shooter's own speed and round speed all matter. Hovering a truck shows both sides' chances and their causes.

There is no hull. A round enters from the side facing the shooter and walks the grid cell by cell. Each part it meets takes damage, and the part's armor uses up the round's penetration. An aimed shot targets one part's lane, and a near miss still hits where it lands. A part at 0 HP stops working. A dead weapon cannot fire. A dead engine or transmission limits speed to a crawl. Dead wheels cut speed and steering, and a holed tank leaks fuel. A destroyed cab ends the fight: an NPC truck becomes a wreck, and the player is knocked out.

An auto mode assigns every weapon a body shot at the nearest hostile.

## Defeat

Losing a fight does not end the game, in Kenshi style.

The character is knocked out. Enemies loot the cargo and half the money. The character stays with the truck and keeps stats, skills and mounted parts. The robbers leave. The character patches the broken built-in parts and engine to barely working condition and must crawl back with no fuel.

Later the enemies may also take or wreck the truck.

Losing a truck is one natural way to change trucks.

## Stealth

Sight reaches 20 tiles with line of sight, halved at night and cut in dust storms. Beyond it, a moving vehicle still gives itself away: engine sound, dust clouds, or a mounted radio scanner.

A contact is a vehicle detected this way. It is a rough circle that always holds the true position. For sound the circle is about a third of the distance wide, so a far sound gives little more than a direction. A scanner fixes a position much more tightly.

Engine sound reaches far, by the engine and the vehicle's speed. A parked truck makes no sound. Hills do not block it. The listener's own speed shortens its hearing, so a parked observer hears furthest. Sound shows as faint arcs around the player's truck, pointing toward each heard truck: a wide arc for a vague bearing, a thick one for a loud engine, a bright one for a near sound. The arcs hum and ripple outward.

Dust clouds are objects in the world. Every turn a moving truck on dusty ground leaves a cloud behind it. Roads raise little dust, sand and hardpan raise more, and none rises at night. A cloud rises, drifts back along its truck's route and with the wind, wanders a little, and fades after a few turns. Once risen it is seen from far beyond sight and over hills. So a line of clouds shows where a truck passed, a little late.

A radio scanner is a part that mounts on a weapon cell, so it competes with a gun. It detects every moving vehicle across the map, through hills, and shows it as a steady blip. It is sold in towns.

NPCs detect the player and each other with the same rules. Raiders drive toward a contact to find it, and give up on arrival or once they see the target, at which point the ordinary fight rule takes over. Traders and scavengers steer away from a hostile contact the same way they flee a visible one. A very faint, far contact is too vague to act on.

## World

The map is a grid of tiles with a height on every tile corner, so the ground is smooth hills and valleys. Each tile has a terrain type: road, hardpan, loose sand, scrub, scree, mud, gravel, salt crust, cracked asphalt or ash. Each type has its own driving speed. Uphill slows a truck, downhill speeds it up a little. Tiles too steep to climb are cliffs: driving into one is a crash. Hills and obstacles block sight, and the fog of war shows only what the truck sees.

Danger is set by region, not by player level.

Faction squads roam the map. Places are discovered by exploring. Towns and locations block driving. Their interaction radius is 1.5 times the site's base service reach, so the player uses services without driving into buildings.

## Sun, time and weather

A day is a fixed number of turns, and the clock starts in the morning. The sun rises in the east, crosses south at noon and sets in the west; there is no sun at night. A point is in shade when a ray toward the sun is blocked by a hill or by a rock, wreck or building. Heat is at its base rate in shade and at night, and rises toward its peak in full sun; heat multiplies fuel and supply drain, so the wrong time and route cost more of the tank and the larder. The ground darkens over shaded tiles once they are explored, using the same rule the sim drains by. The sun's light follows the clock, and the scene dims after dark. Sight also shrinks at night.

Weather events come from the world's own randomness, so a seed replays the same weather. A dust storm is a moving area: inside it, sight and aim both suffer, top speed drops, and wear climbs faster. A heat wave covers the whole region and raises heat further. Overcast also covers the region, and cancels the sun's heat instead. The HUD shows the day, time, current heat and the region's weather.

## NPC activities

NPCs follow Space Rangers-style ordered rules: react to visible danger, address urgent upkeep, continue an unfinished activity, then choose class work. Classes share fixed knowledge of towns, salvage sites, and hunting grounds. They have no individual memory or live shared intelligence.

NPCs spawn with equipment sampled from weighted tables for their role. The generator chooses a chassis, a fitting engine and weapon, then optional cargo parts, armor and goods. It respects mount space, rated mass and a chassis-plus-parts budget separate from the driver's wallet. Rare equipment has a lower weight among eligible choices. The same world seed and actions produce the same equipment. There is no separate loot roll on death.

Scavengers collect finite salvage, sell cargo, and fight manageable hostiles or flee. Traders buy profitable cargo while reserving upkeep money and flee from threats. Raiders search hunting grounds, fight, collect wreck cargo, and sell it. Each NPC pays for fuel, supplies, and repairs from its own wallet. Inspection shows its activity and reason.

Scavenging is a timed search: the truck parks at a stock and searches for turns in proportion to what the stock holds, with a progress bar. Moving the truck cancels the search. A finished search opens the stock beside the truck's grid, and the player drags in what they want. What they leave stays at the site for later. NPC scavengers take everything that fits. Landmark and convoy sites hold finite stock rolled at world creation: goods, parts and sometimes a spare mountable part. Destroyed NPCs leave a wreck with the same kind of stock. Their mounted parts join it at the HP they had; their built-in parts turn into the parts good instead. Collection takes only what fits and leaves the rest. Old wreck retirement removes their remaining stock. Empty sites do not regenerate.

Town markets have fixed prices and unlimited stock and money. Initial NPC resources and the oasis are explicit sources. No offscreen catch-up grants are used. Player defeat retains its separate cargo-loss and enemy-despawn rules.

## Trade

Each town produces and needs fixed goods. Profit comes from knowing routes, as in Dustland Delivery.

Fuel and supplies limit range. Fuel burns at 0.06 of the chassis fuel-per-tile rate, times heat. Below 20% of tank capacity, the truck's top speed is halved. The truck crawls when fuel runs out. Supplies burn at 0.025 per turn, times heat. Without supplies the character loses health. Oases refill supplies.

## Prototype v0.001 content

- Buyable chassis: Scout pickup, Hauler, Courier, Utility van, Longbed truck, Armored carrier and Heavy tractor. Raiders can also use the buggy and gunwagon chassis.
- Parts: seven weapons, seven engines, eight armor parts and seven cargo parts. Cheap, light, durable, fuel-efficient and high-output variants have different costs and footprints. Cargo frames extend the inventory grid, without articulated trailer physics.
- Goods: scrap metal, salt, meds, grain, textiles, machine tools, batteries and electronics. Bowl and Nose price every good.
- Defeat takes all goods and spare parts from the grid. Mounted parts stay.
- Region: Icarus, a 600-tile basin with Bowl and Nose as hubs, 13 other destinations, two canyon crossings, and the Fallen Sun. Winding roads cross rolling grades between distinct landmarks. Sight is twenty tiles. See [landmark visuals](VISUAL_DESIGN.md).
- Enemies: raider outriders and gunwagons with sampled chassis and equipment.
- Neutrals: trader caravans and scavengers. Shooting one makes it and its nearby mates hostile.
- Skills: Driving, Gunnery, Mechanics, Trade, Survival.

## Out of scope for now

Text quests.
