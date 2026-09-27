// Event log lines.

import { partDef } from '../data/parts';
import { TERRAIN } from '../data/terrain';
import { playerVehicle } from '../sim/damage';
import { dist, type Vec } from '../sim/vec';
import { REGION } from '../data/region';
import { mountedParts } from '../sim/grid';
import { playerSees } from '../sim/vision';
import type { PartHit } from '../sim/armor';
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

// Damage summed per part, parts with no damage left out.
function partDamage(hits: PartHit[]): Map<string, number> {
  const dealt = new Map<string, number>();
  for (const h of hits) if (h.damage > 0) dealt.set(h.part, (dealt.get(h.part) ?? 0) + h.damage);
  return dealt;
}

// "; Buggy: Engine −12, Wheel −5" for the parts one vehicle lost in a crash, or empty.
function damageList(world: World, vehicleId: string, hits: PartHit[]): string {
  const dealt = partDamage(hits);
  if (dealt.size === 0) return '';
  return `; ${vehicleName(world, vehicleId)}: ${[...dealt].map(([id, d]) => `${partName(world, vehicleId, id)} −${d}`).join(', ')}`;
}

// Returns null for events not worth a log line.
export function eventText(world: World, e: GameEvent): { text: string; cls: string } | null {
  const n = (id: string) => vehicleName(world, id);
  const me = world.player.vehicleId;
  switch (e.t) {
    case 'activity': {
      const vehicle = world.vehicles.find((v) => v.id === e.vehicle);
      return vehicle && playerSees(world, vehicle.pos) ? { text: `${vehicle.name}: ${e.activity ?? 'idle'} — ${e.reason}`, cls: 'dim' } : null;
    }
    case 'collision': {
      const b = e.b === 'edge' ? 'the map edge' : e.b === 'rail' ? 'the bridge rail' : e.b.startsWith('v') ? n(e.b) : 'an obstacle';
      const dealt = [...e.hitsA, ...e.hitsB].reduce((sum, h) => sum + h.damage, 0);
      if (e.a !== me && e.b !== me && dealt < 1) return null;
      const text = `${n(e.a)} crashed into ${b}${damageList(world, e.a, e.hitsA)}${damageList(world, e.b, e.hitsB)}`;
      return { text, cls: e.a === me || e.b === me ? 'bad' : 'dim' };
    }
    case 'shot': {
      if (e.shooter !== me && e.target !== me) return null;
      const aim = e.aim === 'body' ? '' : ` at ${partName(world, e.target, e.aim)}`;
      const hits = e.rounds.filter((r) => r.hit).length;
      const crits = e.rounds.filter((r) => r.crit).length;
      const dealt = partDamage(e.rounds.flatMap((r) => r.hits));
      const parts = [...dealt].map(([id, d]) => `, ${partName(world, e.target, id)} −${d}`).join('');
      const text = `${partName(world, e.shooter, e.weapon)} → ${n(e.target)}${aim}: ${hits}/${e.rounds.length} hits${crits ? `, ${crits} crit` : ''}${parts} (${Math.round(e.chance * 100)}%)`;
      return { text, cls: e.target === me && dealt.size > 0 ? 'bad' : '' };
    }
    case 'guardShot': {
      const target = findAny(world, e.target);
      if (!target || !playerSees(world, target.pos)) return null;
      const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === e.site)!;
      const hits = e.rounds.filter((r) => r.hit).length;
      const parts = [...partDamage(e.rounds.flatMap((r) => r.hits))].map(([id, d]) => `, ${partName(world, e.target, id)} −${d}`).join('');
      return { text: `${site.name} guards → ${n(e.target)}: ${hits}/${e.rounds.length} hits${parts}`, cls: 'dim' };
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
    case 'job': {
      if (e.vehicle !== me) return null;
      const what = e.job.kind === 'repair' ? `Repair (${partName(world, e.vehicle, e.job.partId)})` : 'Search';
      const text = e.outcome === 'started' ? `${what} started: stay parked about ${e.job.turnsLeft} turns. End turns with Space.`
        : e.outcome === 'cancelled' ? `${what} cancelled: the truck moved` : `${what} done`;
      return { text, cls: e.outcome === 'cancelled' ? 'bad' : e.outcome === 'done' ? 'good' : '' };
    }
    case 'searched': {
      const site = [...REGION.towns, ...REGION.locations].find((l) => l.id === e.stock);
      return { text: `Search done${site ? ` at ${site.name}` : ''}. Drag what you want into the truck.`, cls: 'good' };
    }
    case 'breakdown':
      return e.vehicle === me ? { text: `${partName(world, e.vehicle, e.part)} broke down`, cls: 'bad' } : null;
    case 'weather': {
      // A storm is local news: log it only when it starts or ends within sight of the player.
      const ev = e.event;
      if (ev.kind === 'storm' && dist(playerVehicle(world).pos, ev.pos) - ev.radius > TERRAIN.vision.radius) return null;
      return { text: `${ev.kind === 'storm' ? 'Dust storm' : ev.kind === 'heatwave' ? 'Heat wave' : 'Overcast'} ${e.outcome}`, cls: 'dim' };
    }
    case 'spawn':
    case 'despawn':
    case 'arrived':
      return null;
  }
}
