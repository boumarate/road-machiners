import { describe, expect, it } from 'vitest';
import { RADIO_LIGHT, RadioLights } from './radioLight';
import { emptyWorld } from '../../sim/testkit';
import type { World } from '../../sim/types';

function talking(id: string): World {
  const w = emptyWorld();
  w.events = [{ t: 'towOffer', by: id, town: 't', fee: 1 }];
  return w;
}

function sample(l: RadioLights, w: World, id: string, from: number, to: number): boolean[] {
  const out: boolean[] = [];
  for (let t = from; t < to; t += 50) out.push(l.lit(w, id, t));
  return out;
}

describe('radio lights', () => {
  it('blinks a speaker for the window and then goes dark', () => {
    const l = new RadioLights();
    const w = talking('a');
    l.note(w, 0);
    const first = sample(l, w, 'a', 0, RADIO_LIGHT.periodMs);
    expect(first).toContain(true);
    expect(first).toContain(false);
    l.note(w, RADIO_LIGHT.spokeMs + 1);
    expect(sample(l, w, 'a', RADIO_LIGHT.spokeMs + 1, RADIO_LIGHT.spokeMs + 3000)).not.toContain(true);
  });

  it('does not extend the window when the same world is noted again', () => {
    const l = new RadioLights();
    const w = talking('a');
    l.note(w, 0);
    l.note(w, 2000);
    l.note(w, RADIO_LIGHT.spokeMs + 1);
    expect(sample(l, w, 'a', RADIO_LIGHT.spokeMs + 1, RADIO_LIGHT.spokeMs + 1000)).not.toContain(true);
  });

  it('blinks an id on air with no time limit', () => {
    const l = new RadioLights();
    const w = emptyWorld();
    w.player.beacon = true;
    const id = w.player.vehicleId;
    const late = 100000;
    expect(sample(l, w, id, late, late + RADIO_LIGHT.periodMs)).toContain(true);
    expect(sample(l, w, id, late, late + RADIO_LIGHT.periodMs)).toContain(false);
  });

  it('never lights an id that is not on the radio', () => {
    const l = new RadioLights();
    const w = talking('a');
    l.note(w, 0);
    expect(sample(l, w, 'b', 0, 3000)).not.toContain(true);
  });
});
