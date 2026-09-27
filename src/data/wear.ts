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
