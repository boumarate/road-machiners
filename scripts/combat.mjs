// Runs the combat harness (src/test/combat-harness.ts) and writes its report to tmp/combat/.
// Usage: npm run combat -- --kit standard --enemies buggy,gunwagon,buggy+buggy --policy all --seeds 1-20
//   [--gap 8] [--orbit 6] [--turns 40] [--set RULES.leadError=3 --set PARTS.mg.spread=4] [--trace]
// --trace prints one line per turn. --out sets the report folder, tmp/combat by default.
// --enemies lists lineups; + joins trucks in one lineup. --set changes one balance number for this run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { formatReport, POLICIES, runFight, setNumber } from '../src/test/combat-harness.ts';
import { initPhysics } from '../src/phys/drive.ts';

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function argsOf(name) {
  return process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
}

function positiveInt(name, fallback) {
  const n = Number(argOf(name, fallback));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer, got "${argOf(name, fallback)}"`);
  return n;
}

function parseSeeds(text) {
  const range = /^(\d+)-(\d+)$/.exec(text);
  const seeds = range ? Array.from({ length: +range[2] - +range[1] + 1 }, (_, i) => +range[1] + i) : text.split(',').map(Number);
  for (const s of seeds) if (!Number.isInteger(s)) throw new Error(`--seeds must be a list like 1,2,3 or a range like 1-20, got "${text}"`);
  return seeds;
}

const trace = process.argv.includes('--trace');
const sets = argsOf('set');
for (const s of sets) setNumber(s);
const policyArg = argOf('policy', 'all');
const policies = policyArg === 'all' ? POLICIES : policyArg.split(',');
for (const p of policies) if (!POLICIES.includes(p)) throw new Error(`Unknown policy "${p}". Known: ${POLICIES.join(', ')}`);
const lineups = argOf('enemies', 'buggy,gunwagon').split(',').map((l) => l.split('+'));
const seeds = parseSeeds(argOf('seeds', '1-10'));
const base = { kit: argOf('kit', 'standard'), gap: positiveInt('gap', '8'), orbit: positiveInt('orbit', '6'), maxTurns: positiveInt('turns', '40') };

await initPhysics();
console.log(`Running ${lineups.length} lineups x ${policies.length} policies x ${seeds.length} seeds...`);
const reports = [];
for (const enemies of lineups)
  for (const policy of policies) for (const seed of seeds) reports.push(runFight({ ...base, enemies, policy, seed }, trace ? (l) => console.log(`${enemies.join('+')} ${policy} s${seed} ${l}`) : undefined));

const out = argOf('out', 'tmp/combat');
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/fights.json`, JSON.stringify(reports, null, 2));
const markdown = formatReport(reports, sets);
writeFileSync(`${out}/report.md`, markdown);
console.log(markdown);
