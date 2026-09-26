// Wear and field repair numbers. All survival-loop wear and repair rule numbers live here, not in rules.ts.

export const WEAR = {
  chancePerTile: 0.0015, // per mounted part, per tile driven, at terrain wear 1 and zero speed
  hpLoss: 2, // HP lost on a plain wear hit
  speedWeight: 0.03, // extra chance per tile of speed, as a multiplier on the base chance
  breakdownChancePerTile: 0.01, // per vehicle, per tile driven
  breakdownHpShare: 0.15, // share of max HP a breakdown takes off the chosen part
};

export const REPAIR = {
  fieldCapShare: 0.7, // field repair never lifts a part above this share of its max HP
  hpPerPart: 5, // HP restored per unit of the parts good spent
  turnsPerPart: 2, // turns the job takes per unit of parts spent
};
