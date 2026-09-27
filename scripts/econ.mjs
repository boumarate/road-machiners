// Runs the economy harness (src/econ/harness.ts) and writes its report to tmp/econ/.
// Usage: npm run econ -- --seeds 1,2,3 --days 30 --policy <idle|haulOnly|salvageOnly|contractsOnly|greedy|all>
// --seed <n> still works for a single seed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { formatReport, runMany } from '../src/econ/harness.ts';

const POLICIES = ['idle', 'haulOnly', 'salvageOnly', 'contractsOnly', 'greedy'];

function argOf(name, fallback) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function parseSeeds() {
  const seedsArg = argOf('seeds', null);
  if (seedsArg === null) return [Number(argOf('seed', '1'))];
  return seedsArg.split(',').map((s) => Number(s.trim()));
}

const seeds = parseSeeds();
for (const s of seeds) if (!Number.isInteger(s)) throw new Error(`--seeds must be a comma-separated list of integers, got "${seeds.join(',')}"`);
const days = Number(argOf('days', '5'));
const policyArg = argOf('policy', 'all');
if (!Number.isInteger(days) || days <= 0) throw new Error(`--days must be a positive integer, got "${argOf('days')}"`);
const policies = policyArg === 'all' ? POLICIES : [policyArg];
for (const p of policies) if (!POLICIES.includes(p)) throw new Error(`Unknown policy "${p}". Known: ${POLICIES.join(', ')}`);

mkdirSync('tmp/econ', { recursive: true });
console.log(`Running ${policies.join(', ')} for ${days} days at seed(s) ${seeds.join(', ')}...`);
const reports = runMany(seeds, policies, days);
for (const report of reports) writeFileSync(`tmp/econ/${report.seed}-${report.policy}.json`, JSON.stringify(report, null, 2));

const markdown = formatReport(reports);
writeFileSync('tmp/econ/report.md', markdown);
console.log(markdown);
