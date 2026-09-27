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

Goods take one cell per unit and can be moved or dumped anywhere. Select an inventory item, then click another to swap their positions if both fit. Dragging onto another item also swaps them. Spare parts ride in the grid or wait in garage storage. Garage equipment changes are instant. Outside town, installing or removing a part takes 5 parked turns per operation. Replacing an installed part with a spare takes 10 turns. Moving an installed part to another mount also takes 10 turns. The old layout remains active until the whole job finishes. Driving cancels the job and loses its progress. Rearranging, storing, dumping or collecting items is blocked during a refit. Missing items or invalid space cancel it. Installing a salvaged part takes 5 turns and leaves it in the stock until completion. Moving goods or spare parts without installing them stays instant.

Every part and good has a mass. A heavier truck accelerates, brakes, steers and tops out worse. Trucks make tradeoffs: cargo vs armor vs fuel use. No truck is best at everything.

Parts wear. Each part has a wear level, from pristine to the last step. A part gains one wear step each time it drops to 0 HP. Fixing a damaged part that still works adds no wear. Each step lowers max HP and makes the part worse at its job: a gun scatters more, an engine gives less speed and acceleration, armor stops less and a scanner sees less far. A part that breaks at the last step is junk. Junk cannot be rebuilt, only stripped or sold for scrap. Built-in parts stop at the last step and never turn to junk, so old trucks slowly decline and the player changes trucks every so often. Parts move between trucks, so a change keeps some progress. Pristine parts are rare, so the player hunts for them.

Every turn, each mounted part may lose HP. The chance grows with the tiles driven that turn, the truck's speed and how rough the ground is. Rarely, a part breaks down and loses a large share of its HP at once, logged in the event feed. The same rule wears NPC trucks.

Parts is a trade good, bought and sold like scrap or salt. It is the resource field repair spends. The standard start kit carries a few. Stripping a spare part is a parked job that turns it into units of parts. Its value sets the yield, so a broken or junk gun still pays.

A job is work that needs the truck parked for a number of turns: field repair or scavenging. The player has at most one job at a time. Driving before it ends cancels it and the turns already spent are lost. The HUD shows the current job and its turns left.

Field repair fixes one damaged mounted part. It spends parts and restores HP up to a field cap below full, only when the job finishes. Each unit of parts restores the same share of any part's max HP, so a broken wheel and a broken cab cost the same. Mechanics shortens the job and cuts the parts it needs. A full repair to 100% still needs a town. The inventory panel shows a Patch button on a damaged part, with its turns and parts cost, disabled with the reason when the truck is moving or the grid lacks parts. NPCs also use field-repair jobs and keep town upkeep. New NPCs carry up to two repair parts when their loadout has room and mass capacity. They retain these parts when selling cargo. A damaged NPC prefers nearby reachable shade, or repairs where it stopped if no shade is reachable or fuel is exhausted. Low supplies and a low but nonempty tank take priority over a repair detour.

Auto patch is on by default and toggles with P. Whenever the player truck is parked and idle, it patches the most damaged part with one unit of parts at a time. Driving off cancels at most one short job. A repair job ends as cancelled once the grid holds no parts for it.

The truck stays critical to progression, like the ship in Space Rangers 2.

## Turns and combat

Movement and combat happen on the same map, in Space Rangers 2 style. Travel and fights use the same turns.

Planning does not advance time. Clicks set or change the waypoint and show the route preview. Outside combat, Space starts automatic turns until the waypoint is reached. Space pauses after the current turn without clearing the waypoint, and another press resumes the route. Visible hostiles, player combat, collisions, breakdowns, an empty tank, panels and loss of browser focus pause automatic travel. Without a waypoint, or in combat or direct-drive mode, Space advances one turn. Holding Space fast-forwards turns, including combat, until released. Loading a save starts paused. In combat or direct-drive mode, the player sets movement and weapon orders, then ends the turn. All vehicles move at the same time, then all weapons fire at the same time.

Each chassis has max speed, acceleration, braking and turn rates. Momentum carries over: the speed you have is a committed distance for next turn. Faster trucks turn less per turn. Vehicles are physics bodies with suspension. Time only runs while a turn plays: each turn simulates one second of driving. Automatic travel and held Space start the next turn after playback finishes. Slopes, bumps and collisions come from the physics.

