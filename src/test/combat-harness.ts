// Combat harness: plays fights through the real turn pipeline and Rapier physics on flat open ground. The player
// truck follows a simple policy with auto fire, and the NPCs run their own brains. It measures hit rates, damage
// and outcomes, so a balance change can be judged before it ships. The game never imports this module.

import { CHASSIS } from '../data/chassis';
import { DECISIONS, NPC_BEHAVIOR, NPCS, TRAITS } from '../data/npcs';
import { PARTS } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { START_KITS } from '../data/start';
import { buildDrive, freeDrive, type Drive } from '../phys/drive';
import { physicsMove } from '../phys/turn';
import { isDefeated } from '../sim/defeat';
import { hangUp } from '../sim/dialogue';
import { mountedParts } from '../sim/grid';
import { generateNpcLoadout } from '../sim/npc-loadout';
import { spawnAt } from '../sim/spawn';
import type { Vehicle, World } from '../sim/types';
import { bearing, dist, type Vec } from '../sim/vec';
import { refreshVision } from '../sim/vision';
import { endTurn, newWorld, setAutoFire, setMoveOrder } from '../sim/world';
import { TEST_MAP } from './map';

// stand: brakes and never moves, like a stuck truck. orbit: circles the nearest enemy. charge: drives at the
// nearest enemy and brakes once close.
export type Policy = 'stand' | 'orbit' | 'charge';
export const POLICIES: Policy[] = ['stand', 'orbit', 'charge'];

export type Fight = {
  kit: string; // a START_KITS id for the player truck
  enemies: string[]; // NPCS template ids; each gets a rolled loadout
  policy: Policy;
  seed: number;
  gap: number; // tiles between the player and the enemies at the start
  orbit: number; // tiles; orbit radius and charge stop distance
  maxTurns: number;
};

export type Side = { rounds: number; hits: number; odds: number; damage: number }; // odds sums each round's hit chance
export type Outcome = 'won' | 'lost' | 'fled' | 'timeout';
export type FightReport = { fight: Fight; outcome: Outcome; turns: number; speed: number; me: Side; them: Side };

const CENTER: Vec = { x: 60, y: 60 };
const FLED_RANGE = 40; // tiles from the start; an enemy this far has left the fight

// Balance tables that --set may change, by the name the data files export them under.
const TABLES: Record<string, object> = { RULES, PHYSICS, NPCS, PARTS, CHASSIS, TRAITS, DECISIONS, NPC_BEHAVIOR, SKILL_EFFECTS };

// Sets one balance number for this run, like RULES.leadError=3 or PARTS.mg.spread=4. Only an existing number can
// change, so a typo fails instead of adding a field nothing reads.
export function setNumber(assignment: string): void {
  const [path, raw] = assignment.split('=');
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value)) throw new Error(`--set needs path=number, got "${assignment}"`);
  const keys = path.split('.');
  const last = keys.pop()!;
  const owner = keys.slice(1).reduce((obj, key) => subTable(obj, key, path), rootTable(keys[0]));
  if (typeof owner[last] !== 'number') throw new Error(`${path} is not a number`);
  owner[last] = value;
}

type Table = Record<string, unknown>;

function rootTable(name: string): Table {
  const table = TABLES[name];
  if (!table) throw new Error(`Unknown table "${name}". Known: ${Object.keys(TABLES).join(', ')}`);
  return table as Table;
}

function subTable(obj: Table, key: string, path: string): Table {
  const sub = obj[key];
  if (typeof sub !== 'object' || sub === null) throw new Error(`${path}: "${key}" is not a table`);
  return sub as Table;
}

// Flat road ground with no obstacles and no NPCs. Frozen terrain is shared by world clones instead of copied.
function openWorld(fight: Fight): World {
  const w = newWorld(fight.seed, START_KITS[fight.kit] ?? missing('kit', fight.kit), TEST_MAP);
  const terrain = { size: w.size, heights: new Array((w.size + 1) * (w.size + 1)).fill(0), types: new Array(w.size * w.size).fill('road') };
  Object.freeze(terrain.heights);
  Object.freeze(terrain.types);
  w.terrain = Object.freeze(terrain);
  w.obstacles = [];
  w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
  w.states = [];
  const me = w.vehicles[0];
  me.pos = { ...CENTER };
  me.heading = 0;
  me.speed = 0;
  return w;
}

