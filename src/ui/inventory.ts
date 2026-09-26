// Dredge-style inventory grid: drag items to arrange them, R or right click rotates while dragging.
// In a town the garage storage shows beside the grid.

import { GOODS } from '../data/goods';
import { partDef, type PartKind } from '../data/parts';
import { playerVehicle } from '../sim/damage';
import { gridOf, isMounted, itemCells, placementError, type Cell, type Spot } from '../sim/grid';
import { dumpGood, moveItem, storePart, takeFromStorage } from '../sim/inventory';
import { townAt } from '../sim/sites';
import type { GridItem, PartInstance, World } from '../sim/types';
import { el, panel } from './dom';
import type { UiHost } from './host';

const CELL_PX = 42;

const CELL_TITLE: Record<Cell, string> = {
  W: 'weapon mount',
  E: 'engine mount',
  C: 'cargo mount',
  F: 'front armor mount',
  B: 'back armor mount',
  L: 'left armor mount',
  R: 'right armor mount',
  X: 'built-in part',
  '.': '',
};
const KIND_CLASS: Record<PartKind, string> = { weapon: 'k-weapon', engine: 'k-engine', armor: 'k-armor', cargo: 'k-cargo', core: 'k-core', scanner: 'k-weapon' };

type Drag = {
  source: 'grid' | 'storage';
  id: string; // grid item id or storage part id
  item: GridItem; // the item as it would be placed, position updated while dragging
  grab: { x: number; y: number }; // grabbed cell inside the item
  ghost: HTMLElement;
};

export class InventoryView {
  private drag: Drag | null = null;
  private lastPointer: PointerEvent | null = null;
  private error = '';
  private gridEl: HTMLElement | null = null;
  private root: HTMLElement = el('div');

