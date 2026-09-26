// Town screen: trade, supplies, garage and trucks.

import { chassisDef, PLAYER_CHASSIS } from '../data/chassis';
import { ECONOMY, GOOD_IDS, GOODS } from '../data/goods';
import { PARTS, partDef, type PartDef } from '../data/parts';
import { playerVehicle } from '../sim/damage';
import {
  buyChassis, buyGood, buyPart, buyPrice, buySupply, chassisTradeIn, partSellPrice, repairAll, repairCost, sellGood, sellPart,
  sellPrice, supplyRoom, type Supply,
} from '../sim/economy';
import { baseGrid, cellCount, corePart, freeCells, goodsCount, mountedParts } from '../sim/grid';
import { townAt } from '../sim/sites';
import type { PartInstance, Vehicle, World } from '../sim/types';
import { el, panel } from './dom';
import { InventoryView } from './inventory';
import type { UiHost } from './host';

type Tab = 'trade' | 'supplies' | 'garage' | 'trucks';

export class TownScreen {
  private root = panel('modal');
  private tab: Tab = 'trade';
  private error = '';

  private inventory: InventoryView;

  constructor(private host: UiHost) {
    this.root.style.display = 'none';
    this.inventory = new InventoryView(host, () => this.render());
  }

  isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  open(): void {
    this.root.style.display = '';
    this.error = '';
    this.render();
  }

  // Closed windows drop their contents, so hidden copies never answer clicks or drops.
  close(): void {
    this.root.style.display = 'none';
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    const w = this.host.world();
    const town = townAt(w);
    if (!town) return this.close();
    const me = playerVehicle(w);
    const tabs = (['trade', 'supplies', 'garage', 'trucks'] as Tab[]).map((t) =>
      el('button', { class: this.tab === t ? 'on' : '', onclick: () => { this.tab = t; this.render(); } }, t[0].toUpperCase() + t.slice(1)),
    );
    const body = { trade: () => this.trade(w, town.id), supplies: () => this.supplies(w), garage: () => this.garage(w), trucks: () => this.trucks(w) }[this.tab]();
    this.root.replaceChildren(
      el('button', { class: 'close', onclick: () => this.close() }, 'Leave [Esc]'),
      el('h3', {}, town.name),
      el('div', { class: 'dim' }, `Money ${w.player.money}   Free cells ${freeCells(me)}`),
      el('div', { class: 'tabs' }, ...tabs),
      this.error ? el('div', { class: 'bad' }, this.error) : el('div'),
      body,
    );
  }