A click is a waypoint to drive through. While moving, a close click brakes, a click about one turn of travel away holds speed, and a far click accelerates. From rest, a nearby click starts the truck slowly. A click behind it within throttle reach backs toward that point. A farther click is a course: the truck turns around and follows a route around obstacles over as many turns as it takes, so Space alone carries it there. A point it cannot reach sends it to the closest point it can reach. At rest the colored zones show one third red and two thirds green. Steering bends the path as far as the turn limit allows, without slowing down. After the waypoint, or with no order, the truck coasts on. Clicking your own truck brakes it. Shift-click stops on the point, driving carefully around corners.

The truck plans a route around rocks, wrecks, parked vehicles and cliffs, preferring roads. Roads are six tiles wide. Every route planner weighs a road above its speed, since a road puts a driver where others can help. A far longer road detour still loses to open ground. The screen shows the planned path for the next turns.

Crash damage grows with the square of impact speed, so a slow bump only scratches parts. The lighter truck takes the bigger share, so heavy trucks win rams. A ram part on the striking side takes the blow and hits harder. R toggles manual driving, which skips the route planner so the truck can ram. NPC drivers use the same steering and obstacle routing as the player. A stuck driver backs away before trying the route again. During normal travel, NPCs use reversing to turn their nose toward the route instead of following it rear-first.

Weapons have range, reload time, scatter, a firing arc and a number of rounds per shot. A turret covers all sides. A forward gun needs the truck to face the target. Each round rolls on its own. It hits when its scatter is smaller than the target's width as seen from the gun. So distance, target size, facing, crossing speed, the shooter's own speed and round speed all matter. Hovering a truck shows both sides' chances and their causes.

There is no hull. A round enters from the side facing the shooter and walks the grid cell by cell. Each part it meets takes damage, and the part's armor uses up the round's penetration. An aimed shot targets one part's lane, and a near miss still hits where it lands. A part at 0 HP stops working. A dead weapon cannot fire. A dead engine or transmission limits speed to a crawl. Dead wheels cut speed and steering, and a holed tank leaks fuel. A destroyed cab ends the fight: an NPC truck becomes a wreck, and the player is knocked out.

Player auto mode assigns every weapon a body shot at a visible hostile. NPC weapons target their chosen opponent or a visible attacker that shot at them or a nearby faction mate. Retreat does not disable defensive fire. NPCs avoid initiating attacks in town guard range, but can defend themselves there. Guards still punish firing by their existing rules.

## Defeat

Losing a fight does not end the game, in Kenshi style. A loss starts a new story on real turns the player watches. There are no fade screens.

A broken cab knocks the player out while health is above 0. Every mounted part except the built-in ones, all goods and all spare parts drop into a wreck stock beside the truck. Money, fuel and supplies stay. Feuds against the player end.

While knocked out, turns run on their own and the player gives no orders. Looters search the stock. The player comes to when no hostile sees the truck, or after 30 turns. Broken built-in parts are patched to a quarter of their HP. What the looters left stays in the stock beside the truck.

Raiders ignore a truck with nothing to take. A truck has loot when it holds goods, spare parts or mounted parts beyond the built-in ones. A feud still makes a raider fight a stripped truck.

A truck with no working engine, a broken transmission or an empty tank still moves at a crawl. The driver pushes it. Pushing burns no fuel, and a truck without a working engine makes no sound. A player truck that can only crawl is stranded.

Traders and scavengers help a stranded player. One that sees the truck may drive over, if it is not hostile and not in danger. It parks beside the truck and radios a tow offer to the nearest town it knows. The fee is a base price plus a price per tile of the route. The player accepts, refuses or hangs up. A driver the player turned down rarely offers again. A stranded player can also radio a passing trader or scavenger and ask for a tow.

A towed truck hangs behind its tower and follows its path. The tower drives slower than its top speed. Turns run on their own while towed. The player can unhitch at any time for free. A tower that enters a fight or flees drops the tow for free. On arrival in town the tower takes the fee. Money can go below zero, and the HUD shows it as debt. A player in debt cannot buy anything, and sales pay the debt off.

