// Waste Of Time Radio: J.J.'s lines and the pacing of her broadcasts. See docs/lore.md for her voice and
// src/ui/radio.ts for what she reports.

export type RadioTopic =
  | 'ident'
  | 'dawn'
  | 'noon'
  | 'dusk'
  | 'midnight'
  | 'heatwaveStart'
  | 'heatwaveEnd'
  | 'overcastStart'
  | 'stormStart'
  | 'stormEnd'
  | 'haul'
  | 'fetch'
  | 'bounty'
  | 'raid'
  | 'raidKnockout'
  | 'wisdom';

export const RADIO = {
  minGapTurns: 8, // turns heard between two broadcasts, so the screen never chatters
  queueCap: 3, // broadcasts waiting at once; the oldest filler goes first when full
  staleTurns: 40, // news and time calls older than this are dropped unsent
  placeCooldownTurns: 150, // turns before a second raid report at the same place
  idleTurns: 90, // quiet turns before J.J. fills the air with road wisdom
  charsPerSecond: 24, // real-time typing speed of the pager screen
  nearTiles: 60, // a place farther than this from the news is named by basin direction instead
  maxChars: 90, // a filled line fits the three-line screen
  // Out-of-character words J.J. never says, matched at the start of a word.
  banned: ['turn', 'quest', 'xp', 'experience', 'level', 'hp', 'click', 'press', 'key', 'player', 'game', 'tile', 'save'],
};

// Hours of the clock calls. Dawn and dusk follow TIME.sunrise and TIME.sunset.
export const RADIO_HOURS = { noon: 12, midnight: 0 };

// Slots: {place} is "near X" for a found place or a basin direction, {heading} a compass word, {shop} and {to}
// found site names, {good} a good name, {part} a part name, {target} a driver name.
export const RADIO_LINES: Record<RadioTopic, readonly string[]> = {
  ident: [
    'This is J.J. on Waste Of Time Radio, wasting your time since the sky fell.',
    'Waste Of Time Radio, J.J. at the mic. Nobody asked, and here I am anyway.',
  ],
  dawn: [
    "Sun's up over the basin. Check your water, road machiners.",
    'Morning, boys. Dew on the glass, sand in the gears. Same as yesterday.',
    'Dawn report: sky clear of anything worth eating. Rise and roll.',
  ],
  noon: [
    'High noon. Engines run hot and tempers hotter. Find yourself some shade.',
    'Noon on the basin. Even the lizards have the sense to stop.',
  ],
  dusk: [
    'Sun going down. Lights draw eyes after dark, road machiners.',
    'Dusk report: the day crop came in dry again. Bring it home, boys.',
  ],
  midnight: [
    'Midnight. Nobody sees far out there now. Listen for engines.',
    'Midnight on Waste Of Time Radio. Still here. Still wasting it.',
  ],
  heatwaveStart: [
    'Incoming heat wave. Watch your engines, boys.',
    'Heat wave over the basin. Radiators will boil before the kettles do.',
  ],
  heatwaveEnd: [
    'Heat wave broke. Engines may breathe again.',
    'That heat finally let go. Thank whoever you thank.',
  ],
  overcastStart: [
    "Clouds over the basin. The sun's taking the day off.",
    'Overcast and cool. Best engine weather this side of the fall.',
  ],
  stormStart: [
    'Dust storm rolling {place}, heading {heading}.',
    'Storm warning: dust wall {place}, drifting {heading}. Nobody sees in that.',
  ],
  stormEnd: [
    'That dust storm {place} has blown itself out.',
    'Storm {place} settled. Somebody go dig out the road.',
  ],
  haul: [
    'New haul posted at {shop}: {good} out to {to}.',
    '{shop} needs {good} carried to {to}. Honest work, for once.',
  ],
  fetch: [
    '{shop} is asking after a working {part}.',
    'Wanted at {shop}: one {part}, still breathing.',
  ],
  bounty: [
    '{shop} put a price on {target}. Business, not murder, they say.',
    'Paper up at {shop} for {target}. I just read the board, boys.',
  ],
  raid: [
    'Raider business {place}. Drive careful.',
    'Raiders working the road {place}. Cargo changes hands out there.',
    'Word of a stickup {place}. Raiders, keeping regular hours.',
  ],
  raidKnockout: [
    'Another rig went quiet {place}. Raiders, sounds like.',
    'A rig sits dead {place}. Raiders took their cut. Nobody take more.',
  ],
  // Each line is a real rule from docs/wiki/mechanics/, as road wisdom.
  wisdom: [
    'Noon sun cooks an engine. Park in shade.', // truck.md: sun heat peaks at noon, shade blocks it
    "Town guns don't care who you are, only who you shot.", // content.md: lawmen hunt whoever fires on a neutral
    "Night halves a driver's eyes. Ears work the same in the dark.", // detection.md: sight halves at night, sound does not
    'A parked truck makes no sound. Remember that, boys.', // detection.md: a parked truck is silent
    'Dust behind you is a flag. Roads raise the least.', // detection.md: dust clouds, roads raise little
    'Heavy rig wins the shoving match. Light rig wins the race.', // turns.md: the lighter truck takes the bigger crash share
    'Off the road, every part pays the toll. Roads are cheap.', // truck.md: roads wear parts least
    'Raiders never stop for the stranded. Traders mostly do.', // defeat.md: traders and scavengers help, raiders never
    'In a dust storm nobody sees nothing. Plan accordingly.', // detection.md: storms cut sight
    "A low tank slows a rig. Don't let it reach the bottom.", // social.md: at 20% of the tank speed halves
    'Rest your bones in town. Wounds close faster there.', // defeat.md: healing is five times faster in town
    'Honk at a trader and a trader honks back. Manners survive.', // social.md: traders in earshot honk back
  ],
};

// Basin directions for places the listener has not found, clockwise from east. North is -y on the map.
export const BASIN_DIRECTIONS = [
  'out east',
  'in the southeast basin',
  'down south',
  'in the southwest basin',
  'out west',
  'in the northwest basin',
  'up north',
  'in the northeast basin',
] as const;

// Compass words for which way a storm drifts, clockwise from east.
export const HEADINGS = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'] as const;