  // Runs a command; a thrown rule error shows in the screen instead of changing the world.
  private run(cmd: (w: World) => World): void {
    try {
      this.host.apply(cmd(this.host.world()));
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.render();
  }

  private trade(w: World, townId: string): HTMLElement {
    const me = playerVehicle(w);
    const rows = GOOD_IDS.map((g) => {
      const held = goodsCount(me)[g] ?? 0;
      const basis = w.player.costBasis[g];
      return el('tr', {},
        el('td', {}, GOODS[g].name),
        el('td', {}, `${buyPrice(w, townId, g)}`),
        el('td', {}, `${sellPrice(w, townId, g)}`),
        el('td', {}, held ? `${held} (paid ~${Math.round(basis ?? 0)})` : '-'),
        el('td', {},
          el('button', { onclick: () => this.run((x) => buyGood(x, g, 1)) }, 'Buy 1'), ' ',
          el('button', { onclick: () => this.run((x) => buyGood(x, g, 5)) }, 'Buy 5'), ' ',
          el('button', { disabled: held === 0, onclick: () => this.run((x) => sellGood(x, g, 1)) }, 'Sell 1'), ' ',
          el('button', { disabled: held === 0, onclick: () => this.run((x) => sellGood(x, g, held)) }, 'Sell all'),
        ),
      );
    });
    return el('table', {}, el('tr', {}, el('th', {}, 'Good'), el('th', {}, 'Buy'), el('th', {}, 'Sell'), el('th', {}, 'Held'), el('th', {})), ...rows);
  }

  private supplies(w: World): HTMLElement {
    const rows = (['fuel', 'supplies'] as Supply[]).map((k) => {
      const room = supplyRoom(w, k);
      const price = ECONOMY.supplyPrice[k];
      const afford = Math.min(room, Math.floor(w.player.money / price));
      return el('tr', {},
        el('td', {}, k),
        el('td', {}, `${w.player[k].toFixed(1)}`),
        el('td', {}, `${price} each`),
        el('td', {},
          el('button', { disabled: afford < 1, onclick: () => this.run((x) => buySupply(x, k, 1)) }, 'Buy 1'), ' ',
          el('button', { disabled: afford < 1, onclick: () => this.run((x) => buySupply(x, k, afford)) }, `Fill (${afford})`),
        ),
      );
    });
    return el('table', {}, el('tr', {}, el('th', {}, 'Supply'), el('th', {}, 'Have'), el('th', {}, 'Price'), el('th', {})), ...rows);
  }

  private garage(w: World): HTMLElement {
    const me = playerVehicle(w);
    const cost = repairCost(w);
    const stored = w.player.storage.map((s) =>
      el('tr', {}, el('td', { class: 'dim' }, partDef(s.defId).kind), el('td', {}, partLabel(s)),
        el('td', {}, el('button', { onclick: () => this.run((x) => sellPart(x, s.id)) }, `Sell for ${partSellPrice(s)}`))),
    );
    const shop = Object.values(PARTS).filter((d) => d.kind !== 'core').map((d) =>
      el('tr', {}, el('td', { class: 'dim' }, d.kind), el('td', {}, `${d.name} ${d.w}x${d.h}: ${partStats(d)}`),
        el('td', {}, el('button', { disabled: w.player.money < d.price, onclick: () => this.run((x) => buyPart(x, d.id)) }, `Buy ${d.price}`))),
    );
    return el('div', {},
      el('div', {}, `${cabLine(me)}. `,
        el('button', { disabled: cost === 0, onclick: () => this.run(repairAll) }, `Repair all: ${cost}`)),
      el('h3', {}, 'Truck'), this.inventory.render(),
      el('h3', {}, 'Sell stored parts'), stored.length ? el('table', {}, ...stored) : el('div', { class: 'dim' }, 'Storage is empty'),
      el('h3', {}, 'Shop (bought parts go to storage)'), el('table', {}, ...shop),
    );
  }

  private trucks(w: World): HTMLElement {
    const me = playerVehicle(w);
    const tradeIn = chassisTradeIn(w);
    const rows = PLAYER_CHASSIS.map((id) => {
      const c = chassisDef(id);
      const mine = me.chassisId === id;
      const cost = Math.max(0, c.price - tradeIn);
      return el('tr', {},
        el('td', {}, c.name),
        el('td', { class: 'dim' }, `speed ${c.maxSpeed}, turn ${c.turnFast}-${c.turnSlow}, ${cellCount(baseGrid(id))} cells`),
        el('td', {}, mine ? 'yours' : el('button', { disabled: w.player.money < cost, onclick: () => this.run((x) => buyChassis(x, id)) }, `Swap for ${cost}`)),
      );
    });
    return el('div', {}, el('div', { class: 'dim' }, `Your truck trades in for ${tradeIn}. Parts and goods move over. Parts that do not fit go to storage.`), el('table', {}, ...rows));
  }
}

function cabLine(v: Vehicle): string {
  const cab = corePart(v, 'cab');
  const broken = mountedParts(v).filter((p) => p.hp === 0).length;
  return `Cab ${cab.hp}/${partDef(cab.defId).hp}, ${broken} broken ${broken === 1 ? 'part' : 'parts'}`;
}

function partLabel(p: PartInstance): string {
  const d = partDef(p.defId);
  return `${d.name} ${p.hp}/${d.hp}${p.hp === 0 ? ' BROKEN' : ''}`;
}

function partStats(d: PartDef): string {
  return `${kindStats(d)}, armor ${d.armor}, ${d.mass} kg`;
}

function kindStats(d: PartDef): string {
  switch (d.kind) {
    case 'weapon': return `${d.rounds} × dmg ${d.round.damage}, pen ${d.round.pen}, spread ${d.spread}°, range ${d.range}, reload ${d.reload}, arc ${d.arc}`;
    case 'engine': return `speed ${d.speedBonus >= 0 ? '+' : ''}${d.speedBonus}, accel ${d.accelBonus >= 0 ? '+' : ''}${d.accelBonus}, fuel x${d.fuelMult}`;
    case 'armor': return d.ramMult > 1 ? `ram x${d.ramMult}` : 'side armor';
    case 'cargo': return `+${d.extraRows} grid rows`;
    case 'core': return `built-in ${d.role}`;
  }
}
