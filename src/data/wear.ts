// Wear and field repair numbers. All survival-loop wear and repair rule numbers live here, not in rules.ts.

export const WEAR = {
  // An off-road crossing is about 500 tiles. At these rates each part loses about 3 HP to wear on one,
  // and the truck has about one breakdown. Roads wear at half rate, so they roughly halve both.
  chancePerTile: 0.004, // per mounted part, per tile driven, at terrain wear 1 and zero speed
  hpLoss: 1, // HP lost on a plain wear hit
  speedWeight: 0.03, // extra chance per tile of speed, as a multiplier on the base chance
  breakdownChancePerTile: 0.0015, // per vehicle, per tile driven
  breakdownHpShare: 0.15, // share of max HP a breakdown takes off the chosen part
};

export const REPAIR = {
  fieldCapShare: 0.7, // field repair never lifts a part above this share of its max HP
  sharePerPart: 0.35, // share of a part's max HP restored per unit of the parts good spent, so a broken part patches to the field cap with 2
  turnsPerPart: 2, // turns the job takes per unit of parts spent
};

// Engine heat for the player truck. 0 is a cold engine and 1 is overheated. The sun heats a running
// engine; shade, night and parking cool it. Full noon sun overheats a cold engine in about 11 turns
// at top speed and 17 at 70% of it. Morning and evening sun barely warm it.
export const ENGINE_HEAT = {
  gain: 0.075, // heat per turn per unit of sun heat above 1, at top speed; scales with speed share
  coolDriving: 0.02, // heat lost per turn to airflow while driving
  coolParked: 0.15, // heat lost per turn while parked, divided by the sun heat at the spot
  warnAt: 0.75, // heat at which the log warns once and the gauge turns red
  overheatDamage: 1, // HP each working engine loses per turn driven while overheated
};