A stranded player can switch on an emergency beacon. Every vehicle within 250 tiles hears it, through hills. Traders and scavengers come as if they saw the truck, and the first to arrive makes the offer. Raiders hear it too, so a stripped truck calls safely and a truck with cargo draws raiders. Turns run on their own while the beacon calls and the truck is parked. The beacon switches off when the truck can drive again or gets towed.

Health at 0 kills the player. The death screen offers Load last save and New game. A dead world is never saved. Cab damage costs health at half its amount, so a lost fight costs at most 30 health. A healthy driver dies on the fourth knockout without rest.

A parked driver with supplies heals each turn, five times as fast in a town. Healing spends extra supplies. Starving takes health down to 30 and no lower, so only cab damage can kill. Wear and breakdowns never take the cab below 1 HP, so no knockout comes without an enemy.

Losing a truck is one natural way to change trucks.

## Stealth

Sight reaches 20 tiles with line of sight, halved at night and cut in dust storms. Beyond it, a moving vehicle still gives itself away: engine sound, dust clouds, or a mounted radio scanner.

A contact is a vehicle detected this way. It is a rough circle that always holds the true position. For sound the circle is about a third of the distance wide, so a far sound gives little more than a direction. A scanner fixes a position much more tightly.

Engine sound reaches far, by the engine and the vehicle's speed. A crawling truck is heard only a little past sight, and a parked truck makes no sound. Hills do not block it. The listener's own speed shortens its hearing, so a parked observer hears furthest. Sound shows as faint arcs around the player's truck, pointing toward each heard truck: a wide arc for a vague bearing, a thick one for a loud engine, a bright one for a near sound. The arcs hum and ripple outward.

Dust clouds are objects in the world. Every turn a truck moving faster than a crawl on dusty ground leaves a cloud behind it. Roads raise little dust, sand and hardpan raise more, and none rises at night. A cloud rises, drifts back along its truck's route and with the wind, wanders a little, and fades after a few turns. Once risen it is seen from far beyond sight and over hills. So a line of clouds shows where a truck passed, a little late.

A radio scanner is a part that mounts on a weapon cell, so it competes with a gun. It detects every moving vehicle across the map, through hills, and shows it as a steady blip. It is sold in towns.

NPCs detect the player and each other with the same rules. Reaction requires a contact circle within the traits' uncertainty limit. Vague distant sounds stay audible without redirecting an NPC. Accurate scanner and emergency-beacon contacts stay useful from farther away. A useful hostile contact fires one decision: keep, investigate or flee. Raiders mostly investigate, and traders and scavengers mostly flee. An investigation keeps the first contact destination instead of following its moving center, and ends on arrival. A continuously useful contact does not start another investigation. A driver busy with trade, salvage, service or repairs mostly keeps on.

## World

The map is a grid of tiles with a height on every tile corner, so the ground is smooth hills and valleys. Each tile has a terrain type: road, hardpan, loose sand, scrub, scree, mud, gravel, salt crust, cracked asphalt or ash. Each type has its own driving speed. Uphill slows a truck, downhill speeds it up a little. Tiles too steep to climb are cliffs: driving into one is a crash. Hills and obstacles block sight, and the fog of war shows only what the truck sees.

Danger is set by region, not by player level.

Faction squads roam the map. Places are discovered by exploring. Towns and locations are static places that trucks never enter, so they block driving. Towns and small locations have one gate, where the first road crosses their edge. Large locations have a gate on every road. Each gate post carries a lamp. A rectangular dust pad lies outside each gate. A site is used only from a pad. A click on a site orders a stop at its pad nearest the truck. Towns have a wall, and the Granary and the Salvage Yard have a palisade. The truck must be stopped to use a town or search salvage. In reach but still moving, the action shows dimmed. Each town gate has a guard gun. It shoots the nearest vehicle that fired within its range that turn, whatever its faction. Raiders also trade in towns, so guards judge by action. A town gate is therefore a safe place to run to.

Raiders have two camps, Scrapjaw Camp in the north and Kiln Camp in the south. A dirt track leads to each camp gate. Raiders spawn outside a camp gate. Each camp gate has a gun on each side. It shoots the nearest non-raider within its range every turn, whether or not that vehicle fired. The player cannot use camp services.

## Sun, time and weather