  constructor(private host: UiHost, private onChange: () => void) {
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onDrop(e));
    window.addEventListener('keydown', (e) => {
      if (this.drag && e.key.toLowerCase() === 'r') this.rotate();
    });
    window.addEventListener('contextmenu', (e) => {
      if (!this.drag) return;
      e.preventDefault();
      this.rotate();
    });
  }

  render(): HTMLElement {
    const w = this.host.world();
    const me = playerVehicle(w);
    const g = gridOf(me);
    const grid = el('div', { class: 'inv-grid', style: `width:${g.w * CELL_PX}px;height:${g.h * CELL_PX}px` });
    grid.addEventListener('contextmenu', (e) => e.preventDefault());
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const c = g.cells[y][x];
        if (c === null) continue;
        grid.append(el('div', { class: `inv-cell c-${c === '.' ? 'plain' : c}`, style: pos(x, y, 1, 1), title: CELL_TITLE[c] }, c === '.' || c === 'X' ? '' : c));
      }
    }
    for (const it of me.items) grid.append(this.itemEl(w, it));
    this.gridEl = grid;
    const inTown = townAt(w) !== null;
    this.root.replaceChildren(
      el('div', { class: 'inv-wrap' },
        el('div', {}, grid, this.legend()),
        el('div', { class: 'inv-side' },
          inTown ? this.storageEl(w) : el('div', { class: 'dim' }, 'Mounting or unmounting parts needs a town garage. Goods can be moved anywhere.'),
          el('div', { class: 'inv-dump', 'data-drop': 'dump' }, 'Drop goods here to dump them'),
        ),
      ),
      this.error ? el('div', { class: 'bad' }, this.error) : el('div'),
    );
    return this.root;
  }

  private legend(): HTMLElement {
    return el('div', { class: 'dim inv-legend' },
      el('div', {}, 'Top view, nose up. W E C: weapon, engine, cargo mounts. F B L R: armor mounts on the front, back, left and right.'),
      el('div', {}, 'A part works only when it lies fully on one of its letters. Built-in parts are fixed and can only be repaired.'),
      el('div', {}, 'Drag to move, R or right click to rotate.'),
    );
  }

  private itemEl(w: World, it: GridItem): HTMLElement {
    const me = playerVehicle(w);
    const cells = itemCells(it);
    const x = Math.min(...cells.map((c) => c.x));
    const y = Math.min(...cells.map((c) => c.y));
    const wd = Math.max(...cells.map((c) => c.x)) - x + 1;
    const ht = Math.max(...cells.map((c) => c.y)) - y + 1;
    const label = itemLabel(it);
    const mounted = it.kind === 'part' && isMounted(me.chassisId, it);
    const core = it.kind === 'part' && partDef(it.part.defId).kind === 'core';
    const state = core ? 'fixed' : mounted ? 'mounted' : 'spare';
    const cls = it.kind === 'part' ? `${KIND_CLASS[partDef(it.part.defId).kind]} ${state}` : `k-good g-${it.good}`;
    const node = el('div', { class: `inv-item ${cls}`, style: pos(x, y, wd, ht), title: itemTitle(it, mounted) }, label.short);
    if (it.kind === 'part') node.append(conditionBar(it.part));
    if (!core) node.addEventListener('pointerdown', (e) => this.startDrag(e, 'grid', it.id, it, { x: Math.floor(e.offsetX / CELL_PX), y: Math.floor(e.offsetY / CELL_PX) }));
    return node;
  }

  private storageEl(w: World): HTMLElement {
    const chips = w.player.storage.map((p) => {
      const d = partDef(p.defId);
      const chip = el('div', { class: `inv-chip ${KIND_CLASS[d.kind]}`, title: partTitle(p) }, `${d.name} ${d.w}x${d.h} ${p.hp}/${d.hp}`);
      const item: GridItem = { id: `store-${p.id}`, x: 0, y: 0, rot: 0, kind: 'part', part: p };
      chip.addEventListener('pointerdown', (e) => this.startDrag(e, 'storage', p.id, item, { x: 0, y: 0 }));
      return chip;
    });
    return el('div', { class: 'inv-storage', 'data-drop': 'storage' },
      el('h3', {}, 'Garage storage'),
      ...(chips.length ? chips : [el('div', { class: 'dim' }, 'Drop parts here to store them.')]),
    );
  }

  private startDrag(e: PointerEvent, source: Drag['source'], id: string, item: GridItem, grab: { x: number; y: number }): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const ghost = el('div', { class: 'inv-ghost' });
    document.body.append(ghost);
    this.drag = { source, id, item: { ...item }, grab, ghost };
    this.error = '';
    this.onMove(e);
  }

  private rotate(): void {
    if (!this.drag) return;
    this.drag.item = { ...this.drag.item, rot: this.drag.item.rot === 0 ? 1 : 0 };
    this.drag.grab = { x: 0, y: 0 };
    if (this.lastPointer) this.onMove(this.lastPointer);
  }

  private onMove(e: PointerEvent): void {
    this.lastPointer = e;
    if (!this.drag) return;
    const spot = this.spotAt(e.clientX, e.clientY);
    if (spot) this.drag.item = { ...this.drag.item, x: spot.x, y: spot.y };
    this.paintGhost(e, spot !== null);
  }

  // The ghost shows the item's footprint: green where it fits, red where it does not.
  private paintGhost(e: PointerEvent, onGrid: boolean): void {
    const d = this.drag!;
    const size = footprint(d.item);
    const g = this.gridEl?.getBoundingClientRect();
    const ok = onGrid && this.placementProblem(d) === null;
    d.ghost.className = `inv-ghost ${onGrid ? (ok ? 'ok' : 'no') : ''}`;
    d.ghost.textContent = itemLabel(d.item).short;
    d.ghost.style.width = `${size.w * CELL_PX}px`;
    d.ghost.style.height = `${size.h * CELL_PX}px`;
    if (onGrid && g) {
      d.ghost.style.left = `${g.left + d.item.x * CELL_PX}px`;
      d.ghost.style.top = `${g.top + d.item.y * CELL_PX}px`;
    } else {
      d.ghost.style.left = `${e.clientX - CELL_PX / 2}px`;
      d.ghost.style.top = `${e.clientY - CELL_PX / 2}px`;
    }
  }

  private placementProblem(d: Drag): string | null {
    const me = playerVehicle(this.host.world());
    const others = me.items.filter((it) => it.id !== d.id);
    return placementError(gridOf({ ...me, items: [...others, d.item] }), others, d.item, null);
  }

  private spotAt(cx: number, cy: number): Spot | null {
    if (!this.gridEl || !this.drag) return null;
    const r = this.gridEl.getBoundingClientRect();
    if (cx < r.left || cy < r.top || cx >= r.right || cy >= r.bottom) return null;
    const x = Math.floor((cx - r.left) / CELL_PX) - this.drag.grab.x;
    const y = Math.floor((cy - r.top) / CELL_PX) - this.drag.grab.y;
    return { x, y, rot: this.drag.item.rot };
  }

  private onDrop(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost.remove();
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-drop]')?.getAttribute('data-drop');
    const onGrid = this.gridEl !== null && this.inside(e);
    this.run((w) => {
      if (onGrid) {
        const to = { x: d.item.x, y: d.item.y, rot: d.item.rot };
        return d.source === 'grid' ? moveItem(w, d.id, to) : takeFromStorage(w, d.id, to);
      }
      if (target === 'storage' && d.source === 'grid') return storePart(w, d.id);
      if (target === 'dump' && d.source === 'grid') return dumpGood(w, d.id);
      return w;
    });
  }

  private inside(e: PointerEvent): boolean {
    const r = this.gridEl!.getBoundingClientRect();
    return e.clientX >= r.left && e.clientY >= r.top && e.clientX < r.right && e.clientY < r.bottom;
  }

  private run(cmd: (w: World) => World): void {
    try {
      const next = cmd(this.host.world());
      if (next !== this.host.world()) this.host.apply(next);
      this.error = '';
    } catch (err) {
      this.error = (err as Error).message;
    }
    this.onChange();
  }
}