function missing(what: string, id: string): never {
  throw new Error(`Unknown ${what} "${id}"`);
}

// The enemies stand in a line across the far side, already set on the player. Cowards drop their trait, since
// a fleeing driver measures nothing about the fight.
function setup(fight: Fight): World {
  const w = openWorld(fight);
  fight.enemies.forEach((id, i) => {
    const tpl = NPCS[id] ?? missing('NPC template', id);
    const pos = { x: CENTER.x + fight.gap, y: CENTER.y + (i - (fight.enemies.length - 1) / 2) * 3 };
    const e = spawnAt(w, tpl, generateNpcLoadout(w, tpl), pos);
    e.heading = Math.PI;
    e.brain!.traits = e.brain!.traits.filter((t) => t !== 'coward');
    e.brain!.attackers[w.player.vehicleId] = true;
    e.lastHitBy = w.player.vehicleId;
  });
  refreshVision(w);
  return setAutoFire(w, true);
}

function orders(w: World, fight: Fight, foe: Vehicle): World {
  const me = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
  if (fight.policy === 'stand') return setMoveOrder(w, { kind: 'brake' });
  if (fight.policy === 'charge') {
    if (dist(me.pos, foe.pos) <= fight.orbit) return setMoveOrder(w, { kind: 'brake' });
    return setMoveOrder(w, { kind: 'through', dest: foe.pos });
  }
  const a = bearing(foe.pos, me.pos) + Math.PI / 2; // a quarter circle ahead keeps the truck turning at speed
  return setMoveOrder(w, { kind: 'through', dest: { x: foe.pos.x + Math.cos(a) * fight.orbit, y: foe.pos.y + Math.sin(a) * fight.orbit } });
}

function turnLine(w: World, turn: number, me: Vehicle, enemyIds: Set<string>): string {
  const foes = w.vehicles.filter((v) => enemyIds.has(v.id)).map((v) =>
    `${v.id} d${dist(v.pos, me.pos).toFixed(1)} v${v.speed.toFixed(1)} ${v.brain?.goals.at(-1)?.kind ?? '-'}${isDefeated(v) ? ' OUT' : ''}`);
  const shots = w.events.flatMap((e) => (e.t === 'shot' ? [`${e.shooter}:${e.rounds.filter((r) => r.hit).length}/${e.rounds.length}@${Math.round(e.chance * 100)}%`] : []));
  return `t${turn} me ${me.pos.x.toFixed(1)},${me.pos.y.toFixed(1)} v${me.speed.toFixed(1)} ${me.order?.kind ?? "-"} | ${foes.join(' | ')} | ${shots.join(' ')}`;
}

const partHp = (v: Vehicle) => mountedParts(v).reduce((sum, p) => sum + p.hp, 0);
const side = (): Side => ({ rounds: 0, hits: 0, odds: 0, damage: 0 });

type Count = { meId: string; enemyIds: Set<string>; me: Side; them: Side };

function nearestFoe(w: World, c: Count): Vehicle {
  const me = w.vehicles.find((v) => v.id === c.meId)!;
  const foes = w.vehicles.filter((v) => c.enemyIds.has(v.id) && !isDefeated(v));
  return foes.reduce((a, b) => (dist(b.pos, me.pos) < dist(a.pos, me.pos) ? b : a));
}

function countShots(w: World, c: Count): void {
  for (const ev of w.events) {
    if (ev.t !== 'shot') continue;
    const s = ev.shooter === c.meId ? c.me : c.them;
    if (ev.shooter !== c.meId && !c.enemyIds.has(ev.shooter)) continue;
    s.rounds += ev.rounds.length;
    s.hits += ev.rounds.filter((r) => r.hit).length;
    s.odds += ev.chance * ev.rounds.length;
  }
}

// Part HP each truck lost this turn goes to the side that shot it.
function countDamage(w: World, c: Count, before: Map<string, number>): void {
  for (const v of w.vehicles) {
    const lost = Math.max(0, before.get(v.id)! - partHp(v));
    if (v.id === c.meId) c.them.damage += lost;
    else if (c.enemyIds.has(v.id)) c.me.damage += lost;
  }
}

