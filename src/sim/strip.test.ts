import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { chooseOption, currentOptions, hangUp } from './dialogue';
import { isHostile } from './combat';
import { corePart, mountedParts } from './grid';
import { addGoods } from './inventory';
import { CONDITIONS } from './dialogue-rules';
import { hasCargo } from './salvage';
import { aimAt } from './parley';
import { addState, stateOf } from './states';
import { topGoal } from './npc-activities';
import { addVehicle, emptyWorld, forceOption, npcBrain, testDrive } from './testkit';
import type { Vehicle, World } from './types';
import { endTurn } from './world';

// A raider with a machine gun sees a stranded player who carries goods. It always picks the fight.
function strandedAmbush(): { w: World; raider: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  addGoods(w, playerVehicle(w), 'scrap', 2);
  w.player.fuel = 0;
  const raider = addVehicle(w, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 30 }, Math.PI);
  raider.brain = npcBrain('buggy', raider.pos, ['raider']);
  forceOption('hostileSeen', 'fight');
  return { w, raider };
}

const shotsAtPlayer = (w: World, raider: Vehicle) => w.events.filter((e) => e.t === 'shot' && e.shooter === raider.id && e.target === w.player.vehicleId);

function pick(w: World, text: string): World {
  const index = currentOptions(w).findIndex((o) => o.text === text);
  if (index < 0) throw new Error(`No option "${text}"`);
  return chooseOption(w, index);
}

describe('surrender offer to a stranded player', () => {
  it('a raider alone with a stranded player radios an offer before it shoots, and asks only once', () => {
    const { w: start, raider } = strandedAmbush();
    let w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: raider.id, topic: 'surrender' });
    expect(shotsAtPlayer(w, raider)).toEqual([]);
    w = pick(w, 'Come and get it.');
    for (let i = 0; i < 6; i++) {
      w = endTurn(w, testDrive);
      expect(w.player.call).toBeNull();
    }
  });

  it('accepting takes the cargo and the best parts, leaves the truck, and holds a truce', () => {
    const { w: start, raider } = strandedAmbush();
    const me = playerVehicle(start);
    const before = mountedParts(me).length;
    let w = pick(endTurn(start, testDrive), 'Fine. Take it.');
    const after = playerVehicle(w);
    expect(hasCargo(after)).toBe(false);
    expect(mountedParts(after).length).toBe(before - RULES.surrenderParts);
    expect(corePart(after, 'cab')).toBeDefined();
    expect(stateOf(w, 'truce', raider.id, after.id)).not.toBeNull();
    expect(isHostile(w, w.vehicles.find((v) => v.id === raider.id)!, after)).toBe(false);
    expect(topGoal(w.vehicles.find((v) => v.id === raider.id)!)).toMatchObject({ kind: 'loot' });
    for (let i = 0; i < 5; i++) {
      w = endTurn(w, testDrive);
      expect(shotsAtPlayer(w, raider)).toEqual([]);
    }
  });

  it('refusing makes every shot aim at the cab', () => {
    const { w: start, raider } = strandedAmbush();
    let w = pick(endTurn(start, testDrive), 'Come and get it.');
    const cab = corePart(playerVehicle(w), 'cab').id;
    const aims = new Set<string>();
    for (let i = 0; i < 4; i++) {
      w = endTurn(w, testDrive);
      for (const e of shotsAtPlayer(w, raider)) if (e.t === 'shot') aims.add(e.aim);
    }
    expect([...aims]).toEqual([cab]);
  });

  it('hanging up counts as refusing', () => {
    const { w: start, raider } = strandedAmbush();
    let w = hangUp(endTurn(start, testDrive));
    w = endTurn(w, testDrive);
    const cab = corePart(playerVehicle(w), 'cab').id;
    const shots = shotsAtPlayer(w, raider);
    expect(shots.length).toBeGreaterThan(0);
    for (const e of shots) if (e.t === 'shot') expect(e.aim).toBe(cab);
  });

  it('a knocked-out player is looted by the raider', () => {
    const { w: start, raider } = strandedAmbush();
    let w = pick(endTurn(start, testDrive), 'Come and get it.');
    for (let i = 0; i < 40 && w.player.state === 'active'; i++) w = endTurn(w, testDrive);
    expect(w.player.state).toBe('knockedOut');
    expect(topGoal(w.vehicles.find((v) => v.id === raider.id)!)).toMatchObject({ kind: 'loot', targetId: w.player.vehicleId });
  });

  it('a second hostile in the raider sight keeps the normal fight: no offer, body aim', () => {
    const { w: start, raider } = strandedAmbush();
    const lawman = addVehicle(start, 'bowl', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 34 });
    lawman.brain = npcBrain('bowlFarmer', lawman.pos, ['lawman', 'brave']);
    const w = endTurn(start, testDrive);
    const me = playerVehicle(w);
    const mugger = w.vehicles.find((v) => v.id === raider.id)!;
    w.player.talked[mugger.id] = { surrender: 'refused' };
    mugger.brain!.goals.push({ kind: 'fight', targetId: me.id, destination: { ...me.pos }, phase: 'travel', reason: 'test', perceived: w.turn });
    expect(w.player.call?.topic).not.toBe('surrender');
    expect(CONDITIONS.demandsSurrender(w, mugger, {})).toBe(false);
    w.vehicles = w.vehicles.filter((v) => v.id !== lawman.id);
    expect(CONDITIONS.demandsSurrender(w, mugger, {})).toBe(true);
    expect(aimAt(w, mugger, me)).toBe(corePart(me, 'cab').id);
    w.vehicles.push(lawman);
    expect(aimAt(w, mugger, me)).toBe('body');
  });
});

