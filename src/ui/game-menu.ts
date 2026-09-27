// Save, load and new game buttons. Load and new game reload the page, and boot reads the save.

import { el, panel, topRight } from "./dom";

export type GameMenuActions = {
  save: () => void;
  hasSave: () => boolean;
  clearSave: () => void;
  isBusy: () => boolean;
};

// Boot loads the last save, so loading is a page reload.
export function loadLastSave(): void {
  window.location.reload();
}

export function startNewGame(clearSave: () => void): void {
  clearSave();
  window.location.reload();
}

export class GameMenu {
  private root = panel("game-menu", topRight());
  private saveButton = el("button", { onclick: () => this.save(), title: "Save the game now" }, "Save") as HTMLButtonElement;
  private loadButton = el("button", { onclick: () => this.load(), title: "Load the last save" }, "Load") as HTMLButtonElement;
  private newButton = el("button", { onclick: () => this.newGame(), title: "Delete the save and start over" }, "New game") as HTMLButtonElement;

  constructor(private actions: GameMenuActions) {
    this.root.append(this.saveButton, this.loadButton, this.newButton);
    this.refresh();
  }

  refresh(): void {
    const busy = this.actions.isBusy();
    this.saveButton.disabled = busy;
    this.loadButton.disabled = busy || !this.actions.hasSave();
    this.newButton.disabled = busy;
  }

  private save(): void {
    this.actions.save();
    this.saveButton.textContent = "Saved";
    window.setTimeout(() => (this.saveButton.textContent = "Save"), 1200);
    this.refresh();
  }

  private load(): void {
    if (!window.confirm("Load the last save? Progress since then is lost.")) return;
    loadLastSave();
  }

  private newGame(): void {
    if (!window.confirm("Start a new game? The current save is deleted.")) return;
    startNewGame(this.actions.clearSave);
  }
}
