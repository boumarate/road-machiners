// Event log lines.

import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { mountedParts } from '../sim/grid';
import { playerSees } from '../sim/vision';
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

export function formatNpcActivity(world: World, vehicle: Vehicle): string | null {
  const activity = vehicle.brain?.activity;
  if (!activity || !playerSees(world, vehicle.pos)) return null;
  const target = world.vehicles.find((v) => v.id === activity.targetId);
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === activity.targetId);
  const label = target && playerSees(world, target.pos) ? target.name : site && world.player.discovered.includes(site.id) ? site.name : null;
  return `${activity.kind}${label ? `: ${label}` : ''} — ${activity.reason}`;
}

// Returns null for events not worth a log line.
export function eventText(world: World, e: GameEvent): { text: string; cls: string } | null {
  const n = (id: string) => vehicleName(world, id);
  const me = world.player.vehicleId;
  switch (e.t) {
    case 'activity': {
      const vehicle = world.vehicles.find((v) => v.id === e.vehicle);
      return vehicle && playerSees(world, vehicle.pos) ? { text: `${vehicle.name}: ${e.activity} — ${e.reason}`, cls: 'dim' } : null;
    }
    case 'collision': {
      const b = e.b === 'edge' ? 'the map edge' : e.b.startsWith('v') ? n(e.b) : 'an obstacle';
      if (e.a !== me && e.b !== me && e.damageA + e.damageB < 1) return null;
      return { text: `${n(e.a)} crashed into ${b}: ${e.damageA} / ${e.damageB} damage`, cls: e.a === me || e.b === me ? 'bad' : 'dim' };
    }
    case 'shot': {
      if (e.shooter !== me && e.target !== me) return null;
      const aim = e.aim === 'hull' ? '' : ` at ${partName(world, e.target, e.aim)}`;
      const what = e.hit ? `hit for ${e.damage}` : 'missed';
      return { text: `${n(e.shooter)} shot ${n(e.target)}${aim}: ${what} (${Math.round(e.chance * 100)}%)`, cls: e.target === me && e.hit ? 'bad' : '' };
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
