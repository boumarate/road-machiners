// Event log lines.

import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { mountedParts } from '../sim/grid';
import type { GameEvent, Vehicle, World } from '../sim/types';

export function vehicleName(world: World, id: string): string {
  if (id === world.player.vehicleId) return 'You';
  const v = findAny(world, id);
  return v ? v.name : id.startsWith('wreck') || id.startsWith('rock') || id.startsWith('bld') ? 'an obstacle' : 'something';
}

function findAny(world: World, id: string): Vehicle | undefined {
  return world.vehicles.find((v) => v.id === id) ?? world.removed.find((v) => v.id === id);
}

function partName(world: World, vehicleId: string, partId: string): string {
  const v = findAny(world, vehicleId);
  const p = v && mountedParts(v).find((x) => x.id === partId);
  return p ? partDef(p.defId).name : 'part';
}

// Returns null for events not worth a log line.
export function eventText(world: World, e: GameEvent): { text: string; cls: string } | null {
  const n = (id: string) => vehicleName(world, id);
  const me = world.player.vehicleId;
  switch (e.t) {
    case 'collision': {
      const b = e.b === 'edge' ? 'the map edge' : e.b.startsWith('v') ? n(e.b) : 'an obstacle';
      if (e.a !== me && e.b !== me && e.damageA + e.damageB < 1) return null;
      return { text: `${n(e.a)} crashed into ${b}: ${e.damageA} / ${e.damageB} damage`, cls: e.a === me || e.b === me ? 'bad' : 'dim' };
    }
    case 'shot': {
      if (e.shooter !== me && e.target !== me) return null;
      const aim = e.aim === 'body' ? '' : ` at ${partName(world, e.target, e.aim)}`;
      const hits = e.rounds.filter((r) => r.hit).length;
      const dealt = new Map<string, number>();
      for (const h of e.rounds.flatMap((r) => r.hits)) dealt.set(h.part, (dealt.get(h.part) ?? 0) + h.damage);
      const parts = [...dealt].filter(([, d]) => d > 0).map(([id, d]) => `, ${partName(world, e.target, id)} −${d}`).join('');
      const text = `${partName(world, e.shooter, e.weapon)} → ${n(e.target)}${aim}: ${hits}/${e.rounds.length} hits${parts} (${Math.round(e.chance * 100)}%)`;
      return { text, cls: e.target === me && dealt.size > 0 ? 'bad' : '' };
    }
    case 'partDisabled':
      return { text: `${n(e.vehicle)}: ${partName(world, e.vehicle, e.part)} disabled`, cls: e.vehicle === me ? 'bad' : 'good' };
    case 'destroyed':
      return { text: `${n(e.vehicle)} destroyed`, cls: 'good' };
    case 'hostile':
      return e.against === me ? { text: `${n(e.vehicle)} turns hostile to you`, cls: 'bad' } : null;
    case 'xp':
      return { text: `+${e.amount} XP: ${e.reason}`, cls: 'good' };
    case 'levelUp':
      return { text: `Level ${e.level}! Skill point gained. Press C.`, cls: 'good' };
    case 'money':
      return { text: `${e.amount > 0 ? '+' : ''}${e.amount} money: ${e.reason}`, cls: e.amount > 0 ? 'good' : 'bad' };
    case 'discover': {
      const loc = [...REGION.towns, ...REGION.locations].find((l) => l.id === e.location);
      return { text: `Discovered ${loc?.name ?? e.location}`, cls: 'good' };
    }
    case 'supply':
      return { text: e.text, cls: 'bad' };
    case 'defeat':
      return { text: 'Robbed. You patch your truck enough to crawl back, but the tank is empty.', cls: 'bad' };
    case 'info':
      return { text: e.text, cls: 'dim' };
    case 'spawn':
    case 'despawn':
    case 'arrived':
      return null;
  }
}
