// Prints the NPC loadout report (src/test/loadout-report.ts) and writes it to tmp/loadouts.md.
// Usage: npm run loadouts -- [--rolls 60] [--template merc] [--level heavy]
import { mkdirSync, writeFileSync } from 'node:fs';
import { NPCS } from '../src/data/npcs.ts';
import { formatLoadoutReport, templateStats } from '../src/test/loadout-report.ts';

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const rolls = Number(argOf('rolls', '60'));
if (!Number.isInteger(rolls) || rolls <= 0) throw new Error(`--rolls must be a positive integer, got "${argOf('rolls')}"`);
const only = argOf('template', null);
const ids = only ? [only] : Object.keys(NPCS);
const markdown = formatLoadoutReport(ids.map((id) => templateStats(id, rolls, argOf('level', null))));
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/loadouts.md', markdown);
console.log(markdown);
