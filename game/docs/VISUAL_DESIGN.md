# Icarus landmarks

Recognizable destinations interrupt long stretches of damaged farmland and rough roads. Concept-derived tags: broken farm grid, exposed ship ribs, reclaimed water.

## Physical scale

- One tile is four metres. The pickup body is 5.2 metres long. Buildings and destinations use that scale rather than growing the vehicle to fill the screen.
- Bowl occupies a 224-metre-wide footprint and Nose a 256-metre-wide footprint. Both contain inhabited blocks with one- and two-storey houses, doors, windows, rooftop water tanks, and clear road approaches. Town interiors remain non-drivable service areas.
- Houses measure 10.8 by 8.4 metres on 20-metre blocks. Old Orchard contains eleven rows of eleven trees, spaced eight metres apart, beside a ruined farm building.
- Fallen Sun's main hull is about 230 metres long. Nose's hull section is 88 metres long with a projecting bow. Ship fragments remain larger than the buildings built around them. The Broken Wing ship wing is 44 metres along the road and 42 metres across, with its underside 7 metres up, so it spans the whole 24-metre road.

## Materials and shapes

- Warm sand and stone form the background. Winding roads retain broad rises and falls instead of flattening the whole basin.
- Cold metal identifies ship debris and machinery. Fallen Sun has an open, faceted hull, exposed ribs, detached plates, and engine remains. Nose combines hull shelter with buildings.
- Muted green identifies surviving vegetation. Old Orchard has planted rows, dead branching trunks, irrigation lines, fencing, and a ruined building.
- Blue-green marks water at Bowl, Dustwell, Green Pit, and South Lock. Glass Flats uses shallow angular fragments rather than a building.
- Rust marks damaged equipment, wrecks, gates, and salvage stock. The Granary has silos and a ruined loading shed. Pump Station has tanks, pipes, and valves. Salvage Yard has sorted stock, sheds, and a lifting beam. Raider camps have a rusted palisade with gun towers at each gate, scrap shacks around a fire pit, fuel tanks and a stripped hull.

## Readability

- The player truck and its selection ring stay the moving focal point. Dense detail belongs inside destination footprints, away from road approaches.
- Sites use separate silhouettes: planted rows, silos, hull sections, gates, wells, and pod clusters. Labels identify places but do not supply their entire identity.
- Distant terrain is split into chunks so offscreen geometry can be culled. The ground texture is bounded to 2048 pixels per side. A site is discovered when any of its tiles comes into sight.
- Fallen Sun's hull, machinery, trees, rocks, wrecks and town ring buildings are low-poly Blender models from `tools/blender/`. Houses, ruins, water and the smaller hull sections are built from Three.js shapes in code.
