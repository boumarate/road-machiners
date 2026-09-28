// The player's truck switches: manual driving, auto patch, engine overdrive and dousing the engine.

import { playerVehicle } from "../sim/damage";
import { canDouse, douseEngine } from "../sim/engine-heat";
import type { World } from "../sim/types";
import { playerCanAct, setAutoRepair, setDirect, setOverdrive } from "../sim/world";

export type ControlsHost = {
  world: () => World;
  apply: (next: World) => void;
  refreshPlan: () => void;
  doused: () => void; // plays the steam cloud and logs the douse
  revved: () => void; // plays the engine rev when overdrive comes on
};

export class TruckControls {
  constructor(private host: ControlsHost) {}

  // Manual mode drives straight at the click, so the preview must rerun with the new driver.
  toggleManual(): void {
    const w = this.host.world();
    if (!playerCanAct(w)) return;
    this.host.apply(setDirect(w, !playerVehicle(w).direct));
    this.host.refreshPlan();
  }

  toggleAutoRepair(): void {
    const w = this.host.world();
    this.host.apply(setAutoRepair(w, !w.player.autoRepair));
  }

  // Overdrive changes speed, so the preview must rerun.
  toggleOverdrive(): void {
    const w = this.host.world();
    if (!playerCanAct(w)) return;
    const on = !w.player.overdrive;
    this.host.apply(setOverdrive(w, on));
    this.host.refreshPlan();
    if (on) this.host.revved();
  }

  douseEngine(): void {
    const w = this.host.world();
    if (!playerCanAct(w) || !canDouse(w)) return;
    this.host.apply(douseEngine(w));
    this.host.doused();
  }
}