function outcomeOf(w: World, c: Count): Outcome | null {
  if (w.player.state !== 'active') return 'lost';
  const left = w.vehicles.filter((v) => c.enemyIds.has(v.id) && !isDefeated(v));
  if (left.length === 0) return 'won';
  if (left.every((v) => dist(v.pos, CENTER) > FLED_RANGE)) return 'fled';
  return null;
}

// Plays one turn and counts it. Returns the next physics drive.
function playTurn(w: World, d: Drive, c: Count): { w: World; d: Drive } {
  const before = new Map(w.vehicles.map((v) => [v.id, partHp(v)]));
  let next: Drive | null = null;
  w = endTurn(w, physicsMove(d, (r) => (next = r.next)));
  freeDrive(d);
  countShots(w, c);
  countDamage(w, c, before);
  return { w, d: next! };
}

// log, when given, gets one line per turn: distance, speeds, each enemy's activity and the shots.
export function runFight(fight: Fight, log?: (line: string) => void): FightReport {
  let w = setup(fight);
  const c: Count = { meId: w.player.vehicleId, enemyIds: new Set(w.vehicles.slice(1).map((v) => v.id)), me: side(), them: side() };
  let d = buildDrive(w);
  let speed = 0;
  let outcome: Outcome | null = null;
  let turns = 0;
  while (outcome === null && turns < fight.maxTurns) {
    if (w.player.call) w = hangUp(w); // a raider demand; the fight goes on
    w = orders(w, fight, nearestFoe(w, c));
    ({ w, d } = playTurn(w, d, c));
    turns++;
    const me = w.vehicles.find((v) => v.id === c.meId)!;
    speed += Math.abs(me.speed);
    log?.(turnLine(w, turns, me, c.enemyIds));
    outcome = outcomeOf(w, c);
  }
  freeDrive(d);
  return { fight, outcome: outcome ?? 'timeout', turns, speed: speed / turns, me: c.me, them: c.them };
}

export type Group = { enemies: string; policy: Policy; reports: FightReport[] };

// Groups reports by enemy lineup and policy, in run order.
export function groups(reports: FightReport[]): Group[] {
  const out = new Map<string, Group>();
  for (const r of reports) {
    const key = `${r.fight.enemies.join('+')}|${r.fight.policy}`;
    if (!out.has(key)) out.set(key, { enemies: r.fight.enemies.join('+'), policy: r.fight.policy, reports: [] });
    out.get(key)!.reports.push(r);
  }
  return [...out.values()];
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '-');

export function formatReport(reports: FightReport[], sets: string[]): string {
  const kit = reports[0]?.fight.kit;
  const lines = [
    `# Combat harness`,
    '',
    `Kit ${kit}. ${reports.length} fights. Changed numbers: ${sets.length ? sets.join(', ') : 'none'}.`,
    'Hit is rounds that hit. Odds is the mean hit chance shown for those rounds. Damage is part HP lost per turn.',
    '',
    '| enemies | policy | won | lost | fled | timeout | turns | my speed | my hit | my odds | my dmg/turn | their hit | their odds | their dmg/turn |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const g of groups(reports)) {
    const rs = g.reports;
    const sum = (f: (r: FightReport) => number) => rs.reduce((a, r) => a + f(r), 0);
    const count = (o: Outcome) => rs.filter((r) => r.outcome === o).length;
    const turns = sum((r) => r.turns);
    lines.push(
      `| ${g.enemies} | ${g.policy} | ${count('won')} | ${count('lost')} | ${count('fled')} | ${count('timeout')} | ${(turns / rs.length).toFixed(1)}` +
        ` | ${(sum((r) => r.speed) / rs.length).toFixed(1)}` +
        ` | ${pct(sum((r) => r.me.hits), sum((r) => r.me.rounds))} | ${pct(sum((r) => r.me.odds), sum((r) => r.me.rounds))} | ${(sum((r) => r.me.damage) / turns).toFixed(1)}` +
        ` | ${pct(sum((r) => r.them.hits), sum((r) => r.them.rounds))} | ${pct(sum((r) => r.them.odds), sum((r) => r.them.rounds))} | ${(sum((r) => r.them.damage) / turns).toFixed(1)} |`,
    );
  }
  return lines.join('\n') + '\n';
}
