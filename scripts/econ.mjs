// Runs the economy harness (src/econ/harness.ts) and writes its report to tmp/econ/.
// Usage: npm run econ -- --seed <n> --days <n> --policy <haulOnly|salvageOnly|contractsOnly|greedy|all>
import { mkdirSync, writeFileSync } from 'node:fs';
import { formatReport, runPolicy } from '../src/econ/harness.ts';

const POLICIES = ['haulOnly', 'salvageOnly', 'contractsOnly', 'greedy'];

function argOf(name, fallback) {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const seed = Number(argOf('seed', '1'));
const days = Number(argOf('days', '5'));
const policyArg = argOf('policy', 'all');
if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, got "${argOf('seed')}"`);
if (!Number.isInteger(days) || days <= 0) throw new Error(`--days must be a positive integer, got "${argOf('days')}"`);
const policies = policyArg === 'all' ? POLICIES : [policyArg];
for (const p of policies) if (!POLICIES.includes(p)) throw new Error(`Unknown policy "${p}". Known: ${POLICIES.join(', ')}`);

mkdirSync('tmp/econ', { recursive: true });
const reports = [];
for (const policy of policies) {
  console.log(`Running ${policy} for ${days} days at seed ${seed}...`);
  const report = runPolicy(seed, policy, days);
  reports.push(report);
  writeFileSync(`tmp/econ/${seed}-${policy}.json`, JSON.stringify(report, null, 2));
}

const markdown = formatReport(reports);
writeFileSync('tmp/econ/report.md', markdown);
console.log(markdown);
