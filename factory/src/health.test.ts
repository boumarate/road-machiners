import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { healthFile, writeHealth } from './health';

describe('writeHealth', () => {
  it('writes the time, the free space and the minimum, and returns them', () => {
    const home = mkdtempSync(join(tmpdir(), 'health-'));
    const now = new Date('2026-01-10T12:00:00Z');
    const health = writeHealth(home, 5, now);
    expect(JSON.parse(readFileSync(healthFile(home), 'utf8'))).toEqual(health);
    expect(health.at).toBe('2026-01-10T12:00:00.000Z');
    expect(health.minFreeGb).toBe(5);
    expect(health.freeGb).toBeGreaterThan(0);
  });
});
