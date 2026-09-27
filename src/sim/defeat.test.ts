import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { checkDeath, checkDefeat } from './defeat';
import { corePart } from './grid';
import { emptyWorld } from './testkit';
import { endTurn } from './world';

describe('death', () => {
  it('kills the player at 0 health', () => {
    const w = emptyWorld();
    w.player.health = 0;
    checkDeath(w);
    expect(w.player.state).toBe('dead');
    expect(w.events).toEqual([{ t: 'death' }]);
    checkDeath(w);
    expect(w.events).toEqual([{ t: 'death' }]);
  });

  it('keeps a living player alive', () => {
    const w = emptyWorld();
    w.player.health = 1;
    checkDeath(w);
    expect(w.player.state).toBe('active');
  });

  it('dies in a turn that ends at 0 health, and no turn runs after', () => {
    let w = emptyWorld();
    w.player.health = 0;
    w = endTurn(w);
    expect(w.player.state).toBe('dead');
    expect(w.events.some((e) => e.t === 'death')).toBe(true);
    expect(w.events.some((e) => e.t === 'defeat')).toBe(false);
    expect(() => endTurn(w)).toThrow(/dead/);
  });

  it('does not rob a dead player with a broken cab', () => {
    const w = emptyWorld();
    Object.assign(w.player, { health: 0, state: 'dead' });
    corePart(w.vehicles[0], 'cab').hp = 0;
    const money = w.player.money;
    checkDefeat(w);
    expect(w.player.money).toBe(money);
    expect(w.events).toEqual([]);
  });

  it('starts the player active with a full supply load', () => {
    const w = emptyWorld();
    expect(w.player.state).toBe('active');
    expect(w.player.knockoutTurns).toBe(0);
    expect(w.player.supplies).toBe(RULES.suppliesCap);
  });
});