// Standalone inventory window, opened with I.
export class InventoryScreen {
  private root = panel('modal');
  private view: InventoryView;

  constructor(host: UiHost) {
    this.root.style.display = 'none';
    this.view = new InventoryView(host, () => this.render());
  }

  isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  toggle(): void {
    if (this.isOpen()) return this.close();
    this.root.style.display = '';
    this.render();
  }

  // Closed windows drop their contents, so hidden copies never answer clicks or drops.
  close(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    this.root.replaceChildren(
      el('button', { class: 'close', onclick: () => this.close() }, 'Close [I]'),
      el('h3', {}, 'Truck inventory'),
      this.view.render(),
    );
  }
}

function pos(x: number, y: number, w: number, h: number): string {
  return `left:${x * CELL_PX}px;top:${y * CELL_PX}px;width:${w * CELL_PX}px;height:${h * CELL_PX}px`;
}

function footprint(it: GridItem): { w: number; h: number } {
  const cells = itemCells({ ...it, x: 0, y: 0 });
  return { w: Math.max(...cells.map((c) => c.x)) + 1, h: Math.max(...cells.map((c) => c.y)) + 1 };
}

function itemLabel(it: GridItem): { short: string } {
  if (it.kind === 'good') return { short: GOODS[it.good].name.slice(0, 5) };
  return { short: partDef(it.part.defId).name };
}

function itemTitle(it: GridItem, mounted: boolean): string {
  if (it.kind === 'good') return GOODS[it.good].name;
  if (partDef(it.part.defId).kind === 'core') return `${partTitle(it.part)}\nBuilt in: cannot be moved, only repaired`;
  return `${partTitle(it.part)}\n${mounted ? 'Mounted and working' : 'Spare: not on a matching mount'}`;
}

// Thin bar along the bottom of a part: its width is hp over max hp. A broken part shows a red bar.
function conditionBar(p: PartInstance): HTMLElement {
  const max = partDef(p.defId).hp;
  return el('div', { class: `inv-hp${p.hp > 0 ? '' : ' broken'}` }, el('div', { style: `width:${(p.hp / max) * 100}%` }));
}

function partTitle(p: PartInstance): string {
  const d = partDef(p.defId);
  return `${d.name} (${d.kind}) ${p.hp}/${d.hp} HP, ${d.w}x${d.h}`;
}
