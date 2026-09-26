import { expect, it } from 'vitest';
import { addVehicle, emptyWorld } from './testkit';
import { autoOrders, fireWeapons } from './combat';

it('NPCs cannot target or fire through an occluding rock', () => {
  const w = emptyWorld({ x: 10, y: 10 });
  const npc = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
  w.obstacles.push({ id: 'screen', pos: { x: 12, y: 10 }, r: 1, kind: 'rock' });
  autoOrders(w, npc);
  expect(npc.weaponOrders).toEqual({});
  const weapon = npc.items.find((item) => item.kind === 'part' && item.part.defId === 'mg')!;
  if (weapon.kind !== 'part') throw new Error('Missing test weapon');
  npc.weaponOrders[weapon.part.id] = { targetId: w.player.vehicleId, aim: 'hull' };
  fireWeapons(w);
  expect(w.events.filter((event) => event.t === 'shot')).toEqual([]);
});