// A lawman on patrol with a machine gun fights a stranded player who carries goods. It takes nothing.
function strandedByLawman(): { w: World; lawman: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  addGoods(w, playerVehicle(w), 'scrap', 2);
  w.player.fuel = 0;
  const lawman = addVehicle(w, 'bowl', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 30 }, Math.PI);
  lawman.brain = npcBrain('bowlFarmer', lawman.pos, ['lawman']);
  addState(w, 'feud', lawman.id, w.player.vehicleId, { kind: 'feud', robbery: false });
  forceOption('hostileSeen', 'fight');
  return { w, lawman };
}

describe('plain surrender to a stranded player', () => {
  it('a lawman alone with a stranded player radios a plain offer, not a strip demand', () => {
    const { w: start, lawman } = strandedByLawman();
    const w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: lawman.id, topic: 'giveUp' });
    expect(currentOptions(w).map((o) => o.text)).toContain('Standing down.');
  });

  it('accepting ends the fight, holds a truce and takes nothing', () => {
    const { w: start, lawman } = strandedByLawman();
    const before = mountedParts(playerVehicle(start)).length;
    let w = pick(endTurn(start, testDrive), 'Standing down.');
    const after = playerVehicle(w);
    expect(hasCargo(after)).toBe(true);
    expect(mountedParts(after).length).toBe(before);
    expect(stateOf(w, 'truce', lawman.id, after.id)).not.toBeNull();
    expect(isHostile(w, w.vehicles.find((v) => v.id === lawman.id)!, after)).toBe(false);
    for (let i = 0; i < 5; i++) {
      w = endTurn(w, testDrive);
      expect(shotsAtPlayer(w, lawman)).toEqual([]);
    }
  });

  it('refusing makes every shot aim at the cab', () => {
    const { w: start, lawman } = strandedByLawman();
    let w = pick(endTurn(start, testDrive), 'Come and get it.');
    const cab = corePart(playerVehicle(w), 'cab').id;
    const aims = new Set<string>();
    for (let i = 0; i < 10; i++) {
      w = endTurn(w, testDrive);
      for (const e of shotsAtPlayer(w, lawman)) if (e.t === 'shot') aims.add(e.aim);
    }
    expect([...aims]).toEqual([cab]);
  });

  it('a second hostile in sight keeps the normal fight: no offer', () => {
    const { w: start, lawman } = strandedByLawman();
    const other = addVehicle(start, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 34 });
    other.brain = npcBrain('buggy', other.pos, ['raider']);
    const w = endTurn(start, testDrive);
    expect(w.player.call?.topic).not.toBe('giveUp');
    expect(CONDITIONS.demandsGiveUp(w, w.vehicles.find((v) => v.id === lawman.id)!, {})).toBe(false);
  });
});
