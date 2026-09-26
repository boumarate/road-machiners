# Korovan design

A post-apocalyptic wasteland RPG where you drive a truck. Isometric view. Turn-based, like Space Rangers 2. Inspired by Ex Machina, Space Rangers 2, Kenshi, Dustland Delivery, Caravaneer 2, Convoy.

## Character

The character has stats and skills. These are the durable upgrades that persist across trucks.

Personal items grant special abilities and modifiers. They stay with the character, not the truck.

## Truck

The truck is equipment. It can be changed, upgraded, and destroyed.

Each truck has an inventory grid, in the style of Dredge. Parts and goods all take cells, and the player arranges them by dragging and rotating.

Each chassis marks some cells as mounts for weapons, engines, armor or cargo parts. A part works only while it lies fully on mounts of its own kind. Empty mounts hold cargo like any other cell, so every mounted part costs cargo room. Parts have shapes: a cannon is a 3x1 bar, an engine is a 2x2 block.

Cargo parts add full-width rows to the grid while mounted. A roof rack adds one row, a cargo box adds three.

Goods take one cell per unit and can be moved or dumped anywhere. Mounting and unmounting parts needs a town garage. Spare parts ride in the grid or wait in garage storage.

Trucks make tradeoffs: cargo vs armor vs fuel use. No truck is best at everything.

Parts wear. The frame cannot be fully repaired, so old trucks slowly decline. The player changes trucks every so often. Parts move between trucks, so a change keeps some progress.

The truck stays critical to progression, like the ship in Space Rangers 2.

## Turns and combat

Movement and combat happen on the same map, in Space Rangers 2 style. Travel and fights use the same turns.

Each turn the player sets a destination. The player also assigns each weapon a target, or tells it to hold fire. Then the player ends the turn. All vehicles move at the same time, then all weapons fire at the same time.

Each chassis has max speed, acceleration, braking and turn rates. Momentum carries over: the speed you have is a committed distance for next turn. Faster trucks turn less per turn.

A click is a waypoint to drive through. Its distance sets the throttle: a close click brakes, a click about one turn of travel away holds speed, a far click accelerates. Colored zones in front of the truck show which is which. Steering bends the path as far as the turn limit allows, without slowing down. After the waypoint, or with no order, the truck coasts on. Clicking your own truck brakes it. Shift-click stops on the point, driving carefully around corners.

The truck plans a route around rocks, wrecks, parked vehicles and cliffs, preferring roads. The screen shows the planned path for the next turns.

Crashes stop a vehicle and deal damage scaled by impact speed and mass. Heavy trucks win rams. NPC drivers sometimes skip route planning and drive straight, so they can be lured into rocks.

Weapons have range, damage, reload time, accuracy and a firing arc. A turret covers all sides. A forward gun needs the truck to face the target.

A normal shot hits the hull. An aimed shot targets one part at a lower hit chance. A part at 0 HP stops working: a dead weapon cannot fire, and a dead engine limits speed to a crawl. A cage armor shields parts from aimed shots.

An auto mode assigns every weapon a hull shot at the nearest hostile.

## Defeat

Losing a fight does not end the game, in Kenshi style.

The character is knocked out. Enemies loot the cargo and half the money. The character wakes up in the nearest town and keeps stats, skills and parts. The truck is left at low hull. Townsfolk top up fuel, water and food to a small amount, so a broke player can still move on.

Later the enemies may also take or wreck the truck.

Losing a truck is one natural way to change trucks.

## World

The map is a grid of tiles with a height on every tile corner, so the ground is smooth hills and valleys. Each tile has a terrain type: road, hardpan, loose sand, scrub or scree. Each type has its own driving speed. Uphill slows a truck, downhill speeds it up a little. Tiles too steep to climb are cliffs: driving into one is a crash. Hills and obstacles block sight, and the fog of war shows only what the truck sees.

Danger is set by region, not by player level.

Faction squads roam the map. Places are discovered by exploring.

## Trade

Each town produces and needs fixed goods. Profit comes from knowing routes, as in Dustland Delivery.

Fuel and water limit range, as in Caravaneer 2. Fuel burns per tile driven. Water and food burn per turn. With no water or food the character loses health.

## Prototype v0.001 content

- Chassis: Scout pickup and Hauler.
- Parts: MG turret and forward cannon, stock engine and tuned V8, steel plates and rebar cage, roof rack and cargo box.
- Defeat takes all goods and spare parts from the grid. Mounted parts stay.
- Region: Dry Basin, with the towns Tin Hollow and Saltmarch, the Green Pit oasis and the Burnt convoy.
- Enemies: raider buggy and raider gunwagon.
- Neutrals: trader caravans and scavengers. Shooting one makes it and its nearby mates hostile.
- Skills: Driving, Gunnery, Mechanics, Trade, Survival.

## Out of scope for now

Text quests.
