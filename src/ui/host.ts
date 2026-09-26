// What the HTML overlay needs from the game scene.

import type { World } from "../sim/types";

export type UiHost = {
  world(): World;
  apply(next: World): void; // replace the world after a command and refresh the UI
  selectedWeapon(): string | null;
  selectWeapon(id: string | null): void;
  endTurn(): void;
  getTurnPhase(): "Moving" | "Firing" | "Results" | null;
};