A day is a fixed number of turns, and the clock starts in the morning. The sun rises in the east, crosses north at noon and sets in the west; there is no sun at night. A point is in shade when a ray toward the sun is blocked by a hill or by a rock, wreck or building. Heat is at its base rate in shade and at night, and rises toward its peak in full sun; heat multiplies fuel and supply drain, so the wrong time and route cost more of the tank and the larder. The ground darkens over shaded tiles once they are explored, using the same rule the sim drains by. The sun's light follows the clock, and the scene dims after dark. Sight also shrinks at night.

Weather events come from the world's own randomness, so a seed replays the same weather. A dust storm is a moving area: inside it, sight and aim both suffer, top speed drops, and wear climbs faster. A heat wave covers the whole region and raises heat further. Overcast also covers the region, and cancels the sun's heat instead. The HUD shows the day, time, current heat and the region's weather.

The sun also heats the player's running engine, faster at higher speed. Airflow, shade, night and parking cool it, and parking in shade cools it fastest. Full noon sun at top speed overheats a cold engine in about 11 turns, while morning and evening sun barely warm it. An overheated engine loses HP every turn it keeps driving. The HUD shows the engine temperature as a gauge, and the log warns once when it runs hot. NPCs have no engine heat, since they have no rule for stopping to cool down.

## NPC activities

NPC behavior has three layers. Traits are permanent and set the chances of choices. A goal stack keeps long-term work under interruptions like fights, flight, service and repairs, and the driver usually resumes that work once an interruption ends. Decision points pick reactions by weighted chance when a new hostile, contact, attack, prey or stranded player appears. An option the driver can take always keeps at least a 1% chance. Traits give fixed knowledge of towns, salvage sites and hunting grounds. Each NPC remembers the subjects it already decided on and the attackers still in sight. There is no live shared intelligence.

NPCs spawn with equipment sampled from weighted tables for their role. The generator chooses a chassis, a fitting engine and weapon, then optional cargo parts, armor and goods. It respects mount space, rated mass and a chassis-plus-parts budget separate from the driver's wallet. Rare equipment has a lower weight among eligible choices. The same world seed and actions produce the same equipment. There is no separate loot roll on death.

Scavengers collect finite salvage and sell cargo. Idle scavengers mostly fight manageable hostiles and flee stronger ones. A healthy driver busy with work mostly keeps on when a hostile appears that is not aimed at it or a nearby faction mate. Towing retains its safety rule: a tower drops a tow when it takes on a fight or flees. A shot at a driver or a nearby visible faction mate, hit or miss, prompts a decision to fight back, flee or rarely keep on. Damaged NPCs react to visible hostiles before starting repairs. Local force assessment compares the target's nearby visible faction group against the NPC and nearby visible faction mates, rather than treating every visible enemy as one force. Traders buy profitable cargo while reserving upkeep money and flee from threats. Raiders search hunting grounds, fight, collect wreck cargo, and sell it in towns. Raiders buy fuel, supplies and repairs at their nearest camp, and flee to a camp or a town. A camp buys no cargo, so a raider without money sells its cargo in town first. Each NPC pays for fuel, supplies, and repairs from its own wallet. Inspection shows its activity and reason.

Scavenging is a timed search: the truck parks at a stock and searches for turns in proportion to what the stock holds, with a progress bar. Moving the truck cancels the search. A finished search opens the stock beside the truck's grid, and the player drags in what they want. What they leave stays at the site for later. NPC scavengers take everything that fits. Landmark and convoy sites hold finite stock rolled at world creation: goods, parts and sometimes a spare mountable part. Destroyed NPCs leave a wreck with the same kind of stock. Their mounted parts join it at the HP they had; their built-in parts turn into the parts good instead. Collection takes only what fits and leaves the rest. Old wreck retirement removes their remaining stock. Empty sites do not regenerate.

Shops have unlimited money. Goods prices move with trade, and part stock is finite. Initial NPC resources and the oasis are explicit sources. No offscreen catch-up grants are used. A knocked-out player's parts and cargo go into a wreck stock that any collector can take.

## NPC traits and states

Every NPC carries a set of traits instead of one class. Each trait adds activities and shifts chances. A scavenger with the scumbag trait still scavenges, and it also robs. Traits roll at spawn: every scavenger scavenges, and some are also scumbags or cowards. For now the hover panel shows traits. In the final game they stay hidden, so the player learns a driver is a scumbag only when it starts acting like one.

