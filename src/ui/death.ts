// The fullscreen death screen. A dead run takes no more turns or commands, so it covers the whole game.
// Load last save reloads the page, and New game deletes the save first.

import { el, panel } from "./dom";
import { loadLastSave, startNewGame } from "./game-menu";

export type DeathActions = {
  hasSave: () => boolean;
  clearSave: () => void;
};

export class DeathScreen {
  private root: HTMLElement | null = null;

  constructor(private actions: DeathActions) {}

  isShown(): boolean {
    return this.root !== null;
  }

  show(): void {
    if (this.root) return;
    const saved = this.actions.hasSave();
    this.root = panel("death");
    this.root.setAttribute("role", "alertdialog");
    this.root.setAttribute("aria-label", "You died");
    this.root.append(
      el("h3", {}, "You died"),
      el("div", { class: "dim" }, saved ? "The run ends here. Your last save is kept." : "The run ends here. There is no save yet."),
      el(
        "div",
        { class: "death-buttons" },
        el("button", { onclick: () => loadLastSave(), disabled: !saved }, "Load last save"),
        el("button", { onclick: () => startNewGame(this.actions.clearSave) }, "New game"),
      ),
    );
  }
}
