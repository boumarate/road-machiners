// Replays every trace in tmp/progression/ through the current XP rules and prints, per archetype, the in-game day
// each skill reaches each level, its XP per day, and each miss against the targets in src/data/skills.ts. It adds the
// wage per turn at each gear tier, the day each tier is first held, and the fight and loss counts.
// Days show the median over seeds and the min-max range. A level some seeds never reach shows how many seeds reached it.
// Usage: npm run progression:report [-- <dir>], with tmp/progression as the default dir.
import { createReadStream, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { MAX_SKILL_LEVEL, SKILL_IDS } from '../src/data/skills.ts';
import { TIME } from '../src/data/time.ts';
import { parseRun, replay, targetMisses } from '../src/sim/progression/replay.ts';
import { LEDGER_KEYS } from '../src/sim/progression/orders.ts';
import { fightTotals, ledgerTotals, TIERS, tierDays, wageByTier } from '../src/sim/progression/record.ts';

const DIR = process.argv.slice(2).find((a) => a !== '--') ?? 'tmp/progression';

const files = readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort();
if (files.length === 0) throw new Error(`No traces in ${DIR}/. Run npm run progression:record first.`);
const runs = [];
for (const file of files) runs.push(await readRun(`${DIR}/${file}`));

const archetypes = [...new Set(runs.map((r) => r.archetype))];
for (const archetype of archetypes) printArchetype(archetype, runs.filter((r) => r.archetype === archetype));
printSummary(archetypes);

// One line per bot: how its runs ended, what it earned per turn against the trader, and what it lost.
function printSummary(names) {
  const gains = Object.fromEntries(names.map((a) => [a, runs.filter((r) => r.archetype === a && r.rows.length > 1).map(gainPerTurn)]));
  const trader = gains.trader?.length ? median(gains.trader) : null;
  const rows = [['bot', 'runs', 'ended early', 'net worth/turn', 'vs trader', 'last day', 'knockouts', 'gear lost']];
  for (const a of names) rows.push(summaryRow(a, gains[a], trader));
  console.log('\nSummary');
  printTable(rows);
}

function summaryRow(archetype, gains, trader) {
  const group = runs.filter((r) => r.archetype === archetype);
  const early = group.filter((r) => r.death !== null || r.error !== null).length;
  const totals = group.map((r) => fightTotals(r.rows));
  const ends = group.filter((r) => r.rows.length > 0).map((r) => r.rows[r.rows.length - 1]);
  const gain = gains.length ? spread(gains, (n) => n.toFixed(2)) : '-';
  const ratio = trader && gains.length ? (median(gains) / trader).toFixed(2) : '-';
  const lastDay = ends.length ? spread(ends.map((row) => row.day), String) : '-';
  return [archetype, String(group.length), String(early), gain, ratio, lastDay, spread(totals.map((t) => t.knockouts), String), spread(totals.map((t) => t.gearLost), String)];
}

// Net worth gained per turn over the whole run.
function gainPerTurn(run) {
  const first = run.rows[0];
  const last = run.rows[run.rows.length - 1];
  const turns = run.rows.reduce((sum, row) => sum + row.turns, 0);
  return (last.netWorth - first.netWorth) / turns;
}

// A trace file, replayed with the current XP rules.
async function readRun(path) {
  const run = parseRun(await readValues(path), path);
  const curve = replay(run.trace, run.turns);
  return { ...run, curve, misses: targetMisses(curve, run.archetype, run.turns) };
}

async function readValues(path) {
  const values = [];
  for await (const text of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (text) values.push(JSON.parse(text));
  return values;
}

function printArchetype(archetype, group) {
  const seeds = group.map((r) => r.seed).join(', ');
  const days = group.map((r) => Number((r.turns / TIME.turnsPerDay).toFixed(1)));
  console.log(`\n${archetype}: ${group.length} seeds (${seeds}), ${Math.min(...days)} to ${Math.max(...days)} days`);
  printEndings(group);
  printSkills(group);
  printEconomy(group);
}

function printEndings(group) {
  const deaths = group.map((r) => r.death).filter((turn) => turn !== null);
  console.log(deaths.length === 0 ? 'No deaths' : `Died in ${deaths.length} of ${group.length} seeds, on turn ${spread(deaths, String)}`);
  for (const r of group) if (r.error) console.log(`Seed ${r.seed} failed on turn ${r.error.turn}: ${r.error.message.split('\n')[0]}`);
}

function printSkills(group) {
  const levels = Array.from({ length: MAX_SKILL_LEVEL }, (_, i) => `L${i + 1}`);
  const rows = [['skill', ...levels.map((l) => `${l} day`), 'XP/day']];
  for (const skill of SKILL_IDS) {
    const curves = group.map((r) => r.curve[skill]);
    const cells = levels.map((_, i) => levelCell(curves.map((c) => c.levels[i]), group.length));
    rows.push([skill, ...cells, spread(curves.map((c) => c.perDay), (n) => n.toFixed(0))]);
  }
  printTable(rows);
  for (const run of group) for (const miss of run.misses) console.log(`  seed ${run.seed}: ${miss}`);
  if (group.every((run) => run.misses.length === 0)) console.log('  all targets met');
}

// Wage per turn and the first day at each gear tier over seeds, then the fight totals and the end state of each seed.
function printEconomy(group) {
  const withRows = group.filter((r) => r.rows.length > 0);
  if (withRows.length === 0) return console.log('\nNo economy rows in these traces');
  const wages = withRows.map((r) => wageByTier(r.rows));
  const days = withRows.map((r) => tierDays(r.rows));
  const rows = [['gear tier', 'wage/turn', 'first day']];
  for (const tier of TIERS) rows.push([`tier ${tier}`, spreadOrNone(wages.map((w) => w[tier]), (n) => n.toFixed(2)), spreadOrNone(days.map((d) => d[tier]), String)]);
  console.log('');
  printTable(rows);
  const ends = [['seed', 'chassis', 'net worth', 'won', 'knockouts', 'gear lost', 'deaths', 'stalls']];
  for (const r of withRows) {
    const last = r.rows[r.rows.length - 1];
    const totals = fightTotals(r.rows);
    ends.push([String(r.seed), last.chassis, last.netWorth.toFixed(0), ...[totals.fightsWon, totals.knockouts, totals.gearLost, totals.deaths, totals.stalls].map(String)]);
  }
  console.log('');
  printTable(ends);
  printNetWorth(withRows);
  printLedger(withRows);
}

// Net worth at the end of chosen days, over the seeds that reached each day.
function printNetWorth(group) {
  const last = Math.max(...group.map((r) => r.rows[r.rows.length - 1].day));
  const days = [0, 1, 3, 5, 10, 15, 20, 30].filter((d) => d <= last);
  const rows = [['day', ...days.map(String)]];
  rows.push(['net worth', ...days.map((d) => spreadOrNone(group.map((r) => r.rows.find((row) => row.day === d)?.netWorth ?? null), (n) => n.toFixed(0)))]);
  console.log('');
  printTable(rows);
}

// Money moved per in-game day by key, over seeds. Negative is spent, positive earned.
function printLedger(group) {
  const totals = group.map((r) => ({ days: r.rows.reduce((sum, row) => sum + row.turns, 0) / TIME.turnsPerDay, ledger: ledgerTotals(r.rows) }));
  const rows = [['money per day', ...LEDGER_KEYS]];
  rows.push(['median', ...LEDGER_KEYS.map((key) => spread(totals.map((t) => t.ledger[key] / t.days), (n) => n.toFixed(0)))]);
  console.log('');
  printTable(rows);
}

function spreadOrNone(values, format) {
  const reached = values.filter((v) => v !== null);
  return reached.length === 0 ? 'never' : `${spread(reached, format)}${reached.length === values.length ? '' : ` [${reached.length}/${values.length}]`}`;
}

// The turns to a level over seeds. Seeds that never reach it are counted, not averaged in.
function levelCell(turns, seeds) {
  const reached = turns.filter((t) => t !== null);
  if (reached.length === 0) return 'never';
  const cell = spread(reached, (t) => (t / TIME.turnsPerDay).toFixed(1));
  return reached.length === seeds ? cell : `${cell} [${reached.length}/${seeds}]`;
}

function spread(values, format) {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return min === max ? format(median(sorted)) : `${format(median(sorted))} (${format(min)}-${format(max)})`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function printTable(rows) {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  for (const row of rows) console.log(row.map((cell, col) => cell.padEnd(widths[col])).join('  '));
}
