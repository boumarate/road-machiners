import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { makePart } from '../sim/factory';
import { clockOf } from '../sim/sun';
import { cloneWorld, newWorld } from '../sim/world';
import type { World } from '../sim/types';
import { TEST_MAP } from '../test/map';
import { logEntries, RunLog } from './run-log';
import { memoryBackend } from './save-db';

function start(): World {
  return { ...newWorld(1337, startKit('standard'), TEST_MAP), turn: 400 };
}

// The next world, as a command makes it: a clone with fresh events.
function after(world: World, change: (w: World) => void): World {
  const next = cloneWorld(world);
  next.events = [];
  change(next);
  return next;
}

describe('logEntries', () => {
  it('keeps the player outcomes, names the trucks, and drops shots, spawns and fights between others', () => {
    const prev = start();
    const me = prev.player.vehicleId;
    const [foe, other] = prev.vehicles.filter((v) => v.id !== me);
    const next = after(prev, (w) => {
      w.events.push(
        { t: 'spawn', vehicle: foe.id },
        { t: 'destroyed', vehicle: foe.id, by: me },
        { t: 'destroyed', vehicle: other.id, by: foe.id },
        { t: 'skillUp', skill: 'driving', level: 2 },
      );
    });

    const events = logEntries(prev, next).filter((e) => e.kind === 'event');

    expect(events.map((e) => e.event)).toEqual(['destroyed', 'skillUp']);
    expect(events[0]).toMatchObject({ turn: 400, vehicle: foe.id, by: me, trucks: { [foe.id]: { name: foe.name, faction: foe.faction, chassis: foe.chassisId } } });
  });

  it('records money and parts gained and lost, which no event covers', () => {
    const prev = start();
    const sold = prev.player.storage[0] ?? null;
    const next = after(prev, (w) => {
      w.player.money -= 150;
      w.player.storage = [...w.player.storage.filter((p) => p !== w.player.storage[0]), makePart(w, 'mg', 0)];
    });

    const change = logEntries(prev, next).find((e) => e.kind === 'change');

    expect(change).toMatchObject({ money: -150, gained: ['mg'], lost: sold ? [sold.defId] : [] });
  });

  it('adds nothing when nothing the log keeps changed', () => {
    const prev = start();
    expect(logEntries(prev, after(prev, () => {}))).toEqual([]);
  });

  it('snapshots the player on the first world of a session and of each game day', () => {
    const prev = start();
    const first = logEntries(null, prev).find((e) => e.kind === 'day');
    expect(first).toMatchObject({ money: prev.player.money, chassis: expect.any(String), mountedValue: expect.any(Number) });
    const sameDay = after(prev, (w) => { w.turn += 1; });
    expect(logEntries(prev, sameDay).some((e) => e.kind === 'day')).toBe(false);
    let dayStart = prev.turn + 1;
    while (clockOf(dayStart).day === clockOf(prev.turn).day) dayStart++;
    const nextDay = after(prev, (w) => { w.turn = dayStart; });
    expect(logEntries(prev, nextDay).filter((e) => e.kind === 'day')).toHaveLength(1);
  });
});

describe('RunLog', () => {
  it('numbers records on across sessions, notes a load, and writes a world once', async () => {
    const backend = memoryBackend();
    const errors: unknown[] = [];
    const world = start();
    const first = await RunLog.open(backend, 'run', (e) => errors.push(e));
    first.begin(world, null);
    const next = after(world, (w) => { w.player.money += 10; });
    first.note(next);
    first.note(next);
    await new Promise((resolve) => setTimeout(resolve));
    const second = await RunLog.open(backend, 'run', (e) => errors.push(e));
    second.begin(world, 'slot1');
    await new Promise((resolve) => setTimeout(resolve));

    const records = await backend.readLog('run');

    expect(records.map((r) => r.seq)).toEqual(records.map((_, i) => i));
    expect(records.map((r) => r.kind)).toEqual(['start', 'day', 'change', 'loaded', 'day']);
    expect(records[3]).toMatchObject({ slot: 'slot1', turn: 400 });
    expect(errors).toEqual([]);
  });

  it('exports JSON Lines with the header first', async () => {
    const log = await RunLog.open(memoryBackend(), 'run', () => {});
    log.begin(start(), null);
    await new Promise((resolve) => setTimeout(resolve));

    const lines = (await log.lines({ kind: 'header', runId: 'run' })).trim().split('\n').map((l) => JSON.parse(l));

    expect(lines.map((l) => l.kind)).toEqual(['header', 'start', 'day']);
  });

  it('sends a refused write to onError', async () => {
    const errors: unknown[] = [];
    const refusing = { ...memoryBackend(), appendLog: () => Promise.reject(new Error('Quota exceeded')) };
    const log = await RunLog.open(refusing, 'run', (e) => errors.push(e));
    log.begin(start(), null);
    await new Promise((resolve) => setTimeout(resolve));
    expect(errors.map((e) => (e as Error).message)).toEqual(['Quota exceeded']);
  });
});