- Scavenger collects salvage and helps stranded trucks.
- Trader buys and sells between towns, rarely starts a fight, and sometimes fights back.
- Raider hunts at hunting grounds, investigates distant engines and knows the raider camps.
- Scumbag robs trucks that carry loot and look weaker than it.
- Coward flees more often and fights back less.

A chance is 0 only when an option is physically impossible. A driver with no working gun cannot fight, and a truck with no loot cannot be robbed. Anything a driver can do keeps at least a 1% chance. So an ordinary scavenger robs about once in a hundred chances, and a trader sometimes starts a fight.

Drivers judge each other by danger: the firepower of working guns times the current toughness of the cab, chassis and armor. A tank looks more dangerous than a scout, and a half-beaten tank looks about half as dangerous. Danger counts nearby visible faction mates on each side. A driver misjudges another truck's danger by up to a quarter each time it first sees it. A scumbag robs a truck whose danger looks below its own times its boldness. Scumbags are bold, and cowards are timid. A stronger target, or one near a town gate, is robbed only rarely.

A robbery is an attack. The winner searches the wreck or the knockout stock the loser left. A robber whose target escapes backs off that target for a while.

In a fight, each chance to ram the target is a decision. A ram that the driver expects to hurt itself more than the target is rare, and traders almost never ram.

A shot at another vehicle is an attack, hit or miss. The victim and its nearby faction mates that see it start a feud with the attacker. A damaging crash between hostile trucks is an attack too.

A damaging crash between trucks at peace is most likely an accident. Each damaged NPC decides once whether to forgive it or retaliate. Most drivers forgive. Raiders and scumbags retaliate more often, and a crash with a faction mate is nearly always forgiven. A retaliating driver starts a feud as if it was attacked. A slow bump that does no damage counts for nothing, and neither does contact with the truck on a tow rope.

A driver hurt by a hostile may plead with it. It asks for a truce, or it begs for mercy when it is weak. Traders and cowards plead most, and raiders seldom. The other side decides whether to accept. A truce ends the feuds between both sides and their nearby faction mates. Mercy is a truce the beggar pays for with its cargo, which it drops for the winner to take. A driver rarely pleads with the same foe again soon.

States are timed relations between two trucks. Each ends as expired, fulfilled or broken, and each ending can start other states.

- A feud makes both trucks hostile. Sight or shots between them keep it going. It expires after some turns without either, and a failed robber then backs off.
- A tow runs from the offer to arrival in town, where the fee is paid. It breaks for free when the player refuses or unhitches, or when the tower meets danger.
- A tower the player turned down rarely offers again.
- A tower that dropped a tow for danger comes back with the same deal.
- Only one driver answers a stranded player at a time. Near a town gate, drivers rarely offer a tow at all.

## Social

Every truck has a radio, as in Space Rangers 2. A call reaches only a truck in sight. The player calls the truck under the cursor with T. An NPC calls the player when it has something to say. Turns wait while a call is open, and neither truck on the line shoots the other.

Talk is built from topics. A topic is lines and replies in data, and its logic is named conditions and effects in code. The player's call opens on a menu of the topics that truck can take up. A driver's traits decide its voice and its topics. A topic can be once per driver: that driver remembers how it ended.

- Directions: traders and scavengers name the nearest town they know, with direction and distance. The town counts as found.
- Tow: see Defeat.
- Patch: a patch gets a broken engine or gearbox going again at a quarter of its HP. A stranded player asks a trader or scavenger. A stranded NPC asks the player once, unless it carries the parts to fix its own truck. The NPC's traits roll the terms: paid, bring your own parts, or free. Only terms the payer can cover come up. The work runs while both trucks stay parked side by side, and the payment moves once when it ends. A deal nobody works on lapses for free.
- Demand: a raider or robber about to attack radios first, once, and asks for the cargo. Handing it over drops the goods and loose parts beside the truck, and the attacker and its mates nearby keep a truce for a while. Shots break the truce. Refusing keeps the fight.
- Truce and mercy: the player can call a hostile truck and ask for a truce or give up. Mercy costs the player's cargo. The driver's answer is rolled like an NPC plea. After an answer, the player cannot ask the same driver again for a while. A driver in a feud takes up only these topics. A hurt NPC calls the player with its own truce or plea for mercy. Sparing a beggar leaves its cargo on the ground.
- Towing an NPC: the player can offer a tow to a stranded driver at peace parked within reach. The driver names its nearest known town and pays the tow fee, up to the money it holds, when the player reaches that town. The towed truck trails the player, and the player drives slower. The player can let it off the rope by radio for free. Hostility breaks the tow.
- Patching an NPC: the player can offer a patch to a driver stranded by a broken engine or gearbox. The driver names its terms as it does when it asks.
- Robbery: the player can demand the cargo of a truck at peace, once per driver. The driver gives it up, fights or runs. Traders and cowards give up more, raiders fight more, and every driver gives up to a much stronger player. Giving up drops the cargo beside the truck and holds a truce with the player. Fighting or running starts a feud.

H honks. Traders and scavengers in earshot that are not hostile honk back.

## Trade

Every good, part and chassis has one base value and a tier from 1 to 3. Every price is a formula from that value. Buy adds a spread, and the Trade skill narrows it. A part's value falls with each wear step. Its sell price also scales with its HP, but never drops below its scrap value from mass. Repair and rebuild cost a share of the part's value per HP restored, so an expensive part costs more to fix.

Shops trade in Bowl and Nose garages and in stalls at the Salvage Yard, the Granary and the Pump Station. Each shop makes some goods cheap and needs others. Each unit bought raises the local price, and each unit sold lowers it. Prices drift back over about two days. NPC traders trade through the same prices, so they move them too. Profit comes from knowing routes, as in Dustland Delivery.

Each shop holds a random, finite part stock with rolled wear, and restocks on a timer. Garages hold more and fresher parts, and stalls hold a few worn ones. A part sold to a shop joins its stock. Mounting, repairs, garage storage and chassis need a town garage. NPC traders and scavengers also sell their spare parts over the radio.

Shops post contracts. A haul loads goods for another shop by a deadline, and a missed deadline charges their value. A fetch asks for a part of one type in any condition. A bounty names a living raider and pays on the kill. Contracts pay money and XP, and the player holds a few at once.

The unit of effort is one turn of play. The wage is the net money per turn a player earns at a tier. An item's effort is its value divided by its tier's wage, and data keeps each item inside a target band. Contract rewards are estimated turns of work times the wage. `npm run econ` plays the sim economy with bot policies and reports wages and the day each upgrade is reached.

Fuel and supplies limit range. Fuel burns at 0.075 of the chassis fuel-per-tile rate, times heat. Below 20% of tank capacity, the truck's top speed is halved. The truck crawls when fuel runs out. Supplies burn at 0.015 per turn, times heat. Start kits carry a full load of 20, which lasts about 550 daytime turns. Healing spends extra supplies. Without supplies the character loses health down to 30. Oases refill supplies.

## Prototype v0.001 content

- Buyable chassis: Scout pickup, Hauler, Courier, Utility van, Longbed truck, Armored carrier and Heavy tractor. Raiders can also use the buggy and gunwagon chassis.
- Parts: seven weapons, seven engines, eight armor parts and seven cargo parts. Cheap, light, durable, fuel-efficient and high-output variants have different costs and footprints. Cargo frames extend the inventory grid, without articulated trailer physics.
- Goods: scrap metal, salt, meds, grain, textiles, machine tools, batteries and electronics. Bowl and Nose trade every good. Each stall trades a few.
- A knockout drops all goods, spare parts and mounted non-core parts into a wreck stock. Built-in parts stay.
- Region: Icarus, a 600-tile basin with Bowl and Nose as hubs, 13 other destinations, two raider camps, two canyon crossings, and the Fallen Sun. Winding roads cross rolling grades between distinct landmarks. Sight is twenty tiles. See [landmark visuals](VISUAL_DESIGN.md).
- Enemies: raider outriders and gunwagons with sampled chassis and equipment.
- Neutrals: trader caravans and scavengers. Shooting one makes it and its nearby mates hostile.
- Skills: Driving, Gunnery, Mechanics, Trade, Survival.

## Out of scope for now

Text quests.
